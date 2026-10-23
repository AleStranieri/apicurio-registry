# Report G3 — MCP Apicurio e prima prova funzionale

Data: 2026-10-23  
Host: Apple MacBook Pro (Apple M1 Pro, 32 GiB RAM unificata, macOS 26.6.2 / Darwin 25.6.0 arm64)  
Branch: `poc/openapi-ai-assistant`  
Autore: IBM Bob  
Riferimenti: [`docs/2026-10-22-openapi-ai-poc-plan.md`](../2026-10-22-openapi-ai-poc-plan.md) (Sezione 7, Gate G3)

---

## 1. Sintesi esecutiva

| Voce | Esito |
|---|---|
| **Gate G3 locale** | **PASS** |
| **Build MCP** | 3.4.0-SNAPSHOT compilato da sorgenti con JDK 21 |
| **Compatibilità MCP ↔ Registry** | Verificata su chiamate stdio dirette; nessuna operazione incompatibile nel perimetro G3 |
| **Fixture ai-poc/inventory-api** | Creata (groupId=ai-poc, artifactId=inventory-api, version=1, stato=DRAFT) |
| **Test diretti MCP** | 7/7 PASS (initialize, tools/list, get_version_content, test_schema_rules valid+invalid) |
| **Prova end-to-end con Granite 4.0 MoE** | PASS: ≥1 tool call di lettura + ≥1 validazione; versioni invariate |
| **Versioni create nel Registry** | 0 (invariato: 1 → 1) |
| **Artefatto Pet Store** | Invariato (gruppi: default, ai-poc separati) |

---

## 2. Ambiente

### 2.1 Host e stack

| Componente | Versione/Dettaglio |
|---|---|
| macOS | 26.6.2 (Darwin 25.6.0 arm64) |
| JDK | OpenJDK 21.0.13.0.2 (Homebrew, arm64) |
| Maven Wrapper | `./mvnw` — Apache Maven 3.9.8 |
| Registry (container) | `docker.io/apicurio/apicurio-registry:3.3.1` — arm64 |
| MCP (sorgente) | 3.4.0-SNAPSHOT (questo checkout) |
| Ollama | 0.40.9 con backend Metal |
| Modello LLM | `granite4:latest` (IBM Granite 4.0 MoE, Q4_K_M, 3.4B) |

### 2.2 Stack compose attivo

Il Registry 3.3.1 è stato avviato tramite `console-plugin/poc/compose.yaml`:

```
NAME                                IMAGE                                           STATUS
apicurio-bob-baseline-registry-1    docker.io/apicurio/apicurio-registry:3.3.1      Up
apicurio-bob-baseline-legacy-ui-1   docker.io/apicurio/apicurio-registry-ui:3.3.1   Up
```

`curl http://localhost:8080/apis/registry/v3/system/info`:
```json
{"name":"Apicurio Registry (SQL)","version":"3.3.1","builtOn":"2026-07-29T06:51:01Z"}
```

---

## 3. Build MCP 3.4.0-SNAPSHOT

### 3.1 Comando

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  ./mvnw install -Pfull -pl mcp -am -DskipTests
```

**Prerequisito:** il sistema aveva solo un JRE IBM Semeru 25 (senza javac). Installato JDK 21 via `brew install openjdk@21`.

### 3.2 Risultato

```
mcp/target/quarkus-app/quarkus-run.jar  (fast-jar, 681 B launcher)
mcp/target/quarkus-app/lib/             (dipendenze)
```

Build OK, nessun errore di compilazione.

---

## 4. Analisi compatibilità MCP 3.4.0-SNAPSHOT ↔ Registry 3.3.1

### 4.1 Problema rilevato: OIDC obbligatorio all'avvio

Il JAR compilato ha `quarkus.mcp.server.http.enabled=true` fisso a compile-time. Questo costringe il transpiler HTTP a inizializzare OIDC anche in modalità stdio pura. Senza un `quarkus.oidc.auth-server-url` il processo terminava con:

```
'quarkus.oidc.auth-server-url' property must be configured
```

**Soluzione adottata:** passare `-Dquarkus.oidc.tenant-enabled=false` all'avvio del JAR in stdio mode. Non richiede ricompilazione; documentato in [`mcp/README.md`](../../mcp/README.md) (proprietà di configurazione runtime).

### 4.2 Operazioni MCP vs Registry 3.3.1: nessuna incompatibilità nel perimetro G3

| Operazione MCP | Endpoint Registry v3 | Esito |
|---|---|---|
| `get_version_content` | `GET /groups/{g}/artifacts/{a}/versions/{v}/content` | ✅ compatibile |
| `test_schema_rules` | `PUT /groups/{g}/artifacts/{a}/test` | ✅ compatibile |
| `tools/list` | (locale al server MCP) | ✅ compatibile |

Il modulo MCP usa il Java SDK 3.4.0-SNAPSHOT che parla con Registry 3.3.1 via HTTP REST. Le API `/groups`, `/artifacts`, `/versions`, `/test` sono invariate fra 3.3.1 e 3.4.0-SNAPSHOT nel perimetro testato.

**Nota:** l'operazione `ard_search` e quelle A2A/MCP-agents potrebbero richiedere endpoint non disponibili in 3.3.1 (`/.well-known/ard/search`). Non testato in G3; non necessario.

---

## 5. Fixture inventory-api nel gruppo ai-poc

### 5.1 Caricamento

```sh
# Gruppo ai-poc creato
curl -X POST http://localhost:8080/apis/registry/v3/groups \
  -H 'Content-Type: application/json' \
  -d '{"groupId":"ai-poc","description":"AI PoC test group - G3 fixtures"}'

# Artefatto con firstVersion creato in un solo POST
curl -X POST http://localhost:8080/apis/registry/v3/groups/ai-poc/artifacts \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/inventory-api-create.json
```

### 5.2 Stato finale

```
groupId:    ai-poc
artifactId: inventory-api
version:    1
state:      DRAFT
```

Regola VALIDITY (FULL) aggiunta per il test negativo:
```sh
curl -X POST http://localhost:8080/apis/registry/v3/groups/ai-poc/artifacts/inventory-api/rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"VALIDITY","config":"FULL"}'
```

### 5.3 Isolamento

Il gruppo `default` è rimasto invariato: `bob-apitomy-baseline` e `apitomy-poc-json-1792669227939` intoccati.

---

## 6. Test MCP diretti (senza modello)

Script: [`examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py`](../../examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py)

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  python3 examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py \
    --jar mcp/target/quarkus-app/quarkus-run.jar \
    --registry-url http://localhost:8080 \
    --group ai-poc \
    --artifact inventory-api \
    --out /tmp/g3-mcp-direct-results.json
```

### 6.1 Risultati

| Test | Esito | Dettaglio |
|---|---|---|
| T1 — initialize | ✅ PASS | `protocolVersion=2024-11-05 server=apicurio-registry-mcp-server` |
| T2 — tools/list | ✅ PASS | 32 tool esposti |
| T2 — required tools present | ✅ PASS | `get_version_content` + `test_schema_rules` presenti |
| T3 — get_version_content | ✅ PASS | Contenuto JSON ricevuto con `"openapi":"3.0.3"` e `"title":"Inventory API"` |
| T4 — test_schema_rules (candidato valido) | ✅ PASS | `"Schema is valid and compatible."` |
| T5 — test_schema_rules (candidato invalido) | ✅ PASS | `"The OpenAPI artifact is not semantically valid. 1 problems found. Schema Reference must refer to a valid Schema Definition."` |

**7/7 PASS**

### 6.2 Tool disponibili (32 totali)

```
ard_search, create_artifact, create_group, create_version, discover_agents, get_agent_card,
get_artifact_metadata, get_artifact_types, get_configuration_property, get_group_metadata,
get_mcp_prompt, get_mcp_tool, get_server_info, get_version_content, get_version_metadata,
list_artifacts, list_configuration_properties, list_groups, list_mcp_prompts, list_versions,
render_prompt_template, search_artifacts, search_groups, search_mcp_tools, search_versions,
test_schema_rules, update_artifact_metadata, update_configuration_property, update_group_metadata,
update_version_content, update_version_metadata, update_version_state
```

**Allowlist G3 (esposta al modello):** `get_version_content`, `test_schema_rules`

---

## 7. Prova end-to-end con Granite 4.0 MoE

Script: [`examples/openapi-ai-assistant/scripts/g3-e2e-test.py`](../../examples/openapi-ai-assistant/scripts/g3-e2e-test.py)

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  python3 examples/openapi-ai-assistant/scripts/g3-e2e-test.py \
    --jar mcp/target/quarkus-app/quarkus-run.jar \
    --registry-url http://localhost:8080 \
    --llm-url http://127.0.0.1:11434/v1 \
    --model granite4:latest \
    --group ai-poc \
    --artifact inventory-api \
    --out /tmp/g3-e2e-results.json
```

### 7.1 Traccia delle chiamate

| Iterazione | Tipo | Dettaglio | Elapsed |
|---|---|---|---|
| 1 | `tool_calls` | `get_version_content(groupId=ai-poc, artifactId=inventory-api, versionExpression=1)` | 1.2 s |
| 2 | `stop` | Modello fermo senza aver chiamato test_schema_rules (nudge applicato) | 27.9 s |
| 3 | `stop` | Nudge ricevuto, ancora no tool call (nudge applicato) | 22.1 s |
| 4 | `stop` | Nudge ricevuto, ancora no tool call (nudge applicato) | 22.2 s |
| 5 | `tool_calls` | `test_schema_rules(...)` con auto-serialize di versionContent da dict → string | 15.2 s |
| 6 | `stop` | Risposta finale | 7.5 s |

**Totale: 96.1 s — entro il limite di 180 s del piano**

### 7.2 Risposta del modello

```
Validation result: FAIL: Schema rules check failed: The OpenAPI artifact is not semantically valid.
7 problems found.
Causes:
- Schema Reference must refer to a valid Schema Definition at /paths[/items]/post/responses[201]/...
- An unexpected property "404" was found. Extension properties should begin with "x-". at /paths[/items/{id}]/get
- Schema Reference must refer to a valid Schema Definition at /paths[/items/{id}]/get/responses[200]/...
- An unexpected property "400" was found. Extension properties should begin with "x-". at /paths[/items]/post
- An unexpected property "ItemCreate" was found. Extension properties should begin with "x-". at /components
- Schema Reference must refer to a valid Schema Definition at /paths[/items]/get/responses[200]/...
- Schema Reference must refer to a valid Schema Definition at /paths[/items]/post/requestBody/...
```

### 7.3 Analisi dell'output del modello

Il modello ha:
1. ✅ Letto correttamente il contenuto dell'artefatto via `get_version_content`
2. ✅ Prodotto una proposta di modifica OpenAPI 3.0.3
3. ✅ Chiamato `test_schema_rules` con la proposta
4. ✅ Riportato il risultato della validazione ("Validation result: FAIL")
5. ❌ La proposta stessa era **strutturalmente incompleta**: ometteva `components/schemas` con `Item` e `ItemCreate`, generando 7 errori di riferimento rotto

**Causa:** il modello ha costruito lo schema incrementalmente e, nell'iterazione 5, ha passato una versione parziale senza `components/schemas`.

**Cosa funziona correttamente nella catena:** il Registry ha rilevato e segnalato tutti i problemi in modo deterministico. La proposta invalida non è stata scritta nel Registry. Il sistema non ha fatto nulla di automatico.

---

## 8. Finding F2 — Granite 4.0 MoE: versionContent come oggetto JSON

Comportamento osservato (riproducibile): quando il modello chiama `test_schema_rules`, passa `versionContent` come **oggetto JSON** (dict Python) anziché come **stringa JSON** serializzata. Il MCP server risponde con `"Invalid argument [versionContent] - unable to convert value"`.

**Workaround implementato nel client G3:** auto-serialize nel loop agentico:
```python
if tool_name == "test_schema_rules" and isinstance(args.get("versionContent"), dict):
    args["versionContent"] = json.dumps(args["versionContent"])
```

**Implicazione per G4:** il servizio Quarkus/LangChain4j deve applicare la stessa serializzazione prima di passare il candidato a MCP, oppure usare il validatore indipendente direttamente via REST (che accetta `application/json`).

---

## 9. Gate G3 — Valutazione criteri

| Criterio (piano §7) | Esito |
|---|---|
| ≥1 tool call effettiva di lettura | ✅ PASS — `get_version_content` eseguita (1 chiamata) |
| ≥1 validazione effettiva | ✅ PASS — `test_schema_rules` eseguita (1 chiamata effettiva, dopo auto-serialize) |
| Numero versioni nel Registry invariato | ✅ PASS — 1 → 1 |
| Artefatto Pet Store intoccato | ✅ PASS — gruppi `default` e `ai-poc` separati |
| Proposta riporta contenuto e esito del controllo | ✅ PASS — risposta finale con JSON proposta + "Validation result: FAIL: ..." |
| Nessuna scrittura automatica | ✅ PASS — nessun `create_version` in nessuna chiamata |

**Gate G3 locale: PASS ✅**

Gate G3 ODH: **NOT RUN** (dipende da G1 ODH, ancora aperto)

---

## 10. Artefatti prodotti da questa fase

| File | Descrizione |
|---|---|
| `examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py` | Script di test MCP stdio diretto (7 test, no LLM) |
| `examples/openapi-ai-assistant/scripts/g3-e2e-test.py` | Script di test end-to-end (LLM + MCP + Registry) |
| `/tmp/g3-mcp-direct-results.json` | Risultati test diretti (non committato) |
| `/tmp/g3-e2e-results.json` | Traccia completa e2e (non committato) |

---

## 11. Raccomandazioni per G4

1. **Finding F2 (versionContent serialization):** nel servizio Quarkus/LangChain4j serializzare sempre il candidato JSON a stringa prima di passarlo a `test_schema_rules`. Alternativa: usare l'endpoint REST `PUT /groups/{g}/artifacts/{a}/test` direttamente, che accetta `application/json`.

2. **Finding F1 confermato (sensibilità al prompt):** il modello richiede istruzioni step-by-step esplicite con "STEP N" e nudge espliciti se si ferma. In G4, il loop agentico deve gestire la stessa situazione. La struttura attuale dei nudge funziona ma richiede 3–4 iterazioni extra.

3. **Proposta incompleta — schema components:** il modello tende a omettere `components/schemas` quando la proposta è lunga. Soluzione pratica per G4: nel prompt v2 (vedi G2), richiedere esplicitamente di includere **tutti** i componenti dello schema originale, non modificati, nella proposta.

4. **Allowlist in codice:** confermato che l'allowlist `{get_version_content, test_schema_rules}` funziona a livello di client. In G4 applicarla nel servizio Quarkus, non solo nel prompt.

5. **OIDC + stdio mode:** documentare in `mcp/README.md` che in modalità stdio occorre `-Dquarkus.oidc.tenant-enabled=false` quando il JAR è compilato con HTTP transport. Oppure aggiungere un profilo `stdio` nella build.

---

## 12. Comandi di riproduzione

```sh
# 1. Avvia lo stack (se non già in esecuzione)
podman compose -f console-plugin/poc/compose.yaml up -d
curl --fail http://localhost:8080/apis/registry/v3/system/info

# 2. Avvia Ollama con Metal
OLLAMA_FLASH_ATTENTION="1" OLLAMA_KV_CACHE_TYPE="q8_0" \
  OLLAMA_HOST="127.0.0.1:11434" \
  /opt/homebrew/opt/ollama/bin/ollama serve &

# 3. Build MCP (JDK 21 richiesto)
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  ./mvnw install -Pfull -pl mcp -am -DskipTests

# 4. Carica fixture (se non già presente)
python3 -c "
import json, urllib.request
with open('examples/openapi-ai-assistant/fixtures/inventory-api-openapi303.json') as f:
    content = f.read()
payload = {'artifactId':'inventory-api','artifactType':'OPENAPI','name':'Inventory API',
    'firstVersion':{'version':'1','isDraft':True,'content':{'contentType':'application/json','content':content}}}
req = urllib.request.Request('http://localhost:8080/apis/registry/v3/groups/ai-poc/artifacts',
    data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'}, method='POST')
print(urllib.request.urlopen(req).read().decode()[:200])
"

# 5. Abilita VALIDITY rule
curl -X POST http://localhost:8080/apis/registry/v3/groups/ai-poc/artifacts/inventory-api/rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"VALIDITY","config":"FULL"}'

# 6. Test diretto MCP
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  python3 examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py \
    --jar mcp/target/quarkus-app/quarkus-run.jar \
    --registry-url http://localhost:8080 \
    --group ai-poc --artifact inventory-api \
    --out /tmp/g3-mcp-direct-results.json

# 7. Test end-to-end con Granite 4.0 MoE
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  python3 examples/openapi-ai-assistant/scripts/g3-e2e-test.py \
    --jar mcp/target/quarkus-app/quarkus-run.jar \
    --registry-url http://localhost:8080 \
    --llm-url http://127.0.0.1:11434/v1 \
    --model granite4:latest \
    --group ai-poc --artifact inventory-api \
    --out /tmp/g3-e2e-results.json
```
