"use client";
/** Client-side providers shared by every page: server-state cache, toasts, dialogs. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DialogProvider } from "./ui/Dialog";
import { ToastProvider } from "./ui/Toast";

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser tab (useState keeps it across re-renders, not shared between requests)
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: true, retry: 1 },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
