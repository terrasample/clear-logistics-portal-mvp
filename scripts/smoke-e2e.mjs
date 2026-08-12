import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';
const failures = [];

function recordFailure(flow, message) {
  failures.push({ flow, message });
}

async function safeClick(locator, flow, label) {
  try {
    if (await locator.count()) {
      await locator.first().click({ timeout: 8000 });
      return true;
    }
    return false;
  } catch (error) {
    recordFailure(flow, `${label}: ${error.message}`);
    return false;
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('pageerror', (err) => recordFailure('runtime', `Page error: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.includes('favicon.ico')) {
      recordFailure('network', `Request failed: ${url}`);
    }
  });

  try {
    // Home/nav/button-card sweep
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const navTargets = ['Shop', 'Sell on Clear', 'Ship with Clear', 'Business', 'Track', 'Pricing', 'My Clear'];
    for (const label of navTargets) {
      const target = page.getByRole('button', { name: label, exact: false }).first();
      if (!(await target.count())) {
        recordFailure('home-nav', `Missing navigation target: ${label}`);
        continue;
      }
      await safeClick(target, 'home-nav', label);
      await page.waitForTimeout(200);
    }

    // Sell on Clear marketplace flow
    await page.goto(`${BASE_URL}/sell-on-clear`, { waitUntil: 'domcontentloaded' });
    await safeClick(page.getByRole('button', { name: /apply to sell/i }), 'sell-on-clear', 'Apply to Sell');
    await page.waitForTimeout(250);
    const sellerTypeOptions = await page.locator('select[name="sellerType"] option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
    if (!sellerTypeOptions.length) {
      recordFailure('sell-on-clear', 'Seller type options were not rendered.');
    } else {
      await page.locator('select[name="sellerType"]').first().selectOption(sellerTypeOptions[0]);
    }
    await page.locator('input[name="businessName"]').first().fill('Smoke Market Co.');
    await page.locator('input[name="contactName"]').first().fill('Smoke Seller');
    await page.locator('input[name="email"]').first().fill('seller@example.com');
    await page.locator('input[name="phone"]').first().fill('876-555-0188');
    await page.locator('input[name="category"]').first().fill('Furniture');
    await page.locator('input[name="title"]').first().fill('Verified Dining Set');
    await page.locator('input[name="priceUsd"]').first().fill('1299');
    await page.locator('textarea[name="description"]').first().fill('Smoke test marketplace listing with matched imagery and fulfillment details.');
    await page.locator('input[name="shippingOrigin"]').first().fill('Miami, FL');
    await page.locator('input[name="verifiedSeller"]').first().check();
    await safeClick(page.getByRole('button', { name: /submit seller application/i }), 'sell-on-clear', 'Submit Seller Application');
    await page.waitForTimeout(1200);

    // Quote flow
    await page.goto(`${BASE_URL}/pricing?category=Furniture&audience=personal&notes=Smoke%20Quote`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="fullName"]').first().fill('Smoke Test User');
    await page.locator('input[name="email"]').first().fill('smoke@example.com');
    await page.locator('input[name="phone"]').first().fill('876-555-0199');
    if (await page.locator('input[name="itemCategory"]').count()) {
      await page.locator('input[name="itemCategory"]').first().fill('Furniture');
    }
    await safeClick(page.getByRole('button', { name: /submit quote request/i }), 'quote', 'Submit Quote Request');
    await page.waitForTimeout(1200);

    // Ship flow
    await page.goto(`${BASE_URL}/ship`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="fullName"]').first().fill('Smoke Test User');
    await page.locator('input[name="email"]').first().fill('smoke@example.com');
    await page.locator('input[name="phone"]').first().fill('876-555-0111');
    await page.locator('input[name="pickupAddress"]').first().fill('101 Main Street');
    await page.locator('input[name="pickupCity"]').first().fill('Miami');
    await page.locator('input[name="pickupZip"]').first().fill('33101');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    await page.locator('input[name="pickupDate"]').first().fill(`${yyyy}-${mm}-${dd}`);

    await safeClick(page.getByRole('button', { name: /^next$/i }), 'ship', 'Step1 Next');
    await page.waitForTimeout(250);
    await page.locator('input[name="quantity"]').first().fill('1');
    await page.locator('input[name="weightPerUnit"]').first().fill('30');
    await safeClick(page.getByRole('button', { name: /^next$/i }), 'ship', 'Step2 Next');
    await page.waitForTimeout(250);
    await page.locator('input[name="jamaicaRecipient"]').first().fill('Kingston Receiver');
    await page.locator('input[name="jamaicaAddress"]').first().fill('22 Harbour Street');
    await safeClick(page.getByRole('button', { name: /^next$/i }), 'ship', 'Step3 Next');
    await page.waitForTimeout(250);
    await page.locator('input[name="packingDeclaration"]').first().check();
    await page.locator('input[name="agreementAccepted"]').first().check();
    await safeClick(page.getByRole('button', { name: /create shipment/i }), 'ship', 'Create Shipment');
    await page.waitForTimeout(1200);

    // Track flow
    await page.goto(`${BASE_URL}/track`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder*="shipment ID"]').first().fill('CL-12345');
    await safeClick(page.getByRole('button', { name: /check status/i }), 'track', 'Check Status');
    await page.waitForTimeout(1000);

    // Shop personal flow
    await page.goto(`${BASE_URL}/shop?category=Furniture&audience=personal&productName=Luxury%20Dining%20Table&supplierPriceUsd=1899&storeName=Supplier%20Direct&quantity=1&directTo=purchase`, { waitUntil: 'domcontentloaded' });
    await safeClick(page.getByRole('button', { name: /order with clear/i }), 'shop-personal', 'Order With Clear card button');
    await page.waitForTimeout(250);
    await page.locator('input[name="fullName"]').first().fill('Personal Buyer');
    await page.locator('input[name="email"]').first().fill('buyer@example.com');
    await page.locator('input[name="phone"]').first().fill('876-555-0122');

    const firstCartItem = page.locator('.shop-cart__item').first();
    await firstCartItem.locator('input[type="number"]').nth(1).fill('120');
    await page.locator('input[name="declarationAccepted"]').first().check();
    await safeClick(page.getByRole('button', { name: /continue to checkout/i }), 'shop-personal', 'Continue to Checkout');
    await page.waitForTimeout(1000);

    // Shop business flow
    await page.goto(`${BASE_URL}/shop?category=Business%20Equipment&audience=business&productName=Commercial%20Outdoor%20Kitchen&supplierPriceUsd=3879&storeName=Supplier%20Direct&quantity=4&directTo=purchase&notes=Smoke%20Business`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="fullName"]').first().fill('Business Buyer');
    await page.locator('input[name="email"]').first().fill('business@example.com');
    await page.locator('input[name="phone"]').first().fill('876-555-0177');
    await page.locator('select[name="businessIntent"]').first().selectOption('business');
    await page.locator('input[name="businessUnits"]').first().fill('4');
    await page.locator('input[name="businessDeliveryLocation"]').first().fill('Montego Bay');
    await page.locator('input[name="needsInstallation"]').first().check();
    await page.locator('input[name="needsMultipleProducts"]').first().check();
    await page.locator('.shop-cart__item').first().locator('input[type="number"]').nth(1).fill('150');
    await page.locator('input[name="declarationAccepted"]').first().check();
    await safeClick(page.getByRole('button', { name: /continue to checkout/i }), 'shop-business', 'Continue to Checkout');
    await page.waitForTimeout(1000);
  } catch (error) {
    recordFailure('runner', error.message);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.log('SMOKE TEST FAILURES');
    failures.forEach((f, idx) => {
      console.log(`${idx + 1}. [${f.flow}] ${f.message}`);
    });
    process.exit(1);
  }

  console.log('SMOKE TEST PASSED: Public flow interactions executed without runtime failures.');
}

run();
