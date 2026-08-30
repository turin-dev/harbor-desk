import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import {
  Apps,
  ArrowForward,
  Image,
  Refresh,
  Storage,
  Lan,
  Memory,
} from "@mui/icons-material";
import { EmptyState } from "../components/EmptyState.js";
import { MetricCard } from "../components/MetricCard.js";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import { useContainers, useDashboard, useHosts } from "../state/queries.js";
import { formatBytes } from "../format.js";
import { useUiStore } from "../state/ui-store.js";

export function DashboardScreen() {
  const navigate = useNavigate();
  const { data: hosts = [] } = useHosts();
  const storedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost =
    hosts.find((host) => host.id === storedHostId) ?? hosts[0];
  const selectedHostId = selectedHost?.id;
  const { data, isLoading, isError, refetch } = useDashboard(selectedHostId);
  const containers = useContainers(
    selectedHostId,
    selectedHost?.capabilities.containers ?? false,
  );

  if (!hosts.length) {
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow="Workspace"
          title="Dashboard"
          description="One calm control room for every remote container host."
        />
        <EmptyState
          title="Connect a remote host"
          description="Harbor Desk has no server connection yet. Add a remote Engine endpoint to start managing containers from this client."
          actionLabel="Add remote host"
          onAction={() => navigate("/hosts")}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace overview"
        title="Dashboard"
        description={
          data
            ? `${data.host.displayName} · Engine ${data.engine.version ?? "unknown"} · API ${data.engine.apiVersion ?? "unknown"}`
            : "Review the selected remote host at a glance."
        }
        actions={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            Refresh
          </Button>
        }
      />

      {isError ? (
        <EmptyState
          title="Remote host is unavailable"
          description="The gateway could not read this host. Check the host connection and certificate configuration, then retry."
          actionLabel="Open host settings"
          onAction={() => navigate("/hosts")}
        />
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
              gap: 1.2,
              mb: 2.4,
            }}
          >
            <MetricCard
              label="Containers"
              value={isLoading ? "…" : (data?.counts.containers ?? 0)}
              note={`${data?.counts.running ?? 0} running`}
              icon={<Apps fontSize="small" />}
              tone="blue"
            />
            <MetricCard
              label="Images"
              value={isLoading ? "…" : (data?.counts.images ?? 0)}
              note="Stored on host"
              icon={<Image fontSize="small" />}
              tone="green"
            />
            <MetricCard
              label="Volumes"
              value={isLoading ? "…" : (data?.counts.volumes ?? 0)}
              note="Persistent data"
              icon={<Storage fontSize="small" />}
              tone="amber"
            />
            <MetricCard
              label="Networks"
              value={isLoading ? "…" : (data?.counts.networks ?? 0)}
              note="Engine networks"
              icon={<Lan fontSize="small" />}
              tone="slate"
            />
            <MetricCard
              label="Memory"
              value={
                isLoading ? "…" : formatBytes(data?.engine.memoryTotalBytes)
              }
              note="Reported by Engine"
              icon={<Memory fontSize="small" />}
              tone="blue"
            />
          </Box>

          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={2}
            alignItems="stretch"
          >
            <Paper sx={{ p: 2.2, flex: 1, minWidth: 0 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1.6 }}
              >
                <Box>
                  <Typography variant="h6">Remote host</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.3 }}>
                    Connection and capability summary
                  </Typography>
                </Box>
                {data && <StatusChip status={data.host.status} />}
              </Stack>
              <Stack spacing={1.1}>
                <InfoRow
                  label="Engine"
                  value={data?.engine.version ?? "Waiting for host"}
                />
                <InfoRow
                  label="API"
                  value={
                    data?.engine.apiVersion
                      ? `${data.engine.apiVersion} · minimum ${data.engine.minApiVersion ?? "unknown"}`
                      : "—"
                  }
                />
                <InfoRow
                  label="Platform"
                  value={
                    data?.engine.operatingSystem && data.engine.architecture
                      ? `${data.engine.operatingSystem} / ${data.engine.architecture}`
                      : "—"
                  }
                />
                <InfoRow
                  label="Connection"
                  value={
                    data?.host.connectionMode === "mtls"
                      ? "Server-side mTLS"
                      : "Development connector"
                  }
                />
              </Stack>
            </Paper>
            <Paper sx={{ p: 2.2, width: { xs: "100%", lg: 370 } }}>
              <Typography variant="h6">Next actions</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.3, mb: 1.4 }}>
                Jump into the most common operator workflows.
              </Typography>
              <Stack spacing={0.7}>
                <ActionLink
                  label="Review containers"
                  onClick={() => navigate("/containers")}
                />
                <ActionLink
                  label="Browse images"
                  onClick={() => navigate("/images")}
                />
                <ActionLink
                  label="Inspect volumes"
                  onClick={() => navigate("/volumes")}
                />
                <ActionLink
                  label="Open remote host settings"
                  onClick={() => navigate("/hosts")}
                />
              </Stack>
            </Paper>
          </Stack>
          <Paper sx={{ mt: 2, overflow: "hidden" }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 2.2, py: 1.7 }}
            >
              <Box>
                <Typography variant="h6">Containers at a glance</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.25 }}>
                  Live workload state from{" "}
                  {data?.host.displayName ?? "the selected host"}.
                </Typography>
              </Box>
              <Button
                onClick={() => navigate("/containers")}
                endIcon={<ArrowForward fontSize="small" />}
              >
                View all
              </Button>
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" aria-label="Recent remote containers">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Image</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Ports</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {containers.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography
                          color="text.secondary"
                          sx={{ py: 2, textAlign: "center" }}
                        >
                          Reading workloads…
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : containers.data?.length ? (
                    containers.data.slice(0, 5).map((container) => (
                      <TableRow
                        hover
                        key={container.id}
                        onClick={() => navigate("/containers")}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography sx={{ fontWeight: 650 }}>
                            {container.name}
                          </Typography>
                          <Typography
                            color="text.secondary"
                            sx={{
                              fontSize: 10.5,
                              fontFamily: "var(--dd-font-mono)",
                            }}
                          >
                            {container.id.slice(0, 12)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography noWrap sx={{ maxWidth: 310 }}>
                            {container.image}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <StatusChip status={container.state} />
                        </TableCell>
                        <TableCell>
                          <Typography
                            color="text.secondary"
                            sx={{ fontSize: 11 }}
                          >
                            {container.ports.length
                              ? container.ports.join(", ")
                              : "—"}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography
                          color="text.secondary"
                          sx={{ py: 2, textAlign: "center" }}
                        >
                          No containers reported by this host.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontWeight: 600,
          textAlign: "right",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function ActionLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      endIcon={<ArrowForward fontSize="small" />}
      sx={{ justifyContent: "space-between", px: 0.7, color: "text.primary" }}
    >
      {label}
    </Button>
  );
}
