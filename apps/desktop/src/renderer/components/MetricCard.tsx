import type { ReactNode } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Paper, Stack, Typography, useTheme } from "@mui/material";

export function MetricCard(props: {
  label: string;
  value: string | number;
  note?: string;
  icon: ReactNode;
  tone?: "blue" | "green" | "amber" | "slate";
}) {
  const theme = useTheme();
  const color =
    props.tone === "green"
      ? theme.palette.success.main
      : props.tone === "amber"
        ? theme.palette.warning.main
        : props.tone === "slate"
          ? theme.palette.text.secondary
          : theme.palette.primary.main;
  return (
    <Paper sx={{ p: 2, flex: 1, minWidth: 165 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
      >
        <Box>
          <Typography
            color="text.secondary"
            sx={{
              fontSize: 11,
              fontWeight: 650,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {props.label}
          </Typography>
          <Typography
            sx={{
              mt: 0.6,
              fontSize: 26,
              fontWeight: 720,
              letterSpacing: "-0.04em",
            }}
          >
            {props.value}
          </Typography>
          {props.note && (
            <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.25 }}>
              {props.note}
            </Typography>
          )}
        </Box>
        <Box
          sx={{
            width: 33,
            height: 33,
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            color,
            bgcolor: alpha(color, 0.12),
          }}
        >
          {props.icon}
        </Box>
      </Stack>
    </Paper>
  );
}
