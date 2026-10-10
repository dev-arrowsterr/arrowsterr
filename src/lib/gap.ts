/** One keyword in a keyword gap: the competitor's spot (them) and yours (you), when ranked. */
export type GapRow = { keyword: string; volume: number | null; kd: number | null; intent: string | null; them: number | null; you: number | null; url: string | null };
/** Keywords only the competitor ranks for, keywords you both rank for, and keywords only you rank for. */
export type Gap = { missing: GapRow[]; shared: GapRow[]; only: GapRow[]; totals: { missing: number; shared: number; only: number } };
