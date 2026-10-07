"use client";

import dynamic from "next/dynamic";

// The app keeps brands in browser storage for now, so it renders in the browser only.
export const ClientApp = dynamic(() => import("./App").then((m) => m.App), { ssr: false });
