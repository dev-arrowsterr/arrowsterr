"use client";

import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";

/** Content: the brand's article library. A placeholder until the library lands (docs/content-v2.md, week 2). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ContentPage(props: { view: View; auth: RunAuth; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2 mb-0!">Content</h1>
      <section className="aw-frame flex flex-col items-center gap-2 px-6 py-12 text-center">
        <span className="aw-h4">No articles yet</span>
      </section>
    </div>
  );
}
