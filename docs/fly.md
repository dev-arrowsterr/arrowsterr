# Moving Arrowsterr from Render to Fly.io

Two Fly apps, both in Tokyo (`nrt`). Tokyo is the closest Fly region to the Supabase database in Seoul.

| App | Config | Machine | Cost a month (check) |
|---|---|---|---|
| `arrowsterr-web` (app.arrowsterr.com) | `fly.toml`, `Dockerfile` | shared-cpu-1x, 512 MB, always on | about $3.20 |
| `arrowsterr-worker` (runs the job queue, prints report PDFs) | `fly.worker.toml`, `Dockerfile.worker` | shared-cpu-1x, 1 GB, always on | about $5.70 |
| **Total** | | | **about $9** |

Render today: about $8 (web $0 on the free plan, worker $7, daily cron about $1). Once the web needs Render's Starter plan, about $15.

Fly's prices are for US East. Tokyo costs a little more. Fly bills by the second.

### What runs where

- The web app never sleeps. The worker calls it every 20 seconds, so it would never sleep anyway.
- The worker calls `https://app.arrowsterr.com/api/worker` in a loop. That runs queued jobs, the daily checks, nudges and weekly emails.
- The worker also prints report PDFs. It asks `/api/pdf/next` every few seconds, opens the report's print page in Chromium and sends the file to `/api/pdf/done`. Chromium needs the 1 GB.
- Render's daily cron (`scripts/daily-run.mjs`) doesn't move to Fly. The job queue does its work now. The script stays in the repo until Render is gone.
- arrowsterr.com stays on WordPress at Hostinger. Only `app.arrowsterr.com` moves.

## 1. Sign up and install

```bash
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth signup            # or: fly auth login. Fly asks for a card.
```

## 2. Make the apps

From the repo folder:

```bash
fly apps create arrowsterr-web
fly apps create arrowsterr-worker
```

## 3. Copy the secrets from Render

Copy each value from Render → `arrowsterr` → Environment. The easy way: paste them into a file as `NAME=value` lines, one per line, then:

```bash
fly secrets import --app arrowsterr-web < render.env
rm render.env
```

Or set them one at a time with `fly secrets set --app arrowsterr-web NAME=value ...`.

These are all the settings the app reads. Copy the ones you have on Render.

| Group | Settings |
|---|---|
| Must have | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `APP_URL` (set it to `https://app.arrowsterr.com`) |
| AI answers | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` |
| DataForSEO | `DFS_LOGIN`, `DFS_PASSWORD`, `DFS_API_URL`, `DFS_LOCATION_CODE`, `DFS_LANGUAGE_CODE`, `DFS_SCRAPER` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Google Analytics | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` |
| Website tracking | `UMAMI_URL`, `UMAMI_API_KEY`, `UMAMI_USERNAME`, `UMAMI_PASSWORD` |
| Errors | `SENTRY_DSN` |
| Models | `CLAUDE_MODEL`, `CLAUDE_ENGINE_MODEL`, `EXTRACT_MODEL`, `PROMPTS_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`, `PERPLEXITY_MODEL` |
| Limits and prices | `WORKER_CONCURRENCY`, `SNAPSHOT_DAILY_CAP`, `RATE_ANTHROPIC`, `RATE_OPENAI`, `RATE_GEMINI`, `RATE_PERPLEXITY`, `RATE_DATAFORSEO`, `PRICE_OPENAI`, `PRICE_GEMINI`, `PRICE_PERPLEXITY` |

`GOOGLE_TOKEN_KEY` and `SUPABASE_SECRET_KEY` must be exactly the same as on Render. Saved Google sign-ins are locked with them.

Skip `RENDER_SERVICE_NAME` and `NODE_ENV`. Render and the Dockerfile set those.

`NEXT_PUBLIC_SENTRY_DSN` is different: the build reads it, so it can't be a secret. If Render has it, paste it into `fly.toml` under `[build.args]` and commit. A Sentry DSN is safe to share.

The worker needs only `CRON_SECRET`, the same value as the app's. `APP_URL` is already in `fly.worker.toml`.

```bash
fly secrets set --app arrowsterr-worker CRON_SECRET=...
```

## 4. Deploy

```bash
fly deploy --ha=false                    # the app
fly deploy --ha=false --config fly.worker.toml # the worker
```

Check `https://arrowsterr-web.fly.dev/api/health` answers `{"ok":true}`, and `https://arrowsterr-web.fly.dev/api/setup-check` shows every setting as OK.

Until step 5, the Fly worker still calls Render, since `app.arrowsterr.com` points there. That's safe: the Fly worker and Render's worker can run side by side, and each job is taken by one of them only.

## 5. Point app.arrowsterr.com at Fly

```bash
fly certs add app.arrowsterr.com --app arrowsterr-web
```

In Hostinger → DNS for `arrowsterr.com`, change the `app` record to a CNAME for `arrowsterr-web.fly.dev`. Leave every other record alone, so arrowsterr.com stays on WordPress. `fly certs show app.arrowsterr.com --app arrowsterr-web` says when the certificate is ready.

The Stripe webhook and the Google sign-in keep working. The app builds those addresses from `app.arrowsterr.com` (or `APP_URL`), and that now points at Fly. Only change them if Stripe (Developers → Webhooks) or Google Cloud (APIs & Services → Credentials → the OAuth client) still lists an `onrender.com` address. Then swap it for `https://app.arrowsterr.com/api/billing/webhook` or `https://app.arrowsterr.com/api/google/callback`.

## 6. Delete the Render services

Once `app.arrowsterr.com` loads from Fly, delete all three services in Render (the service → Settings → Delete): `arrowsterr`, `arrowsterr-worker` and `arrowsterr-daily`. Billing stops then.

## Deploying after this

Every push to `claude/arrowsterr-ai-visibility-ft7nva` deploys both apps, through `.github/workflows/fly-deploy.yml`. It runs lint, typecheck and the unit tests first, and only deploys when they pass. To turn it on:

1. Make a token: `fly tokens create org` (one token works for both apps).
2. In GitHub → the `arrowsterr` repo → Settings → Secrets and variables → Actions → New repository secret, name it `FLY_API_TOKEN` and paste the token.

Until the secret is there, the workflow runs the checks and skips the deploy. To deploy by hand, run `fly deploy --ha=false` and `fly deploy --ha=false --config fly.worker.toml`. Turn off Render's auto deploy (or delete the Render services) so pushes don't deploy to both.
