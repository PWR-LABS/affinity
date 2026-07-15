"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface Suggestion {
  key: string;
  label: string;
  sub?: string;
}

interface TypeaheadProps {
  label: string;
  placeholder?: string;
  fetchSuggestions: (q: string) => Promise<Suggestion[]>;
  onSelect: (s: Suggestion) => void;
  describedBy?: string;
}

/** Accessible combobox: debounced server lookup, keyboard nav, ARIA listbox. Clears after select. */
export function Typeahead({ label, placeholder, fetchSuggestions, onSelect, describedBy }: TypeaheadProps) {
  const id = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const myReq = ++reqId.current;
      try {
        const res = await fetchSuggestions(q.trim());
        if (myReq === reqId.current) {
          setItems(res);
          setOpen(true);
          setActive(res.length ? 0 : -1);
        }
      } finally {
        if (myReq === reqId.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, fetchSuggestions]);

  function choose(s: Suggestion) {
    onSelect(s);
    setQ("");
    setItems([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const listId = `${id}-list`;
  return (
    <div className="typeahead">
      <label htmlFor={id}>{label}</label>
      <div className="typeahead-shell">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          autoComplete="off"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => items.length && setOpen(true)}
        />
        {loading && <span className="typeahead-spin" aria-hidden />}
      </div>
      {open && (items.length > 0 || (!loading && q.trim().length >= 2)) && (
        <ul className="typeahead-menu" id={listId} role="listbox">
          {items.length > 0 ? (
            items.map((s, i) => (
              <li
                key={s.key}
                role="option"
                aria-selected={i === active}
                className="typeahead-item"
                data-active={i === active ? "1" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="typeahead-item-label">{s.label}</span>
                {s.sub && <span className="typeahead-item-sub">{s.sub}</span>}
              </li>
            ))
          ) : (
            <li className="typeahead-empty" role="option" aria-disabled="true">
              No matches — check the spelling, or try a different name.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
