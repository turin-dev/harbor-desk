import { useState } from "react";
import { CloudDownload, Hub, Search } from "@mui/icons-material";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { HubSearchResult } from "@harbor/contracts";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  formatHubMetric,
  hubReference,
  normalizeHubQuery,
  sortHubResults,
} from "../hub-format.js";
import { GatewayClientError } from "../api/client.js";
import {
  useCancelOperation,
  useHosts,
  useHubSearch,
  useOperation,
  usePullImage,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

export function HubScreen() {
  const { data: hosts = [] } = useHosts();
  const storedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost =
    hosts.find((host) => host.id === storedHostId) ?? hosts[0];
  const selectedHostId = selectedHost?.id;
  const hostOnline =
    selectedHost?.status === "online" &&
    (selectedHost.capabilities.images ?? false);
  const pull = usePullImage(selectedHostId);
  const cancel = useCancelOperation();
  const showToast = useUiStore((state) => state.showToast);
  const [searchParams] = useSearchParams();
  const initialQuery = normalizeHubQuery(searchParams.get("q") ?? "");
  const [reference, setReference] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [pullTarget, setPullTarget] = useState<HubSearchResult>();
  const [pullReference, setPullReference] = useState("");
  const [pullError, setPullError] = useState<string>();
  const [pullOperationId, setPullOperationId] = useState<string>();
  const pullOperation = useOperation(pullOperationId);
  const pullActive =
    pull.isPending ||
    pullOperation?.status === "queued" ||
    pullOperation?.status === "running";
  const search = useHubSearch(submitted);
  const rows = sortHubResults(search.data?.results ?? []);
  const searchError =
    search.error instanceof GatewayClientError ? search.error : undefined;

  const startPull = (row: HubSearchResult) => {
    const image = hubReference(row);
    setPullReference(image);
    setPullError(undefined);
    setPullTarget(row);
  };

  const confirmPull = () => {
    const image = pullReference.trim();
    if (!image) {
      setPullError("An image reference is required.");
      return;
    }
    setPullError(undefined);
    const operationId = crypto.randomUUID();
    setPullOperationId(operationId);
    pull.mutate(
      { image, operationId },
      {
        onSuccess: (operation) => {
          setPullTarget(undefined);
          setPullReference("");
          setPullOperationId(undefined);
          if (operation.status === "succeeded") {
            showToast(
              `${image} pulled to ${selectedHost?.displayName ?? "the remote host"}.`,
              "success",
            );
            return;
          }
          if (operation.status === "cancelled") {
            showToast("Image pull cancelled.", "info");
            return;
          }
          showToast(operation.message ?? "Image pull failed.", "error");
        },
        onError: (error) =>
          setPullError(
            error instanceof Error ? error.message : "Image pull failed.",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Registry"
        title="Docker Hub"
        description="Search public Docker Hub repositories and pull a match through the selected remote Engine. No Hub credentials are stored by Harbor Desk."
      />
      {selectedHost && !hostOnline && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {selectedHost.displayName} is {selectedHost.status}. Search remains
          available, but pulls are disabled until it is online and advertises
          image support.
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, maxWidth: 640 }}>
        <TextField
          fullWidth
          size="small"
          label="Search repositories"
          placeholder="nginx, postgres, traefik \u2026"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setSubmitted(normalizeHubQuery(reference));
            }
          }}
        />
        <Button
          variant="contained"
          startIcon={<Search />}
          onClick={() => setSubmitted(normalizeHubQuery(reference))}
          disabled={!reference.trim() || search.isFetching}
        >
          {search.isFetching ? "Searching\u2026" : "Search"}
        </Button>
      </Stack>
      {search.isError && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void search.refetch()}
            >
              Retry
            </Button>
          }
          sx={{ mb: 1.5 }}
        >
          {searchError?.code === "hub_rate_limited"
            ? "Docker Hub is rate limiting search requests. Wait a moment, then retry."
            : searchError?.code === "hub_unavailable"
              ? "The Docker Hub search API could not be reached through the gateway. Check the Gateway host network access and retry."
              : (searchError?.message ?? "The Docker Hub search failed.")}
        </Alert>
      )}
      {!submitted && !search.isError && (
        <EmptyState
          icon={<Hub />}
          title="Discover images"
          description="Type a repository name above. Results come from the public Docker Hub search API via the gateway, and each row can be pulled straight to the selected remote host."
        />
      )}
      {submitted &&
        !search.isError &&
        !search.isFetching &&
        rows.length === 0 && (
          <EmptyState
            icon={<Search />}
            title="No repositories found"
            description={`Nothing on Docker Hub matched \u201C${submitted}\u201D. Check the spelling or try a broader query.`}
          />
        )}
      {submitted && rows.length > 0 && (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Docker Hub search results">
            <TableHead>
              <TableRow>
                <TableCell>Repository</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Stars</TableCell>
                <TableCell align="right">Pulls</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.repository} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 600 }}>
                        {row.repository}
                      </Typography>
                      {row.isOfficial && (
                        <Chip
                          label="Official"
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ maxWidth: 420 }}
                    >
                      {row.description ?? "\u2014"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatHubMetric(row.starCount)}
                  </TableCell>
                  <TableCell align="right">
                    {formatHubMetric(row.pullCount)}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={
                        hostOnline
                          ? "Pull to the selected remote host"
                          : "The selected host is offline or lacks image support"
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          startIcon={<CloudDownload />}
                          onClick={() => startPull(row)}
                          disabled={
                            !hostOnline ||
                            pullActive ||
                            pullTarget !== undefined
                          }
                        >
                          Pull
                        </Button>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <Dialog
        open={pullTarget !== undefined}
        onClose={() => !pullActive && setPullTarget(undefined)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Pull image to remote host</DialogTitle>
        <DialogContent>
          <Stack spacing={1.4} sx={{ pt: 1 }}>
            {pullError && <Alert severity="error">{pullError}</Alert>}
            {pullOperation?.status === "cancelled" && (
              <Alert severity="info">
                Image pull cancelled. The download was aborted on the remote
                host.
              </Alert>
            )}
            <TextField
              label="Image reference"
              value={pullReference}
              onChange={(event) => setPullReference(event.target.value)}
              helperText="Search matches pull by repository name; adjust the tag if a specific one is required."
              autoFocus
              disabled={pullActive}
            />
            {pullOperation &&
              (pullOperation.status === "queued" ||
                pullOperation.status === "running") && (
                <Stack spacing={1} sx={{ minWidth: 240 }}>
                  <Typography variant="body2" color="text.secondary">
                    {pullOperation.message ??
                      "Pull started. Waiting for registry progress."}
                  </Typography>
                  <LinearProgress
                    variant={
                      typeof pullOperation.progress === "number"
                        ? "determinate"
                        : "indeterminate"
                    }
                    value={pullOperation.progress}
                  />
                </Stack>
              )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (pullActive && pullOperationId) {
                cancel.mutate(pullOperationId, {
                  onSuccess: () => showToast("Image pull cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The pull could not be cancelled.",
                      "error",
                    ),
                });
                return;
              }
              setPullTarget(undefined);
            }}
            disabled={cancel.isPending}
          >
            {pullActive ? "Cancel pull" : "Cancel"}
          </Button>
          <Button
            variant="contained"
            onClick={confirmPull}
            disabled={pullActive}
          >
            {pull.isPending ? "Pulling\u2026" : "Pull image"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
