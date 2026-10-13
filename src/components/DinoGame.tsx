"use client";

import { useEffect, useRef, useState } from "react";

// A small runner game for the wait. Arro, the Arrowsterr arrow, runs through the hills:
// jump the snakes, mind the birds, grab the sparkles. Space, the up arrow or a tap jumps.

const W = 900;
const H = 270;
const GROUND = 230;
const PX = 3; // one sprite pixel, in canvas pixels
const HERO_X = 70;

const C: Record<string, string> = {
  "#": "#0943B0", // brand blue
  b: "#2F6BE0", // lighter blue, for shine
  w: "#FFFFFF",
  k: "#0B1220", // ink
  g: "#2E9E5B", // snake green
  d: "#1F7543", // snake dark green
  y: "#F5B70A", // snake belly, sparkles
  r: "#E5484D", // tongue
  o: "#F27A5E", // bird
  O: "#C9533A", // bird wing
};

// Arro: an arrowhead with eyes. Two eye rows: looking ahead, and dizzy after a bump.
const BODY = [
  "       ##       ",
  "      #bb#      ",
  "     #bb###     ",
  "    ##b#####    ",
  "    #ww##ww#    ",
  "   ##wk##wk##   ",
  "   ##########   ",
  "  ####k##k####  ",
  "  #####kk#####  ",
  " ############## ",
  " #####    ##### ",
  "#####      #####",
];
const DIZZY_EYES = ["    #kw##kw#    ", "   ##wk##wk##   "];
const FEET = [
  ["   kk      kk   ", "  kkk     kkk   "],
  ["  kk        kk  ", "   kkk   kkk    "],
];
const HERO_W = 16 * PX;
const HERO_H = (BODY.length + 2) * PX;

// Snakes face the hero, with a flicking tongue and a wiggle.
const SNAKE = [
  [
    "  ggg          ",
    " gwkgg         ",
    "rgggggg    gg  ",
    " ggyyyg   gggg ",
    "    gggg ggddgg",
    "     ggggggg gg",
    "      ddddd    ",
  ],
  [
    "  ggg          ",
    " gwkgg         ",
    " gggggg  ggg   ",
    "rggyyygg ggdgg ",
    "    gggggg  ggg",
    "      ggggg  gg",
    "       ddd     ",
  ],
];
// Birds fly at Arro: low ones to jump over, high ones to stay under.
const BIRD = [
  [
    "      OO     ",
    "     OOO     ",
    "  oo OOOO    ",
    "yykooooooooO ",
    "  ooooooooooO",
    "    oooooo   ",
  ],
  [
    "             ",
    "             ",
    "  oo         ",
    "yykooooooooO ",
    "  ooooOOOooooO",
    "     OOO     ",
    "      OO     ",
  ],
];
const SPARK = ["   y   ", "  yyy  ", "yyyyyyy", "  yyy  ", "   y   "];

type Thing = { x: number; y: number; w: number; h: number; kind: "snake" | "bird" | "spark"; got?: boolean };
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
};

const BEST = "arrowsterr.dino.best";
const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST)) || 0;
  } catch {
    return 0;
  }
};
const BONKS = { snake: ["Hiss! A snake got Arro.", "Bonk! Watch the snakes.", "Arro tripped on a snake."], bird: ["Bonk! A bird got Arro.", "Tweet tweet, try again.", "That bird came out of nowhere."] };

function draw(ctx: CanvasRenderingContext2D, rows: string[], x0: number, y0: number) {
  // Whole pixels, so no hairline gaps show between sprite pixels.
  const x = Math.round(x0);
  const y = Math.round(y0);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const color = C[row[c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * PX, y + r * PX, PX, PX);
    }
  });
}

/** onGameOver runs each time Arro crashes, so the page can move on when it is waiting. */
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
    const mono = getComputedStyle(document.body).getPropertyValue("--font-plex").trim() || "ui-monospace, monospace";

    const fresh = (): State => ({ y: 0, vy: 0, speed: 5, score: 0, things: [], bits: [], pops: [], next: 70, nextSpark: 120, frame: 0, over: false, running: false, best: false, line: "" });
    state.current = fresh();

    const burst = (s: State, x: number, y: number, n: number, colors: string[], spread = 3) => {
      for (let i = 0; i < n; i++)
        s.bits.push({ x, y, vx: (Math.random() - 0.5) * spread * 2, vy: -Math.random() * spread - 1, life: 30 + Math.random() * 30, color: colors[i % colors.length], size: 2 + Math.round(Math.random() * 2) });
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
        burst(s, HERO_X + HERO_W / 2, GROUND, 4, ["#D5DBE5"], 1.5);
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
    const tick = () => {
      const s = state.current!;
      const heroX = HERO_X;
      if (s.running && !s.over) {
        s.frame++;
        s.speed = Math.min(9, s.speed + 0.0015);
        s.score += s.speed / 30;
        const wasUp = s.y < 0;
        s.vy += 0.55;
        s.y = Math.min(0, s.y + s.vy);
        if (s.y === 0) {
          s.vy = 0;
          if (wasUp) burst(s, heroX + HERO_W / 2, GROUND, 6, ["#D5DBE5", "#C3CAD6"], 1.5);
        }
        for (const t of s.things) t.x -= s.speed;
        s.things = s.things.filter((t) => t.x + t.w > -10 && !t.got);
        // Snakes on the ground. Once the run warms up, birds too: low ones to jump, high ones to stay under.
        if (--s.next <= 0) {
          const bird = s.score > 80 && Math.random() < 0.35;
          if (bird) s.things.push({ x: W, y: GROUND - (Math.random() < 0.5 ? 45 : 82), w: 13 * PX, h: 7 * PX, kind: "bird" });
          else s.things.push({ x: W, y: GROUND - 7 * PX, w: 15 * PX, h: 7 * PX, kind: "snake" });
          s.next = Math.round(75 + Math.random() * 80 - Math.min(20, s.speed * 2));
        }
        // Sparkles in the air, worth a jump.
        if (--s.nextSpark <= 0) {
          s.things.push({ x: W, y: GROUND - 120 - Math.random() * 25, w: 7 * PX, h: 5 * PX, kind: "spark" });
          s.nextSpark = Math.round(90 + Math.random() * 120);
        }
        // Hits, with a little forgiveness at the edges.
        const top = GROUND - HERO_H + s.y;
        const hit = (t: Thing) => t.x < heroX + HERO_W - 6 && t.x + t.w > heroX + 6 && top + HERO_H - 4 > t.y && top + 4 < t.y + t.h;
        for (const t of s.things) {
          if (!hit(t)) continue;
          if (t.kind === "spark") {
            t.got = true;
            s.score += 25;
            s.pops.push({ x: t.x, y: t.y, text: "+25", life: 40 });
            burst(s, t.x + 7, t.y + 5, 8, ["#F5B70A", "#FFD95A", "#2F6BE0"]);
            continue;
          }
          s.over = true;
          over.current?.();
          const lines = BONKS[t.kind];
          s.line = lines[Math.floor(Math.random() * lines.length)];
          burst(s, heroX + HERO_W, top + HERO_H / 2, 10, ["#0943B0", "#2F6BE0", "#B9C0CC"]);
          const score = Math.floor(s.score);
          if (score > readBest()) {
            try {
              localStorage.setItem(BEST, String(score));
            } catch {}
            setBest(score);
            s.best = true;
            for (let i = 0; i < 5; i++) burst(s, 120 + i * 170, 40, 16, ["#0943B0", "#F5B70A", "#2E9E5B", "#E5484D", "#2F6BE0"], 4);
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

      // Sky, clouds and hills that drift at their own pace.
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, "#EAF1FD");
      sky.addColorStop(1, "#F8FAFE");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      const scroll = s.frame * s.speed;
      ctx.fillStyle = "#FFFFFF";
      for (let i = 0; i < 4; i++) {
        const x = ((((i * 260 - scroll * 0.15) % (W + 160)) + W + 160) % (W + 160)) - 80;
        const y = 26 + (i % 2) * 26;
        ctx.fillRect(x, y + 6, 66, 12);
        ctx.fillRect(x + 12, y, 33, 9);
      }
      ctx.fillStyle = "#D7E3FA";
      for (let i = 0; i < 5; i++) {
        const x = ((((i * 220 - scroll * 0.35) % (W + 220)) + W + 220) % (W + 220)) - 110;
        ctx.beginPath();
        ctx.ellipse(x, GROUND, 120, 40 + (i % 3) * 14, 0, Math.PI, 0);
        ctx.fill();
      }
      // Ground: grass line and tufts.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#2E9E5B";
      ctx.fillRect(0, GROUND, W, 3);
      for (let i = 0; i < 18; i++) {
        const x = (((i * 53 - scroll) % W) + W) % W;
        ctx.fillRect(x, GROUND - 3, 3, 3);
        ctx.fillRect(x + 4, GROUND - 5, 3, 5);
        ctx.fillStyle = "#C9D1DC";
        ctx.fillRect(x + 24, GROUND + 12 + (i % 3) * 6, 4 + (i % 2) * 4, 2);
        ctx.fillStyle = "#2E9E5B";
      }

      // Snakes, birds and sparkles.
      for (const t of s.things) {
        if (t.kind === "snake") draw(ctx, SNAKE[Math.floor(s.frame / 8) % 2], t.x, t.y);
        else if (t.kind === "bird") draw(ctx, BIRD[Math.floor(s.frame / 10) % 2], t.x, t.y);
        else draw(ctx, SPARK, t.x, t.y + Math.sin((s.frame + t.x) / 8) * 2);
      }

      // Arro, with running feet, a bob while running and dizzy eyes after a bump.
      const bob = s.running && !s.over && s.y === 0 ? (Math.floor(s.frame / 6) % 2) * -1 : 0;
      const top = GROUND - HERO_H + s.y + bob;
      const body = s.over ? [...BODY.slice(0, 4), ...DIZZY_EYES, ...BODY.slice(6)] : BODY;
      draw(ctx, body, heroX, top);
      const feet = s.y < 0 ? FEET[1] : s.running && !s.over ? FEET[Math.floor(s.frame / 6) % 2] : FEET[0];
      draw(ctx, feet, heroX, top + BODY.length * PX);
      if (s.y < 0 && !s.over) {
        // A little speed trail while in the air.
        ctx.fillStyle = "rgba(9,67,176,.18)";
        ctx.fillRect(heroX - 14, top + 14, 12, 3);
        ctx.fillRect(heroX - 20, top + 24, 15, 3);
      }

      for (const b of s.bits) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = Math.min(1, b.life / 20);
        ctx.fillRect(b.x, b.y, b.size, b.size);
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 16px ${mono}`;
      ctx.textAlign = "center";
      for (const p of s.pops) {
        ctx.globalAlpha = Math.min(1, p.life / 20);
        ctx.fillStyle = "#B7860B";
        ctx.fillText(p.text, p.x + 7, p.y);
      }
      ctx.globalAlpha = 1;

      // Score and messages.
      ctx.font = `600 20px ${mono}`;
      ctx.textAlign = "right";
      ctx.fillStyle = "#0943B0";
      ctx.fillText(String(Math.floor(s.score)).padStart(5, "0"), W - 16, 34);
      ctx.textAlign = "center";
      ctx.fillStyle = "#0B1220";
      ctx.font = `500 19px ${mono}`;
      if (!s.running) ctx.fillText("Help Arro jump the snakes and dodge the birds. Space or tap to start", W / 2, 100);
      if (s.over) {
        ctx.font = `600 22px ${mono}`;
        ctx.fillText(s.best ? "New best! Arro is proud of you." : s.line, W / 2, 92);
        ctx.font = `500 17px ${mono}`;
        ctx.fillStyle = "#5B6475";
        ctx.fillText("Space or tap to run again", W / 2, 124);
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
      <canvas ref={canvas} className="aw-dino__canvas" aria-label="A small runner game: help Arro jump over snakes and dodge birds. Press space or tap to jump." />
      {best ? <span className="aw-dino__best">Best {best}</span> : null}
    </div>
  );
}
