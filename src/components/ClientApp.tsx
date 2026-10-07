"use client";

import dynamic from "next/dynamic";

// Sign-in sessions live in browser storage, so the app renders in the browser only.
export const ClientApp = dynamic(() => import("./App").then((m) => m.App), { ssr: false });
