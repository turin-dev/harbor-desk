import { useMemo, useState } from "react";
import {
  CheckCircleOutline,
  CloudQueue,
  ErrorOutline,
  Refresh,
  Router,
  Security,
  Storage,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { Host } from "@harbor/contracts";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import {
  useConnectionStatus,
  useGatewayHealth,
  useHosts,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

const capabilityLabels: Array<[keyof Host["capabilities"], string]> = [
  ["containers", "Containers"],
  ["images", "Images"],
  ["volumes", "Volumes"],
  ["networks", "Networks"],
  ["logs", "Logs"],
  ["stats", "Stats"],
  ["exec", "Exec"],
  ["compose", "Compose"],
  ["buildkit", "BuildKit"],
  ["kubernetes", "Kubernetes"],
  ["extensions", "Extensions"],
  ["imageScan", "Image scan"],
  ["volumeFileBrowser", "Volume browser"],
];

export function TroubleshootScreen() {
  const health = useGatewayHealth();
  const connection = useConnectionStatus();
  const { data: hosts = [], isLoading: hostsLoading } = useHosts();
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const showToast = useUiStore((state) => state.showToast);
  const [reconnecting, setReconnecting] = useState(false);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [hosts, selectedHostId],
  );
  const refresh = () => {
    void connection.refetch();
    void health.refetch();
  };
  const reconnect = async () => {
    const bridge = window.harbor?.connection;
    if (!bridge?.reconnect) {
      refresh();
      return;
    }
    setReconnecting(true);
    try {
      const next = await bridge.reconnect();
      showToast(
        next.mode === "unavailable"
          ? next.message
          : "The saved connection is available again.",
        next.mode === "unavailable" ? "error" : "success",
      );
      await Promise.all([connection.refetch(), health.refetch()]);
    } catch (caught) {
      showToast(
        caught instanceof Error
          ? caught.message
          : "The saved connection could not be retried.",
        "error",
      );
    } finally {
      setReconnecting(false);
    }
  };
  const status = connection.data;
  const canReconnect = Boolean(
    window.harbor?.connection?.reconnect &&
    status &&
    status.mode !== "unconfigured" &&
    (status.mode === "unavailable" || health.isError),
  );
  const detectedType =
    status?.mode === "gateway"
      ? "Harbor Desk Gateway"
      : status?.mode === "engine"
        ? "Docker Engine"
        : status?.mode === "detecting"
          ? "Detecting…"
          : status?.mode === "unconfigured"
            ? "Not configured"
            : "Unavailable";
  const engineHost =
    status?.mode === "engine"
      ? (() => {
          try {
            const endpoint = new URL(status.endpoint ?? "");
            return endpoint.hostname === "localhost" ||
              endpoint.hostname === "127.0.0.1" ||
              endpoint.hostname === "::1" ||
              endpoint.protocol === "npipe:" ||
              endpoint.protocol === "unix:"
              ? "Local Docker Engine"
              : "Remote Docker Engine";
          } catch {
            return "Docker Engine";
          }
        })()
      : undefined;

  return (
    <Box sx={{ px: 4, py: 2, maxWidth: 1_200 }}>
      <PageHeader
        eyebrow="Support"
        title="Troubleshoot"
        description="Inspect the configured connection, active Gateway, authentication, and Engine dependency without exposing secrets."
        actions={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={canReconnect ? () => void reconnect() : refresh}
            disabled={
              reconnecting || health.isFetching || connection.isFetching
            }
          >
            {reconnecting
              ? "Reconnecting…"
              : canReconnect
                ? "Retry connection"
                : "Refresh checks"}
          </Button>
        }
      />
      {(status?.mode === "unavailable" || health.isError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {status?.message ??
            "The active Gateway health endpoint could not be reached. Inspect the configured URL and desktop startup logs."}
        </Alert>
      )}
      <Stack spacing={2}>
        <Paper sx={{ p: 2.2 }}>
          <SectionHeading
            icon={<CloudQueue />}
            title="Gateway"
            description="Configured connection and active control-plane status"
          />
          <Stack spacing={0.8}>
            <DiagnosticRow
              label="Connection target"
              value={status?.endpoint ?? "Not configured"}
              good={Boolean(status?.endpoint)}
            />
            <DiagnosticRow
              label="Detected type"
              value={detectedType}
              good={status?.mode === "gateway" || status?.mode === "engine"}
            />
            <DiagnosticRow
              label="Active gateway"
              value={status?.gatewayUrl ?? "Not active"}
              good={Boolean(status?.gatewayUrl)}
            />
            <DiagnosticRow
              label="Local gateway"
              value={status?.localGateway ? "Running" : "Stopped"}
              good={
                status?.mode === "gateway"
                  ? !status.localGateway
                  : status?.mode === "engine" && status.localGateway
              }
            />
            {engineHost && (
              <DiagnosticRow
                label="Engine host"
                value={engineHost}
                good={status?.engineOnline === true}
              />
            )}
            <DiagnosticRow
              label="Engine dependency"
              value={
                status?.mode === "gateway"
                  ? "Reported by server Gateway"
                  : status?.mode === "engine"
                    ? status.engineOnline
                      ? "Online"
                      : "Offline"
                    : "Unavailable"
              }
              good={status?.mode === "gateway" || status?.engineOnline === true}
            />
          </Stack>
          <Divider sx={{ my: 1.4 }} />
          {health.isLoading ? (
            <CheckLoading />
          ) : (
            <>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ mb: 1.5 }}
              >
                {health.data?.status === "ok" ? (
                  <CheckCircleOutline color="success" fontSize="small" />
                ) : (
                  <ErrorOutline color="warning" fontSize="small" />
                )}
                <Typography sx={{ fontWeight: 650 }}>
                  {health.isError
                    ? "Unavailable"
                    : health.data?.status === "ok"
                      ? "Healthy"
                      : "Degraded"}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                  version {health.data?.version ?? "unknown"}
                </Typography>
              </Stack>
              <Stack spacing={0.8}>
                {Object.entries(health.data?.dependencies ?? {}).map(
                  ([name, dependencyStatus]) => (
                    <DiagnosticRow
                      key={name}
                      label={name}
                      value={dependencyStatus}
                      good={dependencyStatus === "ok"}
                    />
                  ),
                )}
              </Stack>
            </>
          )}
        </Paper>

        <Paper sx={{ p: 2.2 }}>
          <SectionHeading
            icon={<Router />}
            title="Selected remote host"
            description="Engine probe, API compatibility, and capability policy"
          />
          {hostsLoading ? (
            <CheckLoading />
          ) : selectedHost ? (
            <>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ mb: 1.6 }}
              >
                <Typography sx={{ fontWeight: 650 }}>
                  {selectedHost.displayName}
                </Typography>
                <StatusChip status={selectedHost.status} />
                <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                  {selectedHost.connectionMode === "mtls"
                    ? "Server-side mTLS"
                    : "Development connector"}
                </Typography>
              </Stack>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ mb: 2 }}
              >
                <DiagnosticStat
                  label="Engine"
                  value={selectedHost.engineVersion ?? "Unknown"}
                />
                <DiagnosticStat
                  label="API"
                  value={selectedHost.apiVersion ?? "Unknown"}
                />
                <DiagnosticStat
                  label="Minimum API"
                  value={selectedHost.minApiVersion ?? "Unknown"}
                />
                <DiagnosticStat
                  label="Last seen"
                  value={
                    selectedHost.lastSeenAt
                      ? new Date(selectedHost.lastSeenAt).toLocaleString()
                      : "Never"
                  }
                />
              </Stack>
              <Divider sx={{ mb: 1.4 }} />
              <Typography sx={{ fontWeight: 650, fontSize: 12, mb: 1 }}>
                Capability matrix
              </Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.8}>
                {capabilityLabels.map(([key, label]) => (
                  <Capability
                    key={key}
                    label={label}
                    enabled={selectedHost.capabilities[key]}
                  />
                ))}
              </Stack>
            </>
          ) : (
            <Typography color="text.secondary">
              No host is registered. Configure a Docker Engine target in
              Connection, or add a host through a Server Gateway.
            </Typography>
          )}
        </Paper>

        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <DiagnosticNote
            icon={<Security />}
            title="Detected connection type"
            body="A Harbor Desk Gateway is used directly. A Docker Engine target starts a per-launch token-protected Local Gateway wrapper on a dynamically assigned 127.0.0.1 port."
          />
          <DiagnosticNote
            icon={<Storage />}
            title="Renderer has no Engine access"
            body="The renderer only calls Gateway API routes. Docker Engine probes and event streams stay inside the Server Gateway or Local Gateway wrapper."
          />
        </Stack>
      </Stack>
    </Box>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Stack direction="row" spacing={1.1} alignItems="flex-start" sx={{ mb: 2 }}>
      <Box
        sx={{
          color: "primary.main",
          display: "grid",
          placeItems: "center",
          mt: 0.1,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
    </Stack>
  );
}

function DiagnosticRow({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography color="text.secondary" sx={{ textTransform: "capitalize" }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.7} alignItems="center">
        {good ? (
          <CheckCircleOutline color="success" sx={{ fontSize: 15 }} />
        ) : (
          <ErrorOutline color="warning" sx={{ fontSize: 15 }} />
        )}
        <Typography sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 11 }}>
          {value}
        </Typography>
      </Stack>
    </Stack>
  );
}

function DiagnosticStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography color="text.secondary" sx={{ fontSize: 10.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 650, mt: 0.25, fontSize: 12 }}>
        {value}
      </Typography>
    </Box>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={0.55}
      alignItems="center"
      sx={{
        px: 0.9,
        py: 0.55,
        border: 1,
        borderColor: enabled ? "success.light" : "divider",
        borderRadius: 1,
        bgcolor: enabled ? "var(--dd-color-green-soft)" : "transparent",
      }}
    >
      {enabled ? (
        <CheckCircleOutline color="success" sx={{ fontSize: 14 }} />
      ) : (
        <ErrorOutline color="disabled" sx={{ fontSize: 14 }} />
      )}
      <Typography
        sx={{
          fontSize: 11,
          color: enabled ? "text.primary" : "text.secondary",
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

function DiagnosticNote({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Paper sx={{ p: 2, flex: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{ color: "primary.main", display: "grid", placeItems: "center" }}
        >
          {icon}
        </Box>
        <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 1, fontSize: 12 }}>
        {body}
      </Typography>
    </Paper>
  );
}

function CheckLoading() {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <CircularProgress size={17} />
      <Typography color="text.secondary">Running checks…</Typography>
    </Stack>
  );
}
