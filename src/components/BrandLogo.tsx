"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

// A brand's site icon at a fixed size, with its first letter as backup if the icon fails to load.
// The failure is tied to the src, so when the same spot shows another brand its logo loads again.
export function BrandLogo({ src, name, size = 28 }: { src: string; name: string; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const failed = broken === src;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] font-medium text-brand ${failed ? "bg-brand-bg" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {failed ? (
        name.slice(0, 1).toUpperCase()
      ) : (
        <img key={src} src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} onError={() => setBroken(src)}
          // The icon can fail before React is listening, so also check once it is on the page.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setBroken(src);
          }}
        />
      )}
    </span>
  );
}
