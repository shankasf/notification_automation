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

let _addToast: ((title: string, description: string) => void) | null = null;

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
