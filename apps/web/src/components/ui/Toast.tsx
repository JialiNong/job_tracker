"use client";
/** One toast at a time, bottom of the page (styles: .toast in job_list.css). */
import { createContext, use, useRef, useState, type ReactNode } from "react";

type Kind = "ok" | "err";
type Show = (message: string, kind?: Kind, ms?: number) => void;

const ToastContext = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: Kind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show: Show = (message, kind = "ok", ms = 2500) => {
    clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => setToast(null), ms);
  };

  return (
    <ToastContext value={show}>
      {children}
      <div className={toast ? `toast ${toast.kind} show` : "toast"} id="toast" role="status" aria-live="polite">
        {toast?.message}
      </div>
    </ToastContext>
  );
}

export const useToast = () => use(ToastContext);
