import { useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE
  || (window.location.hostname === 'localhost'
    ? 'http://localhost:8787/api'
    : `${window.location.origin}/api`);

const NAV_ITEMS = [
  {
    key: 'services',
    label: 'Services',
    isPrimary: true,
    targetPath: '/book-pickup',
    activePaths: ['book-pickup', 'booking'],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    targetPath: '/quote',
    activePaths: ['quote'],
  },
  {
    key: 'track',
    label: 'Track',
    targetPath: '/tracking',
    activePaths: ['tracking'],
  },
  {
    key: 'shop',
    label: 'Shop & Ship',
    targetPath: '/shop',
    activePaths: ['shop'],
  },
  {
    key: 'ai-estimator',
    label: 'AI Estimator',
    targetPath: '/cart-estimator',
    activePaths: ['cart-estimator'],
  },
  {
    key: 'support',
    label: 'Support',
    targetPath: '/support',
    activePaths: ['support'],
  },
];

const JAMAICA_LOCATIONS_WITH_PARISHES = [
  { city: 'Kingston', parish: 'Kingston' },
  { city: 'Saint Andrew', parish: 'Saint Andrew' },
  { city: 'Portmore', parish: 'St. Catherine' },
  { city: 'Spanish Town', parish: 'St. Catherine' },
  { city: 'Montego Bay', parish: 'Saint James' },
  { city: 'Mandeville', parish: 'Manchester' },
  { city: 'Negril', parish: 'Westmoreland' },
  { city: 'Savanna-la-Mar', parish: 'Westmoreland' },
  { city: 'Morant Bay', parish: 'Saint Thomas' },
  { city: 'Port Antonio', parish: 'Portland' },
  { city: 'Ocho Rios', parish: 'Saint Ann' },
  { city: 'Runaway Bay', parish: 'Saint Ann' },
  { city: 'Other', parish: 'Other' },
];

const JAMAICA_PARISHES = [
  'Kingston',
  'Saint Andrew',
  'St. Catherine',
  'Saint Thomas',
  'Portland',
  'Saint Mary',
  'St. Ann',
  'Trelawny',
  'Saint James',
  'Hanover',
  'Westmoreland',
  'Manchester',
  'Clarendon',
  'Saint Elizabeth',
];

const SERVICE_TIERS = [
  { name: 'Economy', days: '14-18', multiplier: 0.85, label: 'Drop-off/consolidated' },
  { name: 'Standard', days: '7-12', multiplier: 1.0, label: 'Pickup + shipping + delivery' },
  { name: 'Premium', days: '3-5', multiplier: 1.35, label: 'Priority handling' },
];

const HOW_IT_WORKS = [
  {
    key: 'book-online',
    title: 'Book Online',
    summary: 'Tell us what you\'re shipping and when we should pick it up.',
    icon: '📦',
  },
  {
    key: 'pickup',
    title: 'We Pick It Up',
    summary: 'Our drivers arrive at your location and collect your shipment.',
    icon: '🚚',
  },
  {
    key: 'ship',
    title: 'We Ship It',
    summary: 'Your cargo is prepared, loaded, and dispatched to Jamaica.',
    icon: '🚢',
  },
  {
    key: 'customs',
    title: 'Customs Clearance',
    summary: 'Broker partners handle all documentation and clearance.',
    icon: '✅',
  },
  {
    key: 'delivery',
    title: 'Delivered',
    summary: 'Final-mile delivery to your door in Jamaica.',
    icon: '🎉',
  },
];

const TRUST_INDICATORS = [
  'Secure Payments',
  'Real-Time Tracking',
  'USA Pickup Service',
  'Jamaica Delivery',
  'Professional Customer Support',
];

const QUOTE_RESPONSE_GUARANTEE = {
  title: '10-Minute Response Guarantee',
  summary: 'A logistics specialist follows up within 10 minutes during business hours, or your quote is tagged VIP Priority at no extra cost.',
};

const SUPPLY_CATALOG = [
  {
    key: 'barrels',
    field: 'addonBarrels',
    label: 'Shipping Barrels',
    description: 'Durable food-grade barrel with lid and seal ring.',
    unitPriceUsd: 45,
  },
  {
    key: 'boxes',
    field: 'addonBoxes',
    label: 'Heavy-Duty Boxes',
    description: 'Reinforced moving box for household and retail items.',
    unitPriceUsd: 8,
  },
  {
    key: 'containers',
    field: 'addonContainers',
    label: 'Utility Cargo Containers',
    description: 'Stackable rigid tote for consolidated shipment loads.',
    unitPriceUsd: 30,
  },
  {
    key: 'packingKits',
    field: 'addonPackingKits',
    label: 'Packing Supply Kits',
    description: 'Tape, shrink wrap, labels, and markers bundled together.',
    unitPriceUsd: 12,
  },
];

const BARREL_CATALOG = [
  {
    sku: 'BRL-55-STANDARD',
    name: 'Standard 55-Gallon Barrel + Lid',
    description: 'Food-grade plastic barrel with locking ring for general household shipping.',
    bestFor: 'Clothing, pantry items, household goods',
    unitPriceUsd: 45,
  },
  {
    sku: 'BRL-55-HEAVY',
    name: 'Heavy-Duty 55-Gallon Barrel + Lid',
    description: 'Thicker-wall barrel for heavier mixed loads and repeat commercial use.',
    bestFor: 'Bulk groceries, denser mixed cargo',
    unitPriceUsd: 58,
  },
  {
    sku: 'BRL-30-COMPACT',
    name: 'Compact 30-Gallon Barrel + Lid',
    description: 'Smaller-format barrel for lighter shipments and easier last-mile handling.',
    bestFor: 'Smaller family orders, lightweight items',
    unitPriceUsd: 36,
  },
];

const BOX_PRESETS = [
  { key: 'small', label: 'Small (16 x 12 x 12)', length: 16, width: 12, height: 12 },
  { key: 'medium', label: 'Medium (18 x 18 x 16)', length: 18, width: 18, height: 16 },
  { key: 'large', label: 'Large (24 x 18 x 18)', length: 24, width: 18, height: 18 },
  { key: 'xl', label: 'XL (24 x 24 x 24)', length: 24, width: 24, height: 24 },
  { key: 'custom', label: 'Custom size', length: '', width: '', height: '' },
];

const BOOKING_DRAFT_KEY = 'clf_booking_draft_v1';

const PRICING = [
  { lane: 'Barrel (Standard)', eta: '10-15 business days', from: '$85' },
  { lane: 'Box (Medium)', eta: '7-12 business days', from: '$45' },
  { lane: 'Pallet (Commercial)', eta: '12-18 business days', from: '$395' },
];

const POPULAR_STORES = [
  { name: 'Amazon', icon: 'A', logo: 'https://icons.duckduckgo.com/ip3/www.amazon.com.ico', url: 'https://www.amazon.com' },
  { name: 'Walmart', icon: 'W', logo: 'https://icons.duckduckgo.com/ip3/www.walmart.com.ico', url: 'https://www.walmart.com' },
  { name: 'Target', icon: 'T', logo: 'https://icons.duckduckgo.com/ip3/www.target.com.ico', url: 'https://www.target.com' },
  { name: 'Best Buy', icon: 'BB', logo: 'https://icons.duckduckgo.com/ip3/www.bestbuy.com.ico', url: 'https://www.bestbuy.com' },
  { name: 'Shein', icon: 'S', logo: 'https://icons.duckduckgo.com/ip3/www.shein.com.ico', url: 'https://www.shein.com' },
  { name: 'Temu', icon: 'Te', logo: 'https://icons.duckduckgo.com/ip3/www.temu.com.ico', url: 'https://www.temu.com' },
  { name: 'eBay', icon: 'eB', logo: 'https://icons.duckduckgo.com/ip3/www.ebay.com.ico', url: 'https://www.ebay.com' },
  { name: 'Macy\'s', icon: 'M', logo: 'https://icons.duckduckgo.com/ip3/www.macys.com.ico', url: 'https://www.macys.com' },
  { name: 'Nike', icon: 'N', logo: 'https://icons.duckduckgo.com/ip3/www.nike.com.ico', url: 'https://www.nike.com' },
  { name: 'Adidas', icon: 'Ad', logo: 'https://icons.duckduckgo.com/ip3/www.adidas.com.ico', url: 'https://www.adidas.com' },
  { name: 'Home Depot', icon: 'HD', logo: 'https://icons.duckduckgo.com/ip3/www.homedepot.com.ico', url: 'https://www.homedepot.com' },
  { name: 'Lowe\'s', icon: 'L', logo: 'https://icons.duckduckgo.com/ip3/www.lowes.com.ico', url: 'https://www.lowes.com' },
  { name: 'Costco', icon: 'C', logo: 'https://icons.duckduckgo.com/ip3/www.costco.com.ico', url: 'https://www.costco.com' },
  { name: 'Sam\'s Club', icon: 'SC', logo: 'https://icons.duckduckgo.com/ip3/www.samsclub.com.ico', url: 'https://www.samsclub.com' },
  { name: 'Old Navy', icon: 'ON', logo: 'https://icons.duckduckgo.com/ip3/oldnavy.gap.com.ico', url: 'https://oldnavy.gap.com' },
  { name: 'Ulta Beauty', icon: 'Ul', logo: 'https://icons.duckduckgo.com/ip3/www.ulta.com.ico', url: 'https://www.ulta.com' },
  { name: 'Sephora', icon: 'Se', logo: 'https://icons.duckduckgo.com/ip3/www.sephora.com.ico', url: 'https://www.sephora.com' },
  { name: 'H&M', icon: 'HM', logo: 'https://icons.duckduckgo.com/ip3/www2.hm.com.ico', url: 'https://www2.hm.com' },
  { name: 'Louis Vuitton', icon: 'LV', logo: 'https://icons.duckduckgo.com/ip3/us.louisvuitton.com.ico', url: 'https://us.louisvuitton.com' },
  { name: 'Gucci', icon: 'Gu', logo: 'https://icons.duckduckgo.com/ip3/www.gucci.com.ico', url: 'https://www.gucci.com' },
  { name: 'Dior', icon: 'Di', logo: 'https://icons.duckduckgo.com/ip3/www.dior.com.ico', url: 'https://www.dior.com' },
  { name: 'Chanel', icon: 'Ch', logo: 'https://icons.duckduckgo.com/ip3/www.chanel.com.ico', url: 'https://www.chanel.com' },
  { name: 'Balenciaga', icon: 'Ba', logo: 'https://icons.duckduckgo.com/ip3/www.balenciaga.com.ico', url: 'https://www.balenciaga.com' },
  { name: 'Zara', icon: 'Za', logo: 'https://icons.duckduckgo.com/ip3/www.zara.com.ico', url: 'https://www.zara.com' },
  { name: 'ASOS', icon: 'As', logo: 'https://icons.duckduckgo.com/ip3/www.asos.com.ico', url: 'https://www.asos.com' },
  { name: 'Fashion Nova', icon: 'FN', logo: 'https://icons.duckduckgo.com/ip3/www.fashionnova.com.ico', url: 'https://www.fashionnova.com' },
  { name: 'Nordstrom', icon: 'No', logo: 'https://icons.duckduckgo.com/ip3/www.nordstrom.com.ico', url: 'https://www.nordstrom.com' },
  { name: 'Bloomingdale\'s', icon: 'Bl', logo: 'https://icons.duckduckgo.com/ip3/www.bloomingdales.com.ico', url: 'https://www.bloomingdales.com' },
  { name: 'Saks Fifth Avenue', icon: 'Sa', logo: 'https://icons.duckduckgo.com/ip3/www.saksfifthavenue.com.ico', url: 'https://www.saksfifthavenue.com' },
  { name: 'Neiman Marcus', icon: 'Ne', logo: 'https://icons.duckduckgo.com/ip3/www.neimanmarcus.com.ico', url: 'https://www.neimanmarcus.com' },
];



const OPERATING_SYSTEM_FLOW = [
  'Customer',
  'Customer Portal',
  'Dispatch',
  'Pickup Driver',
  'Warehouse',
  'Ocean Carrier',
  'Customs Broker',
  'Delivery Driver',
  'Customer',
];

const BUSINESS_FEATURES = [
  'Recurring shipment scheduling',
  'Monthly invoicing and payment terms',
  'Bulk and lane-based pricing support',
  'Dedicated account coordination',
];

const PERSONAL_FEATURES = [
  'Door-to-door household shipping',
  'Simple quote and pickup booking',
  'Live shipment milestone updates',
  'Fast support for delivery questions',
];

const SITE_MAP = [
  'Home',
  'Services: Freight Shipping, Air Freight, Vehicle Imports, Commercial Freight, Door-to-Door',
  'Shipping Information',
  'Service Policy',
  'Track Shipment',
  'Get a Quote',
  'Shop & Ship',
  'Book Pickup',
  'Contact Support',
];

const WHATSAPP_PHONE = '13055550100';
const BOOKING_TAB_LABEL = 'Services';
const BOOKING_PAGE_LABEL = 'Book Pickup';
const SHOP_AND_SHIP_HELP_EMAIL = 'support@clearlogistics.com';

const CHATBOT_PROMPTS = [
  {
    label: 'How do I book a shipment?',
    answer: `Click ${BOOKING_TAB_LABEL}, open ${BOOKING_PAGE_LABEL}, complete the 5 booking steps, then log in to finalize shipment and payment.`
  },
  {
    label: 'How do I find my shipment ID?',
    answer: 'Use the shipment ID shown on your Dashboard, booking confirmation, or payment confirmation message.'
  },
  {
    label: 'How do I track my shipment?',
    answer: 'Open Track Shipment and enter your shipment ID. The tracking page will show milestones and progress.'
  },
  {
    label: 'How does payment work?',
    answer: 'After booking, the shipment goes to payment checkout. When payment completes, the shipment is marked paid and can be tracked.'
  },
  {
    label: 'Do you have a FAQ page?',
    answer: 'Yes. Open the FAQ page from the footer for common shipping, payment, customs, and tracking questions.'
  },
  {
    label: 'How do I contact support?',
    answer: 'Use Contact Support in the navigation or footer, or tap WhatsApp for a quick message.'
  },
];

function getChatbotReply(message) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return 'Ask me about booking, tracking, payment, FAQs, and support contact.';
  }

  if (normalized.includes('book') || normalized.includes('shipment')) {
    return `To book, click ${BOOKING_TAB_LABEL}, open ${BOOKING_PAGE_LABEL}, complete the 5 steps, then log in to finalize shipment and payment.`;
  }

  if (normalized.includes('track') || normalized.includes('status') || normalized.includes('shipment id')) {
    return 'Go to Track Shipment and enter your shipment ID from your Dashboard or confirmation message.';
  }

  if (normalized.includes('pay') || normalized.includes('payment') || normalized.includes('checkout')) {
    return 'Payments start after the shipment is created. Once checkout is completed, the shipment is marked paid.';
  }

  if (normalized.includes('faq') || normalized.includes('questions')) {
    return 'Yes, there is a FAQ page in the footer with booking, payment, customs, and tracking answers.';
  }

  if (normalized.includes('whatsapp') || normalized.includes('chat')) {
    return 'Tap the WhatsApp button in the bottom-right corner to open a quick support message.';
  }

  if (normalized.includes('demo') || normalized.includes('test')) {
    return 'For security and data integrity, each account only sees its own shipments. Sign in and use your own shipment ID from Dashboard.';
  }

  return 'I can help with booking, tracking, payment, FAQs, and support contact. Try one of the suggested questions.';
}

function createEmptyShopItem() {
  return {
    name: '',
    link: '',
    quantity: 1,
    unitPriceUsd: '',
    selectedForBooking: true,
  };
}

const LUXURY_STORE_KEYWORDS = ['louis vuitton', 'gucci', 'dior', 'chanel', 'balenciaga', 'saks', 'neiman', 'bloomingdale'];

function inferCategoryFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('phone-case') || lower.includes('case') || lower.includes('cover') || lower.includes('charger') || lower.includes('cable') || lower.includes('airtag') || lower.includes('accessory')) return 'Accessories';
  if (lower.includes('laptop') || lower.includes('phone') || lower.includes('camera') || lower.includes('electronics') || lower.includes('tablet') || lower.includes('monitor')) return 'Electronics';
  if (lower.includes('dress') || lower.includes('shirt') || lower.includes('shoe') || lower.includes('fashion')) return 'Fashion';
  if (lower.includes('beauty') || lower.includes('makeup') || lower.includes('skincare')) return 'Beauty';
  if (lower.includes('furniture') || lower.includes('home')) return 'Home';
  return 'General';
}

function inferDefaultPrice(category) {
  if (category === 'Accessories') return 32;
  if (category === 'Electronics') return 380;
  if (category === 'Fashion') return 160;
  if (category === 'Beauty') return 85;
  if (category === 'Home') return 210;
  return 120;
}

function isCartStyleUrl(url) {
  const lower = String(url || '').toLowerCase();
  return lower.includes('/cart') || lower.includes('/gp/cart') || lower.includes('view.html?ref_=nav_cart');
}

function normalizeWebUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(input)) {
    return `https://${input}`;
  }
  return input;
}

function getStoreNameFromUrl(url) {
  try {
    const host = new URL(normalizeWebUrl(url)).hostname.replace('www.', '');
    const match = POPULAR_STORES.find((store) => host.includes(new URL(store.url).hostname.replace('www.', '')));
    if (match) return match.name;
    return host.split('.')[0];
  } catch {
    return 'Online Store';
  }
}

function extractProductNameFromUrl(url) {
  const toTitleCase = (value) => value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const cleanSlug = (slug) => {
    const tokens = String(slug || '').split('-').filter(Boolean);
    const filtered = tokens.filter((token) => {
      const lower = token.toLowerCase();
      if (/^s\d+[a-z]*$/.test(lower)) return false;
      if (lower.startsWith('nvprod')) return false;
      if (/^[a-z]{1,2}\d{4,}[a-z0-9]*$/i.test(token)) return false;
      return true;
    });
    return filtered.join(' ').trim();
  };

  try {
    const urlObj = new URL(normalizeWebUrl(url));
    const pathname = urlObj.pathname;
    
    // Extract product name from common URL patterns
    // Pattern 1: /products/product-name (Shopify, etc.)
    const productMatch = pathname.match(/\/products?\/([\w-]+)/);
    if (productMatch) {
      const cleaned = cleanSlug(productMatch[1]);
      return cleaned ? toTitleCase(cleaned) : null;
    }
    
    // Pattern 2: Look in query parameters (some stores)
    const searchParams = urlObj.searchParams;
    if (searchParams.has('title')) return searchParams.get('title');
    
    // Pattern 3: Last segment of URL path (Amazon, etc.)
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // Clean up - remove IDs, codes, etc.
      let cleaned = decodeURIComponent(lastSegment);
      cleaned = cleaned.replace(/-?([a-z0-9]{10,}|[A-Z0-9]{5,}|\/.*)/g, '').trim();
      if (cleaned.length > 3) return toTitleCase(cleaned.replace(/-/g, ' '));
    }
    
    return null;
  } catch {
    return null;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { stepKey } = useParams();
  const currentPath = location.pathname.replace(/^\/+/, '') || 'home';

  const [accountForm, setAccountForm] = useState({
    fullName: '',
    email: '',
    password: '',
  });

  const [quoteForm, setQuoteForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    cargoType: 'Box',
    serviceLevel: 'Standard',
    itemCategory: '',
    origin: 'Miami, FL',
    destination: 'Kingston, Jamaica',
    deliveryParish: '',
    declaredValueUsd: '',
    weight: '',
    dontKnowWeight: false,
    quantity: '1',
    dimensionsLength: '',
    dimensionsWidth: '',
    dimensionsHeight: '',
    addonBarrels: '0',
    addonBoxes: '0',
    addonContainers: '0',
    addonPackingKits: '0',
    barrelPurchaseQty: '0',
    needsPackingSupplies: false,
    vipConcierge: false,
  });

  const [bookingForm, setBookingForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    cargoType: 'Box',
    quantity: '1',
    unitType: 'Box',
    pickupDate: '',
    pickupAddress: '',
    pickupCity: 'Jacksonville',
    pickupZip: '',
    dimensionsLength: '',
    dimensionsWidth: '',
    dimensionsHeight: '',
    weightPerUnit: '',
    boxMode: 'standardized',
    boxPreset: 'medium',
    notes: '',
    jamaicaRecipient: '',
    jamaicaAddress: '',
    jamaicaLocation: 'Kingston',
    deliveryParish: 'Kingston',
    serviceLevel: 'Standard',
    estimatedValue: '',
    addonBarrels: '0',
    addonBoxes: '0',
    addonContainers: '0',
    addonPackingKits: '0',
    packingDeclaration: false,
    agreementAccepted: false,
  });
  const [bookingBoxItems, setBookingBoxItems] = useState([]);
  const [lastSavedQuoteId, setLastSavedQuoteId] = useState('');

  const [bookingStep, setBookingStep] = useState(1);
  const [shipmentId, setShipmentId] = useState('');
  const [bookingQrCode, setBookingQrCode] = useState('');

  const [supportForm, setSupportForm] = useState({
    fullName: '',
    email: '',
    shipmentId: '',
    message: '',
  });

  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });

  const [purchaseForm, setPurchaseForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    storeName: 'Amazon',
    sizeColorSpecs: '',
    notes: '',
    notifyWhatsApp: true,
    notifySms: false,
  });
  const [shopItems, setShopItems] = useState([createEmptyShopItem()]);
  const [shopDocs, setShopDocs] = useState({
    invoiceUrl: '',
    idUrl: '',
    importPermitUrl: '',
    declarationAccepted: false,
  });
  const [shopDocUploadState, setShopDocUploadState] = useState({
    invoiceUrl: { uploading: false, fileName: '', error: '' },
    idUrl: { uploading: false, fileName: '', error: '' },
    importPermitUrl: { uploading: false, fileName: '', error: '' },
  });
  const [estimatorLinks, setEstimatorLinks] = useState('');
  const [estimatorSubtotalInput, setEstimatorSubtotalInput] = useState('');
  const [estimatorProductPricesInput, setEstimatorProductPricesInput] = useState('');
  const [estimatorResult, setEstimatorResult] = useState(null);

  const [instantQuoteForm, setInstantQuoteForm] = useState({
    origin: 'Miami, FL',
    destination: 'Kingston, Jamaica',
    cargoType: 'Box',
    weight: '',
  });
  const [instantQuoteResult, setInstantQuoteResult] = useState(null);

  const [trackingId, setTrackingId] = useState('');
  const [trackingResult, setTrackingResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState('');
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [customerShipments, setCustomerShipments] = useState([]);
  const [customerQuotes, setCustomerQuotes] = useState([]);
  const [customerProfile, setCustomerProfile] = useState({
    fullName: '',
    email: '',
    customerReference: '',
    usReceivingAddress: '',
  });
  const [customerDashboardLoading, setCustomerDashboardLoading] = useState(false);
  const [retryingQuoteId, setRetryingQuoteId] = useState('');
  const [dispatcherData, setDispatcherData] = useState(null);
  const [dispatcherReassignMap, setDispatcherReassignMap] = useState({});
  const [activeAdminSection, setActiveAdminSection] = useState('rfqs');
  const [selectedAdminItem, setSelectedAdminItem] = useState(null);
  const [shopAccessMode, setShopAccessMode] = useState('');
  const [showShopBookingPrompt, setShowShopBookingPrompt] = useState(false);
  const [shopBookingPromptDismissedKey, setShopBookingPromptDismissedKey] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: 'Hi, I can help with booking, tracking, payment, FAQs, and support.'
    }
  ]);
  const chatMessageIdRef = useRef(0);
  const chatMessagesRef = useRef(null);
  const shopCheckoutButtonRef = useRef(null);

  // Phase 2: Driver app state
  const [driverAuthToken, setDriverAuthToken] = useState(localStorage.getItem('driverAuthToken') || null);
  const [driverUser, setDriverUser] = useState(JSON.parse(localStorage.getItem('driverUser') || 'null'));
  const [driverPickups, setDriverPickups] = useState([]);
  const [driverRecentScans, setDriverRecentScans] = useState([]);
  const [driverRoute, setDriverRoute] = useState([]);
  const [activeDriverRoute, setActiveDriverRoute] = useState(null);
  const [driverRouteMeta, setDriverRouteMeta] = useState({ totalStops: 0, estimatedTime: '', totalDistanceKm: 0 });
  const [driverLoginForm, setDriverLoginForm] = useState({ email: '', password: '' });
  const [driverRegisterForm, setDriverRegisterForm] = useState({ fullName: '', email: '', password: '', phone: '', vehicle: '' });
  const [driverMode, setDriverMode] = useState('login');

  useEffect(() => {
    const lower = String(statusMessage || '').toLowerCase();
    if (lower.includes('did not match the expected pattern') || lower.includes('expected pattern')) {
      const friendly = 'One or more links are invalid. Use full links like https://www.amazon.com/... before continuing.';
      if (statusMessage !== friendly) {
        setStatusMessage(friendly);
      }
    }
  }, [statusMessage]);
  const [scannedShipmentId, setScannedShipmentId] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [pickupConfirmation, setPickupConfirmation] = useState({ notes: '', photoUrl: '' });
  const [pickupPhotoUploadState, setPickupPhotoUploadState] = useState({ uploading: false, fileName: '', error: '' });
  const [pickupConfirmLoading, setPickupConfirmLoading] = useState(false);

  function clearCustomerSessionState() {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setAuthToken('');
    setCustomerShipments([]);
    setCustomerQuotes([]);
    setCustomerProfile({
      fullName: '',
      email: '',
      customerReference: '',
      usReceivingAddress: '',
    });
    setCustomerDashboardLoading(false);
    setRetryingQuoteId('');
    setAdminOverview(null);
    setDispatcherData(null);
    window.localStorage.removeItem('clf_auth_token');
    window.localStorage.removeItem('clf_auth_user');
  }

  function clearDriverSessionState() {
    localStorage.removeItem('driverAuthToken');
    localStorage.removeItem('driverUser');
    setDriverAuthToken(null);
    setDriverUser(null);
    setDriverPickups([]);
    setDriverRecentScans([]);
    setDriverRoute([]);
    setActiveDriverRoute(null);
    setDriverRouteMeta({ totalStops: 0, estimatedTime: '', totalDistanceKm: 0 });
    setScannedShipmentId('');
    setScanInput('');
    setPickupConfirmation({ notes: '', photoUrl: '' });
    setPickupPhotoUploadState({ uploading: false, fileName: '', error: '' });
    setPickupConfirmLoading(false);
    setDriverMode('login');
  }

  useEffect(() => {
    const savedToken = window.localStorage.getItem('clf_auth_token');
    const savedUser = window.localStorage.getItem('clf_auth_user');
    const savedDriverToken = window.localStorage.getItem('driverAuthToken');
    const savedDriverUser = window.localStorage.getItem('driverUser');

    let parsedUser = null;
    let parsedDriverUser = null;

    if (savedToken && savedUser) {
      try {
        parsedUser = JSON.parse(savedUser);
        setAuthToken(savedToken);
        setCurrentUser(parsedUser);
        setIsAuthenticated(true);
      } catch {
        parsedUser = null;
        window.localStorage.removeItem('clf_auth_token');
        window.localStorage.removeItem('clf_auth_user');
      }
    }

    if (savedDriverToken) {
      try {
        parsedDriverUser = savedDriverUser ? JSON.parse(savedDriverUser) : null;
      } catch {
        parsedDriverUser = null;
      }
      setDriverAuthToken(savedDriverToken);
      setDriverUser(parsedDriverUser);
    }

    // Enforce one active session type at startup to prevent role/routing conflicts.
    if (savedToken && parsedUser && savedDriverToken) {
      if (location.pathname.startsWith('/driver')) {
        window.localStorage.removeItem('clf_auth_token');
        window.localStorage.removeItem('clf_auth_user');
        setIsAuthenticated(false);
        setCurrentUser(null);
        setAuthToken('');
      } else {
        localStorage.removeItem('driverAuthToken');
        localStorage.removeItem('driverUser');
        setDriverAuthToken(null);
        setDriverUser(null);
      }
    }

    setAuthHydrated(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setShopAccessMode('account');
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!chatOpen || !chatMessagesRef.current) {
      return;
    }

    chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (!driverAuthToken) {
      setDriverPickups([]);
      setDriverRecentScans([]);
      setActiveDriverRoute(null);
      return;
    }

    fetchDriverPickups(driverAuthToken);
    fetchDriverRecentScans(driverAuthToken);
    fetchDriverActiveRoute(driverAuthToken);
  }, [driverAuthToken]);

  useEffect(() => {
    if (isAuthenticated && currentUser?.role === 'admin' && authToken && !adminOverview) {
      fetchAdminOverview(authToken);
    }

    if (isAuthenticated && currentUser?.role !== 'admin' && authToken) {
      fetchCustomerDashboard(authToken);
    }

    if (!isAuthenticated || currentUser?.role !== 'admin') {
      setAdminOverview(null);
      setDispatcherData(null);
    }

    if (!isAuthenticated || currentUser?.role === 'admin') {
      setCustomerShipments([]);
      setCustomerQuotes([]);
    }
  }, [isAuthenticated, currentUser?.role, authToken]);

  function buildQuoteEmailStatusLine(emailStatus) {
    const customerStatus = emailStatus?.customer || null;
    if (!customerStatus) {
      return ' Quote saved. Email status unavailable.';
    }

    if (customerStatus.delivered) {
      const route = customerStatus.provider || customerStatus.mode || 'email';
      return ` Confirmation email sent via ${route}.`;
    }

    if (customerStatus.mode === 'mock') {
      return ' Quote saved, but email was not sent because the system is in test mode.';
    }

    return ' Quote saved, but confirmation email failed to send. You can retry from your dashboard.';
  }

  function getQuoteDeliveryPresentation(emailStatus) {
    const status = emailStatus || null;

    if (!status) {
      return {
        label: 'Email status unavailable',
        color: '#6b7280',
        canRetry: false,
      };
    }

    if (status.delivered) {
      return {
        label: `Email sent (${status.provider || status.mode || 'delivery'})`,
        color: '#0b6b61',
        canRetry: false,
      };
    }

    if (status.mode === 'mock') {
      return {
        label: 'Email not sent (test mode)',
        color: '#6b7280',
        canRetry: false,
      };
    }

    const errorHint = status.code || status.reason || 'delivery failure';
    return {
      label: `Email failed (${errorHint})`,
      color: '#8a4b08',
      canRetry: true,
    };
  }

  async function handleRetryQuoteEmail(quoteId) {
    if (!authToken || !quoteId) {
      return;
    }

    setRetryingQuoteId(quoteId);
    setStatusMessage('Retrying confirmation email...');
    try {
      const response = await fetch(`${API_BASE}/customer/quotes/${encodeURIComponent(quoteId)}/retry-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to retry confirmation email.');

      const customerStatus = result.emailStatus?.customer || null;
      setCustomerQuotes((prev) => prev.map((quote) => (
        quote.quoteId === quoteId
          ? { ...quote, emailStatus: customerStatus }
          : quote
      )));

      if (customerStatus?.delivered) {
        setStatusMessage('Confirmation email sent successfully.');
      } else if (customerStatus?.mode === 'mock') {
        setStatusMessage('Retry executed, but email is in test mode and was not sent.');
      } else {
        const errorHint = customerStatus?.code || customerStatus?.reason || 'delivery failure';
        setStatusMessage(`Retry failed: ${errorHint}.`);
      }
    } catch (error) {
      setStatusMessage(error.message || 'Unable to retry confirmation email right now.');
    } finally {
      setRetryingQuoteId('');
    }
  }

  function handleQuoteChange(event) {
    const { name, value, type, checked } = event.target;
    setQuoteForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  function handleBookingChange(event) {
    const { name, value, type, checked } = event.target;
    setBookingForm((prev) => {
      const next = { ...prev, [name]: type === 'checkbox' ? checked : value };

      if (name === 'cargoType' && value !== 'Box') {
        next.boxMode = 'standardized';
      }

      if (name === 'boxPreset') {
        const preset = BOX_PRESETS.find((item) => item.key === value);
        if (preset && value !== 'custom') {
          next.dimensionsLength = String(preset.length);
          next.dimensionsWidth = String(preset.width);
          next.dimensionsHeight = String(preset.height);
        }
      }

      return next;
    });
  }

  function handleBookingBoxItemChange(index, field, value) {
    setBookingBoxItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  }

  function getSupplyAddons(formLike) {
    return SUPPLY_CATALOG.map((item) => {
      const quantity = Math.max(0, Number(formLike?.[item.field] || 0));
      return {
        key: item.key,
        label: item.label,
        quantity,
        unitPriceUsd: item.unitPriceUsd,
        totalUsd: quantity * item.unitPriceUsd,
      };
    }).filter((item) => item.quantity > 0);
  }

  function calculateSupplyAddonsTotal(formLike) {
    return getSupplyAddons(formLike).reduce((sum, item) => sum + item.totalUsd, 0);
  }

  function getBookingTotalWeight(formLike, boxItems = []) {
    if (formLike?.cargoType === 'Box' && formLike?.boxMode === 'mixed') {
      return boxItems.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0);
    }

    const quantity = Math.max(1, Number(formLike?.quantity || 1));
    const weightPerUnit = Math.max(0, Number(formLike?.weightPerUnit || 0));
    return quantity * weightPerUnit;
  }

  function calculateBookingServicePrice(formLike, boxItems = []) {
    const totalWeight = getBookingTotalWeight(formLike, boxItems);
    if (!totalWeight) return 0;
    const baseCost = totalWeight * 1.25;
    const serviceMult = SERVICE_TIERS.find((t) => t.name === formLike.serviceLevel)?.multiplier || 1;
    return Math.round(baseCost * serviceMult);
  }

  function normalizeBookingBoxItems(items) {
    return (items || []).map((item, idx) => ({
      label: item.label || `Box ${idx + 1}`,
      weight: String(item.weight || ''),
      length: String(item.length || ''),
      width: String(item.width || ''),
      height: String(item.height || ''),
    }));
  }

  useEffect(() => {
    if (bookingForm.cargoType !== 'Box' || bookingForm.boxMode !== 'mixed') {
      return;
    }

    const targetQty = Math.max(1, Number(bookingForm.quantity || 1));
    setBookingBoxItems((prev) => {
      const next = [...prev];

      while (next.length < targetQty) {
        next.push({
          label: `Box ${next.length + 1}`,
          weight: bookingForm.weightPerUnit || '',
          length: bookingForm.dimensionsLength || '',
          width: bookingForm.dimensionsWidth || '',
          height: bookingForm.dimensionsHeight || '',
        });
      }

      return next.slice(0, targetQty);
    });
  }, [bookingForm.cargoType, bookingForm.boxMode, bookingForm.quantity, bookingForm.weightPerUnit, bookingForm.dimensionsLength, bookingForm.dimensionsWidth, bookingForm.dimensionsHeight]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BOOKING_DRAFT_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed?.bookingForm) {
        setBookingForm((prev) => ({ ...prev, ...parsed.bookingForm }));
      }
      if (Array.isArray(parsed?.bookingBoxItems)) {
        setBookingBoxItems(parsed.bookingBoxItems);
      }
      if (parsed?.bookingStep && Number(parsed.bookingStep) >= 1 && Number(parsed.bookingStep) <= 5) {
        setBookingStep(Number(parsed.bookingStep));
      }
    } catch {
      // Ignore malformed drafts.
    }
  }, []);

  useEffect(() => {
    const payload = {
      bookingForm,
      bookingBoxItems,
      bookingStep: Math.min(5, bookingStep),
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // Ignore localStorage limitations.
    }
  }, [bookingForm, bookingBoxItems, bookingStep]);

  async function handleSaveQuoteFromBooking() {
    const requiredDraftFields = ['fullName', 'email', 'phone', 'cargoType', 'quantity'];
    const missing = requiredDraftFields.filter((field) => !bookingForm[field]);
    if (missing.length) {
      setStatusMessage('Draft saved locally. Add name, email, phone, cargo type, and quantity to save an official quote.');
      return;
    }

    const totalWeight = getBookingTotalWeight(bookingForm, bookingBoxItems);
    const hasDimensions = bookingForm.dimensionsLength && bookingForm.dimensionsWidth && bookingForm.dimensionsHeight;
    if (!totalWeight && !hasDimensions) {
      setStatusMessage('Draft saved locally. Add weight or dimensions so we can generate a quote ID.');
      return;
    }

    setIsLoading(true);
    try {
      const supplyAddons = getSupplyAddons(bookingForm);
      const supplyAddonsTotalUsd = calculateSupplyAddonsTotal(bookingForm);
      const quotePayload = {
        fullName: bookingForm.fullName,
        email: bookingForm.email,
        phone: bookingForm.phone,
        cargoType: bookingForm.cargoType,
        serviceLevel: bookingForm.serviceLevel || 'Standard',
        itemCategory: bookingForm.cargoType,
        origin: `${bookingForm.pickupCity || 'Miami'}, FL`,
        destination: `${bookingForm.jamaicaLocation || 'Kingston'}, Jamaica`,
        deliveryParish: bookingForm.deliveryParish || 'Kingston',
        declaredValueUsd: bookingForm.estimatedValue || '',
        quantity: bookingForm.quantity,
        dontKnowWeight: totalWeight <= 0,
        weight: totalWeight > 0 ? String(totalWeight) : '',
        dimensionsLength: bookingForm.dimensionsLength || '',
        dimensionsWidth: bookingForm.dimensionsWidth || '',
        dimensionsHeight: bookingForm.dimensionsHeight || '',
        addonBarrels: bookingForm.addonBarrels || '0',
        addonBoxes: bookingForm.addonBoxes || '0',
        addonContainers: bookingForm.addonContainers || '0',
        addonPackingKits: bookingForm.addonPackingKits || '0',
        supplyAddons,
        supplyAddonsTotalUsd,
        bookingDraft: true,
        boxMode: bookingForm.boxMode,
        boxPreset: bookingForm.boxPreset,
        boxItems: bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed'
          ? normalizeBookingBoxItems(bookingBoxItems)
          : [],
      };

      const response = await fetch(`${API_BASE}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotePayload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save quote.');

      setLastSavedQuoteId(result.quote?.quoteId || '');
      setStatusMessage(`Quote saved: ${result.quote?.quoteId || 'saved'}. You can continue booking and pay later.`);
    } catch (error) {
      setStatusMessage(error.message || 'Unable to save quote right now. Your draft is still saved locally.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleAccountChange(event) {
    const { name, value } = event.target;
    setAccountForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleSupportChange(event) {
    const { name, value } = event.target;
    setSupportForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleLoginChange(event) {
    const { name, value } = event.target;
    setLoginForm((prev) => ({ ...prev, [name]: value }));
  }

  function handlePurchaseChange(event) {
    const { name, value, type, checked } = event.target;
    setPurchaseForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  function handleShopDocChange(event) {
    const { name, value, type, checked } = event.target;
    setShopDocs((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  function handleShopItemChange(index, field, value) {
    setShopItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  }

  function addShopItem() {
    setShopItems((prev) => [...prev, createEmptyShopItem()]);
  }

  function removeShopItem(index) {
    setShopItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }

  function addBarrelToShopCart(barrel) {
    const barrelItem = {
      name: `${barrel.name} (${barrel.sku})`,
      link: 'https://clear-logistics-portal.onrender.com/shop#barrel-catalog',
      quantity: 1,
      unitPriceUsd: String(barrel.unitPriceUsd),
      selectedForBooking: true,
    };

    setShopItems((prev) => {
      const first = prev[0] || {};
      const firstEmpty =
        prev.length === 1
        && !String(first.name || '').trim()
        && !String(first.link || '').trim()
        && (String(first.quantity || '1') === '1')
        && !String(first.unitPriceUsd || '').trim();

      if (firstEmpty) {
        return [barrelItem];
      }

      return [...prev, barrelItem];
    });

    if (!isAuthenticated && shopAccessMode !== 'guest') {
      setShopAccessMode('guest');
    }

    setStatusMessage(`${barrel.name} added to Shop & Ship cart.`);
  }

  async function fileToBase64(file) {
    const arrayBuffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }

  async function uploadShopDocument(file, fieldName) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage('Document exceeds 5MB limit. Please upload a smaller file.');
      return;
    }

    setShopDocUploadState((prev) => ({
      ...prev,
      [fieldName]: { uploading: true, fileName: file.name, error: '' },
    }));

    try {
      const dataBase64 = await fileToBase64(file);
      const response = await fetch(`${API_BASE}/uploads/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          dataBase64,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to upload document.');

      setShopDocs((prev) => ({ ...prev, [fieldName]: result.url }));
      setShopDocUploadState((prev) => ({
        ...prev,
        [fieldName]: { uploading: false, fileName: file.name, error: '' },
      }));
    } catch (error) {
      setShopDocUploadState((prev) => ({
        ...prev,
        [fieldName]: { uploading: false, fileName: file.name, error: error.message },
      }));
      setStatusMessage(error.message);
    }
  }

  function handleShopDocFileChange(event, fieldName) {
    const file = event.target.files?.[0];
    if (file) {
      uploadShopDocument(file, fieldName);
    }
  }

  function runLinkEstimator() {
    const links = estimatorLinks
      .split('\n')
      .map((line) => normalizeWebUrl(line.trim()))
      .filter(Boolean);

    if (!links.length) {
      setStatusMessage('Paste at least one product or cart link to estimate landed cost.');
      return;
    }

    const cartLinks = links.filter((link) => isCartStyleUrl(link));
    const productLinks = links.filter((link) => !isCartStyleUrl(link));
    const hasCartLink = cartLinks.length > 0;
    const manualSubtotal = Number(estimatorSubtotalInput);
    const hasValidManualSubtotal = Number.isFinite(manualSubtotal) && manualSubtotal > 0;
    const productPriceLines = estimatorProductPricesInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedProductPrices = productPriceLines.map((line) => Number(line.replace(/[$,]/g, '')));
    const hasValidProductPrices = parsedProductPrices.length === productLinks.length
      && parsedProductPrices.every((price) => Number.isFinite(price) && price > 0);

    if (hasCartLink && !hasValidManualSubtotal) {
      setStatusMessage('Cart links detected. Enter the actual store subtotal to improve accuracy.');
      return;
    }

    if (productLinks.length > 0 && !hasValidProductPrices) {
      setStatusMessage('Product links detected. Enter exact item prices (USD), one per product link, in the same order.');
      return;
    }

    const inferredItems = productLinks.map((link, index) => {
      const category = inferCategoryFromUrl(link);
      const store = getStoreNameFromUrl(link);
      const extractedName = extractProductNameFromUrl(link);
      const name = extractedName || `${category} item` || `Item ${index + 1}`;

      return {
        name,
        link,
        quantity: 1,
        unitPriceUsd: Number(parsedProductPrices[index].toFixed(2)),
        category,
        store,
        sourceType: 'manual-product-price',
      };
    });

    const cartItems = hasCartLink && hasValidManualSubtotal
      ? [
          {
            name: `${getStoreNameFromUrl(cartLinks[0])} cart subtotal`,
            link: normalizeWebUrl(cartLinks[0]),
            quantity: 1,
            unitPriceUsd: Number(manualSubtotal.toFixed(2)),
            category: 'General',
            store: getStoreNameFromUrl(cartLinks[0]),
            sourceType: 'cart-subtotal',
          },
        ]
      : [];

    const estimatedItems = [...cartItems, ...inferredItems];

    const subtotal = estimatedItems.reduce((sum, item) => sum + item.unitPriceUsd * item.quantity, 0);
    const hasLuxury = estimatedItems.some((item) => LUXURY_STORE_KEYWORDS.some((k) => `${item.store} ${item.link}`.toLowerCase().includes(k)));
    const customs = subtotal * (hasLuxury ? 0.24 : 0.16);
    const brokerage = subtotal > 0 ? 35 : 0;
    const processing = subtotal * 0.05;
    const shipping = subtotal * 0.09;
    const total = subtotal + customs + brokerage + processing + shipping;
    const unknownCount = inferredItems.filter((item) => item.category === 'General').length;
    const confidence = Math.max(72, Math.min(95, Math.round(93 - unknownCount * 5 - (hasLuxury ? 8 : 0))));
    const confidenceLabel = confidence >= 82 ? 'High' : confidence >= 68 ? 'Medium' : 'Low';

    const missing = [];
    if (unknownCount > 0) missing.push('Add exact product category for more accurate duty estimation.');
    if (hasCartLink && productLinks.length === 0) missing.push('Paste key product links too if you want better duty-category precision.');
    if (estimatedItems.some((item) => item.unitPriceUsd >= 300)) missing.push('Confirm actual store cart totals for high-value items.');
    if (hasLuxury) missing.push('Luxury goods may require additional customs review and supporting invoice details.');

    setEstimatorResult({
      estimatedItems,
      subtotal,
      customs,
      brokerage,
      processing,
      shipping,
      total,
      confidence,
      confidenceLabel,
      missing,
      hasLuxury,
      inputSummary: {
        totalLinks: links.length,
        cartLinks: cartLinks.length,
        productLinks: productLinks.length,
        manualSubtotalUsed: hasCartLink && hasValidManualSubtotal,
        exactProductPricesUsed: productLinks.length > 0,
      },
      rateSummary: {
        customsRate: hasLuxury ? 0.24 : 0.16,
        processingRate: 0.05,
        shippingRate: 0.09,
        brokerageFlat: brokerage,
      },
    });
    setStatusMessage(`Estimate generated with ${confidenceLabel} confidence.`);
  }

  function applyEstimatorToCart() {
    if (!estimatorResult?.estimatedItems?.length) {
      setStatusMessage('Run estimator first to create cart items.');
      return false;
    }

    const items = estimatorResult.estimatedItems.map((item) => ({
      name: item.name,
      link: item.link,
      quantity: String(item.quantity),
      unitPriceUsd: String(item.unitPriceUsd),
      selectedForBooking: true,
    }));
    setShopItems(items);
    if (estimatorResult.estimatedItems[0]?.store) {
      setPurchaseForm((prev) => ({ ...prev, storeName: estimatorResult.estimatedItems[0].store }));
    }
    setStatusMessage('Estimated cart imported. Review values before checkout.');
    return true;
  }

  const normalizedShopItems = useMemo(() => (
    shopItems
      .map((item) => ({
        name: String(item.name || '').trim(),
        link: String(item.link || '').trim(),
        quantity: Math.max(1, Number(item.quantity || 1)),
        unitPriceUsd: Math.max(0, Number(item.unitPriceUsd || 0)),
        selectedForBooking: item.selectedForBooking !== false,
      }))
      .filter((item) => item.name && item.link)
  ), [shopItems]);

  const selectedShopItems = useMemo(() => (
    normalizedShopItems.filter((item) => item.selectedForBooking)
  ), [normalizedShopItems]);

  const remainingShopItems = useMemo(() => (
    normalizedShopItems.filter((item) => !item.selectedForBooking)
  ), [normalizedShopItems]);

  const cartSubtotalUsd = useMemo(() => (
    selectedShopItems.reduce((sum, item) => sum + item.quantity * item.unitPriceUsd, 0)
  ), [selectedShopItems]);

  const remainingItemTotalUsd = useMemo(() => (
    remainingShopItems.reduce((sum, item) => sum + item.quantity * item.unitPriceUsd, 0)
  ), [remainingShopItems]);

  const hasLuxuryBrand = useMemo(() => {
    const joined = `${purchaseForm.storeName} ${selectedShopItems.map((item) => item.name).join(' ')}`.toLowerCase();
    return LUXURY_STORE_KEYWORDS.some((keyword) => joined.includes(keyword));
  }, [purchaseForm.storeName, selectedShopItems]);

  const customsDutyUsd = useMemo(() => Number((cartSubtotalUsd * (hasLuxuryBrand ? 0.24 : 0.16)).toFixed(2)), [cartSubtotalUsd, hasLuxuryBrand]);
  const brokerageFeeUsd = useMemo(() => Number((cartSubtotalUsd > 0 ? 35 : 0).toFixed(2)), [cartSubtotalUsd]);
  const processingFeeUsd = useMemo(() => Number((cartSubtotalUsd * 0.05).toFixed(2)), [cartSubtotalUsd]);
  const shippingFeeUsd = useMemo(() => Number((cartSubtotalUsd * 0.09).toFixed(2)), [cartSubtotalUsd]);
  const landedTotalUsd = useMemo(() => Number((cartSubtotalUsd + customsDutyUsd + brokerageFeeUsd + processingFeeUsd + shippingFeeUsd).toFixed(2)), [cartSubtotalUsd, customsDutyUsd, brokerageFeeUsd, processingFeeUsd, shippingFeeUsd]);

  const docsRequired = useMemo(() => cartSubtotalUsd >= 500 || hasLuxuryBrand, [cartSubtotalUsd, hasLuxuryBrand]);
  const requiredDocCount = docsRequired ? 2 : 0;
  const uploadedRequiredDocs = [shopDocs.invoiceUrl, shopDocs.idUrl].filter(Boolean).length;
  const customsReadyScore = useMemo(() => {
    const base = docsRequired ? Math.round((uploadedRequiredDocs / requiredDocCount) * 75) : 75;
    const declarationPoints = shopDocs.declarationAccepted ? 25 : 0;
    return Math.min(100, base + declarationPoints);
  }, [docsRequired, uploadedRequiredDocs, requiredDocCount, shopDocs.declarationAccepted]);

  const isCustomsReady = useMemo(() => {
    if (!shopDocs.declarationAccepted) return false;
    if (!docsRequired) return true;
    return uploadedRequiredDocs >= requiredDocCount;
  }, [docsRequired, uploadedRequiredDocs, requiredDocCount, shopDocs.declarationAccepted]);

  const shopBookingPromptKey = useMemo(() => {
    const itemCount = selectedShopItems.length;
    return `${itemCount}-${landedTotalUsd.toFixed(2)}-${customsReadyScore}`;
  }, [selectedShopItems.length, landedTotalUsd, customsReadyScore]);

  useEffect(() => {
    const canPrompt = (
      location.pathname === '/shop'
      && (isAuthenticated || shopAccessMode === 'guest')
      && cartSubtotalUsd > 0
      && isCustomsReady
      && !isLoading
    );

    if (!canPrompt) {
      setShowShopBookingPrompt(false);
      return;
    }

    if (shopBookingPromptDismissedKey === shopBookingPromptKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowShopBookingPrompt(true);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    location.pathname,
    isAuthenticated,
    shopAccessMode,
    cartSubtotalUsd,
    isCustomsReady,
    isLoading,
    shopBookingPromptDismissedKey,
    shopBookingPromptKey,
  ]);

  function getNextChatMessageId(prefix) {
    chatMessageIdRef.current += 1;
    return `${prefix}-${Date.now()}-${chatMessageIdRef.current}`;
  }

  function sendChatMessage(rawMessage) {
    const message = String(rawMessage || '').trim();
    if (!message) {
      return;
    }

    const response = getChatbotReply(message);
    setChatMessages((prev) => [
      ...prev,
      { id: getNextChatMessageId('user'), role: 'user', text: message },
      { id: getNextChatMessageId('assistant'), role: 'assistant', text: response },
    ]);
    setChatInput('');
    setChatOpen(true);
  }

  function sendSuggestedChatPrompt(prompt) {
    setChatMessages((prev) => [
      ...prev,
      { id: getNextChatMessageId('user'), role: 'user', text: prompt.label },
      { id: getNextChatMessageId('assistant'), role: 'assistant', text: prompt.answer },
    ]);
    setChatInput('');
    setChatOpen(true);
  }

  function handleChatSubmit(event) {
    event.preventDefault();
    sendChatMessage(chatInput);
  }

  function openWhatsApp() {
    const message = encodeURIComponent('Hi, I need help with booking/shipment tracking on Clear Logistics & Freight Services.');
    window.open(`https://wa.me/${WHATSAPP_PHONE}?text=${message}`, '_blank', 'noopener,noreferrer');
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create account.');
      setStatusMessage(`Account created for ${result.account.fullName}.`);
      setAccountForm({ fullName: '', email: '', password: '' });
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleQuoteSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const quoteSupplyAddons = getSupplyAddons(quoteForm);
      const quoteSupplyAddonsTotalUsd = calculateSupplyAddonsTotal(quoteForm);
      const payload = {
        ...quoteForm,
        weight: quoteForm.dontKnowWeight ? '' : quoteForm.weight,
        supplyAddons: quoteSupplyAddons,
        supplyAddonsTotalUsd: quoteSupplyAddonsTotalUsd,
        barrelPurchaseQty: String(Math.max(0, Number(quoteForm.addonBarrels || 0))),
        needsPackingSupplies: Number(quoteForm.addonPackingKits || 0) > 0,
      };
      const response = await fetch(`${API_BASE}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit quote request.');
      const modeLabel = result.quote?.pricingMode === 'estimated' ? 'Estimated' : 'Weight-based';
      const range = result.quote?.estimatedRangeUsd
        ? ` Estimated range: $${result.quote.estimatedRangeUsd.low} - $${result.quote.estimatedRangeUsd.high}.`
        : '';
      const premiumFlags = [];
      if (Number(result.quote?.barrelPurchaseQty || 0) > 0) premiumFlags.push('barrel add-on');
      if (result.quote?.needsPackingSupplies) premiumFlags.push('packing supplies');
      if (result.quote?.vipConcierge) premiumFlags.push('VIP concierge');
      if (Number(result.quote?.supplyAddonsTotalUsd || 0) > 0) premiumFlags.push(`supplies total $${Number(result.quote.supplyAddonsTotalUsd).toFixed(2)}`);
      const premiumLine = premiumFlags.length ? ` Premium options: ${premiumFlags.join(', ')}.` : '';
      const emailLine = buildQuoteEmailStatusLine(result.emailStatus);
      setStatusMessage(`Quote request submitted: ${result.quote.quoteId}. ${modeLabel} pricing mode.${range}${premiumLine}${emailLine}`);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePurchaseSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      if (!normalizedShopItems.length) {
        throw new Error('Add at least one cart item with product name and link.');
      }

      if (!selectedShopItems.length) {
        throw new Error('Select at least one item to include in Book Now checkout.');
      }

      if (cartSubtotalUsd <= 0) {
        throw new Error('Enter a unit price for at least one item to continue to checkout.');
      }

      if (!isCustomsReady) {
        throw new Error('Complete the Customs Ready checklist before checkout.');
      }

      const amountCents = Math.round(landedTotalUsd * 100);
      const needsAdminReview = hasLuxuryBrand || landedTotalUsd >= 1500 || (estimatorResult && estimatorResult.confidence < 70);

      const response = await fetch(`${API_BASE}/purchase-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...purchaseForm,
          productLinks: selectedShopItems.map((item) => item.link),
          items: selectedShopItems,
          deferredItems: remainingShopItems,
          deferredItemTotalUsd: Number(remainingItemTotalUsd.toFixed(2)),
          budgetUsd: landedTotalUsd,
          cartSubtotalUsd,
          customsDutyUsd,
          brokerageFeeUsd,
          processingFeeUsd,
          shippingFeeUsd,
          totalUsd: landedTotalUsd,
          needsAdminReview,
          docsRequired,
          customsReadyScore,
          customsReady: isCustomsReady,
          documents: {
            invoiceUrl: shopDocs.invoiceUrl || '',
            idUrl: shopDocs.idUrl || '',
            importPermitUrl: shopDocs.importPermitUrl || '',
            declarationAccepted: shopDocs.declarationAccepted,
          },
          notificationPreferences: {
            whatsapp: Boolean(purchaseForm.notifyWhatsApp),
            sms: Boolean(purchaseForm.notifySms),
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit purchase request.');

      const requestId = result.purchaseRequest?.requestId;
      if (!requestId) {
        throw new Error('Purchase request created, but missing request ID for checkout.');
      }

      const checkoutResponse = await fetch(`${API_BASE}/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountCents,
          referenceType: 'purchase_request',
          referenceId: requestId,
        }),
      });
      const checkoutResult = await checkoutResponse.json();
      if (!checkoutResponse.ok) throw new Error(checkoutResult.error || 'Unable to start checkout.');
      if (!checkoutResult.url) throw new Error('Checkout setup failed. Missing checkout URL.');

      setStatusMessage(`Purchase request submitted: ${requestId}. Redirecting to checkout.`);
      setPurchaseForm({
        fullName: '',
        email: '',
        phone: '',
        storeName: 'Amazon',
        sizeColorSpecs: '',
        notes: '',
        notifyWhatsApp: true,
        notifySms: false,
      });
      setShopItems([createEmptyShopItem()]);
      setShopDocs({
        invoiceUrl: '',
        idUrl: '',
        importPermitUrl: '',
        declarationAccepted: false,
      });
      setShopDocUploadState({
        invoiceUrl: { uploading: false, fileName: '', error: '' },
        idUrl: { uploading: false, fileName: '', error: '' },
        importPermitUrl: { uploading: false, fileName: '', error: '' },
      });
      setEstimatorLinks('');
      setEstimatorSubtotalInput('');
      setEstimatorProductPricesInput('');
      setEstimatorResult(null);
      window.location.assign(checkoutResult.url);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function generateShipmentId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(5, '0');
    return `CL-${random}`;
  }

  function generateQrCode(text) {
    // Simple QR-like placeholder using data URL (in production, use a QR library)
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
  }

  function focusFirstInvalidField(fieldNames) {
    for (const fieldName of fieldNames) {
      const element = document.querySelector(`[name="${fieldName}"]`);
      if (!element) {
        continue;
      }

      const isCheckbox = element.type === 'checkbox';
      const isInvalid = isCheckbox ? !element.checked : !element.value;

      if (isInvalid) {
        element.focus();
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
    }

    return false;
  }

  function validateBookingStep(step) {
    const stepFieldMap = {
      1: ['fullName', 'email', 'phone', 'pickupAddress', 'pickupCity', 'pickupZip', 'pickupDate'],
      2: ['cargoType', 'quantity', 'weightPerUnit'],
      3: ['jamaicaRecipient', 'jamaicaAddress', 'jamaicaLocation', 'deliveryParish'],
      4: ['serviceLevel'],
      5: ['packingDeclaration', 'agreementAccepted'],
    };

    if (step === 1) {
      if (!bookingForm.fullName || !bookingForm.email || !bookingForm.phone || !bookingForm.pickupAddress || !bookingForm.pickupCity || !bookingForm.pickupZip || !bookingForm.pickupDate) {
        focusFirstInvalidField(stepFieldMap[1]);
        setStatusMessage('Please complete all pickup fields before continuing.');
        return false;
      }
    }

    if (step === 2) {
      if (!bookingForm.cargoType || !bookingForm.quantity || Number(bookingForm.quantity) < 1 || !bookingForm.weightPerUnit || Number(bookingForm.weightPerUnit) < 1) {
        focusFirstInvalidField(stepFieldMap[2]);
        setStatusMessage('Please provide valid shipment details before continuing.');
        return false;
      }

      if (bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed') {
        const hasInvalidBox = bookingBoxItems.some((box) => {
          const hasWeight = Number(box.weight || 0) > 0;
          const dimsBlank = !box.length && !box.width && !box.height;
          const hasPartialDims = [box.length, box.width, box.height].some(Boolean) && ![box.length, box.width, box.height].every(Boolean);
          return !hasWeight || hasPartialDims || dimsBlank;
        });
        if (hasInvalidBox) {
          setStatusMessage('For mixed boxes, add weight for each box and either fill all dimensions or leave all dimensions blank.');
          return false;
        }
      }
    }

    if (step === 3) {
      if (!bookingForm.jamaicaRecipient || !bookingForm.jamaicaAddress || !bookingForm.jamaicaLocation || !bookingForm.deliveryParish) {
        focusFirstInvalidField(stepFieldMap[3]);
        setStatusMessage('Please complete all Jamaica delivery details before continuing.');
        return false;
      }
    }

    if (step === 4) {
      if (!bookingForm.serviceLevel) {
        focusFirstInvalidField(stepFieldMap[4]);
        setStatusMessage('Please select a service level before continuing.');
        return false;
      }
    }

    if (step === 5) {
      if (!bookingForm.packingDeclaration || !bookingForm.agreementAccepted) {
        focusFirstInvalidField(stepFieldMap[5]);
        setStatusMessage('Please accept both declarations before creating your shipment.');
        return false;
      }
    }

    return true;
  }

  function handleBookingStepNext() {
    if (bookingStep < 5 && validateBookingStep(bookingStep)) {
      setStatusMessage('');
      setBookingStep(bookingStep + 1);
    }
  }

  function handleBookingStepBack() {
    if (bookingStep > 1) {
      setBookingStep(bookingStep - 1);
    }
  }

  async function handleBookingSubmit(event) {
    event.preventDefault();
    if (!validateBookingStep(5)) {
      return;
    }

    if (!isAuthenticated || !authToken) {
      setStatusMessage('Please log in to finalize your shipment and proceed to payment.');
      navigate('/login', { state: { from: '/book-pickup' } });
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    try {
      const bookingSupplyAddons = getSupplyAddons(bookingForm);
      const bookingSupplyAddonsTotalUsd = calculateSupplyAddonsTotal(bookingForm);
      const response = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          ...bookingForm,
          unitType: bookingForm.cargoType,
          totalWeight: getBookingTotalWeight(bookingForm, bookingBoxItems),
          boxItems: bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed'
            ? normalizeBookingBoxItems(bookingBoxItems)
            : [],
          supplyAddons: bookingSupplyAddons,
          supplyAddonsTotalUsd: bookingSupplyAddonsTotalUsd,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Unable to create shipment.');
      }

      const createdShipmentId = result.shipmentId || generateShipmentId();
      const qrUrl = generateQrCode(createdShipmentId);
      setShipmentId(createdShipmentId);
      setTrackingId(createdShipmentId);
      setBookingQrCode(qrUrl);
      setStatusMessage(`Shipment ${createdShipmentId} created. Review the QR code, then continue to payment.`);
      setBookingStep(6); // Confirmation/payment step
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('expired') || String(error.message || '').toLowerCase().includes('authentication')) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setAuthToken('');
        window.localStorage.removeItem('clf_auth_token');
        window.localStorage.removeItem('clf_auth_user');
        navigate('/login', { state: { from: '/book-pickup' } });
      }
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSupportSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supportForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit support request.');
      setStatusMessage(`Support ticket created: ${result.ticket.ticketId}.`);
      setSupportForm((prev) => ({ ...prev, message: '' }));
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleTrackShipment() {
    if (!trackingId.trim()) {
      setTrackingResult(null);
      setStatusMessage('Enter a valid shipment ID to track your shipment.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/shipments/${trackingId.trim()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Shipment not found.');
      setTrackingResult(result.shipment);
      setStatusMessage(`Shipment ${result.shipment.shipmentId} status: ${result.shipment.status}.`);
    } catch (error) {
      setTrackingResult(null);
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchAdminOverview(token = authToken) {
    if (!token) {
      return;
    }

    setAdminLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load admin dashboard.');
      setAdminOverview(result);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setAdminLoading(false);
    }
  }

  async function fetchCustomerDashboard(token = authToken) {
    if (!token) {
      return;
    }

    setCustomerDashboardLoading(true);
    try {
      const response = await fetch(`${API_BASE}/customer/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load your dashboard.');
      setCustomerShipments(Array.isArray(result.shipments) ? result.shipments : []);
      setCustomerQuotes(Array.isArray(result.quotes) ? result.quotes : []);
      const profile = result.profile || {};
      setCustomerProfile({
        fullName: String(profile.fullName || currentUser?.fullName || ''),
        email: String(profile.email || currentUser?.email || ''),
        customerReference: String(profile.customerReference || currentUser?.customerReference || ''),
        usReceivingAddress: String(profile.usReceivingAddress || currentUser?.usReceivingAddress || ''),
      });
    } catch (error) {
      setStatusMessage(error.message);
      setCustomerShipments([]);
      setCustomerQuotes([]);
      setCustomerProfile({
        fullName: String(currentUser?.fullName || ''),
        email: String(currentUser?.email || ''),
        customerReference: String(currentUser?.customerReference || ''),
        usReceivingAddress: String(currentUser?.usReceivingAddress || ''),
      });
    } finally {
      setCustomerDashboardLoading(false);
    }
  }

  async function copyTextToClipboard(value, label) {
    const text = String(value || '').trim();
    if (!text) {
      setStatusMessage(`No ${label.toLowerCase()} is available yet on your profile.`);
      return;
    }

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard is unavailable');
      }
      await navigator.clipboard.writeText(text);
      setStatusMessage(`${label} copied.`);
    } catch {
      setStatusMessage(`Copy failed. Please select and copy your ${label.toLowerCase()} manually.`);
    }
  }

  async function fetchDispatcherData(token = authToken) {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/admin/dispatcher`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load dispatcher data.');
      setDispatcherData(result);
      // Pre-populate reassign map with current assignments so dropdowns default to current driver
      const initialSelections = {};
      (result.pendingBookings || []).forEach((b) => {
        if (b.assignedDriverId) initialSelections[b.bookingId] = b.assignedDriverId;
      });
      setDispatcherReassignMap(initialSelections);
    } catch (error) {
      setStatusMessage(error.message);
    }
  }

  async function handleDispatcherReassign(bookingId) {
    const driverId = dispatcherReassignMap[bookingId];
    if (!driverId) {
      setStatusMessage('Select a driver first.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/admin/dispatcher/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ bookingId, driverId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Reassign failed.');
      setStatusMessage(`Reassigned to ${result.assignedDriverName}.`);
      fetchDispatcherData();
    } catch (error) {
      setStatusMessage(error.message);
    }
  }

  async function handleDispatcherAutoAssign() {
    try {
      const response = await fetch(`${API_BASE}/drivers/assignments/auto`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Auto-assign failed.');
      setStatusMessage(result.message);
      fetchDispatcherData();
    } catch (error) {
      setStatusMessage(error.message);
    }
  }

  async function handleAdminRecordAction({ endpoint, body, successMessage, refreshDispatcher = false }) {
    if (!authToken) {
      setStatusMessage('Please sign in as admin to run this action.');
      return;
    }

    setAdminActionLoading(true);
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body || {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to run admin action.');
      setStatusMessage(successMessage || result.message || 'Admin action completed.');
      await fetchAdminOverview(authToken);
      if (refreshDispatcher) {
        await fetchDispatcherData(authToken);
      }
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setAdminActionLoading(false);
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });

      const parseJsonResponse = async (res) => {
        const raw = await res.text();
        if (!raw) return {};
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error(`Login service returned an unexpected response (${res.status}). Please verify the API server is running on port 8787.`);
        }
      };

      let result = await parseJsonResponse(response);

      if (!response.ok) {
        const driverFallbackResponse = await fetch(`${API_BASE}/drivers/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginForm),
        });
        const driverResult = await parseJsonResponse(driverFallbackResponse);

        if (driverFallbackResponse.ok && driverResult.token) {
          clearCustomerSessionState();
          localStorage.setItem('driverAuthToken', driverResult.token);
          localStorage.setItem('driverUser', JSON.stringify(driverResult.user));
          setDriverAuthToken(driverResult.token);
          setDriverUser(driverResult.user);
          setDriverMode('dashboard');
          setStatusMessage(`Welcome back, ${driverResult.user?.fullName || 'Driver'}!`);
          fetchDriverPickups(driverResult.token);
          fetchDriverActiveRoute(driverResult.token);
          navigate('/driver/dashboard');
          return;
        }

        throw new Error(result.error || driverResult.error || 'Unable to log in.');
      }

      if (!result.token) throw new Error('Login succeeded but no session token was returned.');
      clearDriverSessionState();
      setIsAuthenticated(true);
      setCurrentUser(result.user || null);
      setAuthToken(result.token);
      window.localStorage.setItem('clf_auth_token', result.token);
      window.localStorage.setItem('clf_auth_user', JSON.stringify(result.user || null));
      if (result.user?.role === 'admin') {
        fetchAdminOverview(result.token);
      }
      setStatusMessage(`Welcome back, ${result.user?.fullName || 'Customer'}.`);
      const destination = location.state?.from && location.state.from !== '/login'
        ? location.state.from
        : result.user?.role === 'admin'
          ? '/admin'
          : '/dashboard';
      navigate(destination);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLogout() {
    clearCustomerSessionState();
    clearDriverSessionState();
    setLoginForm({ email: '', password: '' });
    setStatusMessage('You have been logged out.');
    navigate('/');
  }

  // Phase 2: Driver handlers
  async function handleDriverLogin(e) {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/drivers/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driverLoginForm)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Login failed.');

      clearCustomerSessionState();
      localStorage.setItem('driverAuthToken', result.token);
      localStorage.setItem('driverUser', JSON.stringify(result.user));
      setDriverAuthToken(result.token);
      setDriverUser(result.user);
      setDriverLoginForm({ email: '', password: '' });
      setDriverMode('dashboard');
      setStatusMessage(`Welcome back, ${result.user.fullName}!`);
      fetchDriverPickups(result.token);
      fetchDriverRecentScans(result.token);
      fetchDriverActiveRoute(result.token);
      navigate('/driver/dashboard');
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDriverRegister(e) {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/drivers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driverRegisterForm)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Registration failed.');
      
      setStatusMessage('Registration successful! Please login.');
      setDriverRegisterForm({ fullName: '', email: '', password: '', phone: '', vehicle: '' });
      setDriverMode('login');
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchDriverPickups(token) {
    try {
      const response = await fetch(`${API_BASE}/drivers/dashboard`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok) {
        const pickups = result.pickups || [];
        setDriverPickups(pickups);
        return pickups;
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch pickups:', error);
      return [];
    }
  }

  async function fetchDriverActiveRoute(token) {
    try {
      const response = await fetch(`${API_BASE}/drivers/routes/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (response.ok) {
        setActiveDriverRoute(result.route || null);
      }
    } catch (error) {
      console.error('Failed to fetch active route:', error);
    }
  }

  async function fetchDriverRecentScans(token) {
    try {
      const response = await fetch(`${API_BASE}/drivers/scans/recent?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (response.ok) {
        setDriverRecentScans(result.scans || []);
        return result.scans || [];
      }
      setDriverRecentScans([]);
      return [];
    } catch (error) {
      console.error('Failed to fetch recent scans:', error);
      setDriverRecentScans([]);
      return [];
    }
  }

  async function uploadDriverPickupPhoto(file) {
    if (!file) {
      return;
    }

    if (!String(file.type || '').startsWith('image/')) {
      setPickupPhotoUploadState({ uploading: false, fileName: '', error: 'Please upload an image file.' });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setPickupPhotoUploadState({ uploading: false, fileName: file.name, error: 'Photo exceeds 8MB limit. Upload a smaller image.' });
      return;
    }

    setPickupPhotoUploadState({ uploading: true, fileName: file.name, error: '' });
    try {
      const dataBase64 = await fileToBase64(file);
      const response = await fetch(`${API_BASE}/uploads/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          dataBase64,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to upload pickup photo.');

      setPickupConfirmation((prev) => ({ ...prev, photoUrl: result.url }));
      setPickupPhotoUploadState({ uploading: false, fileName: file.name, error: '' });
      setStatusMessage('Pickup photo uploaded. You can now confirm pickup.');
    } catch (error) {
      setPickupPhotoUploadState({ uploading: false, fileName: file.name, error: error.message });
      setStatusMessage(error.message);
    }
  }

  function handleDriverPickupPhotoFileChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      uploadDriverPickupPhoto(file);
    }
  }

  async function logDriverScan(shipmentId, source = 'manual-input') {
    const cleanedShipmentId = String(shipmentId || '').trim();
    if (!driverAuthToken || !cleanedShipmentId) {
      return { ok: false, error: 'Driver session expired. Please log in again.' };
    }

    try {
      const response = await fetch(`${API_BASE}/drivers/scans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driverAuthToken}`,
        },
        body: JSON.stringify({ shipmentId: cleanedShipmentId, source }),
      });
      const result = await response.json();
      if (!response.ok) {
        return { ok: false, error: result.error || 'Unable to log scan.' };
      }
      return { ok: true, result };
    } catch (error) {
      console.error('Failed to log scan event:', error);
      return { ok: false, error: 'Unable to log scan right now. Check your connection and try again.' };
    }
  }

  async function openPickupFromScan(rawShipmentId, source = 'manual-input') {
    const cleanedShipmentId = String(rawShipmentId || '').trim();
    if (!cleanedShipmentId) {
      setStatusMessage('Enter or scan a shipment ID first.');
      return;
    }

    const scanResult = await logDriverScan(cleanedShipmentId, source);
    if (driverAuthToken) {
      fetchDriverRecentScans(driverAuthToken);
    }

    let knownPickups = driverPickups;
    const pickupFromScan = scanResult.ok ? (scanResult.result?.pickup || null) : null;
    if (pickupFromScan && !knownPickups.some((p) => p.shipmentId === pickupFromScan.shipmentId)) {
      knownPickups = [pickupFromScan, ...knownPickups];
      setDriverPickups(knownPickups);
    }

    const localFound = knownPickups.some((p) => p.shipmentId === cleanedShipmentId)
      || driverRoute.some((p) => p.shipmentId === cleanedShipmentId);

    let refreshedPickups = knownPickups;
    if (!localFound && driverAuthToken) {
      refreshedPickups = await fetchDriverPickups(driverAuthToken);
    }

    const afterRefreshFound = refreshedPickups.some((p) => p.shipmentId === cleanedShipmentId)
      || driverRoute.some((p) => p.shipmentId === cleanedShipmentId);

    if (!afterRefreshFound) {
      setStatusMessage(scanResult.ok
        ? `Scan logged for ${cleanedShipmentId}, but no active pickup details were found.`
        : (scanResult.error || 'Shipment not found in your assigned pickups.'));
      return;
    }

    setScannedShipmentId(cleanedShipmentId);
    setScanInput(cleanedShipmentId);
    if (scanResult.ok && scanResult.result?.duplicate) {
      setStatusMessage(`Scan already recorded recently for ${cleanedShipmentId}. Pickup opened.`);
      return;
    }

    setStatusMessage(scanResult.ok
      ? `Scan logged and pickup opened for ${cleanedShipmentId}.`
      : `Pickup opened for ${cleanedShipmentId}. Note: scan log failed (${scanResult.error}).`);
  }

  async function handleStartRouteTracking() {
    if (!driverAuthToken) {
      setStatusMessage('Driver session expired. Please log in again.');
      return;
    }

    if (!driverRoute.length) {
      setStatusMessage('Generate an optimized route before starting route tracking.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    try {
      const withLocation = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
          },
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 }
        );
      });

      const response = await fetch(`${API_BASE}/drivers/routes/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driverAuthToken}`,
        },
        body: JSON.stringify({
          stopShipmentIds: driverRoute.map((stop) => stop.shipmentId),
          startLat: withLocation?.lat,
          startLng: withLocation?.lng,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to start route tracking.');

      setActiveDriverRoute(result.route || null);
      setStatusMessage(`Route tracking started (${result.route?.routeId || 'active route'}).`);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateOptimizedRoute() {
    if (!driverAuthToken) {
      setStatusMessage('Driver session expired. Please log in again.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    try {
      const withLocation = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
          },
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 }
        );
      });

      const optimizationUrl = withLocation
        ? `${API_BASE}/drivers/route-optimization?currentLat=${encodeURIComponent(withLocation.lat)}&currentLng=${encodeURIComponent(withLocation.lng)}`
        : `${API_BASE}/drivers/route-optimization`;

      const response = await fetch(optimizationUrl, {
        headers: { Authorization: `Bearer ${driverAuthToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to generate optimized route.');

      setDriverRoute(result.route || []);
      setDriverRouteMeta({
        totalStops: Number(result.totalStops || 0),
        estimatedTime: result.estimatedTime || '',
        totalDistanceKm: Number(result.totalDistanceKm || 0),
      });
      setStatusMessage(
        `Optimized route generated for ${result.totalStops || 0} stops`
        + `${result.estimatedTime ? ` (${result.estimatedTime})` : ''}`
        + `${result.totalDistanceKm ? ` across ~${result.totalDistanceKm} km` : ''}.`
      );
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function buildNavigationLink(pickup) {
    const destination = [pickup?.pickupAddress, pickup?.pickupCity, pickup?.pickupZip]
      .filter(Boolean)
      .join(', ');
    const encodedDestination = encodeURIComponent(destination);

    const isAppleDevice = /iPhone|iPad|Mac/i.test(navigator.platform || '')
      || /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

    if (isAppleDevice) {
      return `https://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`;
    }

    return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;
  }

  function handleStartDrive(pickup) {
    const destination = [pickup?.pickupAddress, pickup?.pickupCity, pickup?.pickupZip]
      .filter(Boolean)
      .join(', ')
      .trim();

    if (!destination) {
      setStatusMessage('Pickup address is missing. Please update booking details before starting navigation.');
      return;
    }

    const navigationUrl = buildNavigationLink(pickup);
    window.open(navigationUrl, '_blank', 'noopener,noreferrer');
    setStatusMessage('Opening turn-by-turn navigation for this pickup.');
  }

  async function handlePickupConfirm(shipmentId) {
    if (pickupPhotoUploadState.uploading) {
      setStatusMessage('Photo upload is still in progress. Please wait before confirming pickup.');
      return;
    }

    if (!String(pickupConfirmation.photoUrl || '').trim()) {
      setStatusMessage('Pickup photo is required before confirmation. Upload a photo first.');
      return;
    }

    setPickupConfirmLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_BASE}/drivers/pickups/${shipmentId}/confirm`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverAuthToken}`
        },
        body: JSON.stringify(pickupConfirmation)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Confirmation failed.');
      
      setStatusMessage(`Pickup confirmed for ${shipmentId}. Next step: transport to Miami warehouse for intake scanning.`);
      setScannedShipmentId('');
      setPickupConfirmation({ notes: '', photoUrl: '' });
      setPickupPhotoUploadState({ uploading: false, fileName: '', error: '' });
      fetchDriverPickups(driverAuthToken);
      fetchDriverRecentScans(driverAuthToken);
      if (result.activeRoute) {
        setActiveDriverRoute(result.activeRoute);
      } else {
        fetchDriverActiveRoute(driverAuthToken);
      }
      setDriverRoute([]);
      setDriverRouteMeta({ totalStops: 0, estimatedTime: '', totalDistanceKm: 0 });
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setPickupConfirmLoading(false);
    }
  }

  function handleDriverLogout() {
    clearDriverSessionState();
    setStatusMessage('Driver logout successful.');
    if (isAuthenticated) {
      navigate(currentUser?.role === 'admin' ? '/admin' : '/dashboard');
      return;
    }
    navigate('/');
  }

  async function handlePayment() {
    if (!shipmentId) {
      setStatusMessage('Create a shipment first before starting payment.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    try {
      const serviceTotalUsd = calculateBookingServicePrice(bookingForm, bookingBoxItems);
      const suppliesTotalUsd = calculateSupplyAddonsTotal(bookingForm);
      const checkoutTotalUsd = Math.max(0, serviceTotalUsd + suppliesTotalUsd);
      const amountCents = Math.max(100, Math.round(checkoutTotalUsd * 100));

      const response = await fetch(`${API_BASE}/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountCents,
          shipmentId,
          breakdown: {
            serviceTotalUsd,
            suppliesTotalUsd,
            checkoutTotalUsd,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Payment setup failed.');
      if (!result.url) {
        throw new Error('Payment setup failed. Missing checkout URL.');
      }
      window.location.assign(result.url);
      setStatusMessage(`Taking you to payment checkout (${result.mode}).`);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  const howItWorksByKey = useMemo(() => {
    const map = new Map();
    HOW_IT_WORKS.forEach((step) => {
      map.set(step.key, step);
    });
    return map;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const payment = params.get('payment');
    const paidShipmentId = params.get('shipmentId');
    const referenceType = params.get('referenceType');
    const referenceId = params.get('referenceId');
    const sessionId = params.get('session_id') || '';
    const effectiveShipmentId = paidShipmentId || (referenceType === 'shipment' ? referenceId : '');

    if (!payment) {
      return;
    }

    let cancelled = false;

    async function confirmPayment(payload) {
      const response = await fetch(`${API_BASE}/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Payment confirmation failed. Please contact support.');
      }
    }

    if (payment === 'success' || payment === 'mock-success') {
      (async () => {
        try {
          if (referenceType === 'purchase_request' && referenceId) {
            await confirmPayment({ referenceType, referenceId, providerStatus: payment, sessionId });
            if (cancelled) return;
            setStatusMessage(`Shop & Ship payment successful for ${referenceId}. We will confirm your purchase and shipping timeline.`);
            navigate('/shop', { replace: true });
            return;
          }

          if (effectiveShipmentId) {
            await confirmPayment({ shipmentId: effectiveShipmentId, providerStatus: payment, sessionId });
            if (cancelled) return;
            setTrackingId(effectiveShipmentId);
          }

          if (cancelled) return;
          setStatusMessage(`Payment successful for ${effectiveShipmentId || 'shipment'}. You can now track your cargo.`);
          navigate('/tracking', { replace: true });
        } catch (error) {
          if (cancelled) return;
          setStatusMessage(error.message || 'Payment confirmation failed.');
          if (referenceType === 'purchase_request') {
            navigate('/shop', { replace: true });
            return;
          }
          navigate('/book-pickup', { replace: true });
        }
      })();
      return;
    }

    if (payment === 'cancelled') {
      if (referenceType === 'purchase_request') {
        setStatusMessage('Shop & Ship payment was cancelled. Your request is saved and can be resumed.');
        navigate('/shop', { replace: true });
        return;
      }
      setStatusMessage('Payment was cancelled. Your shipment is saved; you can resume payment anytime.');
      navigate('/book-pickup', { replace: true });
    }

    return () => {
      cancelled = true;
    };
  }, [location.search, navigate]);

  function HomePage() {
    function handleInstantQuoteChange(event) {
      const { name, value } = event.target;
      setInstantQuoteForm((prev) => ({ ...prev, [name]: value }));
    }

    function handleInstantQuoteSubmit(event) {
      event.preventDefault();
      const { cargoType, weight } = instantQuoteForm;
      if (!weight || Number(weight) <= 0) {
        setInstantQuoteResult({ error: 'Please enter a valid weight.' });
        return;
      }
      const estimatedBaseCost = SERVICE_TIERS.find((t) => t.name === 'Standard')?.multiplier || 1.0;
      const catInfer = inferCategoryFromUrl('');
      const defaultPrice = inferDefaultPrice(catInfer);
      const totalCost = (Number(weight) / 10) * defaultPrice * estimatedBaseCost;
      const transitDays = '7-12';
      setInstantQuoteResult({
        cost: totalCost.toFixed(2),
        transit: transitDays,
      });
    }

    return (
      <>
        <section className="card" style={{ textAlign: 'center', padding: '3rem 2rem', background: 'linear-gradient(135deg, #f0f7f6 0%, #fff 100%)' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Ship from the USA to Jamaica with Confidence</h2>
          <p style={{ fontSize: '1.1rem', marginBottom: '2rem', color: '#555', maxWidth: '600px', margin: '0 auto 2rem' }}>
            Book pickups, track shipments, pay online. Everything in minutes, zero hassle.
          </p>
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => navigate('/book-pickup')}
            style={{ fontSize: '1.1rem', padding: '1rem 3rem' }}
          >
            📦 Book My Shipment Now
          </button>
        </section>

        {/* Instant Quote Card */}
        <section className="card home-instant-quote">
          <h3 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Get an Instant Quote</h3>
          <form onSubmit={handleInstantQuoteSubmit} className="instant-quote-form">
            <div className="instant-quote-row">
              <div className="instant-quote-field">
                <label htmlFor="quote-origin">Pickup Location</label>
                <select id="quote-origin" name="origin" value={instantQuoteForm.origin} onChange={handleInstantQuoteChange}>
                  <option>Miami, FL</option>
                  <option>Jacksonville, FL</option>
                  <option>Atlanta, GA</option>
                  <option>New York, NY</option>
                  <option>Los Angeles, CA</option>
                </select>
              </div>
              <div className="instant-quote-field">
                <label htmlFor="quote-destination">Destination</label>
                <select id="quote-destination" name="destination" value={instantQuoteForm.destination} onChange={handleInstantQuoteChange}>
                  <option>Kingston, Jamaica</option>
                  <option>Montego Bay, Jamaica</option>
                  <option>Other Jamaica Location</option>
                </select>
              </div>
              <div className="instant-quote-field">
                <label htmlFor="quote-cargo">What Type?</label>
                <select id="quote-cargo" name="cargoType" value={instantQuoteForm.cargoType} onChange={handleInstantQuoteChange}>
                  <option>Box</option>
                  <option>Barrel</option>
                  <option>Furniture</option>
                  <option>Appliance</option>
                  <option>Vehicle</option>
                </select>
              </div>
              <div className="instant-quote-field">
                <label htmlFor="quote-weight">Weight (lbs)</label>
                <input
                  id="quote-weight"
                  type="number"
                  name="weight"
                  value={instantQuoteForm.weight}
                  onChange={handleInstantQuoteChange}
                  placeholder="e.g., 25"
                  min="1"
                />
              </div>
            </div>

            <button type="submit" className="btn btn--solid" style={{ width: '100%', marginTop: '1rem' }}>
              Calculate My Total Cost
            </button>

            {instantQuoteResult && !instantQuoteResult.error && (
              <div className="instant-quote-result">
                <div className="result-item">
                  <span>Estimated Cost:</span>
                  <strong>${instantQuoteResult.cost}</strong>
                </div>
                <div className="result-item">
                  <span>Transit Time:</span>
                  <strong>{instantQuoteResult.transit} days</strong>
                </div>
                <button
                  type="button"
                  className="btn btn--solid"
                  onClick={() => navigate('/book-pickup')}
                  style={{ width: '100%', marginTop: '1rem' }}
                >
                  Book This Shipment Now
                </button>
              </div>
            )}

            {instantQuoteResult?.error && (
              <p style={{ color: '#d32f2f', marginTop: '1rem', textAlign: 'center' }}>{instantQuoteResult.error}</p>
            )}
          </form>
        </section>

        {/* How It Works - 5 Step Pipeline */}
        <section className="card" style={{ background: '#f9f9f9' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>How It Works</h2>
          <div className="how-it-works-pipeline">
            {HOW_IT_WORKS.map((step, idx) => (
              <div key={step.key} className="pipeline-step">
                <div className="step-icon">{step.icon}</div>
                <h3>{step.title}</h3>
                <p>{step.summary}</p>
                {idx < HOW_IT_WORKS.length - 1 && <div className="step-arrow">↓</div>}
              </div>
            ))}
          </div>
        </section>

        {/* Trust Badges */}
        <section className="card trust-badges-section">
          <h3 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Why Choose Clear Logistics?</h3>
          <div className="trust-badges-grid">
            <div className="trust-badge">✔ Door-to-Door Service</div>
            <div className="trust-badge">✔ Real-Time Tracking</div>
            <div className="trust-badge">✔ Secure Payments</div>
            <div className="trust-badge">✔ Professional Support</div>
            <div className="trust-badge">✔ USA Pickup</div>
            <div className="trust-badge">✔ Jamaica Delivery</div>
          </div>
        </section>

        <section className="card card--split home-story-card">
          <div>
            <p className="home-story-card__eyebrow">Who We Are</p>
            <h2>Your freight partner for the USA to Jamaica lane</h2>
            <p className="section-intro">
              Clear Logistics & Freight Services helps families, shoppers, and businesses move packages with simple booking,
              clear pricing, and shipment visibility from pickup to delivery.
            </p>
          </div>

          <div className="home-story-card__facts">
            <div className="home-story-card__fact">
              <strong>Built for real customers</strong>
              <span>Families, e-commerce shoppers, and recurring freight accounts.</span>
            </div>
            <div className="home-story-card__fact">
              <strong>Jamaica-focused</strong>
              <span>Direct delivery coverage across all 14 parishes.</span>
            </div>
            <div className="home-story-card__fact">
              <strong>Support-first</strong>
              <span>FAQ, WhatsApp, and AI chat are always within reach.</span>
            </div>
          </div>
        </section>

        <section className="card" style={{ textAlign: 'center', padding: '2rem', background: '#f0f7f6' }}>
          <h2>Ready to Ship?</h2>
          <p style={{ marginBottom: '1.5rem' }}>Track an existing shipment or start a new one today.</p>
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => navigate('/book-pickup')}
            style={{ fontSize: '1rem', padding: '0.8rem 2.5rem', marginRight: '1rem' }}
          >
            Book My Package Now
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate('/tracking')}
            style={{ fontSize: '1rem', padding: '0.8rem 2.1rem' }}
          >
            Check Status
          </button>
        </section>

        <section className="card" style={{ display: 'none' }}>
          <h2>Platform Roadmap Structure</h2>
          <ul className="sitemap-list">
            {SITE_MAP.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  function MockCheckoutPage() {
    const params = new URLSearchParams(location.search);
    const referenceType = params.get('referenceType') || 'shipment';
    const referenceId = params.get('referenceId') || '';
    const checkoutShipmentId = params.get('shipmentId') || (referenceType === 'shipment' ? referenceId : '') || shipmentId;
    const amountCents = Number(params.get('amount') || 2500);
    const amountUsd = (amountCents / 100).toFixed(2);
    const customerEmail = currentUser?.email || bookingForm.email || 'customer@example.com';
    const checkoutRefId = referenceType === 'purchase_request' ? referenceId : checkoutShipmentId;
    const checkoutTitle = referenceType === 'purchase_request' ? 'Complete your Shop & Ship payment' : 'Complete your shipment payment';
    const checkoutBackPath = referenceType === 'purchase_request' ? '/shop' : '/book-pickup';

    if (!checkoutRefId) {
      return (
        <section className="card">
          <h2>Mock Checkout</h2>
          <p className="section-intro">No checkout reference is attached to this checkout session.</p>
          <button type="button" className="btn btn--solid" onClick={() => navigate(checkoutBackPath)}>
            Back
          </button>
        </section>
      );
    }

    return (
      <section className="mock-checkout-shell">
        <div className="mock-checkout-shell__header">
          <p className="home-story-card__eyebrow">Mock Checkout</p>
          <h2>{checkoutTitle}</h2>
          <p className="section-intro">
            Stripe is not configured in this environment, so this page simulates a secure checkout experience before completing payment.
          </p>
        </div>

        <div className="mock-checkout-layout">
          <section className="card mock-checkout mock-checkout--form">
            <div className="mock-checkout__wallets">
              <button type="button" className="mock-wallet mock-wallet--dark">Link</button>
              <button type="button" className="mock-wallet mock-wallet--light">Apple Pay</button>
              <button type="button" className="mock-wallet mock-wallet--light">Cash App Pay</button>
            </div>

            <div className="mock-checkout__divider">
              <span>Or pay with card</span>
            </div>

            <div className="mock-checkout__field-group">
              <label className="mock-checkout__field">
                Card information
                <div className="mock-input mock-input--stacked">
                  <span>4242 4242 4242 4242</span>
                  <small>12 / 34&nbsp;&nbsp;&nbsp;CVC 123</small>
                </div>
              </label>

              <label className="mock-checkout__field">
                Cardholder name
                <div className="mock-input">{currentUser?.fullName || bookingForm.fullName || 'Test Customer'}</div>
              </label>

              <label className="mock-checkout__field">
                Email
                <div className="mock-input">{customerEmail}</div>
              </label>

              <label className="mock-checkout__field">
                Billing address
                <div className="mock-input mock-input--stacked">
                  <span>{bookingForm.pickupAddress || '123 Test Street'}</span>
                  <small>{bookingForm.pickupCity || 'Jacksonville'}, {bookingForm.pickupZip || '32202'}</small>
                </div>
              </label>
            </div>

            <div className="booking-nav mock-checkout__actions">
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => {
                  if (referenceType === 'purchase_request') {
                    navigate(`/?payment=mock-success&referenceType=purchase_request&referenceId=${encodeURIComponent(checkoutRefId)}`);
                    return;
                  }
                  navigate(`/?payment=mock-success&shipmentId=${encodeURIComponent(checkoutRefId)}`);
                }}
              >
                Pay ${amountUsd}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (referenceType === 'purchase_request') {
                    navigate(`/?payment=cancelled&referenceType=purchase_request&referenceId=${encodeURIComponent(checkoutRefId)}`);
                    return;
                  }
                  navigate(`/?payment=cancelled&shipmentId=${encodeURIComponent(checkoutRefId)}`);
                }}
              >
                Cancel
              </button>
            </div>

            <p className="mock-checkout__footnote">Demo mode only. No real payment will be charged.</p>
          </section>

          <aside className="card mock-checkout-summary">
            <div className="mock-checkout__card">
              <p className="mock-checkout__card-label">Demo card</p>
              <strong>4242 4242 4242 4242</strong>
              <span>Expires 12/34</span>
            </div>

            <div className="booking-summary">
              <p><strong>{referenceType === 'purchase_request' ? 'Request' : 'Shipment'}:</strong> {checkoutRefId}</p>
              <p><strong>Customer:</strong> {currentUser?.fullName || bookingForm.fullName || 'Test Customer'}</p>
              <p><strong>Delivery:</strong> {bookingForm.jamaicaLocation || 'Kingston'}, Jamaica</p>
              <p><strong>Mode:</strong> {referenceType === 'purchase_request' ? 'Shop & Ship checkout' : 'Shipment checkout'}</p>
            </div>

            <div className="mock-checkout-summary__totals">
              <div><span>{referenceType === 'purchase_request' ? 'Landed cost lock total' : 'Shipment deposit'}</span><strong>${amountUsd}</strong></div>
              <div><span>Processing fee</span><strong>$0.00</strong></div>
              <div className="mock-checkout-summary__total"><span>Total</span><strong>${amountUsd}</strong></div>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  function QuotePage() {
    const quoteSupplyAddons = useMemo(() => getSupplyAddons(quoteForm), [quoteForm]);
    const quoteSupplyAddonsTotalUsd = useMemo(() => calculateSupplyAddonsTotal(quoteForm), [quoteForm]);

    return (
      <section className="card card--split">
        <div>
          <h2>Request a Shipping Quote</h2>
          <div className="booking-summary" style={{ marginBottom: '0.85rem', border: '1px solid #cfe7dd', background: 'linear-gradient(135deg, #f3faf7 0%, #ffffff 100%)' }}>
            <p style={{ marginBottom: '0.25rem' }}><strong>{QUOTE_RESPONSE_GUARANTEE.title}</strong></p>
            <p className="section-intro" style={{ marginBottom: '0.35rem' }}>{QUOTE_RESPONSE_GUARANTEE.summary}</p>
            <p style={{ marginBottom: 0, fontSize: '0.84rem', color: '#2f5a4c' }}>
              This is how we keep your shipment moving faster than typical freight providers.
            </p>
          </div>
          <form className="form" onSubmit={handleQuoteSubmit}>
            <label htmlFor="quote-fullName">
              Full Name
              <input id="quote-fullName" name="fullName" value={quoteForm.fullName} onChange={handleQuoteChange} required />
            </label>
            <label htmlFor="quote-email">
              Email
              <input id="quote-email" type="email" name="email" value={quoteForm.email} onChange={handleQuoteChange} required />
            </label>
            <label htmlFor="quote-phone">
              Phone
              <input id="quote-phone" type="tel" name="phone" value={quoteForm.phone} onChange={handleQuoteChange} required />
            </label>
            <label htmlFor="quote-cargoType">
              Cargo Type
              <select id="quote-cargoType" name="cargoType" value={quoteForm.cargoType} onChange={handleQuoteChange} required>
                <option>Box</option>
                <option>Barrel</option>
                <option>Pallet</option>
                <option>Commercial Freight</option>
              </select>
            </label>
            <label htmlFor="quote-serviceLevel">
              Service Level
              <select id="quote-serviceLevel" name="serviceLevel" value={quoteForm.serviceLevel} onChange={handleQuoteChange}>
                <option>Standard</option>
                <option>Priority</option>
                <option>Express</option>
              </select>
            </label>
            <label htmlFor="quote-itemCategory">
              Item Category
              <input id="quote-itemCategory" name="itemCategory" value={quoteForm.itemCategory} onChange={handleQuoteChange} placeholder="Clothing, Electronics, Household, etc." required />
            </label>
            <label htmlFor="quote-origin-form">
              Origin
              <input id="quote-origin-form" name="origin" value={quoteForm.origin} onChange={handleQuoteChange} required />
            </label>
            <label htmlFor="quote-destination-form">
              Destination
              <input id="quote-destination-form" name="destination" value={quoteForm.destination} onChange={handleQuoteChange} required />
            </label>
            <label htmlFor="quote-deliveryParish">
              Delivery Parish (Jamaica)
              <select id="quote-deliveryParish" name="deliveryParish" value={quoteForm.deliveryParish} onChange={handleQuoteChange} required>
                <option value="">Select a parish</option>
                {JAMAICA_PARISHES.map(parish => (
                  <option key={parish} value={parish}>{parish}</option>
                ))}
              </select>
            </label>
            <label htmlFor="quote-declaredValueUsd">
              Declared Value (USD)
              <input id="quote-declaredValueUsd" type="number" name="declaredValueUsd" value={quoteForm.declaredValueUsd} onChange={handleQuoteChange} min="0" placeholder="Optional but recommended" />
            </label>
            <label htmlFor="quote-weight-form">
              Weight (lbs)
              <input
                id="quote-weight-form"
                type="number"
                name="weight"
                value={quoteForm.weight}
                onChange={handleQuoteChange}
                min="1"
                required={!quoteForm.dontKnowWeight}
                disabled={quoteForm.dontKnowWeight}
                placeholder={quoteForm.dontKnowWeight ? 'Skip when unknown' : ''}
              />
            </label>
            <label htmlFor="quote-dontKnowWeight" className="checkbox-label">
              <input
                id="quote-dontKnowWeight"
                type="checkbox"
                name="dontKnowWeight"
                checked={quoteForm.dontKnowWeight}
                onChange={handleQuoteChange}
              />
              I do not know the exact weight
            </label>
            {quoteForm.dontKnowWeight && (
              <>
                <label htmlFor="quote-quantity">
                  Quantity
                  <input id="quote-quantity" type="number" name="quantity" value={quoteForm.quantity} onChange={handleQuoteChange} min="1" required />
                </label>
                <label htmlFor="quote-dimensionsLength">
                  Dimensions (L x W x H in inches)
                  <div className="input-row">
                    <input id="quote-dimensionsLength" type="number" name="dimensionsLength" placeholder="Length" value={quoteForm.dimensionsLength} onChange={handleQuoteChange} min="1" required />
                    <input id="quote-dimensionsWidth" type="number" name="dimensionsWidth" placeholder="Width" value={quoteForm.dimensionsWidth} onChange={handleQuoteChange} min="1" required />
                    <input id="quote-dimensionsHeight" type="number" name="dimensionsHeight" placeholder="Height" value={quoteForm.dimensionsHeight} onChange={handleQuoteChange} min="1" required />
                  </div>
                </label>
                <p className="section-intro">We will provide an estimated quote range and confirm final pricing after warehouse weigh-in.</p>
              </>
            )}

            <div className="booking-summary" style={{ padding: '0.75rem', border: '1px solid #d9e5df', background: '#f7fbf9' }}>
              <p style={{ marginBottom: '0.5rem' }}><strong>One-Stop Add-Ons</strong></p>
              {SUPPLY_CATALOG.map((supply) => (
                <label key={supply.key} htmlFor={`quote-${supply.field}`} style={{ marginBottom: '0.5rem' }}>
                  {supply.label} (${supply.unitPriceUsd} each)
                  <input
                    id={`quote-${supply.field}`}
                    type="number"
                    name={supply.field}
                    min="0"
                    value={quoteForm[supply.field]}
                    onChange={handleQuoteChange}
                  />
                  <span className="section-intro" style={{ display: 'block' }}>{supply.description}</span>
                </label>
              ))}
              <label htmlFor="quote-vipConcierge" className="checkbox-label" style={{ marginBottom: 0 }}>
                <input
                  id="quote-vipConcierge"
                  type="checkbox"
                  name="vipConcierge"
                  checked={quoteForm.vipConcierge}
                  onChange={handleQuoteChange}
                />
                Enable VIP concierge follow-up for priority handling
              </label>
              {quoteSupplyAddons.length > 0 && (
                <p className="section-intro" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                  Supplies selected: {quoteSupplyAddons.map((item) => `${item.quantity} ${item.label}`).join(', ')}. Add-on total: ${quoteSupplyAddonsTotalUsd.toFixed(2)}.
                </p>
              )}
              <p className="section-intro" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                This creates a premium one-stop request so your shipment and supplies are coordinated in one workflow.
              </p>
            </div>

            <button type="submit" className="btn btn--solid" disabled={isLoading}>{isLoading ? 'Submitting...' : 'Submit Premium Quote Request'}</button>
          </form>
        </div>

        <div>
          <h2>Starter Pricing (MVP)</h2>
          <p className="section-intro">Final rates can vary by dimensions, lane, and service level.</p>
          <div className="pricing">
            <ul>
              {PRICING.map((item) => (
                <li key={item.lane}>
                  <span>{item.lane}</span>
                  <span>{item.eta}</span>
                  <strong>{item.from}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  function ShopPage() {
    const assignedReference = String(customerProfile.customerReference || currentUser?.customerReference || '').trim();
    const assignedUsAddress = String(customerProfile.usReceivingAddress || currentUser?.usReceivingAddress || '').trim();

    return (
      <section className="card card--split">
        <div>
          <h2>Shop & Ship</h2>
          <p className="section-intro">Shop from popular US stores and ship to Jamaica with Clear Logistics & Freight Services.</p>

          {isAuthenticated ? (
            <div
              className="booking-summary"
              style={{
                marginBottom: '0.9rem',
                border: '1px solid rgba(12, 108, 94, 0.28)',
                background: 'linear-gradient(145deg, rgba(240, 250, 247, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%)',
                boxShadow: '0 14px 26px rgba(12, 108, 94, 0.08)',
              }}
            >
              <p style={{ margin: 0, color: '#0b6b61', fontWeight: 700, letterSpacing: '0.02em', fontSize: '0.78rem', textTransform: 'uppercase' }}>
                Premium Self-Serve
              </p>
              <h3 style={{ marginTop: '0.35rem', marginBottom: '0.35rem' }}>Your Shipping Profile</h3>
              <p className="section-intro" style={{ marginBottom: '0.6rem' }}>
                We auto-attach this profile to your Shop request. You can still copy it for direct store checkout.
              </p>
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ padding: '0.6rem 0.7rem', borderRadius: '12px', background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(12, 108, 94, 0.16)' }}>
                  <p style={{ margin: '0 0 0.2rem', fontWeight: 700 }}>Customer Reference</p>
                  <p style={{ margin: 0 }}>{assignedReference || 'Not assigned yet'}</p>
                </div>
                <div style={{ padding: '0.6rem 0.7rem', borderRadius: '12px', background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(12, 108, 94, 0.16)' }}>
                  <p style={{ margin: '0 0 0.2rem', fontWeight: 700 }}>US Receiving Address</p>
                  <p style={{ margin: 0 }}>{assignedUsAddress || 'Not assigned yet'}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button type="button" className="btn btn--solid" onClick={() => copyTextToClipboard(assignedReference, 'Customer reference')}>
                  Copy Reference
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => copyTextToClipboard(assignedUsAddress, 'US receiving address')}>
                  Copy US Address
                </button>
              </div>
            </div>
          ) : null}

          <div className="booking-summary" style={{ marginBottom: '0.9rem', borderLeft: '4px solid var(--brand)' }}>
            <h3 style={{ marginBottom: '0.35rem' }}>Where do I ship my online order?</h3>
            <p style={{ marginBottom: '0.45rem' }}><strong>Option 1: Purchase Assistance (recommended)</strong> - Submit links below and we handle checkout for you. You do not need to enter a shipping address at the store.</p>
            <p style={{ marginBottom: '0.45rem' }}><strong>Option 2: You buy at the store yourself</strong> - Use your assigned US receiving address and customer reference, then paste them at checkout.</p>
            <p style={{ marginBottom: '0.45rem' }}><strong>Important:</strong> Always include your customer reference/shipment ID at checkout so your package is matched correctly at intake.</p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--ghost" onClick={openWhatsApp}>Need help? Chat on WhatsApp</button>
              <a className="btn btn--ghost" href={`mailto:${SHOP_AND_SHIP_HELP_EMAIL}`} style={{ textDecoration: 'none' }}>Email Support</a>
            </div>
          </div>

          <div className="stores-grid">
            {POPULAR_STORES.map((store) => (
              <a
                key={store.name}
                href={store.url}
                target="_blank"
                rel="noopener noreferrer"
                className="store-card"
              >
                <div className="store-card__head">
                  <span className="store-card__icon" aria-hidden="true">
                    <img
                      src={store.logo}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <span>{store.icon}</span>
                  </span>
                  <h3>{store.name}</h3>
                </div>
                <p>Open store</p>
              </a>
            ))}
          </div>
        </div>

        <div>
          <div id="barrel-catalog" className="booking-summary" style={{ marginBottom: '0.9rem' }}>
            <h3 style={{ marginBottom: '0.45rem' }}>Barrel Catalog</h3>
            <p className="section-intro" style={{ marginBottom: '0.75rem' }}>
              Need empty barrels? Add a barrel option directly to your Shop & Ship cart.
            </p>
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              {BARREL_CATALOG.map((barrel) => (
                <article key={barrel.sku} className="card" style={{ padding: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.7rem', flexWrap: 'wrap' }}>
                    <div>
                      <h4 style={{ margin: '0 0 0.3rem' }}>{barrel.name}</h4>
                      <p className="section-intro" style={{ marginBottom: '0.35rem' }}>{barrel.description}</p>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)' }}><strong>Best for:</strong> {barrel.bestFor}</p>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '140px' }}>
                      <p style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>${barrel.unitPriceUsd.toFixed(2)} each</p>
                      <button type="button" className="btn btn--ghost" onClick={() => addBarrelToShopCart(barrel)}>
                        Add Barrel
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <h2>Purchase Assistance</h2>
          <p className="section-intro">Need us to purchase items on your behalf? Submit links and preferences below.</p>
          <div className="booking-summary" style={{ marginBottom: '0.8rem' }}>
            <p><strong>Want a fast landed-cost preview first?</strong> Use AI Estimator, then import the estimate into this cart.</p>
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/cart-estimator')}>
              Open AI Estimator
            </button>
          </div>
          {!isAuthenticated && shopAccessMode !== 'guest' ? (
            <div className="guest-gate">
              <p className="section-intro">Choose how you want to proceed before sharing your product links.</p>
              <ul className="type-list">
                <li>Continue as Guest: fastest way to submit your request.</li>
                <li>Create Account: recommended for tracking purchase history and faster repeat orders.</li>
              </ul>
              <div className="guest-gate__actions">
                <button
                  type="button"
                  className="btn btn--solid"
                  onClick={() => {
                    setShopAccessMode('guest');
                    setStatusMessage('Guest mode enabled. You can now submit your purchase request.');
                  }}
                >
                  Continue as Guest
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => navigate('/account', { state: { from: '/shop' } })}
                >
                  Create Account First
                </button>
              </div>
            </div>
          ) : (
            <>
              {isAuthenticated && (
                <p className="section-intro">Signed in as {currentUser?.fullName || 'Customer'}. Your account can be used for follow-up and approvals.</p>
              )}
              {showShopBookingPrompt && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Book now prompt"
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem',
                    zIndex: 120,
                  }}
                >
                  <div
                    className="card"
                    style={{
                      width: 'min(540px, 96vw)',
                      border: '1px solid #cde3dc',
                      boxShadow: '0 20px 48px rgba(15, 23, 42, 0.28)',
                    }}
                  >
                    <p className="section-context-label">Ready To Book?</p>
                    <h3 style={{ marginBottom: '0.45rem' }}>Lock in your landed total now</h3>
                    <p className="section-intro" style={{ marginBottom: '0.65rem' }}>
                      Estimated landed total: <strong>${landedTotalUsd.toFixed(2)}</strong>
                    </p>
                    <p className="section-intro" style={{ marginBottom: '0.95rem' }}>
                      Estimated transit to Jamaica: <strong>7-12 days</strong> after US purchase confirmation.
                    </p>
                    <div className="booking-summary" style={{ marginBottom: '0.95rem' }}>
                      <p><strong>Item Subtotal:</strong> ${cartSubtotalUsd.toFixed(2)}</p>
                      <p><strong>Duty + Fees + Shipping:</strong> ${(landedTotalUsd - cartSubtotalUsd).toFixed(2)}</p>
                    </div>
                    <div className="booking-nav" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                      <button
                        type="button"
                        className="btn btn--solid"
                        onClick={() => {
                          setShowShopBookingPrompt(false);
                          shopCheckoutButtonRef.current?.click();
                        }}
                      >
                        Continue to Checkout
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          setShowShopBookingPrompt(false);
                          setShopBookingPromptDismissedKey(shopBookingPromptKey);
                        }}
                      >
                        Not Now
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <form className="form" onSubmit={handlePurchaseSubmit}>
                <label>
                  Full Name
                  <input name="fullName" value={purchaseForm.fullName} onChange={handlePurchaseChange} required />
                </label>
                <label>
                  Email
                  <input type="email" name="email" value={purchaseForm.email} onChange={handlePurchaseChange} required />
                </label>
                <label>
                  Phone
                  <input type="tel" name="phone" value={purchaseForm.phone} onChange={handlePurchaseChange} required />
                </label>
                <label>
                  Preferred Store
                  <select name="storeName" value={purchaseForm.storeName} onChange={handlePurchaseChange}>
                    {POPULAR_STORES.map((store) => (
                      <option key={store.name}>{store.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Size/Color Specs
                  <textarea name="sizeColorSpecs" value={purchaseForm.sizeColorSpecs} onChange={handlePurchaseChange} rows="3" />
                </label>
                <label>
                  Additional Notes
                  <textarea name="notes" value={purchaseForm.notes} onChange={handlePurchaseChange} rows="3" />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="notifyWhatsApp" checked={purchaseForm.notifyWhatsApp} onChange={handlePurchaseChange} />
                  Send WhatsApp updates when customs-ready and payment is confirmed
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="notifySms" checked={purchaseForm.notifySms} onChange={handlePurchaseChange} />
                  Send SMS updates when customs-ready and payment is confirmed
                </label>

                <div className="shop-cart">
                  <h3>Cart Items</h3>
                  {shopItems.map((item, index) => (
                    <div key={`shop-item-${index}`} className="shop-cart__item" style={{ opacity: item.selectedForBooking === false ? 0.78 : 1 }}>
                      <label className="checkbox-label" style={{ marginBottom: '0.55rem' }}>
                        <input
                          type="checkbox"
                          checked={item.selectedForBooking !== false}
                          onChange={(event) => handleShopItemChange(index, 'selectedForBooking', event.target.checked)}
                        />
                        Include this item in Book Now checkout
                      </label>
                      <label>
                        Product Name
                        <input
                          value={item.name}
                          onChange={(event) => handleShopItemChange(index, 'name', event.target.value)}
                          placeholder="Wireless headset"
                          required={item.selectedForBooking !== false}
                        />
                      </label>
                      <label>
                        Product Link
                        <input
                          type="url"
                          value={item.link}
                          onChange={(event) => handleShopItemChange(index, 'link', event.target.value)}
                          placeholder="https://www.amazon.com/..."
                          required={item.selectedForBooking !== false}
                        />
                      </label>
                      <div className="input-row">
                        <label>
                          Qty
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(event) => handleShopItemChange(index, 'quantity', event.target.value)}
                            required={item.selectedForBooking !== false}
                          />
                        </label>
                        <label>
                          Unit Price (USD)
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.unitPriceUsd}
                            onChange={(event) => handleShopItemChange(index, 'unitPriceUsd', event.target.value)}
                            required={item.selectedForBooking !== false}
                          />
                        </label>
                      </div>
                      <button type="button" className="btn btn--ghost" onClick={() => removeShopItem(index)}>
                        Remove Item
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn--ghost" onClick={addShopItem}>
                    + Add Another Item
                  </button>
                </div>

                <div className="booking-summary">
                  <p><strong>Customs Ready:</strong> <span style={{ color: isCustomsReady ? '#0b6b61' : '#b45309', fontWeight: 700 }}>{isCustomsReady ? 'READY' : 'ACTION NEEDED'}</span> ({customsReadyScore}%)</p>
                  <p><strong>Rule Trigger:</strong> {docsRequired ? 'Required due to high-value/luxury items' : 'Standard flow, declaration only'}</p>
                </div>

                <div className="shop-docs card" style={{ marginTop: '0.6rem' }}>
                  <h3>Customs Ready Checklist</h3>
                  <p className="section-intro">Upload customer documents before checkout. Required docs are enforced only when risk/value thresholds are triggered.</p>
                  <label>
                    Upload Commercial Invoice {docsRequired ? '(Required)' : '(Optional)'}
                    <input type="file" accept="application/pdf,image/*" onChange={(event) => handleShopDocFileChange(event, 'invoiceUrl')} />
                    <small>{shopDocUploadState.invoiceUrl.uploading ? 'Uploading...' : shopDocUploadState.invoiceUrl.fileName ? `Uploaded: ${shopDocUploadState.invoiceUrl.fileName}` : 'Accepted: PDF, JPG, PNG (max 5MB)'}</small>
                  </label>
                  <label>
                    Commercial Invoice Link (if already hosted)
                    <input type="url" name="invoiceUrl" value={shopDocs.invoiceUrl} onChange={handleShopDocChange} placeholder="https://drive.google.com/..." required={docsRequired} />
                  </label>
                  <label>
                    Upload Government ID {docsRequired ? '(Required)' : '(Optional)'}
                    <input type="file" accept="application/pdf,image/*" onChange={(event) => handleShopDocFileChange(event, 'idUrl')} />
                    <small>{shopDocUploadState.idUrl.uploading ? 'Uploading...' : shopDocUploadState.idUrl.fileName ? `Uploaded: ${shopDocUploadState.idUrl.fileName}` : 'Accepted: PDF, JPG, PNG (max 5MB)'}</small>
                  </label>
                  <label>
                    Government ID Link (if already hosted)
                    <input type="url" name="idUrl" value={shopDocs.idUrl} onChange={handleShopDocChange} placeholder="https://drive.google.com/..." required={docsRequired} />
                  </label>
                  <label>
                    Upload Import Permit (Optional)
                    <input type="file" accept="application/pdf,image/*" onChange={(event) => handleShopDocFileChange(event, 'importPermitUrl')} />
                    <small>{shopDocUploadState.importPermitUrl.uploading ? 'Uploading...' : shopDocUploadState.importPermitUrl.fileName ? `Uploaded: ${shopDocUploadState.importPermitUrl.fileName}` : 'Accepted: PDF, JPG, PNG (max 5MB)'}</small>
                  </label>
                  <label>
                    Import Permit Link (Optional)
                    <input type="url" name="importPermitUrl" value={shopDocs.importPermitUrl} onChange={handleShopDocChange} placeholder="https://drive.google.com/..." />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" name="declarationAccepted" checked={shopDocs.declarationAccepted} onChange={handleShopDocChange} required />
                    I confirm product values and item descriptions are accurate for customs declaration.
                  </label>
                </div>

                <div className="booking-summary">
                  <p><strong>Selected Item Subtotal:</strong> ${cartSubtotalUsd.toFixed(2)}</p>
                  <p><strong>Estimated Customs Duty:</strong> ${customsDutyUsd.toFixed(2)}</p>
                  <p><strong>Brokerage Fee:</strong> ${brokerageFeeUsd.toFixed(2)}</p>
                  <p><strong>Processing Fee:</strong> ${processingFeeUsd.toFixed(2)}</p>
                  <p><strong>Estimated Shipping:</strong> ${shippingFeeUsd.toFixed(2)}</p>
                  <p><strong>Book Now Total (selected items):</strong> ${landedTotalUsd.toFixed(2)}</p>
                  <p><strong>Remaining Item Total (book later):</strong> ${remainingItemTotalUsd.toFixed(2)}</p>
                  <p style={{ marginTop: '0.35rem' }}><strong>Note:</strong> Unselected items can be booked in a separate shipment.</p>
                </div>

                <button ref={shopCheckoutButtonRef} type="submit" className="btn btn--solid" disabled={isLoading || !isCustomsReady}>Continue to Checkout</button>
              </form>
            </>
          )}
        </div>
      </section>
    );
  }

  function CartEstimatorPage() {
    const handleImportAndGoToShop = () => {
      const imported = applyEstimatorToCart();
      if (imported) {
        navigate('/shop');
      }
    };

    const estimatorMetrics = estimatorResult
      ? [
          { label: 'Confidence', value: `${estimatorResult.confidenceLabel} (${estimatorResult.confidence}%)` },
          { label: 'Items Total', value: `$${estimatorResult.subtotal.toFixed(2)}` },
          { label: 'Shipping', value: `$${estimatorResult.shipping.toFixed(2)}` },
          { label: 'Estimated Duty', value: `$${estimatorResult.customs.toFixed(2)}` },
          { label: 'Landed Total', value: `$${estimatorResult.total.toFixed(2)}` },
        ]
      : [];

    return (
      <>
        <section className="card estimator-hero">
          <div style={{ maxWidth: '700px' }}>
            <p className="estimator-page__eyebrow">✨ Signature Feature</p>
            <h1 style={{ fontSize: '2.2rem', marginBottom: '1rem' }}>Smart Shipping Estimator</h1>
            <p className="section-intro" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Paste an Amazon, Walmart, eBay, Gucci, or any US store product/cart link. 
              Get an instant landed-cost estimate including shipping, duties, and processing fees—all in seconds.
            </p>
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(11, 107, 97, 0.1)', borderRadius: '8px', borderLeft: '4px solid var(--brand)' }}>
              <p style={{ margin: '0', fontSize: '0.95rem', fontWeight: '500' }}>
                💡 <strong>Pro Tip:</strong> For cart links (like Amazon), paste your actual cart subtotal below. 
                For product links, add the exact item price list so your estimate is precise.
              </p>
            </div>
          </div>
        </section>

        <section className="card estimator-page">
          <div className="estimator-page__lead">
            <h2>Estimate Your Shipping</h2>

            <div className="shop-estimator estimator-panel">
              <label className="estimator-field">
                Product/Cart Links (one per line)
                <textarea
                  rows="6"
                  value={estimatorLinks}
                  onChange={(event) => setEstimatorLinks(event.target.value)}
                  placeholder="https://www.sephora.com/...&#10;https://www.gucci.com/...&#10;https://www.amazon.com/gp/cart/view.html?ref_=nav_cart"
                />
              </label>
              <label className="estimator-field" style={{ marginTop: '0.55rem' }}>
                Store Cart Subtotal (USD) - Required for cart links
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatorSubtotalInput}
                  onChange={(event) => setEstimatorSubtotalInput(event.target.value)}
                  placeholder="e.g. 224.40"
                />
              </label>
              <label className="estimator-field" style={{ marginTop: '0.55rem' }}>
                Exact Product Prices (USD) - Required for product links (one per line, same order)
                <textarea
                  rows="4"
                  value={estimatorProductPricesInput}
                  onChange={(event) => setEstimatorProductPricesInput(event.target.value)}
                  placeholder="799.99&#10;1299.00"
                />
              </label>
              <div className="estimator-panel__actions">
                <button type="button" className="btn btn--solid" onClick={runLinkEstimator}>
                  🚀 Get Instant Estimate
                </button>
              </div>

              {estimatorResult && (
                <div className="estimator-results">
                  <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', color: 'var(--brand)' }}>Your Estimate</h3>
                  <div className="estimator-metrics">
                    {estimatorMetrics.map((metric) => (
                      <article key={metric.label} className="estimator-metric">
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </article>
                    ))}
                  </div>
                  {estimatorResult.missing.length > 0 && (
                    <div className="estimator-notes">
                      <p><strong>Improve Accuracy</strong></p>
                      <ul className="type-list">
                        {estimatorResult.missing.map((msg) => (
                          <li key={msg}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="estimator-notes" style={{ marginTop: '1rem' }}>
                    <p><strong>How Your Links Were Interpreted</strong></p>
                    <p style={{ marginBottom: '0.45rem' }}>
                      Links parsed: {estimatorResult.inputSummary.totalLinks}. Cart links: {estimatorResult.inputSummary.cartLinks}. Product links: {estimatorResult.inputSummary.productLinks}.
                    </p>
                    <ul className="type-list">
                      {estimatorResult.estimatedItems.map((item, idx) => (
                        <li key={`${item.link}-${idx}`}>
                          {item.sourceType === 'cart-subtotal'
                            ? `${item.store} cart subtotal: $${item.unitPriceUsd.toFixed(2)} (from your manual subtotal)`
                            : `${item.store} product link: ${item.name} -> $${item.unitPriceUsd.toFixed(2)} (from your exact product price input)`}
                        </li>
                      ))}
                    </ul>
                    <p style={{ marginTop: '0.55rem', marginBottom: '0.2rem' }}>
                      Formula used: subtotal + customs + brokerage + processing + shipping
                    </p>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
                      Rates: customs {(estimatorResult.rateSummary.customsRate * 100).toFixed(0)}%, processing {(estimatorResult.rateSummary.processingRate * 100).toFixed(0)}%, shipping {(estimatorResult.rateSummary.shippingRate * 100).toFixed(0)}%, brokerage ${estimatorResult.rateSummary.brokerageFlat.toFixed(2)} flat.
                    </p>
                  </div>

                  <button type="button" className="btn btn--solid" onClick={handleImportAndGoToShop} style={{ marginTop: '1.5rem', width: '100%' }}>
                    📦 Add to Shop & Ship Cart
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="estimator-page__guide">
            <div className="estimator-guide-card">
              <h3>📋 How To Use</h3>
              <ul className="type-list">
                <li><strong>Paste Links:</strong> One per line from US stores</li>
                <li><strong>Enter Subtotal:</strong> Required for cart URLs only</li>
                <li><strong>Enter Product Prices:</strong> Required for product URLs</li>
                <li><strong>Get Estimate:</strong> Instant landed-cost breakdown</li>
                <li><strong>Import & Ship:</strong> Add to Shop & Ship and checkout</li>
              </ul>
            </div>

            <div className="estimator-guide-card estimator-guide-card--accent">
              <h3>⭐ For Best Results</h3>
              <ul className="type-list">
                <li>Use exact product page URLs</li>
                <li>Mix product + cart links as needed</li>
                <li>Confirm totals in Shop & Ship</li>
                <li>Custom items? Use "Get a Quote"</li>
              </ul>
              <button type="button" className="btn btn--solid" onClick={() => navigate('/shop')}>
                Go to Shop & Ship
              </button>
            </div>
          </div>
        </section>

        <section className="card" style={{ background: '#f9f9f9', textAlign: 'center' }}>
          <h2>Why Use the AI Estimator?</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 0.5rem 0' }}>⚡</p>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>Instant Quotes</h3>
              <p style={{ margin: '0', color: '#666', fontSize: '0.9rem' }}>No waiting. Get your landed cost in seconds.</p>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 0.5rem 0' }}>🎯</p>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>Accurate Pricing</h3>
              <p style={{ margin: '0', color: '#666', fontSize: '0.9rem' }}>Includes shipping, duties, taxes, and processing fees.</p>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 0.5rem 0' }}>🛍️</p>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>Shop Freely</h3>
              <p style={{ margin: '0', color: '#666', fontSize: '0.9rem' }}>Browse any US store, know the total cost upfront.</p>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 0.5rem 0' }}>✅</p>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>Book & Ship</h3>
              <p style={{ margin: '0', color: '#666', fontSize: '0.9rem' }}>One-click import to checkout. No surprises at payment.</p>
            </div>
          </div>
        </section>
      </>
    );
  }

  function BookingPage() {
    const estimatedPrice = useMemo(() => calculateBookingServicePrice(bookingForm, bookingBoxItems), [bookingForm, bookingBoxItems]);
    const bookingSupplyAddons = useMemo(() => getSupplyAddons(bookingForm), [bookingForm]);
    const bookingSupplyAddonsTotalUsd = useMemo(() => calculateSupplyAddonsTotal(bookingForm), [bookingForm]);
    const bookingCheckoutTotalUsd = useMemo(() => estimatedPrice + bookingSupplyAddonsTotalUsd, [estimatedPrice, bookingSupplyAddonsTotalUsd]);
    const bookingTotalWeightLbs = useMemo(() => getBookingTotalWeight(bookingForm, bookingBoxItems), [bookingForm, bookingBoxItems]);

    const stepLabels = ['Pickup Info', 'Shipment Details', 'Jamaica Delivery', 'Choose Service', 'Confirm & Pay'];

    return (
      <section className="card card--split">
        <div>
          <p className="section-context-label" aria-label={`${BOOKING_TAB_LABEL} - ${BOOKING_PAGE_LABEL}`}>You are viewing: {BOOKING_TAB_LABEL} &gt; {BOOKING_PAGE_LABEL}</p>
          <h2>{BOOKING_PAGE_LABEL}</h2>
          <p className="section-intro">Complete the booking in 5 steps. No hidden fees.</p>
          <div className="booking-steps">
            {stepLabels.map((label, idx) => (
              <div key={label} className={`booking-step ${bookingStep > idx + 1 ? 'done' : ''} ${bookingStep === idx + 1 ? 'active' : ''}`}>
                <span>{idx + 1}</span>
                <p>{label}</p>
              </div>
            ))}
          </div>

          <form className="form" onSubmit={handleBookingSubmit}>
            {/* Step 1: Pickup Information */}
            {bookingStep === 1 && (
              <>
                <h3>Where should we pick up your shipment?</h3>
                <label htmlFor="book-fullName">
                  Full Name
                  <input id="book-fullName" name="fullName" value={bookingForm.fullName} onChange={handleBookingChange} required />
                </label>
                <label htmlFor="book-email">
                  Email
                  <input id="book-email" type="email" name="email" value={bookingForm.email} onChange={handleBookingChange} required />
                </label>
                <label htmlFor="book-phone">
                  Phone
                  <input id="book-phone" type="tel" name="phone" value={bookingForm.phone} onChange={handleBookingChange} required />
                </label>
                <label htmlFor="book-address">
                  Street Address
                  <input id="book-address" name="pickupAddress" placeholder="123 Main Street" value={bookingForm.pickupAddress} onChange={handleBookingChange} required />
                </label>
                <div className="input-row">
                  <label htmlFor="book-city">
                    City
                    <input id="book-city" name="pickupCity" value={bookingForm.pickupCity} onChange={handleBookingChange} required />
                  </label>
                  <label htmlFor="book-zip">
                    ZIP
                    <input id="book-zip" name="pickupZip" value={bookingForm.pickupZip} onChange={handleBookingChange} required />
                  </label>
                </div>
                <label htmlFor="book-date">
                  Pickup Date
                  <input id="book-date" type="date" name="pickupDate" value={bookingForm.pickupDate} onChange={handleBookingChange} min={new Date().toISOString().split('T')[0]} required />
                </label>
              </>
            )}

            {/* Step 2: Shipment Details */}
            {bookingStep === 2 && (
              <>
                <h3>What are you sending?</h3>
                <label htmlFor="book-cargoType">
                  Cargo Type
                  <select id="book-cargoType" name="cargoType" value={bookingForm.cargoType} onChange={handleBookingChange} required>
                    <option>Barrel</option>
                    <option>Box</option>
                    <option>Pallet</option>
                    <option>Household Goods</option>
                  </select>
                </label>
                <label htmlFor="book-quantity">
                  Quantity
                  <input id="book-quantity" type="number" name="quantity" value={bookingForm.quantity} onChange={handleBookingChange} min="1" required />
                </label>
                {bookingForm.cargoType === 'Box' && (
                  <>
                    <label htmlFor="book-boxMode">
                      Box Details Mode
                      <select id="book-boxMode" name="boxMode" value={bookingForm.boxMode} onChange={handleBookingChange}>
                        <option value="standardized">All boxes same size/weight</option>
                        <option value="mixed">Each box is different</option>
                      </select>
                    </label>
                    {bookingForm.boxMode === 'standardized' && (
                      <label htmlFor="book-boxPreset">
                        Box Size Preset
                        <select id="book-boxPreset" name="boxPreset" value={bookingForm.boxPreset} onChange={handleBookingChange}>
                          {BOX_PRESETS.map((preset) => (
                            <option key={preset.key} value={preset.key}>{preset.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label htmlFor="book-weightPerUnit">
                  {bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed' ? 'Default Weight per Box (lbs)' : 'Weight per Unit (lbs)'}
                  <input id="book-weightPerUnit" type="number" name="weightPerUnit" value={bookingForm.weightPerUnit} onChange={handleBookingChange} min="1" required />
                </label>
                <label htmlFor="book-dimensionsLength">
                  {bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed'
                    ? 'Default Dimensions (L x W x H in inches) — optional'
                    : 'Dimensions (L x W x H in inches) — optional'}
                  <div className="input-row">
                    <input id="book-dimensionsLength" type="number" name="dimensionsLength" placeholder="Length" value={bookingForm.dimensionsLength} onChange={handleBookingChange} min="1" />
                    <input id="book-dimensionsWidth" type="number" name="dimensionsWidth" placeholder="Width" value={bookingForm.dimensionsWidth} onChange={handleBookingChange} min="1" />
                    <input id="book-dimensionsHeight" type="number" name="dimensionsHeight" placeholder="Height" value={bookingForm.dimensionsHeight} onChange={handleBookingChange} min="1" />
                  </div>
                </label>
                {bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed' && (
                  <div className="booking-summary" style={{ padding: '0.75rem', border: '1px solid #d9e5df', background: '#f7fbf9' }}>
                    <p style={{ marginBottom: '0.5rem' }}><strong>Per-Box Details</strong></p>
                    {bookingBoxItems.map((box, index) => (
                      <div key={`box-item-${index}`} style={{ marginBottom: '0.65rem', borderBottom: '1px dashed #d9e5df', paddingBottom: '0.65rem' }}>
                        <p style={{ marginBottom: '0.35rem' }}><strong>{box.label || `Box ${index + 1}`}</strong></p>
                        <div className="input-row">
                          <input
                            type="number"
                            min="1"
                            placeholder="Weight (lbs)"
                            value={box.weight}
                            onChange={(event) => handleBookingBoxItemChange(index, 'weight', event.target.value)}
                          />
                          <input
                            type="number"
                            min="1"
                            placeholder="Length"
                            value={box.length}
                            onChange={(event) => handleBookingBoxItemChange(index, 'length', event.target.value)}
                          />
                          <input
                            type="number"
                            min="1"
                            placeholder="Width"
                            value={box.width}
                            onChange={(event) => handleBookingBoxItemChange(index, 'width', event.target.value)}
                          />
                          <input
                            type="number"
                            min="1"
                            placeholder="Height"
                            value={box.height}
                            onChange={(event) => handleBookingBoxItemChange(index, 'height', event.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                    <p className="section-intro" style={{ marginBottom: 0 }}>
                      Tip: leave all 3 dimensions blank for a box if only actual weight is known.
                    </p>
                  </div>
                )}
                <label htmlFor="book-estimatedValue">
                  Estimated Value (USD)
                  <input id="book-estimatedValue" type="number" name="estimatedValue" value={bookingForm.estimatedValue} onChange={handleBookingChange} min="0" />
                </label>
                <div className="booking-summary" style={{ padding: '0.75rem', border: '1px solid #d9e5df', background: '#f7fbf9' }}>
                  <p style={{ marginBottom: '0.5rem' }}><strong>One-Stop Supply Add-Ons</strong></p>
                  {SUPPLY_CATALOG.map((supply) => (
                    <label key={supply.key} htmlFor={`book-${supply.field}`} style={{ marginBottom: '0.5rem' }}>
                      {supply.label} (${supply.unitPriceUsd} each)
                      <input
                        id={`book-${supply.field}`}
                        type="number"
                        name={supply.field}
                        min="0"
                        value={bookingForm[supply.field]}
                        onChange={handleBookingChange}
                      />
                      <span className="section-intro" style={{ display: 'block' }}>{supply.description}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Step 3: Jamaica Delivery */}
            {bookingStep === 3 && (
              <>
                <h3>Where in Jamaica are we delivering?</h3>
                <label htmlFor="book-jamaicaRecipient">
                  Recipient Name
                  <input id="book-jamaicaRecipient" name="jamaicaRecipient" value={bookingForm.jamaicaRecipient} onChange={handleBookingChange} required />
                </label>
                <label htmlFor="book-jamaicaAddress">
                  Delivery Address
                  <input id="book-jamaicaAddress" name="jamaicaAddress" placeholder="Street address" value={bookingForm.jamaicaAddress} onChange={handleBookingChange} required />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <label htmlFor="book-jamaicaLocation">
                    Jamaica City/Area
                    <select id="book-jamaicaLocation" name="jamaicaLocation" value={bookingForm.jamaicaLocation} onChange={handleBookingChange} required>
                      {JAMAICA_LOCATIONS_WITH_PARISHES.map(loc => (
                        <option key={loc.city} value={loc.city}>{loc.city}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="book-parish">
                    Parish
                    <select
                      id="book-parish"
                      name="deliveryParish" 
                      value={bookingForm.deliveryParish || ''} 
                      onChange={handleBookingChange}
                      required
                    >
                      <option value="">Select parish</option>
                      {JAMAICA_PARISHES.map(parish => (
                        <option key={parish} value={parish}>{parish}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            {/* Step 4: Choose Service */}
            {bookingStep === 4 && (
              <>
                <h3>Choose Your Service Level</h3>
                <div className="service-tiers">
                  {SERVICE_TIERS.map(tier => (
                    <label key={tier.name} className="service-option">
                      <input type="radio" name="serviceLevel" value={tier.name} checked={bookingForm.serviceLevel === tier.name} onChange={handleBookingChange} />
                      <div className="service-details">
                        <strong>{tier.name}</strong>
                        <p>{tier.label}</p>
                        <small>{tier.days} business days</small>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Step 5: Confirm & Pay */}
            {bookingStep === 5 && (
              <>
                <h3>Confirm Your Shipment</h3>
                <div className="booking-summary">
                  <p><strong>Pickup:</strong> {bookingForm.pickupDate} at {bookingForm.pickupAddress}, {bookingForm.pickupCity}</p>
                  <p><strong>Shipment:</strong> {bookingForm.quantity} {bookingForm.cargoType}(s){bookingForm.boxMode === 'mixed' && bookingForm.cargoType === 'Box' ? '' : `, ~${bookingForm.weightPerUnit} lbs each`}</p>
                  {bookingForm.cargoType === 'Box' && bookingForm.boxMode === 'mixed' && (
                    <p><strong>Box Breakdown:</strong> {bookingBoxItems.map((box, idx) => `Box ${idx + 1}: ${box.weight || '?'} lbs`).join(' | ')}</p>
                  )}
                  <p><strong>Total Weight:</strong> {bookingTotalWeightLbs.toFixed(1)} lbs</p>
                  <p><strong>Delivery:</strong> {bookingForm.jamaicaRecipient}, {bookingForm.jamaicaLocation}, Jamaica</p>
                  <p><strong>Service:</strong> {bookingForm.serviceLevel} — ${estimatedPrice}</p>
                  {bookingSupplyAddons.length > 0 && (
                    <p><strong>Supplies:</strong> {bookingSupplyAddons.map((item) => `${item.quantity} ${item.label}`).join(', ')} — ${bookingSupplyAddonsTotalUsd.toFixed(2)}</p>
                  )}
                  <p><strong>Unified Checkout Total:</strong> ${bookingCheckoutTotalUsd.toFixed(2)}</p>
                </div>
                <label htmlFor="book-packingDeclaration" className="checkbox-label">
                  <input id="book-packingDeclaration" type="checkbox" name="packingDeclaration" checked={bookingForm.packingDeclaration} onChange={handleBookingChange} required />
                  I declare the contents and certify no prohibited items
                </label>
                <label htmlFor="book-agreement" className="checkbox-label">
                  <input id="book-agreement" type="checkbox" name="agreementAccepted" checked={bookingForm.agreementAccepted} onChange={handleBookingChange} required />
                  I agree to Clear Logistics & Freight Services terms
                </label>
              </>
            )}

            {/* Step 6: Shipment Created */}
            {bookingStep === 6 && (
              <>
                <h3>🎉 Shipment Created!</h3>
                <div className="shipment-confirmation">
                  <p className="shipment-id">Shipment ID: <strong>{shipmentId}</strong></p>
                  {bookingQrCode && <img src={bookingQrCode} alt="QR Code" style={{ width: '150px', margin: '1rem 0' }} />}
                  <p className="section-intro">Your driver will scan this QR code at pickup.</p>
                  <button type="button" className="btn btn--solid" onClick={handlePayment} disabled={isLoading}>
                    Proceed to Payment
                  </button>
                </div>
              </>
            )}

            {/* Navigation */}
            {bookingStep < 6 && (
              <div className="booking-nav">
                {bookingStep > 1 && (
                  <button type="button" className="btn btn--ghost" onClick={handleBookingStepBack} disabled={isLoading}>
                    Back
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={handleSaveQuoteFromBooking} disabled={isLoading}>
                  Save Quote
                </button>
                {bookingStep < 5 && (
                  <button type="button" className="btn btn--solid" onClick={handleBookingStepNext} disabled={isLoading}>
                    Next
                  </button>
                )}
                {bookingStep === 5 && (
                  <button type="submit" className="btn btn--solid" disabled={isLoading}>
                    Create Shipment
                  </button>
                )}
              </div>
            )}
            {lastSavedQuoteId && bookingStep < 6 && (
              <p className="section-intro" style={{ marginTop: '0.5rem' }}>
                Latest saved quote ID: {lastSavedQuoteId}
              </p>
            )}
          </form>
        </div>

        <div>
          <h2>Service Pricing</h2>
          <p className="section-intro">Estimated costs based on weight and service level.</p>
          <div className="pricing">
            <ul>
              {SERVICE_TIERS.map((tier) => (
                <li key={tier.name}>
                  <span>{tier.name}</span>
                  <span>{tier.days} days</span>
                  <strong>${Math.round(50 * tier.multiplier)}</strong>
                </li>
              ))}
            </ul>
          </div>
          <p className="section-intro" style={{ marginTop: '0.75rem' }}>
            Supply add-ons available per booking: barrels, boxes, utility containers, and packing kits.
          </p>
          <p className="section-intro" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            Final price calculated at checkout based on actual weight and contents.
          </p>
        </div>
      </section>
    );
  }

  function TrackingPage() {
    const completionValue = useMemo(() => {
      if (!trackingResult?.milestones?.length) return 0;
      const done = trackingResult.milestones.filter((s) => s.done).length;
      return Math.round((done / trackingResult.milestones.length) * 100);
    }, [trackingResult]);

    return (
      <>
        {/* Breadcrumb Navigation */}
        <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--brand)',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              font: 'inherit'
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
        <section className="card card--split">
        <div>
          <h2>Track Shipment</h2>
          <label className="inline-label">
            Shipment ID
            <input
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
              placeholder="Enter shipment ID (e.g., CLF-12345)"
            />
          </label>
          <button type="button" className="btn btn--ghost" onClick={handleTrackShipment} disabled={isLoading}>
            Check Status
          </button>
          {trackingResult && (
            <div className="tracking-result">
              <strong>{trackingResult.shipmentId}</strong>
              <p>{trackingResult.status}</p>
            </div>
          )}
        </div>

        <div>
          <h2>Shipment Journey</h2>
          {trackingResult ? (
            <>
              <div className="progress-shell">
                <div className="progress-label">
                  <span>Journey Progress</span>
                  <span>{completionValue}%</span>
                </div>
                <div className="progress-bar">
                  <div style={{ width: `${completionValue}%` }} />
                </div>
              </div>
              <ul className="status-list">
                {trackingResult.milestones.map((step) => (
                  <li key={step.label} className={step.done ? 'done' : ''}>
                    <span>{step.done ? '✔' : '◻'}</span> {step.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="section-intro">Enter a known shipment ID to view status updates.</p>
          )}
        </div>
      </section>
      </>
    );
  }

  function DashboardPage() {
    const isAdminUser = currentUser?.role === 'admin';

    if (isAdminUser) {
      return AdminDashboardPage({ overviewOnly: true });
    }

    const activeShipment = customerShipments[0] || null;
    const recentShipments = customerShipments.slice(1, 4);
    const recentQuotes = customerQuotes.slice(0, 5);
    const activeShipmentProgress = activeShipment?.steps?.length
      ? Math.round((activeShipment.steps.filter((s) => s.done).length / activeShipment.steps.length) * 100)
      : 0;

    return (
      <>
        {/* Welcome Banner */}
        <section className="card dashboard-welcome" style={{ background: 'linear-gradient(135deg, #f0f7f6 0%, #fff 100%)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '2rem' }}>
            <div>
              <h2>Welcome back, {currentUser?.fullName || 'Customer'}! 👋</h2>
              <p className="section-intro">Track your shipments in real time and get instant quotes on new shipments.</p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => navigate('/book-pickup')}
                style={{ padding: '0.8rem 2rem', whiteSpace: 'nowrap' }}
              >
                📦 Book Shipment
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => navigate('/cart-estimator')}
                style={{ padding: '0.8rem 2rem', whiteSpace: 'nowrap' }}
              >
                🤖 AI Estimator
              </button>
            </div>
          </div>
        </section>

        {customerDashboardLoading ? (
          <section className="card">
            <p className="section-intro">Loading your shipments and quotes...</p>
          </section>
        ) : null}

        {/* Active Shipment with Progress Milestone */}
        {activeShipment && (
          <section className="card dashboard-shipment">
            <h2 style={{ marginBottom: '1.5rem' }}>Your Active Shipment</h2>
            <div className="shipment-header">
              <div>
                <p className="shipment-id">{activeShipment.shipmentId}</p>
                <p style={{ margin: '0.25rem 0', color: '#666', fontSize: '0.95rem' }}>{activeShipment.lane}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0', fontWeight: 'bold', color: '#0b6b61' }}>{activeShipment.status}</p>
                <p style={{ margin: '0.25rem 0', color: '#666', fontSize: '0.9rem' }}>ETA: {activeShipment.eta}</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="progress-shell" style={{ margin: '1.5rem 0' }}>
              <div className="progress-label">
                <span>Journey Progress</span>
                <span>{activeShipmentProgress}%</span>
              </div>
              <div className="progress-bar">
                <div style={{ width: `${activeShipmentProgress}%` }} />
              </div>
            </div>

            {/* Milestone Timeline */}
            <ol className="milestone-timeline" aria-label="Active shipment milestones">
              {activeShipment.steps.map((step, idx) => (
                <li key={step.label} className={`milestone-step ${step.done ? 'completed' : 'pending'}`} aria-current={step.done ? undefined : 'step'}>
                  <div className="milestone-indicator">
                    <div className="milestone-dot">{step.done ? '✔' : ''}</div>
                    {idx < activeShipment.steps.length - 1 && <div className="milestone-line" />}
                  </div>
                  <div className="milestone-content">
                    <p className="milestone-title">{step.label}</p>
                    {step.done && <p className="milestone-date">Completed</p>}
                  </div>
                </li>
              ))}
            </ol>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setTrackingId(activeShipment.shipmentId);
                setTrackingResult({
                  shipmentId: activeShipment.shipmentId,
                  status: activeShipment.status,
                  milestones: activeShipment.steps.map((step) => ({
                    label: step.label,
                    done: step.done,
                  })),
                });
                navigate('/tracking');
              }}
              style={{ marginTop: '1.5rem', width: '100%' }}
            >
              View Full Tracking Details
            </button>
          </section>
        )}

        {!customerDashboardLoading && !activeShipment ? (
          <section className="card">
            <h2 style={{ marginBottom: '0.9rem' }}>No Shipments Yet</h2>
            <p className="section-intro">You have not created a shipment yet. Start with Book Shipment or Shop & Ship to see live tracking here.</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--solid" onClick={() => navigate('/book-pickup')}>Book Shipment</button>
              <button type="button" className="btn btn--ghost" onClick={() => navigate('/shop')}>Open Shop & Ship</button>
            </div>
          </section>
        ) : null}

        {/* AI Estimator Feature Card */}
        <section className="card dashboard-ai-feature">
          <div className="ai-feature-header">
            <div>
              <h2>✨ Smart Shipping Estimator</h2>
              <p className="section-intro">Paste an Amazon, Walmart, or eBay link. Get an instant quote in seconds.</p>
            </div>
          </div>
          <div className="ai-feature-demo">
            <div className="ai-feature-step">
              <div className="step-number">1</div>
              <p>Paste a product or cart link</p>
            </div>
            <div className="ai-feature-arrow">→</div>
            <div className="ai-feature-step">
              <div className="step-number">2</div>
              <p>Get instant cost estimate</p>
            </div>
            <div className="ai-feature-arrow">→</div>
            <div className="ai-feature-step">
              <div className="step-number">3</div>
              <p>Book with one click</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => navigate('/cart-estimator')}
            style={{ width: '100%', marginTop: '1.5rem' }}
          >
            Try the AI Estimator
          </button>
        </section>

        {/* Quick Actions Grid */}
        <section className="card">
          <h2 style={{ marginBottom: '1.5rem' }}>Quick Actions</h2>
          <div className="quick-actions-grid">
            <button
              type="button"
              className="quick-action-card"
              onClick={() => navigate('/quote')}
              aria-label="Get a shipping quote"
            >
              <div className="quick-action-icon">💰</div>
              <h3>Get a Quote</h3>
              <p>Pricing for your shipment</p>
            </button>
            <button
              type="button"
              className="quick-action-card"
              onClick={() => navigate('/tracking')}
              aria-label="Track your shipment"
            >
              <div className="quick-action-icon">📍</div>
              <h3>Track Shipment</h3>
              <p>See where your package is</p>
            </button>
            <button
              type="button"
              className="quick-action-card"
              onClick={() => navigate('/shop')}
              aria-label="Open Shop and Ship"
            >
              <div className="quick-action-icon">🛍️</div>
              <h3>Shop & Ship</h3>
              <p>Buy online, ship to Jamaica</p>
            </button>
            <button
              type="button"
              className="quick-action-card"
              onClick={() => navigate('/support')}
              aria-label="Contact support"
            >
              <div className="quick-action-icon">💬</div>
              <h3>Contact Support</h3>
              <p>Get help anytime</p>
            </button>
          </div>
        </section>

        {/* Recent account shipments */}
        {recentShipments.length > 0 && (
          <section className="card">
            <h2 style={{ marginBottom: '1.5rem' }}>Recent Shipments</h2>
            <div className="sample-shipments-grid">
              {recentShipments.map((shipment) => (
                <div key={shipment.shipmentId} className="sample-shipment-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                    <div>
                      <p style={{ margin: '0', fontWeight: 'bold', fontSize: '1.05rem' }}>{shipment.shipmentId}</p>
                      <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.9rem' }}>{shipment.lane}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: '0', fontSize: '0.85rem', fontWeight: '600', color: '#0b6b61' }}>
                        {shipment.paymentStatus === 'Paid' ? '✔ Paid' : 'Pending'}
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#666' }}>Status: {shipment.status}</p>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ marginTop: '1rem', width: '100%' }}
                    onClick={() => {
                      setTrackingId(shipment.shipmentId);
                      navigate('/tracking');
                    }}
                  >
                    Track {shipment.shipmentId}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <h2 style={{ marginBottom: '1rem' }}>My Quotes</h2>
          {recentQuotes.length === 0 ? (
            <p className="section-intro">No quotes submitted yet. Use Get a Quote to request pricing and follow-up.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              {recentQuotes.map((quote) => {
                const delivery = quote.emailStatus || {};
                const deliveryMeta = getQuoteDeliveryPresentation(delivery);
                const pricingLabel = quote.pricingMode === 'estimated' && quote.estimatedRangeUsd
                  ? `$${quote.estimatedRangeUsd.low} - $${quote.estimatedRangeUsd.high} (estimated)`
                  : Number.isFinite(Number(quote.quotedPriceUsd))
                    ? `$${Number(quote.quotedPriceUsd).toFixed(2)} (weight-based)`
                    : 'Pricing pending';

                return (
                  <article key={quote.quoteId} className="sample-shipment-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ margin: '0', fontWeight: 700 }}>{quote.quoteId}</p>
                        <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.92rem' }}>
                          {quote.origin} to {quote.destination}
                        </p>
                      </div>
                      <p style={{ margin: '0', color: deliveryMeta.color, fontSize: '0.85rem', fontWeight: 600 }}>
                        {deliveryMeta.label}
                      </p>
                    </div>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#2a2a2a' }}>
                      {quote.cargoType} • {pricingLabel}
                    </p>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#6b7280' }}>
                      Submitted {quote.createdAt ? new Date(quote.createdAt).toLocaleString() : 'N/A'}
                    </p>
                    {deliveryMeta.canRetry ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => handleRetryQuoteEmail(quote.quoteId)}
                        disabled={retryingQuoteId === quote.quoteId || isLoading}
                      >
                        {retryingQuoteId === quote.quoteId ? 'Retrying...' : 'Retry Email'}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </>
    );
  }

  function AdminDashboardPage({ overviewOnly = false } = {}) {
    const counts = adminOverview?.counts;

    const sectionMap = {
      rfqs: { key: 'rfqs', label: 'RFQs' },
      bookings: { key: 'recentBookings', label: 'Bookings' },
      purchaseRequests: { key: 'purchaseRequests', label: 'Purchase Requests' },
      supportTickets: { key: 'supportTickets', label: 'Support Tickets' },
      scanEvents: { key: 'recentScans', label: 'Barcode Scans' },
      dispatcher: { key: 'dispatcher', label: 'Dispatcher' },
    };

    const selectedSectionData = activeAdminSection !== 'dispatcher'
      ? (adminOverview?.[sectionMap[activeAdminSection]?.key] || [])
      : [];

    function handleMetricSelect(sectionKey) {
      setActiveAdminSection(sectionKey);
      setSelectedAdminItem(null);
      if (sectionKey === 'dispatcher') {
        fetchDispatcherData();
      }
    }

    return (
      <>
        <section className={`card ${overviewOnly ? 'admin-dashboard-welcome' : ''}`} style={{ background: 'linear-gradient(135deg, #f0f7f6 0%, #fff 100%)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2>{overviewOnly ? 'Operations Dashboard' : 'Admin Workspace'}</h2>
              <p className="section-intro">
                {overviewOnly
                  ? 'Live overview of RFQs, bookings, support, and dispatcher activity.'
                  : 'Administrative actions are enabled here for review, approvals, and case resolution.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {overviewOnly ? (
                <button type="button" className="btn btn--solid" onClick={() => navigate('/admin')}>
                  Open Admin Actions
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost" onClick={() => fetchAdminOverview(authToken)} disabled={adminLoading || adminActionLoading}>
              {adminLoading ? 'Refreshing...' : 'Refresh Data'}
              </button>
            </div>
          </div>
        </section>

        <section className="admin-metrics" aria-label="Admin summary metrics">
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'rfqs' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('rfqs')}>
            <strong>{counts?.rfqs || 0}</strong>
            <span>RFQs</span>
          </button>
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'bookings' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('bookings')}>
            <strong>{counts?.bookings || 0}</strong>
            <span>Bookings</span>
          </button>
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'purchaseRequests' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('purchaseRequests')}>
            <strong>{counts?.purchaseRequests || 0}</strong>
            <span>Purchase Requests</span>
          </button>
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'supportTickets' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('supportTickets')}>
            <strong>{counts?.supportTickets || 0}</strong>
            <span>Support Tickets</span>
          </button>
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'scanEvents' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('scanEvents')}>
            <strong>{counts?.scanEvents || 0}</strong>
            <span>Barcode Scans</span>
          </button>
          <button type="button" className={`card admin-metric-card admin-metric-card--interactive ${activeAdminSection === 'dispatcher' ? 'is-active' : ''}`} onClick={() => handleMetricSelect('dispatcher')}>
            <strong>{dispatcherData?.drivers?.length ?? (counts ? '—' : '…')}</strong>
            <span>Dispatcher</span>
          </button>
        </section>

        {activeAdminSection === 'dispatcher' ? (
          <>
            <section className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <h2 style={{ marginBottom: '0.25rem' }}>Dispatcher Control Panel</h2>
                  <p className="section-intro">View driver workloads and manually reassign pickups.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn--ghost" onClick={() => fetchDispatcherData()}>Refresh</button>
                  {!overviewOnly ? <button type="button" className="btn btn--solid" onClick={handleDispatcherAutoAssign}>Run Auto-Assign</button> : null}
                </div>
              </div>

              <h3 style={{ marginBottom: '0.5rem' }}>Driver Workloads</h3>
              {!dispatcherData ? (
                <p className="section-intro">Loading dispatcher data…</p>
              ) : dispatcherData.drivers.length === 0 ? (
                <p className="section-intro">No active drivers found.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {dispatcherData.drivers.map((driver) => (
                    <div key={driver.id} className="booking-summary" style={{ padding: '0.75rem' }}>
                      <p><strong>{driver.fullName}</strong></p>
                      <p style={{ fontSize: '0.85rem', color: '#555' }}>{driver.email}</p>
                      <p style={{ marginTop: '0.4rem' }}>
                        <span style={{ background: '#e8f5e9', color: '#2e7d32', borderRadius: '999px', padding: '0.1rem 0.6rem', fontSize: '0.8rem', fontWeight: 600 }}>
                          {driver.pendingCount} pending
                        </span>
                      </p>
                      {driver.activeRoute ? (
                        <p style={{ fontSize: '0.8rem', color: '#1565c0', marginTop: '0.3rem' }}>
                          Route active: {driver.activeRoute.completed}/{driver.activeRoute.total} stops
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.3rem' }}>No active route</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ marginBottom: '0.5rem' }}>Pending Pickups</h3>
              {!dispatcherData ? null : dispatcherData.pendingBookings.length === 0 ? (
                <p className="section-intro">No pending pickups.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>Shipment</th>
                        <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>Customer</th>
                        <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>Pickup Date</th>
                        <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>City</th>
                        <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>Current Driver</th>
                        {!overviewOnly ? <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}>Reassign To</th> : null}
                        {!overviewOnly ? <th style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e0e0e0' }}></th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {dispatcherData.pendingBookings.map((booking, idx) => (
                        <tr key={booking.bookingId} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{booking.shipmentId || booking.bookingId}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{booking.fullName}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{booking.pickupDate || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{booking.pickupCity || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            {booking.assignedDriverName
                              ? <span>{booking.assignedDriverName} <span style={{ fontSize: '0.75rem', color: booking.assignmentMode === 'manual' ? '#1565c0' : '#888' }}>({booking.assignmentMode})</span></span>
                              : <span style={{ color: '#c62828' }}>Unassigned</span>
                            }
                          </td>
                          {!overviewOnly ? (
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <select
                                value={dispatcherReassignMap[booking.bookingId] || ''}
                                onChange={(e) => setDispatcherReassignMap((prev) => ({ ...prev, [booking.bookingId]: e.target.value }))}
                                style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem', maxWidth: '180px' }}
                              >
                                <option value="">Select driver...</option>
                                {(dispatcherData.drivers || []).map((d) => (
                                  <option key={d.id} value={d.id}>{d.fullName} ({d.pendingCount})</option>
                                ))}
                              </select>
                            </td>
                          ) : null}
                          {!overviewOnly ? (
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <button
                                type="button"
                                className="btn btn--solid"
                                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                                disabled={!dispatcherReassignMap[booking.bookingId] || dispatcherReassignMap[booking.bookingId] === booking.assignedDriverId}
                                onClick={() => handleDispatcherReassign(booking.bookingId)}
                              >
                                Reassign
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
        <section className="card card--split">
          <div>
            <h2>Recent RFQs</h2>
            <div className="admin-list">
              {(adminOverview?.rfqs || []).map((quote) => (
                <button
                  type="button"
                  key={quote.quoteId}
                  className="booking-summary booking-summary--interactive"
                  style={{ marginBottom: '0.75rem' }}
                  onClick={() => {
                    setActiveAdminSection('rfqs');
                    setSelectedAdminItem({ sectionKey: 'rfqs', item: quote });
                  }}
                >
                  <p><strong>{quote.quoteId}</strong> - {quote.fullName}</p>
                  <p><strong>Route:</strong> {quote.origin} to {quote.destination}</p>
                  <p><strong>Type:</strong> {quote.cargoType} / {quote.serviceLevel}</p>
                  <p><strong>Quote:</strong> {quote.quotedPriceUsd ? `$${quote.quotedPriceUsd}` : `${quote.estimatedRangeUsd?.low || '?'}-${quote.estimatedRangeUsd?.high || '?'}`}</p>
                </button>
              ))}
              {!adminOverview?.rfqs?.length && <p className="section-intro">No RFQs yet.</p>}
            </div>
          </div>

          <div>
            <h2>Recent Bookings</h2>
            <div className="admin-list">
              {(adminOverview?.recentBookings || []).map((booking) => (
                <button
                  type="button"
                  key={booking.bookingId}
                  className="booking-summary booking-summary--interactive"
                  style={{ marginBottom: '0.75rem' }}
                  onClick={() => {
                    setActiveAdminSection('bookings');
                    setSelectedAdminItem({ sectionKey: 'bookings', item: booking });
                  }}
                >
                  <p><strong>{booking.shipmentId}</strong> - {booking.fullName}</p>
                  <p><strong>Status:</strong> {booking.paymentStatus || 'pending'} / {booking.serviceLevel}</p>
                  <p><strong>Pickup:</strong> {booking.pickupCity} on {booking.pickupDate}</p>
                </button>
              ))}
              {!adminOverview?.recentBookings?.length && <p className="section-intro">No bookings yet.</p>}
            </div>
          </div>
        </section>

        <section className="card card--split">
          <div>
            <h2>Purchase Requests</h2>
            <div className="admin-list">
              {(adminOverview?.purchaseRequests || []).map((request) => (
                <button
                  type="button"
                  key={request.requestId}
                  className="booking-summary booking-summary--interactive"
                  style={{ marginBottom: '0.75rem' }}
                  onClick={() => {
                    setActiveAdminSection('purchaseRequests');
                    setSelectedAdminItem({ sectionKey: 'purchaseRequests', item: request });
                  }}
                >
                  <p><strong>{request.requestId}</strong> - {request.fullName}</p>
                  <p><strong>Store:</strong> {request.storeName}</p>
                  <p><strong>Landed Total:</strong> ${request.totalUsd || request.budgetUsd || 'N/A'}</p>
                  <p><strong>Customs Ready:</strong> {request.customsReady ? 'Yes' : 'No'} ({request.customsReadyScore || 0}%)</p>
                  <p><strong>Review:</strong> {request.needsAdminReview ? 'Needs Admin Review' : 'Standard'}</p>
                  <p><strong>Alerts:</strong> {request.notificationPreferences?.whatsapp ? 'WhatsApp ' : ''}{request.notificationPreferences?.sms ? 'SMS' : ''}{!request.notificationPreferences?.whatsapp && !request.notificationPreferences?.sms ? 'None' : ''}</p>
                </button>
              ))}
              {!adminOverview?.purchaseRequests?.length && <p className="section-intro">No purchase requests yet.</p>}
            </div>
          </div>

          <div>
            <h2>Support Tickets</h2>
            <div className="admin-list">
              {(adminOverview?.supportTickets || []).map((ticket) => (
                <button
                  type="button"
                  key={ticket.ticketId}
                  className="booking-summary booking-summary--interactive"
                  style={{ marginBottom: '0.75rem' }}
                  onClick={() => {
                    setActiveAdminSection('supportTickets');
                    setSelectedAdminItem({ sectionKey: 'supportTickets', item: ticket });
                  }}
                >
                  <p><strong>{ticket.ticketId}</strong> - {ticket.fullName}</p>
                  <p><strong>Email:</strong> {ticket.email}</p>
                  <p><strong>Shipment:</strong> {ticket.shipmentId || 'N/A'}</p>
                </button>
              ))}
              {!adminOverview?.supportTickets?.length && <p className="section-intro">No support tickets yet.</p>}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Recent Barcode Scans</h2>
          <div className="admin-list">
            {(adminOverview?.recentScans || []).map((scan) => (
              <div key={scan.scanId} className="booking-summary" style={{ marginBottom: '0.75rem' }}>
                <p><strong>{scan.shipmentId}</strong> - {scan.driverName || scan.driverId}</p>
                <p><strong>Source:</strong> {scan.source || 'manual'}</p>
                <p><strong>When:</strong> {scan.createdAt ? new Date(scan.createdAt).toLocaleString() : 'N/A'}</p>
              </div>
            ))}
            {!adminOverview?.recentScans?.length && <p className="section-intro">No scan events yet.</p>}
          </div>
        </section>

        {!overviewOnly ? (
          <section className="card" aria-live="polite">
            <h2>{sectionMap[activeAdminSection].label} Workspace</h2>
            <p className="section-intro">{selectedSectionData.length} record(s) in this section.</p>

            {selectedAdminItem ? (
              <div className="booking-summary" style={{ marginBottom: '0.9rem' }}>
                <p><strong>Selected:</strong> {selectedAdminItem.item.quoteId || selectedAdminItem.item.shipmentId || selectedAdminItem.item.requestId || selectedAdminItem.item.ticketId}</p>
                <p><strong>Name:</strong> {selectedAdminItem.item.fullName || 'N/A'}</p>
                <p><strong>Email:</strong> {selectedAdminItem.item.email || 'N/A'}</p>

                {selectedAdminItem.sectionKey === 'rfqs' ? (
                  <div className="admin-action-row">
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/rfqs/${selectedAdminItem.item.quoteId}/review`,
                        body: { reviewStatus: 'Reviewed' },
                        successMessage: `RFQ ${selectedAdminItem.item.quoteId} marked as reviewed.`
                      })}
                    >
                      Mark Reviewed
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/rfqs/${selectedAdminItem.item.quoteId}/review`,
                        body: { reviewStatus: 'Needs Follow-up' },
                        successMessage: `RFQ ${selectedAdminItem.item.quoteId} flagged for follow-up.`
                      })}
                    >
                      Needs Follow-up
                    </button>
                  </div>
                ) : null}

                {selectedAdminItem.sectionKey === 'purchaseRequests' ? (
                  <div className="admin-action-row">
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/purchase-requests/${selectedAdminItem.item.requestId}/status`,
                        body: { status: 'Approved' },
                        successMessage: `Purchase request ${selectedAdminItem.item.requestId} approved.`
                      })}
                    >
                      Approve Request
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/purchase-requests/${selectedAdminItem.item.requestId}/status`,
                        body: { status: 'Rejected' },
                        successMessage: `Purchase request ${selectedAdminItem.item.requestId} rejected.`
                      })}
                    >
                      Reject Request
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/purchase-requests/${selectedAdminItem.item.requestId}/status`,
                        body: { status: 'In Procurement' },
                        successMessage: `Purchase request ${selectedAdminItem.item.requestId} moved to procurement.`
                      })}
                    >
                      Move to Procurement
                    </button>
                  </div>
                ) : null}

                {selectedAdminItem.sectionKey === 'supportTickets' ? (
                  <div className="admin-action-row">
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/support/${selectedAdminItem.item.ticketId}/status`,
                        body: { status: 'In Progress' },
                        successMessage: `Ticket ${selectedAdminItem.item.ticketId} set to in progress.`
                      })}
                    >
                      Start Handling
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/support/${selectedAdminItem.item.ticketId}/status`,
                        body: { status: 'Resolved' },
                        successMessage: `Ticket ${selectedAdminItem.item.ticketId} marked resolved.`
                      })}
                    >
                      Mark Resolved
                    </button>
                  </div>
                ) : null}

                {selectedAdminItem.sectionKey === 'bookings' ? (
                  <div className="admin-action-row">
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/bookings/${selectedAdminItem.item.bookingId}/payment`,
                        body: { paymentStatus: 'paid' },
                        successMessage: `Booking ${selectedAdminItem.item.bookingId} marked paid.`
                      })}
                    >
                      Mark Paid
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={adminActionLoading}
                      onClick={() => handleAdminRecordAction({
                        endpoint: `/admin/bookings/${selectedAdminItem.item.bookingId}/payment`,
                        body: { paymentStatus: 'pending' },
                        successMessage: `Booking ${selectedAdminItem.item.bookingId} moved to pending payment.`
                      })}
                    >
                      Set Pending
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        if (selectedAdminItem.item.shipmentId) {
                          setTrackingId(selectedAdminItem.item.shipmentId);
                          navigate('/tracking');
                        }
                      }}
                    >
                      Open Tracking
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="section-intro">Select a card above to see admin actions.</p>
            )}
          </section>
        ) : null}
          </>
        )}
      </>
    );
  }

  function BusinessPage() {
    return (
      <section className="card card--split">
        <div>
          <h2>Personal Shipping</h2>
          <p className="section-intro">Built for families and individuals shipping from the USA to Jamaica.</p>
          <ul className="type-list">
            {PERSONAL_FEATURES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Business Accounts</h2>
          <p className="section-intro">Designed for recurring freight, commercial lanes, and growing operations.</p>
          <ul className="type-list">
            {BUSINESS_FEATURES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  function SupportPage() {
    return (
      <section className="card">
        <h2>Contact Support</h2>
        <form className="form" onSubmit={handleSupportSubmit}>
          <label>
            Full Name
            <input name="fullName" value={supportForm.fullName} onChange={handleSupportChange} required />
          </label>
          <label>
            Email
            <input type="email" name="email" value={supportForm.email} onChange={handleSupportChange} required />
          </label>
          <label>
            Shipment ID (optional)
            <input name="shipmentId" value={supportForm.shipmentId} onChange={handleSupportChange} />
          </label>
          <label>
            How can we help?
            <textarea name="message" value={supportForm.message} onChange={handleSupportChange} rows="4" required />
          </label>
          <button type="submit" className="btn btn--solid" disabled={isLoading}>Send Support Request</button>
        </form>
      </section>
    );
  }

  function AccountPage() {
    return (
      <section className="card">
        <h2>Create Account</h2>
        <form className="form" onSubmit={handleAccountSubmit}>
          <label>
            Full Name
            <input name="fullName" value={accountForm.fullName} onChange={handleAccountChange} required />
          </label>
          <label>
            Email
            <input type="email" name="email" value={accountForm.email} onChange={handleAccountChange} required />
          </label>
          <label>
            Password
            <input type="password" name="password" value={accountForm.password} onChange={handleAccountChange} required />
          </label>
          <button type="submit" className="btn btn--solid" disabled={isLoading}>Create Account</button>
        </form>
      </section>
    );
  }

  function LoginPage() {
    return (
      <section className="card card--split">
        <div>
          <h2>Login</h2>
          <p className="section-intro">Sign in to access booking and dashboard features.</p>
          <form className="form" onSubmit={handleLoginSubmit}>
            <label>
              Email
              <input type="email" name="email" value={loginForm.email} onChange={handleLoginChange} required />
            </label>
            <label>
              Password
              <input type="password" name="password" value={loginForm.password} onChange={handleLoginChange} required />
            </label>
            <button type="submit" className="btn btn--solid" disabled={isLoading}>Login</button>
          </form>
        </div>

        <div>
          <h2>New Here?</h2>
          <p className="section-intro">Create your account to book pickups and manage shipments.</p>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/account')}>
            Create Account
          </button>
        </div>
      </section>
    );
  }

  function HowItWorksDetailPage() {
    const step = stepKey ? howItWorksByKey.get(stepKey) : null;

    if (!step) {
      return <Navigate to="/" replace />;
    }

    return (
      <section className="card card--split">
        <div>
          <p className="how-step__num">How It Works</p>
          <h2>{step.title}</h2>
          <p className="section-intro">{step.summary}</p>
          <ul className="status-list">
            {step.details.map((detail) => (
              <li key={detail} className="done">
                <span>•</span> {detail}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Next Step</h2>
          <p className="section-intro">Continue your shipment flow directly from here.</p>
          <button type="button" className="btn btn--solid" onClick={() => navigate(step.ctaPath)}>
            {step.ctaLabel}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </section>
    );
  }

  function DriverLoginPage() {
    return (
      <section className="card card--split">
        <div>
          <h2>Driver Login</h2>
          <p className="section-intro">Sign in to access your pickup assignments and complete deliveries.</p>
          <form className="form" onSubmit={handleDriverLogin}>
            <label>
              Email
              <input type="email" value={driverLoginForm.email} onChange={(e) => setDriverLoginForm({...driverLoginForm, email: e.target.value})} required />
            </label>
            <label>
              Password
              <input type="password" value={driverLoginForm.password} onChange={(e) => setDriverLoginForm({...driverLoginForm, password: e.target.value})} required />
            </label>
            <button type="submit" className="btn btn--solid" disabled={isLoading}>Login</button>
          </form>
        </div>
        <div>
          <h2>New Driver?</h2>
          <p className="section-intro">Create a driver account to start accepting pickups.</p>
          <button type="button" className="btn btn--ghost" onClick={() => setDriverMode('register')}>Create Driver Account</button>
        </div>
      </section>
    );
  }

  function DriverRegisterPage() {
    return (
      <section className="card card--split">
        <div>
          <h2>Driver Registration</h2>
          <p className="section-intro">Sign up to become a driver and start earning.</p>
          <form className="form" onSubmit={handleDriverRegister}>
            <label>
              Full Name
              <input value={driverRegisterForm.fullName} onChange={(e) => setDriverRegisterForm({...driverRegisterForm, fullName: e.target.value})} required />
            </label>
            <label>
              Email
              <input type="email" value={driverRegisterForm.email} onChange={(e) => setDriverRegisterForm({...driverRegisterForm, email: e.target.value})} required />
            </label>
            <label>
              Phone
              <input type="tel" value={driverRegisterForm.phone} onChange={(e) => setDriverRegisterForm({...driverRegisterForm, phone: e.target.value})} required />
            </label>
            <label>
              Vehicle
              <input placeholder="e.g., Honda Civic 2020" value={driverRegisterForm.vehicle} onChange={(e) => setDriverRegisterForm({...driverRegisterForm, vehicle: e.target.value})} required />
            </label>
            <label>
              Password
              <input type="password" value={driverRegisterForm.password} onChange={(e) => setDriverRegisterForm({...driverRegisterForm, password: e.target.value})} required />
            </label>
            <button type="submit" className="btn btn--solid" disabled={isLoading}>Create Account</button>
          </form>
        </div>
        <div>
          <h2>Already a Driver?</h2>
          <p className="section-intro">Login to your existing account.</p>
          <button type="button" className="btn btn--ghost" onClick={() => setDriverMode('login')}>Back to Login</button>
        </div>
      </section>
    );
  }

  function DriverDashboardPage() {
    const scannedPickup = (() => {
      const exactPickup = driverPickups.find((p) => p.shipmentId === scannedShipmentId);
      if (exactPickup) {
        return exactPickup;
      }

      const routeStop = driverRoute.find((p) => p.shipmentId === scannedShipmentId);
      if (!routeStop) {
        return null;
      }

      return {
        shipmentId: routeStop.shipmentId,
        fullName: routeStop.fullName || 'Assigned customer',
        pickupAddress: routeStop.pickupAddress || '',
        pickupCity: routeStop.pickupCity || '',
        pickupZip: routeStop.pickupZip || '',
        phone: routeStop.phone || 'Not available',
        quantity: routeStop.quantity || '—',
        cargoType: routeStop.cargoType || 'Cargo',
        weight: routeStop.weight || '—',
        jamaicaRecipient: routeStop.jamaicaRecipient || 'Pending recipient',
        jamaicaLocation: routeStop.jamaicaLocation || 'Jamaica',
        serviceLevel: routeStop.serviceLevel || 'Standard',
      };
    })();
    
    return (
      <section className="card card--split">
        <div>
          <h2>🚚 Driver Dashboard</h2>
          <p className="section-intro">Hello, {driverUser?.fullName}!</p>
          <p>Vehicle: {driverUser?.vehicle}</p>
          
          {!scannedShipmentId ? (
            <>
              <h3>Scan QR Code or Select Pickup</h3>
              <label>
                QR Code / Shipment ID
                <input
                  placeholder="Scan QR or enter Shipment ID"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn--solid"
                style={{ marginTop: '0.6rem' }}
                onClick={() => openPickupFromScan(scanInput, 'manual-input')}
              >
                Log Scan & Open Pickup
              </button>
              <h3 style={{marginTop: '2rem'}}>Assigned Pickups ({driverPickups.length})</h3>
              <div className="pickups-list">
                {driverPickups.length > 0 ? (
                  <ul className="status-list">
                    {driverPickups.map(p => (
                      <li
                        key={p.shipmentId}
                        style={{cursor: 'pointer', padding: '0.5rem', borderBottom: '1px solid #e0e0e0'}}
                        onClick={() => openPickupFromScan(p.shipmentId, 'list-select')}
                      >
                        <strong>{p.shipmentId}</strong> - {p.fullName} ({p.pickupCity})
                        <small style={{ marginLeft: '0.4rem' }}>• Pickup: {p.pickupDate || 'TBD'}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="section-intro">No pending pickups. Check back later!</p>
                )}
              </div>
            </>
          ) : scannedPickup ? (
            <>
              <h3>Confirm Pickup: {scannedPickup.shipmentId}</h3>
              <div className="booking-summary">
                <p><strong>Customer:</strong> {scannedPickup.fullName}</p>
                <p><strong>Address:</strong> {scannedPickup.pickupAddress}, {scannedPickup.pickupCity} {scannedPickup.pickupZip}</p>
                <p><strong>Phone:</strong> {scannedPickup.phone}</p>
                <p><strong>Cargo:</strong> {scannedPickup.quantity} x {scannedPickup.cargoType} (~{scannedPickup.weight} lbs)</p>
                <p><strong>Delivery:</strong> {scannedPickup.jamaicaRecipient}, {scannedPickup.jamaicaLocation}, Jamaica</p>
                <p><strong>Service:</strong> {scannedPickup.serviceLevel}</p>
              </div>
              <label>
                Pickup Notes
                <textarea
                  value={pickupConfirmation.notes}
                  onChange={(e) => setPickupConfirmation({...pickupConfirmation, notes: e.target.value})}
                  rows="3"
                  placeholder="E.g. Heavy items, fragile items, special instructions..."
                />
              </label>
              <label style={{ marginTop: '0.75rem' }}>
                Pickup Photo (required)
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleDriverPickupPhotoFileChange}
                />
              </label>
              {pickupPhotoUploadState.uploading && (
                <p className="section-intro" style={{ marginTop: '0.45rem' }}>Uploading photo...</p>
              )}
              {pickupPhotoUploadState.fileName && !pickupPhotoUploadState.uploading && !pickupPhotoUploadState.error && (
                <p className="section-intro" style={{ marginTop: '0.45rem' }}>Uploaded: {pickupPhotoUploadState.fileName}</p>
              )}
              {pickupPhotoUploadState.error && (
                <p className="section-intro" style={{ marginTop: '0.45rem', color: '#b42318' }}>{pickupPhotoUploadState.error}</p>
              )}
              {pickupConfirmation.photoUrl && (
                <p className="section-intro" style={{ marginTop: '0.25rem' }}>Proof URL ready for confirmation.</p>
              )}
              <button
                type="button"
                className="btn btn--ghost"
                style={{ marginTop: '0.75rem' }}
                onClick={() => handleStartDrive(scannedPickup)}
              >
                Start Drive
              </button>
              <div className="booking-nav" style={{marginTop: '1rem'}}>
                <button type="button" className="btn btn--ghost" onClick={() => setScannedShipmentId('')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--solid"
                  onClick={() => handlePickupConfirm(scannedPickup.shipmentId)}
                  disabled={pickupConfirmLoading || pickupPhotoUploadState.uploading || !String(pickupConfirmation.photoUrl || '').trim()}
                >
                  {pickupConfirmLoading ? 'Confirming pickup...' : 'Confirm Pickup'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="section-intro" style={{color: '#d32f2f', marginTop: '1rem'}}>Shipment ID not found.</p>
              <button type="button" className="btn btn--ghost" onClick={() => setScannedShipmentId('')}>
                Back to List
              </button>
            </>
          )}
        </div>

        <div>
          <h2>Route Optimization</h2>
          <p className="section-intro">Optimized with date windows first (overdue/today), then distance, then service urgency.</p>
          <button type="button" className="btn btn--ghost" onClick={handleGenerateOptimizedRoute} disabled={isLoading}>
            Generate Optimized Route
          </button>
          {driverRouteMeta.totalStops > 0 && (
            <p className="section-intro" style={{ marginTop: '0.6rem' }}>
              {driverRouteMeta.totalStops} stops
              {driverRouteMeta.totalDistanceKm > 0 ? ` • ~${driverRouteMeta.totalDistanceKm} km` : ''}
              {' • '}Estimated driving window: {driverRouteMeta.estimatedTime || 'TBD'}
            </p>
          )}

          {driverRoute.length > 0 && !activeDriverRoute && (
            <button type="button" className="btn btn--solid" style={{ marginTop: '0.6rem' }} onClick={handleStartRouteTracking} disabled={isLoading}>
              Start Route Tracking
            </button>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <h3>Recent Scan Activity</h3>
            {driverRecentScans.length > 0 ? (
              <ul className="status-list">
                {driverRecentScans.slice(0, 8).map((scan) => (
                  <li key={scan.scanId}>
                    <strong>{scan.shipmentId}</strong>
                    {' '}• {scan.status === 'accepted' ? 'Accepted' : 'Rejected'}
                    {' '}• {new Date(scan.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="section-intro">No scan events yet for this driver session.</p>
            )}
          </div>

          {activeDriverRoute && (
            <div className="booking-summary" style={{ marginTop: '0.9rem' }}>
              <p><strong>Active Route:</strong> {activeDriverRoute.routeId}</p>
              <p><strong>Status:</strong> {activeDriverRoute.status}</p>
              <p><strong>Progress:</strong> {activeDriverRoute.progress?.completed || 0}/{activeDriverRoute.progress?.total || 0} stops completed</p>
            </div>
          )}

          {driverRoute.length > 0 && (
            <ol className="status-list" style={{marginTop: '1rem'}}>
              {driverRoute.map((p, idx) => (
                <li
                  key={p.shipmentId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openPickupFromScan(p.shipmentId, 'route-stop-select')}
                >
                  Stop {idx + 1}: {p.shipmentId} - {p.pickupAddress}, {p.pickupCity} {p.pickupZip}
                  {typeof p.legDistanceKm === 'number' ? ` • ${p.legDistanceKm} km leg` : ''}
                  {p.pickupDate ? ` (${p.pickupDate})` : ' (No date)'}
                </li>
              ))}
            </ol>
          )}
          <button type="button" className="btn btn--solid" onClick={handleDriverLogout} style={{marginTop: '2rem', width: '100%'}}>
            Logout
          </button>
        </div>
      </section>
    );
  }

  function AboutUsPage() {
    return (
      <section className="card card--wide">
        <h2>About Clear Logistics & Freight Services</h2>
        <p className="section-intro">Your trusted partner for seamless USA-Jamaica shipping.</p>
        
        <h3>Our Mission</h3>
        <p>We simplify international shipping by providing reliable, transparent, and affordable freight services between the USA and Jamaica. Our goal is to make logistics easy, fast, and stress-free for everyone.</p>
        
        <h3>Why Choose Us?</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>✅ <strong>Real-Time Tracking</strong> - Monitor your shipment every step of the way</li>
          <li>✅ <strong>Competitive Pricing</strong> - Transparent rates with no hidden fees</li>
          <li>✅ <strong>Fast Processing</strong> - Book in minutes, ship within days</li>
          <li>✅ <strong>Professional Support</strong> - Expert assistance for every shipment</li>
          <li>✅ <strong>Customs Clearance</strong> - We handle all Jamaica import documentation</li>
          <li>✅ <strong>Door-to-Door Service</strong> - Pickup from your location, delivery to your door</li>
        </ul>
        
        <h3>Our Locations</h3>
        <p>We operate from Miami, Florida with direct service to all 14 parishes in Jamaica, including Kingston, Montego Bay, Mandeville, Negril, and beyond.</p>
        
        <h3>Contact Us</h3>
        <p>Have questions? Our support team is available via email and phone. <a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact Support →</a></p>
      </section>
    );
  }

  function PrivacyPage() {
    return (
      <section className="card card--wide">
        <h2>Privacy Policy</h2>
        <p className="section-intro">Last Updated: July 2026</p>
        
        <h3>1. Information We Collect</h3>
        <p>We collect information you provide directly, such as:</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Name, email, and phone number</li>
          <li>Shipping address and delivery location</li>
          <li>Cargo information and declared value</li>
          <li>Payment information (processed securely via Stripe)</li>
        </ul>

        <h3>2. How We Use Your Information</h3>
        <p>We use your information to:</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Process and deliver your shipments</li>
          <li>Track and provide shipping updates</li>
          <li>Handle customer support requests</li>
          <li>Comply with shipping and customs regulations</li>
          <li>Improve our services</li>
        </ul>

        <h3>3. Data Security</h3>
        <p>We implement industry-standard security measures to protect your personal information. All payments are processed securely through encrypted connections.</p>

        <h3>4. Sharing Your Information</h3>
        <p>We do not sell your information. We may share information with:</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Customs brokers in Jamaica (for clearance)</li>
          <li>Shipping carriers (for delivery)</li>
          <li>Law enforcement (if required by law)</li>
        </ul>

        <h3>5. Your Rights</h3>
        <p>You have the right to access, update, or delete your personal information. Contact us at support@clearlogistics.com to make requests.</p>

        <h3>6. Contact Us</h3>
        <p>Questions about this privacy policy? <a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact us →</a></p>
      </section>
    );
  }

  function TermsPage() {
    return (
      <section className="card card--wide">
        <h2>Terms of Service</h2>
        <p className="section-intro">Last Updated: July 2026</p>
        
        <h3>1. Acceptance of Terms</h3>
        <p>By using Clear Logistics & Freight Services, you agree to these terms. If you do not agree, please do not use our services.</p>

        <h3>2. Booking & Payment</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>All bookings require valid payment information</li>
          <li>Prices are based on declared weight and service level</li>
          <li>Cancellations must be made before pickup; refunds subject to policy</li>
          <li>Final weight at warehouse may result in price adjustments</li>
        </ul>

        <h3>3. Cargo Restrictions</h3>
        <p>The following items are NOT permitted:</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Hazardous materials (flammable, explosive, toxic)</li>
          <li>Weapons or firearms</li>
          <li>Illegal drugs or controlled substances</li>
          <li>Perishable items (unless specified)</li>
          <li>Items subject to customs restrictions</li>
        </ul>

        <h3>4. Liability</h3>
        <p>Clear Logistics is not liable for:</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Theft, loss, or damage to cargo (unless covered by declared value insurance)</li>
          <li>Delays due to customs, weather, or port closures</li>
          <li>Damage caused by improper packing</li>
        </ul>

        <h3>5. Insurance</h3>
        <p>Standard service includes basic coverage. Additional insurance available for high-value items. Declared value must match actual cargo value.</p>

        <h3>6. Contact Us</h3>
        <p>Questions about these terms? <a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact us →</a></p>
      </section>
    );
  }

  function ShippingInformationPage() {
    return (
      <section className="card card--wide">
        <h2>Shipping Information</h2>
        <p className="section-intro">Know exactly what to prepare before your cargo moves from the USA to Jamaica.</p>

        <h3>1. How The Shipping Flow Works</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Book pickup or submit Shop & Ship purchase request.</li>
          <li>Cargo is collected and checked into our US warehouse.</li>
          <li>Shipment is prepared, manifested, and dispatched to Jamaica.</li>
          <li>Customs clearance is processed before final delivery.</li>
        </ul>

        <h3>2. Service Timelines</h3>
        <p><strong>Economy:</strong> 14-18 days | <strong>Standard:</strong> 7-12 days | <strong>Premium:</strong> 3-5 days</p>
        <p>Timelines are estimates and may vary due to customs inspections, weather disruptions, and port congestion.</p>

        <h3>3. Required Documents</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Commercial invoice or order receipt for each shipment.</li>
          <li>Government-issued ID for customs validation when requested.</li>
          <li>Import permit for controlled or regulated categories.</li>
          <li>Accurate declared values matching your actual order totals.</li>
        </ul>

        <h3>4. Prohibited and Restricted Items</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Explosives, flammables, hazardous chemicals, and toxic materials.</li>
          <li>Illegal drugs, unauthorized pharmaceuticals, and contraband.</li>
          <li>Firearms and weapon components without legal approvals.</li>
          <li>Counterfeit items and goods restricted by customs regulations.</li>
        </ul>

        <h3>5. Pricing and Charges</h3>
        <p>Final pricing is influenced by weight, dimensions, cargo category, destination parish, and declared value. Customs duties and related fees are applied according to Jamaica import rules.</p>

        <h3>6. Tracking and Updates</h3>
        <p>Use your shipment ID on the tracking page to view milestone progress. Major status events include pickup, warehouse intake, dispatch, customs clearance, and delivery.</p>

        <h3>7. Need Help?</h3>
        <p><a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact Support →</a></p>
      </section>
    );
  }

  function ServicePolicyPage() {
    return (
      <section className="card card--wide">
        <h2>Service Policy</h2>
        <p className="section-intro">Clear operating policies for bookings, payment, delivery timelines, and claims.</p>

        <h3>1. Booking Accuracy</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Customers must provide accurate shipment details and declared values.</li>
          <li>Incorrect declarations may cause delays, penalties, or shipment holds.</li>
          <li>Final charges may be adjusted based on verified warehouse measurements.</li>
        </ul>

        <h3>2. Payment Policy</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Payment is required before cargo release and final delivery.</li>
          <li>Unpaid balances can delay customs release and dispatch.</li>
          <li>Pricing includes service-level fees; customs and government charges may apply separately.</li>
        </ul>

        <h3>3. Cancellation and Rescheduling</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Pickup cancellations should be requested before driver dispatch.</li>
          <li>Rescheduling may be subject to route capacity and service windows.</li>
          <li>Late cancellations can incur operational handling fees.</li>
        </ul>

        <h3>4. Delays and Exceptions</h3>
        <p>Shipping times are estimates. Delays may occur from weather, port congestion, airline/ocean carrier disruptions, or customs inspections. Clear Logistics will provide milestone updates and revised ETA guidance when exceptions occur.</p>

        <h3>5. Claims and Liability</h3>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>Damage or loss claims should be submitted within 48 hours of delivery.</li>
          <li>Claims require shipment ID, supporting photos, and value documentation.</li>
          <li>Compensation is handled according to declared value and active coverage terms.</li>
        </ul>

        <h3>6. Contact and Escalation</h3>
        <p>For policy questions, billing clarifications, or claims support, use <a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact Support →</a></p>
      </section>
    );
  }

  function FAQPage() {
    return (
      <section className="card card--wide">
        <h2>Frequently Asked Questions</h2>
        <p className="section-intro">Find answers to common shipping questions.</p>

        <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '1rem', marginTop: '1rem' }}>
          <h3>How long does shipping take?</h3>
          <p><strong>Economy:</strong> 14-18 days | <strong>Standard:</strong> 7-12 days | <strong>Premium:</strong> 3-5 days. Timelines depend on customs and port availability.</p>

          <h3>How do I track my shipment?</h3>
          <p>Use your Shipment ID to track your package on our tracking page. You'll receive updates via email at each milestone (pickup, warehouse, arrival, delivery).</p>

          <h3>What if my shipment is damaged?</h3>
          <p>Report damage within 48 hours of delivery with photos. Claims require proper documentation and insurance coverage. Contact support immediately.</p>

          <h3>Can I change my delivery address?</h3>
          <p>Yes, but only before pickup. Once picked up, delivery address changes incur a fee. Contact support ASAP to request changes.</p>

          <h3>Do you ship to all Jamaica parishes?</h3>
          <p>Yes! We deliver to all 14 parishes: Kingston, Saint Andrew, St. Catherine, St. Thomas, Portland, St. Mary, St. Ann, Trelawny, Saint James, Hanover, Westmoreland, Manchester, Clarendon, and Saint Elizabeth.</p>

          <h3>What payment methods do you accept?</h3>
          <p>We accept all major credit/debit cards (Visa, Mastercard, American Express) via secure Stripe payment processing.</p>

          <h3>Is insurance required?</h3>
          <p>Standard coverage is included. Additional insurance is recommended for items over $1,000 USD.</p>

          <h3>How do customs work?</h3>
          <p>Our customs brokers handle all Jamaica import documentation. Declarations must be accurate; fines apply for undervaluation.</p>

          <h3>Still have questions?</h3>
          <p><a href="/support" style={{ color: 'var(--brand)', fontWeight: '600' }}>Contact our support team →</a></p>
        </div>
      </section>
    );
  }

  function Footer() {
    return (
      <footer className="footer">
        <div className="footer-content">
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Clear Logistics & Freight Services</h3>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>Reliable USA-Jamaica Shipping</p>
            <div className="footer-links">
              <button type="button" className="footer-link" onClick={() => navigate('/')}>Home</button>
              <button type="button" className="footer-link" onClick={() => navigate('/about')}>About Us</button>
              <button type="button" className="footer-link" onClick={() => navigate('/shipping-information')}>Shipping Information</button>
              <button type="button" className="footer-link" onClick={() => navigate('/service-policy')}>Service Policy</button>
              <button type="button" className="footer-link" onClick={() => navigate('/faq')}>FAQ</button>
              <button type="button" className="footer-link" onClick={() => navigate('/privacy')}>Privacy Policy</button>
              <button type="button" className="footer-link" onClick={() => navigate('/terms')}>Terms of Service</button>
              <button type="button" className="footer-link" onClick={() => navigate('/support')}>Contact Support</button>
            </div>
            <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--muted)' }}>© 2026 Clear Logistics & Freight Services. All rights reserved.</p>
          </div>
        </div>
      </footer>
    );
  }

  function ChatAssistant() {
    return (
      <>
        <div className="floating-actions" aria-label="Support actions">
          <button
            type="button"
            className="whatsapp-fab"
            onClick={openWhatsApp}
            aria-label="Open WhatsApp support"
            title="WhatsApp support"
          >
            WhatsApp
          </button>
          <button
            type="button"
            className="chat-fab"
            onClick={() => setChatOpen((open) => !open)}
            aria-label="Open AI chat assistant"
            title="AI chat assistant"
          >
            AI Chat
          </button>
        </div>

        {chatOpen && (
          <div className="chat-panel" role="dialog" aria-label="AI chat assistant">
            <div className="chat-panel__header">
              <div>
                <strong>AI Chat Assistant</strong>
                <p>Ask about booking, tracking, payment, or support.</p>
              </div>
              <button type="button" className="chat-panel__close" onClick={() => setChatOpen(false)} aria-label="Close chat assistant">
                ×
              </button>
            </div>

            <div className="chat-panel__messages" ref={chatMessagesRef}>
              {chatMessages.map((message) => (
                <div key={message.id} className={`chat-message chat-message--${message.role}`}>
                  {message.text}
                </div>
              ))}
            </div>

            <div className="chat-panel__suggestions">
              {CHATBOT_PROMPTS.map((prompt) => (
                <button key={prompt.label} type="button" className="chat-suggestion" onClick={() => sendSuggestedChatPrompt(prompt)}>
                  {prompt.label}
                </button>
              ))}
            </div>

            <form className="chat-panel__form" onSubmit={handleChatSubmit}>
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Ask a question..."
                aria-label="Chat message"
              />
              <button type="submit" className="btn btn--solid">Send</button>
            </form>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero__badge">Clear Logistics & Freight Services</div>
        <h1>Ship from the USA to Jamaica with Confidence</h1>
        <p>
          Book a pickup, receive an instant quote, track your shipment in real time, and have it delivered to your door.
        </p>
      </header>

      <nav className="portal-nav" aria-label="Primary portal navigation">
        <div className="portal-nav__primary">
          {NAV_ITEMS.map((item) => {
            const targetPath = item.targetPath;
            const isActive = item.activePaths.includes(currentPath);

            return (
              <button
                type="button"
                key={item.key}
                className={
                  item.isPrimary
                    ? `nav-pill ${isActive ? 'nav-pill--primary nav-pill--active' : 'nav-pill--primary-inactive pulse'}`
                    : isActive
                      ? 'nav-pill nav-pill--active'
                      : 'nav-pill'
                }
                onClick={() => {
                  if (location.pathname !== targetPath) {
                    navigate(targetPath);
                  }
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="portal-nav__auth">
          {driverAuthToken ? (
            <>
              <div className="nav-badge" aria-label="Signed in driver">
                Signed in as {driverUser?.fullName || 'Driver'}
              </div>
              <button type="button" className={currentPath === 'driver/dashboard' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/driver/dashboard')}>
                🚗 Driver Dashboard
              </button>
              <button type="button" className="nav-pill" onClick={handleDriverLogout}>
                Driver Logout
              </button>
            </>
          ) : isAuthenticated ? (
            <>
              <div className="nav-badge" aria-label="Signed in customer">
                Signed in as {currentUser?.fullName || 'Customer'}
              </div>
              <button type="button" className={currentPath === 'dashboard' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/dashboard')}>
                {currentUser?.role === 'admin' ? 'Customer View' : 'Dashboard'}
              </button>
              {currentUser?.role === 'admin' && (
                <button type="button" className={currentPath === 'admin' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/admin')}>
                  Admin
                </button>
              )}
              <button type="button" className="nav-pill" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <button type="button" className={currentPath === 'login' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/login')}>
                Login
              </button>
              <button type="button" className={currentPath === 'account' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/account')}>
                Create Account
              </button>
              <button type="button" className={currentPath === 'driver' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/driver/login')}>
                🚗 Driver Login
              </button>
            </>
          )}
        </div>
      </nav>

      <main className="layout">
        <Routes>
          <Route path="/" element={HomePage()} />
          <Route path="/how-it-works/:stepKey" element={HowItWorksDetailPage()} />
          <Route path="/book-pickup" element={BookingPage()} />
          <Route path="/booking" element={BookingPage()} />
          <Route path="/quote" element={QuotePage()} />
          <Route path="/mock-checkout" element={MockCheckoutPage()} />
          <Route path="/shop" element={ShopPage()} />
          <Route path="/cart-estimator" element={CartEstimatorPage()} />
          <Route path="/tracking" element={TrackingPage()} />
          <Route
            path="/dashboard"
            element={
              authHydrated
                ? (isAuthenticated ? DashboardPage() : <Navigate to="/login" replace state={{ from: location.pathname }} />)
                : <section className="card"><p className="section-intro">Restoring your session…</p></section>
            }
          />
          <Route
            path="/admin"
            element={
              !authHydrated
                ? <section className="card"><p className="section-intro">Restoring your session…</p></section>
                : !isAuthenticated
                  ? <Navigate to="/login" replace state={{ from: location.pathname }} />
                  : currentUser?.role === 'admin'
                    ? AdminDashboardPage()
                    : <Navigate to="/dashboard" replace />
            }
          />
          <Route path="/business" element={BusinessPage()} />
          <Route path="/support" element={SupportPage()} />
          <Route path="/login" element={LoginPage()} />
          <Route path="/account" element={AccountPage()} />
          <Route path="/about" element={AboutUsPage()} />
          <Route path="/shipping-information" element={ShippingInformationPage()} />
          <Route path="/service-policy" element={ServicePolicyPage()} />
          <Route path="/privacy" element={PrivacyPage()} />
          <Route path="/terms" element={TermsPage()} />
          <Route path="/faq" element={FAQPage()} />
          {/* Phase 2: Driver Routes */}
          <Route
            path="/driver/login"
            element={driverAuthToken ? <Navigate to="/driver/dashboard" replace /> : (driverMode === 'register' ? DriverRegisterPage() : DriverLoginPage())}
          />
          <Route
            path="/driver/dashboard"
            element={driverAuthToken ? DriverDashboardPage() : <Navigate to="/driver/login" replace />}
          />
        </Routes>
        {statusMessage && <p className="status-banner">{statusMessage}</p>}
      </main>
      <ChatAssistant />
      <Footer />
    </div>
  );
}

export default App;
