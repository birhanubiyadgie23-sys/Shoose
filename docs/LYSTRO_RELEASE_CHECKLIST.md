# LYSTRO release checklist

## Database migration required before enabling the new booking flow

Run the additive SQL migration in the Supabase SQL Editor:

`supabase/migrations/202611230004_booking_cash_tracking.sql`

It adds pickup scheduling, shoe quantity, immutable order-price snapshots, cash settlement fields and a private tracking code. Existing orders are retained.

After running it, verify that `orders` contains:
- `pickup_date`, `pickup_time`, `shoe_count`
- `unit_price`, `total_amount`
- `delivery_type`, `cash_payment_status`, `cash_paid_at`
- `tracking_code`

The public booking API depends on these columns. Do not switch the production alias until the migration has succeeded.

## Service pricing

The booking form now loads active services and prices from `lystro_services`. Set real prices in Admin → Settings → Services before accepting bookings. The original seed prices are zero; the system deliberately does not invent prices.

## Telegram notifications (optional)

The API sends a new-order message only when both Vercel environment variables are configured:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Add them as encrypted Environment Variables in the Vercel project settings. Never place the bot token in browser code or commit it to GitHub. If they are absent, orders still save and the notification status is recorded as `not_configured`.

## Cash reconciliation

The admin order table shows the saved total and cash payment status. The API permits marking cash as paid only after the professional marks the order completed. Reversing a paid record requires Super Admin.

## Validation boundaries

The branch preview build is a code/build check, not a full live Supabase acceptance test. Verify the customer booking, assignment approval, professional job updates, status tracking and cash settlement with test accounts before production release.
