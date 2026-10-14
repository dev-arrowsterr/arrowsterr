# Arrowsterr

AI visibility tool. The app runs at app.arrowsterr.com. The marketing site stays on WordPress at arrowsterr.com.

## Run on your computer

```bash
npm install
npm run dev      # http://localhost:3000
```

## Deploy on Render

Web Service settings:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`

## Stripe

Plans and prices are made by a script and read by lookup key. The app never creates them.

1. Put the secret key in Render as `STRIPE_SECRET_KEY`.
2. In Render's Shell, run `npm run stripe:setup`. Run it again after changing a price in `src/lib/plans.ts`. Existing customers keep their price.
3. Add a webhook for `https://app.arrowsterr.com/api/billing/webhook` with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. Put its signing secret in Render as `STRIPE_WEBHOOK_SECRET`.

Do all three in test mode, then again in live mode with the live keys.

## Brand

- `src/app/brand.css` holds the brand CSS. Every page is wrapped in `.aw` in `layout.tsx`.
- `src/app/globals.css` maps brand tokens to Tailwind (`bg-brand`, `text-ink-2`, `border-line`, `shadow-aw`).
- Use `<Logo />` from `src/components/Logo.tsx` for the logo.
