"use client";
/**
 * Modal dialogs as promises: `await confirm({...})` -> true / false,
 * `await askTime({...})` -> "YYYY-MM-DD HH:MM" or null. Same markup and
 * classes as the old page (.tl-modal-backdrop / .tl-modal / .tl-confirm).
 *
 * Closing the dialog leaves a transparent click shield for a moment so the
 * same tap/click cannot hit Undo (or anything else) under the Save button.
 * The time picker is a <form> that preventDefault, so Enter / the native
 * datetime control cannot navigate the page.
 */
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { fromInputValue, nowInputValue } from "@/lib/tracker/timeline";

const GHOST_CLICK_MS = 400;

interface ConfirmOptions {
  title: string;
  hint?: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface TimeOptions {
  title: string;
  hint?: string;
  initial?: string; // datetime-local value
}

type Open =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "time"; options: TimeOptions; resolve: (at: string | null) => void };

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  askTime: (options: TimeOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [shield, setShield] = useState(false);
  const shieldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setOpen({ kind: "confirm", options, resolve }));
  const askTime = (options: TimeOptions) =>
    new Promise<string | null>((resolve) => setOpen({ kind: "time", options, resolve }));

  const close = (value: boolean | string | null) => {
    if (!open) return;
    setOpen(null);
    setShield(true);
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    shieldTimer.current = setTimeout(() => setShield(false), GHOST_CLICK_MS);
    if (open.kind === "confirm") open.resolve(value === true);
    else open.resolve(typeof value === "string" ? value : null);
  };

  useEffect(() => () => {
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
  }, []);

  return (
    <DialogContext value={{ confirm, askTime }}>
      {children}
      {open?.kind === "confirm" && <ConfirmDialog options={open.options} onClose={close} />}
      {open?.kind === "time" && <TimeDialog options={open.options} onClose={close} />}
      {shield ? (
        <div
          aria-hidden="true"
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0)" }}
        />
      ) : null}
    </DialogContext>
  );
}

export function useDialog(): DialogApi {
  const api = use(DialogContext);
  if (!api) throw new Error("useDialog needs <DialogProvider>");
  return api;
}

function Backdrop({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div
      className="tl-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div className="tl-modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (v: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  return (
    <Backdrop onCancel={() => onClose(false)}>
      <h3>{options.title}</h3>
      {options.hint ? <p>{options.hint}</p> : null}
      {options.detail ? <div className="tl-job-name">{options.detail}</div> : null}
      <div className="tl-modal-actions">
        <button type="button" className="tl-cancel" onClick={() => onClose(false)}>Cancel</button>
        <button
          type="button" ref={confirmRef}
          className={options.danger ? "tl-confirm tl-danger" : "tl-confirm"}
          onClick={() => onClose(true)}
        >
          {options.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Backdrop>
  );
}

function TimeDialog({ options, onClose }: { options: TimeOptions; onClose: (v: string | null) => void }) {
  const [value, setValue] = useState(options.initial || nowInputValue());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const save = () => onClose(value ? fromInputValue(value) : null);
  return (
    <Backdrop onCancel={() => onClose(null)}>
      <form
        style={{ display: "contents" }}
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <h3>{options.title}</h3>
        <p>{options.hint || "Pick the date and time for this step"}</p>
        <input
          ref={inputRef} type="datetime-local" id="tlDatetimeInput"
          value={value} onChange={(e) => setValue(e.target.value)}
        />
        <div className="tl-modal-actions">
          <button type="button" className="tl-cancel" onClick={() => onClose(null)}>Cancel</button>
          <button type="submit" className="tl-confirm">Save</button>
        </div>
      </form>
    </Backdrop>
  );
}
