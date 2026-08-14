import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

test("frontend uses the authoritative snapshot API without legacy fallbacks", () => {
  assert.match(dashboardSource, /fetch\("\/api\/snapshot"/);
  assert.doesNotMatch(dashboardSource, /\/api\/overview/);
  assert.doesNotMatch(dashboardSource, /\/api\/actors/);
  assert.doesNotMatch(dashboardSource, /legacyProjects|loadLegacySnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("home page no longer seeds a hardcoded legacy project list", () => {
  assert.match(pageSource, /<DashboardClient\s*\/>/);
  assert.doesNotMatch(pageSource, /LEGACY_PROJECTS|legacyProjects/);
});

test("retired legacy payload types are removed", () => {
  assert.doesNotMatch(typesSource, /LegacyActorSnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("snapshot-only cleanup preserves live and raw-table endpoints", () => {
  assert.match(dashboardSource, /new EventSource\("\/events"\)/);
  assert.match(dashboardSource, /fetch\(`\/api\/tables\/\$\{table\}`/);
});
