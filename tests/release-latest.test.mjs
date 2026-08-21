import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const release = read(".github/workflows/release.yml");
const chart = read("charts/agent-state-dashboard/Chart.yaml");
const values = read("charts/agent-state-dashboard/values.yaml");
const deployment = read("charts/agent-state-dashboard/templates/deployment.yaml");

const chartVersion = chart.match(/^version:\s*([^\s]+)$/m)?.[1];
const chartAppVersion = chart.match(/^appVersion:\s*["']?([^"'\s]+)["']?$/m)?.[1];

test("normal public release opts into the Docker latest convenience alias", () => {
  assert.match(
    release,
    /uses: StreamScapeTV\/ci-workflows\/\.github\/workflows\/reusable-public-native-image-chart\.yml@main/,
  );
  assert.match(release, /publish_latest_image:\s*true/);
  assert.match(release, /permissions:\s*\n\s*contents: read\s*\n\s*packages: write/);
  assert.doesNotMatch(release, /execution_backend|self-hosted|registry_username|registry_token|kubeconfig/i);
});

test("Helm defaults pin each chart release to its matching immutable image version", () => {
  assert.ok(chartVersion);
  assert.equal(chartAppVersion, chartVersion);
  assert.match(values, /repository: ghcr\.io\/streamscapetv\/agent-state-dashboard/);
  assert.match(values, /^\s*tag:\s*""\s*$/m);
  assert.match(values, /^\s*digest:\s*""\s*$/m);
  assert.match(
    deployment,
    /image:\s*"\{\{ \.Values\.image\.repository \}\}:\{\{ default \.Chart\.AppVersion \.Values\.image\.tag \}\}"/,
  );
  assert.doesNotMatch(`${chart}\n${values}\n${deployment}`, /:\s*latest\b|tag:\s*["']?latest["']?/i);
});

test("latest never becomes Helm release or deployment authority", () => {
  assert.doesNotMatch(chart, /^version:\s*latest\s*$/m);
  assert.doesNotMatch(chart, /^appVersion:\s*["']?latest["']?\s*$/m);
  assert.doesNotMatch(values, /tag:\s*["']?latest["']?/i);
  assert.doesNotMatch(deployment, /latest/i);
});
