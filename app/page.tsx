import { LockRounded } from "@mui/icons-material";
import { Alert, Box, Chip, Container, Paper, Stack, Typography } from "@mui/material";
import { headers } from "next/headers";
import { DashboardClient } from "@/components/DashboardClient";
import { verifyCloudflareAccess } from "@/lib/access";
import { getConfiguredProjects } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const access = await verifyCloudflareAccess(await headers());

  if (!access.ok) {
    return (
      <Container maxWidth="sm" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", py: 4 }}>
        <Paper sx={{ p: { xs: 3, sm: 5 }, width: "100%", border: "1px solid", borderColor: "divider" }}>
          <Stack spacing={2.5} alignItems="flex-start">
            <Box sx={{ width: 52, height: 52, borderRadius: 3, bgcolor: "rgba(39,213,198,0.1)", color: "primary.main", display: "grid", placeItems: "center" }}>
              <LockRounded />
            </Box>
            <Chip label="Protected application" color="primary" size="small" variant="outlined" />
            <Box>
              <Typography variant="h4">Cloudflare Access required</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                This dashboard exposes no Agent State data until Cloudflare Access has authenticated and the Worker has verified its signed assertion.
              </Typography>
            </Box>
            <Alert severity="info" sx={{ width: "100%" }}>{access.reason}</Alert>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return <DashboardClient projects={getConfiguredProjects()} viewer={access.viewer} />;
}
