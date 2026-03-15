"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { useWebSocket, type WSMessage } from "./use-websocket";

interface LiveUpdatesContextValue {
  connected: boolean;
  /** Increments on every "change" event — pages watch this to refetch */
  changeSequence: number;
  /** Increments on every "notification" event */
  notificationSequence: number;
  /** Increments when user marks notifications as read — layout watches this to update badge */
  readSequence: number;
  markNotificationsRefreshed: () => void;
  /** The latest WebSocket message received */
  lastMessage: WSMessage | null;
}

const LiveUpdatesContext = createContext<LiveUpdatesContextValue>({
  connected: false,
  changeSequence: 0,
  notificationSequence: 0,
  readSequence: 0,
  markNotificationsRefreshed: () => {},
  lastMessage: null,
});

/** Hook to access live update counters (WebSocket-powered). */
export function useLiveUpdates() {
  return useContext(LiveUpdatesContext);
}

// Backward-compat alias — prefer useLiveUpdates() in new code
export const useWS = useLiveUpdates;

interface LiveUpdatesProviderProps {
  managerId: string | null;
  onToast?: (title: string, message: string) => void;
  children: React.ReactNode;
}

export function LiveUpdatesProvider({ managerId, onToast, children }: LiveUpdatesProviderProps) {
  const [changeSequence, setChangeSequence] = useState(0);
  const [notificationSequence, setNotificationSequence] = useState(0);
  const [readSequence, setReadSequence] = useState(0);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const markNotificationsRefreshed = useCallback(() => setReadSequence((s) => s + 1), []);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  const handleMessage = useCallback((msg: WSMessage) => {
    setLastMessage(msg);

    if (msg.type === "change") {
      setChangeSequence((s) => s + 1);
      const payload = msg.payload as { message?: string; requisitionId?: string };
      onToastRef.current?.(
        "Request Updated",
        payload.message || `${payload.requisitionId || "A request"} was changed`
      );
    }

    if (msg.type === "notification") {
      setNotificationSequence((s) => s + 1);
      const payload = msg.payload as { title?: string; message?: string };
      onToastRef.current?.(
        payload.title || "New Notification",
        payload.message || "You have a new notification"
      );
    }

    if (msg.type === "refresh") {
      setChangeSequence((s) => s + 1);
      setNotificationSequence((s) => s + 1);
    }
  }, []);

  const { connected } = useWebSocket({ managerId, onMessage: handleMessage });

  return (
    <LiveUpdatesContext.Provider value={{ connected, changeSequence, notificationSequence, readSequence, markNotificationsRefreshed, lastMessage }}>
      {children}
    </LiveUpdatesContext.Provider>
  );
}
