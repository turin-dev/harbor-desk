import { createTheme, type PaletteMode } from "@mui/material/styles";

/**
 * Docker Desktop's public visual language is built on MUI primitives and an
 * 8px design-token scale. Keep the tokens here so the renderer does not grow
 * screen-specific colors or spacing values that drift apart over time.
 */
const light = {
  background: "#ffffff",
  paper: "#ffffff",
  surfaceSubtle: "#f9f9fa",
  nav: "#f9f9fa",
  navHover: "#f4f4f6",
  navActive: "#e5f2fc",
  header: "#0b3d91",
  headerField: "#174f9e",
  border: "#c4c8d1",
  muted: "#677285",
  textStrong: "#393f49",
  primary: "#1d63ed",
  primaryStrong: "#00308d",
  primarySoft: "#e5f2fc",
  success: "#2e7f74",
  successStrong: "#185a51",
  successSoft: "#e6f5f3",
  warning: "#b85504",
  warningStrong: "#893607",
  warningSoft: "#fff4dc",
  error: "#d52536",
  errorStrong: "#8b1924",
  errorSoft: "#fdeaea",
  violet: "#7d2eff",
  terminalBackground: "#080b0e",
  terminalForeground: "#ffffff",
  terminalMuted: "#7794ab",
  terminalBorder: "#2d404e",
  terminalInput: "#151c20",
  terminalSuccess: "#7accc3",
  terminalWarning: "#ffb05b",
  terminalError: "#f18f9c",
};

const dark = {
  background: "#0d1218",
  paper: "#10171d",
  surfaceSubtle: "#16212a",
  nav: "#080e13",
  navHover: "#111d26",
  navActive: "#112741",
  header: "#082d72",
  headerField: "#17417f",
  border: "#2a3742",
  muted: "#91a4b7",
  textStrong: "#f4f7fb",
  primary: "#1d63ed",
  primaryStrong: "#0b45c4",
  primarySoft: "#122b4b",
  success: "#00a58c",
  successStrong: "#006256",
  successSoft: "#042723",
  warning: "#db7512",
  warningStrong: "#964500",
  warningSoft: "#381906",
  error: "#e65264",
  errorStrong: "#b11d35",
  errorSoft: "#3c0710",
  violet: "#a371fc",
  terminalBackground: "#080b0e",
  terminalForeground: "#ffffff",
  terminalMuted: "#91a4b7",
  terminalBorder: "#2a3742",
  terminalInput: "#151c20",
  terminalSuccess: "#7accc3",
  terminalWarning: "#ffb05b",
  terminalError: "#f18f9c",
};

export type HarborThemeTokens = typeof light;

export function createHarborTheme(mode: PaletteMode) {
  const colors = mode === "dark" ? dark : light;

  return createTheme({
    palette: {
      mode,
      primary: { main: colors.primary },
      secondary: { main: colors.warning },
      info: { main: colors.primary },
      success: { main: colors.success },
      warning: { main: colors.warning },
      error: { main: colors.error },
      background: { default: colors.background, paper: colors.paper },
      divider: colors.border,
      text: {
        primary: colors.textStrong,
        secondary: colors.muted,
      },
    },
    typography: {
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      fontSize: 14,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 700,
      body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.43 },
      body2: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.38 },
      h1: { fontSize: "2.25rem", fontWeight: 500, lineHeight: 1.2 },
      h2: { fontSize: "2rem", fontWeight: 500, lineHeight: 1.2 },
      h3: { fontSize: "1.5rem", fontWeight: 500, lineHeight: 1.25 },
      h4: { fontSize: "1.25rem", fontWeight: 500, lineHeight: 1.3 },
      h5: { fontSize: "1.125rem", fontWeight: 500, lineHeight: 1.35 },
      h6: { fontSize: "1rem", fontWeight: 500, lineHeight: 1.4 },
      caption: { fontSize: "0.75rem", letterSpacing: 0 },
    },
    shape: { borderRadius: 4 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "*": { boxSizing: "border-box" },
          ":root": {
            "--dd-spacing-unit": "8px",
            "--dd-font-sans": 'Roboto, "Segoe UI", system-ui, sans-serif',
            "--dd-font-mono":
              '"Roboto Mono", "Cascadia Mono", ui-monospace, monospace',
            "--dd-color-background": colors.background,
            "--dd-color-surface": colors.paper,
            "--dd-color-surface-subtle": colors.surfaceSubtle,
            "--dd-color-nav": colors.nav,
            "--dd-color-nav-hover": colors.navHover,
            "--dd-color-nav-active": colors.navActive,
            "--dd-color-header": colors.header,
            "--dd-color-header-field": colors.headerField,
            "--dd-color-border": colors.border,
            "--dd-color-blue-500": colors.primary,
            "--dd-color-blue-700": colors.primaryStrong,
            "--dd-color-green-500": colors.success,
            "--dd-color-green-soft": colors.successSoft,
            "--dd-color-amber-500": colors.warning,
            "--dd-color-amber-soft": colors.warningSoft,
            "--dd-color-red-500": colors.error,
            "--dd-color-red-soft": colors.errorSoft,
            "--dd-color-violet-500": colors.violet,
            "--dd-nav-foreground": mode === "dark" ? "#ffffff" : "#000000",
            "--dd-nav-muted": colors.muted,
            "--dd-terminal-background": colors.terminalBackground,
            "--dd-terminal-foreground": colors.terminalForeground,
            "--dd-terminal-muted": colors.terminalMuted,
            "--dd-terminal-border": colors.terminalBorder,
            "--dd-terminal-input": colors.terminalInput,
            "--dd-terminal-success": colors.terminalSuccess,
            "--dd-terminal-warning": colors.terminalWarning,
            "--dd-terminal-error": colors.terminalError,
            "--dd-shell-topbar-height": "64px",
            "--dd-shell-sidebar-width": "256px",
            "--dd-shell-statusbar-height": "32px",
          },
          body: {
            margin: 0,
            minWidth: 960,
            backgroundColor: colors.background,
            color: colors.textStrong,
            fontFamily: "var(--dd-font-sans)",
            letterSpacing: 0,
          },
          "::-webkit-scrollbar": { width: 9, height: 9 },
          "::-webkit-scrollbar-thumb": {
            background: mode === "dark" ? "#4e6a81" : "#c4c8d1",
            borderRadius: 8,
          },
          "::-webkit-scrollbar-track": { background: "transparent" },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            border: `1px solid ${colors.border}`,
            boxShadow: "none",
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: {
          root: {
            minHeight: 32,
            textTransform: "none",
            fontWeight: 500,
            borderRadius: 4,
            letterSpacing: 0,
          },
          containedPrimary: {
            color: "#ffffff",
            backgroundColor: colors.primary,
            "&:hover": { backgroundColor: colors.primaryStrong },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 4 } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: colors.border, padding: "8px 12px" },
          head: {
            color: colors.textStrong,
            fontWeight: 500,
            fontSize: 14,
            textTransform: "none",
            letterSpacing: 0,
          },
        },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 500, borderRadius: 999 } },
      },
      MuiTextField: {
        defaultProps: { size: "small" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            backgroundColor: colors.surfaceSubtle,
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: colors.primary,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderWidth: 2,
            },
          },
          notchedOutline: { borderColor: colors.border },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            "&.Mui-selected": {
              backgroundColor: colors.navActive,
              color: mode === "dark" ? "#ffffff" : colors.primaryStrong,
            },
            "&.Mui-selected:hover": { backgroundColor: colors.navHover },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 8 },
        },
      },
    },
  });
}

export const harborSurface = {
  light,
  dark,
};
