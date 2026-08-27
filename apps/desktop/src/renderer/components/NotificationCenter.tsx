import { useState, type MouseEvent } from "react";
import { DeleteSweep, NotificationsNone, Sensors } from "@mui/icons-material";
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useUiStore } from "../state/ui-store.js";

function eventTitle(type: string): string {
  return type
    .replace(/^engine\./, "")
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown time"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotificationCenter() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const notifications = useUiStore((state) => state.notifications);
  const markRead = useUiStore((state) => state.markNotificationsRead);
  const clear = useUiStore((state) => state.clearNotifications);
  const unread = notifications.filter((item) => !item.read).length;
  const open = Boolean(anchorEl);

  const show = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    markRead();
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          onClick={show}
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Badge badgeContent={unread || undefined} color="warning" max={9}>
            <NotificationsNone fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { width: 380, maxWidth: "calc(100vw - 24px)" } },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 1.75, py: 1.2 }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
              Notifications
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 10.5, mt: 0.2 }}>
              Remote Engine events from this session
            </Typography>
          </Box>
          <Button
            size="small"
            color="inherit"
            startIcon={<DeleteSweep fontSize="small" />}
            disabled={!notifications.length}
            onClick={clear}
          >
            Clear
          </Button>
        </Stack>
        <Divider />
        {notifications.length ? (
          <List dense disablePadding sx={{ maxHeight: 390, overflow: "auto" }}>
            {notifications.slice(0, 20).map(({ id, event }) => (
              <ListItem key={id} sx={{ px: 1.75, py: 1 }}>
                <ListItemIcon sx={{ minWidth: 34, color: "primary.main" }}>
                  <Sensors fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={eventTitle(event.type)}
                  secondary={`${event.resourceKind}${event.resourceId ? ` · ${event.resourceId.slice(0, 18)}` : ""} · ${eventTime(event.occurredAt)}`}
                  primaryTypographyProps={{ fontSize: 12.5, fontWeight: 620 }}
                  secondaryTypographyProps={{ fontSize: 10.5, noWrap: true }}
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <NotificationsNone color="disabled" sx={{ fontSize: 28 }} />
            <Typography color="text.secondary" sx={{ mt: 1, fontSize: 12 }}>
              No remote events yet.
            </Typography>
          </Box>
        )}
      </Popover>
    </>
  );
}
