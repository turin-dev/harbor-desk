import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EventEnvelope } from "@harbor/contracts";
import { gateway, getGatewayWebSocketUrl } from "../api/client.js";
import { useUiStore } from "./ui-store.js";
import {
  isEventForHost,
  resourceQueryKey,
  ReconnectSchedule,
  stableConnectionResetMs,
} from "./event-stream.js";

function invalidateResource(
  queryClient: ReturnType<typeof useQueryClient>,
  hostId: string,
  resourceKind: string,
): void {
  const queryKey = resourceQueryKey(resourceKind);

  if (queryKey)
    void queryClient.invalidateQueries({ queryKey: [queryKey, hostId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
  void queryClient.invalidateQueries({ queryKey: ["hosts"] });
}

export function useRemoteEventStream(hostId?: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hostId) return undefined;

    let closed = false;
    let retryTimer: number | undefined;
    const schedule = new ReconnectSchedule();
    let cursor: string | undefined;
    let socket: WebSocket | undefined;
    let connecting = false;
    let stableTimer: number | undefined;

    const scheduleReconnect = () => {
      if (closed || retryTimer !== undefined) return;
      const delay = schedule.arm();
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (closed || connecting) return;
      connecting = true;
      try {
        const ticket = await gateway
          .getWebSocketTicket()
          .catch(() => undefined);
        if (closed) return;

        const socketUrl = await getGatewayWebSocketUrl(
          hostId,
          cursor,
          ticket?.ticket,
        );
        if (closed) return;
        const nextSocket = new WebSocket(socketUrl);
        socket = nextSocket;
        nextSocket.onopen = () => {
          if (stableTimer !== undefined) window.clearTimeout(stableTimer);
          stableTimer = window.setTimeout(() => {
            stableTimer = undefined;
            if (socket === nextSocket) schedule.reset();
          }, stableConnectionResetMs);
        };
        nextSocket.onmessage = (message) => {
          try {
            const event = JSON.parse(String(message.data)) as EventEnvelope;
            if (!isEventForHost(event, hostId)) return;
            cursor = event.cursor;
            if (useUiStore.getState().showConnectionNotifications)
              useUiStore.getState().addNotification(event);
            invalidateResource(queryClient, hostId, event.resourceKind);
          } catch {
            // Ignore malformed event frames; a later valid cursor can still resume the stream.
          }
        };
        nextSocket.onerror = () => nextSocket.close();
        nextSocket.onclose = () => {
          if (socket !== nextSocket) return;
          if (stableTimer !== undefined) {
            window.clearTimeout(stableTimer);
            stableTimer = undefined;
          }
          socket = undefined;
          scheduleReconnect();
        };
      } catch {
        if (!closed) scheduleReconnect();
      } finally {
        connecting = false;
      }
    };

    void connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (stableTimer !== undefined) window.clearTimeout(stableTimer);
      socket?.close();
    };
  }, [hostId, queryClient]);
}
