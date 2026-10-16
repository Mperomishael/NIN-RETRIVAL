"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({ open, onClose, title, subtitle, icon, size = "md", busy = false, children, footer }: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => { setHost(document.querySelector(".tv-app") ?? document.body); }, []);

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => { setMounted(false); setClosing(false); }, 200);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => panel.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus?.();
    };
  }, [mounted]);

  if (!mounted || !host) return null;

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return createPortal(
    <div className={closing ? "tv-modal-root tv-modal-closing" : "tv-modal-root"}>
      <div className="tv-modal-backdrop" onMouseDown={() => { if (!busy) onClose(); }} />
      <div ref={panel} className={`tv-modal tv-modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="tv-modal-head">
          {icon && <span className="tv-modal-icon">{icon}</span>}
          <div className="tv-modal-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="tv-modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="tv-modal-body">{children}</div>
        {footer && <footer className="tv-modal-foot">{footer}</footer>}
      </div>
    </div>,
    host
  );
}
