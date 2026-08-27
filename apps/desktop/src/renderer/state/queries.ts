import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContainerCreateInput,
  NetworkCreateInput,
  VolumeCreateInput,
} from "@harbor/contracts";
import { gateway } from "../api/client.js";

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
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: gateway.getCurrentUser,
    retry: false,
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
    mutationFn: (image: string) => gateway.pullImage(hostId!, { image }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["images", hostId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", hostId] });
    },
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
    }) => gateway.deleteContainer(hostId!, containerId, force ?? false),
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
