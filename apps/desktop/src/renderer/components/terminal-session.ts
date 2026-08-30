import type { TerminalFrame } from "@harbor/contracts";

/**
 * Pure terminal drawer state transitions, kept framework-free for unit tests.
 */

export const maximumHistoryEntries = 30;

export function appendToHistory(history: string[], command: string): string[] {
  return [command, ...history.filter((item) => item !== command)].slice(
    0,
    maximumHistoryEntries,
  );
}

export function promptLine(
  containerName: string | undefined,
  command: string,
): string {
  return `harbor@${containerName ?? "container"}:~$ ${command}`;
}

export interface TerminalRunState {
  output: string[];
  error?: string;
  running: boolean;
}

/**
 * Applies one parsed terminal frame to the run state.
 * Returns a new state; a terminal (exit/error) frame stops the run.
 */
export function applyTerminalFrame(
  state: TerminalRunState,
  frame: TerminalFrame,
): TerminalRunState {
  switch (frame.type) {
    case "stdout":
    case "stderr":
      return { ...state, output: [...state.output, frame.data] };
    case "exit":
      return { ...state, running: false };
    case "error":
      return { ...state, error: frame.message, running: false };
    default:
      return state;
  }
}

export function isTerminalFrame(frame: TerminalFrame): boolean {
  return frame.type === "exit" || frame.type === "error";
}

export function requestErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not create a terminal session.";
}

export function terminalFrameErrorMessage(frame: TerminalFrame): string {
  return frame.type === "error"
    ? frame.message
    : "The terminal returned an invalid frame.";
}

export function canRunTerminalCommand(input: {
  host?: { id?: string; status?: string };
  containerId?: string;
  command: string;
  running: boolean;
}): boolean {
  return (
    Boolean(input.host?.id) &&
    input.host?.status === "online" &&
    Boolean(input.containerId) &&
    input.command.trim().length > 0 &&
    !input.running
  );
}
