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
  nodeVersionSource,
  nextConfigSource,
  dockerIgnore,
  gitIgnore,
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
  read(".nvmrc"),
  read("next.config.ts"),
  read(".dockerignore"),
  read(".gitignore"),
]);

const packageJson = JSON.parse(packageJsonSource);
const chartValuesSchema = JSON.parse(valuesSchema);
const nodeVersion = nodeVersionSource.trim();
const chartVersion = chart.match(/^version:\s*([^\s]+)$/m)?.[1];
const chartAppVersion = chart.match(/^appVersion:\s*["']?([^"'\s]+)["']?$/m)?.[1];

test("container packages static export behind NGINX and a loopback Node data process", () => {
  assert.match(dockerfile, new RegExp(`ARG NODE_VERSION=${nodeVersion.replaceAll(".", "\\.")}`));
  const pinnedNodeBases = dockerfile.match(
    /FROM node:\$\{NODE_VERSION\}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b/g,
  );
  assert.equal(pinnedNodeBases?.length, 2);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /test -f server\/index\.mjs/);
  assert.match(dockerfile, /cp -R server\/\. \/opt\/dashboard\/server\//);
  assert.doesNotMatch(dockerfile, /if \[ -d server \]/);
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

test("static build identity rotates with the release version before immutable caching", () => {
  assert.match(nextConfigSource, /readFileSync\("package\.json", "utf8"\)/);
  assert.match(nextConfigSource, /generateBuildId:[^\n]*agent-state-dashboard-\$\{packageVersion\}/);
  assert.doesNotMatch(nextConfigSource, /agent-state-dashboard-static/);
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
  assert.equal(chartVersion, packageJson.version);
  assert.equal(chartAppVersion, packageJson.version);
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

test("Helm schema admits only existing-Secret Supabase references", () => {
  const supabase = chartValuesSchema.properties?.supabase;
  const existingSecret = supabase?.properties?.existingSecret;
  assert.equal(supabase?.additionalProperties, false);
  assert.deepEqual(Object.keys(supabase?.properties ?? {}), ["existingSecret"]);
  assert.equal(existingSecret?.additionalProperties, false);
  assert.deepEqual(
    Object.keys(existingSecret?.properties ?? {}).sort(),
    ["name", "secretKeyKey", "urlKey"],
  );
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

test("retired Cloudflare secret scratch files stay out of Git and image contexts", () => {
  for (const ignore of [gitIgnore, dockerIgnore]) {
    assert.match(ignore, /^\.dev\.vars$/m);
    assert.match(ignore, /^\.dev\.vars\.\*$/m);
  }
});

test("package scripts no longer encode a Cloudflare Pages deployment path", () => {
  const scripts = packageJson.scripts ?? {};
  for (const name of Object.keys(scripts)) assert.doesNotMatch(name, /^pages:/);
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /wrangler\s+pages|pages functions/i);
});
