"use client";

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type { ReactNode } from "react";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#00D4FF" },
    secondary: { main: "#8B7CFF" },
    success: { main: "#22C55E" },
    warning: { main: "#FFB45C" },
    background: {
      default: "#071018",
      paper: "#0D1823",
    },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h3: { fontWeight: 760, letterSpacing: "-0.045em" },
    h4: { fontWeight: 740, letterSpacing: "-0.035em" },
    h5: { fontWeight: 720, letterSpacing: "-0.025em" },
    button: { textTransform: "none", fontWeight: 700 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderColor: "rgba(148, 163, 184, 0.14)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0))",
          border: "1px solid rgba(148, 163, 184, 0.14)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, maxWidth: "100%" },
        label: { overflow: "hidden", textOverflow: "ellipsis" },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 12,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          width: 44,
          height: 44,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 48,
          minWidth: 88,
          paddingInline: 14,
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 56,
        },
        content: {
          marginBlock: 10,
          minWidth: 0,
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          maxWidth: "100%",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorX: "contain",
          scrollbarWidth: "thin",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: "rgba(148, 163, 184, 0.12)",
          [theme.breakpoints.down("sm")]: {
            padding: "10px 8px",
          },
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          [theme.breakpoints.down("sm")]: {
            margin: 12,
            maxHeight: "calc(100% - 24px)",
          },
        }),
      },
    },
  },
});

export function DashboardThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
