"use client";

import { useEffect, useRef, useState } from "react";

// A small runner game for the wait. Zippie, the Arrowsterr agent, runs through the hills:
// jump the snakes, mind the birds, grab the sparkles. Space, the up arrow or a tap jumps.
// Everything is drawn with smooth shapes in Zippie's style (see Zippie.tsx).

const W = 900;
const H = 270;
const GROUND = 226;
const HERO_X = 70;
const ZS = 0.48; // Zippie's drawing is 120 wide; this makes him about 58px
const HERO_W = 120 * ZS;
const HERO_H = 116 * ZS;

// Zippie, from Zippie.tsx (a 120 x 124 box). Made on first draw: Path2D only exists in the browser.
let Z: { body: Path2D; spark: Path2D; tie: Path2D } | null = null;
const zippiePaths = () =>
  (Z ??= {
    body: new Path2D("M60 26 L102 104 Q104 108 99.5 108 L80 108 Q77 108 75.5 105.5 L60 97 L44.5 105.5 Q43 108 40 108 L20.5 108 Q16 108 18 104 Z"),
    spark: new Path2D("M60 2c1.6 6 3.2 7.6 9.2 9.2-6 1.6-7.6 3.2-9.2 9.2-1.6-6-3.2-7.6-9.2-9.2 6-1.6 7.6-3.2 9.2-9.2z"),
    tie: new Path2D("M-1.5 0 L-9 -4.5 Q-10.5 -5 -10.5 -3.5 L-10.5 3.5 Q-10.5 5 -9 4.5 Z M1.5 0 L9 -4.5 Q10.5 -5 10.5 -3.5 L10.5 3.5 Q10.5 5 9 4.5 Z"),
  });
const STAR = (cx: number, cy: number, r: number) => {
  const p = new Path2D();
  const k = r * 0.28;
  p.moveTo(cx, cy - r);
  p.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  p.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  p.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  p.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  return p;
};

const INK = "#0B1B3F";
const BLUE = "#0943B0";

type Thing = { x: number; y: number; w: number; h: number; kind: "snake" | "bird" | "spark"; got?: boolean; seed: number };
type Bit = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Pop = { x: number; y: number; text: string; life: number };
type State = {
  y: number;
  vy: number;
  speed: number;
  score: number;
  things: Thing[];
  bits: Bit[];
  pops: Pop[];
  next: number;
  nextSpark: number;
  frame: number;
  over: boolean;
  running: boolean;
  best: boolean;
  line: string;
  land: number;
};

const BEST = "arrowsterr.dino.best";
const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST)) || 0;
  } catch {
    return 0;
  }
};
const BONKS = { snake: ["Hiss! A snake got Zippie.", "Bonk! Watch the snakes.", "Zippie tripped on a snake."], bird: ["Bonk! A bird got Zippie.", "Tweet tweet, try again.", "That bird came out of nowhere."] };

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Zippie, with running feet. He leans into a jump and sees stars after a bump. */
function drawZippie(ctx: CanvasRenderingContext2D, x: number, top: number, s: State, blink: boolean) {
  const { body: Z_BODY, spark: Z_SPARK, tie: Z_TIE } = zippiePaths();
  const air = s.y < 0;
  const run = s.running && !s.over && !air;
  const step = Math.floor(s.frame / 5) % 2;
  // Squash on landing, stretch in the air.
  const squash = s.land > 0 ? 1 - s.land * 0.02 : air ? 1.04 : 1;
  ctx.save();
  ctx.translate(x + HERO_W / 2, top + HERO_H);
  ctx.rotate(air && !s.over ? Math.max(-0.18, Math.min(0.12, s.vy * 0.018)) : s.over ? 0.12 : 0);
  ctx.scale(ZS * (2 - squash), ZS * squash);
  ctx.translate(-60, -116);

  // Feet: two navy ovals that swap while running and tuck up in the air.
  ctx.fillStyle = INK;
  const feet = air ? [[34, 109], [86, 109]] : run ? (step ? [[28, 114], [92, 111]] : [[32, 111], [88, 114]]) : [[30, 113], [90, 113]];
  for (const [fx, fy] of feet) {
    ctx.beginPath();
    ctx.ellipse(fx, fy, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body with the same gradient and soft round corners as the mascot.
  const g = ctx.createLinearGradient(30, 26, 90, 112);
  g.addColorStop(0, "#3B7BF0");
  g.addColorStop(1, BLUE);
  ctx.fillStyle = g;
  ctx.strokeStyle = g;
  ctx.lineWidth = 10;
  ctx.lineJoin = "round";
  ctx.fill(Z_BODY);
  ctx.stroke(Z_BODY);
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(55, 38);
  ctx.lineTo(30, 86);
  ctx.stroke();

  // Eyes: looking ahead, blinking now and then, spirals after a bump.
  if (s.over) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    for (const cx of [49, 71]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(cx, 66, 8.5, 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.3) {
        const r = 0.9 * a;
        ctx.lineTo(cx + Math.cos(a + s.frame * 0.1) * r, 66 + Math.sin(a + s.frame * 0.1) * r);
      }
      ctx.stroke();
    }
  } else {
    for (const cx of [49, 71]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(cx, 66, 8.5, blink ? 1.2 : 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (blink) continue;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + 3, air ? 64 : 67.5, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cx + 4.5, air ? 62 : 65.6, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Cheeks and mouth: a grin while running, an "o" when bonked.
  ctx.fillStyle = "rgba(255,143,163,.55)";
  for (const cx of [39.5, 80.5]) {
    ctx.beginPath();
    ctx.ellipse(cx, 79, 4.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  if (s.over) {
    ctx.beginPath();
    ctx.ellipse(61, 81, 3.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.running) {
    ctx.beginPath();
    ctx.moveTo(53, 77);
    ctx.quadraticCurveTo(60, 86, 67, 77);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(54.5, 78);
    ctx.quadraticCurveTo(60, 83, 65.5, 78);
    ctx.stroke();
  }
  // Bow tie.
  ctx.save();
  ctx.translate(60, 89);
  ctx.fillStyle = "#FFC53D";
  ctx.fill(Z_TIE);
  ctx.fillStyle = "#F5A70A";
  rr(ctx, -2.6, -2.6, 5.2, 5.2, 1.6);
  ctx.fill();
  ctx.restore();
  // The spark above his head, bouncing a little as he runs.
  ctx.save();
  ctx.translate(0, run ? (step ? -2 : 1) : 0);
  const sg = ctx.createLinearGradient(0, 2, 0, 20);
  sg.addColorStop(0, "#FFD86B");
  sg.addColorStop(1, "#F5A70A");
  ctx.fillStyle = sg;
  ctx.fill(Z_SPARK);
  ctx.restore();
  ctx.restore();

  // Stars circling his head after a bump.
  if (s.over) {
    for (let i = 0; i < 3; i++) {
      const a = s.frame * 0.08 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = "#F5B70A";
      ctx.fill(STAR(x + HERO_W / 2 + Math.cos(a) * 26, top + 4 + Math.sin(a) * 7, 5));
    }
  }
}

/** A round, friendly snake: a wiggling body of overlapping circles, an eye and a flicking tongue. */
function drawSnake(ctx: CanvasRenderingContext2D, t: Thing, frame: number) {
  const base = t.y + t.h;
  const segs = 9;
  const wig = frame * 0.25 + t.seed;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < segs; i++) {
    const k = i / (segs - 1);
    const r = 9 - k * 4.5;
    pts.push([t.x + 10 + k * (t.w - 14), base - r - 1 + Math.sin(wig + k * 4) * 3 * k, r]);
  }
  // Shadow.
  ctx.fillStyle = "rgba(11,27,63,.08)";
  ctx.beginPath();
  ctx.ellipse(t.x + t.w / 2, base + 2, t.w / 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, t.y, 0, base);
  g.addColorStop(0, "#43C178");
  g.addColorStop(1, "#1F8A4C");
  for (let i = segs - 1; i >= 0; i--) {
    const [px, py, r] = pts[i];
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    if (i % 2 === 0 && i > 0) {
      ctx.fillStyle = "rgba(255,214,90,.75)";
      ctx.beginPath();
      ctx.arc(px, py + r * 0.35, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Head, raised a little, facing Zippie.
  const hx = t.x + 9;
  const hy = base - 14 + Math.sin(wig) * 1.5;
  ctx.fillStyle = "#3AB26C";
  ctx.beginPath();
  ctx.ellipse(hx, hy, 11, 9, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(hx - 2, hy - 3, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(hx - 3, hy - 3, 1.9, 0, Math.PI * 2);
  ctx.fill();
  if (Math.floor(frame / 9 + t.seed) % 3 !== 0) {
    ctx.strokeStyle = "#E5484D";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx - 10, hy + 2);
    ctx.lineTo(hx - 17, hy + 2);
    ctx.moveTo(hx - 17, hy + 2);
    ctx.lineTo(hx - 20, hy);
    ctx.moveTo(hx - 17, hy + 2);
    ctx.lineTo(hx - 20, hy + 4);
    ctx.stroke();
  }
}

/** A plump coral bird with a flapping wing and a yellow beak. */
function drawBird(ctx: CanvasRenderingContext2D, t: Thing, frame: number) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2 + Math.sin(frame * 0.12 + t.seed) * 2;
  const flap = Math.sin(frame * 0.35 + t.seed);
  // Tail.
  ctx.fillStyle = "#C9533A";
  ctx.beginPath();
  ctx.moveTo(cx + 14, cy - 2);
  ctx.lineTo(cx + 24, cy - 8);
  ctx.lineTo(cx + 22, cy + 3);
  ctx.closePath();
  ctx.fill();
  // Body.
  const g = ctx.createLinearGradient(0, cy - 12, 0, cy + 12);
  g.addColorStop(0, "#FF9A7E");
  g.addColorStop(1, "#E9664A");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 17, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFD3C4";
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy + 4, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wing.
  ctx.save();
  ctx.translate(cx + 3, cy - 3);
  ctx.rotate(-0.4 - flap * 0.7);
  ctx.fillStyle = "#C9533A";
  ctx.beginPath();
  ctx.ellipse(6, 0, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Eye and beak, facing Zippie.
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx - 9, cy - 4, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx - 10, cy - 4, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#F5B70A";
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy - 2);
  ctx.lineTo(cx - 24, cy + 1);
  ctx.lineTo(cx - 15, cy + 4);
  ctx.closePath();
  ctx.fill();
}

/** onGameOver runs each time Zippie crashes, so the page can move on when it is waiting. */
export function DinoGame({ onGameOver }: { onGameOver?: () => void } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const over = useRef(onGameOver);
  useEffect(() => {
    over.current = onGameOver;
  });
  const state = useRef<State | null>(null);
  const [best, setBest] = useState(readBest);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    const font = css.getPropertyValue("--font-geist").trim() || "system-ui, sans-serif";
    const mono = css.getPropertyValue("--font-geist-mono").trim() || "ui-monospace, monospace";

    const fresh = (): State => ({ y: 0, vy: 0, speed: 5, score: 0, things: [], bits: [], pops: [], next: 70, nextSpark: 120, frame: 0, over: false, running: false, best: false, line: "", land: 0 });
    state.current = fresh();

    const burst = (s: State, x: number, y: number, n: number, colors: string[], spread = 3) => {
      for (let i = 0; i < n; i++)
        s.bits.push({ x, y, vx: (Math.random() - 0.5) * spread * 2, vy: -Math.random() * spread - 1, life: 30 + Math.random() * 30, color: colors[i % colors.length], size: 2 + Math.random() * 2.5 });
    };

    const jump = () => {
      const s = state.current!;
      if (s.over) {
        state.current = { ...fresh(), running: true };
        return;
      }
      s.running = true;
      if (s.y === 0) {
        s.vy = -12;
        burst(s, HERO_X + HERO_W / 2, GROUND, 5, ["#DCE3EE", "#C7D2E3"], 1.5);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "ArrowUp") return;
      // Leave typing alone.
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button")) return;
      e.preventDefault();
      jump();
    };
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      jump();
    };
    window.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onTap);

    let raf = 0;
    let clock = 0;
    const tick = () => {
      const s = state.current!;
      clock++;
      const heroX = HERO_X;
      if (s.land > 0) s.land--;
      if (s.running && !s.over) {
        s.frame++;
        s.speed = Math.min(9, s.speed + 0.0015);
        s.score += s.speed / 30;
        const wasUp = s.y < 0;
        s.vy += 0.55;
        s.y = Math.min(0, s.y + s.vy);
        if (s.y === 0) {
          s.vy = 0;
          if (wasUp) {
            s.land = 8;
            burst(s, heroX + HERO_W / 2, GROUND, 7, ["#DCE3EE", "#C7D2E3"], 1.5);
          }
        }
        for (const t of s.things) t.x -= s.speed;
        s.things = s.things.filter((t) => t.x + t.w > -30 && !t.got);
        // Snakes on the ground. Once the run warms up, birds too: low ones to jump, high ones to stay under.
        if (--s.next <= 0) {
          const bird = s.score > 80 && Math.random() < 0.35;
          if (bird) s.things.push({ x: W, y: GROUND - (Math.random() < 0.5 ? 48 : 86), w: 44, h: 24, kind: "bird", seed: Math.random() * 10 });
          else s.things.push({ x: W, y: GROUND - 22, w: 50, h: 22, kind: "snake", seed: Math.random() * 10 });
          s.next = Math.round(75 + Math.random() * 80 - Math.min(20, s.speed * 2));
        }
        // Sparkles in the air, worth a jump.
        if (--s.nextSpark <= 0) {
          s.things.push({ x: W, y: GROUND - 128 - Math.random() * 25, w: 22, h: 22, kind: "spark", seed: Math.random() * 10 });
          s.nextSpark = Math.round(90 + Math.random() * 120);
        }
        // Hits, with a little forgiveness at the edges.
        const top = GROUND - HERO_H + s.y;
        const hit = (t: Thing) => t.x < heroX + HERO_W - 9 && t.x + t.w > heroX + 9 && top + HERO_H - 4 > t.y && top + 10 < t.y + t.h;
        for (const t of s.things) {
          if (!hit(t)) continue;
          if (t.kind === "spark") {
            t.got = true;
            s.score += 25;
            s.pops.push({ x: t.x, y: t.y, text: "+25", life: 40 });
            burst(s, t.x + 11, t.y + 11, 10, ["#F5B70A", "#FFD86B", "#3B7BF0"]);
            continue;
          }
          s.over = true;
          over.current?.();
          const lines = BONKS[t.kind];
          s.line = lines[Math.floor(Math.random() * lines.length)];
          burst(s, heroX + HERO_W, top + HERO_H / 2, 12, [BLUE, "#3B7BF0", "#B9C0CC"]);
          const score = Math.floor(s.score);
          if (score > readBest()) {
            try {
              localStorage.setItem(BEST, String(score));
            } catch {}
            setBest(score);
            s.best = true;
            for (let i = 0; i < 5; i++) burst(s, 120 + i * 170, 40, 16, [BLUE, "#F5B70A", "#2E9E5B", "#E5484D", "#3B7BF0"], 4);
          }
          break;
        }
      }
      // Bits and pop-ups keep moving after a bump, for the confetti.
      for (const b of s.bits) {
        b.x += b.vx - (s.over ? 0 : s.speed * 0.3);
        b.y += b.vy;
        b.vy += 0.15;
        b.life--;
      }
      s.bits = s.bits.filter((b) => b.life > 0 && b.y < H);
      for (const p of s.pops) {
        p.y -= 0.6;
        p.life--;
      }
      s.pops = s.pops.filter((p) => p.life > 0);

      // Sky, soft clouds and two layers of hills that drift at their own pace.
      const scroll = s.frame * s.speed;
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, "#E4EDFD");
      sky.addColorStop(1, "#F7F9FE");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      for (let i = 0; i < 4; i++) {
        const x = ((((i * 260 - scroll * 0.12) % (W + 200)) + W + 200) % (W + 200)) - 100;
        const y = 34 + (i % 2) * 26;
        ctx.beginPath();
        ctx.arc(x, y + 8, 12, 0, Math.PI * 2);
        ctx.arc(x + 18, y, 17, 0, Math.PI * 2);
        ctx.arc(x + 40, y + 6, 14, 0, Math.PI * 2);
        ctx.fill();
        rr(ctx, x - 12, y + 6, 66, 16, 8);
        ctx.fill();
      }
      const hills = (speed: number, gap: number, h: number, top: string, bottom: string) => {
        const g = ctx.createLinearGradient(0, GROUND - h - 30, 0, GROUND);
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
        for (let i = 0; i < 6; i++) {
          const x = ((((i * gap - scroll * speed) % (W + gap)) + W + gap) % (W + gap)) - gap / 2;
          ctx.beginPath();
          ctx.ellipse(x, GROUND + 4, gap * 0.62, h + (i % 3) * 12, 0, Math.PI, 0);
          ctx.fill();
        }
      };
      hills(0.2, 260, 48, "#D6E2FB", "#E8EFFD");
      hills(0.4, 200, 30, "#C3D6F7", "#DCE7FB");

      // Ground: a soft grass band with rounded tufts and a few pebbles.
      const ground = ctx.createLinearGradient(0, GROUND, 0, H);
      ground.addColorStop(0, "#EAF6EE");
      ground.addColorStop(1, "#FFFFFF");
      ctx.fillStyle = ground;
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#43B474";
      rr(ctx, 0, GROUND - 1, W, 4, 2);
      ctx.fill();
      for (let i = 0; i < 20; i++) {
        const x = (((i * 49 - scroll) % W) + W) % W;
        ctx.fillStyle = "#43B474";
        ctx.beginPath();
        ctx.ellipse(x, GROUND, 3, 5, -0.3, 0, Math.PI * 2);
        ctx.ellipse(x + 5, GROUND - 1, 3, 7, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#D3DCE8";
        ctx.beginPath();
        ctx.ellipse(x + 26, GROUND + 14 + (i % 3) * 8, 3 + (i % 2) * 2, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Snakes, birds and sparkles.
      for (const t of s.things) {
        if (t.kind === "snake") drawSnake(ctx, t, s.frame);
        else if (t.kind === "bird") drawBird(ctx, t, s.frame);
        else {
          const bob = Math.sin((s.frame + t.x) / 8) * 2;
          const glow = ctx.createRadialGradient(t.x + 11, t.y + 11 + bob, 0, t.x + 11, t.y + 11 + bob, 20);
          glow.addColorStop(0, "rgba(255,216,107,.55)");
          glow.addColorStop(1, "rgba(255,216,107,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(t.x - 10, t.y - 10 + bob, 42, 42);
          ctx.fillStyle = "#F5B70A";
          ctx.fill(STAR(t.x + 11, t.y + 11 + bob, 11));
          ctx.fillStyle = "#FFE9A8";
          ctx.fill(STAR(t.x + 11, t.y + 9 + bob, 4));
        }
      }

      // Zippie's shadow shrinks as he jumps, then Zippie.
      const lift = Math.min(1, -s.y / 120);
      ctx.fillStyle = `rgba(11,27,63,${0.12 - lift * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(heroX + HERO_W / 2, GROUND + 2, 20 - lift * 8, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      const top = GROUND - HERO_H + s.y;
      if (s.y < 0 && !s.over) {
        // A little speed trail while in the air.
        ctx.strokeStyle = "rgba(9,67,176,.16)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(heroX - 16, top + 18);
        ctx.lineTo(heroX - 2, top + 18);
        ctx.moveTo(heroX - 22, top + 30);
        ctx.lineTo(heroX - 4, top + 30);
        ctx.stroke();
      }
      drawZippie(ctx, heroX, top, s, clock % 150 < 6);

      for (const b of s.bits) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = Math.min(1, b.life / 20);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 16px ${mono}`;
      ctx.textAlign = "center";
      for (const p of s.pops) {
        ctx.globalAlpha = Math.min(1, p.life / 20);
        ctx.fillStyle = "#B7860B";
        ctx.fillText(p.text, p.x + 11, p.y);
      }
      ctx.globalAlpha = 1;

      // Score and messages.
      ctx.font = `600 20px ${mono}`;
      ctx.textAlign = "right";
      ctx.fillStyle = BLUE;
      ctx.fillText(String(Math.floor(s.score)).padStart(5, "0"), W - 16, 34);
      ctx.textAlign = "center";
      ctx.fillStyle = INK;
      if (!s.running) {
        ctx.font = `600 19px ${font}`;
        ctx.fillText("Help Zippie jump the snakes and dodge the birds", W / 2, 92);
        ctx.font = `500 15px ${font}`;
        ctx.fillStyle = "#5C6B89";
        ctx.fillText("Press space or tap to start", W / 2, 118);
      }
      if (s.over) {
        ctx.font = `600 22px ${font}`;
        ctx.fillText(s.best ? "New best! Zippie is proud of you." : s.line, W / 2, 92);
        ctx.font = `500 15px ${font}`;
        ctx.fillStyle = "#5C6B89";
        ctx.fillText("Press space or tap to run again", W / 2, 120);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onTap);
    };
  }, []);

  return (
    <div className="aw-dino">
      <canvas ref={canvas} className="aw-dino__canvas" aria-label="A small runner game: help Zippie jump over snakes and dodge birds. Press space or tap to jump." />
      {best ? <span className="aw-dino__best">Best {best}</span> : null}
    </div>
  );
}
