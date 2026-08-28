import { useState } from "react";
import { Code, ContentCopy, OpenInNew, Security } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { PageHeader } from "../components/PageHeader.js";
import {
  useDesktopGatewayRuntime,
  useGatewayHealth,
  useHosts,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

export function AboutScreen() {
  const health = useGatewayHealth();
  const runtime = useDesktopGatewayRuntime();
  const { data: hosts = [] } = useHosts();
  const showToast = useUiStore((state) => state.showToast);
  const [copied, setCopied] = useState(false);
  const clientVersion = window.harbor?.version ?? "development";
  const diagnostic = JSON.stringify(
    {
      client: clientVersion,
      platform: window.harbor?.platform ?? "browser",
      gateway: health.data?.version ?? "unavailable",
      gatewayStatus: health.data?.status ?? "unavailable",
      gatewayRuntime: runtime.data?.state ?? "unavailable",
      hostCount: hosts.length,
      hostStatuses: hosts.map((host) => ({ id: host.id, status: host.status })),
    },
    null,
    2,
  );

  const copyDiagnostics = () => {
    void navigator.clipboard
      ?.writeText(diagnostic)
      .then(() => {
        setCopied(true);
        showToast("Diagnostic summary copied.", "success");
        window.setTimeout(() => setCopied(false), 2_000);
      })
      .catch(() => showToast("Clipboard access was unavailable.", "error"));
  };

  const openExternal = (url: string) => {
    void window.harbor?.openExternal(url);
  };

  return (
    <Box sx={{ px: 4, py: 2, maxWidth: 900 }}>
      <PageHeader
        eyebrow="Harbor Desk"
        title="About"
        description="A client-first Apache-2.0 operations app that automatically starts its loopback gateway."
      />
      <Stack spacing={2}>
        <Paper sx={{ p: 3 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 52,
                height: 52,
                display: "grid",
                placeItems: "center",
                borderRadius: 2,
                bgcolor: "primary.main",
                color: "background.paper",
              }}
            >
              <Code sx={{ fontSize: 29 }} />
            </Box>
            <Box>
              <Typography variant="h5">Harbor Desk</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.3 }}>
                Remote operations console · client {clientVersion}
              </Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 2.2 }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={4}>
            <VersionRow
              label="Client platform"
              value={window.harbor?.platform ?? "Browser preview"}
            />
            <VersionRow
              label="Gateway"
              value={health.data?.version ?? "Unavailable"}
            />
            <VersionRow
              label="Gateway runtime"
              value={runtime.data?.state ?? "Unavailable"}
            />
            <VersionRow label="Registered hosts" value={String(hosts.length)} />
          </Stack>
        </Paper>

        <Paper sx={{ p: 2.2 }}>
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Security color="primary" />
            <Box>
              <Typography sx={{ fontWeight: 700 }}>
                Client-first gateway boundary
              </Typography>
              <Typography
                color="text.secondary"
                sx={{ mt: 0.45, maxWidth: 720 }}
              >
                Harbor Desk starts a token-protected gateway on 127.0.0.1 before
                opening the interface. The renderer still has no Docker CLI,
                Docker socket, or direct daemon access; stored Engine
                credentials and selected hosts remain gateway policy data.
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2.2 }}>
          <Typography sx={{ fontWeight: 700 }}>Support diagnostics</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.45 }}>
            Copy a redacted summary for troubleshooting. It contains no
            endpoint, certificate, token, or command output.
          </Typography>
          <Button
            sx={{ mt: 1.4 }}
            variant="outlined"
            startIcon={copied ? undefined : <ContentCopy />}
            onClick={copyDiagnostics}
          >
            {copied ? "Copied" : "Copy diagnostic summary"}
          </Button>
        </Paper>

        <Alert severity="info">
          Harbor Desk is licensed under Apache-2.0. Docker is a trademark of
          Docker, Inc.; this project is independent and does not include Docker
          proprietary assets.
        </Alert>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="text"
            endIcon={<OpenInNew />}
            onClick={() => openExternal("https://docs.docker.com/engine/api/")}
          >
            Engine API reference
          </Button>
          <Button
            variant="text"
            endIcon={<OpenInNew />}
            onClick={() =>
              openExternal(
                "https://docs.docker.com/engine/security/protect-access/",
              )
            }
          >
            Engine TLS guidance
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography color="text.secondary" sx={{ fontSize: 10.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 650, mt: 0.25 }}>{value}</Typography>
    </Box>
  );
}
