# OpenAPI AI assistant: G4

Standalone Quarkus service using LangChain4j's OpenAI-compatible client and MCP stdio client.
It proposes documents for a browser draft. Saving remains a separate editor action.
Scope: OpenAPI **3.0.3**, JSON or YAML, local `$ref` only. No model or Registry is needed for tests.

## Build and test

From the repository root with JDK 21 (see `DEVELOPING.md`):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 # macOS Homebrew; choose your JDK on other hosts
./mvnw -Pexamples -pl examples/openapi-ai-assistant/service -am test-compile -DskipTests -T1
./mvnw -Pexamples -pl examples/openapi-ai-assistant/service -am verify -T1
./mvnw -Pexamples checkstyle:check -pl examples/openapi-ai-assistant/service -T1
```

`verify` runs the mock tests and packages `service/target/quarkus-app/quarkus-run.jar`.
The example is registered in `examples/pom.xml`; `-am` selects only the root and service.
No core/storage modules are changed.

## Run and replay

Use the existing G3 MCP JAR, Registry 3.3.1 and Ollama model; do not upgrade Registry.
Run from the repository root so the default MCP JAR path resolves:

```sh
"$JAVA_HOME/bin/java" \
  -Dapicurio.assistant.java-command="$JAVA_HOME/bin/java" \
  -jar examples/openapi-ai-assistant/service/target/quarkus-app/quarkus-run.jar
```

The service listens on `127.0.0.1:8082`. Each proposal needing MCP starts and closes its own child
with OIDC tenant disabled, logging disabled and an ephemeral loopback HTTP port. This avoids
colliding with Registry's port even though the existing MCP JAR has HTTP compiled in.
Only `get_version_content` and `test_schema_rules` reach that child. No tools are discovered or
executed automatically, and the allowlist is checked again at execution.

With the G3 `ai-poc/inventory-api` fixture already present:

```sh
python3 examples/openapi-ai-assistant/scripts/g4-smoke.py --out /tmp/g4-modify.json
python3 examples/openapi-ai-assistant/scripts/g4-smoke.py --mode create \
  --instruction 'Create a minimal OpenAPI 3.0.3 inventory API with GET /items. Return the complete JSON document.' \
  --out /tmp/g4-create.json
```

The replay saves the complete synthetic request/response, checks versions before and after,
and exits nonzero for `not_applicable` or changed versions. It never sets up or writes Registry data.
The default modify replay also checks the exact requested title; custom instructions can set
`--expected-title`. Applicability alone does not prove that a model followed the instruction.
Stop the assistant with Ctrl-C. No containers are stopped or pruned.

## Contract

`POST /proposals`, `Content-Type: application/json`:

```json
{
  "requestId": "2b739835-9c16-47ef-a492-faa328e11126",
  "mode": "create",
  "instruction": "Create an inventory API with GET /items",
  "draft": {
    "documentId": "browser-draft",
    "revision": 7,
    "contentType": "application/json",
    "content": "",
    "baseHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

All draft fields are required, including for create. Empty content is allowed only for create.
Modify additionally requires nonempty content and `registryContext` with `groupId`, `artifactId`,
`version`. Context identifiers accept simple alphanumeric identifiers, `_` and `-` (version also
allows dots); traversal is rejected. `baseHash` is the lowercase SHA-256 of the exact UTF-8 content.
The service recomputes it and rejects mismatches. Invalid requests return 400; oversized bodies return 413.

Successful processing returns HTTP 200 with `requestId`, `status` (`applicable` or `not_applicable`),
`documentId`, `revision`, verified `baseHash`, complete `candidate`, `diff`, `diagnostics`, and `run`.
The candidate preserves the requested JSON/YAML format; formatting/comments may change.
The editor must compare identity, revision and hash again before applying a response.

`run` includes `model`, `toolCallCount`, `attemptCount`, `elapsedMs`, `modelToolCallCount` and
`validationToolCallCount`. Attempts count candidate generation rounds (at most two); tool
continuations and nudges do not consume a correction attempt. The total tool budget includes
the service's mandatory final rule test when Registry context is provided. The working document
always comes from `draft.content`; Registry content is optional extra model context.
When only one call remains, the next LLM turn offers no tools and explicitly requests the
complete document, reserving that call for validation. A model that emits a larger tool batch
can still exhaust the budget; it cannot bypass the execution limit.

Apitomy parses and validates every candidate in code. Spec-mandated validation problems have
`medium` severity in its default registry and block applicability. Local references are checked
without external fetches. The first invalid candidate supplies structured diagnostics for one
correction. Rule checks also fail closed, regardless of the model's claims. The verified MCP
success string is `Schema is valid and compatible.`; other responses block the proposal.
`test_schema_rules` internally uses Registry's dry-run version endpoint; it does not save a version.

`diff` compares parsed Apitomy AST fields, ignoring JSON whitespace and object key order.
Each entry has `kind`, JSON Pointer `path`, `before`, `after`, and `schemaDifferences`.
For changed Schema Objects, the latter contains actual Apitomy `Difference` results, with
`DiffType`, `pathOriginal`, `pathUpdated`, from `JsonSchemaCompatibilityChecker.checkBackward`.
Other OpenAPI fields (paths, operations, metadata) remain structural AST changes; arrays are
compared as whole values. OpenAPI 3.0 Schema Objects are projected to draft-4 for keyword
comparison. This is not a complete OpenAPI request/response compatibility proof; configured
Registry rules provide the independent compatibility gate. No line-based diff is used.

Diagnostics have `code`, `path`, `message`, `recoverable`. Timeout returns `LLM_TIMEOUT` and
`recoverable: true`; other operational codes include `ASSISTANT_UNAVAILABLE`, `TOOL_NOT_ALLOWED`,
`TOOL_LIMIT`, `ITERATION_LIMIT`, `PROMPT_LIMIT`, `CANDIDATE_LIMIT`, `TOOL_RESULT_LIMIT`, `REGISTRY_RULES`.
Runtime exceptions are sanitized. Logs contain IDs, timing, tool names/counts and status, without
prompts, content, tokens or exception details. MCP/library content logging is disabled.

## Configuration

Pass JVM `-D` properties before `-jar`; destinations are configured on the server.

| Property | Default |
|---|---|
| `apicurio.assistant.model` | `granite4:latest` |
| `apicurio.assistant.model-url` | `http://127.0.0.1:11434/v1` |
| `apicurio.assistant.api-key` | `ollama` (local placeholder) |
| `apicurio.assistant.model-timeout` | `120s` per LLM call; no automatic retries |
| `apicurio.assistant.timeout.ms` | `180000` for the proposal CDI runner |
| `apicurio.assistant.max-tool-calls` | `4` total across both attempts |
| `apicurio.assistant.max-iterations` | `8` per candidate, including nudges |
| `apicurio.assistant.body.max-size` | `64K` HTTP request body |
| `apicurio.assistant.max-prompt-bytes` | `65536` accumulated conversation UTF-8 bytes |
| `apicurio.assistant.max-result-bytes` | `32768` per tool result/candidate |
| `apicurio.assistant.max-output-tokens` | `4096` |
| `apicurio.assistant.mcp-timeout` | `30s` initialize/tool execution |
| `apicurio.assistant.java-command` | `java` |
| `apicurio.assistant.mcp-jar` | `mcp/target/quarkus-app/quarkus-run.jar` |
| `apicurio.assistant.registry-url` | `http://localhost:8080` |

Prompt bytes are a resource bound, not a tokenizer-specific token estimate. Over-limit prompts
are rejected without silently truncating the browser draft. Full tokenizer budgeting and broad
model-quality evaluation remain later work. This unauthenticated local PoC binds to loopback;
ODH/authenticated HTTP MCP deployment is outside G4.

## CI and evidence

`Verify → Decide` has an `openapi-assistant` path filter and output. The `OpenAPI Assistant`
job runs mock tests, Checkstyle and packaging; `Verify Result` depends on it, feeding the
existing `Verification Gate`. No isolated workflow is added. Existing owner/branch/lifecycle
restrictions still apply: the upstream pipeline currently gates only the `Apicurio` owner and
`main`/`3.3.x`; this local fork branch has no hosted CI result from this work.

See `reports/g4-validation.md` for commands, results, limitations and test-quality review.

G5 planning: [main plan](../../docs/2026-10-22-openapi-ai-poc-plan.md) and
[Axiom/PatternFly reuse decisions](../../docs/2026-10-23-openapi-ai-g5-reuse-decisions.md).
Prefer the official PatternFly input if its selected release passes both frontend builds;
Axiom reuse is optional and OpenViking remains deferred.

## G5 editor panel

The shared OpenAPI editor now has an optional proposal panel. It uses existing PatternFly
6.6.1 `TextArea`/`Button`; no Chatbot, Axiom or OpenViking runtime dependency is added.
Set `ApicurioRegistryConfig.ui.openApiAssistantUrl = "/openapi-assistant/proposals"` in the
standalone UI's local `config.js` to enable the **Open AI assistant** button. Omit the setting
to disable it. Vite proxies that prefix to loopback port 8082. Start G4 as described above.
Only same-origin proposal URLs are accepted; redirects are refused.

The console embedding accepts `assistantUrl` and configures it for the existing localhost
Registry PoC only, through
`/api/proxy/plugin/apicurio-registry/registry-api/openapi-assistant/proposals`.
The existing console service proxy forwards to Webpack's `/registry-api/openapi-assistant`
route, which targets G4 on 8082. Console writes include the CSRF cookie header. This reuses
the local service proxy documented in `console-plugin/APITOMY-POC.md`; it does not add a
cluster service or an authenticated production deployment. Other Registry instances have
no assistant configured. Pass no `assistantUrl` to disable the embedded panel.

Source is blocked for both Propose and Apply, even when clean. Save or revert it with its
own toolbar, then return to Design. Uncommitted visual input also blocks requests. The
Source guard uses `.source-form` from the pinned editor 0.2.0 because that release provides
no public buffer-state callback; test this guard again before upgrading the editor. Inputs
advance the revision immediately without rerendering the editor. Committed model changes,
editor switches, navigation, recovery and panel unmount invalidate pending work.

Review the candidate, semantic diff and diagnostics, then choose **Apply to draft** or
**Reject**. Apply and **Restore pre-AI draft** reload through the public `initialContent`
prop and reset editor history. Restore replaces subsequent edits with the exact draft
captured immediately before the most recent AI application; it is an in-memory checkpoint,
not a complete undo history and not retained after navigation/reload. Ordinary editing
starts a fresh undo/redo history after Apply. Registry Save remains separate. JSON stays
JSON; Registry's `application/x-yaml` is mapped to G4's `application/yaml` on the wire,
while saved content stays YAML. Object editing/generation can reformat and remove comments.

Stop waiting and the 190-second browser timeout abort fetch and invalidate late results.
They do not establish that G4 inference stopped. Errors preserve the instruction. The
editor and its save/fallback flows remain available when the assistant is closed or offline.
This is a local OpenAPI **3.0.3** PoC, not a complete model-quality or ODH evaluation.

Deterministic frontend checks, separately:

```sh
npm test --prefix ui/ui-app
npm run build --prefix ui/ui-app
npm run test:openapi-ai --prefix console-plugin # actual React 18 renderer + PF 6.6.1
npm run build --prefix console-plugin
```

Install UI and console dependencies from their lockfiles first (console uses
`npm ci --legacy-peer-deps`). The console test command uses the UI's Vitest installation
and the console's React/React DOM/Testing Library; a version assertion prevents silently
running the suite with React 19.

Browser verification with installed Playwright/Chromium and the standalone UI on 8888:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node console-plugin/tests/verify-openapi-ai.cjs
```

The script intercepts proposals with controlled responses, uses the real editor and
Registry save/reload, and creates/deletes only temporary `g5-*` artifacts in `ai-poc`.
It reads and checks `ai-poc/inventory-api` unchanged. No model is contacted. Set
`POC_AI_EDITOR_BASE_URL` to a running console's full route ending in `/explore/ai-poc/`
to run against the host plugin; that host-browser run has not been performed here.
Local screenshots/report go to ignored `console-plugin/.runtime/openapi-ai`.
See [G5 evidence and limitations](reports/g5-validation.md).
