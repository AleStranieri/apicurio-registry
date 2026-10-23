# G4 validation — 2026-10-23, macOS arm64

Base: `fca679457`, fork `AleStranieri/apicurio-registry`, branch `poc/openapi-ai-assistant`.
The existing checkout already contained G2/G3; it was preserved, including untracked `.bob/`.
`AGENTS.md`, `DEVELOPING.md`, plan section 8 and applicable rules were read before coding.
No push, PR, container changes, Registry upgrade or default-group modification.

## Deterministic checks

Commands run from the repository root with `JAVA_HOME=/opt/homebrew/opt/openjdk@21`:

| Command | Result |
|---|---|
| `./mvnw -Pexamples -pl examples/openapi-ai-assistant/service -am test-compile -DskipTests --no-transfer-progress -T1` | Exit 0 |
| `./mvnw -Pexamples -pl examples/openapi-ai-assistant/service -am verify --no-transfer-progress -T1` | Exit 0; final suite 28 tests, 0 failures/errors/skips; fast JAR built |
| `./mvnw -Pexamples checkstyle:check -pl examples/openapi-ai-assistant/service -T1 --no-transfer-progress` | Exit 0; 0 violations |
| Ruby/Psych parse of both modified workflows | Exit 0 |
| Static inspection of Decide output → job condition → Verify Result needs | Exit 0 |
| `git diff --check` | Exit 0 |

Test classes: `ProposalResourceTest` (15), `ProposalTimeoutTest` (1), `AllowedToolsTest` (4),
`DocumentChecksTest` (8). LLM and MCP are mocks; the actual Apitomy parser/validator and diff
checker run in tests. HTTP/CDI tests use `@QuarkusTest`; the separate timeout profile proves
the real interceptor interrupts a blocked mock and returns `LLM_TIMEOUT`, recoverable=true.

Coverage includes exact response/diff/hash/revision values, empty create, missing draft,
blank instruction, bad hash, traversal, body 413, malformed/oversized tool data, hard tool
and iteration limits, final-validation budget reservation, object-to-string Granite arguments,
repair success, two invalid candidates, blocked write tools, Registry rule rejection,
JSON/YAML syntax, missing required `info.version`, broken local and forbidden remote `$ref`.
No model weights or running Registry are required by these tests.

One intermediate `verify` failed because adding a project `junit-platform.properties` hid
Quarkus's class orderer. It was corrected by explicitly preserving
`io.quarkus.test.config.QuarkusClassOrderer`; the final full suite passed. Nonblocking runtime
warnings remain for Mockito dynamic agent attachment, duplicate JUnit properties resources,
and a deprecated Jackson traversal API. No warning is counted as a passing test.
Sandbox attempts also failed on Maven cache writes, Java bind and Python loopback access;
the same operations were rerun with approved permissions.

## Real-model replay

Ollama reported `granite4:latest`, 3.4B, Q4_K_M,
digest `4235724a127c0f86dcc0247d67c20148705d6dd2319164014d92f71d607f4773`.
Registry remained 3.3.1; MCP is the previously built 3.4.0-SNAPSHOT JAR.

The first replay is preserved in `g4-modify-tool-limit.json` (synthetic fixture only).
It returned **not_applicable / TOOL_LIMIT**, elapsed 60,759 ms, one candidate attempt,
four model tool calls, zero service validation calls. Granite alternated
`get_version_content` and `test_schema_rules`, then requested another tool rather than
returning the document. Version lists before and after were identical: one DRAFT version,
version `1`, globalId `8`, contentId `14`. The limit failed closed.

After that evidence, the loop was changed to stop advertising tools when only the final
validation slot remains, and explicitly nudge a complete document. A new deterministic test
proves three model calls plus one mandatory validation, with no tools offered in the final turn.
The model, tool limit and time limits were unchanged. Subsequent replay results are recorded below.

- `g4-modify-reserved.json`: validator status `applicable`, 57,877 ms, one attempt,
  three model calls and one service validation. **Instruction-following FAIL**: the model returned
  the original `Inventory API` title and an empty diff. This is not a successful modification,
  despite structural validity. The replay script was strengthened to assert the exact default
  requested title and fail on this case.
- `g4-create.json`: **PASS for the single smoke case**, `applicable`, 4,537 ms, one attempt,
  zero MCP calls. The candidate is OpenAPI 3.0.3 and has `GET /items`; one root-added diff.
  Before/after Registry version lists match. This is one replay, not a model-quality benchmark.

The final nudge additionally repeats the user's instruction before asking for the document,
addressing the observed no-op response. All 28 deterministic tests passed again after that change.

- `g4-modify-explicit.json`: **PASS for the single smoke case**, `applicable`, 59,682 ms,
  one attempt, three model tool calls and one service validation. The title is exactly
  `Inventory Assistant G4`; the AST diff has only `/info/title`, and all other parsed fields
  are unchanged. The replay's exact-title assertion passed; before/after version lists match.

Final local G4 evidence: deterministic contract/limits/validation checks passed, plus one
successful create and one successful modify replay. The two earlier negative modify runs
remain in the report. This is not evidence for the later five-run-per-case quality matrix.
The assistant process started for replay was stopped after testing; Registry/Ollama were left running.

## Test quality

Applied `.claude/skills/apicurio-test-quality/SKILL.md` against all five complete changed Java
test files and production context, using the P1–P30 catalog and four independent detector
reviews. The final added budget test was reviewed again in all four categories.

| Category | Weight | Score | Findings |
|---|---:|---:|---:|
| Concurrency Safety | 3 | 10/10 | 0 |
| Timing & CI Waste | 3 | 10/10 | 0 |
| Infrastructure, Lifecycle & Hygiene | 2 | 10/10 | 0 |
| Correctness & Race Quality | 2 | 10/10 | 0 |

Weighted score **10.0/10**, threshold 7.0 met. No mutable static DTOs, shared real
infrastructure, reflection injection, sleep-based polling, unbounded waits or assertion-free tests.

## Verified dependency APIs

Reviewed published source JARs from Maven Central, not just guessed signatures:

| Artifact | Source SHA-256 |
|---|---|
| `io.apitomy:apitomy-data-models:4.0.0-beta.1` | `5492d326b80c1866dfd75d91ecb2901dac6213a72f7d8a36796a478050de8b13` |
| `dev.langchain4j:langchain4j-core:1.0.1` | `61d9a394cde67e12da382bceb867e319a884599fdd70b703161093132df87903` |
| `dev.langchain4j:langchain4j-open-ai:1.0.1` | `6352a632cbf1565efe7ce1a2d60435321259ead675d90159f263c523d0678970` |
| `dev.langchain4j:langchain4j-mcp:1.0.1-beta6` | `b501dcdab2e860cd492dae086ec1fd8088597c630e51e457950b777dd0339ba3` |

Apitomy source confirms `Library.readDocumentFromJSONString`, `Library.validate`,
`DefaultSeverityRegistry` (spec-mandated = medium), and
`JsonSchemaCompatibilityChecker.checkBackward(...).getDifferences()` returning real
`Difference`/`DiffType`. The latter is JSON Schema-specific, so it is used for Schema Objects;
other OpenAPI changes use structural AST comparison. Draft-4 projection is not claimed to
be a full OpenAPI compatibility checker. Registry rules are tested independently.

LangChain4j source confirms `ChatModel.chat(ChatRequest)`, tool request/result messages,
OpenAI-compatible `baseUrl`, timeout, maxRetries(0), no payload logging, and MCP stdio
initialization/tool timeouts. Tool schemas and the exact dry-run success string were checked
against `mcp/src/main/java/.../servers` and `RegistryService.testSchemaRules`.

## CI and remaining scope

Path filter `examples/openapi-ai-assistant/**` feeds a Decide output, the existing Verify
workflow's `OpenAPI Assistant` job, and `Verify Result` needs. Existing Verification Gate
aggregation therefore includes its failures. Hosted CI was **not run**: no push was made,
and existing owner/branch restrictions exclude this fork feature branch. YAML parsing and
local `verify` are evidence for configuration/build, not a hosted GitHub Actions PASS.

G5 UI, full model-quality matrix, authenticated MCP HTTP and ODH deployment are outside this task.
The local service has no persistence tools. It returns a proposal for explicit editor application.
