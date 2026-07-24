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
- POST /api/bookings
- GET /api/shipments/:shipmentId
- POST /api/support
- POST /api/payments/checkout

Production payments checklist:
1) Set STRIPE_SECRET_KEY.
2) Set STRIPE_PAYMENT_METHOD_TYPES=card,link,cashapp.
3) In Stripe Dashboard, enable Apple Pay and Cash App Pay for your account.
4) Add and verify your live domain in Stripe Payment Method Domains (required for Apple Pay).
5) Ensure your business profile, currency, and country settings support Cash App Pay in your live account.

Verification:
- GET /api/health returns stripe=true and the configured stripePaymentMethodTypes array.
- Successful Stripe redirects now include session_id and server confirmation verifies the Stripe session is paid before marking orders paid.
