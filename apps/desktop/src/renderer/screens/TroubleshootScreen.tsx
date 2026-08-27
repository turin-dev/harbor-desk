import { useMemo } from "react";
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
import { useGatewayHealth, useHosts } from "../state/queries.js";
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
  const { data: hosts = [], isLoading: hostsLoading } = useHosts();
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [hosts, selectedHostId],
  );
  const refresh = () => {
    void health.refetch();
  };

  return (
    <Box sx={{ px: 4, py: 2, maxWidth: 1_200 }}>
      <PageHeader
        eyebrow="Support"
        title="Troubleshoot"
        description="Inspect the real gateway, authentication, connector, and remote Engine state without exposing server secrets."
        actions={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={refresh}
            disabled={health.isFetching}
          >
            Refresh checks
          </Button>
        }
      />
      {health.isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          The gateway health endpoint could not be reached. Check the configured
          gateway URL and server availability.
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Paper sx={{ p: 2.2 }}>
            <SectionHeading
              icon={<CloudQueue />}
              title="Gateway"
              description="Control-plane API and dependency status"
            />
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
                    {health.data?.status === "ok" ? "Healthy" : "Degraded"}
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                    version {health.data?.version ?? "unknown"}
                  </Typography>
                </Stack>
                <Stack spacing={0.8}>
                  {Object.entries(health.data?.dependencies ?? {}).map(
                    ([name, status]) => (
                      <DiagnosticRow
                        key={name}
                        label={name}
                        value={status}
                        good={status === "ok"}
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
                No remote host is registered. Add one from Remote hosts before
                running an Engine check.
              </Typography>
            )}
          </Paper>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <DiagnosticNote
              icon={<Security />}
              title="Credentials stay server-side"
              body="The renderer receives a host summary only. CA certificates, client keys, and Engine endpoints remain behind the gateway."
            />
            <DiagnosticNote
              icon={<Storage />}
              title="No local Engine fallback"
              body="A missing or offline remote host is reported as unavailable; the client does not silently switch to a local daemon."
            />
          </Stack>
        </Stack>
      )}
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
