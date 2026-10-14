"use client";

import { useId } from "react";

export type Mood = "idle" | "thinking" | "happy";

/**
 * Mr. Agent, Arrowsterr's mascot: Arro the arrowhead, drawn smooth.
 * He blinks and bobs when idle, looks up with a spinning spark while he works, and smiles wide when done.
 */
export function MrAgent({ size = 48, mood = "idle", className = "" }: { size?: number; mood?: Mood; className?: string }) {
  const id = useId().replace(/:/g, "");
  const look = mood === "thinking" ? "translate(2.5 -3)" : "";
  return (
    <svg viewBox="0 0 120 124" width={size} height={size * (124 / 120)} className={`mr-agent mr-agent--${mood} ${className}`} role="img" aria-label="Mr. Agent">
      <defs>
        <linearGradient id={`${id}b`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#3B7BF0" />
          <stop offset="1" stopColor="#0943B0" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD86B" />
          <stop offset="1" stopColor="#F5A70A" />
        </linearGradient>
      </defs>

      {/* The spark above his head */}
      <g className="mr-agent__spark">
        <path d="M60 2c1.6 6 3.2 7.6 9.2 9.2-6 1.6-7.6 3.2-9.2 9.2-1.6-6-3.2-7.6-9.2-9.2 6-1.6 7.6-3.2 9.2-9.2z" fill={`url(#${id}s)`} />
      </g>

      <g className="mr-agent__body">
        {/* Shadow */}
        <ellipse cx="60" cy="118" rx="34" ry="4" fill="#0B1B3F" opacity="0.1" className="mr-agent__shadow" />
        {/* Arrowhead body with the logo's notch for legs */}
        <path
          d="M60 26 L102 104 Q104 108 99.5 108 L80 108 Q77 108 75.5 105.5 L60 97 L44.5 105.5 Q43 108 40 108 L20.5 108 Q16 108 18 104 Z"
          fill={`url(#${id}b)`}
          stroke={`url(#${id}b)`}
          strokeWidth="10"
          strokeLinejoin="round"
        />
        {/* Soft shine on the left edge */}
        <path d="M55 38 L30 86" stroke="#fff" strokeOpacity="0.22" strokeWidth="5" strokeLinecap="round" />

        {/* Eyes */}
        <g className="mr-agent__eyes">
          <ellipse cx="49" cy="66" rx="8.5" ry="9.5" fill="#fff" />
          <ellipse cx="71" cy="66" rx="8.5" ry="9.5" fill="#fff" />
          <g transform={look} className="mr-agent__pupils">
            <circle cx="50.5" cy="67.5" r="4.6" fill="#0B1B3F" />
            <circle cx="72.5" cy="67.5" r="4.6" fill="#0B1B3F" />
            <circle cx="52" cy="65.6" r="1.6" fill="#fff" />
            <circle cx="74" cy="65.6" r="1.6" fill="#fff" />
          </g>
        </g>

        {/* Cheeks */}
        <ellipse cx="39.5" cy="79" rx="4.5" ry="2.6" fill="#FF8FA3" opacity="0.55" />
        <ellipse cx="80.5" cy="79" rx="4.5" ry="2.6" fill="#FF8FA3" opacity="0.55" />

        {/* Mouth */}
        {mood === "happy" ? (
          <path d="M53 77 Q60 86 67 77 Z" fill="#0B1B3F" stroke="#0B1B3F" strokeWidth="1.5" strokeLinejoin="round" />
        ) : mood === "thinking" ? (
          <ellipse cx="61" cy="80" rx="2.6" ry="2.2" fill="#0B1B3F" />
        ) : (
          <path d="M54.5 78 Q60 83 65.5 78" fill="none" stroke="#0B1B3F" strokeWidth="2.4" strokeLinecap="round" />
        )}

        {/* Bow tie: he is a Mister after all */}
        <g transform="translate(60 89)">
          <path d="M-1.5 0 L-9 -4.5 Q-10.5 -5 -10.5 -3.5 L-10.5 3.5 Q-10.5 5 -9 4.5 Z M1.5 0 L9 -4.5 Q10.5 -5 10.5 -3.5 L10.5 3.5 Q10.5 5 9 4.5 Z" fill="#FFC53D" className="mr-agent__tie" />
          <rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1.6" fill="#F5A70A" />
        </g>
      </g>
    </svg>
  );
}
