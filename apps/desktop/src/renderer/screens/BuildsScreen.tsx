import { useState } from "react";
import { Add, Build, FolderOpen } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ImageBuildInput } from "@harbor/contracts";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  useBuildImage,
  useCancelOperation,
  useCurrentUser,
  useHosts,
  useOperation,
} from "../state/queries.js";
import { formatBytes } from "../format.js";
import {
  describeBuildResult,
  parseBuildForm,
  type BuildResultCopy,
} from "./build-input.js";
import { useUiStore } from "../state/ui-store.js";

interface BuildAttempt {
  operationId: string;
  tag: string;
}

export function BuildsScreen() {
  const { data: hosts = [] } = useHosts();
  const storedHostId = useUiStore((state) => state.selectedHostId);
  const selectedHost =
    hosts.find((host) => host.id === storedHostId) ?? hosts[0];
  const hostId = selectedHost?.id;
  const { data: user } = useCurrentUser();
  const showToast = useUiStore((state) => state.showToast);
  const build = useBuildImage(hostId);
  const cancel = useCancelOperation();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<BuildAttempt>();
  const [tag, setTag] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [buildArgsLines, setBuildArgsLines] = useState("");
  const [folder, setFolder] = useState("");
  const [contextTar, setContextTar] = useState<string>();
  const [contextBytes, setContextBytes] = useState<number>();
  const [contextFiles, setContextFiles] = useState<number>();
  const [formIssue, setFormIssue] = useState<string>();
  const [packaging, setPackaging] = useState(false);
  const operation = useOperation(attempt?.operationId);
  const active =
    build.isPending ||
    operation?.status === "queued" ||
    operation?.status === "running";
  const result: BuildResultCopy | undefined =
    !active && attempt
      ? describeBuildResult(operation, attempt.tag)
      : undefined;
  const canBuild = (user?.role ?? "viewer") !== "viewer";
  const bridge = window.harbor;
  const hostOnline = selectedHost?.status === "online";
  const buildkit = selectedHost?.capabilities.buildkit ?? false;

  const resetForm = () => {
    setTag("");
    setDockerfile("");
    setBuildArgsLines("");
    setFolder("");
    setContextTar(undefined);
    setContextBytes(undefined);
    setContextFiles(undefined);
    setFormIssue(undefined);
  };

  const chooseFolder = async () => {
    const picked = await bridge?.selectFolder();
    if (!picked) return;
    setFolder(picked);
    setContextBytes(undefined);
    setContextFiles(undefined);
    setContextTar(undefined);
    setFormIssue(undefined);
    setPackaging(true);
    try {
      const payload = await bridge?.buildContext(picked);
      if (!payload) throw new Error("The desktop bridge is unavailable.");
      setContextTar(payload.base64Tar);
      setContextBytes(payload.totalBytes);
      setContextFiles(
        payload.entries.filter((entry) => entry.mode === "file").length,
      );
    } catch (error) {
      setFolder("");
      setContextTar(undefined);
      setFormIssue(
        error instanceof Error
          ? error.message
          : "Could not package the build context.",
      );
    } finally {
      setPackaging(false);
    }
  };

  const startBuild = async () => {
    const parsed = parseBuildForm({ tag, dockerfile, buildArgsLines });
    if (!parsed.value) {
      setFormIssue(parsed.issue?.message);
      return;
    }
    if (!folder || !contextTar) {
      setFormIssue("Choose the local folder that contains the Dockerfile.");
      return;
    }
    setFormIssue(undefined);
    const input: ImageBuildInput = {
      contextTar,
      tag: parsed.value.tag,
      ...(parsed.value.dockerfile
        ? { dockerfile: parsed.value.dockerfile }
        : {}),
      ...(parsed.value.buildArgs ? { buildArgs: parsed.value.buildArgs } : {}),
    };
    const operationId = crypto.randomUUID();
    setAttempt({ operationId, tag: input.tag });
    build.mutate(
      { image: input, operationId },
      {
        onError: (error) =>
          setFormIssue(
            error instanceof Error
              ? error.message
              : "The build could not be started.",
          ),
      },
    );
  };

  if (!hosts.length)
    return (
      <Box sx={{ px: 4, py: 2 }}>
        <PageHeader
          eyebrow="Workspace"
          title="Builds"
          description="Build remote images from a local Dockerfile context."
        />
        <EmptyState
          title="No remote host"
          description="Add a remote host before opening this view."
        />
      </Box>
    );

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Workspace / Builds"
        title="Builds"
        description="Upload a local Dockerfile context and build the image on the remote Engine."
        actions={
          <Stack direction="row" spacing={1.5} alignItems="center">
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
                aria-label="Select build host"
              >
                {hosts.map((host) => (
                  <MenuItem key={host.id} value={host.id}>
                    {host.displayName} ({host.status})
                  </MenuItem>
                ))}
              </Select>
            )}
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => {
                resetForm();
                setOpen(true);
              }}
              disabled={!hostId || !hostOnline || !canBuild || active}
            >
              New build
            </Button>
          </Stack>
        }
      />
      {selectedHost && !hostOnline && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {selectedHost.displayName} is {selectedHost.status}. Builds are
          disabled until it is online.
        </Alert>
      )}
      {selectedHost && hostOnline && !buildkit && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          {selectedHost.displayName} reports Engine API below 1.39, where the
          build endpoint is unavailable.
        </Alert>
      )}
      {active && attempt && (
        <Paper sx={{ p: 2, mb: 2 }} aria-label="Active build progress">
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Build sx={{ color: "text.primary" }} />
              <Typography variant="body1" sx={{ fontWeight: 650 }}>
                Building {attempt.tag}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {operation?.message ??
                "Upload started. Waiting for Engine build progress."}
            </Typography>
            <LinearProgress
              variant={
                typeof operation?.progress === "number"
                  ? "determinate"
                  : "indeterminate"
              }
              value={operation?.progress}
            />
          </Stack>
        </Paper>
      )}
      {result && attempt && (
        <Alert
          severity={
            result.tone === "success"
              ? "success"
              : result.tone === "info"
                ? "info"
                : "error"
          }
          sx={{ mb: 2 }}
          onClose={() => {
            setAttempt(undefined);
            setOpen(false);
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {result.title}
            </Typography>
            <Typography variant="body2">{result.body}</Typography>
          </Box>
        </Alert>
      )}
      <EmptyState
        icon={<Build />}
        title={active ? "Build in progress" : "No active builds"}
        description={
          active
            ? "Progress appears above while the remote Engine builds the image."
            : "Start a build to upload a local Dockerfile context and tag the resulting image."
        }
      />
      <Dialog
        open={open}
        onClose={() => !active && setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>New image build</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {formIssue && <Alert severity="error">{formIssue}</Alert>}
            <TextField
              label="Image tag"
              placeholder="app:dev"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              autoFocus
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="Context folder"
                placeholder="Choose the folder with the Dockerfile"
                value={
                  folder
                    ? folder.replace(/\\/g, "/").split("/").slice(-2).join("/")
                    : ""
                }
                onChange={() => undefined}
                InputProps={{ readOnly: true }}
                fullWidth
              />
              <Button
                variant="outlined"
                startIcon={
                  packaging ? <CircularProgress size={16} /> : <FolderOpen />
                }
                onClick={() => void chooseFolder()}
                disabled={packaging || active}
              >
                Choose
              </Button>
            </Stack>
            {contextBytes !== undefined && (
              <Typography variant="caption" color="text.secondary">
                Packaged {contextFiles} files ({formatBytes(contextBytes)}) into
                a USTAR context archive.
              </Typography>
            )}
            <TextField
              label="Dockerfile (optional)"
              placeholder="Dockerfile"
              value={dockerfile}
              onChange={(event) => setDockerfile(event.target.value)}
              helperText="Context-relative path with forward slashes."
              fullWidth
            />
            <TextField
              label="Build args (optional)"
              placeholder={"MODE=release\nVERSION=1.0.0"}
              value={buildArgsLines}
              onChange={(event) => setBuildArgsLines(event.target.value)}
              multiline
              minRows={2}
              maxRows={6}
              helperText="One KEY=VALUE per line."
              fullWidth
            />
            {active && attempt && (
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {operation?.message ?? "Waiting for Engine build progress."}
                </Typography>
                <LinearProgress
                  variant={
                    typeof operation?.progress === "number"
                      ? "determinate"
                      : "indeterminate"
                  }
                  value={operation?.progress}
                />
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (active && attempt) {
                cancel.mutate(attempt.operationId, {
                  onSuccess: () => showToast("Image build cancelled.", "info"),
                  onError: (error) =>
                    showToast(
                      error instanceof Error
                        ? error.message
                        : "The build could not be cancelled.",
                      "error",
                    ),
                });
                return;
              }
              setOpen(false);
            }}
            disabled={cancel.isPending}
          >
            {active ? "Cancel build" : "Cancel"}
          </Button>
          <Button
            variant="contained"
            onClick={() => void startBuild()}
            disabled={active || packaging || !folder}
          >
            {active ? "Building…" : "Build image"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
