import { Chip } from "@mui/material";
import type { ContainerState, HostStatus } from "@harbor/contracts";

export function StatusChip({
  status,
}: {
  status: ContainerState | HostStatus | string;
}) {
  const normalized = status.toLowerCase();
  const color =
    normalized === "running" || normalized === "online"
      ? "success"
      : normalized === "exited" ||
          normalized === "offline" ||
          normalized === "dead"
        ? "error"
        : normalized === "paused" ||
            normalized === "degraded" ||
            normalized === "unknown"
          ? "warning"
          : "default";
  return (
    <Chip
      size="small"
      color={color}
      variant={color === "default" ? "outlined" : "filled"}
      label={status}
      sx={{ textTransform: "capitalize" }}
    />
  );
}
