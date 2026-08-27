import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      alignItems="flex-start"
      justifyContent="space-between"
      spacing={2}
      sx={{ mb: 2.5 }}
    >
      <Box>
        {props.eyebrow && (
          <Typography
            sx={{
              color: "primary.main",
              fontSize: 10.5,
              fontWeight: 750,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              mb: 0.65,
            }}
          >
            {props.eyebrow}
          </Typography>
        )}
        <Typography variant="h4">{props.title}</Typography>
        {props.description && (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
            {props.description}
          </Typography>
        )}
      </Box>
      {props.actions && (
        <Stack direction="row" spacing={1} alignItems="center">
          {props.actions}
        </Stack>
      )}
    </Stack>
  );
}
