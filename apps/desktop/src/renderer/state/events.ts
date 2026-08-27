import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EventEnvelope } from "@harbor/contracts";
import { gateway, getGatewayWebSocketUrl } from "../api/client.js";
import { useUiStore } from "./ui-store.js";

function invalidateResource(
  queryClient: ReturnType<typeof useQueryClient>,
  hostId: string,
  resourceKind: string,
): void {
  const kind = resourceKind.toLowerCase();
  const queryKey =
    kind === "container"
      ? "containers"
      : kind === "image"
        ? "images"
        : kind === "volume"
          ? "volumes"
          : kind === "network"
            ? "networks"
            : undefined;

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
    let retryDelay = 1_000;
    let cursor: string | undefined;
    let socket: WebSocket | undefined;
    let connecting = false;

    const scheduleReconnect = () => {
      if (closed || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    };

    const connect = async () => {
      if (closed || connecting) return;
      connecting = true;
      const ticket = await gateway.getWebSocketTicket().catch(() => undefined);
      connecting = false;
      if (closed) return;

      const nextSocket = new WebSocket(
        getGatewayWebSocketUrl(hostId, cursor, ticket?.ticket),
      );
      socket = nextSocket;
      nextSocket.onopen = () => {
        retryDelay = 1_000;
      };
      nextSocket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as EventEnvelope;
          if (!event.cursor || event.hostId !== hostId) return;
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
        if (socket === nextSocket) socket = undefined;
        scheduleReconnect();
      };
    };

    void connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [hostId, queryClient]);
}
