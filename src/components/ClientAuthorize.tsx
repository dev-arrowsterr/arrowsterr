"use client";

import dynamic from "next/dynamic";

// Sign-in sessions live in browser storage, so the approval screen renders in the browser only.
export const ClientAuthorize = dynamic(() => import("./Authorize").then((m) => m.Authorize), { ssr: false });
