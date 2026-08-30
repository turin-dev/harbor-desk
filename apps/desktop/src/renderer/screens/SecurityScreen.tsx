import { useMemo, useState } from "react";
import {
  Fingerprint,
  ScannerOutlined,
  Search,
  ShieldOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { ImageSummary } from "@harbor/contracts";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import { filterRowsByQuery } from "../filter-rows.js";
import {
  useCancelOperation,
  useCurrentUser,
  useHosts,
  useImageInspect,
  useImages,
  useOperation,
  useScanImage,
  useScanReport,
} from "../state/queries.js";
import { formatBytes, formatDate } from "../format.js";
import { useUiStore } from "../state/ui-store.js";
import {
  connectionModeSummary,
  digestGate,
  digestSuffix,
  hostTrustFacts,
  summarizeImageSecurity,
  type ImageSecurityFacts,
} from "./security-facts.js";
import { describeScanOutcome, topVulnerabilities } from "./scan-report.js";

export function SecurityScreen() {
  const [searchParams] = useSearchParams();
  const { data: hosts = [] } = useHosts();
  const storedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost =
    hosts.find((host) => host.id === storedHostId) ?? hosts[0];
  const hostId = selectedHost?.id;
  const hostOnline = selectedHost?.status === "online";
  const imagesCapability = selectedHost?.capabilities.images ?? false;
  const imageScanCapability = selectedHost?.capabilities.imageScan ?? false;
  const { data: user } = useCurrentUser();
  const canScan =
    imageScanCapability && hostOnline && (user?.role ?? "viewer") !== "viewer";
  const {
    data: images = [],
    isPending,
    isError,
    error,
  } = useImages(hostId, Boolean(hostId && hostOnline && imagesCapability));
  const trust = hostTrustFacts(selectedHost);
  const [selected, setSelected] = useState<ImageSecurityFacts>();
  const [filter, setFilter] = useState(searchParams.get("q") ?? "");
  const selectedInspect = useImageInspect(
    hostId,
    selected?.image.id ?? undefined,
  );
  const selectedFacts = useMemo(
    () =>
      selected
        ? summarizeImageSecurity(selected.image, selectedInspect)
        : undefined,
    [selected, selectedInspect],
  );
  const normalized = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      filterRowsByQuery(
        images,
        (row) => [row.repository, row.tag, row.digest ?? row.id],
        normalized,
      ),
    [images, normalized],
  );

  if (!hosts.length)
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow="Workspace"
          title="Image security"
          description="Review digest pinning and Engine image facts."
        />
        <EmptyState
          title="No remote host"
          description="Add a remote host before opening this view."
        />
      </Box>
    );

  if (selectedHost && !imagesCapability)
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow="Workspace / Image security"
          title="Image security"
          description="Review digest pinning and Engine image facts."
        />
        <EmptyState
          title="Capability unavailable"
          description="The selected host does not advertise the images capability, so image security facts cannot be read."
        />
      </Box>
    );

  const pinnedCount = images.filter(
    (image) => summarizeImageSecurity(image, {}).digestPinned,
  ).length;

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Image security"
        title="Image security"
        description={
          imageScanCapability
            ? "Engine security facts plus Trivy vulnerability scans. Scans run as a short-lived scan container on the remote host and are removed when they settle."
            : "Read-only security facts derived from the Engine: content digests, image architecture, and host connection trust. The selected host does not advertise the imageScan capability."
        }
        actions={
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="Filter repository, tag, or digest"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 260 }}
              aria-label="Filter image security facts"
            />
            {hosts.length > 1 && (
              <Select
                size="small"
                value={hostId ?? ""}
                onChange={(event) =>
                  useUiStore
                    .getState()
                    .setSelectedHostId(event.target.value as string)
                }
                sx={{ minWidth: 200 }}
                aria-label="Select security host"
              >
                {hosts.map((host) => (
                  <MenuItem key={host.id} value={host.id}>
                    {host.displayName} ({host.status})
                  </MenuItem>
                ))}
              </Select>
            )}
          </Stack>
        }
      />
      {trust && (
        <Paper sx={{ p: 2, mb: 2 }} aria-label="Host connection trust">
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ShieldOutlined sx={{ color: "text.primary" }} />
              <Typography variant="body1" sx={{ fontWeight: 650 }}>
                {"Connection trust: " +
                  connectionModeSummary(trust.connectionMode).label}
              </Typography>
              {trust.developmentConnection && (
                <Alert severity="warning" sx={{ mb: 0 }}>
                  Development connection
                </Alert>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {connectionModeSummary(trust.connectionMode).detail}
              {trust.engineVersion
                ? " Engine " +
                  trust.engineVersion +
                  ", API " +
                  (trust.apiVersion ?? "unknown") +
                  "."
                : ""}
              {trust.lastSeenAt
                ? " Last seen " + formatDate(trust.lastSeenAt) + "."
                : ""}
            </Typography>
          </Stack>
        </Paper>
      )}
      {selectedHost && hostOnline && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {pinnedCount} of {images.length} image
          {images.length === 1 ? "" : "s"} are pinned to a content digest.
          Digests make pulls reproducible; tag names can be re-pointed by their
          owners.
        </Alert>
      )}
      {isPending ? (
        <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
          <CircularProgress aria-label="Loading image security facts" />
        </Box>
      ) : isError ? (
        <Alert severity="error">
          {error instanceof Error
            ? error.message
            : "Image security facts could not be loaded."}
        </Alert>
      ) : rows.length ? (
        <Paper sx={{ p: 2 }}>
          <Table aria-label="Image security facts">
            <TableHead>
              <TableRow>
                <TableCell>Image</TableCell>
                <TableCell>Digest</TableCell>
                <TableCell align="right">Layers</TableCell>
                <TableCell>OS / Arch</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Digest pin</TableCell>
                <TableCell align="right"></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((image) => {
                const facts = summarizeImageSecurity(image, {});
                const gate = digestGate(facts);
                const pinned = facts.digestPinned;
                return (
                  <TableRow
                    key={image.id + image.tag}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSelected(facts)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelected(facts);
                    }}
                  >
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>
                        {image.repository + ":" + image.tag}
                      </Typography>
                    </TableCell>
                    <TableCell>{digestSuffix(facts.digest) ?? "—"}</TableCell>
                    <TableCell align="right">
                      {facts.layerCount ?? "—"}
                    </TableCell>
                    <TableCell>
                      {facts.os ? facts.os + "/" + (facts.arch ?? "?") : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {formatBytes(image.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <Typography
                        sx={{
                          color: pinned ? "success.main" : "warning.main",
                          fontWeight: 650,
                        }}
                        component="span"
                      >
                        {pinned ? "Pinned" : "Tag only"}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                      >
                        {pinned ? "" : (gate.pass.message ?? "").slice(0, 48)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      ) : (
        <EmptyState
          icon={<Fingerprint />}
          title={normalized ? "No matching images" : "No images on this host"}
          description={
            normalized
              ? "No image matches the current filter."
              : "Pull or build an image first; its digest facts appear here automatically."
          }
        />
      )}
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedFacts
            ? selectedFacts.image.repository + ":" + selectedFacts.image.tag
            : "Image"}
        </DialogTitle>
        <DialogContent>
          {selectedFacts ? (
            <>
              <SecurityDetail facts={selectedFacts} />
              <ScanSection
                key={selectedFacts.image.id}
                imageRef={
                  selectedFacts.image.repository + ":" + selectedFacts.image.tag
                }
                hostId={hostId}
                canScan={canScan}
              />
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(undefined)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface ScanAttempt {
  operationId: string;
}

function severityChipColor(
  severity: string,
): "error" | "warning" | "info" | "default" {
  if (severity === "CRITICAL" || severity === "HIGH") return "error";
  if (severity === "MEDIUM") return "warning";
  if (severity === "LOW") return "info";
  return "default";
}

function ScanSection({
  imageRef,
  hostId,
  canScan,
}: {
  imageRef: string;
  hostId?: string;
  canScan: boolean;
}) {
  const [attempt, setAttempt] = useState<ScanAttempt>();
  const scan = useScanImage(hostId);
  const cancel = useCancelOperation();
  const operation = useOperation(attempt?.operationId);
  const reportQuery = useScanReport(
    hostId,
    operation?.status === "succeeded" ? attempt?.operationId : undefined,
  );
  const report = reportQuery.data;
  const running =
    scan.isPending ||
    operation?.status === "queued" ||
    operation?.status === "running";
  const outcome =
    !running && attempt ? describeScanOutcome(operation, report) : undefined;

  const startScan = () => {
    const operationId = crypto.randomUUID();
    setAttempt({ operationId });
    scan.mutate({ image: imageRef, operationId });
  };

  return (
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          Vulnerability scan
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ScannerOutlined />}
          onClick={startScan}
          disabled={!canScan || running}
        >
          {running ? "Scanning…" : "Run vulnerability scan"}
        </Button>
      </Stack>
      {!canScan && (
        <Typography variant="caption" color="text.secondary">
          Scans require the imageScan capability, an online host, and a
          non-viewer role.
        </Typography>
      )}
      {running && attempt && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {operation?.message ?? "Starting the Trivy scan container."}
          </Typography>
          <LinearProgress
            variant={
              typeof operation?.progress === "number"
                ? "determinate"
                : "indeterminate"
            }
            value={operation?.progress}
          />
          <Button
            size="small"
            color="inherit"
            onClick={() => cancel.mutate(attempt.operationId)}
            disabled={cancel.isPending}
          >
            Cancel scan
          </Button>
        </Stack>
      )}
      {outcome && (
        <Alert severity={outcome.tone} onClose={() => setAttempt(undefined)}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {outcome.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {outcome.body}
            </Typography>
          </Box>
        </Alert>
      )}
      {report && !report.partial && report.vulnerabilities.length > 0 && (
        <Stack spacing={0.75}>
          {topVulnerabilities(report, 10).map((vulnerability) => (
            <Stack
              key={vulnerability.vulnerabilityId + vulnerability.package}
              direction="row"
              spacing={1}
              alignItems="baseline"
            >
              <Chip
                label={vulnerability.severity.toLowerCase()}
                size="small"
                color={severityChipColor(vulnerability.severity)}
                sx={{ height: 18, fontSize: 11 }}
              />
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, fontFamily: "monospace" }}
                component="span"
              >
                {vulnerability.vulnerabilityId}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {vulnerability.package}
                {vulnerability.installedVersion
                  ? " " + vulnerability.installedVersion
                  : ""}
                {vulnerability.fixedVersion
                  ? " → " + vulnerability.fixedVersion
                  : ""}
              </Typography>
            </Stack>
          ))}
          {report.totalVulnerabilities > 10 && (
            <Typography variant="caption" color="text.secondary">
              Showing 10 of {report.totalVulnerabilities} vulnerabilities.
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function SecurityDetail({ facts }: { facts: ImageSecurityFacts }) {
  const gate = digestGate(facts);
  const rows: Array<{ label: string; value: string }> = [
    { label: "Image ID", value: facts.image.id },
    {
      label: "Content digest",
      value: facts.digest ?? "not recorded by the Engine",
    },
    {
      label: "Layers",
      value: facts.inspectPending
        ? "inspecting…"
        : String(facts.layerCount ?? "—"),
    },
    {
      label: "OS / Architecture",
      value: facts.os
        ? facts.os + "/" + (facts.arch ?? "unknown")
        : facts.inspectPending
          ? "inspecting…"
          : "—",
    },
    { label: "Size", value: formatBytes(facts.image.sizeBytes) },
    { label: "Created", value: formatDate(facts.image.createdAt) },
  ];
  return (
    <Stack spacing={2} sx={{ mt: 0.5 }}>
      {facts.inspectUnavailable && !facts.inspectPending && (
        <Alert severity="warning">
          The Engine inspect endpoint was unavailable; layer and architecture
          facts could not be read.
        </Alert>
      )}
      {facts.digestPinned ? (
        <Alert severity="success">{gate.warn.message}</Alert>
      ) : (
        <Alert severity="warning">{gate.pass.message}</Alert>
      )}
      <Stack spacing={1.25}>
        {rows.map((row) => (
          <Stack
            key={row.label}
            direction="row"
            justifyContent="space-between"
            gap={2}
          >
            <Typography variant="body2" color="text.secondary" component="span">
              {row.label}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                wordBreak: "break-all",
                textAlign: "right",
              }}
              component="span"
            >
              {row.value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
