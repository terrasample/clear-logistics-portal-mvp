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

const app = express();
const port = Number(process.env.PORT || 8787);
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const dataFile = path.resolve(process.cwd(), 'server', 'data.json');
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
let dataWriteQueue = Promise.resolve();
const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || 'business@example.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

app.use(cors({ origin: true }));
app.use(express.json());

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

async function ensureDataFile() {
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
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.NOTIFY_EMAIL) {
    console.log('[notification:mock]', subject, body);
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
    to: process.env.NOTIFY_EMAIL,
    subject,
    text: body
  });

  return { delivered: true, mode: 'smtp' };
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
    createdAt: new Date().toISOString()
  };

  data.quotes.push(quote);
  await writeData(data);
  await sendNotification('New Quote Request', `Quote ${quote.quoteId} from ${quote.fullName} (${quote.email})`);

  res.status(201).json({ quote, message: 'Quote request submitted.' });
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
    sizeColorSpecs: payload.sizeColorSpecs || '',
    budgetUsd: Number(payload.budgetUsd),
    notes: payload.notes || '',
    createdAt: new Date().toISOString(),
    status: 'Received'
  };

  data.purchaseRequests.push(purchaseRequest);
  await writeData(data);
  await sendNotification('New Purchase Assistance Request', `Request ${purchaseRequest.requestId} from ${purchaseRequest.fullName}`);

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
  const shipmentId = req.body?.shipmentId || 'TBD';

  if (!stripe) {
    return res.json({
      mode: 'mock',
      url: `${frontendUrl}/mock-checkout?shipmentId=${encodeURIComponent(shipmentId)}&amount=${amount}`,
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
              name: `Shipment Deposit ${shipmentId}`
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      success_url: `${frontendUrl}/?payment=success&shipmentId=${encodeURIComponent(shipmentId)}`,
      cancel_url: `${frontendUrl}/?payment=cancelled&shipmentId=${encodeURIComponent(shipmentId)}`
    });

    res.json({ mode: 'stripe', url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to create Stripe checkout session.' });
  }
});

app.post('/api/payments/confirm', async (req, res) => {
  const shipmentId = String(req.body?.shipmentId || '').trim();
  const providerStatus = String(req.body?.providerStatus || '').trim();

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

  const pickups = data.bookings
    .filter((b) => b.pickupDate && !b.pickedUp)
    .map((b) => ({
      shipmentId: b.shipmentId,
      lat: 28.3949 + (Math.random() - 0.5) * 0.5, // Simulated lat around Miami
      lng: -81.4872 + (Math.random() - 0.5) * 0.5, // Simulated lng around Miami
      address: b.pickupAddress,
      city: b.pickupCity,
      zip: b.pickupZip
    }));

  // Simple distance sorting (in production, use actual routing API)
  const optimizedRoute = pickups.sort((a, b) => {
    const distA = Math.abs(a.lat - 28.3949) + Math.abs(a.lng + 81.4872);
    const distB = Math.abs(b.lat - 28.3949) + Math.abs(b.lng + 81.4872);
    return distA - distB;
  });

  res.json({
    route: optimizedRoute,
    totalStops: optimizedRoute.length,
    estimatedTime: `${Math.round(optimizedRoute.length * 15)} minutes`
  });
});

ensureDataFile()
  .then(() => {
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
