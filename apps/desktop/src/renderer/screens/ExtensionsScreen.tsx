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
  Typography,
} from "@mui/material";
import { Extension, OpenInNew, Refresh } from "@mui/icons-material";
import type { ExtensionSummary } from "@harbor/contracts";
import { gateway } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  useExtensions,
  useInstallExtension,
  useUninstallExtension,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

export function ExtensionsScreen() {
  const {
    data: extensions = [],
    isLoading,
    isError,
    refetch,
  } = useExtensions();
  const install = useInstallExtension();
  const uninstall = useUninstallExtension();
  const showToast = useUiStore((state) => state.showToast);
  const [removeTarget, setRemoveTarget] = useState<ExtensionSummary>();
  const [openTarget, setOpenTarget] = useState<ExtensionSummary>();
  const [webHtml, setWebHtml] = useState<string>();
  const [webError, setWebError] = useState<string>();

  const openExtension = (extension: ExtensionSummary) => {
    setOpenTarget(extension);
    setWebHtml(undefined);
    setWebError(undefined);
    gateway
      .getExtensionWeb(extension.id)
      .then((html) => setWebHtml(html))
      .catch((error) => {
        setWebError(
          error instanceof Error
            ? error.message
            : "The extension page could not be loaded.",
        );
      });
  };
  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Gateway / Extensions"
        title="Extensions"
        description="The gateway serves an admin-approved extension catalog. Installing an extension enables its isolated web interface, which is rendered by the gateway — extension code never runs inside this desktop client."
        actions={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
        }
      />
      {isError && (
        <Stack spacing={1.25} sx={{ mb: 2 }}>
          <Typography color="error" sx={{ fontSize: 13 }}>
            Could not load the extension catalog from the gateway.
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
          <Typography color="text.secondary">Loading catalog…</Typography>
        </Paper>
      ) : (
        <Paper sx={{ overflow: "hidden" }}>
          <Table size="small" aria-label="Approved extension catalog">
            <TableHead>
              <TableRow>
                <TableCell>Extension</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>Publisher</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {extensions.map((extension) => (
                <TableRow key={extension.id} hover>
                  <TableCell>
                    <Stack spacing={0.4}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography sx={{ fontWeight: 620 }}>
                          {extension.name}
                        </Typography>
                        {extension.approved && (
                          <Chip
                            size="small"
                            label="approved"
                            color="success"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                      <Typography
                        color="text.secondary"
                        sx={{ fontSize: 12, maxWidth: 560 }}
                      >
                        {extension.description}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {extension.version}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {extension.publisher}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {extension.category ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={extension.status}
                      color={
                        extension.status === "installed" ? "success" : "default"
                      }
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={0.5}
                      justifyContent="flex-end"
                    >
                      <Button
                        size="small"
                        aria-label={"Open " + extension.name}
                        onClick={() => openExtension(extension)}
                      >
                        <OpenInNew sx={{ fontSize: 14 }} />
                      </Button>
                      {extension.status === "installed" ? (
                        <Button
                          size="small"
                          onClick={() => setRemoveTarget(extension)}
                        >
                          Uninstall
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Extension />}
                          disabled={install.isPending}
                          onClick={() =>
                            install.mutate(extension.id, {
                              onSuccess: (result) =>
                                showToast(
                                  "Installed " +
                                    result.name +
                                    " " +
                                    result.version +
                                    ".",
                                  "success",
                                ),
                              onError: (error) =>
                                showToast(
                                  error instanceof Error
                                    ? error.message
                                    : "Install failed.",
                                  "error",
                                ),
                            })
                          }
                        >
                          Install
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <Dialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(undefined)}
      >
        <DialogTitle>Uninstall extension</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Uninstall {removeTarget?.name} from the gateway?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(undefined)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={uninstall.isPending}
            onClick={() => {
              const target = removeTarget;
              if (!target) return;
              uninstall.mutate(target.id, {
                onSuccess: () => {
                  setRemoveTarget(undefined);
                  showToast("Uninstalled " + target.name + ".", "success");
                },
                onError: (error) =>
                  showToast(
                    error instanceof Error
                      ? error.message
                      : "Uninstall failed.",
                    "error",
                  ),
              });
            }}
          >
            Uninstall
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(openTarget)}
        onClose={() => setOpenTarget(undefined)}
        maxWidth="md"
      >
        <DialogTitle>
          {openTarget
            ? openTarget.name + " " + openTarget.version
            : "Extension"}
        </DialogTitle>
        <DialogContent dividers sx={{ height: 560, p: 0, bgcolor: "#ffffff" }}>
          {webHtml ? (
            <iframe
              title={openTarget ? openTarget.name : "Extension"}
              srcDoc={webHtml}
              style={{
                width: "100%",
                height: 520,
                border: "none",
                display: "block",
              }}
            />
          ) : webError ? (
            <Alert severity="error" sx={{ m: 2 }}>
              {webError}
            </Alert>
          ) : (
            <Typography sx={{ p: 3 }} color="text.secondary">
              Loading the extension page…
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenTarget(undefined)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
