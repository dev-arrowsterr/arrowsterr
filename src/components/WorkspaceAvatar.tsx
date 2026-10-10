"use client";

import { BrandLogo } from "./BrandLogo";
import type { Workspace } from "@/lib/db";

/** The workspace picture. It starts as the first brand's logo. */
export function WorkspaceAvatar({ ws, brandLogo, size = 24 }: { ws: Workspace; brandLogo: string | null; size?: number }) {
  const src = ws.avatar || brandLogo;
  if (src) return <BrandLogo src={src} name={ws.name} size={size} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[6px] bg-ink font-medium text-white" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {ws.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Shrink a picked image to a small square PNG data URL. */
export function avatarFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 96;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image."));
    };
    img.src = url;
  });
}
