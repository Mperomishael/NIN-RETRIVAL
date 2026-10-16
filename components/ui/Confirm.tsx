"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Modal } from "./Modal";

export type ConfirmOptions = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: "default" | "danger" };

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const last = useRef<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>(resolve => {
    last.current = next;
    resolver.current = resolve;
    setOptions(next);
  }), []);

  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const shown = options ?? last.current;
  const danger = shown?.tone === "danger";
  const dialog = (
    <Modal
      open={options !== null}
      onClose={() => settle(false)}
      size="sm"
      title={shown?.title ?? ""}
      icon={danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
      footer={
        <>
          <button type="button" className="tv-button-secondary" onClick={() => settle(false)}>{shown?.cancelLabel ?? "Cancel"}</button>
          <button type="button" className={danger ? "tv-button-danger" : "tv-button-primary"} onClick={() => settle(true)}>{shown?.confirmLabel ?? "Confirm"}</button>
        </>
      }
    >
      <p className="tv-confirm-text">{shown?.message}</p>
    </Modal>
  );
  return { confirm, dialog };
}
