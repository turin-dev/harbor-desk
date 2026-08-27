import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Login, OpenInNew, Refresh } from "@mui/icons-material";
import { useAuthProviders } from "../state/queries.js";

export function LoginScreen() {
  const {
    data: providers = [],
    isLoading,
    isError,
    refetch,
  } = useAuthProviders();
  const [starting, setStarting] = useState<string>();
  const [error, setError] = useState<string>();

  const login = async (providerId: string) => {
    setError(undefined);
    setStarting(providerId);
    try {
      const started = await window.harbor?.auth.startLogin(providerId);
      if (!started)
        setError(
          "The desktop login bridge is unavailable. Run Harbor Desk as an Electron application.",
        );
    } catch {
      setError("Could not open the identity provider login window.");
    } finally {
      setStarting(undefined);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 3,
        bgcolor: "background.default",
      }}
    >
      <Paper sx={{ width: "100%", maxWidth: 440, p: 3.5 }}>
        <Stack spacing={2.4}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.4,
                display: "grid",
                placeItems: "center",
                bgcolor: "secondary.main",
                color: "background.default",
              }}
            >
              <Login />
            </Box>
            <Box>
              <Typography variant="h5">Sign in to Harbor Desk</Typography>
              <Typography color="text.secondary" variant="body2">
                Choose the identity provider configured by your gateway
                administrator.
              </Typography>
            </Box>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          {isError && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<Refresh />}
                  onClick={() => void refetch()}
                >
                  Retry
                </Button>
              }
            >
              The gateway could not return its identity provider registry.
            </Alert>
          )}
          {!isLoading && !isError && providers.length === 0 && (
            <Alert severity="warning">
              No OIDC provider is configured. The gateway will not accept a
              production login until an administrator configures one.
            </Alert>
          )}
          <Stack spacing={1}>
            {isLoading ? (
              <Box sx={{ py: 2, textAlign: "center" }}>
                <CircularProgress
                  size={24}
                  aria-label="Loading identity providers"
                />
              </Box>
            ) : (
              providers.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outlined"
                  fullWidth
                  onClick={() => void login(provider.id)}
                  disabled={Boolean(starting)}
                  startIcon={
                    starting === provider.id ? (
                      <CircularProgress size={16} />
                    ) : (
                      <OpenInNew />
                    )
                  }
                  sx={{ justifyContent: "flex-start", py: 1.1 }}
                >
                  {provider.displayName}
                  <Typography
                    component="span"
                    color="text.secondary"
                    sx={{ ml: "auto", fontSize: 11 }}
                  >
                    {provider.issuer}
                  </Typography>
                </Button>
              ))
            )}
          </Stack>
          <Typography color="text.secondary" variant="caption">
            Access tokens stay in renderer memory. Refresh credentials, when
            issued, are encrypted by the operating system keychain.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
