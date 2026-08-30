import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ClearAll,
  Close,
  ContentCopy,
  PlayArrow,
  Terminal,
} from "@mui/icons-material";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { Host, TerminalFrame } from "@harbor/contracts";
import { getTerminalWebSocketUrl, gateway } from "../api/client.js";
import { useUiStore } from "../state/ui-store.js";
import {
  appendToHistory,
  applyTerminalFrame,
  canRunTerminalCommand,
  isTerminalFrame,
  promptLine,
  terminalFrameErrorMessage,
  requestErrorMessage,
} from "./terminal-session.js";

const minHeight = 230;

export function TerminalDrawer({ host }: { host?: Host }) {
  const open = useUiStore((state) => state.terminalOpen);
  const setOpen = useUiStore((state) => state.setTerminalOpen);
  const containerId = useUiStore((state) => state.terminalContainerId);
  const containerName = useUiStore((state) => state.terminalContainerName);
  const fontSize = useUiStore((state) => state.terminalFontSize);
  const showToast = useUiStore((state) => state.showToast);
  const [command, setCommand] = useState("uname -a");
  const [output, setOutput] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [height, setHeight] = useState(320);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => socketRef.current?.close(), []);

  useEffect(() => {
    const outputElement = outputRef.current;
    if (!outputElement) return;
    outputElement.scrollTop = outputElement.scrollHeight;
  }, [output, error]);

  const runCommand = async () => {
    if (
      !canRunTerminalCommand({
        host: host ? { id: host.id, status: host.status } : undefined,
        containerId,
        command,
        running,
      })
    )
      return;
    const nextCommand = command.trim();
    setError(undefined);
    setRunning(true);
    setHistory((items) => appendToHistory(items, nextCommand));
    setHistoryIndex(-1);
    setOutput((lines) => [...lines, promptLine(containerName, nextCommand)]);
    try {
      const session = await gateway.createTerminalSession(
        host!.id,
        containerId!,
        nextCommand,
      );
      const ticket = await gateway.getWebSocketTicket();
      const socket = new WebSocket(
        await getTerminalWebSocketUrl(session.id, ticket.ticket),
      );
      socketRef.current = socket;
      socket.onmessage = (message) => {
        try {
          const frame = JSON.parse(String(message.data)) as TerminalFrame;
          setOutput(
            (lines) =>
              applyTerminalFrame({ output: lines, running: false }, frame)
                .output,
          );
          if (frame.type === "error")
            setError(terminalFrameErrorMessage(frame));
          if (isTerminalFrame(frame)) {
            setRunning(false);
            socket.close();
          }
        } catch {
          setError("The terminal returned an invalid frame.");
          setRunning(false);
        }
      };
      socket.onerror = () => {
        setError("The gateway terminal stream disconnected.");
        setRunning(false);
      };
      socket.onclose = () => {
        setRunning(false);
      };
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
      setRunning(false);
    }
  };

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      setHeight(
        Math.max(minHeight, Math.min(window.innerHeight - 96, nextHeight)),
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const copyOutput = () => {
    void navigator.clipboard
      ?.writeText(output.join("\n"))
      .then(() => showToast("Terminal output copied.", "success"))
      .catch(() => showToast("Clipboard access was unavailable.", "error"));
  };

  if (!open) return null;

  return (
    <Paper
      elevation={10}
      sx={{
        position: "fixed",
        left: { xs: 0, md: 248 },
        right: 0,
        bottom: 0,
        height,
        zIndex: 20,
        borderRadius: 0,
        bgcolor: "var(--dd-terminal-background)",
        color: "var(--dd-terminal-foreground)",
        borderLeft: 0,
        borderBottom: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        onMouseDown={startResize}
        role="separator"
        aria-label="Resize terminal"
        sx={{
          height: 5,
          flexShrink: 0,
          cursor: "ns-resize",
          bgcolor: "var(--dd-terminal-border)",
          "&:hover": { bgcolor: "primary.main" },
        }}
      />
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          height: 42,
          px: 2,
          borderBottom: "1px solid var(--dd-terminal-border)",
          flexShrink: 0,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ minWidth: 0 }}
        >
          <Terminal sx={{ fontSize: 17, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 650, fontSize: 12.5 }}>
            Integrated terminal
          </Typography>
          <Typography
            sx={{ color: "var(--dd-terminal-muted)", fontSize: 11 }}
            noWrap
          >
            {host
              ? `${host.displayName}${containerName ? ` · ${containerName}` : ""}`
              : "No remote host selected"}
          </Typography>
          <Typography
            sx={{ color: "var(--dd-terminal-warning)", fontSize: 10 }}
          >
            ONE-SHOT EXEC
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.2}>
          <Tooltip title="Copy output">
            <span>
              <IconButton
                size="small"
                disabled={!output.length}
                onClick={copyOutput}
                sx={{ color: "var(--dd-terminal-muted)" }}
                aria-label="Copy terminal output"
              >
                <ContentCopy sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear output">
            <span>
              <IconButton
                size="small"
                disabled={!output.length}
                onClick={() => setOutput([])}
                sx={{ color: "var(--dd-terminal-muted)" }}
                aria-label="Clear terminal output"
              >
                <ClearAll sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            sx={{ color: "var(--dd-terminal-muted)" }}
            aria-label="Close terminal"
          >
            <Close fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
      <Box
        ref={outputRef}
        sx={{
          p: 1.5,
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          fontFamily: "var(--dd-font-mono)",
          fontSize,
          color: "var(--dd-terminal-muted)",
        }}
      >
        {!containerId && (
          <Typography
            sx={{
              color: "var(--dd-terminal-muted)",
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
          >
            Select a running container to open an Engine exec session.
          </Typography>
        )}
        {host && host.status !== "online" && containerId && (
          <Typography
            sx={{
              color: "var(--dd-terminal-warning)",
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
          >
            The selected host is {host.status}. Mutations and terminal sessions
            are disabled until it is online.
          </Typography>
        )}
        {output.map((line, index) => (
          <Box
            component="pre"
            key={`${index}-${line.slice(0, 12)}`}
            sx={{
              m: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              font: "inherit",
              color: line.startsWith("harbor@")
                ? "var(--dd-terminal-success)"
                : "var(--dd-terminal-foreground)",
            }}
          >
            {line}
          </Box>
        ))}
        {error && (
          <Typography
            sx={{
              color: "var(--dd-terminal-error)",
              fontFamily: "inherit",
              fontSize: "inherit",
              mt: 0.5,
            }}
          >
            {error}
          </Typography>
        )}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, pb: 1.2, flexShrink: 0 }}
      >
        <TextField
          value={command}
          onChange={(event) => {
            setCommand(event.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runCommand();
            if (event.key === "ArrowUp" && history.length) {
              event.preventDefault();
              const next = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(next);
              setCommand(history[next] ?? "");
            }
            if (event.key === "ArrowDown" && history.length) {
              event.preventDefault();
              const next = Math.max(historyIndex - 1, -1);
              setHistoryIndex(next);
              setCommand(next === -1 ? "" : (history[next] ?? ""));
            }
          }}
          disabled={
            !containerId || !host || host.status !== "online" || running
          }
          placeholder="Run a command inside the container"
          fullWidth
          size="small"
          aria-label="Terminal command"
          sx={{
            "& .MuiInputBase-root": {
              bgcolor: "var(--dd-terminal-input)",
              color: "var(--dd-terminal-foreground)",
              fontFamily: "var(--dd-font-mono)",
              fontSize,
            },
            "& fieldset": { borderColor: "var(--dd-terminal-border)" },
          }}
        />
        <Button
          variant="contained"
          onClick={() => void runCommand()}
          disabled={
            !containerId ||
            !host ||
            host.status !== "online" ||
            running ||
            !command.trim()
          }
          startIcon={<PlayArrow />}
        >
          {running ? "Running…" : "Run"}
        </Button>
      </Stack>
    </Paper>
  );
}
