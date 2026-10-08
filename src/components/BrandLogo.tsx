"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

// A brand's site icon at a fixed size, with its first letter as backup if the icon fails to load.
export function BrandLogo({ src, name, size = 28 }: { src: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] font-medium text-brand ${failed ? "bg-brand-bg" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {failed ? (
        name.slice(0, 1).toUpperCase()
      ) : (
        <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} onError={() => setFailed(true)}
          // The icon can fail before React is listening, so also check once it is on the page.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setFailed(true);
          }}
        />
      )}
    </span>
  );
}
