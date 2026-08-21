import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("approved agent-state visual identity is wired through App Router metadata", () => {
  const icon = source("app/icon.svg");
  const layout = source("app/layout.tsx");

  assert.match(icon, /#00D4FF/i);
  assert.match(icon, /#22C55E/i);
  assert.match(icon, /<rect x="154" y="188" width="204" height="96"/);
  assert.match(icon, /<rect x="270" y="292" width="34" height="140"/);
  assert.match(layout, /title: "Agent State Dashboard"/);
  assert.match(layout, /applicationName: "Agent State Dashboard"/);
  assert.match(layout, /themeColor: "#071018"/);
  assert.match(layout, /viewportFit: "cover"/);
});

test("responsive shell preserves project-first mobile usability", () => {
  const theme = source("app/theme-provider.tsx");
  const dashboard = source("components/DashboardClient.tsx");
  const projects = source("components/ProjectOverview.tsx");
  const activity = source("components/ActivityLogView.tsx");

  assert.match(theme, /minHeight: 44/);
  assert.match(theme, /MuiTableContainer/);
  assert.match(theme, /WebkitOverflowScrolling: "touch"/);
  assert.match(dashboard, /src="\/icon\.svg"/);
  assert.equal((dashboard.match(/fullScreen=\{compactDialog\}/g) ?? []).length, 2);
  assert.match(dashboard, /allowScrollButtonsMobile/);
  assert.match(dashboard, /width: \{ xs: "100%", sm: "auto" \}/);
  assert.match(projects, /sm: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(projects, /WebkitLineClamp: 2/);
  assert.match(projects, /overflowWrap: "anywhere"/);
  assert.match(activity, /width: \{ xs: "100%", lg: "auto" \}/);
  assert.match(activity, /gridTemplateColumns:/);
});

test("visual identity and metadata stay environment-neutral", () => {
  const files = [
    "app/icon.svg",
    "app/layout.tsx",
    "app/theme-provider.tsx",
    "app/globals.css",
    "components/DashboardClient.tsx",
    "components/ProjectOverview.tsx",
    "components/ActivityLogView.tsx",
  ].map(source).join("\n");

  assert.doesNotMatch(files, /tailscale\.com/i);
  assert.doesNotMatch(files, /loadBalancerClass/i);
  assert.doesNotMatch(files, /ClusterIssuer/i);
  assert.doesNotMatch(files, /\.faruqi\.dev/i);
});
