# G5 side panel — 2026-10-26

Base: `16c87a627`, existing `poc/openapi-ai-assistant` checkout. Initial status contained
only `.bob/`, which was preserved. The deterministic layout validation added no dependency
and made no model call. Commit/push were authorized separately after the user review.

The user requested an Axiom-style side panel after trying the original form above the
editor. The assistant now uses the installed PatternFly 6.6.1 Drawer at the right, with a
420 px starting width, a keyboard/mouse resize splitter, a header close button, Escape
support and focus returned to its toggle. The toggle shares the editor selector row.
Below PatternFly's 768 px breakpoint the drawer overlays the editor at full width.
Instructions and results scroll inside the panel; the editor keeps its own scrolling.
The explanatory text is collected under “Before you apply”. No Axiom source was copied,
and its sessions/SSE/backend remain outside this integration.

The editor stays mounted across opening/closing. Closing unmounts the proposal controller,
which aborts the browser wait and invalidates late results, as before. Draft identity,
revision/hash checks, Source blocking, explicit Apply/Save and the documented undo/checkpoint
limits are unchanged. Viewport sizing is scoped to the OpenAPI editor route, including the
standalone layout without a PatternFly Page/masthead; no fixed header-height assumption.

## Checks

| Check | Result |
|---|---|
| Full standalone Vitest suite | 301 tests, 30 files passed |
| Console React 18 AI suite | 44 tests, 3 files passed |
| Standalone production build | Exit 0, TypeScript + Vite |
| Console production build | Exit 0, Webpack |
| Targeted ESLint, final TypeScript `tsc --noEmit` | Exit 0 |
| Extended deterministic Chromium replay | Exit 0, JSON and YAML |
| `git diff --check`, browser script syntax | Exit 0 |

New component tests assert the same editor DOM and pending field value survive opening
and closing, both close controls restore focus, Escape closes the panel, and a canceled
response cannot reappear after reopening. Deferred response delivery is flushed with React
`act`, without fixed sleeps. No Java `src/test` file changed, so the Java test-quality
skill's detector stage does not apply.

[Browser summary](g5-side-panel-browser.json). The existing controlled-response replay now
also checks desktop side-by-side alignment, unchanged editor top position, viewport height,
keyboard resizing, preserved mounted input, focus return, Escape and the narrow overlay.
It still verifies real Apitomy/Monaco Source → proposal → Apply → Restore → explicit Registry
Save/reload for JSON and YAML. It creates/deletes only temporary `g5-*` artifacts in
`ai-poc`, checks `inventory-api` unchanged, and never calls a model. Screenshots remain
ignored under `console-plugin/.runtime/openapi-ai-side-panel/`.

An additional read-only browser check on the existing inventory document measured, at
1600×1100: editor top 162 px before/after opening, editor width 1600→1180 px, editor and
panel height 938 px, panel width 420 px. At 390×844 the overlay was x=0, width=390 px,
height=564 px. The title input DOM node survived close/reopen, with zero page errors.
This check did not modify the document or submit a proposal.

During implementation, the first height constraint collapsed the standalone editor because
its outer wrapper was not a flex container. The browser caught this; the route-scoped wrapper
now establishes the viewport height. A narrow-screen assertion initially sampled a moving
panel; it now waits for its final bounds. Neither intermediate failure is counted as PASS.

Nonblocking warnings: the existing Vite script/large-chunk and Webpack dynamic-import
warnings remain. PatternFly's Drawer emits a React 19 warning for its published `inert=""`
attribute. No dependency upgrade or warning suppression was introduced. The actual console
host browser, hosted CI, C1/M1/M2 evaluation and ODH remain unverified by this change.
The existing Verify → Decide → Verification Gate already runs these shared tests and builds.


## User review: adding a schema property

The user supplied a real proposal produced for the explicit instruction to add optional
string `pippo` to `components.schemas.Item.properties` and leave ItemCreate and the rest
unchanged. The supplied semantic diff contains only `/components/schemas/Item`, adds
`pippo` with `type: string`, and leaves the `required` list unchanged. The supplied
candidate retains ItemCreate. This is evidence for that single proposed change, not a
completed C1/M1/M2 evaluation. No captured requestId/timing is attributed to this candidate.

After Apply, the user could not see the new property in Design. Published 0.2.0 source
`SchemaForm.tsx` confirms that its form renders only title, type and description, without
a properties list. Source for the selected Item is the way to inspect `properties.pippo`.
This limitation must not be reported as a model failure or a missing property based solely
on the Design screenshot. The user's explicit Registry save/reload for this proposal was
not independently observed.

The user then authorized committing and pushing this side-panel follow-up on the same
PoC branch. `.bob/`, ignored local configuration and runtime artifacts remain excluded.
No PR or additional implementation work was requested.
