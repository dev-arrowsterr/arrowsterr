// Squarified treemap: boxes sized by value, kept as close to square as possible. Pure, in % of the area.

export type Box<T> = { item: T; x: number; y: number; w: number; h: number };

const worst = (row: number[], side: number) => {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
};

/** Lay out items in a w × h area. Bigger values get bigger boxes. Items with no value are left out. */
export function treemap<T>(items: T[], value: (t: T) => number, w = 100, h = 100): Box<T>[] {
  const list = items.filter((t) => value(t) > 0).sort((a, b) => value(b) - value(a));
  const total = list.reduce((n, t) => n + value(t), 0);
  if (!total) return [];
  const scale = (w * h) / total;
  const out: Box<T>[] = [];
  let rect = { x: 0, y: 0, w, h };
  let row: T[] = [];
  const areas = (r: T[]) => r.map((t) => value(t) * scale);

  const place = (r: T[]) => {
    const a = areas(r);
    const sum = a.reduce((n, v) => n + v, 0);
    if (rect.w >= rect.h) {
      const colW = sum / rect.h;
      let y = rect.y;
      r.forEach((t, i) => {
        const bh = a[i] / colW;
        out.push({ item: t, x: rect.x, y, w: colW, h: bh });
        y += bh;
      });
      rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
    } else {
      const rowH = sum / rect.w;
      let x = rect.x;
      r.forEach((t, i) => {
        const bw = a[i] / rowH;
        out.push({ item: t, x, y: rect.y, w: bw, h: rowH });
        x += bw;
      });
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }
  };

  for (const t of list) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst(areas([...row, t]), side) <= worst(areas(row), side)) row.push(t);
    else {
      place(row);
      row = [t];
    }
  }
  if (row.length) place(row);
  return out;
}
