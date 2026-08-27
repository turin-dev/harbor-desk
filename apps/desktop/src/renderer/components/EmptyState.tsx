import type { ReactNode } from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { CloudOff, OpenInNew } from "@mui/icons-material";

export function EmptyState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}) {
  return (
    <Paper
      sx={{
        p: 5,
        minHeight: 270,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        borderStyle: "dashed",
        bgcolor: "transparent",
      }}
    >
      <Stack alignItems="center" spacing={1.2}>
        <Box
          sx={{
            width: 48,
            height: 48,
            display: "grid",
            placeItems: "center",
            borderRadius: 2,
            bgcolor: "action.hover",
            color: "text.secondary",
          }}
        >
          {props.icon ?? <CloudOff />}
        </Box>
        <Typography variant="h6">{props.title}</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 450 }}>
          {props.description}
        </Typography>
        {props.actionLabel && props.onAction && (
          <Button
            variant="contained"
            onClick={props.onAction}
            endIcon={<OpenInNew fontSize="small" />}
          >
            {props.actionLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
