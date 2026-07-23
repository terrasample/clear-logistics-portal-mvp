import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';

const API_BASE = 'http://localhost:8787/api';

const NAV_ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'book-pickup', label: '🛢 Ship To Jamaica', isPrimary: true },
  { key: 'quote', label: 'Get a Quote' },
  { key: 'shop', label: 'Shop & Ship' },
  { key: 'tracking', label: 'Track Shipment' },
  { key: 'support', label: 'Contact Support' },
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
    key: 'book-your-shipment',
    title: 'Book Your Shipment',
    summary: 'Submit your shipment details and preferred pickup date in minutes.',
    details: [
      'Choose cargo type, quantity, and unit type.',
      'Add pickup address and a suitable pickup date.',
      'Include dimensions and weight for faster processing.',
    ],
    ctaLabel: 'Start Booking',
    ctaPath: '/booking',
  },
  {
    key: 'we-pick-it-up',
    title: 'We Pick It Up',
    summary: 'Our dispatch team coordinates and confirms your pickup window.',
    details: [
      'Pickup is scheduled and assigned to a driver.',
      'You receive shipment ID confirmation.',
      'Driver follows your notes for smooth handoff.',
    ],
    ctaLabel: 'Book Pickup',
    ctaPath: '/booking',
  },
  {
    key: 'we-prepare-it',
    title: 'We Prepare It',
    summary: 'Your shipment is checked, labeled, and prepared for export handling.',
    details: [
      'Warehouse intake and basic condition checks.',
      'Consolidation and lane readiness preparation.',
      'Shipment milestones update in the portal.',
    ],
    ctaLabel: 'Track Progress',
    ctaPath: '/tracking',
  },
  {
    key: 'we-ship-it',
    title: 'We Ship It',
    summary: 'Freight is loaded and dispatched to Jamaica on the assigned lane.',
    details: [
      'Cargo moves from warehouse to ocean/air carrier.',
      'Milestones reflect departure and transit phases.',
      'Support stays available for transit questions.',
    ],
    ctaLabel: 'View Tracking',
    ctaPath: '/tracking',
  },
  {
    key: 'customs-clearance',
    title: 'Customs Clearance',
    summary: 'Broker partners process customs documentation and clearance.',
    details: [
      'Customs review and document checks are completed.',
      'Any required follow-up is communicated quickly.',
      'Status updates continue until release is confirmed.',
    ],
    ctaLabel: 'Contact Support',
    ctaPath: '/support',
  },
  {
    key: 'delivered-to-your-door',
    title: 'Delivered to Your Door',
    summary: 'Final-mile delivery is scheduled and completed to your destination.',
    details: [
      'Delivery handoff is coordinated with your contact info.',
      'Final milestone marks successful delivery.',
      'Need help after delivery? Support is one click away.',
    ],
    ctaLabel: 'Get Help',
    ctaPath: '/support',
  },
];

const TRUST_INDICATORS = [
  'Secure Payments',
  'Real-Time Tracking',
  'USA Pickup Service',
  'Jamaica Delivery',
  'Professional Customer Support',
];

const DEMO_DASHBOARD_SHIPMENTS = [
  {
    shipmentId: 'CLF-10025',
    lane: 'Box (Standard)',
    status: 'At Miami Warehouse',
    paymentStatus: 'Paid',
    eta: '5-8 business days',
    progress: 38,
    steps: [
      { label: 'Pickup Scheduled', done: true },
      { label: 'Picked Up', done: true },
      { label: 'At Miami Warehouse', done: true },
      { label: 'Loaded on Vessel', done: false },
      { label: 'Arrived in Kingston', done: false },
      { label: 'Out for Delivery', done: false },
      { label: 'Delivered', done: false },
    ],
  },
  {
    shipmentId: 'CLF-10041',
    lane: 'Barrel (Premium)',
    status: 'Out for Delivery',
    paymentStatus: 'Paid',
    eta: 'Today by 6:00 PM',
    progress: 88,
    steps: [
      { label: 'Pickup Scheduled', done: true },
      { label: 'Picked Up', done: true },
      { label: 'At Miami Warehouse', done: true },
      { label: 'Loaded on Vessel', done: true },
      { label: 'Arrived in Kingston', done: true },
      { label: 'Customs Clearance', done: true },
      { label: 'Out for Delivery', done: true },
      { label: 'Delivered', done: false },
    ],
  },
  {
    shipmentId: 'CLF-10067',
    lane: 'Pallet (Commercial)',
    status: 'Delivered',
    paymentStatus: 'Paid',
    eta: 'Completed',
    progress: 100,
    steps: [
      { label: 'Pickup Scheduled', done: true },
      { label: 'Picked Up', done: true },
      { label: 'At Miami Warehouse', done: true },
      { label: 'Loaded on Vessel', done: true },
      { label: 'Arrived in Kingston', done: true },
      { label: 'Customs Clearance', done: true },
      { label: 'Out for Delivery', done: true },
      { label: 'Delivered', done: true },
    ],
  },
  {
    shipmentId: 'CLF-10088',
    lane: 'Barrel (Economy)',
    status: 'Pickup Scheduled',
    paymentStatus: 'Pending',
    eta: 'Pickup tomorrow',
    progress: 12,
    steps: [
      { label: 'Pickup Scheduled', done: true },
      { label: 'Picked Up', done: false },
      { label: 'At Miami Warehouse', done: false },
      { label: 'Loaded on Vessel', done: false },
      { label: 'Arrived in Kingston', done: false },
      { label: 'Customs Clearance', done: false },
      { label: 'Out for Delivery', done: false },
      { label: 'Delivered', done: false },
    ],
  },
];

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
  'Track Shipment',
  'Get a Quote',
  'Shop & Ship',
  'Book Pickup',
  'Contact Support',
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname.split('/')[1] || 'home';

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
    notes: '',
    jamaicaRecipient: '',
    jamaicaAddress: '',
    jamaicaLocation: 'Kingston',
    deliveryParish: 'Kingston',
    serviceLevel: 'Standard',
    estimatedValue: '',
    packingDeclaration: false,
    agreementAccepted: false,
  });

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
    productLinks: '',
    sizeColorSpecs: '',
    budgetUsd: '',
    notes: '',
  });

  const [trackingId, setTrackingId] = useState('');
  const [trackingResult, setTrackingResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState('');
  const [shopAccessMode, setShopAccessMode] = useState('');

  // Phase 2: Driver app state
  const [driverAuthToken, setDriverAuthToken] = useState(localStorage.getItem('driverAuthToken') || null);
  const [driverUser, setDriverUser] = useState(JSON.parse(localStorage.getItem('driverUser') || 'null'));
  const [driverPickups, setDriverPickups] = useState([]);
  const [driverRoute, setDriverRoute] = useState([]);
  const [driverLoginForm, setDriverLoginForm] = useState({ email: '', password: '' });
  const [driverRegisterForm, setDriverRegisterForm] = useState({ fullName: '', email: '', password: '', phone: '', vehicle: '' });
  const [driverMode, setDriverMode] = useState('login');
  const [scannedShipmentId, setScannedShipmentId] = useState('');
  const [pickupConfirmation, setPickupConfirmation] = useState({ notes: '', photoUrl: '' });

  useEffect(() => {
    const savedToken = window.localStorage.getItem('clf_auth_token');
    const savedUser = window.localStorage.getItem('clf_auth_user');
    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setAuthToken(savedToken);
        setCurrentUser(parsedUser);
        setIsAuthenticated(true);
      } catch {
        window.localStorage.removeItem('clf_auth_token');
        window.localStorage.removeItem('clf_auth_user');
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setShopAccessMode('account');
    }
  }, [isAuthenticated]);

  function handleQuoteChange(event) {
    const { name, value, type, checked } = event.target;
    setQuoteForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  function handleBookingChange(event) {
    const { name, value, type, checked } = event.target;
    setBookingForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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
    const { name, value } = event.target;
    setPurchaseForm((prev) => ({ ...prev, [name]: value }));
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
      const payload = {
        ...quoteForm,
        weight: quoteForm.dontKnowWeight ? '' : quoteForm.weight,
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
      setStatusMessage(`Quote request submitted: ${result.quote.quoteId}. ${modeLabel} pricing mode.${range}`);
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
      const response = await fetch(`${API_BASE}/purchase-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...purchaseForm,
          productLinks: purchaseForm.productLinks
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit purchase request.');
      setStatusMessage(`Purchase request submitted: ${result.purchaseRequest.requestId}.`);
      setPurchaseForm({
        fullName: '',
        email: '',
        phone: '',
        storeName: 'Amazon',
        productLinks: '',
        sizeColorSpecs: '',
        budgetUsd: '',
        notes: '',
      });
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

  function validateBookingStep(step) {
    if (step === 1) {
      if (!bookingForm.fullName || !bookingForm.email || !bookingForm.phone || !bookingForm.pickupAddress || !bookingForm.pickupCity || !bookingForm.pickupZip || !bookingForm.pickupDate) {
        setStatusMessage('Please complete all pickup fields before continuing.');
        return false;
      }
    }

    if (step === 2) {
      if (!bookingForm.cargoType || !bookingForm.quantity || Number(bookingForm.quantity) < 1 || !bookingForm.weightPerUnit || Number(bookingForm.weightPerUnit) < 1) {
        setStatusMessage('Please provide valid shipment details before continuing.');
        return false;
      }
    }

    if (step === 3) {
      if (!bookingForm.jamaicaRecipient || !bookingForm.jamaicaAddress || !bookingForm.jamaicaLocation || !bookingForm.deliveryParish) {
        setStatusMessage('Please complete all Jamaica delivery details before continuing.');
        return false;
      }
    }

    if (step === 4) {
      if (!bookingForm.serviceLevel) {
        setStatusMessage('Please select a service level before continuing.');
        return false;
      }
    }

    if (step === 5) {
      if (!bookingForm.packingDeclaration || !bookingForm.agreementAccepted) {
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
      const response = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          ...bookingForm,
          unitType: bookingForm.cargoType,
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to log in.');
      if (!result.token) throw new Error('Login succeeded but no session token was returned.');
      setIsAuthenticated(true);
      setCurrentUser(result.user || null);
      setAuthToken(result.token);
      window.localStorage.setItem('clf_auth_token', result.token);
      window.localStorage.setItem('clf_auth_user', JSON.stringify(result.user || null));
      setStatusMessage(`Welcome back, ${result.user?.fullName || 'Customer'}.`);
      const destination = location.state?.from && location.state.from !== '/login' ? location.state.from : '/dashboard';
      navigate(destination);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setAuthToken('');
    setLoginForm({ email: '', password: '' });
    window.localStorage.removeItem('clf_auth_token');
    window.localStorage.removeItem('clf_auth_user');
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
      
      localStorage.setItem('driverAuthToken', result.token);
      localStorage.setItem('driverUser', JSON.stringify(result.user));
      setDriverAuthToken(result.token);
      setDriverUser(result.user);
      setDriverLoginForm({ email: '', password: '' });
      setDriverMode('dashboard');
      setStatusMessage(`Welcome back, ${result.user.fullName}!`);
      fetchDriverPickups(result.token);
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
      if (response.ok) setDriverPickups(result.pickups || []);
    } catch (error) {
      console.error('Failed to fetch pickups:', error);
    }
  }

  async function handlePickupConfirm(shipmentId) {
    setIsLoading(true);
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
      
      setStatusMessage(`Pickup confirmed for ${shipmentId}!`);
      setScannedShipmentId('');
      setPickupConfirmation({ notes: '', photoUrl: '' });
      fetchDriverPickups(driverAuthToken);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleDriverLogout() {
    localStorage.removeItem('driverAuthToken');
    localStorage.removeItem('driverUser');
    setDriverAuthToken(null);
    setDriverUser(null);
    setDriverMode('login');
    setStatusMessage('Driver logout successful.');
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
      const response = await fetch(`${API_BASE}/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 2500, shipmentId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Payment setup failed.');
      window.open(result.url, '_blank', 'noopener,noreferrer');
      setStatusMessage(`Payment session started (${result.mode}).`);
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

    if (!payment) {
      return;
    }

    if (payment === 'success' || payment === 'mock-success') {
      if (paidShipmentId) {
        setTrackingId(paidShipmentId);
        fetch(`${API_BASE}/payments/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipmentId: paidShipmentId, providerStatus: payment }),
        }).catch(() => undefined);
      }
      setStatusMessage(`Payment successful for ${paidShipmentId || 'shipment'}. You can now track your cargo.`);
      navigate('/tracking', { replace: true });
      return;
    }

    if (payment === 'cancelled') {
      setStatusMessage('Payment was cancelled. Your shipment is saved; you can resume payment anytime.');
      navigate('/book-pickup', { replace: true });
    }
  }, [location.search, navigate]);

  function HomePage() {
    return (
      <>
        <section className="card" style={{ textAlign: 'center', padding: '3rem 2rem', background: 'linear-gradient(135deg, #f0f7f6 0%, #fff 100%)' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Ship to Jamaica, Stress-Free</h2>
          <p style={{ fontSize: '1.1rem', marginBottom: '2rem', color: '#555', maxWidth: '600px', margin: '0 auto 2rem' }}>
            Book pickups, track shipments, pay online. Everything in minutes, zero hassle.
          </p>
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => navigate('/book-pickup')}
            style={{ fontSize: '1.1rem', padding: '1rem 3rem' }}
          >
            📦 Start Booking Now
          </button>
        </section>

        <section className="card">
          <h2>Why Customers Choose Us</h2>
          <div className="trust-grid">
            {TRUST_INDICATORS.map((item) => (
              <p key={item}>✔ {item}</p>
            ))}
          </div>
        </section>

        <section className="card" style={{ background: '#f9f9f9' }}>
          <h2>The Process (6 Simple Steps)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
            {HOW_IT_WORKS.map((step, idx) => (
              <div key={step.key} style={{ padding: '1rem', borderRadius: '8px', background: 'white', border: '1px solid #e0e0e0' }}>
                <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2d7a6f', margin: '0 0 0.5rem' }}>{String(idx + 1).padStart(2, '0')}</p>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{step.title}</h3>
                <p style={{ margin: '0', fontSize: '0.9rem', color: '#666' }}>{step.summary}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ textAlign: 'center', padding: '2rem', background: '#f0f7f6' }}>
          <h2>Ready to Get Started?</h2>
          <p style={{ marginBottom: '1.5rem' }}>Book your first shipment in minutes</p>
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => navigate('/book-pickup')}
            style={{ fontSize: '1rem', padding: '0.8rem 2.5rem' }}
          >
            Book Now
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

  function QuotePage() {
    return (
      <section className="card card--split">
        <div>
          <h2>Request a Shipping Quote</h2>
          <form className="form" onSubmit={handleQuoteSubmit}>
            <label>
              Full Name
              <input name="fullName" value={quoteForm.fullName} onChange={handleQuoteChange} required />
            </label>
            <label>
              Email
              <input type="email" name="email" value={quoteForm.email} onChange={handleQuoteChange} required />
            </label>
            <label>
              Phone
              <input type="tel" name="phone" value={quoteForm.phone} onChange={handleQuoteChange} required />
            </label>
            <label>
              Cargo Type
              <select name="cargoType" value={quoteForm.cargoType} onChange={handleQuoteChange} required>
                <option>Box</option>
                <option>Barrel</option>
                <option>Pallet</option>
                <option>Commercial Freight</option>
              </select>
            </label>
            <label>
              Service Level
              <select name="serviceLevel" value={quoteForm.serviceLevel} onChange={handleQuoteChange}>
                <option>Standard</option>
                <option>Priority</option>
                <option>Express</option>
              </select>
            </label>
            <label>
              Item Category
              <input name="itemCategory" value={quoteForm.itemCategory} onChange={handleQuoteChange} placeholder="Clothing, Electronics, Household, etc." required />
            </label>
            <label>
              Origin
              <input name="origin" value={quoteForm.origin} onChange={handleQuoteChange} required />
            </label>
            <label>
              Destination
              <input name="destination" value={quoteForm.destination} onChange={handleQuoteChange} required />
            </label>
            <label>
              Delivery Parish (Jamaica)
              <select name="deliveryParish" value={quoteForm.deliveryParish} onChange={handleQuoteChange} required>
                <option value="">Select a parish</option>
                {JAMAICA_PARISHES.map(parish => (
                  <option key={parish} value={parish}>{parish}</option>
                ))}
              </select>
            </label>
            <label>
              Declared Value (USD)
              <input type="number" name="declaredValueUsd" value={quoteForm.declaredValueUsd} onChange={handleQuoteChange} min="0" placeholder="Optional but recommended" />
            </label>
            <label>
              Weight (lbs)
              <input
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
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="dontKnowWeight"
                checked={quoteForm.dontKnowWeight}
                onChange={handleQuoteChange}
              />
              I do not know the exact weight
            </label>
            {quoteForm.dontKnowWeight && (
              <>
                <label>
                  Quantity
                  <input type="number" name="quantity" value={quoteForm.quantity} onChange={handleQuoteChange} min="1" required />
                </label>
                <label>
                  Dimensions (L x W x H in inches)
                  <div className="input-row">
                    <input type="number" name="dimensionsLength" placeholder="Length" value={quoteForm.dimensionsLength} onChange={handleQuoteChange} min="1" required />
                    <input type="number" name="dimensionsWidth" placeholder="Width" value={quoteForm.dimensionsWidth} onChange={handleQuoteChange} min="1" required />
                    <input type="number" name="dimensionsHeight" placeholder="Height" value={quoteForm.dimensionsHeight} onChange={handleQuoteChange} min="1" required />
                  </div>
                </label>
                <p className="section-intro">We will provide an estimated quote range and confirm final pricing after warehouse weigh-in.</p>
              </>
            )}
            <button type="submit" className="btn btn--solid" disabled={isLoading}>Submit Quote Request</button>
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
    return (
      <section className="card card--split">
        <div>
          <h2>Shop & Ship</h2>
          <p className="section-intro">Shop from popular US stores and ship to Jamaica with Clear Logistics & Freight Services.</p>
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
          <h2>Purchase Assistance</h2>
          <p className="section-intro">Need us to purchase items on your behalf? Submit links and preferences below.</p>
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
                  Product Links (one per line)
                  <textarea name="productLinks" value={purchaseForm.productLinks} onChange={handlePurchaseChange} rows="4" required />
                </label>
                <label>
                  Size/Color Specs
                  <textarea name="sizeColorSpecs" value={purchaseForm.sizeColorSpecs} onChange={handlePurchaseChange} rows="3" />
                </label>
                <label>
                  Budget (USD)
                  <input type="number" name="budgetUsd" value={purchaseForm.budgetUsd} onChange={handlePurchaseChange} min="1" required />
                </label>
                <label>
                  Additional Notes
                  <textarea name="notes" value={purchaseForm.notes} onChange={handlePurchaseChange} rows="3" />
                </label>
                <button type="submit" className="btn btn--solid" disabled={isLoading}>Submit Purchase Request</button>
              </form>
            </>
          )}
        </div>
      </section>
    );
  }

  function BookingPage() {
    const estimatedPrice = useMemo(() => {
      if (!bookingForm.weightPerUnit) return 0;
      const baseCost = parseFloat(bookingForm.weightPerUnit) * parseFloat(bookingForm.quantity) * 1.25;
      const serviceMult = SERVICE_TIERS.find(t => t.name === bookingForm.serviceLevel)?.multiplier || 1;
      return Math.round(baseCost * serviceMult);
    }, [bookingForm.weightPerUnit, bookingForm.quantity, bookingForm.serviceLevel]);

    const stepLabels = ['Pickup Info', 'Shipment Details', 'Jamaica Delivery', 'Choose Service', 'Confirm & Pay'];

    return (
      <section className="card card--split">
        <div>
          <h2>Ship To Jamaica</h2>
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
                <label>
                  Full Name
                  <input name="fullName" value={bookingForm.fullName} onChange={handleBookingChange} required />
                </label>
                <label>
                  Email
                  <input type="email" name="email" value={bookingForm.email} onChange={handleBookingChange} required />
                </label>
                <label>
                  Phone
                  <input type="tel" name="phone" value={bookingForm.phone} onChange={handleBookingChange} required />
                </label>
                <label>
                  Street Address
                  <input name="pickupAddress" placeholder="123 Main Street" value={bookingForm.pickupAddress} onChange={handleBookingChange} required />
                </label>
                <div className="input-row">
                  <label>
                    City
                    <input name="pickupCity" value={bookingForm.pickupCity} onChange={handleBookingChange} required />
                  </label>
                  <label>
                    ZIP
                    <input name="pickupZip" value={bookingForm.pickupZip} onChange={handleBookingChange} required />
                  </label>
                </div>
                <label>
                  Pickup Date
                  <input type="date" name="pickupDate" value={bookingForm.pickupDate} onChange={handleBookingChange} min={new Date().toISOString().split('T')[0]} required />
                </label>
              </>
            )}

            {/* Step 2: Shipment Details */}
            {bookingStep === 2 && (
              <>
                <h3>What are you sending?</h3>
                <label>
                  Cargo Type
                  <select name="cargoType" value={bookingForm.cargoType} onChange={handleBookingChange} required>
                    <option>Barrel</option>
                    <option>Box</option>
                    <option>Pallet</option>
                    <option>Household Goods</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input type="number" name="quantity" value={bookingForm.quantity} onChange={handleBookingChange} min="1" required />
                </label>
                <label>
                  Weight per Unit (lbs)
                  <input type="number" name="weightPerUnit" value={bookingForm.weightPerUnit} onChange={handleBookingChange} min="1" required />
                </label>
                <label>
                  Dimensions (L x W x H in inches) — optional
                  <div className="input-row">
                    <input type="number" name="dimensionsLength" placeholder="Length" value={bookingForm.dimensionsLength} onChange={handleBookingChange} min="1" />
                    <input type="number" name="dimensionsWidth" placeholder="Width" value={bookingForm.dimensionsWidth} onChange={handleBookingChange} min="1" />
                    <input type="number" name="dimensionsHeight" placeholder="Height" value={bookingForm.dimensionsHeight} onChange={handleBookingChange} min="1" />
                  </div>
                </label>
                <label>
                  Estimated Value (USD)
                  <input type="number" name="estimatedValue" value={bookingForm.estimatedValue} onChange={handleBookingChange} min="0" />
                </label>
              </>
            )}

            {/* Step 3: Jamaica Delivery */}
            {bookingStep === 3 && (
              <>
                <h3>Where in Jamaica are we delivering?</h3>
                <label>
                  Recipient Name
                  <input name="jamaicaRecipient" value={bookingForm.jamaicaRecipient} onChange={handleBookingChange} required />
                </label>
                <label>
                  Delivery Address
                  <input name="jamaicaAddress" placeholder="Street address" value={bookingForm.jamaicaAddress} onChange={handleBookingChange} required />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <label>
                    Jamaica City/Area
                    <select name="jamaicaLocation" value={bookingForm.jamaicaLocation} onChange={handleBookingChange} required>
                      {JAMAICA_LOCATIONS_WITH_PARISHES.map(loc => (
                        <option key={loc.city} value={loc.city}>{loc.city}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Parish
                    <select 
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
                  <p><strong>Shipment:</strong> {bookingForm.quantity} {bookingForm.cargoType}(s), ~{bookingForm.weightPerUnit} lbs each</p>
                  <p><strong>Delivery:</strong> {bookingForm.jamaicaRecipient}, {bookingForm.jamaicaLocation}, Jamaica</p>
                  <p><strong>Service:</strong> {bookingForm.serviceLevel} — ${estimatedPrice}</p>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" name="packingDeclaration" checked={bookingForm.packingDeclaration} onChange={handleBookingChange} required />
                  I declare the contents and certify no prohibited items
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="agreementAccepted" checked={bookingForm.agreementAccepted} onChange={handleBookingChange} required />
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
      <section className="card card--split">
        <div>
          <h2>Track Shipment</h2>
          <label className="inline-label">
            Shipment ID
            <input
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
              placeholder="Enter shipment ID (e.g., CLF-10025)"
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
    );
  }

  function DashboardPage() {
    const activeShipment = DEMO_DASHBOARD_SHIPMENTS[0];

    return (
      <>
        <section className="card" style={{ background: 'linear-gradient(135deg, #f0f7f6 0%, #fff 100%)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '2rem' }}>
            <div>
              <h2>Welcome back, {currentUser?.fullName || 'Customer'}! 👋</h2>
              <p className="section-intro">Manage your shipments and track deliveries in real time.</p>
            </div>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => navigate('/book-pickup')}
              style={{ padding: '0.8rem 2rem', whiteSpace: 'nowrap' }}
            >
              📦 Book Another Shipment
            </button>
          </div>
        </section>

        <section className="card card--split">
          <div>
            <h2>Your Shipments</h2>
            {activeShipment ? (
              <>
                <div className="booking-summary" style={{ marginBottom: '1.5rem' }}>
                  <p style={{ margin: '0.5rem 0' }}><strong>Active Shipment:</strong> {activeShipment.shipmentId}</p>
                  <p style={{ margin: '0.5rem 0' }}><strong>Status:</strong> {activeShipment.status}</p>
                  <p style={{ margin: '0.5rem 0' }}><strong>ETA:</strong> {activeShipment.eta}</p>
                  <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#666' }}>Track, update, or manage your active shipment</p>
                </div>
                <div className="progress-shell">
                  <div className="progress-label">
                    <span>Journey Progress</span>
                    <span>{activeShipment.progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div style={{ width: `${activeShipment.progress}%` }} />
                  </div>
                </div>
                <ul className="status-list" style={{ marginTop: '1rem' }}>
                  {activeShipment.steps.map((step) => (
                    <li key={step.label} className={step.done ? 'done' : ''}>
                      <span>{step.done ? '✔' : '◻'}</span> {step.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', background: '#f9f9f9', borderRadius: '8px' }}>
                <p style={{ margin: '0', color: '#666' }}>No active shipments yet</p>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => navigate('/book-pickup')}
                  style={{ marginTop: '1rem' }}
                >
                  Book Your First Shipment
                </button>
              </div>
            )}
          </div>

          <div>
            <h2>Quick Links</h2>
            <ul className="status-list">
              <li style={{ cursor: 'pointer', padding: '0.8rem', borderRadius: '4px', background: '#f9f9f9', marginBottom: '0.5rem' }} onClick={() => navigate('/quote')}>
                <span>•</span> <strong>Get a Quote</strong>
              </li>
              <li style={{ cursor: 'pointer', padding: '0.8rem', borderRadius: '4px', background: '#f9f9f9', marginBottom: '0.5rem' }} onClick={() => navigate('/tracking')}>
                <span>•</span> <strong>Track Shipment</strong>
              </li>
              <li style={{ cursor: 'pointer', padding: '0.8rem', borderRadius: '4px', background: '#f9f9f9', marginBottom: '0.5rem' }} onClick={() => navigate('/shop')}>
                <span>•</span> <strong>Shop & Ship</strong>
              </li>
              <li style={{ cursor: 'pointer', padding: '0.8rem', borderRadius: '4px', background: '#f9f9f9', marginBottom: '0.5rem' }} onClick={() => navigate('/support')}>
                <span>•</span> <strong>Contact Support</strong>
              </li>
            </ul>

            <h3 style={{ marginTop: '1.5rem' }}>Sample Shipments for Demo</h3>
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              {DEMO_DASHBOARD_SHIPMENTS.map((shipment) => (
                <div key={shipment.shipmentId} className="booking-summary" style={{ marginBottom: 0 }}>
                  <p style={{ margin: '0.2rem 0' }}><strong>{shipment.shipmentId}</strong> - {shipment.lane}</p>
                  <p style={{ margin: '0.2rem 0' }}><strong>Status:</strong> {shipment.status}</p>
                  <p style={{ margin: '0.2rem 0' }}><strong>Payment:</strong> {shipment.paymentStatus}</p>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ marginTop: '0.6rem', width: '100%' }}
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
          </div>
        </section>
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

  function ProtectedRoute({ children }) {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    return children;
  }

  function HowItWorksDetailPage() {
    const { stepKey } = useParams();
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
    const scannedPickup = driverPickups.find(p => p.shipmentId === scannedShipmentId);
    
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
                  value={scannedShipmentId}
                  onChange={(e) => setScannedShipmentId(e.target.value)}
                />
              </label>
              <h3 style={{marginTop: '2rem'}}>Your Pickups ({driverPickups.length})</h3>
              <div className="pickups-list">
                {driverPickups.length > 0 ? (
                  <ul className="status-list">
                    {driverPickups.map(p => (
                      <li key={p.shipmentId} style={{cursor: 'pointer', padding: '0.5rem', borderBottom: '1px solid #e0e0e0'}} onClick={() => setScannedShipmentId(p.shipmentId)}>
                        <strong>{p.shipmentId}</strong> - {p.fullName} ({p.pickupCity})
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
              <div className="booking-nav" style={{marginTop: '1rem'}}>
                <button type="button" className="btn btn--ghost" onClick={() => setScannedShipmentId('')}>
                  Cancel
                </button>
                <button type="button" className="btn btn--solid" onClick={() => handlePickupConfirm(scannedPickup.shipmentId)} disabled={isLoading}>
                  Confirm Pickup
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
          <p className="section-intro">Optimized pickup sequence for efficiency.</p>
          <button type="button" className="btn btn--ghost" onClick={() => {
            const optimized = [...driverPickups].sort((a, b) => new Date(a.pickupDate) - new Date(b.pickupDate));
            setDriverRoute(optimized);
          }}>Generate Optimized Route</button>
          {driverRoute.length > 0 && (
            <ol className="status-list" style={{marginTop: '1rem'}}>
              {driverRoute.map((p, idx) => (
                <li key={p.shipmentId}>
                  Stop {idx + 1}: {p.shipmentId} - {p.pickupCity}
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
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={
              item.isPrimary
                ? `nav-pill nav-pill--primary ${
                    currentPath !== 'book-pickup' && currentPath !== 'booking' ? 'pulse' : ''
                  }`
                : item.key === currentPath || (item.key === 'home' && currentPath === '')
                  ? 'nav-pill nav-pill--active'
                  : 'nav-pill'
            }
            onClick={() => navigate(item.key === 'home' ? '/' : `/${item.key}`)}
          >
            {item.label}
          </button>
        ))}
        {driverAuthToken ? (
          <>
            <button type="button" className={currentPath === 'driver/dashboard' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/driver/dashboard')}>
              🚗 Driver Dashboard
            </button>
            <button type="button" className="nav-pill" onClick={handleDriverLogout}>
              Driver Logout
            </button>
          </>
        ) : isAuthenticated ? (
          <>
            <button type="button" className={currentPath === 'dashboard' ? 'nav-pill nav-pill--active' : 'nav-pill'} onClick={() => navigate('/dashboard')}>
              Dashboard
            </button>
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
      </nav>

      <main className="layout">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/how-it-works/:stepKey" element={<HowItWorksDetailPage />} />
          <Route path="/book-pickup" element={<BookingPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/quote" element={<QuotePage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/tracking" element={<TrackingPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/business" element={<BusinessPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/about" element={<AboutUsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/faq" element={<FAQPage />} />
          {/* Phase 2: Driver Routes */}
          {!driverAuthToken && <Route path="/driver/login" element={driverMode === 'register' ? <DriverRegisterPage /> : <DriverLoginPage />} />}
          {driverAuthToken && <Route path="/driver/dashboard" element={<DriverDashboardPage />} />}
        </Routes>
        {statusMessage && <p className="status-banner">{statusMessage}</p>}
      </main>
      <Footer />
    </div>
  );
}

export default App;
