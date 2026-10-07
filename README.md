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

## Brand

- `src/app/brand.css` holds the brand CSS. Every page is wrapped in `.aw` in `layout.tsx`.
- `src/app/globals.css` maps brand tokens to Tailwind (`bg-brand`, `text-ink-2`, `border-line`, `shadow-aw`).
- Use `<Logo />` from `src/components/Logo.tsx` for the logo.
