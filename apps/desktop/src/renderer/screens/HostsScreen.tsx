import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Add, DeleteOutline, Dns, Refresh } from "@mui/icons-material";
import type { Host, HostRegistrationInput } from "@harbor/contracts";
import { ConnectionTargetDialog } from "../components/ConnectionTargetDialog.js";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import {
  useAddHost,
  useConnectionStatus,
  useHosts,
  useRemoveHost,
  useTestHost,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

const initialForm: HostRegistrationInput = {
  displayName: "",
  endpoint: "",
  ca: "",
  cert: "",
  key: "",
};

export function HostsScreen() {
  const { data: hosts = [], isLoading, refetch } = useHosts();
  const connection = useConnectionStatus();
  const addHost = useAddHost();
  const testHost = useTestHost();
  const removeHost = useRemoveHost();
  const showToast = useUiStore((state) => state.showToast);
  const setSelectedHostId = useUiStore((state) => state.setSelectedHostId);
  const [open, setOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [form, setForm] = useState<HostRegistrationInput>(initialForm);
  const [formError, setFormError] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<Host>();
  const localEngineMode = connection.data?.mode === "engine";

  const submit = () => {
    setFormError(undefined);
    if (!form.displayName.trim() || !form.endpoint.trim()) {
      setFormError("Display name and endpoint are required.");
      return;
    }
    addHost.mutate(
      {
        ...form,
        displayName: form.displayName.trim(),
        endpoint: form.endpoint.trim(),
      },
      {
        onSuccess: (host) => {
          setSelectedHostId(host.id);
          setOpen(false);
          setForm(initialForm);
          showToast(`${host.displayName} was registered.`, "success");
        },
        onError: (error) =>
          setFormError(
            error instanceof Error ? error.message : "Could not add host.",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Connections"
        title="Docker Engine connections"
        description="Hosts are managed by the active Server Gateway or Local Gateway wrapper. Engine endpoints and mTLS keys stay behind that policy boundary."
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void refetch()}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setConnectionOpen(true)}
            >
              {connection.data?.mode === "unconfigured" ||
              connection.data?.mode === "unavailable"
                ? "Connect Docker Engine"
                : "Change connection"}
            </Button>
            {!localEngineMode && connection.data?.mode === "gateway" && (
              <Button variant="outlined" onClick={() => setOpen(true)}>
                Add remote host
              </Button>
            )}
          </>
        }
      />
      {localEngineMode && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This host was created automatically from the Docker Engine target in
          Settings. Change that target there; the raw Engine endpoint is not
          registered as a separate client connection.
        </Alert>
      )}
      {hosts.length === 0 && !isLoading ? (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Dns color="primary" />
            <Box>
              <Typography sx={{ fontWeight: 650 }}>
                Gateway ready · No Engine host connected
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.35 }}>
                Add an HTTPS Engine endpoint with the credentials required by
                the active Gateway. Raw Engine targets entered in Settings are
                wrapped locally and do not appear as a second raw connection.
              </Typography>
            </Box>
          </Stack>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {hosts.map((host) => (
            <Paper key={host.id} sx={{ p: 1.8 }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: 1.2,
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "action.hover",
                  }}
                >
                  <Dns fontSize="small" />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650 }}>
                    {host.displayName}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 11, mt: 0.25 }}
                  >
                    {host.engineVersion
                      ? `Engine ${host.engineVersion} · API ${host.apiVersion}`
                      : "No successful probe yet"}{" "}
                    ·{" "}
                    {host.connectionMode === "mtls"
                      ? "server-side mTLS"
                      : host.connectionMode === "development-socket"
                        ? "development socket"
                        : "development HTTP"}
                  </Typography>
                </Box>
                <StatusChip status={host.status} />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSelectedHostId(host.id);
                    testHost.mutate(host.id, {
                      onSuccess: (updated) =>
                        showToast(
                          updated.status === "online"
                            ? `${updated.displayName} is online.`
                            : `${updated.displayName} is ${updated.status}.`,
                          updated.status === "online" ? "success" : "warning",
                        ),
                      onError: (error) =>
                        showToast(
                          error instanceof Error
                            ? error.message
                            : "Connection test failed.",
                          "error",
                        ),
                    });
                  }}
                  disabled={
                    localEngineMode ||
                    testHost.isPending ||
                    removeHost.isPending
                  }
                >
                  {testHost.isPending ? "Testing…" : "Test connection"}
                </Button>
                <Tooltip title="Remove host">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setRemoveTarget(host)}
                    disabled={localEngineMode || removeHost.isPending}
                    aria-label={`Remove ${host.displayName}`}
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      <ConnectionTargetDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
      />
      <Dialog
        open={open}
        onClose={() => !addHost.isPending && setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Add remote host</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <Alert severity="info">
              For production, use an HTTPS Engine endpoint with mTLS. Private
              keys are sent to the gateway only over the configured API
              connection and are never returned to the client.
            </Alert>
            <TextField
              label="Display name"
              value={form.displayName}
              onChange={(event) =>
                setForm({ ...form, displayName: event.target.value })
              }
              autoFocus
            />
            <TextField
              label="Engine endpoint"
              placeholder="https://engine.internal.example:2376"
              value={form.endpoint}
              onChange={(event) =>
                setForm({ ...form, endpoint: event.target.value })
              }
              helperText="Use http:// only for a loopback development connector."
            />
            <Divider>
              <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                Optional mTLS material
              </Typography>
            </Divider>
            <TextField
              label="CA certificate"
              multiline
              minRows={2}
              value={form.ca}
              onChange={(event) => setForm({ ...form, ca: event.target.value })}
            />
            <TextField
              label="Client certificate"
              multiline
              minRows={2}
              value={form.cert}
              onChange={(event) =>
                setForm({ ...form, cert: event.target.value })
              }
            />
            <TextField
              label="Client private key"
              multiline
              minRows={2}
              value={form.key}
              onChange={(event) =>
                setForm({ ...form, key: event.target.value })
              }
              type="password"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={addHost.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            variant="contained"
            disabled={addHost.isPending}
          >
            {addHost.isPending ? "Registering…" : "Register host"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(removeTarget)}
        onClose={() => !removeHost.isPending && setRemoveTarget(undefined)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Remove remote host?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {removeTarget
              ? `Remove ${removeTarget.displayName} from this gateway session? The server-side host record and stored credentials will be deleted.`
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setRemoveTarget(undefined)}
            disabled={removeHost.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (!removeTarget) return;
              removeHost.mutate(removeTarget.id, {
                onSuccess: () => {
                  showToast(
                    `${removeTarget.displayName} was removed.`,
                    "success",
                  );
                  setRemoveTarget(undefined);
                },
                onError: (error) =>
                  showToast(
                    error instanceof Error
                      ? error.message
                      : "Could not remove host.",
                    "error",
                  ),
              });
            }}
            disabled={removeHost.isPending}
          >
            {removeHost.isPending ? "Removing…" : "Remove host"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
