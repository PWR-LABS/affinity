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
  fetchSuggestions: (q: string, signal?: AbortSignal) => Promise<Suggestion[]>;
  onSelect: (s: Suggestion) => void;
  describedBy?: string;
  disabled?: boolean;
  initialQuery?:string;
  onQueryChange?:()=>void;
}

/** Accessible combobox: debounced server lookup, keyboard nav, ARIA listbox. Clears after select. */
export function Typeahead({ label, placeholder, fetchSuggestions, onSelect, describedBy, disabled = false, initialQuery='',onQueryChange }: TypeaheadProps) {
  const id = useId();
  const [q, setQ] = useState(initialQuery);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const myReq=++reqId.current;
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
    setItems([]);setOpen(false);setActive(-1);setFailed(false);
    if (disabled || q.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const ac = new AbortController();
      controller.current = ac;
      try {
        const res = await fetchSuggestions(q.trim(), ac.signal);
        if (myReq === reqId.current && !ac.signal.aborted) {
          setItems(res);
          setOpen(true);
          setActive(res.length ? 0 : -1);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError" || ac.signal.aborted) return;
        if (myReq === reqId.current) {
          setItems([]);
          setOpen(false);
          setActive(-1);
          setFailed(true);
        }
      } finally {
        if (myReq === reqId.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
      controller.current = null;
      if(myReq===reqId.current)reqId.current++;
    };
  }, [q, fetchSuggestions, disabled]);

  function choose(s: Suggestion) {
    onSelect(s);
    setQ("");
    setItems([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
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
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          value={q}
          onChange={(e) => {setQ(e.target.value);onQueryChange?.();}}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => items.length && setOpen(true)}
        />
        {loading && <span className="typeahead-spin" aria-hidden />}
      </div>
      {failed && <p className="field-help" role="status">Search is temporarily unavailable. Try again in a moment.</p>}
      {open && (items.length > 0 || (!loading && q.trim().length >= 2)) && (
        <ul className="typeahead-menu" id={listId} role="listbox">
          {items.length > 0 ? (
            items.map((s, i) => (
              <li
                id={`${listId}-${i}`}
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
