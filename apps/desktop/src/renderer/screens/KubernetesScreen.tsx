import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Add, DeleteOutline, Refresh } from "@mui/icons-material";
import type {
  K8sCluster,
  K8sClusterRegistrationInput,
} from "@harbor/contracts";
import { PageHeader } from "../components/PageHeader.js";
import { StatusChip } from "../components/StatusChip.js";
import { formatTime } from "../format.js";
import {
  useK8sClusters,
  useK8sNamespaces,
  useK8sPods,
  useRegisterK8sCluster,
  useRemoveK8sCluster,
  useTestK8sCluster,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

const initialForm: K8sClusterRegistrationInput = {
  displayName: "",
  endpoint: "",
  token: "",
  ca: "",
  cert: "",
  key: "",
};

export function KubernetesScreen() {
  const { data: clusters = [], isLoading, isError, refetch } = useK8sClusters();
  const register = useRegisterK8sCluster();
  const remove = useRemoveK8sCluster();
  const test = useTestK8sCluster();
  const showToast = useUiStore((state) => state.showToast);
  const [selectedId, setSelectedId] = useState<string>();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<K8sClusterRegistrationInput>(initialForm);
  const [formError, setFormError] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<K8sCluster>();
  const [tab, setTab] = useState(0);
  const selected =
    clusters.find((item) => item.id === selectedId) ?? clusters[0];
  const namespaces = useK8sNamespaces(selected?.id);
  const pods = useK8sPods(selected?.id);

  const submit = () => {
    setFormError(undefined);
    if (!form.displayName.trim() || !form.endpoint.trim()) {
      setFormError("Display name and endpoint are required.");
      return;
    }
    register.mutate(
      {
        ...form,
        displayName: form.displayName.trim(),
        endpoint: form.endpoint.trim(),
      },
      {
        onSuccess: (cluster) => {
          setSelectedId(cluster.id);
          setOpen(false);
          setForm(initialForm);
          showToast(
            `${cluster.displayName} was registered (status: ${cluster.status}).`,
            "success",
          );
        },
        onError: (error) =>
          setFormError(
            error instanceof Error
              ? error.message
              : "Could not register cluster.",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Gateway / Kubernetes"
        title="Kubernetes clusters"
        description="Clusters are registered on the Server Gateway with bearer tokens or mTLS material. The gateway probes them read-only for version, namespaces, and pods — no kubeconfig is stored on this machine."
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
              onClick={() => setOpen(true)}
            >
              Register cluster
            </Button>
          </>
        }
      />
      {isError && (
        <Stack spacing={1.25} sx={{ mb: 2 }}>
          <Typography color="error" sx={{ fontSize: 13 }}>
            Could not load clusters from the gateway.
          </Typography>
          <Button
            color="error"
            variant="outlined"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </Stack>
      )}
      {isLoading ? (
        <Paper sx={{ p: 3 }}>
          <Typography color="text.secondary">Loading clusters…</Typography>
        </Paper>
      ) : clusters.length === 0 ? (
        <Paper sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 650 }}>
            No Kubernetes clusters registered
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.35, maxWidth: 760 }}>
            Register a cluster API server endpoint. Unreachable clusters are
            kept with an "offline" status so you can fix credentials or
            connectivity later.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          <Paper sx={{ overflow: "hidden" }}>
            <Table size="small" aria-label="Registered Kubernetes clusters">
              <TableHead>
                <TableRow>
                  <TableCell>Cluster</TableCell>
                  <TableCell>Endpoint</TableCell>
                  <TableCell>Mode</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Server version</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {clusters.map((cluster) => (
                  <TableRow
                    key={cluster.id}
                    hover
                    selected={selected?.id === cluster.id}
                    onClick={() => {
                      setSelectedId(cluster.id);
                      setTab(0);
                    }}
                  >
                    <TableCell sx={{ fontWeight: 620 }}>
                      {cluster.displayName}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                      {cluster.endpoint}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={cluster.connectionMode}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={cluster.status} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {cluster.serverVersion ?? "—"}
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        justifyContent="flex-end"
                      >
                        <Button
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            test.mutate(cluster.id, {
                              onSuccess: (result) =>
                                showToast(
                                  `${result.displayName}: ${result.status}`,
                                ),
                              onError: (error) =>
                                showToast(
                                  error instanceof Error
                                    ? error.message
                                    : "Cluster probe failed.",
                                  "error",
                                ),
                            });
                          }}
                          disabled={test.isPending}
                        >
                          Test
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteOutline fontSize="small" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRemoveTarget(cluster);
                          }}
                        >
                          Remove
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
          {selected && (
            <Paper sx={{ p: 1.5, overflow: "hidden" }}>
              <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
                <Tab label="Namespaces" />
                <Tab label="Pods" />
              </Tabs>
              <Box sx={{ mt: 1.25, maxHeight: 420, overflow: "auto" }}>
                {tab === 0 ? (
                  namespaces.isLoading ? (
                    <Typography color="text.secondary" sx={{ px: 1 }}>
                      Loading namespaces…
                    </Typography>
                  ) : namespaces.isError ? (
                    <Alert severity="warning" sx={{ mx: 1, mb: 1 }}>
                      {(namespaces.error as Error).message}
                    </Alert>
                  ) : (namespaces.data ?? []).length === 0 ? (
                    <Typography color="text.secondary" sx={{ px: 1, py: 1.5 }}>
                      No namespaces reported by the cluster.
                    </Typography>
                  ) : (
                    <Table size="small" aria-label="Kubernetes namespaces">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(namespaces.data ?? []).map((item) => (
                          <TableRow key={item.name} hover>
                            <TableCell
                              sx={{ fontFamily: "monospace", fontSize: 12 }}
                            >
                              {item.name}
                            </TableCell>
                            <TableCell>{item.status ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )
                ) : pods.isLoading ? (
                  <Typography color="text.secondary" sx={{ px: 1 }}>
                    Loading pods…
                  </Typography>
                ) : pods.isError ? (
                  <Alert severity="warning" sx={{ mx: 1, mb: 1 }}>
                    {(pods.error as Error).message}
                  </Alert>
                ) : (pods.data ?? []).length === 0 ? (
                  <Typography color="text.secondary" sx={{ px: 1, py: 1.5 }}>
                    No pods reported by the cluster.
                  </Typography>
                ) : (
                  <Table size="small" aria-label="Kubernetes pods">
                    <TableHead>
                      <TableRow>
                        <TableCell>Pod</TableCell>
                        <TableCell>Namespace</TableCell>
                        <TableCell>Phase</TableCell>
                        <TableCell>Node</TableCell>
                        <TableCell align="right">Restarts</TableCell>
                        <TableCell align="right">Ready</TableCell>
                        <TableCell>Image</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(pods.data ?? []).map((pod) => (
                        <TableRow key={pod.namespace + "/" + pod.name} hover>
                          <TableCell
                            sx={{ fontFamily: "monospace", fontSize: 12 }}
                          >
                            {pod.name}
                          </TableCell>
                          <TableCell>{pod.namespace}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={pod.phase}
                              color={
                                pod.phase === "Running"
                                  ? "success"
                                  : pod.phase === "Succeeded"
                                    ? "info"
                                    : "warning"
                              }
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            {pod.nodeName ?? "—"}
                          </TableCell>
                          <TableCell align="right">
                            {pod.restarts ?? 0}
                          </TableCell>
                          <TableCell align="right">
                            {pod.ready ? "yes" : "no"}
                          </TableCell>
                          <TableCell
                            sx={{ fontFamily: "monospace", fontSize: 11 }}
                          >
                            {pod.containerImage ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            </Paper>
          )}
        </Stack>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Register Kubernetes cluster</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Display name"
              value={form.displayName}
              onChange={(event) =>
                setForm({ ...form, displayName: event.target.value })
              }
            />
            <TextField
              label="API server endpoint"
              placeholder="https://10.0.0.10:6443"
              value={form.endpoint}
              onChange={(event) =>
                setForm({ ...form, endpoint: event.target.value })
              }
            />
            <TextField
              label="Bearer token (optional)"
              type="password"
              value={form.token ?? ""}
              onChange={(event) =>
                setForm({ ...form, token: event.target.value || undefined })
              }
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="CA bundle (optional, mTLS)"
                multiline
                minRows={2}
                value={form.ca ?? ""}
                onChange={(event) =>
                  setForm({ ...form, ca: event.target.value || undefined })
                }
              />
              <TextField
                label="Client certificate (optional, mTLS)"
                multiline
                minRows={2}
                value={form.cert ?? ""}
                onChange={(event) =>
                  setForm({ ...form, cert: event.target.value || undefined })
                }
              />
            </Stack>
            <TextField
              label="Client key (optional, mTLS)"
              multiline
              minRows={2}
              value={form.key ?? ""}
              onChange={(event) =>
                setForm({ ...form, key: event.target.value || undefined })
              }
            />
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              Credentials are stored in the gateway secret store. Plain HTTP
              endpoints are accepted for development and marked as such.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={register.isPending}
          >
            Register
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(undefined)}
      >
        <DialogTitle>Remove cluster</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Remove {removeTarget?.displayName} and its stored credentials from
            the gateway?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(undefined)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => {
              const target = removeTarget;
              if (!target) return;
              remove.mutate(target.id, {
                onSuccess: () => {
                  setRemoveTarget(undefined);
                  showToast(`${target.displayName} was removed.`, "success");
                },
                onError: (error) =>
                  showToast(
                    error instanceof Error
                      ? error.message
                      : "Could not remove cluster.",
                    "error",
                  ),
              });
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
