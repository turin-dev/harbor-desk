import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EventEnvelope } from "@harbor/contracts";

type ThemeMode = "light" | "dark" | "system";
export type ToastSeverity = "success" | "info" | "warning" | "error";

export interface UiNotification {
  id: string;
  event: EventEnvelope;
  read: boolean;
}

export interface UiToast {
  id: string;
  message: string;
  severity: ToastSeverity;
}

interface UiState {
  selectedHostId?: string;
  themeMode: ThemeMode;
  launchAtLogin: boolean;
  automaticUpdateChecks: boolean;
  includePreviewUpdates: boolean;
  updateStatus: DesktopUpdateCheckStatus;
  showConnectionNotifications: boolean;
  terminalFontSize: number;
  terminalOpen: boolean;
  terminalContainerId?: string;
  terminalContainerName?: string;
  notifications: UiNotification[];
  toast?: UiToast;
  setSelectedHostId: (hostId: string | undefined) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setLaunchAtLogin: (enabled: boolean) => void;
  setAutomaticUpdateChecks: (enabled: boolean) => void;
  setIncludePreviewUpdates: (enabled: boolean) => void;
  setUpdateStatus: (status: DesktopUpdateCheckStatus) => void;
  setShowConnectionNotifications: (enabled: boolean) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalContainer: (
    containerId: string | undefined,
    containerName?: string,
  ) => void;
  addNotification: (event: EventEnvelope) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
  showToast: (message: string, severity?: ToastSeverity) => void;
  dismissToast: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themeMode: "dark",
      launchAtLogin: false,
      automaticUpdateChecks: true,
      includePreviewUpdates: true,
      updateStatus: {
        state: "idle",
        currentVersion: "development",
        message: "Updates have not been checked yet.",
      },
      showConnectionNotifications: true,
      terminalFontSize: 12,
      terminalOpen: false,
      notifications: [],
      setSelectedHostId: (selectedHostId) =>
        set((state) =>
          state.selectedHostId === selectedHostId
            ? { selectedHostId }
            : {
                selectedHostId,
                terminalOpen: false,
                terminalContainerId: undefined,
                terminalContainerName: undefined,
              },
        ),
      setThemeMode: (themeMode) => set({ themeMode }),
      setLaunchAtLogin: (launchAtLogin) => set({ launchAtLogin }),
      setAutomaticUpdateChecks: (automaticUpdateChecks) =>
        set({ automaticUpdateChecks }),
      setIncludePreviewUpdates: (includePreviewUpdates) =>
        set({ includePreviewUpdates }),
      setUpdateStatus: (updateStatus) => set({ updateStatus }),
      setShowConnectionNotifications: (showConnectionNotifications) =>
        set({ showConnectionNotifications }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setTerminalContainer: (terminalContainerId, terminalContainerName) =>
        set({ terminalContainerId, terminalContainerName }),
      addNotification: (event) =>
        set((state) => {
          if (state.notifications.some((item) => item.id === event.cursor))
            return state;
          return {
            notifications: [
              { id: event.cursor, event, read: false },
              ...state.notifications,
            ].slice(0, 50),
          };
        }),
      markNotificationsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((item) => ({
            ...item,
            read: true,
          })),
        })),
      clearNotifications: () => set({ notifications: [] }),
      showToast: (message, severity = "info") =>
        set({
          toast: {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            message,
            severity,
          },
        }),
      dismissToast: () => set({ toast: undefined }),
    }),
    {
      name: "harbor-desk-ui",
      partialize: (state) => ({
        selectedHostId: state.selectedHostId,
        themeMode: state.themeMode,
        launchAtLogin: state.launchAtLogin,
        automaticUpdateChecks: state.automaticUpdateChecks,
        includePreviewUpdates: state.includePreviewUpdates,
        showConnectionNotifications: state.showConnectionNotifications,
        terminalFontSize: state.terminalFontSize,
      }),
    },
  ),
);
