import { useMemo, useState, type ReactNode } from "react";
import {
  Add,
  Check,
  CloudDownload,
  Close,
  ContentCopy,
  DeleteOutline,
  Image as ImageIcon,
  Lan,
  Refresh,
  Search,
  Storage,
  CleaningServices,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  Host,
  ImageSummary,
  NetworkSummary,
  Operation,
  PruneResourceKind,
  VolumeSummary,
} from "@harbor/contracts";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  useCreateNetwork,
  useCancelOperation,
  useCreateVolume,
  useCurrentUser,
  useDeleteImage,
  useDeleteNetwork,
  useDeleteVolume,
  useHosts,
  useImageInspect,
  useImages,
  usePullImage,
  useNetworkInspect,
  useNetworks,
  useOperation,
  usePruneResources,
  useVolumeInspect,
  useVolumes,
} from "../state/queries.js";
import { formatBytes, formatDate } from "../format.js";
import { useUiStore } from "../state/ui-store.js";
import { filterRowsByQuery } from "../filter-rows.js";

type ResourceKind = "images" | "volumes" | "networks";

function copyValue(
  value: string,
  showToast: (message: string, severity?: "success" | "error") => void,
) {
  void navigator.clipboard
    ?.writeText(value)
    .then(() => showToast("Copied to clipboard.", "success"))
    .catch(() => showToast("Clipboard access was unavailable.", "error"));
}

export function ResourceScreen({ kind }: { kind: ResourceKind }) {
  const { data: hosts = [] } = useHosts();
  const storedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost =
    hosts.find((host) => host.id === storedHostId) ?? hosts[0];
  const selectedHostId = selectedHost?.id;
  const title = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;

  if (!hosts.length)
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow="Workspace"
          title={title}
          description={`Manage ${title.toLowerCase()} on a remote Engine.`}
        />
        <EmptyState
          title="No remote host"
          description="Add a remote host before opening this view."
        />
      </Box>
    );

  const capability: keyof Host["capabilities"] =
    kind === "images" ? "images" : kind === "volumes" ? "volumes" : "networks";
  if (selectedHost && !selectedHost.capabilities[capability])
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow={`Workspace / ${title}`}
          title={title}
          description={`Manage ${title.toLowerCase()} on a remote Engine.`}
        />
        <EmptyState
          title="Capability unavailable"
          description={`The selected host does not advertise the ${capability} capability. Harbor Desk will not use a local fallback or show simulated resources.`}
        />
      </Box>
    );

  if (kind === "images") return <ImagesView hostId={selectedHostId} />;
  if (kind === "volumes") return <VolumesView hostId={selectedHostId} />;
  return <NetworksView hostId={selectedHostId} />;
}

function ImagesView({ hostId }: { hostId?: string }) {
  const { data: hosts = [] } = useHosts();
  const host = hosts.find((item) => item.id === hostId);
  const hostOnline = host?.status === "online";
  const query = useImages(
    hostId,
    hostOnline && (host?.capabilities.images ?? false),
  );
  const pull = usePullImage(hostId);
  const cancel = useCancelOperation();
  const remove = useDeleteImage(hostId);
  const prune = usePruneResources(hostId);
  const { data: user } = useCurrentUser();
  const showToast = useUiStore((state) => state.showToast);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ImageSummary>();
  const [deleteTarget, setDeleteTarget] = useState<ImageSummary>();
  const [pullOpen, setPullOpen] = useState(false);
  const [pullReference, setPullReference] = useState("");
  const [pullError, setPullError] = useState<string>();
  const [pullOperationId, setPullOperationId] = useState<string>();
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneAll, setPruneAll] = useState(false);
  const [pruneOperationId, setPruneOperationId] = useState<string>();
  const pullOperation = useOperation(pullOperationId);
  const pullActive =
    pull.isPending ||
    pullOperation?.status === "queued" ||
    pullOperation?.status === "running";
  const pruneOperation = useOperation(pruneOperationId);
  const pruneActive =
    prune.isPending ||
    pruneOperation?.status === "queued" ||
    pruneOperation?.status === "running";
  const canPrune = (user?.role ?? "viewer") !== "viewer";
  const normalized = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      filterRowsByQuery(
        query.data ?? [],
        (row) => [row.repository, row.tag, row.digest ?? row.id],
        normalized,
      ),
    [normalized, query.data],
  );
  const selectedInspect = useImageInspect(hostId, selected?.id);

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Images"
        title="Images"
        description={`${query.data?.length ?? 0} image tags reported by the selected remote Engine.`}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Refresh
            </Button>
            <Tooltip
              title={
                canPrune
                  ? "Remove unused images from the remote host"
                  : "Operator permission required"
              }
            >
              <span>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CleaningServices />}
                  onClick={() => {
                    setPruneAll(false);
                    setPruneOpen(true);
                  }}
                  disabled={!hostId || !hostOnline || !canPrune || pruneActive}
                >
                  Prune
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<CloudDownload />}
              onClick={() => setPullOpen(true)}
              disabled={!hostId || !hostOnline}
            >
              Pull image
            </Button>
          </Stack>
        }
      />
      <ResourceFilter
        value={filter}
        onChange={setFilter}
        placeholder="Filter by repository, tag, or digest"
        count={rows.length}
      />
      {host && !hostOnline && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {host.displayName} is {host.status}. Showing the last cached image
          snapshot, if available. Mutations are disabled until it is online.
        </Alert>
      )}
      {query.isError ? (
        <ResourceError
          icon={<ImageIcon />}
          title="Images"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Remote images">
            <TableHead>
              <TableRow>
                <TableCell>Repository</TableCell>
                <TableCell>Tag</TableCell>
                <TableCell>Digest / ID</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : rows.length ? (
                rows.map((row) => (
                  <TableRow
                    hover
                    key={`${row.id}-${row.tag}`}
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(row);
                      }
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 650 }}>
                      {row.repository}
                    </TableCell>
                    <TableCell>{row.tag}</TableCell>
                    <TableCell>
                      <CopyCell
                        value={row.digest ?? row.id}
                        onCopy={(value) => copyValue(value, showToast)}
                      />
                    </TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell align="right">
                      {formatBytes(row.sizeBytes)}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove image">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(row);
                          }}
                          disabled={!hostOnline || remove.isPending}
                          aria-label={`Remove image ${row.repository}:${row.tag}`}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  colSpan={6}
                  label={
                    filter
                      ? "No images match this filter."
                      : hostOnline
                        ? "No images reported by this host."
                        : "No cached images are available while this host is offline."
                  }
                />
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ResourceDetailDrawer
        open={Boolean(selected)}
        title={
          selected ? `${selected.repository}:${selected.tag}` : "Image details"
        }
        subtitle={selected?.id}
        icon={<ImageIcon />}
        query={selectedInspect}
        onClose={() => setSelected(undefined)}
        onCopy={(value) => copyValue(value, showToast)}
      />
      <Dialog
        open={pullOpen}
        onClose={() => !pullActive && setPullOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Pull image to remote host</DialogTitle>
        <DialogContent>
          <Stack spacing={1.4} sx={{ pt: 1 }}>
            {pullError && <Alert severity="error">{pullError}</Alert>}
            {pullOperation?.status === "cancelled" && (
              <Alert severity="info">
                Image pull cancelled. The download was aborted on the remote
                host.
              </Alert>
            )}
            <TextField
              label="Image reference"
              placeholder="nginx:alpine"
              value={pullReference}
              onChange={(event) => setPullReference(event.target.value)}
              helperText="The gateway pulls the image through the configured Engine registry access."
              autoFocus
              disabled={pullActive}
            />
            {pullOperation &&
              (pullOperation.status === "queued" ||
                pullOperation.status === "running") && (
                <Stack spacing={1} sx={{ minWidth: 240 }}>
                  <Typography variant="body2" color="text.secondary">
                    {pullOperation.message ??
                      "Pull started. Waiting for registry progress."}
                  </Typography>
                  <LinearProgress
                    variant={
                      typeof pullOperation.progress === "number"
                        ? "determinate"
                        : "indeterminate"
                    }
                    value={pullOperation.progress}
                  />
                </Stack>
              )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (pullActive && pullOperationId) {
                cancel.mutate(pullOperationId, {
                  onSuccess: () => showToast("Image pull cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The pull could not be cancelled.",
                      "error",
                    ),
                });
                return;
              }
              setPullOpen(false);
            }}
            disabled={cancel.isPending}
          >
            {pullActive ? "Cancel pull" : "Cancel"}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const image = pullReference.trim();
              if (!image) {
                setPullError("An image reference is required.");
                return;
              }
              setPullError(undefined);
              const operationId = crypto.randomUUID();
              setPullOperationId(operationId);
              pull.mutate(
                { image, operationId },
                {
                  onSuccess: (operation) => {
                    setPullOpen(false);
                    setPullReference("");
                    setPullOperationId(undefined);
                    if (operation.status === "succeeded") {
                      showToast(
                        `${image} pulled to the remote host.`,
                        "success",
                      );
                      return;
                    }
                    if (operation.status === "cancelled") {
                      showToast("Image pull cancelled.", "info");
                      return;
                    }
                    showToast(
                      operation.message ?? "Image pull failed.",
                      "error",
                    );
                  },
                  onError: (error) =>
                    setPullError(
                      error instanceof Error
                        ? error.message
                        : "Image pull failed.",
                    ),
                },
              );
            }}
            disabled={pullActive}
          >
            {pull.isPending ? "Pulling\u2026" : "Pull image"}
          </Button>
        </DialogActions>
      </Dialog>
      <PruneDialog
        open={pruneOpen}
        kind="images"
        pending={pruneActive}
        all={pruneAll}
        onAllChange={setPruneAll}
        onClose={
          pruneActive && pruneOperationId
            ? () => {
                cancel.mutate(pruneOperationId, {
                  onSuccess: () => showToast("Prune cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The prune could not be cancelled.",
                      "error",
                    ),
                });
              }
            : () => !prune.isPending && setPruneOpen(false)
        }
        onLabel={pruneActive ? "Cancel prune" : "Cancel"}
        onConfirm={() => {
          const operationId = crypto.randomUUID();
          setPruneOperationId(operationId);
          prune.mutate(
            { kind: "images", all: pruneAll, operationId },
            {
              onSuccess: (operation) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  operation.status === "succeeded"
                    ? "Unused images were pruned on the remote host."
                    : operation.status === "cancelled"
                      ? "Image prune cancelled."
                      : (operation.message ?? "Image prune failed."),
                  operation.status === "succeeded"
                    ? "success"
                    : operation.status === "cancelled"
                      ? "info"
                      : "error",
                );
              },
              onError: (error) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Image prune failed.",
                  "error",
                );
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove image?"
        description={
          deleteTarget
            ? `This removes ${deleteTarget.repository}:${deleteTarget.tag} from the remote host. Containers using the image may prevent removal.`
            : ""
        }
        confirmLabel="Remove image"
        pending={remove.isPending}
        onClose={() => !remove.isPending && setDeleteTarget(undefined)}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(
            { imageId: deleteTarget.id },
            {
              onSuccess: (operation) => {
                setDeleteTarget(undefined);
                showToast(
                  operation.status === "succeeded"
                    ? "Image removed from the remote host."
                    : (operation.message ?? "Image removal failed."),
                  operation.status === "succeeded" ? "success" : "error",
                );
              },
              onError: (error) =>
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Image removal failed.",
                  "error",
                ),
            },
          );
        }}
      />
    </Box>
  );
}

function VolumesView({ hostId }: { hostId?: string }) {
  const { data: hosts = [] } = useHosts();
  const host = hosts.find((item) => item.id === hostId);
  const hostOnline = host?.status === "online";
  const query = useVolumes(
    hostId,
    hostOnline && (host?.capabilities.volumes ?? false),
  );
  const create = useCreateVolume(hostId);
  const remove = useDeleteVolume(hostId);
  const { data: user } = useCurrentUser();
  const prune = usePruneResources(hostId);
  const cancel = useCancelOperation();
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneOperationId, setPruneOperationId] = useState<string>();
  const canPrune = (user?.role ?? "viewer") !== "viewer";
  const pruneOperation = useOperation(pruneOperationId);
  const pruneActive =
    prune.isPending ||
    pruneOperation?.status === "queued" ||
    pruneOperation?.status === "running";
  const showToast = useUiStore((state) => state.showToast);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<VolumeSummary>();
  const [deleteTarget, setDeleteTarget] = useState<VolumeSummary>();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("local");
  const [formError, setFormError] = useState<string>();
  const normalized = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      filterRowsByQuery(
        query.data ?? [],
        (row) => [row.name, row.driver, row.mountpoint ?? ""],
        normalized,
      ),
    [normalized, query.data],
  );
  const selectedInspect = useVolumeInspect(hostId, selected?.name);
  const canDelete = user?.role === "admin";

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("A volume name is required.");
      return;
    }
    setFormError(undefined);
    create.mutate(
      { name: trimmed, driver: driver.trim() || "local" },
      {
        onSuccess: (operation) => {
          setCreateOpen(false);
          setName("");
          showToast(
            operation.status === "succeeded"
              ? "Volume created on the remote host."
              : (operation.message ?? "Volume creation failed."),
            operation.status === "succeeded" ? "success" : "error",
          );
        },
        onError: (error) =>
          setFormError(
            error instanceof Error ? error.message : "Volume creation failed.",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Volumes"
        title="Volumes"
        description={`${query.data?.length ?? 0} persistent volumes reported by the selected remote Engine.`}
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Refresh
            </Button>
            <Tooltip
              title={
                canPrune
                  ? "Remove unused volumes from the remote host"
                  : "Operator permission required"
              }
            >
              <span>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CleaningServices />}
                  onClick={() => setPruneOpen(true)}
                  disabled={!hostId || !hostOnline || !canPrune || pruneActive}
                >
                  Prune
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setCreateOpen(true)}
              disabled={!hostId || !hostOnline}
            >
              Create volume
            </Button>
          </>
        }
      />
      <ResourceFilter
        value={filter}
        onChange={setFilter}
        placeholder="Filter by name, driver, or mountpoint"
        count={rows.length}
      />
      {host && !hostOnline && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {host.displayName} is {host.status}. Showing the last cached volume
          snapshot, if available. Mutations are disabled until it is online.
        </Alert>
      )}
      {query.isError ? (
        <ResourceError
          icon={<Storage />}
          title="Volumes"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Remote volumes">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Driver</TableCell>
                <TableCell>Mountpoint</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.isLoading ? (
                <LoadingRow colSpan={5} />
              ) : rows.length ? (
                rows.map((row) => (
                  <TableRow
                    hover
                    key={row.name}
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(row);
                      }
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 650 }}>{row.name}</TableCell>
                    <TableCell>{row.driver}</TableCell>
                    <TableCell>
                      <Typography
                        color="text.secondary"
                        sx={{ fontSize: 11 }}
                        noWrap
                      >
                        {row.mountpoint ?? "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.scope ?? "—"}</TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title={
                          canDelete
                            ? "Delete volume"
                            : "Admin permission required"
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={
                              !canDelete || !hostOnline || remove.isPending
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(row);
                            }}
                            aria-label={`Delete volume ${row.name}`}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  colSpan={5}
                  label={
                    filter
                      ? "No volumes match this filter."
                      : hostOnline
                        ? "No volumes reported by this host."
                        : "No cached volumes are available while this host is offline."
                  }
                />
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ResourceDetailDrawer
        open={Boolean(selected)}
        title={selected?.name ?? "Volume details"}
        subtitle={
          selected
            ? `${selected.driver} · ${selected.mountpoint ?? "no mountpoint"}`
            : undefined
        }
        icon={<Storage />}
        query={selectedInspect}
        onClose={() => setSelected(undefined)}
        onCopy={(value) => copyValue(value, showToast)}
      />
      <Dialog
        open={createOpen}
        onClose={() => !create.isPending && setCreateOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Create remote volume</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Volume name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <TextField
              select
              label="Driver"
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            >
              <MenuItem value="local">local</MenuItem>
            </TextField>
            <Typography color="text.secondary" sx={{ fontSize: 11 }}>
              The volume is created on the selected remote Engine. Host
              credentials never leave the gateway.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCreateOpen(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={create.isPending}
          >
            {create.isPending ? "Creating…" : "Create volume"}
          </Button>
        </DialogActions>
      </Dialog>
      <PruneDialog
        open={pruneOpen}
        kind="volumes"
        pending={pruneActive}
        onClose={
          pruneActive && pruneOperationId
            ? () => {
                cancel.mutate(pruneOperationId, {
                  onSuccess: () => showToast("Prune cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The prune could not be cancelled.",
                      "error",
                    ),
                });
              }
            : () => !prune.isPending && setPruneOpen(false)
        }
        onLabel={pruneActive ? "Cancel prune" : "Cancel"}
        onConfirm={() => {
          const operationId = crypto.randomUUID();
          setPruneOperationId(operationId);
          prune.mutate(
            { kind: "volumes", operationId },
            {
              onSuccess: (operation) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  operation.status === "succeeded"
                    ? "Unused volumes were pruned on the remote host."
                    : operation.status === "cancelled"
                      ? "Volume prune cancelled."
                      : (operation.message ?? "Volume prune failed."),
                  operation.status === "succeeded"
                    ? "success"
                    : operation.status === "cancelled"
                      ? "info"
                      : "error",
                );
              },
              onError: (error) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Volume prune failed.",
                  "error",
                );
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete volume?"
        description={
          deleteTarget
            ? `Deleting ${deleteTarget.name} can permanently remove its data. This action requires Admin permission.`
            : ""
        }
        confirmLabel="Delete volume"
        pending={remove.isPending}
        onClose={() => !remove.isPending && setDeleteTarget(undefined)}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(
            { volumeName: deleteTarget.name },
            {
              onSuccess: (operation) => {
                setDeleteTarget(undefined);
                showToast(
                  operation.status === "succeeded"
                    ? "Volume deleted."
                    : (operation.message ?? "Volume deletion failed."),
                  operation.status === "succeeded" ? "success" : "error",
                );
              },
              onError: (error) =>
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Volume deletion failed.",
                  "error",
                ),
            },
          );
        }}
      />
    </Box>
  );
}

function NetworksView({ hostId }: { hostId?: string }) {
  const { data: hosts = [] } = useHosts();
  const host = hosts.find((item) => item.id === hostId);
  const hostOnline = host?.status === "online";
  const query = useNetworks(
    hostId,
    hostOnline && (host?.capabilities.networks ?? false),
  );
  const create = useCreateNetwork(hostId);
  const remove = useDeleteNetwork(hostId);
  const prune = usePruneResources(hostId);
  const cancel = useCancelOperation();
  const { data: user } = useCurrentUser();
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneOperationId, setPruneOperationId] = useState<string>();
  const canPrune = (user?.role ?? "viewer") !== "viewer";
  const pruneOperation = useOperation(pruneOperationId);
  const pruneActive =
    prune.isPending ||
    pruneOperation?.status === "queued" ||
    pruneOperation?.status === "running";
  const showToast = useUiStore((state) => state.showToast);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<NetworkSummary>();
  const [deleteTarget, setDeleteTarget] = useState<NetworkSummary>();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("bridge");
  const [internal, setInternal] = useState("false");
  const [formError, setFormError] = useState<string>();
  const normalized = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      filterRowsByQuery(
        query.data ?? [],
        (row) => [row.name, row.driver, row.scope],
        normalized,
      ),
    [normalized, query.data],
  );
  const selectedInspect = useNetworkInspect(hostId, selected?.id);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("A network name is required.");
      return;
    }
    setFormError(undefined);
    create.mutate(
      {
        name: trimmed,
        driver: driver.trim() || "bridge",
        internal: internal === "true",
      },
      {
        onSuccess: (operation) => {
          setCreateOpen(false);
          setName("");
          showToast(
            operation.status === "succeeded"
              ? "Network created on the remote host."
              : (operation.message ?? "Network creation failed."),
            operation.status === "succeeded" ? "success" : "error",
          );
        },
        onError: (error) =>
          setFormError(
            error instanceof Error ? error.message : "Network creation failed.",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Networks"
        title="Networks"
        description={`${query.data?.length ?? 0} networks reported by the selected remote Engine.`}
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Refresh
            </Button>
            <Tooltip
              title={
                canPrune
                  ? "Remove unused networks from the remote host"
                  : "Operator permission required"
              }
            >
              <span>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CleaningServices />}
                  onClick={() => setPruneOpen(true)}
                  disabled={!hostId || !hostOnline || !canPrune || pruneActive}
                >
                  Prune
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setCreateOpen(true)}
              disabled={!hostId || !hostOnline}
            >
              Create network
            </Button>
          </>
        }
      />
      <ResourceFilter
        value={filter}
        onChange={setFilter}
        placeholder="Filter by name, driver, or scope"
        count={rows.length}
      />
      {host && !hostOnline && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {host.displayName} is {host.status}. Showing the last cached network
          snapshot, if available. Mutations are disabled until it is online.
        </Alert>
      )}
      {query.isError ? (
        <ResourceError
          icon={<Lan />}
          title="Networks"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Remote networks">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Driver</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Internal</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.isLoading ? (
                <LoadingRow colSpan={5} />
              ) : rows.length ? (
                rows.map((row) => (
                  <TableRow
                    hover
                    key={row.id}
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(row);
                      }
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 650 }}>{row.name}</TableCell>
                    <TableCell>{row.driver}</TableCell>
                    <TableCell>{row.scope}</TableCell>
                    <TableCell>{row.internal ? "Yes" : "No"}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="error"
                        disabled={!hostOnline || remove.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(row);
                        }}
                        aria-label={`Delete network ${row.name}`}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow
                  colSpan={5}
                  label={
                    filter
                      ? "No networks match this filter."
                      : hostOnline
                        ? "No networks reported by this host."
                        : "No cached networks are available while this host is offline."
                  }
                />
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ResourceDetailDrawer
        open={Boolean(selected)}
        title={selected?.name ?? "Network details"}
        subtitle={
          selected ? `${selected.driver} · ${selected.scope}` : undefined
        }
        icon={<Lan />}
        query={selectedInspect}
        onClose={() => setSelected(undefined)}
        onCopy={(value) => copyValue(value, showToast)}
      />
      <Dialog
        open={createOpen}
        onClose={() => !create.isPending && setCreateOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Create remote network</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Network name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <TextField
              label="Driver"
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            />
            <TextField
              select
              label="Internal network"
              value={internal}
              onChange={(event) => setInternal(event.target.value)}
            >
              <MenuItem value="false">No</MenuItem>
              <MenuItem value="true">Yes</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCreateOpen(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={create.isPending}
          >
            {create.isPending ? "Creating…" : "Create network"}
          </Button>
        </DialogActions>
      </Dialog>
      <PruneDialog
        open={pruneOpen}
        kind="networks"
        pending={pruneActive}
        onClose={
          pruneActive && pruneOperationId
            ? () => {
                cancel.mutate(pruneOperationId, {
                  onSuccess: () => showToast("Prune cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The prune could not be cancelled.",
                      "error",
                    ),
                });
              }
            : () => !prune.isPending && setPruneOpen(false)
        }
        onLabel={pruneActive ? "Cancel prune" : "Cancel"}
        onConfirm={() => {
          const operationId = crypto.randomUUID();
          setPruneOperationId(operationId);
          prune.mutate(
            { kind: "networks", operationId },
            {
              onSuccess: (operation) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  operation.status === "succeeded"
                    ? "Unused networks were pruned on the remote host."
                    : operation.status === "cancelled"
                      ? "Network prune cancelled."
                      : (operation.message ?? "Network prune failed."),
                  operation.status === "succeeded"
                    ? "success"
                    : operation.status === "cancelled"
                      ? "info"
                      : "error",
                );
              },
              onError: (error) => {
                setPruneOpen(false);
                setPruneOperationId(undefined);
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Network prune failed.",
                  "error",
                );
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete network?"
        description={
          deleteTarget
            ? `This removes ${deleteTarget.name} from the selected remote Engine. Containers attached to it may block deletion.`
            : ""
        }
        confirmLabel="Delete network"
        pending={remove.isPending}
        onClose={() => !remove.isPending && setDeleteTarget(undefined)}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: (operation) => {
              setDeleteTarget(undefined);
              showToast(
                operation.status === "succeeded"
                  ? "Network deleted."
                  : (operation.message ?? "Network deletion failed."),
                operation.status === "succeeded" ? "success" : "error",
              );
            },
            onError: (error) =>
              showToast(
                error instanceof Error
                  ? error.message
                  : "Network deletion failed.",
                "error",
              ),
          });
        }}
      />
    </Box>
  );
}

function ResourceFilter({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  count: number;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.6 }}>
      <TextField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        sx={{ maxWidth: 430, flex: 1 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          ),
        }}
      />
      <Typography color="text.secondary" sx={{ fontSize: 11 }}>
        {count} result{count === 1 ? "" : "s"}
      </Typography>
    </Stack>
  );
}

function CopyCell({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.25}
      sx={{ minWidth: 0 }}
    >
      <Typography
        sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 11 }}
        noWrap
      >
        {value}
      </Typography>
      <Tooltip title="Copy">
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onCopy(value);
          }}
          aria-label="Copy value"
        >
          <ContentCopy sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function ResourceDetailDrawer({
  open,
  title,
  subtitle,
  icon,
  query,
  onClose,
  onCopy,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  query: {
    data?: Record<string, unknown>;
    isLoading: boolean;
    isError: boolean;
  };
  onClose: () => void;
  onCopy: (value: string) => void;
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 500 }, p: 2.5 },
      }}
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
        >
          <Stack
            direction="row"
            spacing={1.2}
            alignItems="center"
            sx={{ minWidth: 0 }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                borderRadius: 1.2,
                bgcolor: "action.hover",
                color: "primary.main",
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {title}
              </Typography>
              {subtitle && (
                <Typography
                  color="text.secondary"
                  sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 10.5 }}
                  noWrap
                >
                  {subtitle}
                </Typography>
              )}
            </Box>
          </Stack>
          <IconButton onClick={onClose} aria-label="Close details">
            <Close fontSize="small" />
          </IconButton>
        </Stack>
        <Divider />
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            bgcolor: "action.hover",
            borderRadius: 1,
            p: 1.5,
          }}
        >
          {query.isLoading && (
            <Box sx={{ display: "grid", placeItems: "center", py: 5 }}>
              <CircularProgress
                size={22}
                aria-label="Loading resource details"
              />
            </Box>
          )}
          {query.isError && (
            <Typography color="error" variant="body2">
              The gateway could not load this resource detail.
            </Typography>
          )}
          {!query.isLoading && !query.isError && query.data && (
            <JsonView data={query.data} onCopy={onCopy} />
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}

function JsonView({
  data,
  onCopy,
}: {
  data: Record<string, unknown>;
  onCopy: (value: string) => void;
}) {
  const serialized = JSON.stringify(data, null, 2);
  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button
          size="small"
          startIcon={<ContentCopy fontSize="small" />}
          onClick={() => onCopy(serialized)}
        >
          Copy JSON
        </Button>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontFamily: "var(--dd-font-mono)",
          fontSize: 11.5,
          color: "text.primary",
        }}
      >
        {serialized}
      </Box>
    </Box>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">{description}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={pending}
          startIcon={
            pending ? <CircularProgress size={15} color="inherit" /> : <Check />
          }
        >
          {pending ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PruneDialog({
  open,
  kind,
  pending,
  all,
  onAllChange,
  onClose,
  onLabel,
  onConfirm,
}: {
  open: boolean;
  kind: PruneResourceKind;
  pending: boolean;
  all?: boolean;
  onAllChange?: (value: boolean) => void;
  onClose: () => void;
  onLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Prune {kind}?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography color="text.secondary">
            Removes unused {kind} from the remote host that are no longer
            referenced. Pruned resources cannot be recovered.
          </Typography>
          {onAllChange && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={all ?? false}
                  onChange={(event) => onAllChange(event.target.checked)}
                />
              }
              label="Include resources still referenced by stopped containers"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          {onLabel ?? "Cancel"}
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={pending}
          startIcon={
            pending ? (
              <CircularProgress size={15} color="inherit" />
            ) : (
              <CleaningServices />
            )
          }
        >
          {pending ? "Pruning\u2026" : "Prune"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResourceError({
  icon,
  title,
  onRetry,
}: {
  icon: ReactNode;
  title: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      title={`Could not load ${title.toLowerCase()}`}
      description="The gateway could not read this remote resource. Retry after checking the host state."
      actionLabel="Retry"
      onAction={onRetry}
      icon={icon}
    />
  );
}

function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          Reading the remote Engine…
        </Typography>
      </TableCell>
    </TableRow>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          {label}
        </Typography>
      </TableCell>
    </TableRow>
  );
}
