/**
 * Toaster — global toast notification system.
 *
 * Exposes a `showToast(title, description)` function that can be called from
 * anywhere (not just React components) to display a popup notification. This
 * works by storing the add-toast callback in a module-level variable that the
 * Toaster component sets on mount.
 *
 * Used by the dashboard layout to surface WebSocket-driven notifications
 * (e.g., "Request Updated", "New Notification") as transient toasts.
 */
"use client";

import { useState, useCallback } from "react";
import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "@/app/components/ui/toast";

interface ToastItem {
  id: number;
  title: string;
  description: string;
}

// Module-level ref so showToast() can be called from outside React tree
let _addToast: ((title: string, description: string) => void) | null = null;

/** Imperatively show a toast from anywhere — requires <Toaster /> to be mounted. */
export function showToast(title: string, description: string) {
  _addToast?.(title, description);
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useCallback(() => Date.now() + Math.random(), []);

  _addToast = useCallback(
    (title: string, description: string) => {
      setToasts((prev) => [...prev, { id: nextId(), title, description }]);
    },
    [nextId]
  );

  return (
    <ToastProvider duration={5000}>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          onOpenChange={(open) => {
            if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
        >
          <div className="flex-1">
            <ToastTitle>{t.title}</ToastTitle>
            <ToastDescription>{t.description}</ToastDescription>
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
