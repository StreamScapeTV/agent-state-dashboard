import { DashboardClient } from "@/components/DashboardClient";

const PROJECTS = [
  "agent-state-supabase",
  "ci-workflows",
  "iptv-backend",
  "iptv-android",
  "iptv-apple",
  "StreamScapeWeb",
  "streamscape-media",
  "flux",
];

export default function Home() {
  return (
    <DashboardClient
      projects={PROJECTS}
      viewer={{ email: "Cloudflare Access SSO", subject: "cloudflare-access" }}
    />
  );
}
