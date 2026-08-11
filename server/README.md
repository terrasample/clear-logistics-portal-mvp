Backend API for Clear Logistics & Freight Services portal MVP.

Quick start:
1) Copy .env.example to .env and fill values as needed.
2) Run: npm install
3) Start API: npm run dev:backend

Preventing account data loss in production (required):
1) Add a persistent disk to the API service in Render.
2) Mount the disk to /var/data.
3) Set DATA_FILE_PATH=/var/data/data.json.
4) Set UPLOAD_DIR=/var/data/uploads if uploaded files must survive deploys.
5) Keep REQUIRE_PERSISTENT_DATA_PATH=true so the API refuses to boot on ephemeral storage.
6) Verify with GET /api/health and confirm dataStorage.likelyEphemeral=false.

Endpoints:
- GET /api/health
- POST /api/accounts
- POST /api/login
- POST /api/quotes
- POST /api/whatsapp/inbound
- POST /api/bookings
- GET /api/shipments/:shipmentId
- POST /api/support
- POST /api/payments/checkout

WhatsApp auto-reply setup:
1) Set NOTIFY_WHATSAPP_WEBHOOK_URL to your outbound WhatsApp delivery webhook (provider or automation flow).
2) Keep WHATSAPP_AUTO_REPLY_ENABLED=true.
3) Set WHATSAPP_AUTO_REPLY_MESSAGE to the exact message you want customers to receive. You can use {{name}}.
4) Optional security: set WHATSAPP_INBOUND_TOKEN and send the same token in x-whatsapp-inbound-token header from your webhook source.
5) Point your inbound provider webhook to POST /api/whatsapp/inbound.
6) Tune WHATSAPP_AUTO_REPLY_COOLDOWN_SECONDS to avoid repeated replies to the same sender.

Production payments checklist:
1) Set STRIPE_SECRET_KEY.
2) Set STRIPE_PAYMENT_METHOD_TYPES=card,link,cashapp.
3) In Stripe Dashboard, enable Apple Pay and Cash App Pay for your account.
4) Add and verify your live domain in Stripe Payment Method Domains (required for Apple Pay).
5) Ensure your business profile, currency, and country settings support Cash App Pay in your live account.

Verification:
- GET /api/health returns stripe=true and the configured stripePaymentMethodTypes array.
- Successful Stripe redirects now include session_id and server confirmation verifies the Stripe session is paid before marking orders paid.

Email deliverability hardening (recommended):
1) Use a branded sender address (example: quotes@yourdomain.com) and set EMAIL_FROM (or SMTP_FROM).
2) Set EMAIL_REPLY_TO to your support inbox.
3) Publish DNS records for sender domain authentication:
	- SPF TXT on root domain (example): v=spf1 include:_spf.google.com ~all
	- DKIM TXT on selector host (example): default._domainkey.yourdomain.com
	- DMARC TXT on _dmarc.yourdomain.com (example): v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
4) Optional: set EMAIL_AUDIT_BCC to archive outbound customer emails.
5) Verify with GET /api/health and review the email object:
	- email.senderDomainIsFreeMailbox should be false.
	- email.checks.spf.found, email.checks.dkim.found, email.checks.dmarc.found should all be true.
	- email.recommendations should be empty.

Production-only scan alerts:
1) Scan cutoff emails only run when NODE_ENV=production.
2) Set SCAN_ALERTS_ENABLED=false to disable them even in production.
3) Keep scan alerts off in local or staging environments to avoid test email noise.

Barrel pickup pricing policy:
1) Jacksonville-area pickup + handling is a flat $139.
2) Outside Jacksonville, pickup + handling is calculated from mileage + gas.
3) Configure defaults with:
	- BARREL_PICKUP_MILEAGE_RATE_USD_PER_MILE (default: 1.35)
	- BARREL_PICKUP_GAS_PRICE_USD_PER_GALLON (default: 3.9)
	- BARREL_PICKUP_VEHICLE_MPG (default: 17)
	- BARREL_PICKUP_GAS_COST_MULTIPLIER (default: 1)
4) Per-quote overrides are supported in payload with:
	- pickupDistanceMiles (or distanceMiles/pickupMiles/mileageMiles/mileage)
	- barrelMileageRateUsdPerMile
	- gasPriceUsdPerGallon
	- vehicleMpg
	- gasCostMultiplier
