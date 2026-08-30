import { useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useConnectionStatus } from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";
import {
  canSubmitConnectionTarget,
  configureErrorMessage,
  defaultDisplayName,
} from "./connection-dialog.js";

interface ConnectionTargetDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectionTargetDialog({
  open,
  onClose,
}: ConnectionTargetDialogProps) {
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
    if (!open) return;
    setEndpoint(connection.data?.endpoint ?? "");
    setDisplayName(defaultDisplayName(connection.data?.mode));
    setCa("");
    setCert("");
    setKey("");
    setAdvanced(false);
    setError(undefined);
  }, [connection.data?.endpoint, connection.data?.mode, open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
        return;
      }
      showToast("Connection target detected and connected.", "success");
      onClose();
    } catch (caught) {
      const message = configureErrorMessage(caught);
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Connect Docker Engine</DialogTitle>
      <DialogContent>
        <Stack component="form" spacing={1.5} sx={{ pt: 1 }} onSubmit={submit}>
          {error && <Alert severity="error">{error}</Alert>}
          <Alert severity="info">
            Enter a Harbor Desk Gateway or Docker Engine target. Harbor Desk
            detects the type and routes requests through a Gateway.
          </Alert>
          <TextField
            fullWidth
            required
            autoFocus
            label="Gateway or Docker Engine URL"
            placeholder="http://gateway.example:4311 or https://engine.example:2376"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            helperText="Gateway URLs are used directly. Engine targets start a Local Gateway wrapper."
            inputProps={{ spellCheck: false }}
          />
          <TextField
            fullWidth
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            helperText="Used for the automatically created Engine host."
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
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                Required only for a remote HTTPS Docker Engine. These values
                stay in the Electron main process and are not shown in status or
                diagnostics.
              </Typography>
              <TextField
                label="CA certificate"
                multiline
                minRows={2}
                value={ca}
                onChange={(event) => setCa(event.target.value)}
                inputProps={{ spellCheck: false, autoComplete: "off" }}
              />
              <TextField
                label="Client certificate"
                multiline
                minRows={2}
                value={cert}
                onChange={(event) => setCert(event.target.value)}
                inputProps={{ spellCheck: false, autoComplete: "off" }}
              />
              <TextField
                label="Client private key"
                multiline
                minRows={2}
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                inputProps={{ spellCheck: false, autoComplete: "new-password" }}
              />
            </Stack>
          </Collapse>
          <DialogActions sx={{ px: 0 }}>
            <Button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={saving || !canSubmitConnectionTarget(endpoint)}
            >
              {saving ? "Detecting…" : "Connect"}
            </Button>
          </DialogActions>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
