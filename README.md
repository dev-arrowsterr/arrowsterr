# Arrowsterr

AI visibility tool. The app runs at app.arrowsterr.com. The marketing site stays on WordPress at arrowsterr.com.

## Run on your computer

```bash
npm install
npm run dev      # http://localhost:3000
```

## Deploy on Fly.io

Two Fly apps in Tokyo: `arrowsterr-web` (the app, `fly.toml`) and `arrowsterr-worker` (the job worker, `fly.worker.toml`). Every push to the production branch deploys both through `.github/workflows/fly-deploy.yml`. Setup and the move from Render: [docs/fly.md](docs/fly.md).

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
