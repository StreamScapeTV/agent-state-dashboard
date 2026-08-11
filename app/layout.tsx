import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { DashboardThemeProvider } from "@/app/theme-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Agent State Control Room",
  description: "Read-only StreamScapeTV Agent State operations dashboard",
  robots: { index: false, follow: false },
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
