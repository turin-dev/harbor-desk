import type { ReactNode } from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import {
  CheckCircleOutline,
  Construction,
  Lock,
  RadioButtonUnchecked,
} from "@mui/icons-material";
import type { Host } from "@harbor/contracts";
import { PageHeader } from "../components/PageHeader.js";
import { useHosts } from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

type HostCapability = keyof Host["capabilities"];

export function SurfaceScreen(props: {
  title: string;
  eyebrow: string;
  description: string;
  icon?: ReactNode;
  capability?: HostCapability;
}) {
  const { data: hosts = [] } = useHosts();
  const selectedHostId =
    useUiStore((state) => state.selectedHostId) ?? hosts[0]?.id;
  const host = hosts.find((item) => item.id === selectedHostId);
  const supported = props.capability
    ? host?.capabilities[props.capability]
    : undefined;
  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow={props.eyebrow}
        title={props.title}
        description={props.description}
      />
      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box
            sx={{
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              borderRadius: 1.3,
              bgcolor: "action.hover",
              color: "primary.main",
            }}
          >
            {props.icon ?? <Construction />}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6">Adapter status</Typography>
              <Chip
                size="small"
                label="Integration boundary"
                variant="outlined"
              />
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.65, maxWidth: 760 }}>
              {host
                ? props.capability && !supported
                  ? `The selected host is ${host.status}, but it does not advertise the ${props.capability} capability. The action is unavailable and no local fallback is used.`
                  : `The selected host is ${host.status}. This surface will use a server-side adapter and will never invoke a local Docker command.`
                : "Select or register a remote host to evaluate this adapter."}
            </Typography>
          </Box>
        </Stack>
      </Paper>
      <Stack direction="row" spacing={1.4} alignItems="stretch">
        <CapabilityRow label="Client route and layout" done />
        <CapabilityRow
          label={props.capability ? "Host capability" : "Server-side adapter"}
          done={Boolean(props.capability && supported)}
        />
        <CapabilityRow label="Live remote data" done={false} />
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 2, fontSize: 12 }}>
        This view is intentionally honest while the corresponding connector is
        being implemented. It does not display fake resources or report
        simulated success.
      </Typography>
    </Box>
  );
}

function CapabilityRow({ label, done }: { label: string; done: boolean }) {
  return (
    <Paper sx={{ p: 1.6, flex: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {done ? (
          <CheckCircleOutline color="success" fontSize="small" />
        ) : (
          <RadioButtonUnchecked color="disabled" fontSize="small" />
        )}
        <Typography sx={{ fontSize: 12.5, fontWeight: 620 }}>
          {label}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ mt: 1, color: done ? "success.main" : "text.secondary" }}
      >
        {done ? (
          <Typography sx={{ fontSize: 11 }}>Available</Typography>
        ) : (
          <>
            <Lock sx={{ fontSize: 13 }} />
            <Typography sx={{ fontSize: 11 }}>Not wired yet</Typography>
          </>
        )}
      </Stack>
    </Paper>
  );
}
