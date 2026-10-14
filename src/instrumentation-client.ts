import * as Sentry from "@sentry/nextjs";

// Error tracking in the browser. Off until NEXT_PUBLIC_SENTRY_DSN is set. It is read at build time, so on Fly it goes in fly.toml under [build.args].
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) Sentry.init({ dsn, tracesSampleRate: 0.05, sendDefaultPii: false });

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
