# G5 validation — 2026-10-23, macOS arm64

Existing checkout: `poc/openapi-ai-assistant`, HEAD `d71e3e8285e6bf5fd785935385ca072e07da000d`,
origin `AleStranieri/apicurio-registry`. Initial status contained only untracked `.bob/`.
That directory and the existing G4/decision commits were preserved. Initial validation
performed no commit, push or PR. Commit and push were subsequently authorized by the user;
no PR was requested.
Node 22.14.0, npm 10.9.2; standalone React/DOM 19.3.0, console React/DOM 18.3.1,
PatternFly 6.6.1 in both. Registry stayed 3.3.1. No model or ODH deployment was used for G5.

## Implemented behavior

`OpenApiProposalClient` posts the exact current serialized draft and SHA-256 to G4
`POST /proposals`. It checks requestId, documentId, revision and hash on receipt and
checks the current draft again on Apply, including after asynchronous hashing. Input
advances revision immediately; returning to identical content does not reuse an older
revision. Model changes, editor switches, recovery, navigation and panel unmount invalidate
pending proposals. Duplicate sends are blocked. Sequence invalidation rejects late results
even when an aborted transport still delivers them. Timeout is 190 seconds; stopping the
browser wait does not assert that G4's inference stopped. Instructions survive errors.

The panel displays the complete candidate, G4's semantic change paths/before/after/schema
differences and diagnostics. Non-applicable or mismatched proposals cannot be applied.
HTTP/internal errors are not rendered verbatim. Same-origin configured proxy URLs only,
redirects refused, 64 KiB outgoing request bound, console CSRF forwarded through its
service proxy. There is no Registry write method in the client. Registry Save remains
in the existing EditorPage workflow.

Source is blocked for both requesting and applying while `.source-form` is mounted,
including during its 500 ms debounce. This DOM contract was checked in the published
0.2.0 source map and in Chromium. It is a version-specific adapter, not a public Source
state API. Raw visual input also blocks snapshots until the model emits a committed
change. Raw input changes a ref/revision without rerendering the editor, avoiding a
verified loss of uncommitted field text. Source Revert clears the pending-input latch;
a committed Source save updates the actual draft before the next request. Users must
return to Design. The library's own navigation away from Source can discard its private
buffer; G5 does not implement Source buffer recovery or replace that library behavior.

## Editor APIs and undo limitation

Reviewed installed published `@apitomy/openapi-editor@0.2.0` declarations and embedded
source map: `OpenAPIEditor.tsx`, `OpenAPIEditorContent.tsx`, `EditorContext.tsx`,
`useDocument.ts`, `useCommand.ts`, `DocumentService.ts`, `CommandService.ts`,
`SourceForm.tsx` and the property/selection components.

The root creates its own `EditorProvider`, accepts only the declared initial content,
change, selection and feature props, and provides no children slot. An outer provider
would create different services. Global Zustand stores in that release are not a public
command-injection API. No private import, guessed imperative method or invented prop is
used. `initialContent` reloads through `loadDocument(initialContent, true)`, resetting the
command stack. Apply explicitly starts a new mounted session with that public prop.

**Apply and Restore reset history.** G5 retains the exact serialized draft immediately
before the most recent AI application in memory. Restore replaces later edits with that
checkpoint. It does not preserve all prior undo entries, survive navigation/reload, or
undo a Registry save. This is stated in the panel. Chromium proves both reset behavior
and that ordinary edits acquire working undo/redo after Apply. JSON/YAML remain their
original formats; `application/x-yaml` maps to the contract's `application/yaml` only on
the wire. Object edits and generated candidates can reformat/remove comments.

## Input package decision

Evaluated the **published 6.9.0** tarball of `@patternfly/chatbot`, not only `main`:
[official tarball](https://registry.npmjs.org/@patternfly/chatbot/-/chatbot-6.9.0.tgz),
SHA-256 `263ae952c5193e85bad7690a8e8317a1c82cbbbcdb9ed36534f6ff9dc053bad8`.
Read its manifest, `src/MessageBar/MessageBar.tsx`, ESM JS/declarations and CSS. Controlled
value/onChange, send and stop callbacks exist. React/DOM peers are `^18 || ^19`, but PF
dependencies begin at `^6.7.0-prerelease.*`, excluding our 6.6.1. The Monaco peer is
`^0.56.0`, while the UI has 0.57.0. MessageBar imports attachments/menu/microphone and the
package declares analytics/markdown dependencies. Published global CSS is 119730 bytes;
the unpacked package is 14317761 bytes. These are **not** tree-shaken bundle measurements.

Rejected before installation/build because a second PF line and extra dependency surface
are disproportionate for one input. No compatibility PASS for Chatbot is claimed and no
forced override/global React/PF upgrade was performed. Adopted existing PF TextArea/Button;
actual React 18/19 render tests and production builds below are evidence for that choice.
No production dependency added; two console-only Testing Library dev dependencies added
with a lockfile. Existing dependency lock entries/versions were preserved. No Axiom code
copied: the session/SSE bridge would add complexity to `/proposals`. OpenViking remains deferred.

Final Vite build reports main JS 1976.80 kB (gzip 573.66 kB), Monaco runtime 4081.02 kB
(gzip 1053.88 kB), lazy Apitomy chunk 4413.16 kB (gzip 419.20 kB). These are whole emitted
chunks, not the incremental panel cost; no before/after bundle claim. Webpack also builds
its existing editor/worker vendor chunks. Chatbot/CSS is absent from both dependency graphs.

## Executed deterministic checks

| Check | Actual result |
|---|---|
| `npm test --prefix ui/ui-app` | Exit 0; **299 tests, 30 files** |
| `npm run build --prefix ui/ui-app` | Exit 0; TypeScript + Vite, 35.71 s |
| `npm run test:openapi-ai --prefix console-plugin` | Exit 0; **42 tests, 3 files**, React 18.3.1 asserted |
| `npm run build --prefix console-plugin` | Exit 0; Webpack, 31.97 s |
| ESLint on all changed shared TS/TSX source and test files | Exit 0, no findings |
| `node --check console-plugin/tests/verify-openapi-ai.cjs` | Exit 0 |
| Ruby/Psych parse of Verify, Decide and console workflow | Exit 0 |
| `git diff --check` | Exit 0 |

No changed Java files: Maven/Checkstyle were not rerun for this frontend change. G4's
28-test result remains the earlier evidence, not a new result from this run.

New/expanded cases include exact current draft/hash/identity, empty create, YAML MIME,
response mismatch for every correlation field, edit/navigate during inference,
return-to-same-content with newer revision, pending Source/visual buffer at request and
Apply, explicit Source revert, duplicate send, out-of-order/canceled responses, virtual-clock
timeout with abort-ignoring transport, HTTP failure/retry with instruction retention,
malformed diagnostics, oversized request, cross-origin URL rejection, proxy CSRF, controlled
diff/schema/diagnostic rendering, non-applicable candidates, Reject, Apply, checkpoint
restore and frontend React version. No model, sleeps or shared real service is used by
these unit/component tests. Async polling is bounded; timeout uses fake timers. DOMs,
global fetch stubs and cookies are cleaned up per test. Deferred responses coordinate races.

The repository test-quality skill's Phase 1 was checked: no changed `**/src/test/**/*.java`
files, so its Java P1–P30 detector/scoring stage does not apply. No automatic four-agent
quality score is claimed for the frontend tests. Their complete files and controller were
reviewed for bounded waits, lifecycle cleanup, deterministic races and specific assertions.

## Real-editor browser checks with controlled proposals

Executed from the existing checkout with installed Playwright and Chromium:

```sh
PLAYWRIGHT_MODULE=/Users/astranier/.npm/_npx/9833c18b2d85bc59/node_modules/playwright \
  node console-plugin/tests/verify-openapi-ai.cjs
```

Exit 0. [Machine-readable summary](g5-browser-standalone.json). Four intercepted proposal
requests, zero page errors. The script enables the UI setting only in its browser response
for config.js, preserving the existing local config file. It creates temporary `g5-json-*`
and `g5-yaml-*` DRAFT artifacts inside `ai-poc`, and deletes only those in `finally`.
The existing `ai-poc/inventory-api` content is checked unchanged. No request targets default
or bob-apitomy-baseline, no container was stopped/recreated/pruned, and no model is contacted.

Both formats prove:

- Unapplied Source cannot send a request; Source Save → Design sends the current text/hash.
- Receipt alone and Apply do not change Registry content; only explicit Registry Save does.
- Apply shows the candidate in the real editor and resets the earlier undo history.
- Subsequent visual edits, Undo and Redo work.
- Restore produces the exact pre-AI string in the next request.
- A second Apply followed by Registry Save and reload retains the accepted content/format.

Screenshots and raw local browser report remain ignored under
`console-plugin/.runtime/openapi-ai/`. This browser test exercises the real Apitomy/Monaco
and Registry lifecycle, but uses a deterministic proposal route, not a real G4 inference.

Intermediate failures were retained in the work log rather than called PASS: assertions
initially selected PF label spans instead of buttons; the first console test attempt loaded
the React 19 renderer and was corrected with console-local Testing Library; Chromium found
an illegal receiver when fetch was stored as a method, fixed by a forwarding function; a
wrapper rerender on raw input erased visual field text, fixed by ref-only invalidation.
Final tests/browser runs passed after those corrections. Browser launching, loopback access
and npm downloads required sandbox escalation. Vite retains config-script and large-chunk
warnings; Webpack retains its Kiota dynamic-import warning. Warnings are not passing checks.

## CI and remaining verification

Existing Decide `console-plugin` paths already cover shared UI/plugin code; G4 service
paths now also trigger those frontend contract tests. The existing console workflow runs
the full standalone suite/build and now the separate React 18 AI suite before its Webpack
build. Verify Result already depends on this workflow and feeds Verification Gate. No
standalone workflow or merge-bypass check was introduced. Hosted CI **not run during local validation**; subsequent publication was authorized
separately. Existing owner/branch restrictions remain; no hosted CI PASS is claimed.

**Local implementation/tests/builds and standalone browser: passed as listed.** Full G5
gate remains open for browser verification in a real console host. Read-only `podman ps -a`
found the existing Registry/legacy UI 3.3.1 containers, but no console host container;
none was created to manufacture a host result. React 18 component tests + plugin packaging
are separate evidence, not a claim of OpenShift host integration. The replay script accepts
`POC_AI_EDITOR_BASE_URL` for that future run. Production proxy/auth deployment remains out
of this local PoC. C1/M1/M2 model evaluation and ODH feasibility/deployment remain open.
The earlier G4 create/modify smoke runs still do not constitute a model-quality assessment.


## User-triggered real-model proposal and authorized publication

After the deterministic validation, the user requested local setup. The ignored standalone
`ui/ui-app/config.js` was enabled with `ui.openApiAssistantUrl`, and G4 was started on
loopback 8082 with JDK 21. A read-only browser setup check confirmed the button/panel,
`granite4:latest` availability in Ollama and a 400 response for an intentionally empty
request through the Vite proxy; that check did not call inference or change the draft.
The local config remains ignored and is not included in the commit.

The user then pressed Propose on the inventory draft. G4's structured logs record request
`86ef8147-fd83-4dec-80d5-ae0776e5ecba` completing at local time 16:44:16.825 on 23 October:
**status applicable, one attempt, 60645 ms, four tool calls** (three model calls and one
service final validation). The sequence was `get_version_content`, `test_schema_rules`,
`get_version_content`, then the service's mandatory `test_schema_rules`.
[Saved run metadata](g5-manual-proposal.json).

This confirms a real user-triggered request reached G4 and completed its applicability
checks. The exact instruction, full candidate and diff were not captured for this request;
instruction following, user Apply, Registry Save and reload are therefore **not verified**
by these logs. No new inference was launched to substitute for the user's run. This single
smoke does not close C1/M1/M2, ODH or the console-host browser gate.

The user subsequently authorized committing and pushing the G5 work and this evidence
to the existing fork branch. `.bob/`, ignored local config, raw runtime logs, screenshots,
cache and build output are excluded. The prior local decision commit is preserved and
will be published with the branch. Publication does not itself establish a hosted CI PASS.
