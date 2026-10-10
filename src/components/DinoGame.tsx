"use client";

import { useEffect, useRef, useState } from "react";

// A small runner game for the wait, like the dinosaur in Chrome. Space, the up arrow or a tap jumps.

const W = 600;
const H = 150;
const GROUND = 128;
const PX = 2; // one sprite pixel, in canvas pixels
const INK = "#171717";
const MUTED = "#B5B5B5";
const BRAND = "#0943B0";

const DINO = [
  "          ########",
  "         ## #######",
  "         ##########",
  "         ##########",
  "         ######    ",
  "         ########  ",
  "#       ######     ",
  "##    ##########   ",
  "###  ########  #   ",
  "############       ",
  " ##########        ",
  "  ########         ",
  "   ######          ",
];
const LEGS = [
  ["   ##  ##          ", "   #    ##         "],
  ["   ##  ##          ", "   ##    #         "],
];
const DINO_W = 19 * PX;
const DINO_H = (DINO.length + 2) * PX;

type Cactus = { x: number; w: number; h: number };
type State = { y: number; vy: number; speed: number; score: number; cacti: Cactus[]; next: number; frame: number; over: boolean; running: boolean };

const BEST = "arrowsterr.dino.best";
const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST)) || 0;
  } catch {
    return 0;
  }
};

function drawSprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number) {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === "#") ctx.fillRect(x + c * PX, y + r * PX, PX, PX);
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

    const fresh = (): State => ({ y: 0, vy: 0, speed: 5, score: 0, cacti: [], next: 60, frame: 0, over: false, running: false });
    state.current = fresh();

    const jump = () => {
      const s = state.current!;
      if (s.over) {
        state.current = { ...fresh(), running: true };
        return;
      }
      s.running = true;
      if (s.y === 0) s.vy = -10.5;
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
      if (s.running && !s.over) {
        s.frame++;
        s.speed += 0.0025;
        s.score += s.speed / 30;
        s.vy += 0.6;
        s.y = Math.min(0, s.y + s.vy);
        if (s.y === 0) s.vy = 0;
        for (const c of s.cacti) c.x -= s.speed;
        s.cacti = s.cacti.filter((c) => c.x + c.w > 0);
        if (--s.next <= 0) {
          const big = Math.random() < 0.35;
          const group = Math.random() < 0.25 ? 2 : 1;
          for (let i = 0; i < group; i++) s.cacti.push({ x: W + i * 16, w: big ? 14 : 10, h: big ? 34 : 24 });
          s.next = Math.round(45 + Math.random() * 70 - Math.min(25, s.speed * 2));
        }
        // Hit test with a little forgiveness at the edges.
        const dx = 40;
        const dy = GROUND - DINO_H + s.y;
        if (s.cacti.some((c) => c.x < dx + DINO_W - 8 && c.x + c.w > dx + 8 && dy + DINO_H - 4 > GROUND - c.h)) {
          s.over = true;
          const score = Math.floor(s.score);
          if (score > readBest()) {
            try {
              localStorage.setItem(BEST, String(score));
            } catch {}
            setBest(score);
          }
        }
      }

      ctx.clearRect(0, 0, W, H);
      // Ground with a few pebbles that scroll.
      ctx.fillStyle = MUTED;
      ctx.fillRect(0, GROUND, W, 1);
      for (let i = 0; i < 12; i++) {
        const x = (((i * 53 - s.frame * s.speed) % W) + W) % W;
        ctx.fillRect(x, GROUND + 4 + (i % 3) * 3, 3 + (i % 2) * 2, 1);
      }
      // Cacti.
      ctx.fillStyle = INK;
      for (const c of s.cacti) {
        ctx.fillRect(c.x, GROUND - c.h, c.w, c.h);
        ctx.fillRect(c.x - 4, GROUND - c.h + 8, 4, 3);
        ctx.fillRect(c.x - 4, GROUND - c.h + 2, 2, 8);
        ctx.fillRect(c.x + c.w, GROUND - c.h + 12, 4, 3);
        ctx.fillRect(c.x + c.w + 2, GROUND - c.h + 6, 2, 8);
      }
      // The dinosaur, with running legs.
      const top = GROUND - DINO_H + s.y;
      drawSprite(ctx, DINO, 40, top);
      const legs = s.running && !s.over && s.y === 0 ? LEGS[Math.floor(s.frame / 6) % 2] : LEGS[0];
      drawSprite(ctx, legs, 40, top + DINO.length * PX);
      if (s.over) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(40 + 11 * PX, top + 1 * PX, PX, PX); // a surprised eye
      }
      // Score and messages.
      ctx.font = "500 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = BRAND;
      ctx.fillText(String(Math.floor(s.score)).padStart(5, "0"), W - 8, 20);
      ctx.textAlign = "center";
      ctx.fillStyle = INK;
      if (!s.running) ctx.fillText("Press space or tap to play while you wait", W / 2, 60);
      if (s.over) ctx.fillText("Game over. Press space or tap to try again", W / 2, 60);
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
      <canvas ref={canvas} className="aw-dino__canvas" aria-label="A small jumping game. Press space or tap to jump." />
      {best ? <span className="aw-dino__best">Best {best}</span> : null}
    </div>
  );
}
