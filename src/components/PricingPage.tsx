"use client";

import Link from "next/link";
import { useState } from "react";
import type { Interval } from "@/lib/plans";
import { SALES } from "./BillingPage";
import { Logo } from "./Logo";
import { IntervalSwitch, PlanGrid } from "./PlanGrid";

/** The public pricing page. */
export function PricingPage() {
  const [cycle, setCycle] = useState<Interval>("month");
  return (
    <main className="aw-dotgrid min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Arrowsterr home">
            <Logo size="sm" />
          </Link>
          <Link href="/" className="aw-btn aw-btn--secondary aw-btn--sm">
            Sign in
          </Link>
        </div>
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="aw-display mb-0!">Be the brand AI names</h1>
          <p className="aw-lede max-w-2xl">Start with a 14-day free trial of Scale. No card.</p>
          <IntervalSwitch value={cycle} onChange={setCycle} />
        </div>
        <PlanGrid
          interval={cycle}
          action={(id) =>
            id === "enterprise" ? (
              <a href={SALES} className="aw-btn aw-btn--secondary aw-btn--block">
                Talk to us
              </a>
            ) : (
              <Link href="/" className={`aw-btn aw-btn--block ${id === "scale" ? "aw-btn--primary" : "aw-btn--secondary"}`}>
                Start free trial
              </Link>
            )
          }
        />
      </div>
    </main>
  );
}
