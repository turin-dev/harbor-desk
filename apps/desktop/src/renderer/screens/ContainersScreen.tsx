import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add,
  Check,
  CheckBoxOutlineBlank,
  Close,
  CloudOff,
  CloudQueue,
  DeleteOutline,
  MoreHoriz,
  PlayArrow,
  Refresh,
  Search,
  Stop,
  Terminal,
} from "@mui/icons-material";
import type { ContainerSummary } from "@harbor/contracts";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import {
  useContainerAction,
  useContainerInspect,
  useContainerLogs,
  useContainerStats,
  useContainers,
  useCreateContainer,
  useDeleteContainer,
  useHosts,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

export function ContainersScreen() {
  const navigate = useNavigate();
  const { data: hosts = [] } = useHosts();
  const hostId = useUiStore((state) => state.selectedHostId) ?? hosts[0]?.id;
  const selectedHost = hosts.find((host) => host.id === hostId);
  const {
    data: containers = [],
    isLoading,
    isError,
    refetch,
  } = useContainers(
    hostId,
    selectedHost?.status === "online" &&
      (selectedHost?.capabilities.containers ?? false),
  );
  const capabilityAvailable = selectedHost?.capabilities.containers ?? false;
  const hostOnline = selectedHost?.status === "online";
  const [filter, setFilter] = useState("");
  const [selectedContainer, setSelectedContainer] =
    useState<ContainerSummary>();
  const [detailTab, setDetailTab] = useState<"logs" | "inspect" | "stats">(
    "logs",
  );
  const action = useContainerAction(hostId);
  const create = useCreateContainer(hostId);
  const remove = useDeleteContainer(hostId);
  const showToast = useUiStore((state) => state.showToast);
  const setTerminalOpen = useUiStore((state) => state.setTerminalOpen);
  const setTerminalContainer = useUiStore(
    (state) => state.setTerminalContainer,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [formError, setFormError] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ContainerSummary>();
  const [forceDelete, setForceDelete] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuContainer, setMenuContainer] = useState<ContainerSummary>();

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return containers;
    return containers.filter((container) =>
      [container.name, container.image, container.status].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [containers, filter]);

  const reportOperation = (
    operation: { status: string; message?: string },
    successMessage: string,
  ) => {
    showToast(
      operation.status === "succeeded"
        ? successMessage
        : (operation.message ?? "The remote operation failed."),
      operation.status === "succeeded" ? "success" : "error",
    );
  };

  const runAction = (container: ContainerSummary, value: string) => {
    action.mutate(
      { containerId: container.id, action: value },
      {
        onSuccess: (operation) =>
          reportOperation(
            operation,
            `${value.charAt(0).toUpperCase()}${value.slice(1)} requested for ${container.name}.`,
          ),
        onError: (error) =>
          showToast(
            error instanceof Error ? error.message : "Container action failed.",
            "error",
          ),
      },
    );
  };

  const submitCreate = () => {
    const trimmedImage = image.trim();
    if (!trimmedImage) {
      setFormError("An image reference is required.");
      return;
    }
    setFormError(undefined);
    create.mutate(
      {
        image: trimmedImage,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(command.trim() ? { command: command.trim() } : {}),
      },
      {
        onSuccess: (operation) => {
          setCreateOpen(false);
          setImage("");
          setName("");
          setCommand("");
          reportOperation(
            operation,
            "Container created and started on the remote host.",
          );
        },
        onError: (error) =>
          setFormError(
            error instanceof Error
              ? error.message
              : "Container creation failed.",
          ),
      },
    );
  };

  if (!hosts.length) {
    return <DisconnectedContainersView onConnect={() => navigate("/hosts")} />;
  }

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Containers"
        title="Containers"
        description={
          selectedHost
            ? `${selectedHost.displayName} · ${containers.length} containers reported by the remote Engine`
            : "Choose a remote host to continue."
        }
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void refetch()}
              disabled={isLoading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setCreateOpen(true)}
              disabled={
                !selectedHost ||
                selectedHost.status !== "online" ||
                !capabilityAvailable
              }
            >
              Run container
            </Button>
          </Stack>
        }
      />
      <Stack direction="row" spacing={1} sx={{ mb: 1.6 }}>
        <TextField
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, image, or status"
          aria-label="Filter containers"
          sx={{ width: 340 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Stack>
      {!selectedHost ? (
        <Alert severity="info">
          Select a remote host to load its containers.
        </Alert>
      ) : !hostOnline ? (
        <Alert severity="warning">
          {selectedHost.displayName} is {selectedHost.status}. Showing the last
          cached container snapshot, if available. Mutations are disabled until
          the gateway confirms the host is online.
        </Alert>
      ) : !capabilityAvailable ? (
        <Alert severity="info">
          The selected remote host does not advertise the containers capability.
          The gateway has not issued a local fallback request.
        </Alert>
      ) : isError ? (
        <EmptyState
          title="Could not load containers"
          description="The gateway could not read the selected host. Retry after checking the connection state."
          actionLabel="Retry"
          onAction={() => void refetch()}
        />
      ) : (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Remote containers">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Image</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Ports</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography
                      color="text.secondary"
                      sx={{ py: 4, textAlign: "center" }}
                    >
                      {filter
                        ? "No containers match this filter."
                        : "No containers on this host."}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography
                      color="text.secondary"
                      sx={{ py: 4, textAlign: "center" }}
                    >
                      Reading the remote Engine…
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((container) => (
                <ContainerRow
                  key={container.id}
                  container={container}
                  actionPending={action.isPending || remove.isPending}
                  onAction={(value) => runAction(container, value)}
                  onDelete={() => {
                    setDeleteTarget(container);
                    setForceDelete(false);
                  }}
                  onTerminal={() => {
                    setTerminalContainer(container.id, container.name);
                    setTerminalOpen(true);
                  }}
                  onSelect={() => {
                    setSelectedContainer(container);
                    setDetailTab("logs");
                  }}
                  onMore={(anchor) => {
                    setMenuAnchor(anchor);
                    setMenuContainer(container);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ContainerDetailDrawer
        hostId={hostId}
        container={selectedContainer}
        tab={detailTab}
        onTabChange={setDetailTab}
        onClose={() => setSelectedContainer(undefined)}
      />
      <Menu
        open={Boolean(menuAnchor)}
        anchorEl={menuAnchor}
        onClose={() => {
          setMenuAnchor(null);
          setMenuContainer(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {menuContainer && (
          <>
            <MenuItem
              onClick={() => {
                runAction(menuContainer, "restart");
                setMenuAnchor(null);
              }}
            >
              Restart
            </MenuItem>
            <MenuItem
              onClick={() => {
                runAction(
                  menuContainer,
                  menuContainer.state === "paused" ? "unpause" : "pause",
                );
                setMenuAnchor(null);
              }}
            >
              {menuContainer.state === "paused" ? "Unpause" : "Pause"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setDeleteTarget(menuContainer);
                setForceDelete(false);
                setMenuAnchor(null);
              }}
              sx={{ color: "error.main" }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </Menu>
      <Dialog
        open={createOpen}
        onClose={() => !create.isPending && setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Run a remote container</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <Alert severity="info">
              The image must be available to the selected remote Engine. The
              container is created and started by the gateway as one tracked
              operation.
            </Alert>
            <TextField
              label="Image"
              placeholder="nginx:alpine"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              autoFocus
              required
            />
            <TextField
              label="Container name"
              placeholder="optional"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Command"
              placeholder="optional command executed with sh -lc"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              helperText="Command is sent to the selected remote host; it is never executed by the desktop client."
            />
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
            onClick={submitCreate}
            disabled={create.isPending}
          >
            {create.isPending ? "Starting…" : "Run container"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !remove.isPending && setDeleteTarget(undefined)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete container?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.4}>
            <Typography color="text.secondary">
              {deleteTarget
                ? `This removes ${deleteTarget.name} from the selected remote Engine.`
                : ""}
            </Typography>
            <Alert severity="warning">
              Deleting a container removes its writable layer. Use force only
              when the Engine reports that a normal delete cannot complete.
            </Alert>
            <Button
              variant={forceDelete ? "contained" : "outlined"}
              color="warning"
              onClick={() => setForceDelete((value) => !value)}
              sx={{ alignSelf: "flex-start" }}
            >
              {forceDelete ? "Force delete enabled" : "Enable force delete"}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(undefined)}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (!deleteTarget) return;
              remove.mutate(
                { containerId: deleteTarget.id, force: forceDelete },
                {
                  onSuccess: (operation) => {
                    setDeleteTarget(undefined);
                    reportOperation(
                      operation,
                      "Container deleted from the remote host.",
                    );
                  },
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "Container deletion failed.",
                      "error",
                    ),
                },
              );
            }}
            disabled={remove.isPending}
            startIcon={
              remove.isPending ? (
                <CircularProgress size={15} color="inherit" />
              ) : (
                <Check />
              )
            }
          >
            {remove.isPending ? "Deleting…" : "Delete container"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function DisconnectedContainersView({ onConnect }: { onConnect: () => void }) {
  const columns = [
    { id: "select", label: "", width: 44 },
    { id: "expand", label: "", width: 26 },
    { id: "status", label: "", width: 36 },
    { id: "name", label: "Name", width: 96 },
    { id: "container-id", label: "Container ID", width: 129 },
    { id: "image", label: "Image", width: 72 },
    { id: "ports", label: "Port(s)", width: 136 },
    { id: "cpu", label: "CPU (%)", width: 86, align: "right" as const },
    { id: "memory", label: "Memory usage", width: 102 },
    {
      id: "memory-percent",
      label: "Memory (%)",
      width: 88,
      align: "right" as const,
    },
    { id: "disk", label: "Disk read/write", width: 116 },
    { id: "network", label: "Network I/O", width: 111 },
    { id: "pids", label: "PIDS", width: 82 },
    { id: "started", label: "Last started", width: 100 },
    { id: "actions", label: "Actions", width: 160 },
  ];

  return (
    <Box sx={{ px: 4, pt: 3, pb: 3, minWidth: 860 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ minHeight: 24 }}
      >
        <Typography sx={{ fontSize: 16, fontWeight: 500, lineHeight: "24px" }}>
          Containers
        </Typography>
        <Button
          size="small"
          color="inherit"
          sx={{ minHeight: 24, px: 0, color: "primary.main", fontSize: 13 }}
        >
          Give feedback
        </Button>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: 6,
          mt: 3.5,
        }}
      >
        <ContainerMetric label="Container CPU usage" />
        <ContainerMetric label="Container memory usage" />
      </Box>

      <Stack direction="row" alignItems="center" spacing={3} sx={{ mt: 3.5 }}>
        <TextField
          disabled
          placeholder="Search"
          aria-label="Search containers"
          sx={{
            width: 400,
            "& .MuiOutlinedInput-root": {
              height: 40,
              bgcolor: "transparent",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
            },
            "& .MuiInputBase-input.Mui-disabled": {
              WebkitTextFillColor: "text.secondary",
            },
          }}
          InputProps={{
            startAdornment: (
              <Search sx={{ mr: 1, color: "text.secondary", fontSize: 21 }} />
            ),
          }}
        />
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Switch
            checked={false}
            disabled
            size="small"
            inputProps={{ "aria-label": "Only show running containers" }}
          />
          <Typography sx={{ fontSize: 14, fontWeight: 500 }}>
            Only show running containers
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Button size="small" sx={{ minHeight: 32, px: 1, fontSize: 14 }}>
          Show charts
        </Button>
      </Stack>

      <Box sx={{ height: 464, mt: 2, overflow: "auto" }}>
        <Table
          size="small"
          aria-label="Remote containers"
          sx={{ minWidth: 1710, tableLayout: "fixed" }}
        >
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align}
                  sx={{
                    width: column.width,
                    py: 0.5,
                    px: column.label ? 1.5 : column.id === "select" ? 1.5 : 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {column.label ? (
                    column.label
                  ) : column.id === "select" ? (
                    <CheckBoxOutlineBlank
                      sx={{ color: "text.secondary", fontSize: 20 }}
                    />
                  ) : (
                    <Box />
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={columns.length} sx={{ px: 0, py: 0 }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="center"
                  spacing={1.5}
                  sx={{ minHeight: 40, px: 2 }}
                >
                  <CloudOff color="disabled" fontSize="small" />
                  <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                    No remote host connected.
                  </Typography>
                  <Button
                    size="small"
                    onClick={onConnect}
                    sx={{ fontSize: 13 }}
                  >
                    Add remote host
                  </Button>
                </Stack>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>
      <QuickStarts onConnect={onConnect} />
    </Box>
  );
}

function ContainerMetric({ label }: { label: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 14, lineHeight: "20px" }}>{label}</Typography>
      <Typography
        color="text.secondary"
        sx={{ mt: 0.5, fontSize: 14, fontStyle: "italic", lineHeight: "20px" }}
      >
        No remote host is connected.
      </Typography>
    </Box>
  );
}

function QuickStarts({ onConnect }: { onConnect: () => void }) {
  return (
    <Box
      sx={{
        maxWidth: 1200,
        mx: "auto",
        mt: 8,
        transform: "translateX(-4px)",
      }}
    >
      <Typography sx={{ fontSize: 18, fontWeight: 600, lineHeight: "24px" }}>
        Quick starts
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
          mt: 3,
        }}
      >
        <QuickStartCard
          title="Connect a remote host"
          detail="2 mins"
          onClick={onConnect}
        />
        <QuickStartCard
          title="Review remote containers"
          detail="3 mins"
          onClick={onConnect}
        />
      </Box>
      <Button
        size="small"
        onClick={onConnect}
        sx={{ mt: 1.25, px: 0, fontSize: 13 }}
      >
        View remote setup guide
      </Button>
    </Box>
  );
}

function QuickStartCard({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      sx={{
        height: 80,
        p: 0,
        display: "flex",
        justifyContent: "flex-start",
        overflow: "hidden",
        color: "text.primary",
        border: 1,
        borderColor: "rgba(145,164,183,0.42)",
        borderRadius: 0.5,
        bgcolor: "#1a282f",
        textAlign: "left",
        "&:hover": { bgcolor: "#21343e", borderColor: "primary.main" },
      }}
    >
      <Box
        sx={{
          width: 120,
          alignSelf: "stretch",
          display: "grid",
          placeItems: "center",
          bgcolor: "#0c3f8b",
          color: "#75c9f8",
        }}
      >
        <CloudQueue sx={{ fontSize: 30 }} />
      </Box>
      <Box sx={{ px: 2, minWidth: 0 }}>
        <Typography
          sx={{ fontSize: 16, fontWeight: 600, lineHeight: "20px" }}
          noWrap
        >
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, fontSize: 14 }}>
          {detail}
        </Typography>
      </Box>
    </Button>
  );
}

function ContainerRow(props: {
  container: ContainerSummary;
  actionPending: boolean;
  onAction: (action: string) => void;
  onDelete: () => void;
  onTerminal: () => void;
  onSelect: () => void;
  onMore: (anchor: HTMLElement) => void;
}) {
  const { container } = props;
  const running = container.state === "running";
  return (
    <TableRow
      hover
      tabIndex={0}
      role="button"
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      aria-label={`Inspect ${container.name}`}
      sx={{ cursor: "pointer" }}
    >
      <TableCell>
        <Stack spacing={0.2}>
          <Typography sx={{ fontWeight: 650 }}>{container.name}</Typography>
          <Typography
            color="text.secondary"
            sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 10.5 }}
          >
            {container.id.slice(0, 12)}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell>
        <Typography sx={{ maxWidth: 260 }} noWrap>
          {container.image}
        </Typography>
      </TableCell>
      <TableCell>
        <StatusChip status={container.state} />
        <Typography color="text.secondary" sx={{ fontSize: 10.5, mt: 0.35 }}>
          {container.status}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography color="text.secondary" sx={{ fontSize: 11 }}>
          {container.ports.length ? container.ports.join(", ") : "—"}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <Stack
          direction="row"
          justifyContent="flex-end"
          spacing={0.3}
          onClick={(event) => event.stopPropagation()}
        >
          <Tooltip title={running ? "Stop" : "Start"}>
            <span>
              <IconButton
                size="small"
                disabled={props.actionPending}
                onClick={() => props.onAction(running ? "stop" : "start")}
                aria-label={
                  running ? `Stop ${container.name}` : `Start ${container.name}`
                }
              >
                {running ? (
                  <Stop fontSize="small" />
                ) : (
                  <PlayArrow fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Open terminal">
            <IconButton
              size="small"
              disabled={!running}
              onClick={props.onTerminal}
              aria-label={`Open terminal for ${container.name}`}
            >
              <Terminal fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              disabled={props.actionPending}
              onClick={props.onDelete}
              aria-label={`Delete ${container.name}`}
            >
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="More actions">
            <IconButton
              size="small"
              aria-label={`More actions for ${container.name}`}
              onClick={(event) => props.onMore(event.currentTarget)}
            >
              <MoreHoriz fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

function ContainerDetailDrawer(props: {
  hostId?: string;
  container?: ContainerSummary;
  tab: "logs" | "inspect" | "stats";
  onTabChange: (tab: "logs" | "inspect" | "stats") => void;
  onClose: () => void;
}) {
  const { container } = props;
  const logs = useContainerLogs(props.hostId, container?.id);
  const inspect = useContainerInspect(props.hostId, container?.id);
  const stats = useContainerStats(props.hostId, container?.id);
  const active =
    props.tab === "logs" ? logs : props.tab === "inspect" ? inspect : stats;

  return (
    <Drawer
      anchor="right"
      open={Boolean(container)}
      onClose={props.onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, p: 2.5 } }}
    >
      {container && (
        <Stack spacing={1.6} sx={{ height: "100%" }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            spacing={2}
            alignItems="flex-start"
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {container.name}
              </Typography>
              <Typography
                color="text.secondary"
                sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 11 }}
              >
                {container.id}
              </Typography>
              <Box sx={{ mt: 0.8 }}>
                <StatusChip status={container.state} />
              </Box>
            </Box>
            <IconButton
              onClick={props.onClose}
              aria-label="Close container details"
            >
              <Close fontSize="small" />
            </IconButton>
          </Stack>
          <Tabs
            value={props.tab}
            onChange={(_event, value: "logs" | "inspect" | "stats") =>
              props.onTabChange(value)
            }
            variant="fullWidth"
            aria-label="Container details"
          >
            <Tab value="logs" label="Logs" />
            <Tab value="inspect" label="Inspect" />
            <Tab value="stats" label="Stats" />
          </Tabs>
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
            {active.isLoading && (
              <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
                <CircularProgress
                  size={22}
                  aria-label={`Loading ${props.tab}`}
                />
              </Box>
            )}
            {active.isError && (
              <Typography color="error" variant="body2">
                The gateway could not load this container detail.
              </Typography>
            )}
            {!active.isLoading && !active.isError && props.tab === "logs" && (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--dd-font-mono)",
                  fontSize: 11.5,
                  color: "text.primary",
                }}
              >
                {logs.data || "No logs reported."}
              </Box>
            )}
            {!active.isLoading && !active.isError && props.tab !== "logs" && (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--dd-font-mono)",
                  fontSize: 11.5,
                  color: "text.primary",
                }}
              >
                {JSON.stringify(
                  (props.tab === "inspect" ? inspect.data : stats.data) ?? {},
                  null,
                  2,
                )}
              </Box>
            )}
          </Box>
        </Stack>
      )}
    </Drawer>
  );
}
