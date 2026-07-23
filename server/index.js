import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const DEFAULT_MILESTONES = [
  { label: 'Pickup Scheduled', done: true },
  { label: 'Picked Up', done: false },
  { label: 'At Miami Warehouse', done: false },
  { label: 'Loaded on Vessel', done: false },
  { label: 'Arrived in Kingston', done: false },
  { label: 'Customs Clearance', done: false },
  { label: 'Out for Delivery', done: false },
  { label: 'Delivered', done: false }
];

const DRIVER_DEMO_EMAIL = 'driver.demo@clearlogistics.test';
const DRIVER_DEMO_PASSWORD = 'Driver123!';
const DRIVER_DEMO_TOTAL_PICKUPS = 14;

const QUOTE_NUDGE_DEFAULT_STEPS_MS = [
  60 * 60 * 1000, // 1 hour
  24 * 60 * 60 * 1000, // 24 hours
  72 * 60 * 60 * 1000, // 72 hours
];

const app = express();
const port = Number(process.env.PORT || 8787);
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const publicApiBase = process.env.PUBLIC_API_BASE || `http://localhost:${port}`;
const dataFile = path.resolve(process.cwd(), 'server', 'data.json');
const uploadDir = path.resolve(process.cwd(), 'server', 'uploads');
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
let dataWriteQueue = Promise.resolve();
let quoteNudgeWorkerTimer = null;
let quoteNudgeTickInProgress = false;
const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || 'business@example.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(uploadDir));

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const nudgeEmailsEnabled = String(process.env.NUDGE_EMAILS_ENABLED || 'true').toLowerCase() === 'true';
const quoteNudgeIntervalMs = Math.max(15 * 1000, Number(process.env.NUDGE_INTERVAL_MS || 5 * 60 * 1000));
const quoteNudgeStepsMs = [
  Number(process.env.NUDGE_QUOTE_STEP_1_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[0]),
  Number(process.env.NUDGE_QUOTE_STEP_2_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[1]),
  Number(process.env.NUDGE_QUOTE_STEP_3_MS || QUOTE_NUDGE_DEFAULT_STEPS_MS[2]),
].filter((ms) => Number.isFinite(ms) && ms > 0);

async function ensureDataFile() {
  await fs.mkdir(uploadDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    const initial = {
      accounts: [
        {
          id: 'test-user-001',
          fullName: 'Test Customer',
          email: 'test@example.com',
          passwordHash: '$2b$10$.d83MyDSI9A2.qdDznEuduq3BbKpOIDkmczU6IZSCUndUBHLI9HG.', // password: password123
          phone: '+1-555-0100',
          address: '123 Test Street, New York, NY 10001',
          createdAt: new Date().toISOString()
        }
      ],
      drivers: [],
      quotes: [],
      bookings: [],
      purchaseRequests: [],
      supportTickets: [],
      shipments: [
        {
          shipmentId: 'CLF-10025',
          fullName: 'John',
          status: 'At Miami Warehouse',
          cargoType: 'Box',
          quantity: '3',
          unitType: 'Box',
          milestones: DEFAULT_MILESTONES
        }
      ]
    };
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
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.purchaseRequests)) data.purchaseRequests = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
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
  const { password, passwordHash, ...safeAccount } = account;
  return {
    ...safeAccount,
    role: resolveAccountRole(account)
  };
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

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function estimateQuoteRange(payload) {
  const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
  const length = Math.max(1, normalizeNumber(payload.dimensionsLength, 1));
  const width = Math.max(1, normalizeNumber(payload.dimensionsWidth, 1));
  const height = Math.max(1, normalizeNumber(payload.dimensionsHeight, 1));
  const volume = length * width * height;

  const declaredValueUsd = Math.max(0, normalizeNumber(payload.declaredValueUsd, 0));
  const valueFactor = Math.min(1.8, 1 + declaredValueUsd / 1000);

  const serviceMultiplier = payload.serviceLevel === 'Express'
    ? 1.35
    : payload.serviceLevel === 'Priority'
      ? 1.15
      : 1;

  const parishKey = String(payload.deliveryParish || '').toLowerCase();
  const remoteParishes = ['hanover', 'portland', 'st. mary', 'st mary', 'trelawny'];
  const parishMultiplier = remoteParishes.some((p) => parishKey.includes(p)) ? 1.08 : 1;

  const cargoBase = payload.cargoType === 'Barrel'
    ? 70
    : payload.cargoType === 'Pallet'
      ? 290
      : payload.cargoType === 'Commercial Freight'
        ? 340
        : 40;

  const dimensionalCharge = (volume / 1728) * 12; // cubic feet pricing basis
  const base = (cargoBase + dimensionalCharge) * quantity * serviceMultiplier * parishMultiplier * valueFactor;

  return {
    low: Math.max(25, Math.round(base * 0.88)),
    high: Math.max(30, Math.round(base * 1.18))
  };
}

function calculateWeightBasedQuote(payload) {
  const weight = Math.max(1, normalizeNumber(payload.weight, 1));
  const quantity = Math.max(1, normalizeNumber(payload.quantity, 1));
  const declaredValueUsd = Math.max(0, normalizeNumber(payload.declaredValueUsd, 0));

  const serviceMultiplier = payload.serviceLevel === 'Express'
    ? 1.35
    : payload.serviceLevel === 'Priority'
      ? 1.15
      : 1;

  const cargoPerLb = payload.cargoType === 'Commercial Freight'
    ? 2.4
    : payload.cargoType === 'Pallet'
      ? 1.85
      : payload.cargoType === 'Barrel'
        ? 1.65
        : 1.45;

  const valueFee = declaredValueUsd > 0 ? declaredValueUsd * 0.025 : 0;
  const total = ((weight * cargoPerLb * quantity) + valueFee) * serviceMultiplier;
  return Math.max(35, Math.round(total));
}

async function sendNotification(subject, body) {
  return sendEmail({
    to: process.env.NOTIFY_EMAIL,
    subject,
    text: body,
    mockTag: 'notification',
  });
}

async function sendEmail({ to, subject, text, mockTag = 'email' }) {
  const destination = String(to || '').trim();
  if (!destination || !subject || !text) {
    return { delivered: false, mode: 'skipped', reason: 'missing-required-fields' };
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.NOTIFY_EMAIL) {
    console.log(`[${mockTag}:mock]`, { to: destination, subject, text });
    return { delivered: false, mode: 'mock' };
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: destination,
    subject,
    text
  });

  return { delivered: true, mode: 'smtp' };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function toMillis(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : null;
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
  const unsubscribeUrl = `${publicApiBase}/api/quotes/${encodeURIComponent(quoteId)}/nudges/unsubscribe?email=${encodeURIComponent(String(quote?.email || ''))}`;

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

async function notifyCustomer({ channel, to, message, metadata = {} }) {
  const normalizedChannel = String(channel || '').toLowerCase();
  const destination = String(to || '').trim();
  if (!destination || !message) {
    return { delivered: false, reason: 'missing-destination-or-message' };
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
      status: 'Pickup Scheduled',
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
  }

  for (let i = 0; i < DRIVER_DEMO_TOTAL_PICKUPS; i += 1) {
    const demo = buildDemoPickup(i);
    const bookingExists = data.bookings.some((b) => b.shipmentId === demo.booking.shipmentId);
    if (!bookingExists) {
      data.bookings.push(demo.booking);
      hasChanges = true;
    }

    const shipmentExists = data.shipments.some((s) => s.shipmentId === demo.shipment.shipmentId);
    if (!shipmentExists) {
      data.shipments.push(demo.shipment);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    await writeData(data);
    console.log(`[seed] Driver demo account ready: ${DRIVER_DEMO_EMAIL} with ${DRIVER_DEMO_TOTAL_PICKUPS} sample pickups.`);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stripe: Boolean(stripe), timestamp: new Date().toISOString() });
});

app.post('/api/accounts', async (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email, and password are required.' });
  }

  const data = await readData();
  const existing = data.accounts.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Account already exists for this email.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const account = {
    id: randomUUID(),
    fullName,
    email,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  data.accounts.push(account);
  await writeData(data);
  await sendNotification('New Portal Account', `New account: ${fullName} <${email}>`);

  res.status(201).json({ account: sanitizeAccount(account) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const data = await readData();
  const accountIndex = data.accounts.findIndex((a) => a.email.toLowerCase() === String(email).toLowerCase());
  const account = accountIndex >= 0 ? data.accounts[accountIndex] : null;
  if (!account) {
    return res.status(401).json({ error: 'Invalid email or password.' });
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

  const token = createAuthToken(account);
  res.json({ user: sanitizeAccount(account), token });
});

app.get('/api/admin/overview', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.quotes)) data.quotes = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.purchaseRequests)) data.purchaseRequests = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const sortByCreated = (items) => [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    counts: {
      rfqs: data.quotes.length,
      bookings: data.bookings.length,
      purchaseRequests: data.purchaseRequests.length,
      supportTickets: data.supportTickets.length,
      shipments: data.shipments.length,
    },
    rfqs: sortByCreated(data.quotes).slice(0, 12),
    recentBookings: sortByCreated(data.bookings).slice(0, 12),
    purchaseRequests: sortByCreated(data.purchaseRequests).slice(0, 12),
    supportTickets: sortByCreated(data.supportTickets).slice(0, 12),
    shipments: sortByCreated(data.shipments).slice(0, 12),
  });
});

app.post('/api/quotes', async (req, res) => {
  const payload = req.body || {};
  const required = ['fullName', 'email', 'phone', 'cargoType', 'origin', 'destination', 'deliveryParish', 'itemCategory'];
  const missing = required.filter((k) => !payload[k]);

  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const weightUnknown = Boolean(payload.dontKnowWeight);
  if (!weightUnknown && !payload.weight) {
    return res.status(400).json({ error: 'weight is required unless dontKnowWeight is true.' });
  }

  if (weightUnknown) {
    const estimateRequired = ['quantity', 'dimensionsLength', 'dimensionsWidth', 'dimensionsHeight'];
    const estimateMissing = estimateRequired.filter((k) => !payload[k]);
    if (estimateMissing.length) {
      return res.status(400).json({ error: `Missing estimated quote fields: ${estimateMissing.join(', ')}` });
    }
  }

  const data = await readData();
  const estimatedRangeUsd = weightUnknown ? estimateQuoteRange(payload) : null;
  const quotedPriceUsd = weightUnknown ? null : calculateWeightBasedQuote(payload);

  const quote = {
    quoteId: `Q-${Date.now()}`,
    ...payload,
    pricingMode: weightUnknown ? 'estimated' : 'weight-based',
    estimatedRangeUsd,
    quotedPriceUsd,
    nudgesSent: [],
    nudgesOptOutAt: null,
    createdAt: new Date().toISOString()
  };

  data.quotes.push(quote);
  await writeData(data);
  await sendNotification('New Quote Request', `Quote ${quote.quoteId} from ${quote.fullName} (${quote.email})`);

  res.status(201).json({ quote, message: 'Quote request submitted.' });
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
    createdAt: new Date().toISOString()
  };

  data.bookings.push(booking);
  data.shipments.push({
    shipmentId,
    fullName: payload.fullName,
    status: 'Pickup Scheduled',
    cargoType: payload.cargoType,
    quantity: payload.quantity,
    unitType,
    paymentStatus: 'pending',
    milestones: DEFAULT_MILESTONES
  });

  await writeData(data);
  await sendNotification('New Shipment Booking', `Shipment ${shipmentId} booked by ${payload.fullName} - ${payload.quantity} x ${payload.unitType}`);

  res.status(201).json({ booking, shipmentId, message: 'Pickup scheduled successfully.' });
});

app.get('/api/shipments/:shipmentId', async (req, res) => {
  const data = await readData();
  const shipment = data.shipments.find((s) => s.shipmentId === req.params.shipmentId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }
  res.json({ shipment });
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

  if (!stripe) {
    return res.json({
      mode: 'mock',
      url: `${frontendUrl}/mock-checkout?referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}&amount=${amount}`,
      message: 'Stripe key not configured. Using mock checkout URL.'
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
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
      success_url: `${frontendUrl}/?payment=success&referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}`,
      cancel_url: `${frontendUrl}/?payment=cancelled&referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}`
    });

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
    if (shipment.status === 'Pickup Scheduled') {
      shipment.status = 'Payment Received';
    }
  }

  if (booking) {
    booking.paymentStatus = 'paid';
  }

  await writeData(data);
  await sendNotification('Payment Confirmed', `Shipment ${shipmentId} marked paid (${providerStatus || 'manual-confirm'}).`);

  res.json({ ok: true, shipmentId, paymentStatus: 'paid' });
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

  const data = await readData();
  if (!Array.isArray(data.drivers)) data.drivers = [];
  
  const driver = data.drivers.find((d) => d.email.toLowerCase() === String(email).toLowerCase());
  if (!driver) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordOk = await bcrypt.compare(password, driver.password);
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

app.get('/api/drivers/dashboard', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  // Return all pending pickups (shipments not yet picked up)
  const pickups = data.bookings
    .filter((b) => b.pickupDate && !b.pickedUp)
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
        status: shipment?.status || 'Pickup Scheduled',
        createdAt: b.createdAt
      };
    })
    .sort((a, b) => new Date(a.pickupDate) - new Date(b.pickupDate));

  res.json({ pickups, count: pickups.length });
});

app.put('/api/drivers/pickups/:shipmentId/confirm', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const { notes, photoUrl } = req.body || {};
  const shipmentId = req.params.shipmentId;

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const booking = data.bookings.find((b) => b.shipmentId === shipmentId);
  if (!booking) {
    return res.status(404).json({ error: 'Pickup not found.' });
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
  booking.pickupPhotoUrl = photoUrl;

  await writeData(data);
  await sendNotification('Pickup Confirmed', `Shipment ${shipmentId} picked up by ${req.user.fullName}`);

  res.json({ booking, shipment, message: 'Pickup confirmed.' });
});

app.get('/api/drivers/route-optimization', requireAuth, async (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Driver access required.' });
  }

  const data = await readData();
  if (!Array.isArray(data.bookings)) data.bookings = [];

  const cityPriority = {
    miami: 1,
    'fort lauderdale': 2,
    jacksonville: 3,
    orlando: 4,
    kissimmee: 5,
    tampa: 6,
  };

  const servicePriority = {
    Premium: 1,
    Standard: 2,
    Economy: 3,
  };

  const pendingPickups = data.bookings
    .filter((b) => b.pickupDate && !b.pickedUp)
    .map((b) => {
      const pickupCity = String(b.pickupCity || '').trim();
      const cityKey = pickupCity.toLowerCase();
      const zipDigits = Number(String(b.pickupZip || '').replace(/\D/g, '').slice(0, 5) || 99999);
      const pickupDateValue = Number.isFinite(Date.parse(b.pickupDate)) ? Date.parse(b.pickupDate) : Number.MAX_SAFE_INTEGER;
      const serviceRank = servicePriority[b.serviceLevel] || 9;

      return {
        shipmentId: b.shipmentId,
        pickupAddress: b.pickupAddress,
        pickupCity,
        pickupZip: b.pickupZip,
        pickupDate: b.pickupDate,
        serviceLevel: b.serviceLevel,
        cargoType: b.cargoType,
        cityRank: cityPriority[cityKey] || 99,
        zipDigits,
        pickupDateValue,
        serviceRank,
      };
    });

  const optimizedRoute = pendingPickups
    .sort((a, b) => {
      if (a.cityRank !== b.cityRank) return a.cityRank - b.cityRank;
      if (a.pickupDateValue !== b.pickupDateValue) return a.pickupDateValue - b.pickupDateValue;
      if (a.zipDigits !== b.zipDigits) return a.zipDigits - b.zipDigits;
      if (a.serviceRank !== b.serviceRank) return a.serviceRank - b.serviceRank;
      return String(a.shipmentId).localeCompare(String(b.shipmentId));
    })
    .map(({ cityRank, zipDigits, pickupDateValue, serviceRank, ...stop }) => stop);

  let citySwitches = 0;
  for (let i = 1; i < optimizedRoute.length; i += 1) {
    if (optimizedRoute[i].pickupCity !== optimizedRoute[i - 1].pickupCity) {
      citySwitches += 1;
    }
  }

  const baseMinutesPerStop = 12;
  const cityTransitionPenalty = 18;
  const estimatedMinutes = (optimizedRoute.length * baseMinutesPerStop) + (citySwitches * cityTransitionPenalty);

  res.json({
    route: optimizedRoute,
    totalStops: optimizedRoute.length,
    estimatedTime: `${Math.max(15, Math.round(estimatedMinutes))} minutes`,
    strategy: 'city -> pickupDate -> zip -> serviceLevel',
  });
});

ensureDataFile()
  .then(async () => {
    await seedDriverDemoData();
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
      startQuoteNudgeWorker();
    });
  })
  .catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
