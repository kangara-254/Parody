import * as Sentry from "@sentry/react";

// The DSN is not a secret -- it only tells the app where to SEND error
// reports, it can't be used to read anything back. It's safe to have
// a working default committed here so error tracking works right out
// of the box, but VITE_SENTRY_DSN (see .env.example) can still
// override it per-environment if that's ever useful later.
const DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
  "https://100a95ff89ccafc09c2a9b195c0d78f4@o4512074471440384.ingest.de.sentry.io/4512074485203024";

export function initSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE, // "development" locally, "production" on Vercel
    // Keep this lean: just crash/error reporting, no session replay or
    // performance tracing yet -- those cost more of the free tier's
    // monthly quota for not much benefit on a single-school app.
    integrations: [],
    tracesSampleRate: 0,
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
