import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Apps,
  Image as ImageIcon,
  Lan,
  Search,
  Storage,
} from "@mui/icons-material";
import {
  Box,
  ClickAwayListener,
  CircularProgress,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import type {
  ContainerSummary,
  ImageSummary,
  NetworkSummary,
  VolumeSummary,
} from "@harbor/contracts";
import { gateway } from "../api/client.js";

type SearchResult = {
  key: string;
  kind: "container" | "image" | "volume" | "network";
  label: string;
  secondary: string;
  path: string;
};

function resultIcon(kind: SearchResult["kind"]) {
  if (kind === "container") return <Apps fontSize="small" />;
  if (kind === "image") return <ImageIcon fontSize="small" />;
  if (kind === "volume") return <Storage fontSize="small" />;
  return <Lan fontSize="small" />;
}

function matches(values: string[], query: string): boolean {
  return values.some((value) => value.toLowerCase().includes(query));
}

function buildResults(
  query: string,
  resources: {
    containers: ContainerSummary[];
    images: ImageSummary[];
    volumes: VolumeSummary[];
    networks: NetworkSummary[];
  },
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const row of resources.containers) {
    if (!matches([row.name, row.image, row.status], query)) continue;
    results.push({
      key: `container-${row.id}`,
      kind: "container",
      label: row.name,
      secondary: `${row.image} · ${row.status}`,
      path: "/containers",
    });
  }
  for (const row of resources.images) {
    const image = `${row.repository}:${row.tag}`;
    if (!matches([image, row.digest ?? row.id], query)) continue;
    results.push({
      key: `image-${row.id}-${row.tag}`,
      kind: "image",
      label: image,
      secondary: row.digest ?? row.id.slice(0, 18),
      path: "/images",
    });
  }
  for (const row of resources.volumes) {
    if (!matches([row.name, row.driver, row.mountpoint ?? ""], query)) continue;
    results.push({
      key: `volume-${row.name}`,
      kind: "volume",
      label: row.name,
      secondary: `${row.driver} · ${row.scope ?? "unknown scope"}`,
      path: "/volumes",
    });
  }
  for (const row of resources.networks) {
    if (!matches([row.name, row.driver, row.scope], query)) continue;
    results.push({
      key: `network-${row.id}`,
      kind: "network",
      label: row.name,
      secondary: `${row.driver} · ${row.scope}`,
      path: "/networks",
    });
  }
  return results.slice(0, 12);
}

export function QuickSearch({
  hostId,
  variant = "default",
}: {
  hostId?: string;
  variant?: "default" | "topbar";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const navigate = useNavigate();
  const searchQuery = value.trim().toLowerCase();
  const resources = useQuery({
    queryKey: ["quick-search", hostId, searchQuery],
    queryFn: async () => {
      const [containers, images, volumes, networks] = await Promise.all([
        gateway.getContainers(hostId!),
        gateway.getImages(hostId!),
        gateway.getVolumes(hostId!),
        gateway.getNetworks(hostId!),
      ]);
      return { containers, images, volumes, networks };
    },
    enabled: Boolean(hostId && open && searchQuery.length >= 2),
    staleTime: 5_000,
    retry: false,
  });
  const results = useMemo(
    () => (resources.data ? buildResults(searchQuery, resources.data) : []),
    [resources.data, searchQuery],
  );

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const close = () => {
    setOpen(false);
    setHighlighted(0);
  };

  const goTo = (result: SearchResult) => {
    close();
    setValue("");
    navigate(result.path);
  };

  const moveSelection = (direction: 1 | -1) => {
    if (!results.length) return;
    setHighlighted(
      (current) => (current + direction + results.length) % results.length,
    );
  };

  const inTopbar = variant === "topbar";

  return (
    <ClickAwayListener onClickAway={close}>
      <Box
        sx={{
          position: "relative",
          width: inTopbar
            ? "clamp(192px, calc(100vw - 1080px), 576px)"
            : { xs: 240, sm: 355 },
          flexShrink: 1,
        }}
      >
        <TextField
          inputRef={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              close();
              inputRef.current?.blur();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Enter" && results[highlighted]) {
              event.preventDefault();
              goTo(results[highlighted]);
            }
          }}
          placeholder={inTopbar ? "Search" : "Search remote resources…"}
          aria-label="Quick search"
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: "text.secondary", fontSize: 19 }} />
              </InputAdornment>
            ),
            endAdornment: (
              <Typography
                component="kbd"
                sx={{
                  display: { xs: "none", sm: "inline" },
                  color: "text.secondary",
                  fontSize: 10,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 0.6,
                  px: 0.55,
                  py: 0.15,
                  lineHeight: 1.2,
                }}
              >
                Ctrl K
              </Typography>
            ),
          }}
          sx={
            inTopbar
              ? {
                  "& .MuiOutlinedInput-root": {
                    minHeight: 40,
                    bgcolor: "var(--dd-color-header-field)",
                    color: "#ffffff",
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "rgba(255,255,255,0.16)",
                    },
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                      borderColor: "rgba(255,255,255,0.42)",
                    },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                      borderColor: "#ffffff",
                    },
                  },
                  "& input::placeholder": {
                    color: "rgba(255,255,255,0.88)",
                    opacity: 1,
                  },
                  "& .MuiInputAdornment-root, & .MuiSvgIcon-root, & kbd": {
                    color: "rgba(255,255,255,0.9)",
                  },
                  "& kbd": {
                    borderColor: "rgba(255,255,255,0.45)",
                  },
                }
              : {
                  "& .MuiOutlinedInput-root": { bgcolor: "background.default" },
                }
          }
        />
        {open && (
          <Paper
            elevation={8}
            sx={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              zIndex: 30,
              overflow: "hidden",
              minWidth: 310,
            }}
          >
            {!hostId ? (
              <Typography sx={{ p: 2, color: "text.secondary" }}>
                Connect a remote host before searching.
              </Typography>
            ) : searchQuery.length < 2 ? (
              <Typography sx={{ p: 2, color: "text.secondary" }}>
                Type at least two characters to search this host.
              </Typography>
            ) : resources.isFetching ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
                <CircularProgress size={16} />
                <Typography color="text.secondary">
                  Searching the remote Engine…
                </Typography>
              </Box>
            ) : resources.isError ? (
              <Typography sx={{ p: 2 }} color="error">
                Search could not read the selected host.
              </Typography>
            ) : results.length ? (
              <List dense disablePadding aria-label="Search results">
                {results.map((result, index) => (
                  <ListItemButton
                    key={result.key}
                    selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => goTo(result)}
                    sx={{ px: 1.5, py: 0.85 }}
                  >
                    <ListItemIcon sx={{ minWidth: 34, color: "primary.main" }}>
                      {resultIcon(result.kind)}
                    </ListItemIcon>
                    <ListItemText
                      primary={result.label}
                      secondary={result.secondary}
                      primaryTypographyProps={{
                        noWrap: true,
                        fontSize: 12.5,
                        fontWeight: 620,
                      }}
                      secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
                    />
                    <Typography
                      sx={{
                        color: "text.secondary",
                        fontSize: 10,
                        textTransform: "uppercase",
                      }}
                    >
                      {result.kind}
                    </Typography>
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <Typography sx={{ p: 2, color: "text.secondary" }}>
                No matching remote resources.
              </Typography>
            )}
            {results.length > 0 && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  px: 1.5,
                  py: 0.75,
                  borderTop: 1,
                  borderColor: "divider",
                  color: "text.secondary",
                }}
              >
                <Typography sx={{ fontSize: 10 }}>
                  ↑↓ navigate · Enter open
                </Typography>
                <Typography sx={{ fontSize: 10 }}>
                  {results.length} result{results.length === 1 ? "" : "s"}
                </Typography>
              </Box>
            )}
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
