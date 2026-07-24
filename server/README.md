Backend API for Clear Logistics & Freight Services portal MVP.

Quick start:
1) Copy .env.example to .env and fill values as needed.
2) Run: npm install
3) Start API: npm run dev:backend

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
