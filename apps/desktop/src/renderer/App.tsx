import { useEffect, useMemo } from "react";
import {
  Box,
  CircularProgress,
  CssBaseline,
  ThemeProvider,
  useMediaQuery,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { createHarborTheme } from "@harbor/ui";
import { AppShell } from "./components/AppShell.js";
import { DashboardScreen } from "./screens/DashboardScreen.js";
import { ContainersScreen } from "./screens/ContainersScreen.js";
import { HostsScreen } from "./screens/HostsScreen.js";
import { ResourceScreen } from "./screens/ResourceScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { SurfaceScreen } from "./screens/SurfaceScreen.js";
import { TroubleshootScreen } from "./screens/TroubleshootScreen.js";
import { AboutScreen } from "./screens/AboutScreen.js";
import { useUiStore } from "./state/ui-store.js";
import { useCurrentUser } from "./state/queries.js";
import { GatewayClientError } from "./api/client.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { resolveAuthGateView } from "./bootstrap-state.js";

export function App() {
  const themeMode = useUiStore((state) => state.themeMode);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedMode =
    themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const theme = useMemo(() => createHarborTheme(resolvedMode), [resolvedMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode;
  }, [resolvedMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthGate />
    </ThemeProvider>
  );
}

function AuthGate() {
  const queryClient = useQueryClient();
  const { data: user, isPending, isFetched, error } = useCurrentUser();
  const view = resolveAuthGateView({
    hasUser: Boolean(user),
    isPending,
    hasCompletedRequest: isFetched,
    errorCode: error instanceof GatewayClientError ? error.code : undefined,
  });

  useEffect(() => {
    const unsubscribe = window.harbor?.auth.onChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    });
    return unsubscribe;
  }, [queryClient]);

  if (view === "checking")
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress aria-label="Checking session" />
      </Box>
    );
  if (view === "login") return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/containers" replace />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/containers" element={<ContainersScreen />} />
        <Route path="/hosts" element={<HostsScreen />} />
        <Route path="/images" element={<ResourceScreen kind="images" />} />
        <Route path="/volumes" element={<ResourceScreen kind="volumes" />} />
        <Route path="/networks" element={<ResourceScreen kind="networks" />} />
        <Route
          path="/builds"
          element={
            <SurfaceScreen
              title="Builds"
              eyebrow="BuildKit"
              capability="buildkit"
              description="Inspect active and completed remote builds, logs, artifacts, and builders."
            />
          }
        />
        <Route
          path="/kubernetes"
          element={
            <SurfaceScreen
              title="Kubernetes"
              eyebrow="Cluster resources"
              capability="kubernetes"
              description="Register clusters on the server and manage their resources without a local kubeconfig."
            />
          }
        />
        <Route
          path="/extensions"
          element={
            <SurfaceScreen
              title="Extensions"
              eyebrow="OCI catalog"
              capability="extensions"
              description="Install approved remote extensions and open their isolated web interfaces."
            />
          }
        />
        <Route
          path="/hub"
          element={
            <SurfaceScreen
              title="Registry"
              eyebrow="Image discovery"
              description="Search and move images through configured OCI registries and public Hub APIs."
            />
          }
        />
        <Route
          path="/security"
          element={
            <SurfaceScreen
              title="Image security"
              eyebrow="Digest scans"
              capability="imageScan"
              description="Review Trivy or Grype results attached to remote image digests."
            />
          }
        />
        <Route
          path="/assistant"
          element={
            <SurfaceScreen
              title="Assistant"
              eyebrow="Provider adapter"
              description="Use a configured LLM provider to inspect and propose safe container operations."
            />
          }
        />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/troubleshoot" element={<TroubleshootScreen />} />
        <Route path="/about" element={<AboutScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
