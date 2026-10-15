"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

// Google's own sign-in button. Google shows this site's name on its screen,
// where the redirect sign-in shows the Supabase address. Supabase checks the token and starts the session.

type Gis = {
  accounts: {
    id: {
      initialize(options: { client_id: string; nonce: string; callback: (res: { credential: string }) => void; use_fedcm_for_button?: boolean }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
};

const SCRIPT = "https://accounts.google.com/gsi/client";

function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    let tag = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (!tag) {
      tag = document.createElement("script");
      tag.src = SCRIPT;
      tag.async = true;
      document.head.appendChild(tag);
    }
    tag.addEventListener("load", () => (w.google ? resolve(w.google) : reject(new Error("Google sign-in did not load."))));
    tag.addEventListener("error", () => reject(new Error("Google sign-in did not load. Check your connection or ad blocker.")));
  });
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function GoogleButton({ sb, clientId, onError }: { sb: SupabaseClient; clientId: string; onError: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    // Google gets the hashed nonce. Supabase gets the raw one and checks they match, so a stolen token can't be replayed.
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    Promise.all([loadGis(), sha256Hex(nonce)])
      .then(([gis, hashed]) => {
        if (!live || !box.current) return;
        gis.accounts.id.initialize({
          client_id: clientId,
          nonce: hashed,
          use_fedcm_for_button: true,
          callback: async ({ credential }) => {
            const { error } = await sb.auth.signInWithIdToken({ provider: "google", token: credential, nonce });
            if (error) onError(error.message);
          },
        });
        gis.accounts.id.renderButton(box.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, box.current.offsetWidth),
        });
      })
      .catch((e) => live && onError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [sb, clientId, onError]);

  return <div ref={box} className="flex min-h-11 w-full justify-center" />;
}
