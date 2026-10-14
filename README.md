# Arrowsterr

AI visibility tool. The app runs at app.arrowsterr.com. The marketing site stays on WordPress at arrowsterr.com.

## Run on your computer

```bash
npm install
npm run dev      # http://localhost:3000
```

## Deploy on Fly.io

Two Fly apps in Tokyo: `arrowsterr-web` (the app, `fly.toml`) and `arrowsterr-worker` (the job worker, `fly.worker.toml`). Every push to the production branch deploys both through `.github/workflows/fly-deploy.yml`. Setup and the move from Render: [docs/fly.md](docs/fly.md).

## Brand

- `src/app/brand.css` holds the brand CSS. Every page is wrapped in `.aw` in `layout.tsx`.
- `src/app/globals.css` maps brand tokens to Tailwind (`bg-brand`, `text-ink-2`, `border-line`, `shadow-aw`).
- Use `<Logo />` from `src/components/Logo.tsx` for the logo.
