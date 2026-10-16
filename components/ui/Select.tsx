"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; hint?: string };

type SelectProps = {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
};

export function Select({ label, value, options, onChange, disabled, placeholder = "Select", compact }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const selected = options.find(o => o.value === value);

  function openList() {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      const flip = below < 240 && rect.top > below;
      setPos({ left: rect.left, width: rect.width, ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    const box = list.current;
    const item = box?.children[active] as HTMLElement | undefined;
    if (!open || !box || !item) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
  }, [active, open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div className={compact ? "tv-field tv-field-compact" : "tv-field"}>
      {label && <span className="tv-field-label" id={labelId}>{label}</span>}
      <button
        ref={trigger}
        type="button"
        className={open ? "tv-select tv-select-open" : "tv-select"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? labelId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? "" : "tv-select-placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <>
          <div className="tv-select-scrim" onMouseDown={() => setOpen(false)} />
          <ul ref={list} className="tv-select-pop" role="listbox" aria-labelledby={label ? labelId : undefined} style={pos ?? undefined}>
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={index === active ? "tv-select-option tv-select-active" : "tv-select-option"}
                onMouseEnter={() => setActive(index)}
                onMouseDown={e => { e.preventDefault(); choose(index); }}
              >
                <span>{option.label}{option.hint && <small>{option.hint}</small>}</span>
                {option.value === value && <Check size={16} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
