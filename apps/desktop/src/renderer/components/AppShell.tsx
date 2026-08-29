import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Apps,
  Build,
  CloudQueue,
  Code,
  CropSquare,
  Dashboard,
  DeveloperBoard,
  Extension,
  HelpOutline,
  History,
  Hub,
  Image,
  Lan,
  Logout,
  Menu as MenuIcon,
  Minimize,
  Refresh,
  Settings,
  Shield,
  Storage,
  SystemUpdateAlt,
  Terminal,
  Tune,
  Widgets,
  Close,
} from "@mui/icons-material";
import {
  AppBar,
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { Host, HostStatus } from "@harbor/contracts";
import type { DesktopConnectionStatus } from "../api/client.js";
import { useRemoteEventStream } from "../state/events.js";
import {
  useCurrentUser,
  useConnectionStatus,
  useHosts,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";
import { shouldShowInitialGatewayLoading } from "../bootstrap-state.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { QuickSearch } from "./QuickSearch.js";
import { TerminalDrawer } from "./TerminalDrawer.js";
import { ToastHost } from "./ToastHost.js";

const drawerWidth = 256;
const primaryNavigation = [
  {
    label: "Assistant",
    path: "/assistant",
    icon: <Widgets fontSize="small" />,
  },
  { label: "Containers", path: "/containers", icon: <Apps fontSize="small" /> },
  { label: "Images", path: "/images", icon: <Image fontSize="small" /> },
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: <Dashboard fontSize="small" />,
  },
  { label: "Volumes", path: "/volumes", icon: <Storage fontSize="small" /> },
  {
    label: "Kubernetes",
    path: "/kubernetes",
    icon: <DeveloperBoard fontSize="small" />,
  },
  { label: "Builds", path: "/builds", icon: <Build fontSize="small" /> },
  { label: "Networks", path: "/networks", icon: <Lan fontSize="small" /> },
  { label: "Registry", path: "/hub", icon: <Hub fontSize="small" /> },
  {
    label: "Image security",
    path: "/security",
    icon: <Shield fontSize="small" />,
  },
];

const secondaryNavigation = [
  {
    label: "Audit log",
    path: "/audit",
    icon: <History fontSize="small" />,
  },
  {
    label: "Extensions",
    path: "/extensions",
    icon: <Extension fontSize="small" />,
  },
];

function statusLabel(status: HostStatus): string {
  return status === "online"
    ? "Connected"
    : status === "offline"
      ? "Offline"
      : status === "degraded"
        ? "Degraded"
        : "Checking";
}

function initials(value: string | undefined): string {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return "HD";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function NavigationList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  const renderItem = (item: (typeof primaryNavigation)[number]) => {
    const selected = pathname === item.path;
    return (
      <ListItemButton
        key={item.path}
        selected={selected}
        onClick={() => onNavigate(item.path)}
        sx={{
          minHeight: 32,
          height: 32,
          mb: 0,
          px: 1.5,
          py: 0,
          borderRadius: 0,
          color: "rgba(244,247,251,0.9)",
          "& .MuiListItemIcon-root": { color: "inherit" },
          "&.Mui-selected": {
            bgcolor: "var(--dd-color-nav-active)",
            color: "#ffffff",
          },
          "&.Mui-selected:hover": { bgcolor: "var(--dd-color-nav-active)" },
          "&:hover": { bgcolor: "var(--dd-color-nav-hover)" },
        }}
      >
        <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
        <ListItemText
          primary={item.label}
          primaryTypographyProps={{
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: selected ? 500 : 400,
          }}
        />
      </ListItemButton>
    );
  };

  return (
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={{ height: "100%", overflowY: "auto", bgcolor: "var(--dd-color-nav)" }}
    >
      <List disablePadding sx={{ px: 2, pt: 2 }}>
        {primaryNavigation.map(renderItem)}
      </List>
      <Divider sx={{ mx: 2, my: 1, borderColor: "rgba(145,164,183,0.16)" }} />
      <List disablePadding sx={{ px: 2 }}>
        {secondaryNavigation.map(renderItem)}
      </List>
    </Box>
  );
}

function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <Box
      component="aside"
      sx={{
        width: drawerWidth,
        minWidth: drawerWidth,
        height: "100%",
        borderRight: 1,
        borderColor: "rgba(145,164,183,0.16)",
        bgcolor: "var(--dd-color-nav)",
      }}
    >
      <NavigationList pathname={pathname} onNavigate={onNavigate} />
    </Box>
  );
}

function ClientStatusBar({
  host,
  connectionUnavailable,
  connectionMode,
  terminalOpen,
  onToggleTerminal,
  onReconnect,
  reconnecting,
  updateStatus,
  onCheckUpdates,
  onOpenUpdate,
}: {
  host?: Host;
  connectionUnavailable: boolean;
  connectionMode?: DesktopConnectionStatus["mode"];
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onReconnect?: () => void;
  reconnecting: boolean;
  updateStatus: DesktopUpdateCheckStatus;
  onCheckUpdates: () => void;
  onOpenUpdate: () => void;
}) {
  const online = host?.status === "online";
  const modeLabel =
    connectionMode === "gateway"
      ? "Server Gateway"
      : connectionMode === "engine"
        ? "Local Gateway wrapper"
        : connectionMode === "detecting"
          ? "Detecting connection"
          : connectionUnavailable || connectionMode === "unavailable"
            ? "Connection unavailable"
            : "Not configured";
  const updateLabel =
    updateStatus.state === "checking"
      ? "Checking for updates…"
      : updateStatus.state === "available"
        ? `Update ${updateStatus.latestVersion} available`
        : updateStatus.state === "up-to-date"
          ? "Up to date"
          : updateStatus.state === "error"
            ? "Update check failed"
            : "Check for updates";
  return (
    <Box
      component="footer"
      sx={{
        height: "var(--dd-shell-statusbar-height)",
        minHeight: "var(--dd-shell-statusbar-height)",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 2,
        bgcolor: "#080e13",
        borderTop: 1,
        borderColor: "rgba(145,164,183,0.12)",
        color: "rgba(244,247,251,0.88)",
      }}
    >
      <CloudQueue
        sx={{
          fontSize: 15,
          color: connectionUnavailable
            ? "error.main"
            : online
              ? "#16bf9d"
              : "var(--dd-nav-muted)",
        }}
      />
      <Typography sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {connectionUnavailable
          ? "Connection unavailable"
          : host
            ? `${host.displayName} · ${statusLabel(host.status)}`
            : connectionMode === "engine"
              ? "Local Gateway ready · No Engine host"
              : connectionMode === "gateway"
                ? "Server Gateway ready · No host selected"
                : "Configure a connection"}
      </Typography>
      <Divider orientation="vertical" flexItem sx={{ my: 0.75 }} />
      <Typography
        color="text.secondary"
        sx={{ fontSize: 12, whiteSpace: "nowrap" }}
      >
        Client-first · {modeLabel}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {onReconnect && (
        <Button
          color="inherit"
          onClick={onReconnect}
          disabled={reconnecting}
          startIcon={
            reconnecting ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <Refresh sx={{ fontSize: 15 }} />
            )
          }
          sx={{
            minHeight: 30,
            px: 1,
            color: "inherit",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {reconnecting ? "Retrying…" : "Retry connection"}
        </Button>
      )}
      <Button
        color="inherit"
        onClick={onToggleTerminal}
        startIcon={<Terminal sx={{ fontSize: 16 }} />}
        sx={{
          minHeight: 30,
          px: 1,
          color: "inherit",
          fontSize: 13,
          fontWeight: terminalOpen ? 600 : 400,
        }}
      >
        Terminal
      </Button>
      <Divider orientation="vertical" flexItem sx={{ my: 0.75 }} />
      <Button
        color="inherit"
        onClick={
          updateStatus.state === "available" ? onOpenUpdate : onCheckUpdates
        }
        disabled={updateStatus.state === "checking"}
        startIcon={<SystemUpdateAlt sx={{ fontSize: 15 }} />}
        sx={{
          minHeight: 30,
          px: 1,
          color:
            updateStatus.state === "available"
              ? "warning.main"
              : "primary.main",
          fontSize: 12,
          fontWeight: updateStatus.state === "available" ? 650 : 400,
          whiteSpace: "nowrap",
        }}
      >
        {updateLabel}
      </Button>
    </Box>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useMediaQuery("(max-width: 1100px)");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const {
    data: hosts = [],
    isLoading: hostsLoading,
    isError: hostsError,
    isFetched: hostsFetched,
  } = useHosts();
  const { data: connection } = useConnectionStatus();
  const { data: user } = useCurrentUser();
  const showHostsLoading = shouldShowInitialGatewayLoading({
    isLoading: hostsLoading,
    hasCompletedRequest: hostsFetched,
  });
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const setSelectedHostId = useUiStore((state) => state.setSelectedHostId);
  const terminalOpen = useUiStore((state) => state.terminalOpen);
  const setTerminalOpen = useUiStore((state) => state.setTerminalOpen);
  const includePreviewUpdates = useUiStore(
    (state) => state.includePreviewUpdates,
  );
  const updateStatus = useUiStore((state) => state.updateStatus);
  const setUpdateStatus = useUiStore((state) => state.setUpdateStatus);
  const showToast = useUiStore((state) => state.showToast);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [hosts, selectedHostId],
  );

  useRemoteEventStream(selectedHost?.id);

  useEffect(() => {
    if (selectedHost?.id !== selectedHostId)
      setSelectedHostId(selectedHost?.id);
  }, [selectedHost?.id, selectedHostId, setSelectedHostId]);

  const navigateTo = (path: string) => {
    navigate(path);
    if (compact) setMobileOpen(false);
  };

  const signOut = () => {
    setAccountAnchor(null);
    const logout = window.harbor?.auth.logout();
    if (logout) void logout.catch(() => undefined);
  };

  const controlWindow = (action: "minimize" | "toggleMaximize" | "close") => {
    const operation = window.harbor?.windowControls?.[action];
    if (operation) void operation();
  };

  const checkForUpdates = () => {
    const updates = window.harbor?.updates;
    if (!updates) {
      showToast("Update checks are available in the desktop client.", "error");
      return;
    }
    void updates
      .check({ includePrerelease: includePreviewUpdates, manual: true })
      .then((status) => {
        setUpdateStatus(status);
        showToast(
          status.message,
          status.state === "error"
            ? "error"
            : status.state === "available"
              ? "info"
              : "success",
        );
      })
      .catch(() =>
        showToast("The desktop update service was unavailable.", "error"),
      );
  };

  const openAvailableUpdate = () => {
    const updates = window.harbor?.updates;
    if (!updates) {
      showToast("Update links are available in the desktop client.", "error");
      return;
    }
    void updates
      .openRelease()
      .then((opened) => {
        if (!opened)
          showToast("The verified release page was unavailable.", "error");
      })
      .catch(() =>
        showToast("The verified release page was unavailable.", "error"),
      );
  };

  const canReconnect = Boolean(
    window.harbor?.connection?.reconnect &&
    connection &&
    connection.mode === "unavailable",
  );
  const retryConnection = async () => {
    const reconnect = window.harbor?.connection?.reconnect;
    if (!reconnect || reconnecting) return;
    setReconnecting(true);
    try {
      const next = await reconnect();
      showToast(
        next.mode === "unavailable"
          ? next.message
          : "The saved connection is available again.",
        next.mode === "unavailable" ? "error" : "success",
      );
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

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        minHeight: 640,
        minWidth: 960,
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <AppBar
        position="static"
        elevation={0}
        component="header"
        sx={{
          height: "var(--dd-shell-topbar-height)",
          minHeight: "var(--dd-shell-topbar-height)",
          bgcolor: "var(--dd-color-header)",
          border: 0,
          color: "#ffffff",
          WebkitAppRegion: "drag",
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: "var(--dd-shell-topbar-height) !important",
            height: "var(--dd-shell-topbar-height)",
            position: "relative",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ width: drawerWidth, minWidth: drawerWidth, px: 3 }}
          >
            <Box
              sx={{
                width: 28,
                height: 28,
                display: "grid",
                placeItems: "center",
                borderRadius: 0.75,
                bgcolor: "#ffffff",
                color: "var(--dd-color-header)",
              }}
            >
              <Code sx={{ fontSize: 18 }} />
            </Box>
            <Typography
              sx={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" }}
            >
              Harbor Desk
            </Typography>
          </Stack>

          {compact && (
            <IconButton
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              sx={{ ml: 0.5, color: "inherit", WebkitAppRegion: "no-drag" }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          )}

          <Box
            sx={{
              position: "absolute",
              right: "456px",
              display: { xs: "none", md: "block" },
              WebkitAppRegion: "no-drag",
            }}
          >
            <QuickSearch hostId={selectedHost?.id} variant="topbar" />
          </Box>

          <Box sx={{ flex: 1 }} />
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.25}
            sx={{ pr: 0.5, WebkitAppRegion: "no-drag" }}
          >
            <Tooltip title="Help">
              <IconButton aria-label="Help" sx={{ color: "inherit" }}>
                <HelpOutline fontSize="small" />
              </IconButton>
            </Tooltip>
            <Box
              sx={{
                color: "inherit",
                "& .MuiIconButton-root": { color: "inherit" },
              }}
            >
              <NotificationCenter />
            </Box>
            <Tooltip title="Connections">
              <IconButton
                onClick={() => navigateTo("/hosts")}
                aria-label="Connection settings"
                sx={{ color: "inherit" }}
              >
                <Tune fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Settings">
              <IconButton
                onClick={() => navigateTo("/settings")}
                aria-label="Settings"
                sx={{ color: "inherit" }}
              >
                <Settings fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Connections">
              <IconButton
                onClick={() => navigateTo("/hosts")}
                aria-label="Choose remote host"
                sx={{ color: "inherit" }}
              >
                <Apps fontSize="small" />
              </IconButton>
            </Tooltip>
            <Divider
              orientation="vertical"
              flexItem
              sx={{ mx: 0.75, my: 1.5, borderColor: "rgba(255,255,255,0.22)" }}
            />
            <Button
              onClick={(event) => setAccountAnchor(event.currentTarget)}
              aria-label="Account menu"
              sx={{
                minWidth: 74,
                minHeight: 36,
                ml: 1,
                px: 1.25,
                color: "#061c49",
                bgcolor: "#ffffff",
                "&:hover": { bgcolor: "#e9f0ff" },
              }}
            >
              Account
            </Button>
            <Menu
              anchorEl={accountAnchor}
              open={Boolean(accountAnchor)}
              onClose={() => setAccountAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
              <Box sx={{ px: 2, py: 1.25, minWidth: 220 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Avatar
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor: "primary.main",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {initials(user?.displayName)}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>
                      {user?.displayName ?? "Harbor Desk account"}
                    </Typography>
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 11 }}
                      noWrap
                    >
                      {user?.email ?? "Gateway-authenticated session"}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
              <Divider />
              <MenuItem onClick={signOut}>
                <ListItemIcon>
                  <Logout fontSize="small" />
                </ListItemIcon>
                Sign out
              </MenuItem>
            </Menu>
            <IconButton
              aria-label="Minimize window"
              onClick={() => controlWindow("minimize")}
              sx={{
                width: 48,
                height: "var(--dd-shell-topbar-height)",
                borderRadius: 0,
                ml: 0.25,
                color: "inherit",
                "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
              }}
            >
              <Minimize sx={{ fontSize: 17 }} />
            </IconButton>
            <IconButton
              aria-label="Maximize or restore window"
              onClick={() => controlWindow("toggleMaximize")}
              sx={{
                width: 48,
                height: "var(--dd-shell-topbar-height)",
                borderRadius: 0,
                color: "inherit",
                "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
              }}
            >
              <CropSquare sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              aria-label="Close Harbor Desk"
              onClick={() => controlWindow("close")}
              sx={{
                width: 48,
                height: "var(--dd-shell-topbar-height)",
                borderRadius: 0,
                color: "inherit",
                "&:hover": { bgcolor: "#d63a4a" },
              }}
            >
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {compact ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                bgcolor: "var(--dd-color-nav)",
                border: 0,
              },
            }}
          >
            <NavigationList
              pathname={location.pathname}
              onNavigate={navigateTo}
            />
          </Drawer>
        ) : (
          <Sidebar pathname={location.pathname} onNavigate={navigateTo} />
        )}

        <Box component="main" sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {updateStatus.state === "available" && (
            <Alert
              severity="info"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={openAvailableUpdate}
                >
                  View release
                </Button>
              }
              sx={{ mx: 4, mt: 1.5 }}
            >
              {updateStatus.latestVersion
                ? `Harbor Desk ${updateStatus.latestVersion} is available.`
                : "A newer Harbor Desk release is available."}{" "}
              Review the release notes and checksums before downloading; the
              client will not install it automatically.
            </Alert>
          )}
          {(hostsError ||
            (selectedHost && selectedHost.status !== "online")) && (
            <Box sx={{ px: 4, pt: 1.5 }}>
              <Typography
                color={hostsError ? "error" : "warning.main"}
                sx={{ fontSize: 13 }}
              >
                {hostsError
                  ? connection?.mode === "unconfigured"
                    ? "Open Connections and click Connect Docker Engine to configure a Gateway or Docker Engine target."
                    : connection?.mode === "engine"
                      ? "The local Gateway wrapper is unavailable. Open Troubleshoot for connection details."
                      : connection?.mode === "gateway"
                        ? "The configured server Gateway is unavailable. Open Troubleshoot for connection details."
                        : (connection?.message ??
                          "The configured connection is unavailable. Open Troubleshoot for details.")
                  : selectedHost
                    ? `${selectedHost.displayName}: ${statusLabel(selectedHost.status)}. Cached data is read-only.`
                    : "No remote host is selected."}
              </Typography>
            </Box>
          )}
          {showHostsLoading && !hosts.length ? (
            <Box sx={{ px: 4, py: 2.5 }}>
              <Typography color="text.secondary">
                {connection?.mode === "engine"
                  ? "Starting the local Gateway wrapper…"
                  : connection?.mode === "gateway"
                    ? "Connecting to the configured Gateway…"
                    : connection?.mode === "detecting"
                      ? "Detecting the configured connection…"
                      : "Configure a Gateway or Docker Engine connection…"}
              </Typography>
            </Box>
          ) : (
            <Outlet />
          )}
          <TerminalDrawer host={selectedHost} />
          <ToastHost />
        </Box>
      </Box>

      <ClientStatusBar
        host={selectedHost}
        connectionUnavailable={
          hostsError ||
          connection?.mode === "unavailable" ||
          connection?.mode === "unconfigured"
        }
        connectionMode={connection?.mode}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onReconnect={canReconnect ? () => void retryConnection() : undefined}
        reconnecting={reconnecting}
        updateStatus={updateStatus}
        onCheckUpdates={checkForUpdates}
        onOpenUpdate={openAvailableUpdate}
      />
    </Box>
  );
}
