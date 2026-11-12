# ClassKit

Class packs, credits, waitlist and check-in for fitness and wellness studios on HighLevel.

Studios sell a package (10-class pack, unlimited monthly, drop-in). ClassKit takes a credit each time a
member books a class calendar, enforces the studio's cancellation rule, fills freed seats from the
waitlist, checks members in at a front-desk kiosk, and nudges them to renew. Everything runs on the
studio's existing HighLevel calendars, checkout, contacts, SMS and workflows.

```
classkit-api/   Express + Mongoose (port 3030) — ledger, webhooks, OAuth/SSO, scheduler
classkit-ui/    React + Vite (port 5175) — embedded admin app, /kiosk/:token, /s/:slug
```

Same stack and plumbing as HelmDesk: OAuth + company→location token minting, AES SSO handshake,
Ed25519 webhook verification, custom workflow triggers.

## How it works

| Event | What ClassKit does |
|---|---|
| `OrderCreate` / `OrderStatusUpdate` (paid) / `InvoicePaid` | Line items linked to a package → grant a credit lot (once per order line), text the member, fire **Package purchased** |
| `AppointmentCreate` on a credit calendar | Spend credits (soonest-expiring lot first; unlimited covers it free). No credits → cancel the appointment in GHL, text the buy link, fire **Booking blocked** (or allow + flag "owes credit") |
| `AppointmentUpdate` → cancelled | Before the window → refund. Inside it → studio keeps the credit, fire **Late cancel**. Then promote the waitlist |
| `AppointmentUpdate` → showed / noshow | Mirror check-in / no-show |
| Rescheduled | Credit moves with the booking; the old slot's waitlist is promoted |
| Scheduler (every 5 min) | Expire lots, "expiring soon" reminder (once per lot), auto no-show, close past waitlists |

Every credit movement is a row in `LedgerEntry` with a unique `idempotencyKey`. Lot balances only change
through conditional atomic `$inc`, so duplicate or concurrent webhooks can never double-spend or
double-grant (see `test/flow.test.js`).

Each contact gets the custom fields **ClassKit Credits** and **ClassKit Credits Expire**, plus the tags
`classkit-active`, `classkit-low-credits`, `classkit-no-credits` and `classkit-unlimited`.

## Run locally (no HighLevel needed)

Needs Node 20+ and a local `mongod`.

```bash
cd classkit-api && cp .env.example .env    # then set GHL_MOCK=true, ALLOW_DEV_LOGIN=true, JWT_SECRET
npm install && npm run dev
```

```bash
cd classkit-ui && npm install && npm run dev
```

```bash
cd classkit-api && npm run seed            # demo studio with members, classes, waitlist
```

The seed prints the admin URL (`http://localhost:5175/?locationId=demo_studio`), the kiosk link (try
`555-010-1001`) and the public schedule link. `GHL_MOCK=true` stubs every HighLevel call and logs it.

Tests (real MongoDB, GHL mocked): `cd classkit-api && npm test` (18 end-to-end tests).

## Marketplace app setup

1. **Distribution**: who can install = **Agency and sub-account**; target user = **Sub-account**. An agency
   installs once and picks sub-accounts (or bulk-installs); each sub-account's INSTALL webhook links it to
   the agency so its token is minted from the agency token on first use.
2. **OAuth**: redirect `{API}/oauth/callback`. Scopes are in `src/routes/oauth.js` (calendars + events
   read/write, contacts read/write, conversations/message write, custom fields read/write, products,
   prices, orders, invoices, users, oauth).
3. **Custom page**: `{UI}/` in the sub-account menu. Copy the app's **Shared Secret** into
   `GHL_SSO_KEY`.
4. **Webhook URL**: `{API}/api/webhooks/ghl`. Subscribe to INSTALL, UNINSTALL, AppointmentCreate,
   AppointmentUpdate, AppointmentDelete, OrderCreate, OrderStatusUpdate, InvoicePaid. Set
   `GHL_WEBHOOK_ED25519_PUBLIC_KEY`, then follow the same log-only → enforce rollout as HelmDesk.
5. **Workflow triggers**: subscription URL `{API}/api/workflows/triggers/subscriptions`, with keys
   `classkit_pack_purchased`, `classkit_credits_low`, `classkit_pack_expiring`, `classkit_checked_in`,
   `classkit_no_show`, `classkit_late_cancel`, `classkit_booking_rejected`, `classkit_waitlist_promoted`.
6. **Workflow actions**: `{API}/api/workflows/actions/add-credits` (inputs `credits`, `validityDays`,
   `note`), `.../remove-credits` (`credits`, `note`), `.../grant-package` (`packageName`).
7. Production env: `GHL_MOCK=false`, `ALLOW_DEV_LOGIN=false`, a long random `JWT_SECRET`, and `UI_BASE_URL` pointing at
   the deployed UI (used for kiosk and schedule links).

Deploy like HelmDesk: the UI on Vercel (`vercel.json` included, set `VITE_API_URL`), the API anywhere Node runs.
Alternatively, build the UI and the API serves `classkit-ui/dist` from the same origin.

## Known limits / next steps

- **Blocking happens after the booking.** GHL's booking widget can't ask ClassKit first, so a no-credit
  booking is created and then cancelled within seconds (with a buy-link SMS). A ClassKit booking widget
  that checks credits up front would remove that flash.
- **Order vs. invoice for the same purchase.** Grants are idempotent per order id and per invoice id. If a
  studio's checkout produces *both* an `OrderCreate` and an `InvoicePaid` for one purchase, link the
  package to only one path, or add cross-dedupe on the payment/transaction id once real payloads are confirmed.
- **Unlimited renewals.** Each paid renewal order grants a new period. Set `validityDays` to the billing
  period (+ a day or two of grace).
- **Calendar seat counts.** Read from the GHL calendar when available, but editable per calendar in
  Settings. ClassKit's count is the one it enforces for the waitlist.
- The webhook payload field names follow HighLevel's docs and are parsed defensively
  (`orderService.parse`, `bookingService.normalizeAppointment`). Verify them against live payloads
  during the first sandbox install.
- Not built yet: app billing (marketplace plans / wallet meters — copy HelmDesk's `subscriptionService`),
  family/shared packs, marketing site (use the `ghl-app-launch-kit` skill).
