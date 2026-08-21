import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  dockerfile,
  entrypoint,
  nginx,
  securityHeaders,
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
  read("docker/security-headers.conf"),
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

test("container builds with Node and runs only pinned TLS NGINX", () => {
  assert.match(dockerfile, new RegExp(`ARG NODE_VERSION=${nodeVersion.replaceAll(".", "\\.")}`));
  const pinnedNodeBases = dockerfile.match(
    /FROM docker\.io\/library\/node:\$\{NODE_VERSION\}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b/g,
  );
  assert.equal(pinnedNodeBases?.length, 1);
  assert.match(dockerfile, /ARG NGINX_VERSION=1\.29\.8/);
  assert.match(
    dockerfile,
    /FROM docker\.io\/library\/nginx:\$\{NGINX_VERSION\}-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime/,
  );
  assert.doesNotMatch(dockerfile, /^FROM (?:node|nginx):/m);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /test -f out\/index\.html/);
  assert.match(dockerfile, /test -d out\/_next\/static/);
  assert.match(dockerfile, /COPY --from=build \/workspace\/out\/ \/usr\/share\/nginx\/html\//);
  assert.match(dockerfile, /COPY docker\/nginx\.conf \/etc\/nginx\/templates\/nginx\.conf\.template/);
  assert.match(dockerfile, /COPY docker\/security-headers\.conf \/etc\/nginx\/security-headers\.conf/);
  assert.match(dockerfile, /USER 101/);
  assert.match(dockerfile, /EXPOSE 8443/);
  assert.doesNotMatch(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /HEALTHCHECK[^\n]*--interval=30s/);
  assert.match(dockerfile, /--no-check-certificate/);
  assert.match(dockerfile, /https:\/\/127\.0\.0\.1:8443\/healthz/);
  assert.doesNotMatch(dockerfile, /http:\/\/127\.0\.0\.1:8080\/healthz/);
  assert.match(dockerfile, /STOPSIGNAL SIGQUIT/);
  assert.doesNotMatch(dockerfile, /npm ci --omit=dev|\/app\/server|opt\/dashboard\/server|tini|AS runtime[\s\S]*FROM node/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*server\//);

  assert.match(entrypoint, /SUPABASE_URL must be supplied by the Kubernetes Secret/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEY must be supplied by the Kubernetes Secret/);
  assert.match(entrypoint, /tls_cert="\/tls\/tls\.crt"/);
  assert.match(entrypoint, /tls_key="\/tls\/tls\.key"/);
  assert.match(entrypoint, /TLS certificate must be mounted/);
  assert.match(entrypoint, /TLS private key must be mounted/);
  assert.match(entrypoint, /\^https\?\:\/\//);
  assert.match(entrypoint, /A-Za-z0-9\._-/);
  assert.match(entrypoint, /SUPABASE_URL="\$\{SUPABASE_URL%\/\}"/);
  assert.match(entrypoint, /envsubst '\$\{SUPABASE_URL\} \$\{SUPABASE_SECRET_KEY\}'/);
  assert.match(entrypoint, /\/tmp\/nginx\.conf/);
  assert.match(entrypoint, /umask 077/);
  assert.match(entrypoint, /\/tmp\/nginx\/client_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/proxy_temp/);
  assert.match(entrypoint, /unset SUPABASE_URL SUPABASE_SECRET_KEY/);
  assert.match(entrypoint, /nginx -t -c "\$\{nginx_config\}"/);
  assert.match(entrypoint, /exec nginx -c "\$\{nginx_config\}" -g 'daemon off;'/);
  assert.doesNotMatch(entrypoint, /SERVER_ENTRYPOINT|SERVER_PORT|\bnode\b|kill -TERM|\bwait\b/);

  assert.doesNotMatch(
    `${dockerfile}\n${entrypoint}\n${nginx}`,
    /AGENT_STATE_SUPABASE_SECRET_KEY|TEAM_DOMAIN|POLICY_AUD|fvbaxyklaclgdzyhybbr/,
  );
});

test("static build identity rotates with the release version before immutable caching", () => {
  assert.match(nextConfigSource, /readFileSync\("package\.json", "utf8"\)/);
  assert.match(nextConfigSource, /generateBuildId:[^\n]*agent-state-dashboard-\$\{packageVersion\}/);
  assert.doesNotMatch(nextConfigSource, /agent-state-dashboard-static/);
});

test("NGINX terminates mandatory TLS and exposes only the five-table gateway plus Realtime and static UI", () => {
  assert.match(nginx, /^worker_processes 1;$/m);
  assert.match(nginx, /listen 8443 ssl;/);
  assert.match(nginx, /listen \[::\]:8443 ssl;/);
  assert.match(nginx, /ssl_certificate \/tls\/tls\.crt;/);
  assert.match(nginx, /ssl_certificate_key \/tls\/tls\.key;/);
  assert.match(nginx, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.doesNotMatch(nginx, /listen 8080/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /return 200 "ok\\n"/);
  assert.doesNotMatch(nginx, /dashboard_server|127\.0\.0\.1:8788|location \/api\/|location = \/events/);

  assert.match(nginx, /proxy_ssl_verify on/);
  assert.match(nginx, /proxy_ssl_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt/);
  assert.match(
    nginx,
    /location ~ \^\/supabase\/rest\/v1\/\(current_projects\|current_agents\|current_work\|current_resources\|current_coordination\)\/\?\$/,
  );
  assert.match(nginx, /\$request_method !~ \^\(GET\|HEAD\|OPTIONS\)\$/);
  assert.match(nginx, /if \(\$arg_apikey != ''\)/);
  assert.match(nginx, /rewrite \^\/supabase\/rest\/v1\/\(current_projects\|current_agents\|current_work\|current_resources\|current_coordination\)\/\?\$ \/rest\/v1\/\$1 break/);
  assert.match(nginx, /proxy_set_header apikey "\$\{SUPABASE_SECRET_KEY\}"/);
  assert.match(nginx, /proxy_set_header Authorization ""/);
  assert.match(nginx, /proxy_set_header X-HTTP-Method-Override ""/);
  assert.match(nginx, /proxy_pass \$\{SUPABASE_URL\};/);
  assert.match(nginx, /location = \/supabase\/rest\/v1 \{\s*return 404;/);
  assert.match(nginx, /location \/supabase\/rest\/v1\/ \{\s*return 404;/);

  assert.match(nginx, /map \$http_upgrade \$connection_upgrade/);
  assert.match(nginx, /map \$arg_vsn \$realtime_vsn/);
  assert.match(nginx, /'1\.0\.0' '&vsn=1\.0\.0'/);
  assert.match(nginx, /'2\.0\.0' '&vsn=2\.0\.0'/);
  assert.match(nginx, /map \$arg_log_level \$realtime_log_level/);
  assert.match(nginx, /'info' '&log_level=info'/);
  assert.match(nginx, /'warn' '&log_level=warn'/);
  assert.match(nginx, /'error' '&log_level=error'/);
  assert.match(nginx, /location = \/supabase\/realtime\/v1\/websocket/);
  assert.match(
    nginx,
    /set \$args "apikey=\$\{SUPABASE_SECRET_KEY\}\$\{realtime_vsn\}\$\{realtime_log_level\}"/,
  );
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_set_header Connection \$connection_upgrade/);
  assert.match(nginx, /proxy_set_header x-api-key "\$\{SUPABASE_SECRET_KEY\}"/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /proxy_read_timeout 1h/);
  assert.match(nginx, /proxy_send_timeout 1h/);
  assert.match(nginx, /proxy_pass \$\{SUPABASE_URL\}\/realtime\/v1\/websocket/);

  assert.equal((nginx.match(/proxy_set_header User-Agent "StreamScapeTV-Agent-State-Dashboard-Gateway\/1"/g) ?? []).length, 2);
  assert.equal((nginx.match(/error_log \/dev\/null emerg;/g) ?? []).length, 2);
  assert.equal((nginx.match(/access_log off;/g) ?? []).length, 3);

  assert.match(nginx, /location \/_next\/static\//);
  assert.match(nginx, /immutable/);
  assert.doesNotMatch(nginx, /^\s*expires\s/m);
  assert.match(nginx, /try_files \$uri \$uri\/ \$uri\.html \/index\.html/);

  const headerIncludes = nginx.match(/include \/etc\/nginx\/security-headers\.conf;/g);
  assert.equal(headerIncludes?.length, 5);
  assert.match(securityHeaders, /X-Content-Type-Options "nosniff" always/);
  assert.match(securityHeaders, /Referrer-Policy "no-referrer" always/);
  assert.match(securityHeaders, /X-Frame-Options "DENY" always/);
  assert.match(securityHeaders, /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)" always/);
});

test("retired Cloudflare Pages headers cannot be copied back into the static export", async () => {
  await assert.rejects(
    access(new URL("../public/_headers", import.meta.url)),
    (error) => error?.code === "ENOENT",
  );
});

test("Helm defaults require TLS and preserve the existing Supabase and Tailscale contracts", () => {
  assert.equal(chartVersion, packageJson.version);
  assert.equal(chartAppVersion, packageJson.version);
  assert.equal(chartValuesSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.match(values, /repository: ghcr\.io\/streamscapetv\/agent-state-dashboard/);
  assert.match(values, /service:\s*\n\s*port: 443/);
  assert.match(values, /name: agent-state-dashboard-supabase/);
  assert.match(values, /urlKey: SUPABASE_URL/);
  assert.match(values, /secretKeyKey: SUPABASE_SECRET_KEY/);
  assert.match(values, /tls:\s*\n\s*existingSecret:/);
  assert.match(values, /name: agent-state-dashboard-tls/);
  assert.match(values, /certKey: tls\.crt/);
  assert.match(values, /keyKey: tls\.key/);
  assert.doesNotMatch(values, /tls:\s*\n\s*enabled:/);
  assert.match(values, /hostname: agent-state-dashboard/);
  assert.match(values, /- tag:agent-state-dashboard/);
  assert.match(values, /proxyGroup: tailscale-proxy-group/);

  assert.match(service, /type: LoadBalancer/);
  assert.match(service, /loadBalancerClass: tailscale/);
  assert.match(service, /allocateLoadBalancerNodePorts: false/);
  assert.match(service, /tailscale\.com\/hostname/);
  assert.match(service, /tailscale\.com\/tags/);
  assert.match(service, /tailscale\.com\/proxy-group/);
  assert.match(service, /name: https/);
  assert.match(service, /targetPort: https/);
});

test("Helm schema models mandatory TLS plus the complete public values surface", () => {
  const properties = chartValuesSchema.properties ?? {};
  const image = properties.image;
  const imagePullSecret = properties.imagePullSecrets?.items;
  const serviceValues = properties.service;
  const tailscale = properties.tailscale;
  const supabase = properties.supabase;
  const existingSecret = supabase?.properties?.existingSecret;
  const tls = properties.tls;
  const tlsExistingSecret = tls?.properties?.existingSecret;
  const podSecurity = properties.podSecurityContext;
  const containerSecurity = properties.securityContext;

  assert.equal(chartValuesSchema.additionalProperties, false);
  assert.ok(chartValuesSchema.required.includes("tls"));
  assert.deepEqual(
    Object.keys(properties).sort(),
    [
      "affinity",
      "fullnameOverride",
      "image",
      "imagePullSecrets",
      "nameOverride",
      "nodeSelector",
      "podAnnotations",
      "podLabels",
      "podSecurityContext",
      "probes",
      "replicaCount",
      "resources",
      "securityContext",
      "service",
      "supabase",
      "tailscale",
      "terminationGracePeriodSeconds",
      "tls",
      "tolerations",
    ],
  );
  assert.equal(image?.additionalProperties, false);
  assert.equal(imagePullSecret?.additionalProperties, false);
  assert.equal(serviceValues?.additionalProperties, false);
  assert.equal(tailscale?.additionalProperties, false);
  assert.equal(supabase?.additionalProperties, false);
  assert.deepEqual(Object.keys(supabase?.properties ?? {}), ["existingSecret"]);
  assert.equal(existingSecret?.additionalProperties, false);
  assert.deepEqual(
    Object.keys(existingSecret?.properties ?? {}).sort(),
    ["name", "secretKeyKey", "urlKey"],
  );
  assert.equal(tls?.additionalProperties, false);
  assert.deepEqual(Object.keys(tls?.properties ?? {}), ["existingSecret"]);
  assert.equal(tlsExistingSecret?.additionalProperties, false);
  assert.deepEqual(
    Object.keys(tlsExistingSecret?.properties ?? {}).sort(),
    ["certKey", "keyKey", "name"],
  );
  assert.deepEqual(tlsExistingSecret?.required?.slice().sort(), ["certKey", "keyKey", "name"]);
  assert.equal(podSecurity?.properties?.runAsNonRoot?.const, true);
  assert.equal(podSecurity?.properties?.runAsUser?.const, 1000);
  assert.equal(podSecurity?.properties?.runAsGroup?.const, 1000);
  assert.equal(podSecurity?.properties?.fsGroup?.const, 1000);
  assert.equal(podSecurity?.properties?.seccompProfile?.properties?.type?.const, "RuntimeDefault");
  assert.equal(containerSecurity?.properties?.allowPrivilegeEscalation?.const, false);
  assert.equal(containerSecurity?.properties?.readOnlyRootFilesystem?.const, true);
  assert.equal(containerSecurity?.properties?.runAsNonRoot?.const, true);
  assert.equal(containerSecurity?.properties?.capabilities?.properties?.drop?.items?.const, "ALL");
});

test("Helm workload mounts mandatory TLS and keeps the pure-NGINX security boundary", () => {
  assert.match(deployment, /secretKeyRef:/);
  assert.match(deployment, /name: SUPABASE_URL/);
  assert.match(deployment, /name: SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(deployment, /name: (?:SERVER_HOST|SERVER_PORT|HOST|PORT)\b/);
  assert.doesNotMatch(deployment, /127\.0\.0\.1:8788|value: "8788"/);
  assert.match(deployment, /name: https\s*\n\s*containerPort: 8443/);
  assert.doesNotMatch(deployment, /containerPort: 8080/);
  assert.match(deployment, /readinessProbe:/);
  assert.match(deployment, /livenessProbe:/);
  assert.equal((deployment.match(/scheme: HTTPS/g) ?? []).length, 2);
  assert.match(deployment, /path: \/healthz/);
  assert.match(deployment, /mountPath: \/tmp/);
  assert.match(deployment, /mountPath: \/tls/);
  assert.match(deployment, /readOnly: true/);
  assert.match(deployment, /name: runtime-tls/);
  assert.match(deployment, /secretName: \{\{ \.Values\.tls\.existingSecret\.name \| quote \}\}/);
  assert.match(deployment, /key: \{\{ \.Values\.tls\.existingSecret\.certKey \| quote \}\}/);
  assert.match(deployment, /path: tls\.crt/);
  assert.match(deployment, /key: \{\{ \.Values\.tls\.existingSecret\.keyKey \| quote \}\}/);
  assert.match(deployment, /path: tls\.key/);
  assert.doesNotMatch(deployment, /if \.Values\.tls/);
  assert.match(deployment, /emptyDir:/);
  assert.match(deployment, /sizeLimit: 32Mi/);
  assert.match(deployment, /resources:/);
  assert.match(deployment, /automountServiceAccountToken: false/);
  assert.match(deployment, /imagePullSecrets:/);
  assert.match(deployment, /toYaml \.Values\.securityContext/);
  assert.match(deployment, /if \.Values\.image\.digest/);
  assert.match(deployment, /image: "\{\{ \.Values\.image\.repository \}\}@\{\{ \.Values\.image\.digest \}\}"/);
  assert.match(values, /readOnlyRootFilesystem: true/);
  assert.doesNotMatch(deployment, /value:\s*['"]?https?:\/\/[^\s]+supabase/);
  assert.doesNotMatch(deployment, /tls-proxy|sidecar/);
});

test("release is a thin public GitHub-hosted exact-tag Central caller", () => {
  assert.match(releaseWorkflow, /run-name: Publish tagged dashboard release \$\{\{ github\.ref_name \}\}/);
  assert.match(releaseWorkflow, /tags:\s*\n\s*- "\*\.\*\.\*"/);
  assert.match(releaseWorkflow, /group: agent-state-dashboard-release-\$\{\{ github\.ref_name \}\}/);
  assert.match(releaseWorkflow, /cancel-in-progress: false/);
  assert.match(
    releaseWorkflow,
    /uses: StreamScapeTV\/ci-workflows\/\.github\/workflows\/reusable-public-native-image-chart\.yml@main/,
  );
  assert.match(releaseWorkflow, /contents: read/);
  assert.match(releaseWorkflow, /packages: write/);
  assert.match(releaseWorkflow, /image_name: agent-state-dashboard/);
  assert.match(releaseWorkflow, /chart_name: agent-state-dashboard/);
  assert.match(releaseWorkflow, /chart_path: charts\/agent-state-dashboard/);
  assert.doesNotMatch(releaseWorkflow, /FORGEJO_REGISTRY_USERNAME|FORGEJO_REGISTRY_TOKEN/);
  assert.doesNotMatch(releaseWorkflow, /execution_backend|runs-on:|self-hosted|\[linux,\s*amd64/);
  assert.doesNotMatch(
    releaseWorkflow,
    /StreamScapeTV\/ci-workflows\/\.github\/workflows\/[^\s]+@[0-9a-f]{40}/,
  );
  assert.doesNotMatch(releaseWorkflow, /\blatest\b/);
});

test("local credential scratch files stay out of Git and image contexts", () => {
  for (const ignore of [gitIgnore, dockerIgnore]) {
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^\.dev\.vars$/m);
    assert.match(ignore, /^\.dev\.vars\.\*$/m);
    assert.match(ignore, /^\.npmrc$/m);
  }
});

test("package scripts no longer encode a Cloudflare Pages deployment path", () => {
  const scripts = packageJson.scripts ?? {};
  for (const name of Object.keys(scripts)) assert.doesNotMatch(name, /^pages:/);
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /wrangler\s+pages|pages functions/i);
});
