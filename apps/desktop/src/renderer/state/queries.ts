import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContainerCreateInput,
  HubSearchResponse,
  PruneResourceKind,
  NetworkAttachInput,
  NetworkCreateInput,
  VolumeCreateInput,
} from "@harbor/contracts";
import { desktopConnection, gateway } from "../api/client.js";
import {
  defaultAuditLimit,
  defaultDeleteForce,
  defaultPruneAll,
  operationRefetchInterval,
  withDefaultOperationId,
} from "./query-policy.js";

export function useConnectionStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["connection-status"],
    queryFn: desktopConnection.getStatus,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    const unsubscribe = window.harbor?.connection.onChanged((status) => {
      queryClient.setQueryData(["connection-status"], status);
      if (status.mode !== "detecting") {
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== "connection-status",
        });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}

export function useGatewayHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: gateway.getHealth,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

export function useHosts() {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: gateway.getHosts,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retryOnMount: false,
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: gateway.getCurrentUser,
    retry: false,
    retryOnMount: false,
  });
}

export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth-providers"],
    queryFn: gateway.getAuthProviders,
    staleTime: 60_000,
    retry: false,
  });
}

export function useDashboard(hostId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard", hostId],
    queryFn: () => gateway.getDashboard(hostId!),
    enabled: Boolean(hostId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

export function useContainers(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["containers", hostId],
    queryFn: () => gateway.getContainers(hostId!),
    enabled: Boolean(hostId) && enabled,
  });
}

export function useCreateContainer(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContainerCreateInput) =>
      gateway.createContainer(hostId!, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["containers", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useContainerInspect(
  hostId: string | undefined,
  containerId: string | undefined,
) {
  return useQuery({
    queryKey: ["container-inspect", hostId, containerId],
    queryFn: () => gateway.getContainerInspect(hostId!, containerId!),
    enabled: Boolean(hostId && containerId),
  });
}

export function useContainerLogs(
  hostId: string | undefined,
  containerId: string | undefined,
) {
  return useQuery({
    queryKey: ["container-logs", hostId, containerId],
    queryFn: () => gateway.getContainerLogs(hostId!, containerId!),
    enabled: Boolean(hostId && containerId),
    staleTime: 2_000,
  });
}

export function useContainerStats(
  hostId: string | undefined,
  containerId: string | undefined,
) {
  return useQuery({
    queryKey: ["container-stats", hostId, containerId],
    queryFn: () => gateway.getContainerStats(hostId!, containerId!),
    enabled: Boolean(hostId && containerId),
    staleTime: 2_000,
  });
}

export function useImages(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["images", hostId],
    queryFn: () => gateway.getImages(hostId!),
    enabled: Boolean(hostId) && enabled,
  });
}

export function useImageInspect(
  hostId: string | undefined,
  imageId: string | undefined,
) {
  return useQuery({
    queryKey: ["image-inspect", hostId, imageId],
    queryFn: () => gateway.getImageInspect(hostId!, imageId!),
    enabled: Boolean(hostId && imageId),
  });
}

export function useDeleteImage(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ imageId, force }: { imageId: string; force?: boolean }) =>
      gateway.deleteImage(hostId!, imageId, force),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function usePullImage(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { image: string; operationId?: string }) => {
      const operationId = withDefaultOperationId(input.operationId);
      return gateway.pullImage(hostId!, { image: input.image }, operationId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useBuildImage(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      image: import("@harbor/contracts").ImageBuildInput;
      operationId?: string;
    }) => {
      const operationId = withDefaultOperationId(input.operationId);
      return gateway.buildImage(hostId!, input.image, operationId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useScanImage(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      image: string;
      scannerImage?: string;
      severities?: string;
      operationId?: string;
    }) => {
      const operationId = withDefaultOperationId(input.operationId);
      return gateway.scanImage(
        hostId!,
        {
          image: input.image,
          ...(input.scannerImage ? { scannerImage: input.scannerImage } : {}),
          ...(input.severities ? { severities: input.severities } : {}),
        },
        operationId,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useCancelOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (operationId: string) => gateway.cancelOperation(operationId),
    onSuccess: (_operation, operationId) =>
      queryClient.invalidateQueries({ queryKey: ["operation", operationId] }),
  });
}

export function useOperation(operationId: string | undefined) {
  const query = useQuery({
    queryKey: ["operation", operationId],
    queryFn: () => gateway.getOperation(operationId!),
    enabled: Boolean(operationId),
    refetchInterval: (query) =>
      operationRefetchInterval(query.state.data?.status),
    refetchOnWindowFocus: false,
  });

  return query.data;
}

export function useScanReport(
  hostId: string | undefined,
  operationId: string | undefined,
) {
  return useQuery({
    queryKey: ["scan-report", hostId, operationId],
    queryFn: () => gateway.getScanReport(hostId!, operationId!),
    enabled: Boolean(hostId && operationId),
    retry: false,
  });
}

export function useHubSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ["hub-search", query],
    queryFn: () => gateway.searchHub(query),
    enabled: enabled && query.trim().length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

export function usePruneResources(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      all,
      operationId,
    }: {
      kind: PruneResourceKind;
      all?: boolean;
      operationId?: string;
    }) =>
      gateway.pruneResources(hostId!, kind, defaultPruneAll(all), operationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["containers", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useAudit(limit?: number) {
  return useQuery({
    queryKey: ["audit", limit],
    queryFn: () => gateway.getAudit(defaultAuditLimit(limit)),
    refetchOnWindowFocus: false,
  });
}

export function useVolumes(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["volumes", hostId],
    queryFn: () => gateway.getVolumes(hostId!),
    enabled: Boolean(hostId) && enabled,
  });
}

export function useVolumeInspect(
  hostId: string | undefined,
  volumeName: string | undefined,
) {
  return useQuery({
    queryKey: ["volume-inspect", hostId, volumeName],
    queryFn: () => gateway.getVolumeInspect(hostId!, volumeName!),
    enabled: Boolean(hostId && volumeName),
  });
}

export function useVolumeBrowse(
  hostId: string | undefined,
  volumeName: string | undefined,
  path: string,
) {
  return useQuery({
    queryKey: ["volume-browse", hostId, volumeName, path],
    queryFn: () => gateway.browseVolume(hostId!, volumeName!, path),
    enabled: Boolean(hostId && volumeName && path),
    refetchOnWindowFocus: false,
  });
}

export function useCreateVolume(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: VolumeCreateInput) =>
      gateway.createVolume(hostId!, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useDeleteVolume(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      volumeName,
      force,
    }: {
      volumeName: string;
      force?: boolean;
    }) => gateway.deleteVolume(hostId!, volumeName, force),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useNetworks(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["networks", hostId],
    queryFn: () => gateway.getNetworks(hostId!),
    enabled: Boolean(hostId) && enabled,
  });
}

export function useNetworkInspect(
  hostId: string | undefined,
  networkId: string | undefined,
) {
  return useQuery({
    queryKey: ["network-inspect", hostId, networkId],
    queryFn: () => gateway.getNetworkInspect(hostId!, networkId!),
    enabled: Boolean(hostId && networkId),
  });
}

export function useCreateNetwork(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NetworkCreateInput) =>
      gateway.createNetwork(hostId!, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useDeleteNetwork(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (networkId: string) =>
      gateway.deleteNetwork(hostId!, networkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useNetworkConnect(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      networkId,
      input,
    }: {
      networkId: string;
      input: NetworkAttachInput;
    }) => gateway.connectNetwork(hostId!, networkId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
      await queryClient.invalidateQueries({
        queryKey: ["network-inspect", hostId],
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useNetworkDisconnect(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      networkId,
      containerId,
    }: {
      networkId: string;
      containerId: string;
    }) => gateway.disconnectNetwork(hostId!, networkId, containerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
      await queryClient.invalidateQueries({
        queryKey: ["network-inspect", hostId],
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useContainerAction(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      containerId,
      action,
    }: {
      containerId: string;
      action: string;
    }) => gateway.containerAction(hostId!, containerId, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["containers", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useDeleteContainer(hostId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      containerId,
      force,
    }: {
      containerId: string;
      force?: boolean;
    }) =>
      gateway.deleteContainer(hostId!, containerId, defaultDeleteForce(force)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["containers", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
  });
}

export function useAddHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gateway.addHost,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["hosts"] }),
  });
}

export function useTestHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gateway.testHost,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["hosts"] }),
  });
}

export function useRemoveHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hostId: string) => gateway.removeHost(hostId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["hosts"] });
    },
  });
}
