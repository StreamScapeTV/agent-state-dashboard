import { DashboardClient } from "@/components/DashboardClient";

const LEGACY_PROJECTS = [
  "agent-state-dashboard",
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
  return <DashboardClient legacyProjects={LEGACY_PROJECTS} />;
}
