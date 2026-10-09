import * as Sentry from "@sentry/nextjs";

// Error tracking on the server. Off until SENTRY_DSN is set on Render.
export function register() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.RENDER_SERVICE_NAME ?? process.env.NODE_ENV, tracesSampleRate: 0.05, sendDefaultPii: false });
}

// Errors thrown while handling a request (routes, server components) go to Sentry too.
export const onRequestError = Sentry.captureRequestError;
