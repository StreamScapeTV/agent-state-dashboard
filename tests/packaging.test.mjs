import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  dockerfile,
  entrypoint,
  nginx,
  chart,
  values,
  valuesSchema,
  deployment,
  service,
  releaseWorkflow,
  packageJsonSource,
] = await Promise.all([
  read("Dockerfile"),
  read("docker/entrypoint.sh"),
  read("docker/nginx.conf"),
  read("charts/agent-state-dashboard/Chart.yaml"),
  read("charts/agent-state-dashboard/values.yaml"),
  read("charts/agent-state-dashboard/values.schema.json"),
  read("charts/agent-state-dashboard/templates/deployment.yaml"),
  read("charts/agent-state-dashboard/templates/service.yaml"),
  read(".github/workflows/release.yml"),
  read("package.json"),
]);

const packageJson = JSON.parse(packageJsonSource);
const chartValuesSchema = JSON.parse(valuesSchema);

test("container packages static export behind NGINX and a loopback Node data process", () => {
  assert.match(dockerfile, /ARG NODE_VERSION=22\.18\.0/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /COPY --from=build[^\n]*\/opt\/dashboard\/static/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /HEALTHCHECK[^\n]*--interval=30s/);
  assert.match(dockerfile, /127\.0\.0\.1:8080\/healthz/);
  assert.match(entrypoint, /SERVER_ENTRYPOINT:-\/app\/server\/index\.mjs/);
  assert.match(entrypoint, /SUPABASE_URL/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEY/);
  assert.match(entrypoint, /SERVER_PORT:-8788/);
  assert.doesNotMatch(`${dockerfile}\n${entrypoint}`, /AGENT_STATE_SUPABASE_SECRET_KEY|TEAM_DOMAIN|POLICY_AUD|fvbaxyklaclgdzyhybbr/);
});

test("NGINX proxies only the local data routes and gives immutable static assets long caching", () => {
  assert.match(nginx, /server 127\.0\.0\.1:8788/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /location = \/events/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /location \/_next\/static\//);
  assert.match(nginx, /immutable/);
  assert.match(nginx, /try_files \$uri \$uri\/ \$uri\.html \/index\.html/);
});

test("Helm defaults use the exact existing Secret and Tailscale contract", () => {
  assert.match(chart, /version: 0\.1\.0/);
  assert.match(chart, /appVersion: "0\.1\.0"/);
  assert.equal(chartValuesSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.match(values, /name: agent-state-dashboard-supabase/);
  assert.match(values, /urlKey: SUPABASE_URL/);
  assert.match(values, /secretKeyKey: SUPABASE_SECRET_KEY/);
  assert.match(values, /hostname: agent-state-dashboard/);
  assert.match(values, /- tag:agent-state-dashboard/);
  assert.match(values, /proxyGroup: tailscale-proxy-group/);

  assert.match(service, /type: LoadBalancer/);
  assert.match(service, /loadBalancerClass: tailscale/);
  assert.match(service, /allocateLoadBalancerNodePorts: false/);
  assert.match(service, /tailscale\.com\/hostname/);
  assert.match(service, /tailscale\.com\/tags/);
  assert.match(service, /tailscale\.com\/proxy-group/);
});

test("Helm workload reads secrets by reference and has bounded probes/resources/security", () => {
  assert.match(deployment, /secretKeyRef:/);
  assert.match(deployment, /name: SUPABASE_URL/);
  assert.match(deployment, /name: SUPABASE_SECRET_KEY/);
  assert.match(deployment, /readinessProbe:/);
  assert.match(deployment, /livenessProbe:/);
  assert.match(deployment, /path: \/healthz/);
  assert.match(deployment, /resources:/);
  assert.match(deployment, /automountServiceAccountToken: false/);
  assert.match(deployment, /imagePullSecrets:/);
  assert.match(deployment, /readOnlyRootFilesystem: true/);
  assert.doesNotMatch(deployment, /value:\s*['"]?https?:\/\/[^\s]+supabase/);
});

test("release is a thin exact-tag central workflow caller with no product runner selection", () => {
  assert.match(releaseWorkflow, /reusable-tag-image-chart\.yml@main/);
  assert.match(releaseWorkflow, /image_name: agent-state-dashboard/);
  assert.match(releaseWorkflow, /chart_path: charts\/agent-state-dashboard/);
  assert.match(releaseWorkflow, /FORGEJO_REGISTRY_USERNAME/);
  assert.match(releaseWorkflow, /FORGEJO_REGISTRY_TOKEN/);
  assert.doesNotMatch(releaseWorkflow, /runs-on:/);
  assert.doesNotMatch(releaseWorkflow, /latest/);
});

test("package scripts no longer encode a Cloudflare Pages deployment path", () => {
  const scripts = packageJson.scripts ?? {};
  for (const name of Object.keys(scripts)) assert.doesNotMatch(name, /^pages:/);
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /wrangler\s+pages|pages functions/i);
});
