// Renders the PNGs, favicons and social image from brand/logo/set/svg.
// Run after build_logo.py:  node brand/logo/render_png.mjs
// Needs Playwright (with Chromium) available to Node.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svgDir = join(here, "set", "svg");
const pngDir = join(here, "set", "png");
const webDir = join(here, "set", "web");
mkdirSync(pngDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });

const size = (file) => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(readFileSync(join(svgDir, file), "utf8"));
  return [Number(m[1]), Number(m[2])];
};

/** Draw an SVG at width w (height follows), optionally on a background, into out. */
async function render(file, out, { w, h, bg = "transparent", pad = 0, box } = {}) {
  const [vw, vh] = size(file);
  const iw = w ?? (h * vw) / vh;
  const ih = h ?? (w * vh) / vw;
  const W = Math.round(box ? box[0] : iw + pad * 2);
  const H = Math.round(box ? box[1] : ih + pad * 2);
  const src = "data:image/svg+xml;base64," + readFileSync(join(svgDir, file)).toString("base64");
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;background:${bg};display:flex;align-items:center;justify-content:center"><img src="${src}" style="width:${iw}px;height:${ih}px"></body></html>`);
  await page.waitForTimeout(50);
  await page.screenshot({ path: out, omitBackground: bg === "transparent", clip: { x: 0, y: 0, width: W, height: H } });
}

// Logos, marks and wordmarks
for (const f of readdirSync(svgDir).filter((f) => f.endsWith(".svg") && !f.startsWith("arrowsterr-icon") && !f.startsWith("arrowsterr-favicon"))) {
  const base = f.replace(".svg", "");
  if (base.includes("-mark-")) {
    for (const h of [256, 512, 1024]) await render(f, join(pngDir, `${base}-${h}.png`), { h });
  } else if (base.includes("stacked")) {
    for (const w of [600, 1200]) await render(f, join(pngDir, `${base}-${w}w.png`), { w });
  } else {
    for (const w of [600, 1200, 2400]) await render(f, join(pngDir, `${base}-${w}w.png`), { w });
  }
}

// App icon (rounded) and square icon
for (const s of [128, 256, 512, 1024]) await render("arrowsterr-icon.svg", join(pngDir, `arrowsterr-icon-${s}.png`), { w: s });
for (const s of [16, 32, 48, 64]) await render("arrowsterr-favicon.svg", join(webDir, `icon-${s}.png`), { w: s });
for (const s of [180, 192, 512]) await render("arrowsterr-icon-square.svg", join(webDir, `icon-${s}.png`), { w: s });

// Social card: white lockup centred on brand blue
await render("arrowsterr-logo-white.svg", join(webDir, "og-image.png"), { w: 640, bg: "#0943B0", box: [1200, 630] });
await render("arrowsterr-logo-color.svg", join(webDir, "og-image-light.png"), { w: 640, bg: "#FFFFFF", box: [1200, 630] });

await browser.close();

// favicon.ico (16, 32, 48) and apple-touch-icon, with Pillow
execFileSync("python3", ["-c", `
from PIL import Image
import shutil
d = ${JSON.stringify(webDir)}
Image.open(d + "/icon-48.png").save(d + "/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
shutil.copy(d + "/icon-180.png", d + "/apple-touch-icon.png")
`]);
console.log("done");
