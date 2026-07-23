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
let scanAlertWorkerTimer = null;
let scanAlertTickInProgress = false;
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
const scanAlertsEnabled = String(process.env.SCAN_ALERTS_ENABLED || 'true').toLowerCase() === 'true';
const scanAlertIntervalMs = Math.max(60 * 1000, Number(process.env.SCAN_ALERT_INTERVAL_MS || 5 * 60 * 1000));
const scanRepeatWindowMs = Math.max(60 * 1000, Number(process.env.SCAN_REPEAT_WINDOW_MINUTES || 10) * 60 * 1000);
const scanRepeatThreshold = Math.max(2, Number(process.env.SCAN_REPEAT_THRESHOLD || 3));
const scanNoScanCutoffHour = Math.min(23, Math.max(0, Number(process.env.SCAN_NO_SCAN_CUTOFF_HOUR || 14)));

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
      scanEvents: [],
      routes: [],
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

async function sendEmail({ to, subject, text, html, mockTag = 'email' }) {
  const destination = String(to || '').trim();
  if (!destination || !subject || (!text && !html)) {
    return { delivered: false, mode: 'skipped', reason: 'missing-required-fields' };
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.NOTIFY_EMAIL) {
    console.log(`[${mockTag}:mock]`, { to: destination, subject, text: text || '(html-only email)' });
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
    text: text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    html
  });

  return { delivered: true, mode: 'smtp' };
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
  if (!Array.isArray(data.scanEvents)) data.scanEvents = [];
  if (!Array.isArray(data.shipments)) data.shipments = [];

  const sortByCreated = (items) => [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    counts: {
      rfqs: data.quotes.length,
      bookings: data.bookings.length,
      purchaseRequests: data.purchaseRequests.length,
      supportTickets: data.supportTickets.length,
      scanEvents: data.scanEvents.length,
      shipments: data.shipments.length,
    },
    rfqs: sortByCreated(data.quotes).slice(0, 12),
    recentBookings: sortByCreated(data.bookings).slice(0, 12),
    purchaseRequests: sortByCreated(data.purchaseRequests).slice(0, 12),
    supportTickets: sortByCreated(data.supportTickets).slice(0, 12),
    recentScans: sortByCreated(data.scanEvents).slice(0, 12),
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

  const adminEmail = buildPremiumQuoteAdminEmail(quote);
  await sendEmail({
    to: process.env.NOTIFY_EMAIL,
    subject: adminEmail.subject,
    text: adminEmail.text,
    html: adminEmail.html,
    mockTag: 'notification',
  });

  const customerEmail = buildPremiumQuoteCustomerEmail(quote);
  await sendEmail({
    to: quote.email,
    subject: customerEmail.subject,
    text: customerEmail.text,
    html: customerEmail.html,
    mockTag: 'quote-customer',
  });

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
    status: 'Pickup Scheduled',
    cargoType: payload.cargoType,
    quantity: payload.quantity,
    unitType,
    paymentStatus: 'pending',
    milestones: DEFAULT_MILESTONES
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
    message: 'Pickup scheduled successfully.'
  });
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

  const drivers = getActiveDrivers(data).map((d) => {
    const pending = getPendingAssignmentCount(data, d.id);
    const activeRoute = findActiveRouteForDriver(data, d.id);
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

  const pendingBookings = (data.bookings || [])
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
        status: shipment?.status || 'Pickup Scheduled',
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
    message: `Scan recorded for ${shipmentId}.`,
  });
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

  if (booking.assignedDriverId && booking.assignedDriverId !== req.user.sub) {
    return res.status(403).json({ error: 'This pickup is assigned to a different driver.' });
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

  res.json({ booking, shipment, activeRoute: activeRoute || null, message: 'Pickup confirmed.' });
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

    const overdueOrToday = remaining.filter((candidate) => candidate.daysUntilPickup <= 0);
    const tomorrow = remaining.filter((candidate) => candidate.daysUntilPickup === 1);
    const nearTerm = remaining.filter((candidate) => candidate.daysUntilPickup <= 3);
    const candidatePool = overdueOrToday.length
      ? overdueOrToday
      : tomorrow.length
        ? tomorrow
        : nearTerm.length
          ? nearTerm
          : remaining;

    for (const candidate of candidatePool) {
      const i = remaining.findIndex((stop) => stop.shipmentId === candidate.shipmentId);
      if (i < 0) continue;

      const distanceKm = haversineKm(runningPoint, candidate);
      const urgencyPenalty = candidate.serviceRank * 2.25;

      let datePenalty = 0;
      if (candidate.daysUntilPickup <= 0) {
        datePenalty = -28 + (Math.abs(candidate.daysUntilPickup) * 1.25);
      } else if (candidate.daysUntilPickup === 1) {
        datePenalty = -14;
      } else if (candidate.daysUntilPickup === 2) {
        datePenalty = -8;
      } else if (candidate.daysUntilPickup === 3) {
        datePenalty = -3;
      } else {
        datePenalty = candidate.daysUntilPickup * 1.9;
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
    await seedDriverDemoData();
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
      startQuoteNudgeWorker();
      startScanAlertWorker();
    });
  })
  .catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
