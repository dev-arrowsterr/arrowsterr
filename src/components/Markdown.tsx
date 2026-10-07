import { Fragment } from "react";

// A small, safe markdown renderer for AI answers: headings, lists, bold, italics and links.
// React escapes all text, so nothing in an answer can inject HTML.

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<![*\w])\*(?!\s)(.+?)\*(?!\w)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2] !== undefined)
      out.push(
        <a key={k} href={m[3]} target="_blank" rel="noopener noreferrer nofollow">
          {m[2]}
        </a>,
      );
    else out.push(<em key={k}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: { n?: number; text: string }[] } | null = null;

  const flush = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    blocks.push(
      list.ordered ? (
        <ol key={k} className="md-ol">
          {list.items.map((it, i) => (
            <li key={i} value={it.n}>
              {inline(it.text, `${k}-${i}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={k} className="aw-list aw-list--tight aw-list--dots">
          {list.items.map((it, i) => (
            <li key={i}>
              <span>{inline(it.text, `${k}-${i}`)}</span>
            </li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const ol = /^\s*(?:#+\s*)?(\d{1,2})[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (ol) {
      if (!list || !list.ordered) flush();
      list ??= { ordered: true, items: [] };
      list.items.push({ n: Number(ol[1]), text: ol[2] });
    } else if (ul) {
      if (!list || list.ordered) flush();
      list ??= { ordered: false, items: [] };
      list.items.push({ text: ul[1] });
    } else if (h) {
      flush();
      blocks.push(
        <p key={`h${idx}`} className="md-h">
          {inline(h[1], `h${idx}`)}
        </p>,
      );
    } else if (line.trim()) {
      flush();
      blocks.push(<p key={`p${idx}`}>{inline(line, `p${idx}`)}</p>);
    } else {
      flush();
    }
  });
  flush();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
