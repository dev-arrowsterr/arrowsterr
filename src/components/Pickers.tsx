"use client";

// Arrowsterr's own pickers, used in place of the browser's: pop-ups, option lists, dropdowns and dates.
// They look the same on every computer and fit the app.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Option = {
  id: string;
  label: string;
  /** Other words that mean this option when pasted. */ aliases?: string[];
  /** A status class for the chip. */ tone?: string;
};

const portalRoot = () => (typeof document === "undefined" ? null : ((document.querySelector(".aw") as HTMLElement | null) ?? document.body));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Open pop-ups, newest last. Escape closes only the newest, so a list opened from a menu closes first.
const open: object[] = [];

/** A pop-up under a cell, a field or a column name, kept on screen. Closes on a click outside or Escape. */
export function Pop({ anchor, onClose, children, width = 260, label }: { anchor: DOMRect; onClose: () => void; children: React.ReactNode; width?: number; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const below = anchor.bottom + 4;
    const top = below + h > window.innerHeight - 8 && anchor.top - h - 4 > 8 ? anchor.top - h - 4 : Math.max(8, Math.min(below, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const me = {};
    open.push(me);
    // A click in another pop-up (one opened from this one) keeps this one open.
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.(".aw-pop")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || open[open.length - 1] !== me) return;
      e.stopPropagation();
      onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      open.splice(open.indexOf(me), 1);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const root = portalRoot();
  if (!root) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="aw-pop" style={{ left: pos.left, top: pos.top, width }} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    root,
  );
}

/** Pick one option, in Arrowsterr's style. Type to narrow, arrows to move, Enter to pick. */
export function SelectPop({ anchor, options, value, onPick, onClose, label }: { anchor: DOMRect; options: Option[]; value: string; onPick: (id: string) => void; onClose: () => void; label: string }) {
  const [q, setQ] = useState("");
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const [i, setI] = useState(
    Math.max(
      0,
      list.findIndex((o) => o.id === value),
    ),
  );
  const move = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((x) => Math.min(list.length - 1, x + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((x) => Math.max(0, x - 1));
    }
    if (e.key === "Enter" && list[i]) {
      e.preventDefault();
      onPick(list[i].id);
    }
  };
  return (
    <Pop anchor={anchor} onClose={onClose} label={label} width={Math.max(200, anchor.width)}>
      {options.length > 7 ? (
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={move}
          placeholder="Search"
          aria-label="Search options"
          className="aw-pop__search"
        />
      ) : null}
      <ul
        role="listbox"
        aria-label={label}
        tabIndex={options.length > 7 ? -1 : 0}
        ref={(el) => {
          if (el && options.length <= 7 && document.activeElement !== el) el.focus();
        }}
        onKeyDown={move}
        className="aw-pop__list outline-none"
      >
        {list.map((o, k) => (
          <li key={o.id || "none"} role="option" aria-selected={o.id === value}>
            <button type="button" className={`aw-pop__opt ${k === i ? "is-hot" : ""}`} onMouseEnter={() => setI(k)} onClick={() => onPick(o.id)}>
              {o.tone ? <span className={`aw-status ${o.tone}`}>{o.label}</span> : <span>{o.label}</span>}
              {o.id === value ? <span className="aw-pop__check">✓</span> : null}
            </button>
          </li>
        ))}
        {!list.length ? <li className="px-3 py-2 text-[12px] text-muted">No match</li> : null}
      </ul>
    </Pop>
  );
}

/** A month to pick a date from, in Arrowsterr's style. */
export function DatePop({ anchor, value, onPick, onClose, label, clear = "Clear date" }: { anchor: DOMRect; value: string; onPick: (v: string | null) => void; onClose: () => void; label: string; clear?: string | null }) {
  const start = value ? new Date(`${value}T00:00:00`) : new Date();
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const today = iso(new Date());
  return (
    <Pop anchor={anchor} onClose={onClose} label={label} width={264}>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <button type="button" className="aw-pop__nav" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          ‹
        </button>
        <span className="text-[13px] font-medium text-ink">
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button type="button" className="aw-pop__nav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-2 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[11px] text-muted">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const k = iso(d);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPick(k)}
              className={`aw-pop__day ${d.getMonth() === month.getMonth() ? "" : "is-out"} ${k === value ? "is-on" : ""} ${k === today ? "is-today" : ""}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-rule-faint px-2 pt-2">
        <button type="button" className="aw-text-link text-[12px]" onClick={() => onPick(today)}>
          Today
        </button>
        {clear ? (
          <button type="button" className="aw-text-link text-[12px] text-neg!" onClick={() => onPick(null)}>
            {clear}
          </button>
        ) : null}
      </div>
    </Pop>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="aw-dropdown__chev">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** A field-like button that opens a pop-up below it, and closes it again on a second click. */
function PickerButton({
  label,
  className,
  disabled,
  title,
  popup,
  children,
  pop,
}: {
  label: string;
  className: string;
  disabled?: boolean;
  title?: string;
  popup: "listbox" | "dialog";
  children: React.ReactNode;
  pop: (anchor: DOMRect, close: () => void) => React.ReactNode;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [closedAt, setClosedAt] = useState(0);
  const close = () => {
    setClosedAt(Date.now());
    setRect(null);
    btn?.focus();
  };
  // The click that closed it from outside should not open it again.
  const toggle = () => {
    if (rect || Date.now() - closedAt < 250) close();
    else if (btn) setRect(btn.getBoundingClientRect());
  };
  return (
    <>
      <button
        ref={setBtn}
        type="button"
        disabled={disabled}
        aria-haspopup={popup}
        aria-expanded={Boolean(rect)}
        aria-label={label}
        title={title}
        className={`aw-dropdown ${className}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (!rect && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {children}
      </button>
      {rect ? pop(rect, close) : null}
    </>
  );
}

/**
 * A dropdown in Arrowsterr's style, in place of the browser's own. className styles the button like the
 * field it replaces. Options with an empty id work, like "None".
 */
export function Dropdown<V extends string | number>({
  value,
  options,
  onChange,
  label,
  className = "aw-dropdown--field",
  disabled,
  placeholder = "Choose",
}: {
  value: V;
  options: { id: V; label: string; tone?: string }[];
  onChange: (v: V) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <PickerButton
      label={label}
      className={className}
      disabled={disabled}
      title={current?.label}
      popup="listbox"
      pop={(anchor, close) => (
        <SelectPop
          anchor={anchor}
          label={label}
          options={options.map((o) => ({ id: String(o.id), label: o.label, tone: o.tone }))}
          value={String(value)}
          onPick={(id) => {
            const o = options.find((x) => String(x.id) === id);
            close();
            if (o && o.id !== value) onChange(o.id);
          }}
          onClose={close}
        />
      )}
    >
      <span className={`truncate ${current ? "" : "text-muted"}`}>{current?.label ?? placeholder}</span>
      <Chevron />
    </PickerButton>
  );
}

/** A date field in Arrowsterr's style, with its own month picker. value is YYYY-MM-DD or empty. */
export function DateField({
  value,
  onChange,
  label,
  className = "aw-dropdown--field",
  disabled,
  placeholder = "Pick a date",
  clearable = true,
}: {
  value: string;
  onChange: (v: string | null) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
}) {
  const shown = value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <PickerButton
      label={label}
      className={className}
      disabled={disabled}
      popup="dialog"
      pop={(anchor, close) => (
        <DatePop
          anchor={anchor}
          label={label}
          value={value}
          clear={clearable ? "Clear date" : null}
          onPick={(v) => {
            close();
            onChange(v);
          }}
          onClose={close}
        />
      )}
    >
      <span className={`truncate ${shown ? "" : "text-muted"}`}>{shown || placeholder}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="aw-dropdown__chev">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </PickerButton>
  );
}
