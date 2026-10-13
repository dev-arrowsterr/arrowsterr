"use client";

import { useEffect, useRef, useState } from "react";

// A small runner game for the wait. Arro, the Arrowsterr arrow, runs through the hills:
// jump the snakes and rocks, grab the sparkles. Space, the up arrow or a tap jumps.

const W = 600;
const H = 150;
const GROUND = 126;
const PX = 2; // one sprite pixel, in canvas pixels

const C: Record<string, string> = {
  "#": "#0943B0", // brand blue
  b: "#2F6BE0", // lighter blue, for shine
  w: "#FFFFFF",
  k: "#0B1220", // ink
  g: "#2E9E5B", // snake green
  d: "#1F7543", // snake dark green
  y: "#F5B70A", // snake belly, sparkles
  r: "#E5484D", // tongue
  s: "#8C94A3", // rock
  t: "#B9C0CC", // rock light
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
const ROCK = [
  "    tttt    ",
  "  ttssssst  ",
  " tsssssssst ",
  "tssssssssss ",
  "sssssssssssk",
  " skkkkkkkkk ",
];
const SPARK = ["   y   ", "  yyy  ", "yyyyyyy", "  yyy  ", "   y   "];

type Thing = { x: number; y: number; w: number; h: number; kind: "snake" | "rock" | "spark"; got?: boolean };
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
const BONKS = ["Bonk!", "Hiss! A snake got you.", "Oof, that rock came out of nowhere.", "Arro tripped."];

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

export function DinoGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
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
        s.vy = -10.5;
        burst(s, 40 + HERO_W / 2, GROUND, 4, ["#D5DBE5"], 1.5);
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
      const heroX = 40;
      if (s.running && !s.over) {
        s.frame++;
        s.speed += 0.0025;
        s.score += s.speed / 30;
        const wasUp = s.y < 0;
        s.vy += 0.6;
        s.y = Math.min(0, s.y + s.vy);
        if (s.y === 0) {
          s.vy = 0;
          if (wasUp) burst(s, heroX + HERO_W / 2, GROUND, 6, ["#D5DBE5", "#C3CAD6"], 1.5);
        }
        for (const t of s.things) t.x -= s.speed;
        s.things = s.things.filter((t) => t.x + t.w > -10 && !t.got);
        // Snakes and rocks on the ground, now and then two close together.
        if (--s.next <= 0) {
          const snake = Math.random() < 0.6;
          s.things.push(snake ? { x: W, y: GROUND - 14, w: 30, h: 14, kind: "snake" } : { x: W, y: GROUND - 12, w: 24, h: 12, kind: "rock" });
          if (Math.random() < 0.2) s.things.push({ x: W + 34, y: GROUND - 12, w: 24, h: 12, kind: "rock" });
          s.next = Math.round(50 + Math.random() * 70 - Math.min(25, s.speed * 2));
        }
        // Sparkles in the air, worth a jump.
        if (--s.nextSpark <= 0) {
          s.things.push({ x: W, y: GROUND - 58 - Math.random() * 22, w: 14, h: 10, kind: "spark" });
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
          s.line = BONKS[Math.floor(Math.random() * BONKS.length)];
          burst(s, heroX + HERO_W, top + HERO_H / 2, 10, ["#0943B0", "#2F6BE0", "#B9C0CC"]);
          const score = Math.floor(s.score);
          if (score > readBest()) {
            try {
              localStorage.setItem(BEST, String(score));
            } catch {}
            setBest(score);
            s.best = true;
            for (let i = 0; i < 4; i++) burst(s, 100 + i * 130, 30, 14, ["#0943B0", "#F5B70A", "#2E9E5B", "#E5484D", "#2F6BE0"], 4);
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
        const x = ((((i * 180 - scroll * 0.15) % (W + 120)) + W + 120) % (W + 120)) - 60;
        const y = 18 + (i % 2) * 16;
        ctx.fillRect(x, y + 4, 44, 8);
        ctx.fillRect(x + 8, y, 22, 6);
      }
      ctx.fillStyle = "#D7E3FA";
      for (let i = 0; i < 5; i++) {
        const x = ((((i * 150 - scroll * 0.35) % (W + 150)) + W + 150) % (W + 150)) - 75;
        ctx.beginPath();
        ctx.ellipse(x, GROUND, 80, 26 + (i % 3) * 8, 0, Math.PI, 0);
        ctx.fill();
      }
      // Ground: grass line and tufts.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#2E9E5B";
      ctx.fillRect(0, GROUND, W, 2);
      for (let i = 0; i < 14; i++) {
        const x = (((i * 47 - scroll) % W) + W) % W;
        ctx.fillRect(x, GROUND - 2, 2, 2);
        ctx.fillRect(x + 3, GROUND - 3, 2, 3);
        ctx.fillStyle = "#C9D1DC";
        ctx.fillRect(x + 20, GROUND + 8 + (i % 3) * 4, 3 + (i % 2) * 3, 1);
        ctx.fillStyle = "#2E9E5B";
      }

      // Snakes, rocks and sparkles.
      for (const t of s.things) {
        if (t.kind === "snake") draw(ctx, SNAKE[Math.floor(s.frame / 8) % 2], t.x, t.y);
        else if (t.kind === "rock") draw(ctx, ROCK, t.x, t.y);
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
        ctx.fillRect(heroX - 10, top + 10, 8, 2);
        ctx.fillRect(heroX - 14, top + 16, 10, 2);
      }

      for (const b of s.bits) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = Math.min(1, b.life / 20);
        ctx.fillRect(b.x, b.y, b.size, b.size);
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 12px ${mono}`;
      ctx.textAlign = "center";
      for (const p of s.pops) {
        ctx.globalAlpha = Math.min(1, p.life / 20);
        ctx.fillStyle = "#B7860B";
        ctx.fillText(p.text, p.x + 7, p.y);
      }
      ctx.globalAlpha = 1;

      // Score and messages.
      ctx.font = `600 13px ${mono}`;
      ctx.textAlign = "right";
      ctx.fillStyle = "#0943B0";
      ctx.fillText(String(Math.floor(s.score)).padStart(5, "0"), W - 10, 20);
      ctx.textAlign = "center";
      ctx.fillStyle = "#0B1220";
      ctx.font = `500 13px ${mono}`;
      if (!s.running) ctx.fillText("Help Arro jump the snakes. Space or tap to start", W / 2, 66);
      if (s.over) {
        ctx.font = `600 14px ${mono}`;
        ctx.fillText(s.best ? "New best! Arro is proud of you." : s.line, W / 2, 58);
        ctx.font = `500 12px ${mono}`;
        ctx.fillStyle = "#5B6475";
        ctx.fillText("Space or tap to run again", W / 2, 78);
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
      <canvas ref={canvas} className="aw-dino__canvas" aria-label="A small runner game: help Arro jump over snakes and rocks. Press space or tap to jump." />
      {best ? <span className="aw-dino__best">Best {best}</span> : null}
    </div>
  );
}
