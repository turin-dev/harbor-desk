import { Alert, Snackbar } from "@mui/material";
import { useUiStore } from "../state/ui-store.js";

export function ToastHost() {
  const toast = useUiStore((state) => state.toast);
  const dismiss = useUiStore((state) => state.dismissToast);
  return (
    <Snackbar
      open={Boolean(toast)}
      autoHideDuration={4_500}
      onClose={dismiss}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      sx={{ mb: 1.5, mr: 1.5 }}
    >
      {toast ? (
        <Alert onClose={dismiss} severity={toast.severity} variant="filled">
          {toast.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
