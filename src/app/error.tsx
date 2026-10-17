"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { reloadOnce } from "@/lib/staleBuild";
import Link from "next/link";
import { ErrorScreen } from "@/components/ErrorScreen";

export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    reloadOnce(error);
  }, [error]);
  return (
    <ErrorScreen
      code="Error"
      title="Something went wrong"
      actions={
        <>
          <button type="button" className="aw-btn aw-btn--primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <Link className="aw-btn aw-btn--secondary" href="/">
            Go home
          </Link>
        </>
      }
    >
      We&apos;ve been told about it. Try again, and if it keeps happening, email support@arrowsterr.com
      {error.message ? <span className="mt-3 block font-mono text-[12px] break-words text-muted">{String(error.message).slice(0, 300)}</span> : null}
      {error.digest ? <span className="mt-2 block font-mono text-[12px] text-muted">Ref {error.digest}</span> : null}
    </ErrorScreen>
  );
}
