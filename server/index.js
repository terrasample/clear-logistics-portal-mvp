import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes, createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { resolveTxt } from 'dns/promises';
import PDFDocument from 'pdfkit';

dotenv.config();

const DEFAULT_MILESTONES = [
  { label: 'Order Received', done: true },
  { label: 'Pickup Scheduled', done: false },
  { label: 'Picked Up', done: false },
  { label: 'Freight Received', done: false },
  { label: 'Loaded on Vessel', done: false },
  { label: 'Arrived in Kingston', done: false },
  { label: 'Customs Clearance', done: false },
  { label: 'Out for Delivery', done: false },
  { label: 'Delivered', done: false }
];
const SHIPMENT_STATUS_MILESTONE_SEQUENCE = DEFAULT_MILESTONES.map((step) => String(step.label || '').trim());
const MANUAL_SHIPMENT_STATUS_OPTIONS = [
  'Order Received',
  'Pickup Scheduled',
  'Picked Up',
  'Freight Received',
  'Loaded on Vessel',
  'Arrived in Kingston',
  'Customs Clearance',
  'Out for Delivery',
  'Delivered',
];

const DRIVER_DEMO_EMAIL = String(process.env.DRIVER_DEMO_EMAIL || 'driver.demo@clearlogistics.test').trim().toLowerCase();
const DRIVER_DEMO_PASSWORD = String(process.env.DRIVER_DEMO_PASSWORD || 'Driver123!');
const DRIVER_DEMO_LEGACY_PASSWORD = String(process.env.DRIVER_DEMO_LEGACY_PASSWORD || 'Driver123!');
const DRIVER_DEMO_TOTAL_PICKUPS = 14;
const driverDemoAccountEnabled = String(process.env.DRIVER_DEMO_ACCOUNT_ENABLED || 'true').toLowerCase() === 'true';
const driverDemoPickupsEnabled = String(process.env.DRIVER_DEMO_PICKUPS_ENABLED || 'true').toLowerCase() === 'true';
const DEFAULT_US_RECEIVING_ADDRESS = String(
  process.env.US_RECEIVING_ADDRESS || 'Clear Logistics Freight Receiving, 7801 NW 37th St, Doral, FL 33166, USA'
).trim();

const QUOTE_NUDGE_DEFAULT_STEPS_MS = [
  60 * 60 * 1000, // 1 hour
  24 * 60 * 60 * 1000, // 24 hours
  72 * 60 * 60 * 1000, // 72 hours
];

const app = express();
const port = Number(process.env.PORT || 8787);
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const configuredPublicApiBase = String(process.env.PUBLIC_API_BASE || '').trim();
let activePort = port;
function getPublicApiBase() {
  return configuredPublicApiBase || `http://localhost:${activePort}`;
}
const allowDemoSeed = String(
  process.env.ALLOW_DEMO_SEED || (process.env.NODE_ENV === 'production' ? 'false' : 'true')
).toLowerCase() === 'true';
const defaultDataFile = path.resolve(process.cwd(), 'server', 'data.json');
const dataFile = path.resolve(String(process.env.DATA_FILE_PATH || defaultDataFile));
const uploadDir = path.resolve(String(process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'server', 'uploads')));
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
let dataWriteQueue = Promise.resolve();
let quoteNudgeWorkerTimer = null;
let quoteNudgeTickInProgress = false;
let scanAlertWorkerTimer = null;
let scanAlertTickInProgress = false;

function startServerWithPortRetry(initialPort, maxAttempts = 50) {
  const sanitizedInitialPort = Number.isInteger(initialPort) && initialPort > 0 ? initialPort : 8787;

  return new Promise((resolve, reject) => {
    const attemptListen = (candidatePort, attemptNumber) => {
      const server = app.listen(candidatePort, () => {
        resolve({ server, port: candidatePort, attemptNumber });
      });

      server.once('error', (error) => {
        const isPortInUse = error && String(error.code || '') === 'EADDRINUSE';
        if (isPortInUse && attemptNumber < maxAttempts) {
          console.warn(
            `[startup] Port ${candidatePort} is in use. Retrying on ${candidatePort + 1} (attempt ${attemptNumber + 1}/${maxAttempts}).`
          );
          attemptListen(candidatePort + 1, attemptNumber + 1);
          return;
        }
        reject(error);
      });
    };

    attemptListen(sanitizedInitialPort, 1);
  });
}
const requirePersistentDataPath = String(
  process.env.REQUIRE_PERSISTENT_DATA_PATH || 'false'
).toLowerCase() === 'true';
const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || 'business@example.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/uploads', express.static(uploadDir));

app.post('/api/notifications/whatsapp-dev-relay', async (req, res) => {
  const destination = String(req.body?.to || '').trim();
  const message = String(req.body?.message || '').trim();
  const channel = String(req.body?.channel || '').trim().toLowerCase();

  if (channel !== 'whatsapp') {
    return res.status(400).json({ ok: false, error: 'Only whatsapp channel is supported by this relay.' });
  }

  if (!destination || !message) {
    return res.status(400).json({ ok: false, error: 'to and message are required.' });
  }

  console.log('[whatsapp-dev-relay:delivered]', {
    to: destination,
    message,
    metadata: req.body?.metadata || {},
  });

  return res.status(200).json({ ok: true, delivered: true, provider: 'dev-relay' });
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const stripePaymentMethodTypes = String(process.env.STRIPE_PAYMENT_METHOD_TYPES || 'card,link,cashapp')
  .split(',')
  .map((method) => method.trim().toLowerCase())
  .filter(Boolean);
const nudgeEmailsEnabled = String(process.env.NUDGE_EMAILS_ENABLED || 'true').toLowerCase() === 'true';
const quoteNudgeIntervalMs = Math.max(15 * 1000, Number(process.env.NUDGE_INTERVAL_MS || 5 * 60 * 1000));
const quoteNudgeStepsMs = [
  Number(process.env.NUDGE_QUOTE_STEP_1_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[0]),
  Number(process.env.NUDGE_QUOTE_STEP_2_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[1]),
  Number(process.env.NUDGE_QUOTE_STEP_3_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[2]),
].filter((ms) => Number.isFinite(ms) && ms > 0);
const isRealEnvironment = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const scanAlertsEnabled = isRealEnvironment && String(process.env.SCAN_ALERTS_ENABLED || 'true').toLowerCase() === 'true';
const scanAlertIntervalMs = Math.max(60 * 1000, Number(process.env.SCAN_ALERT_INTERVAL_MS || 5 * 60 * 1000));
const scanRepeatWindowMs = Math.max(60 * 1000, Number(process.env.SCAN_REPEAT_WINDOW_MINUTES || 10) * 60 * 1000);
const scanRepeatThreshold = Math.max(2, Number(process.env.SCAN_REPEAT_THRESHOLD || 3));
const pickupConfirmScanWindowMs = Math.max(5 * 60 * 1000, Number(process.env.PICKUP_CONFIRM_SCAN_WINDOW_MINUTES || 30) * 60 * 1000);
const scanNoScanCutoffHour = Math.min(23, Math.max(0, Number(process.env.SCAN_NO_SCAN_CUTOFF_HOUR || 14)));
const purgeDemoDataOnStart = String(
  process.env.PURGE_DEMO_DATA_ON_START || (process.env.NODE_ENV === 'production' ? 'true' : 'false')
).toLowerCase() === 'true';
const emailProviderPreference = String(process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
const emailRequestTimeoutMs = Math.max(3000, Number(process.env.EMAIL_REQUEST_TIMEOUT_MS || 12000));
const passwordResetTokenTtlMinutes = Math.max(5, Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30));
const emailVerificationTokenTtlMinutes = Math.max(10, Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || 1440));
const emailDkimSelector = String(process.env.EMAIL_DKIM_SELECTOR || 'default').trim().toLowerCase();
const emailAuthCacheMs = Math.max(60 * 1000, Number(process.env.EMAIL_AUTH_CACHE_MS || 5 * 60 * 1000));
const whatsappAutoReplyEnabled = String(process.env.WHATSAPP_AUTO_REPLY_ENABLED || 'true').toLowerCase() === 'true';
const whatsappAutoReplyCooldownMs = Math.max(60 * 1000, Number(process.env.WHATSAPP_AUTO_REPLY_COOLDOWN_SECONDS || 900) * 1000);
const whatsappInboundToken = String(process.env.WHATSAPP_INBOUND_TOKEN || '').trim();
const whatsappAutoReplyMessage = String(
  process.env.WHATSAPP_AUTO_REPLY_MESSAGE
  || 'Hi {{name}}, thanks for contacting Clear Logistics & Freight Services. We\'ve received your request and our team will get back to you shortly. For faster support, please share your shipment ID and a brief description of your issue.'
).trim();
const proactiveAlertCooldownMs = Math.max(5 * 60 * 1000, Number(process.env.PROACTIVE_ALERT_COOLDOWN_MINUTES || 60) * 60 * 1000);
const proactiveSlaMinutes = Math.max(5, Number(process.env.PROACTIVE_SLA_MINUTES || 15));
let cachedEmailHealth = { expiresAt: 0, value: null };
const whatsappAutoReplyLastSentAt = new Map();

const FREE_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
]);

function isLikelyEphemeralDataPath(targetPath) {
  const normalized = path.resolve(targetPath);
  const cwdPath = path.resolve(process.cwd());

  if (normalized.startsWith(cwdPath)) {
    return true;
  }

  // Render source directory is recreated on each deploy/restart unless a disk mount is used.
  return normalized.includes(`${path.sep}opt${path.sep}render${path.sep}project${path.sep}src${path.sep}`);
}

function validateDataPathConfiguration() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!isLikelyEphemeralDataPath(dataFile)) {
    return;
  }

  const message =
    `DATA_FILE_PATH is using an ephemeral path (${dataFile}). ` +
    'Set DATA_FILE_PATH to a persistent disk mount (for example, /var/data/data.json on Render) to avoid account data loss.';

  if (requirePersistentDataPath) {
    throw new Error(message);
  }

  console.warn(`[startup-warning] ${message}`);
}

function createInitialDataPayload() {
  const demoAccounts = allowDemoSeed
    ? [
        {
          id: 'test-user-001',
          fullName: 'Test Customer',
          email: 'test@example.com',
          passwordHash: '$2b$10$.d83MyDSI9A2.qdDznEuduq3BbKpOIDkmczU6IZSCUndUBHLI9HG.', // password: password123
          phone: '+1-555-0100',
          address: '123 Test Street, New York, NY 10001',
          customerReference: 'CLF-TEST001',
          usReceivingAddress: DEFAULT_US_RECEIVING_ADDRESS,
          createdAt: new Date().toISOString()
        }
      ]
    : [];

  const demoShipments = allowDemoSeed
    ? [
        {
          shipmentId: 'CLF-10025',
          fullName: 'John',
          status: 'Order Received',
          cargoType: 'Box',
          quantity: '3',
          unitType: 'Box',
          milestones: DEFAULT_MILESTONES.map((step) => ({ ...step }))
        }
      ]
    : [];

  return {
    accounts: demoAccounts,
    drivers: [],
    quotes: [],
    aiQuotePacks: [],
    bookings: [],
    purchaseRequests: [],
    supportTickets: [],
    scanEvents: [],
    routes: [],
    shipments: demoShipments
  };
}

function getFrontendBaseUrl(req) {
  const configured = String(process.env.FRONTEND_URL || '').trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    return origin.replace(/\/$/, '');
  }

  return String(frontendUrl || 'http://localhost:5173').replace(/\/$/, '');
}

async function ensureDataFile() {
  validateDataPathConfiguration();
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    const initial = createInitialDataPayload();
    await fs.writeFile(dataFile, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

async function readData() {
  await ensureDataFile();
  await dataWriteQueue;
  let raw = '';
  try {
    raw = await fs.readFile(dataFile, 'utf-8');
  } catch {
    raw = '';
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    await ensureDataFile();
    const retryRaw = await fs.readFile(dataFile, 'utf-8');
    data = JSON.parse(retryRaw);
  }
  if (!Array.isArray(data.accounts)) data.accounts = [];
  if (!Array.isArray(data.drivers)) data.drivers = [];
  if (!Array.isArray(data.quotes)) data.quotes = [];
  if (!Array.isArray(data.aiQuotePacks)) data.aiQuotePacks = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.purchaseRequests)) data.purchaseRequests = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];
  if (!Array.isArray(data.routes)) data.routes = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];
  return data;
}

async function writeData(data) {
  const runWrite = async () => {
    const tempFile = `${dataFile}.${randomUUID()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempFile, dataFile);
  };

  dataWriteQueue = dataWriteQueue.then(runWrite, runWrite);
  await dataWriteQueue;
}

function sanitizeAccount(account) {
  const {
    password,
    passwordHash,
    passwordResetTokenHash,
    passwordResetRequestedAt,
    passwordResetExpiresAt,
    emailVerificationTokenHash,
    emailVerificationRequestedAt,
    emailVerificationExpiresAt,
    ...safeAccount
  } = account;
  return {
    ...safeAccount,
    role: resolveAccountRole(account)
  };
}

function deriveCustomerReference(account) {
  const existing = String(account?.customerReference || '').trim();
  if (existing) {
    return existing;
  }

  const fromId = String(account?.id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  if (fromId) {
    return `CLF-${fromId}`;
  }

  const fromEmail = String(account?.email || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return `CLF-${fromEmail || 'CUSTOMER'}`;
}

function deriveReceivingAddress(account) {
  const existing = String(account?.usReceivingAddress || account?.receivingAddress || '').trim();
  return existing || DEFAULT_US_RECEIVING_ADDRESS;
}

function ensureCustomerShippingProfile(account) {
  if (!account || resolveAccountRole(account) !== 'customer') {
    return false;
  }

  let changed = false;

  if (!String(account.customerReference || '').trim()) {
    account.customerReference = deriveCustomerReference(account);
    changed = true;
  }

  if (!String(account.usReceivingAddress || '').trim()) {
    account.usReceivingAddress = deriveReceivingAddress(account);
    changed = true;
  }

  return changed;
}

function resolveAccountRole(account) {
  if (account?.role) {
    return account.role;
  }

  const email = String(account?.email || '').trim().toLowerCase();
  if (email && adminEmails.has(email)) {
    return 'admin';
  }

  return 'customer';
}

function createAuthToken(account) {
  return jwt.sign(
    {
      sub: account.id,
      email: account.email,
      fullName: account.fullName,
      role: resolveAccountRole(account)
    },
    jwtSecret,
    { expiresIn: '12h' }
  );
}

function requireAuth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

function getAuthTokenFromHeader(headerValue) {
  const raw = String(headerValue || '');
  return raw.startsWith('Bearer ') ? raw.slice(7) : '';
}

function getOptionalAuthUser(req) {
  const token = getAuthTokenFromHeader(req?.headers?.authorization);
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

function looksLikeShopPayload(body) {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const hasItems = Array.isArray(body.items) && body.items.length > 0;
  const hasShopSignals = Boolean(
    body.storeName
    || body.invoiceUrl
    || body.idUrl
    || body.importPermitUrl
    || body.notificationPreferences
  );

  return hasItems && hasShopSignals;
}

async function attachCustomerShippingProfile(req, _res, next) {
  if (req.method !== 'POST' || !String(req.path || '').startsWith('/api/')) {
    return next();
  }

  if (!looksLikeShopPayload(req.body)) {
    return next();
  }

  const hasReference = String(req.body.customerReference || '').trim().length > 0;
  const hasUsAddress = String(req.body.usReceivingAddress || '').trim().length > 0;
  if (hasReference && hasUsAddress) {
    return next();
  }

  const token = getAuthTokenFromHeader(req.headers.authorization);
  if (!token) {
    return next();
  }

  let decoded = null;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    return next();
  }

  try {
    const data = await readData();
    const requesterEmail = normalizeEmail(decoded?.email);
    const matchedAccount = data.accounts.find((account) => {
      if (!account) return false;
      if (account.id && decoded?.sub && account.id === decoded.sub) return true;
      return normalizeEmail(account.email) === requesterEmail;
    }) || null;

    const profileSource = matchedAccount || decoded || {};

    if (!hasReference) {
      req.body.customerReference = deriveCustomerReference(profileSource);
    }

    if (!hasUsAddress) {
      req.body.usReceivingAddress = deriveReceivingAddress(profileSource);
    }
  } catch {
    // Keep request flow intact if profile auto-attachment fails.
  }

  return next();
}

app.use(attachCustomerShippingProfile);

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const SHARED_SPACE_TIERS = [
  { key: 'mini', label: 'Mini Space', minCubicFeet: 0, maxCubicFeet: 1.0, basePriceUsd: 42 },
  { key: 'small', label: 'Small Space', minCubicFeet: 1.0, maxCubicFeet: 2.5, basePriceUsd: 68 },
  { key: 'medium', label: 'Medium Space', minCubicFeet: 2.5, maxCubicFeet: 5.0, basePriceUsd: 108 },
  { key: 'large', label: 'Large Space', minCubicFeet: 5.0, maxCubicFeet: 9.0, basePriceUsd: 168 },
  { key: 'half-barrel', label: 'Half Barrel Space', minCubicFeet: 9.0, maxCubicFeet: 14.0, basePriceUsd: 248 },
  { key: 'full-barrel', label: 'Full Barrel Space', minCubicFeet: 14.0, maxCubicFeet: 20.0, basePriceUsd: 385 },
];

const DELIVERY_ZONE_CONFIG = {
  metro: { key: 'metro', label: 'Metro Kingston', baseFeeUsd: 0 },
  standard: { key: 'standard', label: 'Standard Parish Delivery', baseFeeUsd: 18 },
  remote: { key: 'remote', label: 'Remote Parish Delivery', baseFeeUsd: 34 },
};

const DELIVERY_ZONE_BY_PARISH = {
  kingston: 'metro',
  standrew: 'metro',
  stcatherine: 'metro',
  portmore: 'metro',
  spanishtown: 'metro',
  clarendon: 'standard',
  manchester: 'standard',
  saintjames: 'standard',
  stann: 'standard',
  saintthomas: 'standard',
  saintelizabeth: 'standard',
  westmoreland: 'standard',
  trelawny: 'remote',
  portland: 'remote',
  saintmary: 'remote',
  hanover: 'remote',
};

const CARGO_RATE_PER_LB = {
  box: 1.45,
  barrel: 1.65,
  pallet: 1.85,
  commercial_freight: 2.4,
};

const ESTIMATED_DENSITY_LBS_PER_CUBIC_FOOT = {
  box: 8.5,
  barrel: 10.5,
  pallet: 13.0,
  commercial_freight: 16.0,
};

const DEFAULT_SPACE_CUBIC_FEET_BY_CARGO = {
  box: 1.5,
  barrel: 7.3,
  pallet: 14.0,
  commercial_freight: 18.0,
};

const MINIMUM_SHIPMENT_FEE_USD = 48;
const FLORIDA_TO_JAMAICA_RATE_CARD_JMD = {
  1: 850,
  2: 1350,
  3: 1800,
  4: 2250,
  5: 2700,
  6: 3150,
  7: 3600,
  8: 4050,
};
const FLORIDA_TO_JAMAICA_RATE_CARD_INCREMENT_JMD = 450;
const JMD_PER_USD = 160;
const SINGLE_BARREL_FREIGHT_AND_CUSTOMS_USD = 240;
const JACKSONVILLE_BARREL_PICKUP_AND_HANDLING_USD = 139;
const BARREL_PICKUP_MILEAGE_RATE_USD_PER_MILE = Number(process.env.BARREL_PICKUP_MILEAGE_RATE_USD_PER_MILE || 1.35);
const BARREL_PICKUP_GAS_PRICE_USD_PER_GALLON = Number(process.env.BARREL_PICKUP_GAS_PRICE_USD_PER_GALLON || 3.9);
const BARREL_PICKUP_VEHICLE_MPG = Number(process.env.BARREL_PICKUP_VEHICLE_MPG || 17);
const BARREL_PICKUP_GAS_COST_MULTIPLIER = Number(process.env.BARREL_PICKUP_GAS_COST_MULTIPLIER || 1);
const BARREL_ADDITIONAL_DISCOUNT_RATE = 0.03;

function normalizeCargoKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeParishKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function isDropOffHandoff(payload) {
  const handoffType = String(payload?.handoffType || '').trim().toLowerCase();
  return handoffType === 'dropoff' || handoffType === 'drop-off' || handoffType === 'drop_off';
}

function resolvePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isJacksonvilleAreaPickup(payload) {
  const locationBlob = [
    payload?.pickupCity,
    payload?.pickupAddress,
    payload?.origin,
    payload?.pickupLocation,
  ].filter(Boolean).join(' ').toLowerCase();

  return /(jacksonville|jax|duval)/.test(locationBlob);
}

function resolvePickupDistanceMiles(payload) {
  const candidates = [
    payload?.pickupDistanceMiles,
    payload?.distanceMiles,
    payload?.pickupMiles,
    payload?.mileageMiles,
    payload?.mileage,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function resolveBarrelPickupAndHandling(payload) {
  if (isDropOffHandoff(payload)) {
    return {
      totalUsd: 0,
      model: 'dropoff',
    };
  }

  if (isJacksonvilleAreaPickup(payload)) {
    return {
      totalUsd: JACKSONVILLE_BARREL_PICKUP_AND_HANDLING_USD,
      model: 'jacksonville-flat-rate',
    };
  }

  const distanceMiles = resolvePickupDistanceMiles(payload);
  const mileageRateUsdPerMile = resolvePositiveNumber(payload?.barrelMileageRateUsdPerMile, BARREL_PICKUP_MILEAGE_RATE_USD_PER_MILE);
  const gasPriceUsdPerGallon = resolvePositiveNumber(payload?.gasPriceUsdPerGallon, BARREL_PICKUP_GAS_PRICE_USD_PER_GALLON);
  const vehicleMpg = resolvePositiveNumber(payload?.vehicleMpg, BARREL_PICKUP_VEHICLE_MPG);
  const gasCostMultiplier = resolvePositiveNumber(payload?.gasCostMultiplier, BARREL_PICKUP_GAS_COST_MULTIPLIER);

  if (distanceMiles <= 0) {
    return {
      totalUsd: JACKSONVILLE_BARREL_PICKUP_AND_HANDLING_USD,
      model: 'outside-jacksonville-fallback-flat-rate',
      distanceMiles,
      mileageRateUsdPerMile,
      gasPriceUsdPerGallon,
      vehicleMpg,
      gasCostMultiplier,
      fallbackApplied: true,
    };
  }

  const mileageChargeUsd = distanceMiles * mileageRateUsdPerMile;
  const gasChargeUsd = (distanceMiles / vehicleMpg) * gasPriceUsdPerGallon * gasCostMultiplier;
  const totalUsd = mileageChargeUsd + gasChargeUsd;

  return {
    totalUsd,
    model: 'outside-jacksonville-mileage-gas',
    distanceMiles,
    mileageRateUsdPerMile,
    gasPriceUsdPerGallon,
    vehicleMpg,
    gasCostMultiplier,
    mileageChargeUsd,
    gasChargeUsd,
  };
}

function resolveFloridaToJamaicaRateCardJmd(weightLbs) {
  const roundedWeight = Math.max(1, Math.ceil(Math.max(0, Number(weightLbs || 0))));
  if (FLORIDA_TO_JAMAICA_RATE_CARD_JMD[roundedWeight]) {
    return FLORIDA_TO_JAMAICA_RATE_CARD_JMD[roundedWeight];
  }
  const base = FLORIDA_TO_JAMAICA_RATE_CARD_JMD[8] || 0;
  const overageLbs = Math.max(0, roundedWeight - 8);
  return base + (overageLbs * FLORIDA_TO_JAMAICA_RATE_CARD_INCREMENT_JMD);
}

function isFloridaToJamaicaLane(payload) {
  const origin = String(payload?.origin || '').toLowerCase();
  const destination = String(payload?.destination || '').toLowerCase();
  const isFloridaOrigin = origin.includes('florida')
    || /\bfl\b/.test(origin)
    || /(miami|jacksonville|orlando|tampa|fort lauderdale|fort myers)/.test(origin);
  const isJamaicaDestination = destination.includes('jamaica')
    || /(kingston|montego bay|mandeville|ochos? rios|negril|portmore|spanish town)/.test(destination);
  return isFloridaOrigin && isJamaicaDestination;
}

function getServiceMultiplier(serviceLevel) {
  return serviceLevel === 'Express'
    ? 1.35
    : serviceLevel === 'Priority'
      ? 1.15
      : 1;
}

function getDeliveryZone(deliveryParish) {
  const normalized = normalizeParishKey(deliveryParish);
  const zoneKey = DELIVERY_ZONE_BY_PARISH[normalized] || 'standard';
  return DELIVERY_ZONE_CONFIG[zoneKey] || DELIVERY_ZONE_CONFIG.standard;
}

function calculateDimensionalCubicFeet(payload) {
  const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
  const length = Math.max(0, normalizeNumber(payload.dimensionsLength, 0));
  const width = Math.max(0, normalizeNumber(payload.dimensionsWidth, 0));
  const height = Math.max(0, normalizeNumber(payload.dimensionsHeight, 0));
  if (!length || !width || !height) return 0;
  return (length * width * height * quantity) / 1728;
}

function resolveSpaceTier(payload, billableCubicFeet) {
  const requestedKey = String(payload?.spaceTier || '').trim().toLowerCase();
  if (requestedKey && requestedKey !== 'auto') {
    const requested = SHARED_SPACE_TIERS.find((tier) => tier.key === requestedKey);
    if (requested) return requested;
  }

  const cubicFeet = Math.max(0, Number(billableCubicFeet || 0));
  return SHARED_SPACE_TIERS.find((tier) => cubicFeet <= tier.maxCubicFeet) || SHARED_SPACE_TIERS[SHARED_SPACE_TIERS.length - 1];
}

function calculateHybridQuotePricing(payload, { estimateOnly = false } = {}) {
  const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
  const cargoKey = normalizeCargoKey(payload.cargoType);
  const perLbRate = CARGO_RATE_PER_LB[cargoKey] || CARGO_RATE_PER_LB.box;
  const density = ESTIMATED_DENSITY_LBS_PER_CUBIC_FOOT[cargoKey] || ESTIMATED_DENSITY_LBS_PER_CUBIC_FOOT.box;
  const defaultCubicFeet = (DEFAULT_SPACE_CUBIC_FEET_BY_CARGO[cargoKey] || DEFAULT_SPACE_CUBIC_FEET_BY_CARGO.box) * quantity;
  const serviceMultiplier = getServiceMultiplier(payload.serviceLevel);
  const deliveryZone = getDeliveryZone(payload.deliveryParish);

  const dimensionalCubicFeet = calculateDimensionalCubicFeet(payload);
  const provisionalCubicFeet = dimensionalCubicFeet > 0 ? dimensionalCubicFeet : defaultCubicFeet;
  const selectedTier = resolveSpaceTier(payload, provisionalCubicFeet);
  const billableCubicFeet = Math.max(provisionalCubicFeet, selectedTier.minCubicFeet || 0);
  const isBarrelShipment = cargoKey === 'barrel' && quantity >= 1;

  const explicitWeight = Math.max(0, normalizeNumber(payload.weight, 0));
  const weightEntryMode = String(payload?.weightEntryMode || 'per-unit').trim().toLowerCase();
  const explicitWeightIsTotal = weightEntryMode === 'total';
  const computedWeight = explicitWeight > 0
    ? (explicitWeightIsTotal ? explicitWeight : explicitWeight * quantity)
    : billableCubicFeet * density;
  const declaredValueUsd = Math.max(0, normalizeNumber(payload.declaredValueUsd, 0));
  const valueFeeUsd = declaredValueUsd > 0 ? declaredValueUsd * 0.02 : 0;
  const isAirFreightLane = cargoKey !== 'barrel' && isFloridaToJamaicaLane(payload) && explicitWeight > 0;

  if (isBarrelShipment) {
    const pickupPricing = resolveBarrelPickupAndHandling(payload);
    const pickupAndHandlingUsd = pickupPricing.totalUsd;
    const firstBarrelFreightAndCustomsUsd = SINGLE_BARREL_FREIGHT_AND_CUSTOMS_USD;
    const additionalBarrelFreightAndCustomsUsd = Math.max(0, quantity - 1)
      * SINGLE_BARREL_FREIGHT_AND_CUSTOMS_USD
      * (1 - BARREL_ADDITIONAL_DISCOUNT_RATE);
    const freightAndCustomsUsd = firstBarrelFreightAndCustomsUsd + additionalBarrelFreightAndCustomsUsd;
    const totalUsd = Math.max(
      MINIMUM_SHIPMENT_FEE_USD,
      freightAndCustomsUsd + pickupAndHandlingUsd + Math.max(0, normalizeNumber(payload.supplyAddonsTotalUsd, 0))
    );

    const breakdown = {
      strategy: 'barrel-quantity-rate',
      spaceTierKey: selectedTier.key,
      spaceTierLabel: selectedTier.label,
      barrelQuantity: quantity,
      chargesUsd: {
        perBarrelFreightAndCustoms: Number(SINGLE_BARREL_FREIGHT_AND_CUSTOMS_USD.toFixed(2)),
        additionalBarrelDiscountRate: BARREL_ADDITIONAL_DISCOUNT_RATE,
        additionalBarrelFreightAndCustoms: Number(additionalBarrelFreightAndCustomsUsd.toFixed(2)),
        freightAndCustoms: Number(freightAndCustomsUsd.toFixed(2)),
        pickupAndHandling: Number(pickupAndHandlingUsd.toFixed(2)),
        pickupAndHandlingModel: pickupPricing.model,
        pickupDistanceMiles: Number((pickupPricing.distanceMiles || 0).toFixed(2)),
        pickupMileageRateUsdPerMile: Number((pickupPricing.mileageRateUsdPerMile || 0).toFixed(2)),
        pickupGasPriceUsdPerGallon: Number((pickupPricing.gasPriceUsdPerGallon || 0).toFixed(2)),
        pickupVehicleMpg: Number((pickupPricing.vehicleMpg || 0).toFixed(2)),
        pickupGasCostMultiplier: Number((pickupPricing.gasCostMultiplier || 0).toFixed(2)),
        pickupMileageCharge: Number((pickupPricing.mileageChargeUsd || 0).toFixed(2)),
        pickupGasCharge: Number((pickupPricing.gasChargeUsd || 0).toFixed(2)),
        pickupFallbackApplied: Boolean(pickupPricing.fallbackApplied),
        minimumShipmentFee: Number(MINIMUM_SHIPMENT_FEE_USD.toFixed(2)),
      },
      freightMode: 'sea-freight',
      handoffType: isDropOffHandoff(payload) ? 'dropoff' : 'pickup',
      deliveryZone: {
        key: deliveryZone.key,
        label: deliveryZone.label,
      },
    };

    if (estimateOnly) {
      const low = Math.max(MINIMUM_SHIPMENT_FEE_USD, Math.round(totalUsd * 0.95));
      const high = Math.max(low + 5, Math.round(totalUsd * 1.05));
      return {
        pricingMode: 'barrel-flat-rate',
        estimatedRangeUsd: { low, high },
        quotedPriceUsd: null,
        spaceTierKey: selectedTier.key,
        spaceTierLabel: selectedTier.label,
        deliveryZone,
        pricingBreakdown: {
          ...breakdown,
          estimatedRangeUsd: { low, high },
        },
      };
    }

    return {
      pricingMode: 'barrel-flat-rate',
      quotedPriceUsd: Number(totalUsd.toFixed(2)),
      estimatedRangeUsd: null,
      spaceTierKey: selectedTier.key,
      spaceTierLabel: selectedTier.label,
      deliveryZone,
      pricingBreakdown: {
        ...breakdown,
        finalPriceUsd: Number(totalUsd.toFixed(2)),
      },
    };
  }

  if (isAirFreightLane) {
    const billableWeightLbs = Math.max(1, Math.ceil(computedWeight));
    const rateCardJmd = resolveFloridaToJamaicaRateCardJmd(billableWeightLbs);
    const totalUsd = rateCardJmd / JMD_PER_USD;
    const breakdown = {
      strategy: 'air-rate-card',
      spaceTierKey: selectedTier.key,
      spaceTierLabel: selectedTier.label,
      billableCubicFeet: Number(billableCubicFeet.toFixed(2)),
      weightLbs: Number(billableWeightLbs.toFixed(2)),
      chargesUsd: {
        airRateCardBase: Number(totalUsd.toFixed(2)),
        selectedBase: Number(totalUsd.toFixed(2)),
      },
      rateCardJmd,
      freightMode: 'air-freight',
      deliveryZone: {
        key: deliveryZone.key,
        label: deliveryZone.label,
      },
    };

    if (estimateOnly) {
      const low = Math.max(1, Math.round(totalUsd * 0.95));
      const high = Math.max(low + 1, Math.round(totalUsd * 1.05));
      return {
        pricingMode: 'air-rate-card',
        estimatedRangeUsd: { low, high },
        quotedPriceUsd: null,
        spaceTierKey: selectedTier.key,
        spaceTierLabel: selectedTier.label,
        deliveryZone,
        pricingBreakdown: {
          ...breakdown,
          estimatedRangeUsd: { low, high },
        },
      };
    }

    return {
      pricingMode: 'air-rate-card',
      quotedPriceUsd: Number(totalUsd.toFixed(2)),
      estimatedRangeUsd: null,
      spaceTierKey: selectedTier.key,
      spaceTierLabel: selectedTier.label,
      deliveryZone,
      pricingBreakdown: {
        ...breakdown,
        finalPriceUsd: Number(totalUsd.toFixed(2)),
      },
    };
  }

  const weightChargeUsd = (computedWeight * perLbRate * serviceMultiplier) + valueFeeUsd;
  const spaceChargeUsd = selectedTier.basePriceUsd * serviceMultiplier;
  const baseChargeUsd = Math.max(weightChargeUsd, spaceChargeUsd);

  const lowerCategory = String(payload.itemCategory || '').toLowerCase();
  const fragileSurchargeUsd = /(fragile|glass|screen|electronics?)/i.test(lowerCategory) ? 12 : 0;
  const heavySurchargeUsd = computedWeight > 250 ? Math.min(85, (computedWeight - 250) * 0.18) : 0;
  const oversizeSurchargeUsd = billableCubicFeet > 20 ? Math.min(95, (billableCubicFeet - 20) * 7.5) : 0;
  const customsComplexitySurchargeUsd = declaredValueUsd >= 2500 ? 45 : declaredValueUsd >= 1200 ? 22 : 0;
  const supplyAddonsTotalUsd = Math.max(0, normalizeNumber(payload.supplyAddonsTotalUsd, 0));

  const subtotalUsd = baseChargeUsd
    + deliveryZone.baseFeeUsd
    + fragileSurchargeUsd
    + heavySurchargeUsd
    + oversizeSurchargeUsd
    + customsComplexitySurchargeUsd
    + supplyAddonsTotalUsd;

  const billableTotalUsd = Math.max(MINIMUM_SHIPMENT_FEE_USD, subtotalUsd);
  const breakdown = {
    strategy: 'greater-of-space-or-weight',
    spaceTierKey: selectedTier.key,
    spaceTierLabel: selectedTier.label,
    billableCubicFeet: Number(billableCubicFeet.toFixed(2)),
    weightLbs: Number(computedWeight.toFixed(2)),
    chargesUsd: {
      weightBased: Number(weightChargeUsd.toFixed(2)),
      spaceBased: Number(spaceChargeUsd.toFixed(2)),
      selectedBase: Number(baseChargeUsd.toFixed(2)),
      deliveryZoneFee: Number(deliveryZone.baseFeeUsd.toFixed(2)),
      fragileSurcharge: Number(fragileSurchargeUsd.toFixed(2)),
      heavySurcharge: Number(heavySurchargeUsd.toFixed(2)),
      oversizeSurcharge: Number(oversizeSurchargeUsd.toFixed(2)),
      customsComplexitySurcharge: Number(customsComplexitySurchargeUsd.toFixed(2)),
      supplyAddons: Number(supplyAddonsTotalUsd.toFixed(2)),
      minimumShipmentFee: Number(MINIMUM_SHIPMENT_FEE_USD.toFixed(2)),
    },
    deliveryZone: {
      key: deliveryZone.key,
      label: deliveryZone.label,
    },
  };

  if (estimateOnly) {
    const low = Math.max(MINIMUM_SHIPMENT_FEE_USD, Math.round(billableTotalUsd * 0.9));
    const high = Math.max(low + 5, Math.round(billableTotalUsd * 1.15));
    return {
      pricingMode: 'estimated',
      estimatedRangeUsd: { low, high },
      quotedPriceUsd: null,
      spaceTierKey: selectedTier.key,
      spaceTierLabel: selectedTier.label,
      deliveryZone,
      pricingBreakdown: {
        ...breakdown,
        estimatedRangeUsd: { low, high },
      },
    };
  }

  return {
    pricingMode: 'hybrid-space-weight',
    quotedPriceUsd: Math.round(billableTotalUsd),
    estimatedRangeUsd: null,
    spaceTierKey: selectedTier.key,
    spaceTierLabel: selectedTier.label,
    deliveryZone,
    pricingBreakdown: {
      ...breakdown,
      finalPriceUsd: Math.round(billableTotalUsd),
    },
  };
}

function containsDemoMarker(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (
      normalized === 'test@example.com' ||
      normalized === DRIVER_DEMO_EMAIL ||
      normalized === 'driver-demo-001' ||
      normalized === 'test-user-001' ||
      normalized === 'clf-10025'
    ) {
      return true;
    }

    // Filter synthetic QA/demo records that still use production-like IDs.
    if (/\b(test|demo|qa)\b/.test(normalized)) {
      return true;
    }

    return normalized.startsWith('clf-drv-') || normalized.startsWith('bkg-drv-');
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsDemoMarker(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((entry) => containsDemoMarker(entry));
  }

  return false;
}

function shouldShowDemoDataForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  const [localPart = '', domain = ''] = normalized.split('@');
  if (
    normalized === 'test@example.com' ||
    normalized === DRIVER_DEMO_EMAIL ||
    domain === 'example.com' ||
    domain.endsWith('.test') ||
    localPart.startsWith('test') ||
    localPart.includes('+test')
  ) {
    return true;
  }

  return false;
}

function filterDemoRecordsForEmail(records, email) {
  if (!Array.isArray(records)) {
    return [];
  }

  if (shouldShowDemoDataForEmail(email)) {
    return records;
  }

  return records.filter((entry) => !containsDemoMarker(entry));
}

async function purgeDemoDataIfNeeded() {
  if (allowDemoSeed || !purgeDemoDataOnStart) {
    return;
  }

  const data = await readData();
  const arrayKeys = [
    'accounts',
    'drivers',
    'quotes',
    'aiQuotePacks',
    'bookings',
    'purchaseRequests',
    'supportTickets',
    'scanEvents',
    'routes',
    'shipments',
  ];

  let removed = 0;
  for (const key of arrayKeys) {
    if (!Array.isArray(data[key])) {
      continue;
    }

    const before = data[key].length;
    data[key] = data[key].filter((entry) => !containsDemoMarker(entry));
    removed += before - data[key].length;
  }

  if (removed > 0) {
    await writeData(data);
    console.log(`[startup] Purged ${removed} demo records from persisted data.`);
  }
}

function estimateQuoteRange(payload) {
  return calculateHybridQuotePricing(payload, { estimateOnly: true }).estimatedRangeUsd;
}

function calculateWeightBasedQuote(payload) {
  return calculateHybridQuotePricing(payload, { estimateOnly: false }).quotedPriceUsd;
}

async function sendNotification(subject, body) {
  return sendEmail({
    to: process.env.NOTIFY_EMAIL,
    subject,
    text: body,
    mockTag: 'notification',
  });
}

function buildPlainTextEmail(text, html) {
  if (String(text || '').trim()) {
    return text;
  }
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getDefaultFromAddress() {
  return String(
    process.env.EMAIL_FROM ||
    process.env.RESEND_FROM ||
    process.env.SENDGRID_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    ''
  ).trim();
}

function getReplyToAddress() {
  return String(process.env.EMAIL_REPLY_TO || process.env.SMTP_REPLY_TO || '').trim();
}

function getAuditBccAddress() {
  return String(process.env.EMAIL_AUDIT_BCC || '').trim();
}

function extractEmailAddress(rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) return '';
  const bracketMatch = input.match(/<([^>]+)>/);
  return (bracketMatch?.[1] || input).trim().toLowerCase();
}

function extractDomain(rawValue) {
  const email = extractEmailAddress(rawValue);
  if (!email.includes('@')) return '';
  return email.split('@').pop().trim().toLowerCase();
}

function maskEmail(rawValue) {
  const email = extractEmailAddress(rawValue);
  if (!email || !email.includes('@')) return '';
  const [localPart, domain] = email.split('@');
  const safeLocal = localPart.length <= 2
    ? `${localPart[0] || '*'}*`
    : `${localPart.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function normalizeTxtRecords(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((parts) => (Array.isArray(parts) ? parts.join('') : String(parts || '')))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function readTxtRecords(hostname) {
  try {
    const records = await resolveTxt(hostname);
    return { ok: true, records: normalizeTxtRecords(records), error: '' };
  } catch (error) {
    return { ok: false, records: [], error: String(error?.code || error?.message || 'dns-lookup-failed') };
  }
}

async function buildEmailHealthSnapshot() {
  const fromAddress = getDefaultFromAddress();
  const replyTo = getReplyToAddress();
  const fromDomain = extractDomain(fromAddress);
  const replyToDomain = extractDomain(replyTo);

  const providerConfigured = {
    resend: Boolean(String(process.env.RESEND_API_KEY || '').trim()),
    sendgrid: Boolean(String(process.env.SENDGRID_API_KEY || '').trim()),
    smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  };

  const checks = {
    spf: { host: '', found: false, error: 'not-applicable' },
    dmarc: { host: '', found: false, error: 'not-applicable' },
    dkim: { host: '', selector: emailDkimSelector || 'default', found: false, error: 'not-applicable' },
  };

  if (fromDomain) {
    const spfLookup = await readTxtRecords(fromDomain);
    checks.spf = {
      host: fromDomain,
      found: spfLookup.records.some((record) => /^v=spf1\s/i.test(record)),
      error: spfLookup.ok ? '' : spfLookup.error,
    };

    const dmarcHost = `_dmarc.${fromDomain}`;
    const dmarcLookup = await readTxtRecords(dmarcHost);
    checks.dmarc = {
      host: dmarcHost,
      found: dmarcLookup.records.some((record) => /^v=DMARC1\s*;/i.test(record)),
      error: dmarcLookup.ok ? '' : dmarcLookup.error,
    };

    const selector = emailDkimSelector || 'default';
    const dkimHost = `${selector}._domainkey.${fromDomain}`;
    const dkimLookup = await readTxtRecords(dkimHost);
    checks.dkim = {
      host: dkimHost,
      selector,
      found: dkimLookup.records.length > 0,
      error: dkimLookup.ok ? '' : dkimLookup.error,
    };
  }

  const recommendations = [];
  if (!fromAddress) {
    recommendations.push('Set EMAIL_FROM or SMTP_FROM to a branded sender address (for example, quotes@yourdomain.com).');
  }
  if (fromDomain && FREE_MAILBOX_DOMAINS.has(fromDomain)) {
    recommendations.push('Avoid free mailbox sender domains (gmail/yahoo/outlook). Use your branded domain for better inbox placement.');
  }
  if (fromDomain && !checks.spf.found) {
    recommendations.push(`Add an SPF TXT record on ${fromDomain}.`);
  }
  if (fromDomain && !checks.dkim.found) {
    recommendations.push(`Publish DKIM TXT for selector ${checks.dkim.selector} on ${checks.dkim.host}.`);
  }
  if (fromDomain && !checks.dmarc.found) {
    recommendations.push(`Add a DMARC TXT record on ${checks.dmarc.host}.`);
  }
  if (!replyTo) {
    recommendations.push('Set EMAIL_REPLY_TO so customers can reply directly to your support inbox.');
  }

  return {
    providerPreference: emailProviderPreference,
    providerConfigured,
    fromAddressMasked: maskEmail(fromAddress),
    fromDomain,
    replyToMasked: maskEmail(replyTo),
    replyToDomain,
    auditBccConfigured: Boolean(getAuditBccAddress()),
    senderDomainIsFreeMailbox: Boolean(fromDomain && FREE_MAILBOX_DOMAINS.has(fromDomain)),
    checks,
    recommendations,
    checkedAt: new Date().toISOString(),
  };
}

async function getEmailHealthSnapshot() {
  const now = Date.now();
  if (cachedEmailHealth.value && cachedEmailHealth.expiresAt > now) {
    return cachedEmailHealth.value;
  }

  const snapshot = await buildEmailHealthSnapshot();
  cachedEmailHealth = {
    value: snapshot,
    expiresAt: now + emailAuthCacheMs,
  };
  return snapshot;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = emailRequestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaResend({ destination, subject, text, html, mockTag }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return { delivered: false, mode: 'skipped', provider: 'resend', reason: 'missing-resend-api-key' };
  }

  const fromAddress = String(process.env.RESEND_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  if (!fromAddress) {
    return { delivered: false, mode: 'skipped', provider: 'resend', reason: 'missing-from-address' };
  }

  const body = {
    from: fromAddress,
    to: [destination],
    subject,
    text: buildPlainTextEmail(text, html),
  };
  if (String(html || '').trim()) {
    body.html = html;
  }
  const replyTo = getReplyToAddress();
  if (replyTo) {
    body.reply_to = replyTo;
  }
  const bcc = getAuditBccAddress();
  if (bcc) {
    body.bcc = [bcc];
  }

  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = result?.message || result?.error || `Resend HTTP ${response.status}`;
      console.error(`[${mockTag}:resend-error]`, { to: destination, subject, reason, status: response.status });
      return {
        delivered: false,
        mode: 'provider-error',
        provider: 'resend',
        reason,
        responseCode: response.status,
      };
    }

    return {
      delivered: true,
      mode: 'provider',
      provider: 'resend',
      messageId: result?.id || null,
    };
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    const reason = isTimeout ? 'provider-request-timeout' : (error?.message || 'resend-send-failed');
    console.error(`[${mockTag}:resend-error]`, { to: destination, subject, reason });
    return {
      delivered: false,
      mode: 'provider-error',
      provider: 'resend',
      reason,
      code: isTimeout ? 'ETIMEDOUT' : (error?.code || null),
    };
  }
}

async function sendViaSendGrid({ destination, subject, text, html, mockTag }) {
  const apiKey = String(process.env.SENDGRID_API_KEY || '').trim();
  if (!apiKey) {
    return { delivered: false, mode: 'skipped', provider: 'sendgrid', reason: 'missing-sendgrid-api-key' };
  }

  const fromAddress = String(process.env.SENDGRID_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  if (!fromAddress) {
    return { delivered: false, mode: 'skipped', provider: 'sendgrid', reason: 'missing-from-address' };
  }

  const plainText = buildPlainTextEmail(text, html);
  const body = {
    personalizations: [{ to: [{ email: destination }] }],
    from: { email: fromAddress },
    subject,
    content: [
      { type: 'text/plain', value: plainText || subject },
    ],
  };

  if (String(html || '').trim()) {
    body.content.push({ type: 'text/html', value: html });
  }
  const replyTo = getReplyToAddress();
  if (replyTo) {
    body.reply_to = { email: replyTo };
  }
  const bcc = getAuditBccAddress();
  if (bcc) {
    body.personalizations[0].bcc = [{ email: bcc }];
  }

  try {
    const response = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const reason = bodyText || `SendGrid HTTP ${response.status}`;
      console.error(`[${mockTag}:sendgrid-error]`, { to: destination, subject, reason, status: response.status });
      return {
        delivered: false,
        mode: 'provider-error',
        provider: 'sendgrid',
        reason,
        responseCode: response.status,
      };
    }

    return {
      delivered: true,
      mode: 'provider',
      provider: 'sendgrid',
    };
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    const reason = isTimeout ? 'provider-request-timeout' : (error?.message || 'sendgrid-send-failed');
    console.error(`[${mockTag}:sendgrid-error]`, { to: destination, subject, reason });
    return {
      delivered: false,
      mode: 'provider-error',
      provider: 'sendgrid',
      reason,
      code: isTimeout ? 'ETIMEDOUT' : (error?.code || null),
    };
  }
}

async function sendViaSmtp({ destination, subject, text, html, mockTag }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { delivered: false, mode: 'skipped', provider: 'smtp', reason: 'missing-smtp-config' };
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    const replyTo = getReplyToAddress();
    const bcc = getAuditBccAddress();
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: destination,
      replyTo: replyTo || undefined,
      bcc: bcc || undefined,
      subject,
      text: buildPlainTextEmail(text, html),
      html
    });

    const target = extractEmailAddress(destination);
    const accepted = Array.isArray(info?.accepted)
      ? info.accepted.map((value) => extractEmailAddress(value)).filter(Boolean)
      : [];
    const rejected = Array.isArray(info?.rejected)
      ? info.rejected.map((value) => extractEmailAddress(value)).filter(Boolean)
      : [];

    const delivered = target
      ? accepted.includes(target) && !rejected.includes(target)
      : accepted.length > 0;

    if (!delivered) {
      console.error(`[${mockTag}:smtp-rejected]`, {
        to: destination,
        subject,
        accepted,
        rejected,
        response: info?.response || '',
      });
      return {
        delivered: false,
        mode: 'smtp-rejected',
        provider: 'smtp',
        reason: 'recipient-rejected-by-smtp',
        code: 'SMTP_RECIPIENT_REJECTED',
        responseCode: Number.isFinite(Number(info?.responseCode)) ? Number(info.responseCode) : null,
        response: info?.response || '',
        messageId: info?.messageId || null,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
      };
    }

    return {
      delivered: true,
      mode: 'smtp',
      provider: 'smtp',
      messageId: info?.messageId || null,
      responseCode: Number.isFinite(Number(info?.responseCode)) ? Number(info.responseCode) : null,
      response: info?.response || '',
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
    };
  } catch (error) {
    console.error(`[${mockTag}:smtp-error]`, {
      to: destination,
      subject,
      message: error?.message || String(error),
      code: error?.code || null,
      responseCode: error?.responseCode || null,
    });
    return {
      delivered: false,
      mode: 'smtp-error',
      provider: 'smtp',
      reason: error?.message || 'smtp-send-failed',
      code: error?.code || null,
      responseCode: error?.responseCode || null,
    };
  }
}

function normalizeDeliveryStatus(result) {
  return {
    delivered: Boolean(result?.delivered),
    mode: String(result?.mode || 'unknown'),
    provider: String(result?.provider || ''),
    reason: result?.reason ? String(result.reason) : '',
    code: result?.code ? String(result.code) : '',
    responseCode: Number.isFinite(Number(result?.responseCode)) ? Number(result.responseCode) : null,
    messageId: result?.messageId ? String(result.messageId) : '',
    response: result?.response ? String(result.response) : '',
    acceptedCount: Number.isFinite(Number(result?.acceptedCount)) ? Number(result.acceptedCount) : null,
    rejectedCount: Number.isFinite(Number(result?.rejectedCount)) ? Number(result.rejectedCount) : null,
  };
}

async function sendEmail({ to, subject, text, html, mockTag = 'email' }) {
  const destination = String(to || '').trim();
  if (!destination || !subject || (!text && !html)) {
    return { delivered: false, mode: 'skipped', reason: 'missing-required-fields' };
  }

  const attempts = [];
  const resendAttempt = () => sendViaResend({ destination, subject, text, html, mockTag });
  const sendGridAttempt = () => sendViaSendGrid({ destination, subject, text, html, mockTag });
  const smtpAttempt = () => sendViaSmtp({ destination, subject, text, html, mockTag });

  const attemptOrder = emailProviderPreference === 'smtp'
    ? [smtpAttempt, resendAttempt, sendGridAttempt]
    : emailProviderPreference === 'sendgrid'
      ? [sendGridAttempt, resendAttempt, smtpAttempt]
      : [resendAttempt, sendGridAttempt, smtpAttempt];

  for (const sendAttempt of attemptOrder) {
    const result = await sendAttempt();
    attempts.push(normalizeDeliveryStatus(result));
    if (result.delivered) {
      return {
        ...normalizeDeliveryStatus(result),
        attempts,
      };
    }
  }

  const hasConfiguredTransport = attempts.some((attempt) => attempt.mode !== 'skipped');
  if (!hasConfiguredTransport) {
    console.log(`[${mockTag}:mock]`, { to: destination, subject, text: buildPlainTextEmail(text, html) || '(empty body)' });
    return { delivered: false, mode: 'mock', provider: 'none', reason: 'no-email-provider-configured', attempts };
  }

  const lastFailure = attempts[attempts.length - 1] || {};
  return {
    delivered: false,
    mode: lastFailure.mode || 'failed',
    provider: lastFailure.provider || '',
    reason: lastFailure.reason || 'all-email-attempts-failed',
    code: lastFailure.code || '',
    responseCode: lastFailure.responseCode || null,
    attempts,
  };
}

function formatUsd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'TBD';
  return `$${numeric.toFixed(2)} USD`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildQuotePricingLabel(quote) {
  if (quote?.pricingMode === 'estimated') {
    const low = quote?.estimatedRangeUsd?.low;
    const high = quote?.estimatedRangeUsd?.high;
    if (Number.isFinite(Number(low)) && Number.isFinite(Number(high))) {
      return `Estimated ${formatUsd(low)} - ${formatUsd(high)}`;
    }
    return 'Estimated pricing (pending warehouse verification)';
  }
  if (quote?.pricingMode === 'hybrid-space-weight') {
    const tierLabel = quote?.spaceTierLabel || quote?.pricingBreakdown?.spaceTierLabel;
    const tierSuffix = tierLabel ? ` (${tierLabel})` : '';
    return `Shared-space hybrid ${formatUsd(quote?.quotedPriceUsd)}${tierSuffix}`;
  }
  return `Weight-based ${formatUsd(quote?.quotedPriceUsd)}`;
}

function buildPremiumQuoteAdminEmail(quote) {
  const barrelQty = Math.max(0, Number(quote?.barrelPurchaseQty || 0));
  const wantsSupplies = Boolean(quote?.needsPackingSupplies);
  const wantsVipConcierge = Boolean(quote?.vipConcierge);
  const pricingLabel = buildQuotePricingLabel(quote);

  const subject = `Premium Quote Request ${quote.quoteId} - ${quote.fullName}`;
  const text = [
    `New premium quote request: ${quote.quoteId}`,
    `Customer: ${quote.fullName}`,
    `Email: ${quote.email}`,
    `Phone: ${quote.phone}`,
    `Route: ${quote.origin} -> ${quote.destination} (${quote.deliveryParish})`,
    `Cargo: ${quote.cargoType} | Service: ${quote.serviceLevel}`,
    `Category: ${quote.itemCategory}`,
    `Declared Value: ${quote.declaredValueUsd ? formatUsd(quote.declaredValueUsd) : 'Not provided'}`,
    `Pricing: ${pricingLabel}`,
    `Barrel Add-On: ${barrelQty > 0 ? `${barrelQty} requested` : 'No'}`,
    `Packing Supplies: ${wantsSupplies ? 'Yes' : 'No'}`,
    `VIP Concierge: ${wantsVipConcierge ? 'Yes (priority follow-up)' : 'No'}`,
    'SLA Target: 10-minute response during business hours (otherwise tag as VIP Priority).',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f5f7fa;padding:20px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dce3ea;border-radius:10px;overflow:hidden;">
        <div style="background:#0e7a5f;color:#ffffff;padding:16px 20px;">
          <h2 style="margin:0;font-size:20px;">Premium Quote Request</h2>
          <p style="margin:6px 0 0 0;font-size:13px;opacity:0.95;">${escapeHtml(quote.quoteId)} • ${escapeHtml(quote.fullName)}</p>
        </div>
        <div style="padding:18px 20px;color:#1d2939;line-height:1.5;font-size:14px;">
          <p style="margin:0 0 12px 0;"><strong>Customer:</strong> ${escapeHtml(quote.fullName)} (${escapeHtml(quote.email)})</p>
          <p style="margin:0 0 12px 0;"><strong>Phone:</strong> ${escapeHtml(quote.phone)}</p>
          <p style="margin:0 0 12px 0;"><strong>Route:</strong> ${escapeHtml(quote.origin)} to ${escapeHtml(quote.destination)} (${escapeHtml(quote.deliveryParish)})</p>
          <p style="margin:0 0 12px 0;"><strong>Cargo:</strong> ${escapeHtml(quote.cargoType)} | <strong>Service:</strong> ${escapeHtml(quote.serviceLevel)}</p>
          <p style="margin:0 0 12px 0;"><strong>Category:</strong> ${escapeHtml(quote.itemCategory)}</p>
          <p style="margin:0 0 12px 0;"><strong>Pricing:</strong> ${escapeHtml(pricingLabel)}</p>
          <p style="margin:0 0 12px 0;"><strong>Barrel Add-On:</strong> ${barrelQty > 0 ? `${barrelQty} requested` : 'No'} | <strong>Packing Supplies:</strong> ${wantsSupplies ? 'Yes' : 'No'}</p>
          <p style="margin:0 0 12px 0;"><strong>VIP Concierge:</strong> ${wantsVipConcierge ? 'Yes' : 'No'}</p>
          <p style="margin:0 0 12px 0;"><strong>SLA Target:</strong> 10-minute response during business hours, else VIP Priority tag.</p>
          <div style="margin-top:16px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <strong>Action:</strong> Contact this customer quickly to lock booking before competitor churn.
          </div>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function buildPremiumQuoteCustomerEmail(quote) {
  const barrelQty = Math.max(0, Number(quote?.barrelPurchaseQty || 0));
  const wantsSupplies = Boolean(quote?.needsPackingSupplies);
  const wantsVipConcierge = Boolean(quote?.vipConcierge);
  const pricingLabel = buildQuotePricingLabel(quote);
  const subject = `Your Quote ${quote.quoteId} Is In Priority Review`;

  const text = [
    `Hi ${quote.fullName},`,
    '',
    `Your quote request (${quote.quoteId}) has been received and placed in priority review.`,
    `Route: ${quote.origin} -> ${quote.destination}`,
    `Service: ${quote.serviceLevel}`,
    `Pricing: ${pricingLabel}`,
    '',
    'Why customers choose us:',
    '- Pickup + shipping + delivery in one platform',
    '- Fast support and proactive shipment updates',
    '- Clear pricing and premium handling options',
    '',
    `Barrel add-on request: ${barrelQty > 0 ? `${barrelQty} barrel(s)` : 'Not selected'}`,
    `Packing supplies: ${wantsSupplies ? 'Requested' : 'Not requested'}`,
    `VIP concierge: ${wantsVipConcierge ? 'Enabled' : 'Standard follow-up'}`,
    'Guarantee: 10-minute response during business hours, or we auto-tag your request as VIP Priority.',
    '',
    'Thank you for choosing Clear Logistics & Freight Services.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#eef3f7;padding:20px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d6dde5;border-radius:12px;overflow:hidden;">
        <div style="padding:20px;background:linear-gradient(135deg,#0e7a5f 0%,#0a5f4b 100%);color:#fff;">
          <h2 style="margin:0 0 8px 0;font-size:22px;">Your Quote Is In Priority Review</h2>
          <p style="margin:0;font-size:14px;opacity:0.95;">Quote ${escapeHtml(quote.quoteId)} • Clear Logistics & Freight Services</p>
        </div>
        <div style="padding:18px 20px;color:#1d2939;font-size:14px;line-height:1.5;">
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(quote.fullName)}, your request is in and our team is preparing your best routing and pricing options.</p>
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;margin-bottom:12px;">
            <p style="margin:0 0 6px 0;"><strong>Route:</strong> ${escapeHtml(quote.origin)} to ${escapeHtml(quote.destination)}</p>
            <p style="margin:0 0 6px 0;"><strong>Service:</strong> ${escapeHtml(quote.serviceLevel)}</p>
            <p style="margin:0;"><strong>Pricing Mode:</strong> ${escapeHtml(pricingLabel)}</p>
          </div>
          <p style="margin:0 0 10px 0;"><strong>One-stop options selected:</strong> Barrel add-on ${barrelQty > 0 ? `${barrelQty}` : 'none'} • Packing supplies ${wantsSupplies ? 'yes' : 'no'} • VIP concierge ${wantsVipConcierge ? 'enabled' : 'standard'}</p>
          <p style="margin:0 0 10px 0;"><strong>Service guarantee:</strong> We respond within 10 minutes during business hours, or your request is auto-tagged VIP Priority.</p>
          <p style="margin:0 0 6px 0;"><strong>Why this platform wins:</strong></p>
          <ul style="margin:0 0 12px 18px;padding:0;">
            <li>Pickup, freight, and Jamaica delivery in one place</li>
            <li>Live shipment tracking and real support</li>
            <li>Priority handling for urgent cargo</li>
          </ul>
          <p style="margin:0;">Need help now? Reply to this email and our team will respond promptly.</p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function resolveAssistantCargoType(rawValue) {
  const normalized = normalizeCargoKey(rawValue);
  if (normalized === 'commercial_freight' || normalized === 'commercialfreight') {
    return 'Commercial Freight';
  }
  if (normalized === 'pallet') return 'Pallet';
  if (normalized === 'barrel') return 'Barrel';
  return 'Box';
}

function extractAssistantDimensions(payload = {}) {
  if (payload?.dimensions && typeof payload.dimensions === 'object') {
    const length = normalizeNumber(payload.dimensions.length, 0);
    const width = normalizeNumber(payload.dimensions.width, 0);
    const height = normalizeNumber(payload.dimensions.height, 0);
    if (length > 0 && width > 0 && height > 0) {
      return { length, width, height };
    }
  }

  const length = normalizeNumber(payload.dimensionsLength, 0);
  const width = normalizeNumber(payload.dimensionsWidth, 0);
  const height = normalizeNumber(payload.dimensionsHeight, 0);
  if (length > 0 && width > 0 && height > 0) {
    return { length, width, height };
  }

  const compactRaw = String(payload.dimensionString || payload.dimensionsText || '').trim();
  const compactMatch = compactRaw.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (compactMatch) {
    return {
      length: normalizeNumber(compactMatch[1], 0),
      width: normalizeNumber(compactMatch[2], 0),
      height: normalizeNumber(compactMatch[3], 0),
    };
  }

  return { length: 0, width: 0, height: 0 };
}

function buildAssistantPaperwork({ cargoType, declaredValueUsd, itemCategory, serviceLevel }) {
  const paperwork = [
    'Government-issued photo ID (shipper)',
    'Commercial invoice or purchase receipts',
    'Packing list with quantity and item descriptions',
  ];

  if (declaredValueUsd >= 1000) {
    paperwork.push('Proof of value for high-value goods (bank receipt or order confirmation)');
  }

  if (cargoType === 'Commercial Freight' || cargoType === 'Pallet') {
    paperwork.push('Consignee business details (TRN/company registration if applicable)');
  }

  if (/electronics?|appliance|screen|laptop|phone|tablet/i.test(String(itemCategory || ''))) {
    paperwork.push('Electronics serial/model list for customs inspection');
  }

  if (String(serviceLevel || '').toLowerCase() === 'express') {
    paperwork.push('Priority dispatch authorization and same-day pickup confirmation');
  }

  return paperwork;
}

function buildAssistantCustomsChecklist({ destination, declaredValueUsd, itemCategory }) {
  const checklist = [
    'Confirm receiver full legal name and delivery phone number',
    `Confirm final Jamaica destination: ${destination || 'Kingston, Jamaica'}`,
    'Verify every package item is listed with realistic value',
    'Remove prohibited/restricted items before handoff',
    'Keep copies of invoices and identification for clearance',
  ];

  if (declaredValueUsd >= 2500) {
    checklist.push('Prepare for additional customs validation due to declared value threshold');
  }

  if (/commercial|bulk|resale|inventory/i.test(String(itemCategory || ''))) {
    checklist.push('Mark shipment as commercial and provide importer business details');
  }

  return checklist;
}

function buildAssistantEstimateLabel(pricing) {
  if (pricing?.pricingMode === 'estimated' && pricing?.estimatedRangeUsd) {
    return `Estimated range: ${formatUsd(pricing.estimatedRangeUsd.low)} - ${formatUsd(pricing.estimatedRangeUsd.high)}`;
  }
  return `Estimated total: ${formatUsd(pricing?.quotedPriceUsd)}`;
}

function buildAssistantConfidence({ weightKnown, hasDimensions, hasDeclaredValue, hasPickupRequirements, hasDeliveryRequirements }) {
  let score = weightKnown ? 88 : 76;
  if (!hasDimensions) score -= 7;
  if (!hasDeclaredValue) score -= 5;
  if (!hasPickupRequirements) score -= 3;
  if (!hasDeliveryRequirements) score -= 3;
  return Math.max(55, Math.min(95, score));
}

function buildAssistantAssumptions({ pricing, quantity, weightLbs, dimensions, deliveryParish, serviceLevel }) {
  const assumptions = [
    'This is an estimate and final charges are confirmed after intake inspection.',
    `Service level assumed: ${serviceLevel || 'Standard'}.`,
    `Delivery parish assumed: ${deliveryParish || 'Kingston'}.`,
    `Quantity used for pricing: ${Math.max(1, Number(quantity || 1))}.`,
  ];

  if (Number(weightLbs || 0) > 0) {
    assumptions.push(`Weight-based input used: ${Number(weightLbs).toFixed(2)} lbs.`);
  } else {
    assumptions.push('Weight was not provided; dimensional/space-based estimate used.');
  }

  if (Number(dimensions.length || 0) > 0 && Number(dimensions.width || 0) > 0 && Number(dimensions.height || 0) > 0) {
    assumptions.push(`Dimensions used: ${dimensions.length} x ${dimensions.width} x ${dimensions.height} in.`);
  }

  if (pricing?.spaceTierLabel) {
    assumptions.push(`Calculated space tier: ${pricing.spaceTierLabel}.`);
  }

  return assumptions;
}

function buildAssistantCustomerEmailDraft({ customerName, assistantQuoteId, origin, destination, estimateLabel, requiredPaperwork, customsChecklist }) {
  const greetingName = String(customerName || 'Customer').trim() || 'Customer';
  const subject = `Your Freight Estimate ${assistantQuoteId} - Clear Logistics`;
  const body = [
    `Hi ${greetingName},`,
    '',
    `Thanks for your freight request from ${origin} to ${destination}.`,
    `Here is your preliminary estimate: ${estimateLabel}.`,
    '',
    'Required paperwork:',
    ...requiredPaperwork.map((item) => `- ${item}`),
    '',
    'Customs checklist:',
    ...customsChecklist.map((item) => `- ${item}`),
    '',
    'Important: this estimate is valid for 48 hours and final pricing is confirmed after cargo inspection.',
    'Reply to this email to lock your booking or request a pickup window.',
    '',
    'Clear Logistics & Freight Services',
  ].join('\n');

  return { subject, body };
}

function buildSimpleHtmlFromText(text) {
  const safe = escapeHtml(text || '');
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;white-space:pre-wrap;">${safe}</div>`;
}

async function buildAssistantQuotePdfBase64({
  assistantQuoteId,
  customerName,
  origin,
  destination,
  cargoType,
  estimateLabel,
  confidence,
  paperwork,
  checklist,
  assumptions,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    doc.fontSize(18).text('Clear Logistics & Freight Services', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(13).text('AI Freight Quote Assistant', { align: 'left' });
    doc.moveDown(0.7);

    doc.fontSize(10).text(`Quote Reference: ${assistantQuoteId}`);
    doc.text(`Customer: ${customerName || 'N/A'}`);
    doc.text(`Route: ${origin} -> ${destination}`);
    doc.text(`Cargo Type: ${cargoType}`);
    doc.text(`Estimate Confidence: ${confidence}%`);
    doc.moveDown(0.6);

    doc.fontSize(12).text('Estimate');
    doc.fontSize(10).text(estimateLabel);
    doc.moveDown(0.6);

    doc.fontSize(12).text('Required Paperwork');
    paperwork.forEach((item) => doc.fontSize(10).text(`• ${item}`));
    doc.moveDown(0.5);

    doc.fontSize(12).text('Customs Checklist');
    checklist.forEach((item) => doc.fontSize(10).text(`• ${item}`));
    doc.moveDown(0.5);

    doc.fontSize(12).text('Pricing Assumptions');
    assumptions.forEach((item) => doc.fontSize(10).text(`• ${item}`));
    doc.moveDown(0.8);

    doc.fontSize(9).fillColor('#555555').text(
      'Disclaimer: This document is an estimate only and does not represent a final invoice. Final charges are confirmed after cargo intake, inspection, and route validation.',
      { align: 'left' }
    );

    doc.end();
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneForMatching(value) {
  return String(value || '').replace(/\D/g, '');
}

function hashToken(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function claimGuestRecordsForAccount(data, account) {
  const claimed = { quotes: 0, aiQuotePacks: 0, purchaseRequests: 0 };
  if (!data || !account || typeof account !== 'object') {
    return { changed: false, claimed };
  }

  const accountId = String(account.id || '').trim();
  const accountEmail = normalizeEmail(account.email);
  const accountPhoneDigits = normalizePhoneForMatching(account.phone);
  const hasPhoneMatch = accountPhoneDigits.length >= 7;
  if (!accountId || (!accountEmail && !hasPhoneMatch)) {
    return { changed: false, claimed };
  }

  const matchesIdentity = (recordEmail, recordPhone) => {
    const emailMatch = accountEmail && normalizeEmail(recordEmail) === accountEmail;
    const phoneMatch = hasPhoneMatch && normalizePhoneForMatching(recordPhone) === accountPhoneDigits;
    return Boolean(emailMatch || phoneMatch);
  };

  let changed = false;
  const claimRecords = (records, key) => {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      if (String(record.userId || '').trim()) continue;
      if (!matchesIdentity(record.email, record.phone)) continue;

      record.userId = accountId;
      record.accountEmail = accountEmail || normalizeEmail(record.email || '');
      claimed[key] += 1;
      changed = true;

      if (!String(account.phone || '').trim() && String(record.phone || '').trim()) {
        account.phone = String(record.phone).trim();
        changed = true;
      }
    }
  };

  claimRecords(data.quotes, 'quotes');
  claimRecords(data.aiQuotePacks, 'aiQuotePacks');
  claimRecords(data.purchaseRequests, 'purchaseRequests');

  return { changed, claimed };
}

function hashPasswordResetToken(token) {
  return hashToken(token);
}

function hashEmailVerificationToken(token) {
  return hashToken(token);
}

function buildVerificationCustomerEmail({ fullName, email, verificationToken, expiresAtIso, req }) {
  const recipientName = String(fullName || 'there').trim();
  const frontendBase = getFrontendBaseUrl(req);
  const verifyLink = `${frontendBase}/login?verify=1&email=${encodeURIComponent(email)}&token=${encodeURIComponent(verificationToken)}`;
  const expiresAt = new Date(expiresAtIso);
  const expiresLabel = Number.isFinite(expiresAt.getTime()) ? expiresAt.toUTCString() : 'soon';

  const subject = 'Verify your email to activate your Clear Logistics account';
  const text = [
    `Hi ${recipientName},`,
    '',
    'Please verify your email to activate your Clear Logistics account.',
    'Click the verification link below:',
    `Verify now: ${verifyLink}`,
    '',
    'If the button/link does not open, copy and paste this full URL into your browser:',
    verifyLink,
    '',
    `Verification token: ${verificationToken}`,
    `This verification link expires at: ${expiresLabel}`,
    '',
    'After you verify, we will send your full welcome email automatically.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:20px;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dde4ee;border-radius:10px;overflow:hidden;">
        <div style="background:linear-gradient(120deg,#0e7a5f 0%, #0b5f90 100%);color:#ffffff;padding:18px 22px;">
          <h2 style="margin:0;font-size:22px;">Verify Your Email</h2>
          <p style="margin:6px 0 0 0;font-size:13px;opacity:0.95;">One quick step to activate your account</p>
        </div>
        <div style="padding:18px 22px;color:#1d2939;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(recipientName)},</p>
          <p style="margin:0 0 12px 0;">Please verify your email to activate secure login and shipment updates.</p>
          <p style="margin:0 0 14px 0;">
            <a href="${escapeHtml(verifyLink)}" style="display:inline-block;background:#0e7a5f;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">
              Verify My Email
            </a>
          </p>
          <p style="margin:0 0 6px 0;"><strong>Fallback link (copy/paste):</strong></p>
          <p style="margin:0 0 12px 0;word-break:break-all;">
            <a href="${escapeHtml(verifyLink)}" style="color:#0b5f90;text-decoration:underline;">${escapeHtml(verifyLink)}</a>
          </p>
          <p style="margin:0 0 8px 0;"><strong>Verification token:</strong> ${escapeHtml(verificationToken)}</p>
          <p style="margin:0 0 12px 0;"><strong>Expires:</strong> ${escapeHtml(expiresLabel)}</p>
          <p style="margin:0;">After verification, we will immediately send your full welcome email.</p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function buildWelcomeCustomerEmail({ fullName }) {
  const recipientName = String(fullName || 'there').trim();
  const subject = 'Welcome to Clear Logistics';
  const text = [
    `Hi ${recipientName},`,
    '',
    'Welcome to Clear Logistics & Freight Services. Your account is now fully active.',
    '',
    'What you can do now:',
    '- Book pickups and checkout online',
    '- Track shipments in real time',
    '- Manage your dashboard and support requests',
    '',
    'Need help? Reply to this email and our team will assist you right away.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:20px;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dde4ee;border-radius:10px;overflow:hidden;">
        <div style="background:linear-gradient(120deg,#0e7a5f 0%, #0b5f90 100%);color:#ffffff;padding:18px 22px;">
          <h2 style="margin:0;font-size:22px;">Welcome to Clear Logistics</h2>
          <p style="margin:6px 0 0 0;font-size:13px;opacity:0.95;">Your account is active and ready</p>
        </div>
        <div style="padding:18px 22px;color:#1d2939;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(recipientName)},</p>
          <p style="margin:0 0 12px 0;">Thanks for verifying your email. Your account is now fully active.</p>
          <p style="margin:0 0 8px 0;"><strong>What you can do now:</strong></p>
          <ul style="margin:0 0 10px 18px;padding:0;">
            <li>Book pickups and checkout online</li>
            <li>Track shipments in real time</li>
            <li>Manage your dashboard and support requests</li>
          </ul>
          <p style="margin:0;">Need help? Reply to this email and our team will assist you right away.</p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function issueEmailVerificationToken(account) {
  const verificationToken = randomBytes(24).toString('hex');
  const expiresAtIso = new Date(Date.now() + emailVerificationTokenTtlMinutes * 60 * 1000).toISOString();
  account.emailVerificationTokenHash = hashEmailVerificationToken(verificationToken);
  account.emailVerificationRequestedAt = new Date().toISOString();
  account.emailVerificationExpiresAt = expiresAtIso;
  return { verificationToken, expiresAtIso };
}

function buildPasswordResetCustomerEmail({ fullName, email, resetToken, expiresAtIso, req }) {
  const recipientName = String(fullName || 'there').trim();
  const frontendBase = getFrontendBaseUrl(req);
  const resetLink = `${frontendBase}/login?reset=1&email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`;
  const expiresAt = new Date(expiresAtIso);
  const expiresLabel = Number.isFinite(expiresAt.getTime()) ? expiresAt.toUTCString() : 'soon';

  const subject = 'Reset your Clear Logistics password';
  const text = [
    `Hi ${recipientName},`,
    '',
    'We received a request to reset your Clear Logistics account password.',
    `Reset link: ${resetLink}`,
    `Reset token: ${resetToken}`,
    `This token expires at: ${expiresLabel}`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:20px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dde4ee;border-radius:10px;overflow:hidden;">
        <div style="background:#0e7a5f;color:#ffffff;padding:16px 20px;">
          <h2 style="margin:0;font-size:20px;">Reset Your Password</h2>
        </div>
        <div style="padding:18px 20px;color:#1d2939;font-size:14px;line-height:1.5;">
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(recipientName)},</p>
          <p style="margin:0 0 12px 0;">We received a request to reset your Clear Logistics account password.</p>
          <p style="margin:0 0 12px 0;">
            <a href="${escapeHtml(resetLink)}" style="display:inline-block;background:#0e7a5f;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">
              Open Reset Form
            </a>
          </p>
          <p style="margin:0 0 8px 0;"><strong>Reset token:</strong> ${escapeHtml(resetToken)}</p>
          <p style="margin:0 0 12px 0;"><strong>Expires:</strong> ${escapeHtml(expiresLabel)}</p>
          <p style="margin:0;">If you did not request this, you can ignore this email.</p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function toMillis(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : null;
}

function toDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickupDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('T')) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? toDateKey(parsed) : raw.slice(0, 10);
  }
  return raw.slice(0, 10);
}

function isQuoteAlreadyBooked(quote, data) {
  const quoteId = String(quote?.quoteId || '').trim();
  const quoteCreatedAtMs = toMillis(quote?.createdAt);
  const quoteEmail = normalizeEmail(quote?.email);

  return (data.bookings || []).some((booking) => {
    const bookingQuoteId = String(booking?.quoteId || '').trim();
    const bookingEmail = normalizeEmail(booking?.email);
    const bookingCreatedAtMs = toMillis(booking?.createdAt);

    if (quoteId && bookingQuoteId && bookingQuoteId === quoteId) {
      return true;
    }

    if (!quoteEmail || !bookingEmail || quoteEmail !== bookingEmail) {
      return false;
    }

    if (quoteCreatedAtMs === null || bookingCreatedAtMs === null) {
      return true;
    }

    return bookingCreatedAtMs >= quoteCreatedAtMs;
  });
}

function buildQuoteNudgeContent(quote, stepIndex) {
  const recipientName = String(quote?.fullName || 'there').trim();
  const quoteId = String(quote?.quoteId || 'your quote').trim();
  const deliveryParish = String(quote?.deliveryParish || 'Jamaica').trim();
  const cargoType = String(quote?.cargoType || 'shipment').trim();
  const baseSubject = [
    `Still planning your shipment? (${quoteId})`,
    `Friendly reminder: your quote is ready (${quoteId})`,
    `Final reminder: reserve your shipment spot (${quoteId})`,
  ][stepIndex] || `Quote follow-up (${quoteId})`;

  const pricingLine = quote?.pricingMode === 'weight-based'
    ? `Current quoted price: $${Number(quote?.quotedPriceUsd || 0).toFixed(2)} USD.`
    : quote?.estimatedRangeUsd
      ? `Estimated range: $${Number(quote.estimatedRangeUsd.low || 0).toFixed(2)} - $${Number(quote.estimatedRangeUsd.high || 0).toFixed(2)} USD.`
      : 'Your pricing estimate is ready in the portal.';

  const bookingUrl = `${frontendUrl}/booking`;
  const unsubscribeUrl = `${getPublicApiBase()}/api/quotes/${encodeURIComponent(quoteId)}/nudges/unsubscribe?email=${encodeURIComponent(String(quote?.email || ''))}`;

  const text = [
    `Hi ${recipientName},`,
    '',
    `This is a quick follow-up on quote ${quoteId} for your ${cargoType} shipment to ${deliveryParish}.`,
    pricingLine,
    '',
    `Book now: ${bookingUrl}`,
    `Need help first? Reply to this email and our team will assist you.`,
    '',
    `To stop follow-up reminders for this quote, use: ${unsubscribeUrl}`,
    '',
    'Clear Logistics & Freight Services',
  ].join('\n');

  return {
    subject: baseSubject,
    text,
  };
}

function getDueQuoteNudgeStep(quote, nowMs) {
  const createdAtMs = toMillis(quote?.createdAt);
  if (createdAtMs === null) {
    return null;
  }

  if (quote?.nudgesOptOutAt) {
    return null;
  }

  const sent = Array.isArray(quote?.nudgesSent)
    ? quote.nudgesSent.filter((item) => Number.isInteger(item?.stepIndex))
    : [];
  const sentSteps = new Set(sent.map((item) => item.stepIndex));

  for (let i = 0; i < quoteNudgeStepsMs.length; i += 1) {
    if (sentSteps.has(i)) {
      continue;
    }
    const thresholdMs = quoteNudgeStepsMs[i];
    if (nowMs - createdAtMs >= thresholdMs) {
      return i;
    }
    break;
  }

  return null;
}

async function runQuoteNudgesTick() {
  if (!nudgeEmailsEnabled || quoteNudgeTickInProgress || !quoteNudgeStepsMs.length) {
    return;
  }

  quoteNudgeTickInProgress = true;
  try {
    const data = await readData();
    const nowMs = Date.now();
    let changed = false;

    for (const quote of data.quotes) {
      if (!quote || !quote.quoteId) {
        continue;
      }

      if (isQuoteAlreadyBooked(quote, data)) {
        if (!quote.nudgesStoppedReason) {
          quote.nudgesStoppedReason = 'booked';
          quote.nudgesStoppedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }

      const stepIndex = getDueQuoteNudgeStep(quote, nowMs);
      if (stepIndex === null) {
        continue;
      }

      const destination = String(quote.email || '').trim();
      if (!destination) {
        continue;
      }

      const content = buildQuoteNudgeContent(quote, stepIndex);
      const result = await sendEmail({
        to: destination,
        subject: content.subject,
        text: content.text,
        mockTag: 'quote-nudge',
      });

      if (result.delivered) {
        if (!Array.isArray(quote.nudgesSent)) {
          quote.nudgesSent = [];
        }
        quote.nudgesSent.push({
          stepIndex,
          sentAt: new Date().toISOString(),
          subject: content.subject,
        });
        quote.lastNudgedAt = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      await writeData(data);
    }
  } catch (error) {
    console.error('[quote-nudges:error]', error?.message || error);
  } finally {
    quoteNudgeTickInProgress = false;
  }
}

function startQuoteNudgeWorker() {
  if (!nudgeEmailsEnabled || !quoteNudgeStepsMs.length || quoteNudgeWorkerTimer) {
    return;
  }

  runQuoteNudgesTick().catch((error) => {
    console.error('[quote-nudges:start-error]', error?.message || error);
  });

  quoteNudgeWorkerTimer = setInterval(() => {
    runQuoteNudgesTick().catch((error) => {
      console.error('[quote-nudges:interval-error]', error?.message || error);
    });
  }, quoteNudgeIntervalMs);

  if (typeof quoteNudgeWorkerTimer.unref === 'function') {
    quoteNudgeWorkerTimer.unref();
  }

  console.log(`[quote-nudges] enabled with ${quoteNudgeStepsMs.length} steps, interval ${quoteNudgeIntervalMs}ms`);
}

async function runScanAlertsTick() {
  if (!scanAlertsEnabled || scanAlertTickInProgress) {
    return;
  }

  scanAlertTickInProgress = true;
  try {
    const now = new Date();
    if (now.getHours() < scanNoScanCutoffHour) {
      return;
    }

    const data = await readData();
    if (!Array.isArray(data.bookings)) data.bookings = [];
    if (!Array.isArray(data.scanEvents)) data.scanEvents = [];

    const todayKey = toDateKey(now);
    const scannedToday = new Set(
      data.scanEvents
        .filter((event) => toDateKey(event?.createdAt) === todayKey)
        .map((event) => String(event.shipmentId || '').trim())
        .filter(Boolean)
    );

    let changed = false;
    for (const booking of data.bookings) {
      if (!booking || booking.pickedUp) continue;
      const shipmentId = String(booking.shipmentId || '').trim();
      if (!shipmentId) continue;
      if (pickupDateKey(booking.pickupDate) !== todayKey) continue;
      if (scannedToday.has(shipmentId)) continue;
      if (booking.noScanAlertDate === todayKey) continue;

      await sendNotification(
        'Scan Exception: No Scan by Cutoff',
        `Shipment ${shipmentId} (${booking.fullName || 'unknown customer'}) has pickup date ${todayKey} but no scan event by ${scanNoScanCutoffHour}:00.`
      );

      booking.noScanAlertDate = todayKey;
      changed = true;
    }

    if (changed) {
      await writeData(data);
    }
  } catch (error) {
    console.error('[scan-alerts:error]', error?.message || error);
  } finally {
    scanAlertTickInProgress = false;
  }
}

function startScanAlertWorker() {
  if (!scanAlertsEnabled || scanAlertWorkerTimer) {
    if (!scanAlertsEnabled) {
      console.log('[scan-alerts] disabled outside production or via SCAN_ALERTS_ENABLED=false');
    }
    return;
  }

  runScanAlertsTick().catch((error) => {
    console.error('[scan-alerts:start-error]', error?.message || error);
  });

  scanAlertWorkerTimer = setInterval(() => {
    runScanAlertsTick().catch((error) => {
      console.error('[scan-alerts:interval-error]', error?.message || error);
    });
  }, scanAlertIntervalMs);

  if (typeof scanAlertWorkerTimer.unref === 'function') {
    scanAlertWorkerTimer.unref();
  }

  console.log(`[scan-alerts] enabled, interval ${scanAlertIntervalMs}ms, repeat window ${scanRepeatWindowMs}ms, threshold ${scanRepeatThreshold}, cutoff hour ${scanNoScanCutoffHour}`);
}

async function notifyCustomer({ channel, to, message, metadata = {} }) {
  const normalizedChannel = String(channel || '').toLowerCase();
  const destination = String(to || '').trim();
  if (!destination || !message) {
    return { delivered: false, reason: 'missing-destination-or-message' };
  }

  if (normalizedChannel === 'whatsapp') {
    const twilioAccountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const twilioAuthToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const twilioFromRaw = String(process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();
    if (twilioAccountSid && twilioAuthToken && twilioFromRaw) {
      const normalizeWhatsAppAddress = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^whatsapp:/i.test(raw)) return raw;
        const digits = raw.replace(/[^\d+]/g, '');
        return digits ? `whatsapp:${digits}` : '';
      };

      const twilioTo = normalizeWhatsAppAddress(destination);
      const twilioFrom = normalizeWhatsAppAddress(twilioFromRaw);
      if (!twilioTo || !twilioFrom) {
        return { delivered: false, mode: 'twilio', reason: 'invalid-whatsapp-address' };
      }

      try {
        const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
        const form = new URLSearchParams();
        form.set('To', twilioTo);
        form.set('From', twilioFrom);
        form.set('Body', String(message));

        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const details = payload?.message || `Twilio status ${response.status}`;
          throw new Error(details);
        }

        return {
          delivered: true,
          mode: 'twilio',
          messageSid: String(payload?.sid || ''),
          providerStatus: String(payload?.status || ''),
        };
      } catch (error) {
        console.log('[customer-notification:whatsapp:twilio:error]', error.message);
        return { delivered: false, mode: 'twilio', error: error.message };
      }
    }
  }

  const webhookUrl = normalizedChannel === 'whatsapp'
    ? process.env.NOTIFY_WHATSAPP_WEBHOOK_URL
    : normalizedChannel === 'sms'
      ? process.env.NOTIFY_SMS_WEBHOOK_URL
      : '';

  if (!webhookUrl) {
    console.log(`[customer-notification:${normalizedChannel}:mock]`, { to: destination, message, metadata });
    return { delivered: false, mode: 'mock' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: normalizedChannel, to: destination, message, metadata }),
    });

    if (!response.ok) {
      throw new Error(`Webhook status ${response.status}`);
    }

    return { delivered: true, mode: 'webhook' };
  } catch (error) {
    console.log(`[customer-notification:${normalizedChannel}:error]`, error.message);
    return { delivered: false, mode: 'webhook', error: error.message };
  }
}

function normalizeRiskLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

function normalizeAlertChannel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'sms') return 'sms';
  if (normalized === 'email') return 'email';
  return 'whatsapp';
}

function statusToMilestoneLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'order received') return 'Order Received';
  if (normalized === 'pickup scheduled') return 'Pickup Scheduled';
  if (normalized === 'picked up') return 'Picked Up';
  if (normalized === 'freight received') return 'Freight Received';
  if (normalized === 'at miami warehouse') return 'Freight Received';
  if (normalized === 'loaded on vessel') return 'Loaded on Vessel';
  if (normalized === 'arrived in kingston') return 'Arrived in Kingston';
  if (normalized === 'customs clearance') return 'Customs Clearance';
  if (normalized === 'out for delivery') return 'Out for Delivery';
  if (normalized === 'delivered') return 'Delivered';
  return '';
}

function applyShipmentStatusProgress(shipment, nextStatus) {
  if (!shipment) return { milestoneLabel: '' };

  shipment.status = String(nextStatus || '').trim() || shipment.status;
  const milestoneLabel = statusToMilestoneLabel(shipment.status);
  if (!milestoneLabel || !Array.isArray(shipment.milestones)) {
    return { milestoneLabel };
  }

  const targetIndex = SHIPMENT_STATUS_MILESTONE_SEQUENCE.indexOf(milestoneLabel);
  if (targetIndex < 0) {
    return { milestoneLabel };
  }

  shipment.milestones = shipment.milestones.map((step) => {
    const currentLabel = String(step?.label || '').trim();
    const currentIndex = SHIPMENT_STATUS_MILESTONE_SEQUENCE.indexOf(currentLabel);
    if (currentIndex < 0) {
      return step;
    }

    return {
      ...step,
      done: currentIndex <= targetIndex,
    };
  });

  return { milestoneLabel };
}

function resolveShipmentContact(booking, shipment) {
  const fullName = String(booking?.fullName || shipment?.fullName || '').trim();
  const email = String(booking?.email || shipment?.email || '').trim();
  const phone = String(booking?.phone || shipment?.phone || '').trim();
  return { fullName, email, phone };
}

function resolveTrackingPhoneChannel(booking, shipment) {
  const trackingPreferences = shipment?.trackingPreferences || booking?.trackingPreferences || null;
  if (!trackingPreferences) {
    return { channel: '', reason: 'tracking-preferences-not-set' };
  }

  const channel = normalizeAlertChannel(trackingPreferences.alertChannel);
  if (channel !== 'whatsapp' && channel !== 'sms') {
    return { channel: '', reason: 'non-phone-channel-selected' };
  }

  return { channel, reason: '' };
}

function buildTrackingPhoneUpdateMessage({ shipmentId, status, milestoneLabel, fullName }) {
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || 'there';
  const cleanStatus = String(status || '').trim();
  const cleanMilestone = String(milestoneLabel || '').trim();
  const statusText = cleanStatus ? `status is now ${cleanStatus}` : 'a new tracking update is available';
  const milestoneText = cleanMilestone ? ` (${cleanMilestone})` : '';
  return `Hi ${firstName}, Clear Logistics update for ${shipmentId}: your shipment ${statusText}${milestoneText}. Reply to this message if you need support.`;
}

async function sendShipmentTrackingPhoneUpdate({ shipmentId, shipment, booking, event, status, milestoneLabel }) {
  if (!shipmentId || !shipment) {
    return { delivered: false, reason: 'shipment-not-available' };
  }

  const { channel, reason } = resolveTrackingPhoneChannel(booking, shipment);
  if (!channel) {
    return { delivered: false, reason };
  }

  const contact = resolveShipmentContact(booking, shipment);
  if (!contact.phone) {
    return { delivered: false, reason: 'missing-customer-phone' };
  }

  const message = buildTrackingPhoneUpdateMessage({
    shipmentId,
    status,
    milestoneLabel,
    fullName: contact.fullName,
  });

  return notifyCustomer({
    channel,
    to: contact.phone,
    message,
    metadata: {
      event: event || 'shipment_tracking_update',
      shipmentId,
      status: String(status || '').trim(),
      milestone: String(milestoneLabel || '').trim(),
    },
  });
}

function canManageShipmentFromUser(user, booking, shipment) {
  if (!user) {
    return false;
  }

  const role = String(user?.role || '').trim().toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userSub = String(user?.sub || '').trim();
  const bookingUserId = String(booking?.userId || '').trim();
  if (userSub && bookingUserId && userSub === bookingUserId) {
    return true;
  }

  const userEmail = normalizeEmail(user?.email || '');
  const bookingEmail = normalizeEmail(booking?.email || '');
  const shipmentEmail = normalizeEmail(shipment?.email || '');
  if (userEmail && (userEmail === bookingEmail || userEmail === shipmentEmail)) {
    return true;
  }

  return false;
}

function normalizePhoneForWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits;
}

function extractInboundWhatsAppMessage(payload) {
  const body = payload || {};

  // Generic webhook payload shape: { from, message, profileName }
  const directFrom = String(body.from || '').trim();
  const directMessage = String(body.message || '').trim();
  if (directFrom) {
    return {
      from: directFrom,
      message: directMessage,
      profileName: String(body.profileName || body.name || '').trim(),
      provider: String(body.provider || 'generic').trim() || 'generic',
    };
  }

  // Twilio WhatsApp webhook payload shape.
  const twilioFrom = String(body.From || '').trim();
  const twilioMessage = String(body.Body || '').trim();
  if (twilioFrom) {
    return {
      from: twilioFrom,
      message: twilioMessage,
      profileName: String(body.ProfileName || '').trim(),
      provider: 'twilio',
    };
  }

  // Meta WhatsApp Cloud API webhook payload shape.
  const changes = body?.entry?.[0]?.changes?.[0]?.value;
  const metaMessage = changes?.messages?.[0] || null;
  const metaContact = changes?.contacts?.[0] || null;
  if (metaMessage?.from) {
    return {
      from: String(metaMessage.from || '').trim(),
      message: String(metaMessage?.text?.body || '').trim(),
      profileName: String(metaContact?.profile?.name || '').trim(),
      provider: 'meta',
    };
  }

  return null;
}

function shouldThrottleWhatsAppAutoReply(destination) {
  const now = Date.now();
  const lastSentAt = Number(whatsappAutoReplyLastSentAt.get(destination) || 0);
  if (lastSentAt && now - lastSentAt < whatsappAutoReplyCooldownMs) {
    return true;
  }
  whatsappAutoReplyLastSentAt.set(destination, now);
  return false;
}

function buildDemoPickup(index) {
  const padded = String(index + 1).padStart(3, '0');
  const shipmentId = `CLF-DRV-${padded}`;
  const pickupDate = new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const customerNames = [
    'Alicia Brown', 'Kevon Morgan', 'Danielle Graham', 'Rashad Campbell',
    'Tameka Stewart', 'Andre Watson', 'Natoya Russell', 'Jaden Ellis',
    'Simone Blake', 'Jordan McKenzie', 'Kerry Fletcher', 'Monique Thompson',
    'Tariq Lewis', 'Sade Williams'
  ];
  const cargoTypes = ['Box', 'Barrel', 'Pallet', 'Household Goods'];
  const cities = ['Miami', 'Fort Lauderdale', 'Orlando', 'Kissimmee', 'Tampa'];
  const neighborhoods = ['NW 7th Ave', 'Brickell Ave', 'Coral Way', 'Sunset Dr', 'Flagler St'];

  const fullName = customerNames[index % customerNames.length];
  const pickupCity = cities[index % cities.length];
  const lane = neighborhoods[index % neighborhoods.length];
  const cargoType = cargoTypes[index % cargoTypes.length];

  return {
    booking: {
      bookingId: `BKG-DRV-${padded}`,
      shipmentId,
      fullName,
      email: `customer${index + 1}@example.com`,
      phone: `+1-305-555-${String(1200 + index).padStart(4, '0')}`,
      pickupAddress: `${420 + index} ${lane}`,
      pickupCity,
      pickupZip: `33${String(100 + index).slice(-3)}`,
      pickupDate,
      cargoType,
      quantity: String((index % 4) + 1),
      weight: String(20 + index * 2),
      jamaicaRecipient: `${fullName} Recipient`,
      jamaicaLocation: index % 2 === 0 ? 'Kingston' : 'Montego Bay',
      serviceLevel: index % 3 === 0 ? 'Premium' : index % 2 === 0 ? 'Standard' : 'Economy',
      paymentStatus: index % 2 === 0 ? 'paid' : 'pending',
      pickedUp: false,
      createdAt: new Date(Date.now() - (index + 2) * 60 * 60 * 1000).toISOString(),
    },
    shipment: {
      shipmentId,
      fullName,
      status: 'Order Received',
      cargoType,
      quantity: String((index % 4) + 1),
      unitType: cargoType,
      milestones: DEFAULT_MILESTONES.map((m) => ({ ...m })),
      paymentStatus: index % 2 === 0 ? 'paid' : 'pending',
      createdAt: new Date(Date.now() - (index + 2) * 60 * 60 * 1000).toISOString(),
    }
  };
}

async function seedDriverDemoData() {
  if (!driverDemoAccountEnabled) {
    return;
  }

  const data = await readData();
  let hasChanges = false;

  if (!Array.isArray(data.drivers)) data.drivers = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const existingDriver = data.drivers.find((d) => String(d.email || '').toLowerCase() === DRIVER_DEMO_EMAIL);
  if (!existingDriver) {
    const passwordHash = await bcrypt.hash(DRIVER_DEMO_PASSWORD, 10);
    data.drivers.push({
      id: 'driver-demo-001',
      fullName: 'Demo Driver',
      email: DRIVER_DEMO_EMAIL,
      password: passwordHash,
      phone: '+1-305-555-0110',
      vehicle: 'Ford Transit 2022',
      role: 'driver',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    hasChanges = true;
  } else {
    // Keep the demo account predictable for QA and product demos.
    const passwordMatches = String(existingDriver.password || '').startsWith('$2')
      ? await bcrypt.compare(DRIVER_DEMO_PASSWORD, existingDriver.password)
      : false;
    if (!passwordMatches) {
      existingDriver.password = await bcrypt.hash(DRIVER_DEMO_PASSWORD, 10);
      hasChanges = true;
    }
    if (String(existingDriver.status || '').toLowerCase() !== 'active') {
      existingDriver.status = 'active';
      hasChanges = true;
    }
    if (existingDriver.role !== 'driver') {
      existingDriver.role = 'driver';
      hasChanges = true;
    }
    if (!existingDriver.fullName) {
      existingDriver.fullName = 'Demo Driver';
      hasChanges = true;
    }
    if (!existingDriver.phone) {
      existingDriver.phone = '+1-305-555-0110';
      hasChanges = true;
    }
    if (!existingDriver.vehicle) {
      existingDriver.vehicle = 'Ford Transit 2022';
      hasChanges = true;
    }
  }

  if (allowDemoSeed || driverDemoPickupsEnabled) {
    for (let i = 0; i < DRIVER_DEMO_TOTAL_PICKUPS; i += 1) {
      const demo = buildDemoPickup(i);
      const bookingExists = data.bookings.some((b) => b.shipmentId === demo.booking.shipmentId);
      if (!bookingExists) {
        demo.booking.assignedDriverId = 'driver-demo-001';
        demo.booking.assignedDriverName = 'Demo Driver';
        demo.booking.assignedAt = new Date().toISOString();
        demo.booking.assignmentMode = 'demo-seed';
        data.bookings.push(demo.booking);
        hasChanges = true;
      }

      const shipmentExists = data.shipments.some((s) => s.shipmentId === demo.shipment.shipmentId);
      if (!shipmentExists) {
        data.shipments.push(demo.shipment);
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    await writeData(data);
    console.log(`[seed] Driver demo account ready: ${DRIVER_DEMO_EMAIL} with ${DRIVER_DEMO_TOTAL_PICKUPS} sample pickups.`);
  }
}

function getActiveDrivers(data) {
  return (data.drivers || []).filter((d) => String(d?.status || 'active').toLowerCase() === 'active');
}

function getPendingAssignmentCount(data, driverId) {
  return (data.bookings || []).filter((b) => !b.pickedUp && b.assignedDriverId === driverId).length;
}

function autoAssignUnassignedBookings(data) {
  const drivers = getActiveDrivers(data);
  if (!drivers.length) {
    return { assignedCount: 0, changed: false };
  }

  const counts = new Map(drivers.map((d) => [d.id, getPendingAssignmentCount(data, d.id)]));
  const unassigned = (data.bookings || [])
    .filter((b) => !b.pickedUp && !b.assignedDriverId)
    .sort((a, b) => {
      const aDate = Number.isFinite(Date.parse(a.pickupDate)) ? Date.parse(a.pickupDate) : Number.MAX_SAFE_INTEGER;
      const bDate = Number.isFinite(Date.parse(b.pickupDate)) ? Date.parse(b.pickupDate) : Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });

  let assignedCount = 0;
  for (const booking of unassigned) {
    const nextDriver = [...drivers].sort((a, b) => {
      const countDelta = (counts.get(a.id) || 0) - (counts.get(b.id) || 0);
      if (countDelta !== 0) return countDelta;
      return String(a.id).localeCompare(String(b.id));
    })[0];

    if (!nextDriver) {
      continue;
    }

    booking.assignedDriverId = nextDriver.id;
    booking.assignedDriverName = nextDriver.fullName;
    booking.assignedAt = new Date().toISOString();
    booking.assignmentMode = 'auto';
    counts.set(nextDriver.id, (counts.get(nextDriver.id) || 0) + 1);
    assignedCount += 1;
  }

  return { assignedCount, changed: assignedCount > 0 };
}

function startOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(0, 0, 0, 0);
  return d;
}

function findActiveRouteForDriver(data, driverId) {
  if (!Array.isArray(data.routes)) {
    return null;
  }
  return data.routes.find((route) => route.driverId === driverId && route.status === 'active') || null;
}

function routeProgress(route) {
  const total = Array.isArray(route?.stops) ? route.stops.length : 0;
  const completed = Array.isArray(route?.stops)
    ? route.stops.filter((s) => s.status === 'completed').length
    : 0;
  return {
    total,
    completed,
    pending: Math.max(0, total - completed),
  };
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'clear-logistics-api',
    message: 'API is running. Use /api/health for health checks.',
    healthUrl: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', async (_req, res) => {
  const email = await getEmailHealthSnapshot();
  res.json({
    ok: true,
    stripe: Boolean(stripe),
    stripePaymentMethodTypes,
    dataStorage: {
      fileConfigured: Boolean(dataFile),
      likelyEphemeral: isLikelyEphemeralDataPath(dataFile),
      requirePersistentDataPath,
    },
    email,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/whatsapp/inbound', async (req, res) => {
  if (!whatsappAutoReplyEnabled) {
    return res.status(200).json({ ok: true, autoReplyEnabled: false, replied: false });
  }

  if (whatsappInboundToken) {
    const provided = String(req.headers['x-whatsapp-inbound-token'] || '').trim();
    if (!provided || provided !== whatsappInboundToken) {
      return res.status(401).json({ error: 'Unauthorized webhook token.' });
    }
  }

  const inbound = extractInboundWhatsAppMessage(req.body || {});
  if (!inbound?.from) {
    return res.status(200).json({ ok: true, replied: false, reason: 'missing-sender' });
  }

  const destination = normalizePhoneForWhatsApp(inbound.from);
  if (!destination) {
    return res.status(200).json({ ok: true, replied: false, reason: 'invalid-sender' });
  }

  const ownSender = normalizePhoneForWhatsApp(process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || '');
  if (ownSender && destination === ownSender) {
    return res.status(200).json({ ok: true, replied: false, reason: 'self-message-ignored' });
  }

  if (shouldThrottleWhatsAppAutoReply(destination)) {
    return res.status(200).json({ ok: true, replied: false, reason: 'cooldown-active' });
  }

  const firstName = String(inbound.profileName || '').trim().split(/\s+/).filter(Boolean)[0] || 'there';
  const replyMessage = whatsappAutoReplyMessage.replace(/\{\{\s*name\s*\}\}/gi, firstName);
  const result = await notifyCustomer({
    channel: 'whatsapp',
    to: destination,
    message: replyMessage,
    metadata: {
      source: 'whatsapp-auto-reply',
      provider: inbound.provider || 'unknown',
      inboundPreview: String(inbound.message || '').slice(0, 180),
    },
  });

  return res.status(200).json({
    ok: true,
    replied: Boolean(result?.delivered),
    mode: result?.mode || 'unknown',
    reason: result?.reason || result?.error || '',
    providerStatus: result?.providerStatus || '',
    messageSid: result?.messageSid || '',
  });
});

app.post('/api/accounts', async (req, res) => {
  const { fullName, email, password, phone } = req.body || {};
  const normalizedFullName = String(fullName || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '');
  const normalizedPhone = String(phone || '').trim();

  if (!normalizedFullName || !normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ error: 'fullName, email, and password are required.' });
  }

  const data = await readData();
  const existing = data.accounts.find((a) => normalizeEmail(a?.email) === normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'Account already exists for this email.' });
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 10);

  const account = {
    id: randomUUID(),
    fullName: normalizedFullName,
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash,
    emailVerificationRequired: true,
    emailVerifiedAt: '',
    emailVerificationTokenHash: '',
    emailVerificationRequestedAt: '',
    emailVerificationExpiresAt: '',
    customerReference: '',
    usReceivingAddress: '',
    createdAt: new Date().toISOString()
  };

  const { verificationToken, expiresAtIso } = issueEmailVerificationToken(account);
  ensureCustomerShippingProfile(account);

  data.accounts.push(account);
  const claimResult = claimGuestRecordsForAccount(data, account);
  await writeData(data);
  await sendNotification('New Portal Account', `New account: ${normalizedFullName} <${normalizedEmail}>`);

  const verificationEmail = buildVerificationCustomerEmail({
    fullName: account.fullName,
    email: account.email,
    verificationToken,
    expiresAtIso,
    req,
  });

  const verificationEmailStatus = await sendEmail({
    to: account.email,
    subject: verificationEmail.subject,
    text: verificationEmail.text,
    html: verificationEmail.html,
    mockTag: 'email-verification',
  });

  res.status(201).json({
    account: sanitizeAccount(account),
    linkedRecords: claimResult.claimed,
    emailVerification: {
      required: true,
      delivered: Boolean(verificationEmailStatus?.delivered),
      mode: verificationEmailStatus?.mode || null,
    },
    message: 'Account created. Please verify your email using the link we sent.',
  });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((a) => normalizeEmail(a?.email) === normalizedEmail);
  const account = accountIndex >= 0 ? data.accounts[accountIndex] : null;
  if (!account) {
    return res.status(404).json({
      error: 'No account found for this email. Create an account or reset your password.',
      code: 'ACCOUNT_NOT_FOUND',
    });
  }

  const storedHash = account.passwordHash || account.password || '';
  let passwordOk = false;
  if (storedHash && storedHash.startsWith('$2')) {
    passwordOk = await bcrypt.compare(password, storedHash);
  } else if (storedHash) {
    // Backward-compatible login for earlier plain-text records, then migrate to hash.
    passwordOk = storedHash === password;
    if (passwordOk) {
      data.accounts[accountIndex].passwordHash = await bcrypt.hash(password, 10);
      delete data.accounts[accountIndex].password;
      await writeData(data);
    }
  }

  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const verificationRequired = Boolean(account.emailVerificationRequired);
  const isVerified = Boolean(String(account.emailVerifiedAt || '').trim());
  if (verificationRequired && !isVerified) {
    return res.status(403).json({
      error: 'Please verify your email before logging in. Check your inbox or request a new verification email.',
      code: 'EMAIL_NOT_VERIFIED',
      email: account.email,
    });
  }

  let accountForToken = account;
  let accountChanged = false;
  if (ensureCustomerShippingProfile(data.accounts[accountIndex])) {
    accountChanged = true;
  }
  const claimResult = claimGuestRecordsForAccount(data, data.accounts[accountIndex]);
  if (claimResult.changed) {
    accountChanged = true;
  }

  if (accountChanged) {
    await writeData(data);
    accountForToken = data.accounts[accountIndex];
  }

  const token = createAuthToken(accountForToken);
  res.json({ user: sanitizeAccount(accountForToken), token, linkedRecords: claimResult.claimed });
});

app.post('/api/email/verify', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const token = String(req.body?.token || '').trim();

  if (!email || !token) {
    return res.status(400).json({ error: 'email and token are required.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex < 0) {
    return res.status(400).json({ error: 'Invalid or expired verification token.' });
  }

  const account = data.accounts[accountIndex];
  if (!account.emailVerificationRequired || String(account.emailVerifiedAt || '').trim()) {
    return res.json({
      ok: true,
      alreadyVerified: true,
      message: 'Email already verified. You can log in now.',
    });
  }

  const expiresAtMs = Date.parse(String(account?.emailVerificationExpiresAt || ''));
  const savedTokenHash = String(account?.emailVerificationTokenHash || '');
  const providedTokenHash = hashEmailVerificationToken(token);
  const tokenExpired = !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs;

  if (!savedTokenHash || tokenExpired || savedTokenHash !== providedTokenHash) {
    return res.status(400).json({ error: 'Invalid or expired verification token.' });
  }

  account.emailVerifiedAt = new Date().toISOString();
  delete account.emailVerificationTokenHash;
  delete account.emailVerificationRequestedAt;
  delete account.emailVerificationExpiresAt;

  await writeData(data);

  const welcomeEmail = buildWelcomeCustomerEmail({
    fullName: account.fullName,
  });

  let welcomeEmailStatus = null;
  try {
    welcomeEmailStatus = await sendEmail({
      to: account.email,
      subject: welcomeEmail.subject,
      text: welcomeEmail.text,
      html: welcomeEmail.html,
      mockTag: 'welcome-post-verification',
    });
  } catch (error) {
    console.error('Post-verification welcome email failed:', error?.message || error);
  }

  await sendNotification('Customer Email Verified', `Customer ${email} verified account email.`);

  return res.json({
    ok: true,
    welcomeEmail: {
      delivered: Boolean(welcomeEmailStatus?.delivered),
      mode: welcomeEmailStatus?.mode || null,
    },
    message: 'Email verified successfully. Your welcome email has been sent, and you can now log in.',
  });
});

app.post('/api/email/verify/resend', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: 'email is required.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex >= 0) {
    const account = data.accounts[accountIndex];
    if (account.emailVerificationRequired && !String(account.emailVerifiedAt || '').trim()) {
      const { verificationToken, expiresAtIso } = issueEmailVerificationToken(account);
      await writeData(data);

      const verificationEmail = buildVerificationCustomerEmail({
        fullName: account.fullName,
        email: account.email,
        verificationToken,
        expiresAtIso,
        req,
      });

      await sendEmail({
        to: account.email,
        subject: verificationEmail.subject,
        text: verificationEmail.text,
        html: verificationEmail.html,
        mockTag: 'email-verification-resend',
      });
    }
  }

  return res.json({
    ok: true,
    message: 'If your account needs verification, we sent a fresh verification email.',
  });
});

app.post('/api/password/forgot', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: 'email is required.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex >= 0) {
    const resetToken = randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + passwordResetTokenTtlMinutes * 60 * 1000).toISOString();
    const account = data.accounts[accountIndex];

    account.passwordResetTokenHash = hashPasswordResetToken(resetToken);
    account.passwordResetRequestedAt = new Date().toISOString();
    account.passwordResetExpiresAt = expiresAtIso;

    await writeData(data);

    const resetEmail = buildPasswordResetCustomerEmail({
      fullName: account.fullName,
      email,
      resetToken,
      expiresAtIso,
      req,
    });

    await sendEmail({
      to: account.email,
      subject: resetEmail.subject,
      text: resetEmail.text,
      html: resetEmail.html,
      mockTag: 'password-reset',
    });
  }

  res.json({
    ok: true,
    message: 'If an account exists for this email, reset instructions have been sent.',
  });
});

app.post('/api/password/reset', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const token = String(req.body?.token || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: 'email, token, and newPassword are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex < 0) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' });
  }

  const account = data.accounts[accountIndex];
  const expiresAtMs = Date.parse(String(account?.passwordResetExpiresAt || ''));
  const savedTokenHash = String(account?.passwordResetTokenHash || '');
  const providedTokenHash = hashPasswordResetToken(token);
  const tokenExpired = !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs;

  if (!savedTokenHash || tokenExpired || savedTokenHash !== providedTokenHash) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' });
  }

  account.passwordHash = await bcrypt.hash(newPassword, 10);
  delete account.password;
  delete account.passwordResetTokenHash;
  delete account.passwordResetRequestedAt;
  delete account.passwordResetExpiresAt;

  await writeData(data);
  await sendNotification('Customer Password Reset Completed', `Customer ${email} completed password reset.`);

  res.json({ ok: true, message: 'Password has been reset. You can now log in.' });
});

app.get('/api/admin/overview', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.quotes)) data.quotes = [];
  if (!Array.isArray(data.aiQuotePacks)) data.aiQuotePacks = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.purchaseRequests)) data.purchaseRequests = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const visibleQuotes = filterDemoRecordsForEmail(data.quotes, req.user.email);
  const visibleAiQuotePacks = filterDemoRecordsForEmail(data.aiQuotePacks, req.user.email);
  const visibleBookings = filterDemoRecordsForEmail(data.bookings, req.user.email);
  const visiblePurchaseRequests = filterDemoRecordsForEmail(data.purchaseRequests, req.user.email);
  const visibleSupportTickets = filterDemoRecordsForEmail(data.supportTickets, req.user.email);
  const visibleScanEvents = filterDemoRecordsForEmail(data.scanEvents, req.user.email);
  const visibleShipments = filterDemoRecordsForEmail(data.shipments, req.user.email);
  const bookingByShipmentId = visibleBookings.reduce((acc, booking) => {
    const shipmentId = String(booking?.shipmentId || '').trim();
    if (!shipmentId) return acc;
    acc[shipmentId] = booking;
    return acc;
  }, {});

  const visibleShipmentsEnriched = visibleShipments.map((shipment) => {
    const shipmentId = String(shipment?.shipmentId || '').trim();
    const booking = bookingByShipmentId[shipmentId] || null;
    return {
      ...shipment,
      fullName: shipment?.fullName || booking?.fullName || '',
      email: shipment?.email || booking?.email || '',
      phone: shipment?.phone || booking?.phone || '',
      pickupDate: shipment?.pickupDate || booking?.pickupDate || '',
      pickupCity: shipment?.pickupCity || booking?.pickupCity || '',
      createdAt: shipment?.createdAt || booking?.createdAt || '',
    };
  });

  const sortByCreated = (items) => [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    counts: {
      rfqs: visibleQuotes.length,
      aiQuotePacks: visibleAiQuotePacks.length,
      bookings: visibleBookings.length,
      purchaseRequests: visiblePurchaseRequests.length,
      supportTickets: visibleSupportTickets.length,
      scanEvents: visibleScanEvents.length,
      shipments: visibleShipments.length,
    },
    rfqs: sortByCreated(visibleQuotes).slice(0, 12),
    aiQuotePacks: sortByCreated(visibleAiQuotePacks).slice(0, 12),
    recentBookings: sortByCreated(visibleBookings).slice(0, 12),
    purchaseRequests: sortByCreated(visiblePurchaseRequests).slice(0, 12),
    supportTickets: sortByCreated(visibleSupportTickets).slice(0, 12),
    recentScans: sortByCreated(visibleScanEvents).slice(0, 12),
    shipments: sortByCreated(visibleShipmentsEnriched),
  });
});

app.post('/api/admin/accounts/password-reset', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const email = normalizeEmail(req.body?.email);
  const newPassword = String(req.body?.newPassword || '');

  if (!email || !newPassword) {
    return res.status(400).json({ error: 'email and newPassword are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex < 0) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  data.accounts[accountIndex].passwordHash = await bcrypt.hash(newPassword, 10);
  delete data.accounts[accountIndex].password;
  await writeData(data);

  await sendNotification('Customer Password Reset', `Admin ${req.user.email} reset password for ${email}.`);

  res.json({ ok: true, email });
});

app.post('/api/admin/accounts/update-name', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const email = normalizeEmail(req.body?.email);
  const fullName = String(req.body?.fullName || '').trim();

  if (!email || !fullName) {
    return res.status(400).json({ error: 'email and fullName are required.' });
  }

  if (fullName.length < 2) {
    return res.status(400).json({ error: 'fullName must be at least 2 characters.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((account) => normalizeEmail(account?.email) === email);
  if (accountIndex < 0) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  data.accounts[accountIndex].fullName = fullName;
  await writeData(data);

  await sendNotification('Customer Name Updated', `Admin ${req.user.email} updated account name for ${email} to ${fullName}.`);

  res.json({ ok: true, email, fullName });
});

app.post('/api/admin/rfqs/:quoteId/review', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const quoteId = String(req.params.quoteId || '').trim();
  const reviewStatus = String(req.body?.reviewStatus || 'Reviewed').trim();
  const note = String(req.body?.note || '').trim();
  const allowedStatuses = new Set(['Reviewed', 'Needs Follow-up', 'Approved', 'Declined']);

  if (!quoteId) {
    return res.status(400).json({ error: 'quoteId is required.' });
  }
  if (!allowedStatuses.has(reviewStatus)) {
    return res.status(400).json({ error: 'Invalid review status.' });
  }

  const data = await readData();
  const quote = (data.quotes || []).find((q) => q.quoteId === quoteId);
  if (!quote) {
    return res.status(404).json({ error: 'RFQ not found.' });
  }

  quote.reviewStatus = reviewStatus;
  quote.reviewedAt = new Date().toISOString();
  quote.reviewedBy = req.user.fullName || req.user.email || 'admin';
  if (note) quote.reviewNote = note;

  await writeData(data);
  return res.json({ ok: true, quoteId, reviewStatus, reviewedAt: quote.reviewedAt });
});

app.post('/api/admin/purchase-requests/:requestId/status', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const requestId = String(req.params.requestId || '').trim();
  const status = String(req.body?.status || '').trim();
  const note = String(req.body?.note || '').trim();
  const allowedStatuses = new Set(['Needs Review', 'Approved', 'Rejected', 'In Procurement', 'Awaiting Customer', 'Received']);

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required.' });
  }
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'Invalid purchase request status.' });
  }

  const data = await readData();
  const request = (data.purchaseRequests || []).find((p) => p.requestId === requestId);
  if (!request) {
    return res.status(404).json({ error: 'Purchase request not found.' });
  }

  request.status = status;
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = req.user.fullName || req.user.email || 'admin';
  if (note) request.reviewNote = note;

  await writeData(data);
  return res.json({ ok: true, requestId, status });
});

app.post('/api/admin/support/:ticketId/status', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const ticketId = String(req.params.ticketId || '').trim();
  const status = String(req.body?.status || '').trim();
  const note = String(req.body?.note || '').trim();
  const allowedStatuses = new Set(['Open', 'In Progress', 'Waiting on Customer', 'Resolved', 'Closed']);

  if (!ticketId) {
    return res.status(400).json({ error: 'ticketId is required.' });
  }
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'Invalid support ticket status.' });
  }

  const data = await readData();
  const ticket = (data.supportTickets || []).find((t) => t.ticketId === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Support ticket not found.' });
  }

  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  ticket.updatedBy = req.user.fullName || req.user.email || 'admin';
  if (note) ticket.resolutionNote = note;

  await writeData(data);
  return res.json({ ok: true, ticketId, status });
});

app.post('/api/admin/bookings/:bookingId/payment', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const bookingId = String(req.params.bookingId || '').trim();
  const paymentStatus = String(req.body?.paymentStatus || '').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'paid', 'refunded', 'waived']);

  if (!bookingId) {
    return res.status(400).json({ error: 'bookingId is required.' });
  }
  if (!allowedStatuses.has(paymentStatus)) {
    return res.status(400).json({ error: 'Invalid payment status.' });
  }

  const data = await readData();
  const booking = (data.bookings || []).find((b) => b.bookingId === bookingId);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  booking.paymentStatus = paymentStatus;
  booking.paymentUpdatedAt = new Date().toISOString();
  booking.paymentUpdatedBy = req.user.fullName || req.user.email || 'admin';

  const shipment = (data.shipments || []).find((s) => s.shipmentId === booking.shipmentId);
  if (shipment) {
    shipment.paymentStatus = paymentStatus;
  }

  await writeData(data);
  return res.json({ ok: true, bookingId, paymentStatus });
});

app.post('/api/quotes', async (req, res) => {
  const payload = req.body || {};
  const authUser = getOptionalAuthUser(req);
  const cargoKey = normalizeCargoKey(payload.cargoType);
  const isBarrelQuote = cargoKey === 'barrel';
  const required = ['fullName', 'email', 'phone', 'cargoType', 'origin', 'destination', 'deliveryParish', 'itemCategory'];
  const missing = required.filter((k) => !payload[k]);

  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const weightUnknown = !isBarrelQuote && Boolean(payload.dontKnowWeight);
  if (!isBarrelQuote && !weightUnknown && !payload.weight) {
    return res.status(400).json({ error: 'weight is required unless dontKnowWeight is true.' });
  }

  if (isBarrelQuote) {
    const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
    payload.quantity = String(quantity);
    payload.dontKnowWeight = false;
    payload.weight = '';
  }

  if (weightUnknown) {
    const estimateRequired = ['quantity', 'dimensionsLength', 'dimensionsWidth', 'dimensionsHeight'];
    const estimateMissing = estimateRequired.filter((k) => !payload[k]);
    if (estimateMissing.length) {
      return res.status(400).json({ error: `Missing estimated quote fields: ${estimateMissing.join(', ')}` });
    }
  }

  const data = await readData();
  const pricing = calculateHybridQuotePricing(payload, { estimateOnly: weightUnknown });

  const quote = {
    quoteId: `Q-${Date.now()}`,
    ...payload,
    userId: authUser?.sub || null,
    accountEmail: normalizeEmail(authUser?.email || ''),
    pricingMode: pricing.pricingMode,
    estimatedRangeUsd: pricing.estimatedRangeUsd,
    quotedPriceUsd: pricing.quotedPriceUsd,
    spaceTierKey: pricing.spaceTierKey,
    spaceTierLabel: pricing.spaceTierLabel,
    deliveryZone: pricing.deliveryZone,
    pricingBreakdown: pricing.pricingBreakdown,
    nudgesSent: [],
    nudgesOptOutAt: null,
    createdAt: new Date().toISOString()
  };

  data.quotes.push(quote);
  await writeData(data);

  const adminEmail = buildPremiumQuoteAdminEmail(quote);
  const customerEmail = buildPremiumQuoteCustomerEmail(quote);
  const [adminResult, initialCustomerResult] = await Promise.all([
    sendEmail({
      to: process.env.NOTIFY_EMAIL,
      subject: adminEmail.subject,
      text: adminEmail.text,
      html: adminEmail.html,
      mockTag: 'notification',
    }),
    sendEmail({
      to: quote.email,
      subject: customerEmail.subject,
      text: customerEmail.text,
      html: customerEmail.html,
      mockTag: 'quote-customer',
    })
  ]);

  let customerRetryResult = null;
  let customerResult = initialCustomerResult;
  if (!customerResult?.delivered) {
    customerRetryResult = await sendEmail({
      to: quote.email,
      subject: customerEmail.subject,
      text: customerEmail.text,
      html: customerEmail.html,
      mockTag: 'quote-customer-retry',
    });
    if (customerRetryResult?.delivered) {
      customerResult = customerRetryResult;
    }
  }

  let customerPhoneFallback = null;
  if (!customerResult?.delivered) {
    const fallbackText = `Clear Logistics quote ${quote.quoteId} is ready. We could not deliver your email confirmation. Please contact support to confirm your best email address.`;
    customerPhoneFallback = await notifyCustomer({
      channel: 'whatsapp',
      to: quote.phone,
      message: fallbackText,
      metadata: {
        event: 'quote_email_delivery_failed',
        quoteId: quote.quoteId,
      },
    });

    if (!customerPhoneFallback?.delivered) {
      customerPhoneFallback = await notifyCustomer({
        channel: 'sms',
        to: quote.phone,
        message: fallbackText,
        metadata: {
          event: 'quote_email_delivery_failed',
          quoteId: quote.quoteId,
        },
      });
    }

    await sendNotification(
      'Quote Email Delivery Failed',
      `Quote ${quote.quoteId} for ${quote.fullName} (${quote.email}) could not be emailed. Last reason: ${customerResult?.reason || 'unknown'}.`
    );
  }

  quote.emailStatus = {
    admin: normalizeDeliveryStatus(adminResult),
    customer: normalizeDeliveryStatus(customerResult),
    customerRetry: customerRetryResult ? normalizeDeliveryStatus(customerRetryResult) : null,
    customerPhoneFallback: customerPhoneFallback ? {
      delivered: Boolean(customerPhoneFallback?.delivered),
      mode: String(customerPhoneFallback?.mode || 'unknown'),
      reason: String(customerPhoneFallback?.reason || ''),
      providerStatus: String(customerPhoneFallback?.providerStatus || ''),
      messageSid: String(customerPhoneFallback?.messageSid || ''),
      error: String(customerPhoneFallback?.error || ''),
    } : null,
    updatedAt: new Date().toISOString(),
  };
  await writeData(data);

  res.status(201).json({
    quote,
    message: 'Quote request submitted.',
    emailStatus: quote.emailStatus,
  });
});

app.post('/api/ai-freight-assistant', async (req, res) => {
  const payload = req.body || {};
  const authUser = getOptionalAuthUser(req);

  const origin = String(payload.origin || '').trim();
  const destination = String(payload.destination || '').trim();
  const cargoType = resolveAssistantCargoType(payload.itemType || payload.cargoType || 'Box');
  const serviceLevel = String(payload.serviceLevel || 'Standard').trim() || 'Standard';
  const itemCategory = String(payload.itemCategory || payload.itemType || cargoType).trim() || cargoType;
  const deliveryParish = String(payload.deliveryParish || '').trim();
  const declaredValueUsd = Math.max(0, normalizeNumber(payload.declaredValueUsd, 0));
  const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
  const pickupRequirements = String(payload.pickupRequirements || '').trim();
  const deliveryRequirements = String(payload.deliveryRequirements || '').trim();
  const customerName = String(payload.customerName || payload.fullName || '').trim();
  const email = String(payload.email || '').trim();
  const phone = String(payload.phone || '').trim();
  const sendCustomerEmail = payload.sendCustomerEmail !== false;

  const dimensions = extractAssistantDimensions(payload);
  const weightLbs = Math.max(0, normalizeNumber(payload.weight, 0));
  const hasDimensions = dimensions.length > 0 && dimensions.width > 0 && dimensions.height > 0;

  const missingFields = [];
  if (!origin) missingFields.push('origin');
  if (!destination) missingFields.push('destination');
  if (!cargoType) missingFields.push('itemType');
  if (weightLbs <= 0 && !hasDimensions) missingFields.push('weight or dimensions');

  if (missingFields.length) {
    return res.status(400).json({
      error: `Missing required fields: ${missingFields.join(', ')}`,
      missingFields,
    });
  }

  const pricingPayload = {
    cargoType,
    serviceLevel,
    itemCategory,
    deliveryParish,
    declaredValueUsd,
    quantity,
    weight: weightLbs > 0 ? weightLbs : '',
    dimensionsLength: hasDimensions ? dimensions.length : '',
    dimensionsWidth: hasDimensions ? dimensions.width : '',
    dimensionsHeight: hasDimensions ? dimensions.height : '',
  };

  const estimateOnly = weightLbs <= 0;
  const pricing = calculateHybridQuotePricing(pricingPayload, { estimateOnly });
  const estimateLabel = buildAssistantEstimateLabel(pricing);
  const requiredPaperwork = buildAssistantPaperwork({ cargoType, declaredValueUsd, itemCategory, serviceLevel });
  const customsChecklist = buildAssistantCustomsChecklist({ destination, declaredValueUsd, itemCategory });
  const confidence = buildAssistantConfidence({
    weightKnown: weightLbs > 0,
    hasDimensions,
    hasDeclaredValue: declaredValueUsd > 0,
    hasPickupRequirements: Boolean(pickupRequirements),
    hasDeliveryRequirements: Boolean(deliveryRequirements),
  });
  const assumptions = buildAssistantAssumptions({
    pricing,
    quantity,
    weightLbs,
    dimensions,
    deliveryParish,
    serviceLevel,
  });

  if (pickupRequirements) {
    assumptions.push(`Pickup requirements noted: ${pickupRequirements}.`);
  }
  if (deliveryRequirements) {
    assumptions.push(`Delivery requirements noted: ${deliveryRequirements}.`);
  }

  const assistantQuoteId = `AIQ-${Date.now()}`;
  const customerEmail = buildAssistantCustomerEmailDraft({
    customerName,
    assistantQuoteId,
    origin,
    destination,
    estimateLabel,
    requiredPaperwork,
    customsChecklist,
  });

  const emailStatus = {
    customer: {
      delivered: false,
      mode: 'skipped',
      provider: '',
      reason: !sendCustomerEmail
        ? 'send-disabled'
        : (!email ? 'missing-recipient-email' : 'not-attempted'),
      code: '',
      responseCode: null,
      attempts: [],
    },
    updatedAt: new Date().toISOString(),
  };

  if (sendCustomerEmail && email) {
    const emailResult = await sendEmail({
      to: email,
      subject: customerEmail.subject,
      text: customerEmail.body,
      html: buildSimpleHtmlFromText(customerEmail.body),
      mockTag: 'ai-freight-assistant-customer',
    });

    emailStatus.customer = normalizeDeliveryStatus(emailResult);
    emailStatus.updatedAt = new Date().toISOString();
  }

  const pdfBase64 = await buildAssistantQuotePdfBase64({
    assistantQuoteId,
    customerName,
    origin,
    destination,
    cargoType,
    estimateLabel,
    confidence,
    paperwork: requiredPaperwork,
    checklist: customsChecklist,
    assumptions,
  });

  const data = await readData();
  const aiQuotePackRecord = {
    assistantQuoteId,
    userId: authUser?.sub || null,
    accountEmail: normalizeEmail(authUser?.email || ''),
    customerName,
    email,
    phone,
    origin,
    destination,
    deliveryParish,
    cargoType,
    itemCategory,
    serviceLevel,
    quantity,
    weightLbs,
    dimensions,
    declaredValueUsd,
    pickupRequirements,
    deliveryRequirements,
    freightEstimate: {
      pricingMode: pricing.pricingMode,
      quotedPriceUsd: pricing.quotedPriceUsd,
      estimatedRangeUsd: pricing.estimatedRangeUsd,
      confidence,
      label: estimateLabel,
      deliveryZone: pricing.deliveryZone,
      spaceTierLabel: pricing.spaceTierLabel,
    },
    requiredPaperwork,
    customsChecklist,
    assumptions,
    customerEmail,
    emailStatus,
    followUpStatus: 'New',
    source: 'ai-freight-assistant',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  data.aiQuotePacks.push(aiQuotePackRecord);
  await writeData(data);

  return res.status(200).json({
    assistantQuoteId,
    freightEstimate: {
      pricingMode: pricing.pricingMode,
      quotedPriceUsd: pricing.quotedPriceUsd,
      estimatedRangeUsd: pricing.estimatedRangeUsd,
      confidence,
      label: estimateLabel,
      deliveryZone: pricing.deliveryZone,
      spaceTierLabel: pricing.spaceTierLabel,
    },
    requiredPaperwork,
    customsChecklist,
    customerEmail,
    emailStatus,
    assumptions,
    quotePdf: {
      fileName: `${assistantQuoteId}.pdf`,
      mimeType: 'application/pdf',
      base64: pdfBase64,
    },
    intakeSummary: {
      origin,
      destination,
      cargoType,
      quantity,
      weightLbs,
      dimensions,
      declaredValueUsd,
      serviceLevel,
      itemCategory,
      pickupRequirements,
      deliveryRequirements,
      contact: {
        customerName,
        email,
        phone,
      },
    },
    nextStep: {
      label: 'Continue to booking',
      path: '/book-pickup',
    },
  });
});

app.post('/api/admin/ai-quote-packs/:assistantQuoteId/follow-up', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const assistantQuoteId = String(req.params.assistantQuoteId || '').trim();
  const followUpStatus = String(req.body?.followUpStatus || '').trim();
  const note = String(req.body?.note || '').trim();
  const allowed = new Set(['New', 'Contacted', 'Qualified', 'Converted', 'Closed']);

  if (!assistantQuoteId) {
    return res.status(400).json({ error: 'assistantQuoteId is required.' });
  }
  if (!allowed.has(followUpStatus)) {
    return res.status(400).json({ error: 'Invalid follow-up status.' });
  }

  const data = await readData();
  const pack = (data.aiQuotePacks || []).find((item) => String(item?.assistantQuoteId || '').trim() === assistantQuoteId);
  if (!pack) {
    return res.status(404).json({ error: 'AI quote pack not found.' });
  }

  pack.followUpStatus = followUpStatus;
  pack.followUpUpdatedBy = req.user.fullName || req.user.email || 'admin';
  pack.followUpUpdatedAt = new Date().toISOString();
  pack.updatedAt = new Date().toISOString();
  if (note) {
    pack.followUpNote = note;
  }

  await writeData(data);
  return res.json({ ok: true, assistantQuoteId, followUpStatus });
});

app.post('/api/quotes/:quoteId/nudges/unsubscribe', async (req, res) => {
  const quoteId = String(req.params.quoteId || '').trim();
  const email = normalizeEmail(req.body?.email || req.query?.email || '');

  if (!quoteId || !email) {
    return res.status(400).json({ error: 'quoteId and email are required.' });
  }

  const data = await readData();
  const quote = data.quotes.find(
    (item) => String(item?.quoteId || '').trim() === quoteId && normalizeEmail(item?.email) === email
  );

  if (!quote) {
    return res.status(404).json({ error: 'Quote not found.' });
  }

  quote.nudgesOptOutAt = new Date().toISOString();
  quote.nudgesStoppedReason = 'opt-out';
  quote.nudgesStoppedAt = quote.nudgesOptOutAt;
  await writeData(data);

  return res.json({ ok: true, quoteId, email, nudges: 'unsubscribed' });
});

app.get('/api/quotes/:quoteId/nudges/unsubscribe', async (req, res) => {
  const quoteId = String(req.params.quoteId || '').trim();
  const email = normalizeEmail(req.query?.email || '');

  if (!quoteId || !email) {
    return res.status(400).send('Missing quoteId or email.');
  }

  const data = await readData();
  const quote = data.quotes.find(
    (item) => String(item?.quoteId || '').trim() === quoteId && normalizeEmail(item?.email) === email
  );

  if (!quote) {
    return res.status(404).send('Quote not found.');
  }

  quote.nudgesOptOutAt = new Date().toISOString();
  quote.nudgesStoppedReason = 'opt-out';
  quote.nudgesStoppedAt = quote.nudgesOptOutAt;
  await writeData(data);

  return res.status(200).send('You have been unsubscribed from quote reminder emails.');
});

app.post('/api/uploads/document', async (req, res) => {
  const payload = req.body || {};
  const fileName = String(payload.fileName || 'document').trim();
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const dataBase64 = String(payload.dataBase64 || '').trim();

  if (!dataBase64) {
    return res.status(400).json({ error: 'dataBase64 is required.' });
  }

  const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if (mimeType && !allowedMime.has(mimeType)) {
    return res.status(400).json({ error: 'Only PDF, JPG, PNG, and WEBP files are supported.' });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload.' });
  }

  if (!buffer || !buffer.length) {
    return res.status(400).json({ error: 'Uploaded file is empty.' });
  }

  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'File exceeds 5MB limit.' });
  }

  const extMap = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };
  const safeBase = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'document';
  const ext = extMap[mimeType] || path.extname(safeBase) || '.bin';
  const storedName = `${Date.now()}-${randomUUID()}${ext}`;
  const destination = path.join(uploadDir, storedName);

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(destination, buffer);

  const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${storedName}`;
  return res.status(201).json({
    fileName: safeBase,
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
    url: publicUrl,
  });
});

app.post('/api/purchase-requests', async (req, res) => {
  const payload = req.body || {};
  const required = ['fullName', 'email', 'phone', 'storeName', 'productLinks', 'budgetUsd'];
  const missing = required.filter((k) => !payload[k]);

  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const links = Array.isArray(payload.productLinks)
    ? payload.productLinks.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (!links.length) {
    return res.status(400).json({ error: 'At least one product link is required.' });
  }

  const docsRequired = Boolean(payload.docsRequired);
  const documents = payload.documents || {};
  if (docsRequired) {
    const missingDocs = [];
    if (!String(documents.invoiceUrl || '').trim()) missingDocs.push('invoiceUrl');
    if (!String(documents.idUrl || '').trim()) missingDocs.push('idUrl');
    if (!documents.declarationAccepted) missingDocs.push('declarationAccepted');
    if (missingDocs.length) {
      return res.status(400).json({ error: `Missing required customs documents: ${missingDocs.join(', ')}` });
    }
  }

  const data = await readData();
  if (!Array.isArray(data.purchaseRequests)) {
    data.purchaseRequests = [];
  }

  const purchaseRequest = {
    requestId: `PR-${Date.now()}`,
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    storeName: payload.storeName,
    productLinks: links,
    items: Array.isArray(payload.items) ? payload.items : [],
    sizeColorSpecs: payload.sizeColorSpecs || '',
    budgetUsd: Number(payload.budgetUsd),
    cartSubtotalUsd: Number(payload.cartSubtotalUsd || 0),
    customsDutyUsd: Number(payload.customsDutyUsd || 0),
    brokerageFeeUsd: Number(payload.brokerageFeeUsd || 0),
    serviceFeeUsd: Number(payload.serviceFeeUsd || 0),
    processingFeeUsd: Number(payload.processingFeeUsd || 0),
    totalUsd: Number(payload.totalUsd || payload.budgetUsd || 0),
    docsRequired,
    customsReady: Boolean(payload.customsReady),
    customsReadyScore: Number(payload.customsReadyScore || 0),
    needsAdminReview: Boolean(payload.needsAdminReview || false),
    notificationPreferences: {
      whatsapp: Boolean(payload.notificationPreferences?.whatsapp),
      sms: Boolean(payload.notificationPreferences?.sms),
    },
    documents: {
      invoiceUrl: String(documents.invoiceUrl || '').trim(),
      idUrl: String(documents.idUrl || '').trim(),
      importPermitUrl: String(documents.importPermitUrl || '').trim(),
      declarationAccepted: Boolean(documents.declarationAccepted),
    },
    notes: payload.notes || '',
    createdAt: new Date().toISOString(),
    status: Boolean(payload.needsAdminReview) ? 'Needs Review' : 'Received',
    paymentStatus: 'pending'
  };

  data.purchaseRequests.push(purchaseRequest);
  await writeData(data);
  await sendNotification('New Purchase Assistance Request', `Request ${purchaseRequest.requestId} from ${purchaseRequest.fullName}`);

  if (purchaseRequest.customsReady) {
    const alerts = [];
    const message = `Clear Logistics update: your request ${purchaseRequest.requestId} is Customs Ready. Landed total: $${purchaseRequest.totalUsd.toFixed(2)}.`;
    if (purchaseRequest.notificationPreferences.whatsapp) {
      alerts.push(notifyCustomer({
        channel: 'whatsapp',
        to: purchaseRequest.phone,
        message,
        metadata: { event: 'customs_ready', requestId: purchaseRequest.requestId },
      }));
    }
    if (purchaseRequest.notificationPreferences.sms) {
      alerts.push(notifyCustomer({
        channel: 'sms',
        to: purchaseRequest.phone,
        message,
        metadata: { event: 'customs_ready', requestId: purchaseRequest.requestId },
      }));
    }
    await Promise.all(alerts);
  }

  res.status(201).json({ purchaseRequest, message: 'Purchase request received.' });
});

app.post('/api/bookings', requireAuth, async (req, res) => {
  const payload = req.body || {};
  const required = ['fullName', 'email', 'pickupDate', 'pickupAddress', 'cargoType', 'quantity'];
  const missing = required.filter((k) => !payload[k]);

  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const data = await readData();
  const shipmentId = `CLF-${10000 + data.bookings.length + 1}`;
  const unitType = payload.unitType || payload.cargoType;
  const booking = {
    bookingId: `B-${Date.now()}`,
    shipmentId,
    userId: req.user?.sub || null,
    ...payload,
    unitType,
    paymentStatus: 'pending',
    assignedDriverId: null,
    assignedDriverName: null,
    assignedAt: null,
    assignmentMode: null,
    createdAt: new Date().toISOString()
  };

  data.bookings.push(booking);
  data.shipments.push({
    shipmentId,
    fullName: payload.fullName,
    status: 'Order Received',
    cargoType: payload.cargoType,
    quantity: payload.quantity,
    unitType,
    paymentStatus: 'pending',
    milestones: DEFAULT_MILESTONES.map((step) => ({ ...step }))
  });

  const assignment = autoAssignUnassignedBookings(data);

  await writeData(data);
  await sendNotification('New Shipment Booking', `Shipment ${shipmentId} booked by ${payload.fullName} - ${payload.quantity} x ${payload.unitType}`);

  const savedBooking = data.bookings.find((b) => b.shipmentId === shipmentId) || booking;
  res.status(201).json({
    booking: savedBooking,
    shipmentId,
    assignment: {
      mode: savedBooking.assignmentMode,
      assignedDriverId: savedBooking.assignedDriverId,
      assignedDriverName: savedBooking.assignedDriverName,
      autoAssignedInBatch: assignment.assignedCount,
    },
    message: 'Shipment order received successfully.'
  });
});

app.get('/api/shipments/:shipmentId', async (req, res) => {
  const data = await readData();
  const shipment = data.shipments.find((s) => s.shipmentId === req.params.shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }
  const booking = (data.bookings || []).find((b) => b.shipmentId === shipment.shipmentId);
  const trackingPreferences = shipment.trackingPreferences || booking?.trackingPreferences || null;
  res.json({
    shipment: {
      ...shipment,
      trackingPreferences,
      escalationSlaMinutes: proactiveSlaMinutes,
    },
  });
});

function toPositiveNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveFreightReceivedLocation(statusText) {
  const normalized = String(statusText || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('customs') || normalized.includes('kingston') || normalized.includes('jamaica')) {
    return 'Jamaica Customs';
  }
  return 'Miami Warehouse';
}

function buildPublicScanSummary(data, shipmentId, shipment) {
  const safeShipmentId = String(shipmentId || shipment?.shipmentId || '').trim();
  const booking = Array.isArray(data?.bookings)
    ? data.bookings.find((b) => String(b?.shipmentId || '').trim() === safeShipmentId)
    : null;
  const scanEvents = Array.isArray(data?.scanEvents) ? data.scanEvents : [];
  const latestAcceptedScan = scanEvents
    .filter((event) => (
      String(event?.shipmentId || '').trim() === safeShipmentId
      && String(event?.status || '').trim().toLowerCase() === 'accepted'
      && String(event?.createdAt || '').trim()
    ))
    .sort((a, b) => {
      const aMs = toMillis(a?.createdAt) || 0;
      const bMs = toMillis(b?.createdAt) || 0;
      return bMs - aMs;
    })[0] || null;

  const quantityValue = toPositiveNumber(shipment?.quantity ?? booking?.quantity);
  const weightPerUnit = toPositiveNumber(
    booking?.weightPerUnit
    ?? shipment?.weightPerUnit
    ?? shipment?.weight
    ?? booking?.weight
  );
  const totalWeightLbs = weightPerUnit && quantityValue
    ? Number((weightPerUnit * quantityValue).toFixed(2))
    : weightPerUnit
      ? Number(weightPerUnit.toFixed(2))
      : null;

  const status = String(shipment?.status || '').trim();
  const receivedAt = String(booking?.lastScannedAt || latestAcceptedScan?.createdAt || '').trim() || null;
  const receivedBy = String(booking?.lastScannedBy || latestAcceptedScan?.driverName || '').trim() || null;
  const receivedSource = String(booking?.lastScanSource || latestAcceptedScan?.source || '').trim() || null;

  return {
    shipmentId: shipment?.shipmentId,
    status: shipment?.status,
    cargoType: shipment?.cargoType,
    quantity: shipment?.quantity,
    unitType: shipment?.unitType || booking?.unitType || shipment?.cargoType,
    weightPerUnitLbs: weightPerUnit,
    totalWeightLbs,
    receivedLocation: resolveFreightReceivedLocation(status),
    receivedAt,
    receivedBy,
    receivedSource,
    milestones: Array.isArray(shipment?.milestones)
      ? shipment.milestones
      : DEFAULT_MILESTONES.map((step) => ({ ...step })),
  };
}

app.get('/api/public/shipments/:shipmentId/scan', async (req, res) => {
  const shipmentId = String(req.params.shipmentId || '').trim();
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];
  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const scanSummary = buildPublicScanSummary(data, shipmentId, shipment);

  return res.json({
    shipment: scanSummary,
    scanSummary,
  });
});

app.post('/api/public/shipments/:shipmentId/freight-received', async (req, res) => {
  const shipmentId = String(req.params.shipmentId || '').trim();
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];

  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const booking = data.bookings.find((b) => String(b?.shipmentId || '').trim() === shipmentId) || null;
  const nowIso = new Date().toISOString();

  if (!Array.isArray(shipment.milestones) || shipment.milestones.length === 0) {
    shipment.milestones = DEFAULT_MILESTONES.map((step) => ({ ...step }));
  }

  const previousStatus = String(shipment.status || '').trim();
  const { milestoneLabel } = applyShipmentStatusProgress(shipment, 'Freight Received');

  data.scanEvents.push({
    scanId: randomUUID(),
    shipmentId,
    bookingId: booking?.bookingId || null,
    driverId: null,
    driverName: 'Public Camera Scan',
    source: 'public-camera-confirmation',
    status: 'accepted',
    reason: null,
    createdAt: nowIso,
  });

  if (booking) {
    booking.lastScannedAt = nowIso;
    booking.lastScannedBy = 'Public Camera Scan';
    booking.lastScanSource = 'public-camera-confirmation';
  }

  await writeData(data);
  await sendNotification('Freight Received Confirmed', `Shipment ${shipmentId} marked Freight Received via public camera scan.`);

  const trackingUpdateNotification = booking
    ? await sendShipmentTrackingPhoneUpdate({
      shipmentId,
      shipment,
      booking,
      event: 'freight_received',
      status: shipment.status,
      milestoneLabel: milestoneLabel || 'Freight Received',
      previousStatus,
    })
    : { delivered: false, reason: 'booking-not-available' };

  const scanSummary = buildPublicScanSummary(data, shipmentId, shipment);

  return res.json({
    ok: true,
    message: `Shipment ${shipmentId} marked as Freight Received.`,
    shipment: scanSummary,
    scanSummary,
    trackingUpdateNotification,
  });
});

app.post('/api/shipments/:shipmentId/preferences', requireAuth, async (req, res) => {
  const shipmentId = String(req.params.shipmentId || '').trim();
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const deliveryInstructions = String(req.body?.deliveryInstructions || '').trim().slice(0, 1000);
  const preferredContactWindow = String(req.body?.preferredContactWindow || 'Anytime').trim().slice(0, 120) || 'Anytime';
  const alertChannel = normalizeAlertChannel(req.body?.alertChannel);

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const booking = data.bookings.find((b) => String(b?.shipmentId || '').trim() === shipmentId) || null;
  if (!canManageShipmentFromUser(req.user, booking, shipment)) {
    return res.status(403).json({ error: 'You do not have access to update this shipment.' });
  }
  const preferences = {
    deliveryInstructions,
    preferredContactWindow,
    alertChannel,
    savedAt: new Date().toISOString(),
  };

  shipment.trackingPreferences = preferences;
  if (booking) {
    booking.trackingPreferences = preferences;
  }

  await writeData(data);
  await sendNotification('Tracking Preferences Updated', `Shipment ${shipmentId} preferences updated (${alertChannel}).`);

  return res.json({ ok: true, shipmentId, preferences });
});

app.post('/api/shipments/:shipmentId/proactive-alert', requireAuth, async (req, res) => {
  const shipmentId = String(req.params.shipmentId || '').trim();
  const requestedRisk = normalizeRiskLevel(req.body?.risk);
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }
  if (requestedRisk === 'low') {
    return res.json({ ok: true, shipmentId, transitioned: false, notified: false });
  }

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const booking = data.bookings.find((b) => String(b?.shipmentId || '').trim() === shipmentId) || null;
  if (!canManageShipmentFromUser(req.user, booking, shipment)) {
    return res.status(403).json({ error: 'You do not have access to update this shipment.' });
  }
  const priorRisk = normalizeRiskLevel(shipment.proactiveRisk || 'low');
  const riskChanged = priorRisk !== requestedRisk;
  const qualifiesTransition = riskChanged && (requestedRisk === 'medium' || requestedRisk === 'high');

  const nowMs = Date.now();
  const lastAlertMs = Date.parse(String(shipment.lastProactiveAlertAt || ''));
  const inCooldown = Number.isFinite(lastAlertMs) && (nowMs - lastAlertMs) < proactiveAlertCooldownMs;
  const shouldNotify = qualifiesTransition && !inCooldown;

  const preferences = shipment.trackingPreferences || booking?.trackingPreferences || null;
  const alertChannel = normalizeAlertChannel(preferences?.alertChannel);
  const contact = resolveShipmentContact(booking, shipment);

  let notifyResult = { delivered: false, reason: 'notification-not-required' };
  if (shouldNotify) {
    const headline = String(req.body?.headline || '').trim() || `Shipment ${shipmentId} now requires attention.`;
    const actionLabel = String(req.body?.actionLabel || '').trim() || 'Open tracking and escalate if needed.';
    const etaWindow = String(req.body?.etaWindow || '').trim();
    const etaText = etaWindow ? ` ETA: ${etaWindow}.` : '';
    const outboundMessage = `Clear Logistics update for ${shipmentId}: ${headline}. ${actionLabel}.${etaText}`;

    if ((alertChannel === 'whatsapp' || alertChannel === 'sms') && contact.phone) {
      notifyResult = await notifyCustomer({
        channel: alertChannel,
        to: contact.phone,
        message: outboundMessage,
        metadata: {
          event: 'proactive_risk_alert',
          shipmentId,
          risk: requestedRisk,
        },
      });
    } else {
      notifyResult = { delivered: false, reason: 'missing-customer-phone-or-unsupported-channel' };
    }
  }

  shipment.proactiveRisk = requestedRisk;
  shipment.proactiveRiskUpdatedAt = new Date().toISOString();
  if (shouldNotify) {
    shipment.lastProactiveAlertAt = new Date().toISOString();
    shipment.lastProactiveAlertChannel = alertChannel;
    shipment.lastProactiveAlertResult = notifyResult;
  }

  const slaDeadlineAt = requestedRisk === 'high'
    ? new Date(Date.now() + proactiveSlaMinutes * 60 * 1000).toISOString()
    : null;
  if (slaDeadlineAt) {
    shipment.lastHighRiskSlaDeadlineAt = slaDeadlineAt;
  }

  await writeData(data);

  return res.json({
    ok: true,
    shipmentId,
    priorRisk,
    risk: requestedRisk,
    transitioned: qualifiesTransition,
    notified: Boolean(shouldNotify),
    notification: notifyResult,
    slaDeadlineAt,
  });
});

app.post('/api/shipments/:shipmentId/escalate', requireAuth, async (req, res) => {
  const shipmentId = String(req.params.shipmentId || '').trim();
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];

  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const booking = data.bookings.find((b) => String(b?.shipmentId || '').trim() === shipmentId) || null;
  if (!canManageShipmentFromUser(req.user, booking, shipment)) {
    return res.status(403).json({ error: 'You do not have access to escalate this shipment.' });
  }
  const contact = resolveShipmentContact(booking, shipment);
  const fullName = String(req.body?.fullName || contact.fullName || 'Customer').trim();
  const email = String(req.body?.email || contact.email || 'tracking-escalation@clearlogistics.local').trim();
  const risk = normalizeRiskLevel(req.body?.risk);
  const source = String(req.body?.source || 'tracking').trim().slice(0, 120);
  const message = String(req.body?.message || `Tracking escalation requested for shipment ${shipmentId}.`).trim().slice(0, 1500);

  const recentDuplicate = data.supportTickets
    .filter((ticket) => String(ticket?.shipmentId || '').trim() === shipmentId && ticket?.source === 'tracking-escalation')
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];

  if (recentDuplicate) {
    const recentMs = Date.parse(String(recentDuplicate.createdAt || ''));
    if (Number.isFinite(recentMs) && (Date.now() - recentMs) < 15 * 60 * 1000) {
      return res.json({
        ok: true,
        shipmentId,
        duplicate: true,
        ticket: recentDuplicate,
        message: 'An escalation is already open for this shipment.',
      });
    }
  }

  const ticket = {
    ticketId: `T-${Date.now()}`,
    fullName,
    email,
    shipmentId,
    message,
    priority: risk === 'high' ? 'high' : 'normal',
    source: 'tracking-escalation',
    createdAt: new Date().toISOString(),
  };

  data.supportTickets.push(ticket);
  shipment.lastEscalatedAt = ticket.createdAt;
  shipment.lastEscalationTicketId = ticket.ticketId;

  await writeData(data);
  await sendNotification(
    'Shipment Escalated From Tracking',
    `Shipment ${shipmentId} escalated (${risk}) by ${fullName}. Ticket ${ticket.ticketId}.`
  );

  return res.status(201).json({ ok: true, shipmentId, ticket });
});

app.get('/api/customer/dashboard', requireAuth, async (req, res) => {
  if (req.user.role === 'driver') {
    return res.status(403).json({ error: 'Customer access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.aiQuotePacks)) data.aiQuotePacks = [];

  const requesterEmail = normalizeEmail(req.user.email);
  const accountById = data.accounts.find((account) => account?.id && req.user.sub && account.id === req.user.sub) || null;
  const accountByEmail = data.accounts.find((account) => normalizeEmail(account?.email) === requesterEmail) || null;
  const matchedAccount = accountById || accountByEmail;
  const requesterPhoneDigits = normalizePhoneForMatching(matchedAccount?.phone || req.user?.phone || '');

  if (matchedAccount && ensureCustomerShippingProfile(matchedAccount)) {
    await writeData(data);
  }
  const matchesUser = (booking) => {
    if (!booking) return false;
    if (booking.userId && req.user.sub && booking.userId === req.user.sub) return true;
    if (normalizeEmail(booking.email) === requesterEmail) return true;
    return Boolean(requesterPhoneDigits && normalizePhoneForMatching(booking.phone) === requesterPhoneDigits);
  };

  const normalizeMilestones = (milestones) => {
    const source = Array.isArray(milestones) && milestones.length
      ? milestones
      : DEFAULT_MILESTONES;

    return source.map((step, index) => {
      if (step && typeof step === 'object') {
        return {
          label: String(step.label || `Milestone ${index + 1}`),
          done: Boolean(step.done),
        };
      }

      return {
        label: String(step || `Milestone ${index + 1}`),
        done: false,
      };
    });
  };

  const shipmentById = new Map(
    (data.shipments || []).map((shipment) => [String(shipment?.shipmentId || '').trim(), shipment])
  );

  const shipments = data.bookings
    .filter(matchesUser)
    .map((booking) => {
      const shipmentId = String(booking?.shipmentId || '').trim();
      const shipment = shipmentById.get(shipmentId) || null;
      const status = String(shipment?.status || (booking?.pickedUp ? 'Picked Up' : 'Order Received'));
      const cargoLabel = String(booking?.unitType || booking?.cargoType || shipment?.unitType || shipment?.cargoType || 'Shipment');
      const serviceLabel = booking?.serviceLevel ? ` (${booking.serviceLevel})` : '';

      return {
        shipmentId: shipmentId || String(booking?.bookingId || 'N/A'),
        lane: `${cargoLabel}${serviceLabel}`,
        status,
        paymentStatus: String(booking?.paymentStatus || shipment?.paymentStatus || 'pending'),
        eta: shipment?.eta || (booking?.pickupDate ? `Pickup ${booking.pickupDate}` : 'Pending scheduling'),
        createdAt: booking?.createdAt || shipment?.createdAt || new Date().toISOString(),
        steps: normalizeMilestones(shipment?.milestones),
      };
    })
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  const quotes = (data.quotes || [])
    .filter((quote) => {
      if (!quote) return false;
      if (quote.userId && req.user.sub && quote.userId === req.user.sub) {
        return true;
      }
      if (normalizeEmail(quote.email) === requesterEmail) return true;
      return Boolean(requesterPhoneDigits && normalizePhoneForMatching(quote.phone) === requesterPhoneDigits);
    })
    .map((quote) => ({
      quoteId: String(quote.quoteId || 'N/A'),
      cargoType: String(quote.cargoType || quote.itemCategory || 'Shipment'),
      origin: String(quote.origin || ''),
      destination: String(quote.destination || ''),
      deliveryParish: String(quote.deliveryParish || ''),
      pricingMode: String(quote.pricingMode || ''),
      quotedPriceUsd: Number.isFinite(Number(quote.quotedPriceUsd)) ? Number(quote.quotedPriceUsd) : null,
      estimatedRangeUsd: quote.estimatedRangeUsd || null,
      spaceTierKey: String(quote.spaceTierKey || ''),
      spaceTierLabel: String(quote.spaceTierLabel || ''),
      deliveryZone: quote.deliveryZone || null,
      pricingBreakdown: quote.pricingBreakdown || null,
      createdAt: quote.createdAt || new Date().toISOString(),
      status: String(quote.status || 'Submitted'),
      emailStatus: quote?.emailStatus?.customer ? normalizeDeliveryStatus(quote.emailStatus.customer) : null,
    }))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  const aiQuotePacks = (data.aiQuotePacks || [])
    .filter((pack) => {
      if (!pack) return false;
      if (pack.userId && req.user.sub && pack.userId === req.user.sub) {
        return true;
      }
      if (normalizeEmail(pack.email) === requesterEmail) return true;
      return Boolean(requesterPhoneDigits && normalizePhoneForMatching(pack.phone) === requesterPhoneDigits);
    })
    .map((pack) => ({
      assistantQuoteId: String(pack.assistantQuoteId || 'N/A'),
      origin: String(pack.origin || ''),
      destination: String(pack.destination || ''),
      deliveryParish: String(pack.deliveryParish || ''),
      cargoType: String(pack.cargoType || ''),
      itemCategory: String(pack.itemCategory || ''),
      serviceLevel: String(pack.serviceLevel || ''),
      quantity: Number(pack.quantity || 1),
      weightLbs: Number(pack.weightLbs || 0),
      dimensions: pack.dimensions || null,
      declaredValueUsd: Number(pack.declaredValueUsd || 0),
      pickupRequirements: String(pack.pickupRequirements || ''),
      deliveryRequirements: String(pack.deliveryRequirements || ''),
      freightEstimate: pack.freightEstimate || null,
      followUpStatus: String(pack.followUpStatus || 'New'),
      createdAt: pack.createdAt || new Date().toISOString(),
      emailStatus: pack?.emailStatus?.customer ? normalizeDeliveryStatus(pack.emailStatus.customer) : null,
      intakeSummary: {
        serviceLevel: String(pack.serviceLevel || ''),
        itemCategory: String(pack.itemCategory || ''),
        contact: {
          customerName: String(pack.customerName || ''),
          email: String(pack.email || ''),
          phone: String(pack.phone || ''),
        },
      },
    }))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  const profile = matchedAccount
    ? {
        fullName: matchedAccount.fullName || req.user.fullName || 'Customer',
        email: matchedAccount.email || req.user.email || '',
        phone: String(matchedAccount.phone || ''),
        customerReference: deriveCustomerReference(matchedAccount),
        usReceivingAddress: deriveReceivingAddress(matchedAccount),
      }
    : {
        fullName: req.user.fullName || 'Customer',
        email: req.user.email || '',
        phone: String(req.user.phone || ''),
        customerReference: deriveCustomerReference(req.user),
        usReceivingAddress: deriveReceivingAddress(req.user),
      };

  return res.json({ shipments, profile, quotes, aiQuotePacks });
});

app.post('/api/customer/quotes/:quoteId/retry-email', requireAuth, async (req, res) => {
  if (req.user.role === 'driver') {
    return res.status(403).json({ error: 'Customer access required.' });
  }

  const quoteId = String(req.params.quoteId || '').trim();
  if (!quoteId) {
    return res.status(400).json({ error: 'quoteId is required.' });
  }

  const data = await readData();
  const requesterEmail = normalizeEmail(req.user.email);

  const quote = (data.quotes || []).find((item) => {
    if (!item) return false;
    if (String(item.quoteId || '').trim() !== quoteId) return false;
    if (item.userId && req.user.sub && item.userId === req.user.sub) return true;
    return normalizeEmail(item.email) === requesterEmail;
  });

  if (!quote) {
    return res.status(404).json({ error: 'Quote not found.' });
  }

  const customerEmail = buildPremiumQuoteCustomerEmail(quote);
  const retryResult = await sendEmail({
    to: quote.email,
    subject: customerEmail.subject,
    text: customerEmail.text,
    html: customerEmail.html,
    mockTag: 'quote-customer-retry',
  });

  if (!quote.emailStatus || typeof quote.emailStatus !== 'object') {
    quote.emailStatus = {};
  }
  quote.emailStatus.customer = normalizeDeliveryStatus(retryResult);
  quote.emailStatus.updatedAt = new Date().toISOString();
  quote.lastEmailRetryAt = new Date().toISOString();
  quote.emailRetryCount = Number(quote.emailRetryCount || 0) + 1;
  await writeData(data);

  return res.json({
    ok: true,
    quoteId,
    emailStatus: quote.emailStatus,
  });
});
app.post('/api/admin/shipments/:shipmentId/status', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const shipmentId = String(req.params.shipmentId || '').trim();
  const nextStatus = String(req.body?.status || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 500);

  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  if (!MANUAL_SHIPMENT_STATUS_OPTIONS.includes(nextStatus)) {
    return res.status(400).json({ error: `status must be one of: ${MANUAL_SHIPMENT_STATUS_OPTIONS.join(', ')}` });
  }

  const data = await readData();
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const shipment = data.shipments.find((s) => String(s?.shipmentId || '').trim() === shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const booking = data.bookings.find((b) => String(b?.shipmentId || '').trim() === shipmentId) || null;
  const previousStatus = String(shipment.status || '').trim();
  const { milestoneLabel } = applyShipmentStatusProgress(shipment, nextStatus);
  shipment.lastStatusUpdatedAt = new Date().toISOString();
  shipment.lastStatusUpdatedBy = req.user.fullName || req.user.email || 'admin';
  if (note) {
    shipment.lastStatusUpdateNote = note;
  }

  await writeData(data);
  await sendNotification(
    'Shipment Status Updated',
    `Shipment ${shipmentId} moved from ${previousStatus || 'Unknown'} to ${nextStatus}${note ? ` (${note})` : ''}.`
  );

  const trackingUpdateNotification = await sendShipmentTrackingPhoneUpdate({
    shipmentId,
    shipment,
    booking,
    event: 'shipment_status_updated',
    status: nextStatus,
    milestoneLabel,
  });

  return res.json({
    ok: true,
    shipmentId,
    previousStatus,
    status: nextStatus,
    milestoneLabel,
    trackingUpdateNotification,
    shipment,
  });
});

app.post('/api/support', async (req, res) => {
  const { fullName, email, message, shipmentId } = req.body || {};
  if (!fullName || !email || !message) {
    return res.status(400).json({ error: 'fullName, email, and message are required.' });
  }

  const data = await readData();
  const ticket = {
    ticketId: `T-${Date.now()}`,
    fullName,
    email,
    shipmentId: shipmentId || null,
    message,
    createdAt: new Date().toISOString()
  };

  data.supportTickets.push(ticket);
  await writeData(data);
  await sendNotification('New Support Ticket', `Ticket ${ticket.ticketId} from ${fullName}. Shipment: ${shipmentId || 'N/A'}`);

  res.status(201).json({ ticket, message: 'Support request received.' });
});

app.post('/api/payments/checkout', async (req, res) => {
  const amount = Number(req.body?.amount || 2500);
  const referenceType = String(req.body?.referenceType || 'shipment');
  const referenceId = String(req.body?.referenceId || req.body?.shipmentId || 'TBD').trim() || 'TBD';
  const checkoutLabel = referenceType === 'purchase_request' ? `Shop & Ship ${referenceId}` : `Shipment Deposit ${referenceId}`;
  const frontendBaseUrl = getFrontendBaseUrl(req);

  if (!stripe) {
    return res.json({
      mode: 'mock',
      url: `${frontendBaseUrl}/mock-checkout?referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}&amount=${amount}`,
      message: 'Stripe key not configured. Using mock checkout URL.'
    });
  }

  try {
    const successUrl = `${frontendBaseUrl}/?payment=success&referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendBaseUrl}/?payment=cancelled&referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}`;
    const sessionPayload = {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: checkoutLabel
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      billing_address_collection: 'required',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: referenceId,
      metadata: {
        referenceType,
        referenceId,
      },
    };

    if (stripePaymentMethodTypes.length) {
      sessionPayload.payment_method_types = stripePaymentMethodTypes;
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionPayload);
    } catch (error) {
      const paymentMethodError =
        error?.type === 'StripeInvalidRequestError' &&
        /payment_method_types|cashapp|apple|link/i.test(String(error.message || ''));
      if (!paymentMethodError) {
        throw error;
      }

      const fallbackPayload = { ...sessionPayload };
      delete fallbackPayload.payment_method_types;
      session = await stripe.checkout.sessions.create(fallbackPayload);
    }

    res.json({ mode: 'stripe', url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to create Stripe checkout session.' });
  }
});

app.post('/api/payments/confirm', async (req, res) => {
  const shipmentId = String(req.body?.shipmentId || '').trim();
  const referenceType = String(req.body?.referenceType || '').trim();
  const referenceId = String(req.body?.referenceId || '').trim();
  const providerStatus = String(req.body?.providerStatus || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();

  if (providerStatus === 'success' && stripe && sessionId) {
    try {
      const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
      if (checkoutSession.payment_status !== 'paid') {
        return res.status(402).json({ error: 'Stripe session is not paid yet.' });
      }
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to verify Stripe checkout session.' });
    }
  }

  if (referenceType === 'purchase_request') {
    if (!referenceId) {
      return res.status(400).json({ error: 'referenceId is required for purchase_request confirmation.' });
    }

    const data = await readData();
    const purchaseRequest = data.purchaseRequests.find((p) => p.requestId === referenceId);
    if (!purchaseRequest) {
      return res.status(404).json({ error: 'Purchase request not found for payment confirmation.' });
    }

    purchaseRequest.paymentStatus = 'paid';
    if (purchaseRequest.status === 'Received') {
      purchaseRequest.status = 'Paid';
    }

    await writeData(data);
    await sendNotification('Shop & Ship Payment Confirmed', `Purchase request ${referenceId} marked paid (${providerStatus || 'manual-confirm'}).`);

    const paymentAlerts = [];
    const paymentMessage = `Clear Logistics update: payment confirmed for request ${referenceId}. Our team is now processing your order.`;
    if (purchaseRequest.notificationPreferences?.whatsapp) {
      paymentAlerts.push(notifyCustomer({
        channel: 'whatsapp',
        to: purchaseRequest.phone,
        message: paymentMessage,
        metadata: { event: 'payment_confirmed', requestId: referenceId },
      }));
    }
    if (purchaseRequest.notificationPreferences?.sms) {
      paymentAlerts.push(notifyCustomer({
        channel: 'sms',
        to: purchaseRequest.phone,
        message: paymentMessage,
        metadata: { event: 'payment_confirmed', requestId: referenceId },
      }));
    }
    await Promise.all(paymentAlerts);

    return res.json({ ok: true, referenceType: 'purchase_request', referenceId, paymentStatus: 'paid' });
  }

  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const data = await readData();
  const shipment = data.shipments.find((s) => s.shipmentId === shipmentId);
  const booking = data.bookings.find((b) => b.shipmentId === shipmentId);

  if (!shipment && !booking) {
    return res.status(404).json({ error: 'Shipment not found for payment confirmation.' });
  }

  if (shipment) {
    shipment.paymentStatus = 'paid';
    if (shipment.status === 'Pickup Scheduled' || shipment.status === 'Order Received') {
      shipment.status = 'Payment Received';
    }
  }

  if (booking) {
    booking.paymentStatus = 'paid';
  }

  await writeData(data);
  await sendNotification('Payment Confirmed', `Shipment ${shipmentId} marked paid (${providerStatus || 'manual-confirm'}).`);

  const trackingUpdateNotification = shipment
    ? await sendShipmentTrackingPhoneUpdate({
      shipmentId,
      shipment,
      booking,
      event: 'payment_received',
      status: shipment.status,
      milestoneLabel: 'Payment Received',
    })
    : { delivered: false, reason: 'shipment-not-available' };

  res.json({ ok: true, shipmentId, paymentStatus: 'paid', trackingUpdateNotification });
});

// ============================================================================
// PHASE 2: DRIVER APP ENDPOINTS
// ============================================================================

app.post('/api/drivers/register', async (req, res) => {
  const { fullName, email, password, phone, vehicle } = req.body || {};
  if (!fullName || !email || !password || !phone || !vehicle) {
    return res.status(400).json({ error: 'fullName, email, password, phone, and vehicle are required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.drivers)) data.drivers = [];
  
  const existing = data.drivers.find((d) => d.email.toLowerCase() === String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Driver account already exists for this email.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const driver = {
    id: randomUUID(),
    fullName,
    email,
    password: passwordHash,
    phone,
    vehicle,
    role: 'driver',
    status: 'active',
    createdAt: new Date().toISOString()
  };

  data.drivers.push(driver);
  await writeData(data);
  await sendNotification('New Driver Registered', `Driver: ${fullName} <${email}> - Vehicle: ${vehicle}`);

  res.status(201).json({ driver: { ...driver, password: undefined } });
});

app.post('/api/drivers/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  let data = await readData();
  if (!Array.isArray(data.drivers)) data.drivers = [];

  if (driverDemoAccountEnabled && String(email).trim().toLowerCase() === DRIVER_DEMO_EMAIL) {
    await seedDriverDemoData();
    data = await readData();
    if (!Array.isArray(data.drivers)) data.drivers = [];
  }
  
  const driver = data.drivers.find((d) => d.email.toLowerCase() === String(email).toLowerCase());
  if (!driver) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  let passwordOk = await bcrypt.compare(password, driver.password);
  if (
    !passwordOk
    && String(driver.email || '').toLowerCase() === DRIVER_DEMO_EMAIL
    && String(password || '') === DRIVER_DEMO_LEGACY_PASSWORD
  ) {
    passwordOk = true;
  }
  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    {
      sub: driver.id,
      email: driver.email,
      fullName: driver.fullName,
      role: 'driver'
    },
    jwtSecret,
    { expiresIn: '24h' }
  );

  res.json({
    user: { ...driver, password: undefined },
    token,
    role: 'driver'
  });
});

app.post('/api/drivers/assignments/auto', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const data = await readData();
  const result = autoAssignUnassignedBookings(data);
  if (result.changed) {
    await writeData(data);
  }

  return res.json({
    ok: true,
    assignedCount: result.assignedCount,
    message: result.assignedCount
      ? `Auto-assigned ${result.assignedCount} pickups.`
      : 'No unassigned pickups found.',
  });
});

// ── Dispatcher: view all driver workloads + pending bookings ──────────────────
app.get('/api/admin/dispatcher', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.drivers)) data.drivers = [];
  if (!Array.isArray(data.routes)) data.routes = [];

  const visibilityScopedData = {
    ...data,
    bookings: filterDemoRecordsForEmail(data.bookings, req.user.email),
    drivers: filterDemoRecordsForEmail(data.drivers, req.user.email),
    routes: filterDemoRecordsForEmail(data.routes, req.user.email),
  };

  const drivers = getActiveDrivers(visibilityScopedData).map((d) => {
    const pending = getPendingAssignmentCount(visibilityScopedData, d.id);
    const activeRoute = findActiveRouteForDriver(visibilityScopedData, d.id);
    const progress = activeRoute ? routeProgress(activeRoute) : null;
    return {
      id: d.id,
      fullName: d.fullName,
      email: d.email,
      status: d.status || 'active',
      pendingCount: pending,
      activeRoute: activeRoute
        ? { routeId: activeRoute.routeId, status: activeRoute.status, ...progress }
        : null,
    };
  });

  const pendingBookings = (visibilityScopedData.bookings || [])
    .filter((b) => !b.pickedUp)
    .sort((a, b) => {
      const aDate = Date.parse(a.pickupDate) || 0;
      const bDate = Date.parse(b.pickupDate) || 0;
      return aDate - bDate;
    })
    .map((b) => ({
      bookingId: b.bookingId,
      shipmentId: b.shipmentId,
      fullName: b.fullName,
      pickupDate: b.pickupDate,
      pickupCity: b.pickupCity,
      pickupAddress: b.pickupAddress,
      assignedDriverId: b.assignedDriverId || null,
      assignedDriverName: b.assignedDriverName || null,
      assignmentMode: b.assignmentMode || null,
    }));

  return res.json({ drivers, pendingBookings });
});

// ── Dispatcher: manually reassign a booking to a specific driver ──────────────
app.post('/api/admin/dispatcher/reassign', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { bookingId, driverId } = req.body || {};
  if (!bookingId || !driverId) {
    return res.status(400).json({ error: 'bookingId and driverId are required.' });
  }

  const data = await readData();
  const booking = (data.bookings || []).find((b) => b.bookingId === bookingId);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }
  if (booking.pickedUp) {
    return res.status(409).json({ error: 'Booking is already picked up.' });
  }

  const driver = (data.drivers || []).find((d) => d.id === driverId);
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' });
  }

  booking.assignedDriverId = driverId;
  booking.assignedDriverName = driver.fullName;
  booking.assignedAt = new Date().toISOString();
  booking.assignmentMode = 'manual';

  await writeData(data);

  return res.json({
    ok: true,
    bookingId,
    assignedDriverId: driverId,
    assignedDriverName: driver.fullName,
    assignmentMode: 'manual',
  });
});

app.get('/api/drivers/dashboard', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const assignment = autoAssignUnassignedBookings(data);
  if (assignment.changed) {
    await writeData(data);
  }

  const pickups = data.bookings
    .filter((b) => b.pickupDate && !b.pickedUp && b.assignedDriverId === req.user.sub)
    .map((b) => {
      const shipment = data.shipments.find((s) => s.shipmentId === b.shipmentId);
      return {
        shipmentId: b.shipmentId,
        bookingId: b.bookingId,
        fullName: b.fullName,
        email: b.email,
        phone: b.phone,
        pickupAddress: b.pickupAddress,
        pickupCity: b.pickupCity,
        pickupZip: b.pickupZip,
        pickupDate: b.pickupDate,
        cargoType: b.cargoType,
        quantity: b.quantity,
        weight: b.weight,
        jamaicaRecipient: b.jamaicaRecipient,
        jamaicaLocation: b.jamaicaLocation,
        serviceLevel: b.serviceLevel,
        assignedDriverId: b.assignedDriverId,
        assignedDriverName: b.assignedDriverName,
        assignedAt: b.assignedAt,
        assignmentMode: b.assignmentMode,
        status: shipment?.status || 'Order Received',
        createdAt: b.createdAt
      };
    })
    .sort((a, b) => new Date(a.pickupDate) - new Date(b.pickupDate));

  res.json({ pickups, count: pickups.length });
});

app.post('/api/drivers/scans', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const shipmentId = String(req.body?.shipmentId || '').trim();
  const source = String(req.body?.source || 'manual').trim().toLowerCase();
  if (!shipmentId) {
    return res.status(400).json({ error: 'shipmentId is required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const nowIso = new Date().toISOString();
  const baseEvent = {
    scanId: `SCAN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    shipmentId,
    driverId: req.user.sub,
    driverName: req.user.fullName,
    source,
    createdAt: nowIso,
  };

  const booking = data.bookings.find((b) => b.shipmentId === shipmentId);
  if (!booking) {
    data.scanEvents.push({ ...baseEvent, status: 'rejected', reason: 'shipment-not-found' });
    await writeData(data);
    await sendNotification('Scan Exception: Unknown Shipment', `Shipment ${shipmentId} scanned by ${req.user.fullName} via ${source}, but shipment was not found.`);
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const shipment = data.shipments.find((s) => s.shipmentId === shipmentId);
  const pickup = {
    shipmentId: booking.shipmentId,
    bookingId: booking.bookingId,
    fullName: booking.fullName,
    email: booking.email,
    phone: booking.phone,
    pickupAddress: booking.pickupAddress,
    pickupCity: booking.pickupCity,
    pickupZip: booking.pickupZip,
    pickupDate: booking.pickupDate,
    cargoType: booking.cargoType,
    quantity: booking.quantity,
    weight: booking.weight,
    jamaicaRecipient: booking.jamaicaRecipient,
    jamaicaLocation: booking.jamaicaLocation,
    serviceLevel: booking.serviceLevel,
    assignedDriverId: booking.assignedDriverId,
    assignedDriverName: booking.assignedDriverName,
    status: shipment?.status || 'Order Received',
    createdAt: booking.createdAt,
  };

  if (booking.assignedDriverId && booking.assignedDriverId !== req.user.sub) {
    data.scanEvents.push({
      ...baseEvent,
      bookingId: booking.bookingId,
      status: 'rejected',
      reason: 'assigned-to-different-driver',
      assignedDriverId: booking.assignedDriverId,
      assignedDriverName: booking.assignedDriverName || null,
    });
    await writeData(data);
    await sendNotification(
      'Scan Exception: Wrong Driver Assignment',
      `Shipment ${shipmentId} scanned by ${req.user.fullName}, but assigned to ${booking.assignedDriverName || booking.assignedDriverId || 'another driver'}.`
    );
    return res.status(403).json({ error: 'This shipment is assigned to a different driver.' });
  }

  const recentSameShipmentScans = data.scanEvents.filter((event) => {
    if (String(event?.shipmentId || '').trim() !== shipmentId) return false;
    if (event?.status === 'rejected') return false;
    const eventMs = toMillis(event?.createdAt);
    const nowMs = toMillis(nowIso) || Date.now();
    return eventMs !== null && nowMs - eventMs <= scanRepeatWindowMs;
  });

  const duplicateScanForDriver = recentSameShipmentScans.find((event) => event?.driverId === req.user.sub);
  if (duplicateScanForDriver) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      shipmentId,
      pickup,
      message: `Scan already recorded recently for ${shipmentId}.`,
      lastAcceptedScanAt: duplicateScanForDriver.createdAt,
    });
  }

  const scanEvent = {
    ...baseEvent,
    bookingId: booking.bookingId,
    status: 'accepted',
    reason: null,
  };

  booking.lastScannedAt = scanEvent.createdAt;
  booking.lastScannedBy = req.user.fullName;
  booking.lastScanSource = source;
  data.scanEvents.push(scanEvent);

  await writeData(data);
  await sendNotification('Barcode Scanned', `Shipment ${shipmentId} scanned by ${req.user.fullName} via ${source}.`);

  if (recentSameShipmentScans.length + 1 === scanRepeatThreshold) {
    await sendNotification(
      'Scan Exception: Repeated Scans',
      `Shipment ${shipmentId} was scanned ${scanRepeatThreshold} times within ${Math.round(scanRepeatWindowMs / 60000)} minutes.`
    );
  }

  return res.status(201).json({
    ok: true,
    scanEvent,
    pickup,
    message: `Scan recorded for ${shipmentId}.`,
  });
});

app.get('/api/drivers/scans/recent', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
  const data = await readData();
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];

  const scans = data.scanEvents
    .filter((event) => event?.driverId === req.user.sub)
    .sort((a, b) => {
      const aMs = toMillis(a?.createdAt) || 0;
      const bMs = toMillis(b?.createdAt) || 0;
      return bMs - aMs;
    });

  // Keep only the latest scan per shipment in the driver activity feed.
  const uniqueByShipment = [];
  const seenShipments = new Set();
  for (const scan of scans) {
    const shipmentKey = String(scan?.shipmentId || '').trim();
    if (!shipmentKey || seenShipments.has(shipmentKey)) {
      continue;
    }
    seenShipments.add(shipmentKey);
    uniqueByShipment.push(scan);
    if (uniqueByShipment.length >= limit) {
      break;
    }
  }

  return res.json({ scans: uniqueByShipment, count: uniqueByShipment.length });
});

app.put('/api/drivers/pickups/:shipmentId/confirm', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const { notes, photoUrl } = req.body || {};
  const shipmentId = req.params.shipmentId;
  const normalizedPhotoUrl = String(photoUrl || '').trim();

  if (!normalizedPhotoUrl) {
    return res.status(400).json({ error: 'Pickup photo is required before confirmation.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];

  const booking = data.bookings.find((b) => b.shipmentId === shipmentId);
  if (!booking) {
    return res.status(404).json({ error: 'Pickup not found.' });
  }

  if (booking.assignedDriverId && booking.assignedDriverId !== req.user.sub) {
    return res.status(403).json({ error: 'This pickup is assigned to a different driver.' });
  }

  const nowMs = Date.now();
  const recentAcceptedScan = data.scanEvents
    .filter((event) => (
      String(event?.shipmentId || '').trim() === shipmentId
      && event?.driverId === req.user.sub
      && event?.status === 'accepted'
    ))
    .sort((a, b) => (toMillis(b?.createdAt) || 0) - (toMillis(a?.createdAt) || 0))[0];

  if (!recentAcceptedScan) {
    return res.status(409).json({
      error: 'Scan required before pickup confirmation. Please scan this shipment first.',
    });
  }

  const recentScanMs = toMillis(recentAcceptedScan.createdAt);
  if (recentScanMs === null || (nowMs - recentScanMs) > pickupConfirmScanWindowMs) {
    return res.status(409).json({
      error: `Latest scan is too old. Please re-scan within ${Math.round(pickupConfirmScanWindowMs / 60000)} minutes before confirming pickup.`,
    });
  }

  const shipment = data.shipments.find((s) => s.shipmentId === shipmentId);
  if (shipment) {
    shipment.status = 'Picked Up';
    // Update milestone
    if (Array.isArray(shipment.milestones)) {
      const milestone = shipment.milestones.find((m) => m.label === 'Picked Up');
      if (milestone) milestone.done = true;
    }
  }

  booking.pickedUp = true;
  booking.pickedUpAt = new Date().toISOString();
  booking.pickedUpBy = req.user.fullName;
  booking.pickupNotes = notes;
  booking.pickupPhotoUrl = normalizedPhotoUrl;

  const activeRoute = findActiveRouteForDriver(data, req.user.sub);
  if (activeRoute && Array.isArray(activeRoute.stops)) {
    const routeStop = activeRoute.stops.find((s) => s.shipmentId === shipmentId);
    if (routeStop && routeStop.status !== 'completed') {
      routeStop.status = 'completed';
      routeStop.completedAt = new Date().toISOString();
      activeRoute.lastCompletedShipmentId = shipmentId;
      activeRoute.lastUpdatedAt = new Date().toISOString();
    }

    const progress = routeProgress(activeRoute);
    activeRoute.progress = progress;
    if (progress.pending === 0 && activeRoute.status === 'active') {
      activeRoute.status = 'completed';
      activeRoute.completedAt = new Date().toISOString();
    }
  }

  await writeData(data);
  await sendNotification('Pickup Confirmed', `Shipment ${shipmentId} picked up by ${req.user.fullName}`);

  const trackingUpdateNotification = shipment
    ? await sendShipmentTrackingPhoneUpdate({
      shipmentId,
      shipment,
      booking,
      event: 'pickup_confirmed',
      status: shipment.status,
      milestoneLabel: 'Picked Up',
    })
    : { delivered: false, reason: 'shipment-not-available' };

  res.json({ booking, shipment, activeRoute: activeRoute || null, message: 'Pickup confirmed.', trackingUpdateNotification });
});

app.get('/api/drivers/routes/active', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.routes)) data.routes = [];

  const activeRoute = findActiveRouteForDriver(data, req.user.sub);
  return res.json({ route: activeRoute || null });
});

app.post('/api/drivers/routes/start', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const stopShipmentIds = Array.isArray(req.body?.stopShipmentIds)
    ? req.body.stopShipmentIds.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (!stopShipmentIds.length) {
    return res.status(400).json({ error: 'stopShipmentIds is required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.routes)) data.routes = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const existingActive = findActiveRouteForDriver(data, req.user.sub);
  if (existingActive) {
    return res.status(409).json({ error: 'Driver already has an active route.', route: existingActive });
  }

  const allowedShipments = new Set(
    data.bookings
      .filter((b) => !b.pickedUp && b.assignedDriverId === req.user.sub)
      .map((b) => b.shipmentId)
  );

  const uniqueStopIds = [...new Set(stopShipmentIds)].filter((id) => allowedShipments.has(id));
  if (!uniqueStopIds.length) {
    return res.status(400).json({ error: 'No valid assigned pickups were provided.' });
  }

  const stops = uniqueStopIds.map((shipmentId, index) => {
    const booking = data.bookings.find((b) => b.shipmentId === shipmentId);
    return {
      order: index + 1,
      shipmentId,
      pickupAddress: booking?.pickupAddress || '',
      pickupCity: booking?.pickupCity || '',
      pickupZip: booking?.pickupZip || '',
      pickupDate: booking?.pickupDate || '',
      status: 'pending',
      completedAt: null,
    };
  });

  const route = {
    routeId: `RTE-${Date.now()}`,
    driverId: req.user.sub,
    driverName: req.user.fullName,
    status: 'active',
    startedAt: new Date().toISOString(),
    completedAt: null,
    stops,
    progress: routeProgress({ stops }),
    locationTrail: [],
    startedFrom: {
      lat: Number(req.body?.startLat),
      lng: Number(req.body?.startLng),
    },
  };

  data.routes.push(route);
  await writeData(data);
  await sendNotification('Driver Route Started', `Route ${route.routeId} started by ${req.user.fullName} with ${stops.length} stops.`);

  return res.status(201).json({ route, message: 'Route tracking started.' });
});

app.post('/api/drivers/routes/:routeId/location', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const routeId = String(req.params.routeId || '').trim();
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);

  if (!routeId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'routeId, lat, and lng are required.' });
  }

  const data = await readData();
  const route = (data.routes || []).find((r) => r.routeId === routeId && r.driverId === req.user.sub);
  if (!route) {
    return res.status(404).json({ error: 'Route not found.' });
  }

  if (!Array.isArray(route.locationTrail)) route.locationTrail = [];
  route.locationTrail.push({
    lat,
    lng,
    at: new Date().toISOString(),
    speedKph: Number.isFinite(Number(req.body?.speedKph)) ? Number(req.body?.speedKph) : null,
  });
  if (route.locationTrail.length > 200) {
    route.locationTrail = route.locationTrail.slice(route.locationTrail.length - 200);
  }

  route.lastKnownLocation = { lat, lng, at: new Date().toISOString() };
  await writeData(data);

  return res.json({ ok: true, routeId, points: route.locationTrail.length });
});

app.put('/api/drivers/routes/:routeId/stops/:shipmentId/complete', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const routeId = String(req.params.routeId || '').trim();
  const shipmentId = String(req.params.shipmentId || '').trim();
  const data = await readData();

  const route = (data.routes || []).find((r) => r.routeId === routeId && r.driverId === req.user.sub);
  if (!route) {
    return res.status(404).json({ error: 'Route not found.' });
  }

  const stop = (route.stops || []).find((s) => s.shipmentId === shipmentId);
  if (!stop) {
    return res.status(404).json({ error: 'Stop not found on route.' });
  }

  if (stop.status !== 'completed') {
    stop.status = 'completed';
    stop.completedAt = new Date().toISOString();
    route.lastCompletedShipmentId = shipmentId;
    route.lastUpdatedAt = new Date().toISOString();
  }

  route.progress = routeProgress(route);
  if (route.progress.pending === 0 && route.status === 'active') {
    route.status = 'completed';
    route.completedAt = new Date().toISOString();
  }

  await writeData(data);
  return res.json({ route, message: `Stop ${shipmentId} marked complete.` });
});

app.get('/api/drivers/route-optimization', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const assignment = autoAssignUnassignedBookings(data);
  if (assignment.changed) {
    await writeData(data);
  }

  const cityCenters = {
    miami: { lat: 25.7617, lng: -80.1918 },
    'fort lauderdale': { lat: 26.1224, lng: -80.1373 },
    jacksonville: { lat: 30.3322, lng: -81.6557 },
    orlando: { lat: 28.5383, lng: -81.3792 },
    kissimmee: { lat: 28.2919, lng: -81.4076 },
    tampa: { lat: 27.9506, lng: -82.4572 },
    hollywood: { lat: 26.0112, lng: -80.1495 },
    hialeah: { lat: 25.8576, lng: -80.2781 },
    doral: { lat: 25.8195, lng: -80.3553 },
  };

  const servicePriority = {
    Premium: 1,
    Standard: 2,
    Economy: 3,
  };

  const parseStreetNumber = (address) => {
    const match = String(address || '').trim().match(/\b(\d{1,6})\b/);
    return match ? Number(match[1]) : 0;
  };

  const estimateCoordinates = ({ pickupAddress, pickupCity, pickupZip }) => {
    const cityKey = String(pickupCity || '').trim().toLowerCase();
    const base = cityCenters[cityKey] || { lat: 27.9944, lng: -81.7603 };
    const streetNum = parseStreetNumber(pickupAddress);
    const zipDigits = Number(String(pickupZip || '').replace(/\D/g, '').slice(0, 5) || 0);

    // Deterministic local jitter so nearby addresses in the same city aren't treated as identical.
    const latJitter = ((streetNum % 97) * 0.00021) + ((zipDigits % 100) * 0.00004);
    const lngJitter = ((streetNum % 89) * 0.00023) + (((Math.floor(zipDigits / 10)) % 100) * 0.00004);

    return {
      lat: base.lat + latJitter,
      lng: base.lng - lngJitter,
    };
  };

  const toRad = (deg) => (deg * Math.PI) / 180;
  const haversineKm = (a, b) => {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const aa =
      (Math.sin(dLat / 2) ** 2)
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * (Math.sin(dLng / 2) ** 2);
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return R * c;
  };

  const todayStart = startOfDay(new Date());

  const pendingPickups = data.bookings
    .filter((b) => b.pickupDate && !b.pickedUp && b.assignedDriverId === req.user.sub)
    .map((b) => {
      const pickupCity = String(b.pickupCity || '').trim();
      const pickupDateValue = Number.isFinite(Date.parse(b.pickupDate)) ? Date.parse(b.pickupDate) : Number.MAX_SAFE_INTEGER;
      const pickupDay = pickupDateValue === Number.MAX_SAFE_INTEGER ? null : startOfDay(pickupDateValue);
      const daysUntilPickup = pickupDay
        ? Math.floor((pickupDay.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000))
        : 999;
      const serviceRank = servicePriority[b.serviceLevel] || 9;
      const coords = estimateCoordinates({
        pickupAddress: b.pickupAddress,
        pickupCity,
        pickupZip: b.pickupZip,
      });

      return {
        shipmentId: b.shipmentId,
        fullName: b.fullName,
        phone: b.phone,
        pickupAddress: b.pickupAddress,
        pickupCity,
        pickupZip: b.pickupZip,
        pickupDate: b.pickupDate,
        serviceLevel: b.serviceLevel,
        cargoType: b.cargoType,
        pickupDateValue,
        daysUntilPickup,
        serviceRank,
        lat: coords.lat,
        lng: coords.lng,
      };
    });

  const queryLat = Number(req.query?.currentLat);
  const queryLng = Number(req.query?.currentLng);
  const hasDriverLocation = Number.isFinite(queryLat) && Number.isFinite(queryLng);

  const defaultStart = (() => {
    if (!pendingPickups.length) {
      return { lat: 25.7617, lng: -80.1918 };
    }

    const avg = pendingPickups.reduce(
      (acc, stop) => ({ lat: acc.lat + stop.lat, lng: acc.lng + stop.lng }),
      { lat: 0, lng: 0 }
    );
    return {
      lat: avg.lat / pendingPickups.length,
      lng: avg.lng / pendingPickups.length,
    };
  })();

  const currentPoint = hasDriverLocation
    ? { lat: queryLat, lng: queryLng }
    : defaultStart;

  const remaining = [...pendingPickups];
  const ordered = [];
  let runningPoint = { ...currentPoint };
  let totalDistanceKm = 0;

  while (remaining.length > 0) {
    let nextIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    // Enforce strict date-first ordering: always choose from the earliest pickup day bucket.
    const minDaysUntilPickup = remaining.reduce((min, candidate) => {
      const value = Number.isFinite(candidate.daysUntilPickup) ? candidate.daysUntilPickup : 999;
      return Math.min(min, value);
    }, Number.POSITIVE_INFINITY);
    const candidatePool = remaining.filter((candidate) => {
      const value = Number.isFinite(candidate.daysUntilPickup) ? candidate.daysUntilPickup : 999;
      return value === minDaysUntilPickup;
    });

    for (const candidate of candidatePool) {
      const i = remaining.findIndex((stop) => stop.shipmentId === candidate.shipmentId);
      if (i < 0) continue;

      const distanceKm = haversineKm(runningPoint, candidate);
      const urgencyPenalty = candidate.serviceRank * 2.25;

      let datePenalty = 0;
      // Date has already been bucketed, so this is only a mild tiebreaker.
      if (candidate.daysUntilPickup <= 0) {
        datePenalty = -2;
      } else if (candidate.daysUntilPickup === 1) {
        datePenalty = -1;
      }

      const score = distanceKm + urgencyPenalty + datePenalty;
      if (score < bestScore) {
        bestScore = score;
        nextIndex = i;
      }
    }

    const [nextStop] = remaining.splice(nextIndex, 1);
    const legDistanceKm = haversineKm(runningPoint, nextStop);
    totalDistanceKm += legDistanceKm;

    ordered.push({
      ...nextStop,
      legDistanceKm: Number(legDistanceKm.toFixed(1)),
      cumulativeDistanceKm: Number(totalDistanceKm.toFixed(1)),
    });

    runningPoint = { lat: nextStop.lat, lng: nextStop.lng };
  }

  const avgCityDrivingKmh = 34;
  const stopHandlingMinutes = ordered.length * 9;
  const driveMinutes = (totalDistanceKm / avgCityDrivingKmh) * 60;
  const estimatedMinutes = Math.max(15, Math.round(stopHandlingMinutes + driveMinutes));

  const optimizedRoute = ordered.map(({ pickupDateValue, serviceRank, daysUntilPickup, ...stop }) => stop);

  res.json({
    route: optimizedRoute,
    totalStops: optimizedRoute.length,
    estimatedTime: `${Math.max(15, Math.round(estimatedMinutes))} minutes`,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    strategy: hasDriverLocation
      ? 'date windows (overdue/today first) -> distance from current location -> service urgency'
      : 'date windows (overdue/today first) -> distance clustering from stop centroid -> service urgency',
  });
});

ensureDataFile()
  .then(async () => {
    await purgeDemoDataIfNeeded();
    await seedDriverDemoData();
    const emailHealth = await getEmailHealthSnapshot();
    if (emailHealth.recommendations.length) {
      console.warn('[email-health:warnings]', {
        fromDomain: emailHealth.fromDomain || '(missing)',
        recommendations: emailHealth.recommendations,
      });
    }
    const { port: listeningPort } = await startServerWithPortRetry(port);
    activePort = listeningPort;
    if (listeningPort !== port) {
      console.warn(`[startup] Requested port ${port} was busy. Listening on port ${listeningPort}.`);
    }
    console.log(`API running on http://localhost:${listeningPort}`);
    startQuoteNudgeWorker();
    startScanAlertWorker();
  })
  .catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
