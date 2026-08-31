import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircleOutline,
  CloudQueue,
  Construction,
  DeveloperBoard,
  Extension,
  Notifications,
  Palette,
  Router,
  Security,
  Settings as SettingsIcon,
  Terminal,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Divider,
  Alert,
  Collapse,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { Host } from "@harbor/contracts";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import { useConnectionStatus, useHosts } from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

type SectionId =
  | "general"
  | "connection"
  | "remote-hosts"
  | "engine"
  | "builders"
  | "compose"
  | "kubernetes"
  | "extensions"
  | "security"
  | "ai"
  | "notifications";

const sections: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
  { id: "general", label: "General", icon: <SettingsIcon fontSize="small" /> },
  {
    id: "connection",
    label: "Connection",
    icon: <CloudQueue fontSize="small" />,
  },
  {
    id: "remote-hosts",
    label: "Hosts",
    icon: <Router fontSize="small" />,
  },
  {
    id: "engine",
    label: "Docker Engine",
    icon: <Construction fontSize="small" />,
  },
  { id: "builders", label: "Builders", icon: <Terminal fontSize="small" /> },
  { id: "compose", label: "Compose", icon: <Terminal fontSize="small" /> },
  {
    id: "kubernetes",
    label: "Kubernetes",
    icon: <DeveloperBoard fontSize="small" />,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: <Extension fontSize="small" />,
  },
  { id: "security", label: "Security", icon: <Security fontSize="small" /> },
  { id: "ai", label: "AI", icon: <Palette fontSize="small" /> },
  {
    id: "notifications",
    label: "Notifications",
    icon: <Notifications fontSize="small" />,
  },
];

export function SettingsScreen() {
  const navigate = useNavigate();
  const [active, setActive] = useState<SectionId>("general");
  const { data: hosts = [] } = useHosts();
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [hosts, selectedHostId],
  );

  return (
    <Box sx={{ px: 4, py: 2, maxWidth: 1_200 }}>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure the connection target and client preferences. Docker sockets and raw Engine requests are intentionally not exposed to the renderer."
      />
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="flex-start"
      >
        <Paper sx={{ p: 0.8, width: { xs: "100%", md: 215 }, flexShrink: 0 }}>
          <Stack spacing={0.25}>
            {sections.map((section) => (
              <Button
                key={section.id}
                onClick={() => setActive(section.id)}
                startIcon={section.icon}
                sx={{
                  justifyContent: "flex-start",
                  gap: 0.4,
                  px: 1.2,
                  py: 0.8,
                  color:
                    active === section.id ? "text.primary" : "text.secondary",
                  bgcolor:
                    active === section.id ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                {section.label}
              </Button>
            ))}
          </Stack>
        </Paper>
        <Paper sx={{ p: { xs: 2, md: 2.7 }, flex: 1, minWidth: 0 }}>
          {active === "general" && <GeneralSettings />}
          {active === "connection" && <ConnectionSettings />}
          {active === "remote-hosts" && (
            <RemoteHostSettings
              hosts={hosts}
              onOpenHosts={() => navigate("/hosts")}
            />
          )}
          {active === "engine" && <EngineSettings host={selectedHost} />}
          {active === "notifications" && <NotificationSettings />}
          {active === "builders" && (
            <UnavailableSettings
              title="Builders"
              icon={<Terminal />}
              description="BuildKit builder selection and inspect will be enabled when the gateway BuildKit adapter is configured."
            />
          )}
          {active === "compose" && (
            <UnavailableSettings
              title="Compose"
              icon={<Terminal />}
              description="Compose projects use a validated server-side worker. No Compose shell is exposed by this client."
            />
          )}
          {active === "kubernetes" && (
            <UnavailableSettings
              title="Kubernetes"
              icon={<DeveloperBoard />}
              description="Kubernetes clusters are registered on the Server Gateway with bearer tokens or mTLS material. Read-only probes cover version, namespaces, and pods; credentials never leave the gateway secret store."
            />
          )}
          {active === "extensions" && (
            <UnavailableSettings
              title="Extensions"
              icon={<Extension />}
              description="Only administrator-approved extensions appear in the gateway catalog. Extension web interfaces are rendered by the gateway, never by this client."
            />
          )}
          {active === "security" && (
            <UnavailableSettings
              title="Security"
              icon={<Security />}
              description="Trivy or Grype digest scan results will appear here after a scanner adapter is configured."
            />
          )}
          {active === "ai" && (
            <UnavailableSettings
              title="AI"
              icon={<Palette />}
              description="The assistant uses deterministic, rule-based analysis on the gateway — no LLM provider is required. Insights and proposed actions are applied through the same audited API."
            />
          )}
        </Paper>
      </Stack>
    </Box>
  );
}

function Heading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 2.2 }}>
      <Box
        sx={{
          width: 34,
          height: 34,
          display: "grid",
          placeItems: "center",
          color: "primary.main",
          bgcolor: "action.hover",
          borderRadius: 1.2,
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

function GeneralSettings() {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const launchAtLogin = useUiStore((state) => state.launchAtLogin);
  const setLaunchAtLogin = useUiStore((state) => state.setLaunchAtLogin);
  const automaticUpdateChecks = useUiStore(
    (state) => state.automaticUpdateChecks,
  );
  const setAutomaticUpdateChecks = useUiStore(
    (state) => state.setAutomaticUpdateChecks,
  );
  const includePreviewUpdates = useUiStore(
    (state) => state.includePreviewUpdates,
  );
  const setIncludePreviewUpdates = useUiStore(
    (state) => state.setIncludePreviewUpdates,
  );
  const fontSize = useUiStore((state) => state.terminalFontSize);
  const setFontSize = useUiStore((state) => state.setTerminalFontSize);
  return (
    <>
      <Heading
        icon={<SettingsIcon />}
        title="General"
        description="Preferences for this Windows client."
      />
      <Stack spacing={2.1}>
        <SettingRow
          title="Appearance"
          description="Use the system theme or choose a fixed mode."
        >
          <FormControl size="small">
            <Select
              value={themeMode}
              onChange={(event) =>
                setThemeMode(event.target.value as "light" | "dark" | "system")
              }
              aria-label="Theme"
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="light">Light</MenuItem>
              <MenuItem value="dark">Dark</MenuItem>
            </Select>
          </FormControl>
        </SettingRow>
        <Divider />
        <SettingRow
          title="Start Harbor Desk when I sign in"
          description="Uses the Windows login-item setting. It never starts a Docker Engine."
        >
          <Switch
            checked={launchAtLogin}
            onChange={(event) => {
              const enabled = event.target.checked;
              setLaunchAtLogin(enabled);
              const result = window.harbor?.setLaunchAtLogin(enabled);
              if (result)
                void result
                  .then((actual) => setLaunchAtLogin(actual))
                  .catch(() => setLaunchAtLogin(!enabled));
            }}
            inputProps={{ "aria-label": "Start Harbor Desk when I sign in" }}
          />
        </SettingRow>
        <Divider />
        <SettingRow
          title="Automatically check for updates"
          description="Checks public GitHub Release metadata when the client starts. It never downloads or installs an update automatically."
        >
          <Switch
            checked={automaticUpdateChecks}
            onChange={(event) => setAutomaticUpdateChecks(event.target.checked)}
            inputProps={{ "aria-label": "Automatically check for updates" }}
          />
        </SettingRow>
        <Divider />
        <SettingRow
          title="Include preview releases"
          description="Use the Harbor Desk preview channel for automatic and manual checks."
        >
          <Switch
            checked={includePreviewUpdates}
            onChange={(event) => setIncludePreviewUpdates(event.target.checked)}
            inputProps={{ "aria-label": "Include preview releases" }}
          />
        </SettingRow>
        <Divider />
        <SettingRow
          title="Terminal text size"
          description="Applies to the integrated terminal drawer."
        >
          <Select
            size="small"
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            aria-label="Terminal text size"
          >
            <MenuItem value={11}>Small</MenuItem>
            <MenuItem value={12}>Default</MenuItem>
            <MenuItem value={14}>Large</MenuItem>
          </Select>
        </SettingRow>
        <AlertLine text="Engine endpoints, certificates, and private keys are never stored in these client preferences." />
      </Stack>
    </>
  );
}

function ConnectionSettings() {
  const connection = useConnectionStatus();
  const showToast = useUiStore((state) => state.showToast);
  const [endpoint, setEndpoint] = useState("");
  const [displayName, setDisplayName] = useState("Docker Engine");
  const [ca, setCa] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (connection.data?.endpoint && !endpoint)
      setEndpoint(connection.data.endpoint);
  }, [connection.data?.endpoint, endpoint]);

  const detectedType =
    connection.data?.mode === "gateway"
      ? "Harbor Desk Gateway"
      : connection.data?.mode === "engine"
        ? "Docker Engine"
        : connection.data?.mode === "detecting"
          ? "Detecting…"
          : connection.data?.mode === "unconfigured"
            ? "Not configured"
            : "Unavailable";

  const configure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bridge = window.harbor?.connection;
    if (!bridge) {
      setError("Connection configuration is available in the desktop client.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const status = await bridge.configure({
        endpoint,
        displayName,
        ca,
        cert,
        key,
      });
      if (status.mode === "unavailable") {
        setError(status.message);
        showToast(status.message, "error");
      } else {
        showToast("Configured connection target detected.", "success");
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The connection target could not be configured.";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    const bridge = window.harbor?.connection;
    if (!bridge) {
      setError("Connection configuration is available in the desktop client.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await bridge.clear();
      showToast("Connection cleared.", "success");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The connection could not be cleared.";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Heading
        icon={<CloudQueue />}
        title="Connection"
        description="Enter one Gateway or Docker Engine target. Harbor Desk detects the type and routes every request through a Gateway."
      />
      <Stack component="form" spacing={1.8} onSubmit={configure}>
        <TextField
          fullWidth
          required
          label="Gateway or Docker Engine URL"
          placeholder="https://gateway.example.internal:4311 or npipe://./pipe/docker_engine"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          helperText="Gateway HTTP(S) URLs are used directly. Engine targets use a Local Gateway wrapper."
          inputProps={{ spellCheck: false }}
        />
        <TextField
          fullWidth
          label="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          helperText="Used as the automatically created dev-remote-engine host name in Engine mode."
        />
        <Button
          type="button"
          variant="text"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          sx={{ alignSelf: "flex-start" }}
        >
          {advanced
            ? "Hide advanced TLS settings"
            : "Show advanced TLS settings"}
        </Button>
        <Collapse in={advanced}>
          <Stack spacing={1.5}>
            <Alert severity="info">
              These fields are used only if the target is detected as a raw
              Docker Engine. Remote raw Engines must use HTTPS and require all
              three PEM values. Gateway targets discard them.
            </Alert>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="CA certificate"
              value={ca}
              onChange={(event) => setCa(event.target.value)}
              inputProps={{ spellCheck: false, autoComplete: "off" }}
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Client certificate"
              value={cert}
              onChange={(event) => setCert(event.target.value)}
              inputProps={{ spellCheck: false, autoComplete: "off" }}
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              type="password"
              label="Client private key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              inputProps={{ spellCheck: false, autoComplete: "new-password" }}
            />
          </Stack>
        </Collapse>

        {error && <Alert severity="error">{error}</Alert>}

        <Paper variant="outlined" sx={{ p: 1.6 }}>
          <Typography sx={{ fontWeight: 650, mb: 1.1 }}>
            Current connection
          </Typography>
          <Stack spacing={0.8}>
            <ConnectionValue label="Detected type" value={detectedType} />
            <ConnectionValue
              label="Active gateway"
              value={connection.data?.gatewayUrl ?? "Not active"}
            />
            <ConnectionValue
              label="Local gateway"
              value={connection.data?.localGateway ? "Running" : "Not running"}
            />
            <ConnectionValue
              label="Status"
              value={connection.data?.message ?? "Checking connection…"}
            />
          </Stack>
        </Paper>

        <Stack direction="row" spacing={1}>
          <Button
            type="submit"
            variant="contained"
            disabled={saving || !endpoint.trim()}
          >
            {saving ? "Detecting…" : "Detect and connect"}
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={clear}
            disabled={saving}
          >
            Clear connection
          </Button>
        </Stack>
      </Stack>
    </>
  );
}

function ConnectionValue({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography color="text.secondary" sx={{ fontSize: 11 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          maxWidth: "70%",
          textAlign: "right",
          fontFamily: "var(--dd-font-mono)",
          fontSize: 11,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function RemoteHostSettings({
  hosts,
  onOpenHosts,
}: {
  hosts: Array<{
    id: string;
    displayName: string;
    status: "online" | "offline" | "degraded" | "unknown";
    engineVersion?: string;
    connectionMode: string;
  }>;
  onOpenHosts: () => void;
}) {
  return (
    <>
      <Heading
        icon={<Router />}
        title="Hosts"
        description="Hosts returned by the active Server Gateway or the Local Gateway wrapper."
      />
      <Stack spacing={1}>
        {hosts.length ? (
          hosts.map((host) => (
            <Paper key={host.id} variant="outlined" sx={{ p: 1.4 }}>
              <Stack direction="row" spacing={1.2} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650 }}>
                    {host.displayName}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 11, mt: 0.25 }}
                  >
                    {host.engineVersion
                      ? `Engine ${host.engineVersion}`
                      : "No successful probe"}{" "}
                    ·{" "}
                    {host.connectionMode === "mtls"
                      ? "server-side mTLS"
                      : "development connector"}
                  </Typography>
                </Box>
                <StatusChip status={host.status} />
              </Stack>
            </Paper>
          ))
        ) : (
          <Typography color="text.secondary">
            No remote hosts are registered.
          </Typography>
        )}
        <Button
          variant="outlined"
          onClick={onOpenHosts}
          sx={{ alignSelf: "flex-start", mt: 0.7 }}
        >
          Manage connections
        </Button>
      </Stack>
    </>
  );
}

function EngineSettings({ host }: { host?: Host }) {
  return (
    <>
      <Heading
        icon={<Construction />}
        title="Docker Engine"
        description="Remote daemon information and capability policy for the selected host."
      />
      {host ? (
        <Stack spacing={1.3}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 650 }}>{host.displayName}</Typography>
            <StatusChip status={host.status} />
          </Stack>
          <SettingRow
            title="Engine version"
            description="Read from the server-side Engine probe."
          >
            <Typography sx={{ fontWeight: 650 }}>
              {host.engineVersion ?? "Unknown"}
            </Typography>
          </SettingRow>
          <SettingRow
            title="API compatibility"
            description="The gateway negotiates Engine API versions and gates unsupported features."
          >
            <Typography
              sx={{ fontFamily: "var(--dd-font-mono)", fontSize: 12 }}
            >
              {host.apiVersion ?? "Unknown"} / min{" "}
              {host.minApiVersion ?? "Unknown"}
            </Typography>
          </SettingRow>
          <Divider />
          <Typography sx={{ fontWeight: 650, fontSize: 12 }}>
            Capabilities
          </Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.7}>
            {Object.entries(host.capabilities).map(([key, enabled]) => (
              <Chip
                key={key}
                size="small"
                icon={enabled ? <CheckCircleOutline /> : undefined}
                label={`${key}: ${enabled ? "available" : "unsupported"}`}
                color={enabled ? "success" : "default"}
                variant={enabled ? "filled" : "outlined"}
              />
            ))}
          </Stack>
          <AlertLine text="Daemon JSON editing and remote host restart require an administrator action on the gateway; they are not local client operations." />
        </Stack>
      ) : (
        <Typography color="text.secondary">
          Select or register a remote host to view Engine capabilities.
        </Typography>
      )}
    </>
  );
}

function NotificationSettings() {
  const enabled = useUiStore((state) => state.showConnectionNotifications);
  const setEnabled = useUiStore(
    (state) => state.setShowConnectionNotifications,
  );
  const notifications = useUiStore((state) => state.notifications);
  const clear = useUiStore((state) => state.clearNotifications);
  return (
    <>
      <Heading
        icon={<Notifications />}
        title="Notifications"
        description="Control how this client presents remote events and connection changes."
      />
      <Stack spacing={2}>
        <SettingRow
          title="Show connection notifications"
          description="Keep remote host and Engine events in the notification center."
        >
          <Switch
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            inputProps={{ "aria-label": "Show connection notifications" }}
          />
        </SettingRow>
        <Divider />
        <SettingRow
          title="Session event history"
          description={`${notifications.length} event${notifications.length === 1 ? "" : "s"} retained in this client session.`}
        >
          <Button
            size="small"
            variant="outlined"
            onClick={clear}
            disabled={!notifications.length}
          >
            Clear history
          </Button>
        </SettingRow>
      </Stack>
    </>
  );
}

function UnavailableSettings({
  title,
  icon,
  description,
}: {
  title: string;
  icon: ReactNode;
  description: string;
}) {
  return (
    <>
      <Heading
        icon={icon}
        title={title}
        description="Remote-native configuration surface"
      />
      <Alert severity="info">{description}</Alert>
      <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 12 }}>
        No local fallback or simulated configuration is shown. When the
        corresponding server adapter is configured, this section can read and
        mutate only the allowed remote resources.
      </Typography>
    </>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      spacing={2}
      alignItems="center"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 620 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0 }}>{children}</Box>
    </Stack>
  );
}

function AlertLine({ text }: { text: string }) {
  return (
    <Box sx={{ px: 1.3, py: 1, borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography color="text.secondary" sx={{ fontSize: 11 }}>
        {text}
      </Typography>
    </Box>
  );
}
