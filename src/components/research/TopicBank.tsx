"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { listCalendar, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { AgenticResearch } from "./AgenticResearch";
import { PlanWizard } from "./PlanWizard";

/** The Topic Bank: where every content plan is stored, so you can approve ideas onto the Editorial Calendar when you are ready. */
export function TopicBank({ sb, auth, site, canEdit, onSite, onCalendar }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onSite: (s: Site) => void; onCalendar: () => void }) {
  const [wizard, setWizard] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [latest, setLatest] = useState<string | null>(null);

  // The last date already on the calendar, so approved ideas are scheduled after it.
  useEffect(() => {
    let live = true;
    listCalendar(sb, site.id)
      .then((items) => live && setLatest(items.map((i) => i.due_date).filter((d): d is string => Boolean(d)).sort().pop() ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, site.id, refresh]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-[15px] text-body">
          Your store of content ideas. Every content plan you generate lands here with its keywords, search volume and difficulty. Pick the ideas you like and approve them, and they move onto the
          Editorial Calendar.
        </p>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent" onClick={() => setWizard(true)}>
            ✦ Generate content plan
          </button>
        ) : null}
      </div>
      <AgenticResearch
        sb={sb}
        auth={auth}
        site={site}
        canEdit={canEdit}
        onOpenCalendar={onCalendar}
        onNew={() => setWizard(true)}
        onApproved={() => setRefresh((n) => n + 1)}
        latest={latest}
        refresh={refresh}
      />
      {wizard ? (
        <PlanWizard
          sb={sb}
          auth={auth}
          site={site}
          onSite={onSite}
          onClose={() => setWizard(false)}
          onStarted={() => {
            setWizard(false);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
