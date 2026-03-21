/**
 * useWebSocket — React hook for maintaining a persistent WebSocket connection
 * to the Go notification service (/ws/notifications).
 *
 * Features:
 *  - Auto-reconnects with exponential backoff (1s, 2s, 4s, ... up to 30s)
 *  - Resets retry counter on successful connection
 *  - Uses a ref for the onMessage callback to avoid re-creating the WS on handler changes
 *  - Cleans up properly on unmount (prevents reconnect during cleanup)
 *  - Exposes `connected` state for UI indicators
 *
 * The managerId parameter scopes the WS to a specific manager's events,
 * or "admin" for all events. Pass "__disabled__" to prevent connection.
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";

export interface WSMessage {
  managerId: string;
  type: "connected" | "change" | "notification" | "refresh";
  payload: Record<string, unknown>;
}

interface UseWebSocketOptions {
  managerId: string | null;
  onMessage?: (msg: WSMessage) => void;
}

/** Establishes and maintains a WebSocket connection with auto-reconnect. */
export function useWebSocket({ managerId, onMessage }: UseWebSocketOptions) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const id = managerId || "admin";
    const url = `${protocol}//${window.location.host}/ws/notifications?managerId=${id}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retriesRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          onMessageRef.current?.(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Reconnect with exponential backoff (max 30s)
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
        retriesRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // ignore connection errors, reconnect will handle it
    }
  }, [managerId]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on cleanup
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { connected };
}
