import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { DashboardThemeProvider } from "@/app/theme-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Agent State Dashboard",
  applicationName: "Agent State Dashboard",
  description: "Private read-only operations dashboard for current AI agent and project state",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#071018",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <DashboardThemeProvider>{children}</DashboardThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
