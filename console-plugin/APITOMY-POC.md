# Apitomy OpenAPI editor PoC

Branch: `poc/console-plugin-apitomy-editor`. The pre-existing PatternFly 6.6.1,
workspace wrapper, and iframe height changes are preserved. This PoC is packaged
for the personal fork; see [BOB-START-HERE.md](../BOB-START-HERE.md) for the handoff.
`fix/console-plugin-patternfly6` is unchanged. No upstream PR or cluster deployment
is part of this handoff.

## Try it

Open <http://localhost:9000/apicurio/ns/default/simple/explore/default/08257cf4-fa65-4257-badf-066832b88a66/versions/1/editor>.

The default is **Apitomy (preview)**. **Previous editor** opens the original Angular
editor. Switching carries the current document in both directions. The switch
starts a new editor session; undo history is maintained while editing and saving
within Apitomy, but does not span an implementation switch.

In Source mode, use the **Save inside Source** to apply changes to the visual
model, then the **Registry Save above the editor** to persist the draft. Unapplied
Source text is the library's local buffer; apply it before switching editors or
leaving the page. Visual fields commit on Enter or blur. YAML stays YAML and JSON
stays JSON; an actual edit can reformat content and remove YAML comments, as in
the previous object-based editor protocol. Undo to the original document restores
the original draft text exactly.

## Implementation

- `@apitomy/openapi-editor` is pinned to **0.2.0**, data-models to **3.1.0**, and
  Zustand to **5.0.11** in `ui/ui-app/package.json` and its lockfile. React Flow
  retains its separate Zustand 4 dependency.
- The shared `OpenApiEditor` adapter preserves stable `initialContent` across
  parent renders and successful saves. Recovery/external content changes replace
  the model. Clean load events do not mark the draft dirty. Existing EditorPage
  save, reference, comparison, conflict, and recovery flows remain in charge.
- The editor and bundled Monaco are loaded lazily. Apitomy 0.2.0 embeds a separate
  Monaco loader, so the adapter supplies Registry's initialized runtime through
  `window.monaco` before mounting. The Webpack worker loader translates Vite
  `?worker` imports into real local worker bundles.
- The package does not export a CSS subpath. Vite and Webpack resolve a dedicated
  style alias to the pinned package file. Native CSS `@scope` confines that
  stylesheet to the editor, including its broad PatternFly selectors. This PoC
  targets modern Chromium with CSS scope support.
- The plugin uses React/React DOM **18.3.1**, matching the running OKD singleton.
  SDK 4.20 still advertises React 17, so its shared-module version validation is
  disabled for this PoC. A production integration must align the SDK and host
  versions and restore that validation.
- Development writes to `console-plugin/dist-dev`; production writes to `dist`.
  Production builds can run while the development server is active without
  deleting its chunks. Dev mode no longer minifies every incremental build.

## Local API proxy

The asset endpoint `/api/plugins/apicurio-registry/` accepts GET only. Registry API
requests now use the official console service proxy:
`/api/proxy/plugin/apicurio-registry/registry-api/apis/registry/v3`.

The running console was restarted with the same image, Kubernetes endpoint,
token, auth mode, and host network, plus:

```sh
BRIDGE_PLUGIN_PROXY='{"services":[{"consoleAPIPath":"/api/proxy/plugin/apicurio-registry/registry-api/","endpoint":"http://localhost:9001/registry-api/","authorize":false}]}'
```

Webpack's `/registry-api` proxy forwards to `localhost:8080`. The embedded client
middleware adds the console CSRF cookie as `X-CSRFToken` only for this same-origin
proxy. It opts these requests out of gzip compression because the local Registry
3.3.1 does not decode gzip request bodies (400). Host middleware runs before
Kiota's terminal fetch handler, and is removed when the embedded app unmounts.

The original console container is retained, stopped, as
`apicurio-openshift-console-before-apitomy`. Cluster, CR, RBAC, API container, and
Angular editor container were not recreated. Do not run the old external
`restore-native-poc.sh` unchanged: it still selects the previous branch and lacks
this service proxy configuration.

## Validation and evidence

Run frontend checks from `ui/ui-app`:

```sh
npm test
npm run build
```

Run the production plugin build from `console-plugin`:

```sh
npm run build
```

Repeat the local browser test using an installed Playwright and Chromium. In the
handoff environment, from the repository root:

```sh
PLAYWRIGHT_MODULE=/home/alestranieri/.npm/_npx/9833c18b2d85bc59/node_modules/playwright \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/alestranieri/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
node console-plugin/tests/verify-apitomy-poc.cjs
```

The test creates uniquely named temporary JSON/YAML drafts and deletes only those
artifacts in `finally`. It verifies clean loads, edit/undo/redo, save/reload,
fallback round-trips with unsaved changes, recovery, Source edits and saves,
SPA document changes with a fresh undo history, local workers, no CDN requests, and editor viewport bounds. The original Pet Store
fixture is read and compared unchanged. API/console URLs, fixture ID, and evidence
directory can be set through `POC_REGISTRY_API`, `POC_CONSOLE_URL`,
`POC_FIXTURE_ID`, and `POC_EVIDENCE_DIR`. `POC_EDITOR_BASE_URL` can override the
full editor route prefix (ending in `/`) for the standalone UI on a fresh machine.

Local screenshots, browser report, and check logs are under the ignored
`console-plugin/.runtime/apitomy-poc/` directory. Frontend tests: **269 passing**.
TypeScript and targeted lint pass. Both production builds pass. The plugin retains
one existing Kiota dynamic-import warning; Vite retains its existing config script
and large chunk warnings. Kind lacks several OpenShift APIs and user-settings
services; those background console requests still return 404/500/502. The local
console also returns 404 for the plugin translation namespace, with English labels
available through fallback. No editor
page errors or failed Registry requests occurred in the successful browser run.

No Java build is needed for these frontend-only changes. This is a local PoC;
production packaging, host compatibility, and CI integration remain separate work.
