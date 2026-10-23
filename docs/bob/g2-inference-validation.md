# Report di validazione G2 — Inferenza LLM locale con Apple Metal

Data: 2026-10-23  
Host: Apple MacBook Pro (Apple M1 Pro, 32 GiB RAM unificata, macOS 26.6.2 / Darwin 25.6.0 arm64)  
Branch: `poc/openapi-ai-assistant`  
Commit HEAD: `9bff0a397faf534f1469fb81196ba14ad9fb377d`  
Autore: IBM Bob  
Riferimenti: [`docs/2026-10-22-openapi-ai-poc-plan.md`](../2026-10-22-openapi-ai-poc-plan.md) (Sezione 6, Gate G2)

---

## 1. Sintesi esecutiva

| Voce | Esito |
|---|---|
| **Gate G2** | **PASS** |
| **Runtime LLM** | Ollama 0.40.9 con backend Metal (Apple M1 Pro) |
| **Modello** | IBM Granite 4.0 MoE (`granite4:latest`) — 3.4B parametri, Q4_K_M, context 131k |
| **Accelerazione Metal** | Confermata: 41/41 layer su GPU, 0 layer CPU |
| **Tool/Function calling** | Supportato e verificato: 5/5 PASS |
| **Generazione OpenAPI 3.0.3** | 5/5 PASS con prompt esplicito (v2); 0/5 con prompt compatto (v1) |
| **Latenza media** | 8.31 s (C1), 1.07 s (tool call) — sotto il limite di 120 s |
| **Throughput** | 46.7 tok/s medio (C1), 42.1 tok/s (tool call) |
| **Footprint RAM reale** | 3.48 GiB (confermato da Ollama `/api/ps`) — **dentro il budget di 6 GiB** |
| **Stabilità** | Nessun OOM, pressione memoria normale, macchina utilizzabile |

---

## 2. Ambiente e runtime

### 2.1 Host rilevato

```
uname -m:       arm64
macOS:          26.6.2 (Build 25G83)
Darwin:         25.6.0
hw.memsize:     34.359.738.368 byte (32,00 GiB RAM unificata)
hw.ncpu:        10
hw.physicalcpu: 10
Disco libero:   202 GiB (/System/Volumes/Data)
```

### 2.2 Runtime LLM installato

| Componente | Versione |
|---|---|
| **Ollama** | 0.40.9 |
| **Backend** | llama.cpp integrato in Ollama (libreria Metal) |
| **Endpoint** | `http://127.0.0.1:11434/v1` (OpenAI-compatible) |
| **Flash Attention** | Abilitato (`OLLAMA_FLASH_ATTENTION=1`) |
| **KV Cache type** | q8_0 (`OLLAMA_KV_CACHE_TYPE=q8_0`) |

**Installazione:**

```sh
brew install ollama
OLLAMA_FLASH_ATTENTION="1" OLLAMA_KV_CACHE_TYPE="q8_0" \
  OLLAMA_HOST="127.0.0.1:11434" \
  /opt/homebrew/opt/ollama/bin/ollama serve > /tmp/ollama-server.log 2>&1 &
```

### 2.3 Rilevazione GPU Metal

Dal log del server all'avvio:

```
inference compute  id=0  library=Metal  name=MTL0  description="Apple M1 Pro"
                   type=iGPU  total="25.0 GiB"  available="25.0 GiB"
vram-based default context  total_vram="25.0 GiB"  default_num_ctx=32768
GPU family: MTLGPUFamilyApple7 (1007)
GPU family: MTLGPUFamilyMetal4 (5002)
```

---

## 3. Modello selezionato

### 3.1 IBM Granite 4.0 MoE — `granite4:latest`

| Attributo | Valore |
|---|---|
| **Nome Ollama** | `granite4:latest` |
| **ID immagine Ollama** | `4235724a127c` |
| **Dimensione download** | 2.1 GB |
| **Parametri** | 3.4B |
| **Architettura** | Granite (Mixture of Experts) |
| **Quantizzazione** | Q4_K_M |
| **Context length** | 131.072 token |
| **Capabilities** | `completion`, `tools` (function calling) |
| **Licenza** | Apache 2.0 |
| **BPW (bit per weight)** | 4.93 BPW (riportato da llama.cpp) |

```
$ ollama show granite4:latest
Model
    architecture        granite
    parameters          3.4B
    context length      131072
    embedding length    2560
    quantization        Q4_K_M
    template source     go_template

Capabilities
    completion
    tools

License
    Apache License, Version 2.0
```

### 3.2 Lay-out dei pesi e offloading Metal

```
load_tensors:   CPU_Mapped model buffer size =   200.98 MiB
load_tensors:  MTL0_Mapped model buffer size =  1998.84 MiB
offloading output layer to GPU
offloading 39 repeating layers to GPU
offloaded 41/41 layers to GPU
llama_kv_cache: size = 1360.00 MiB (32768 cells, 40 layers)
                K (q8_0): 680.00 MiB, V (q8_0): 680.00 MiB
sched_reserve: MTL0 compute buffer size = 200.68 MiB
sched_reserve: CPU  compute buffer size = 104.07 MiB
```

Tutti i 41 layer (39 ripetuti + output) sono eseguiti su GPU Metal. Nessun layer su CPU.

---

## 4. Misure di risorse

### 4.1 Footprint RAM durante l'inferenza

| Voce | Valore |
|---|---|
| **Model weights (Metal GPU)** | 1998.84 MiB |
| **KV cache (Metal GPU, q8_0)** | 1360.00 MiB |
| **Compute buffer (Metal GPU)** | 200.68 MiB |
| **Model weights (CPU-mapped)** | 200.98 MiB |
| **RSS totale processo llama-server** | 3490 MiB (3.41 GiB) |
| **VRAM riportata da Ollama `/api/ps`** | 3.48 GiB |
| **Budget target** | < 6 GiB |
| **Esito budget** | ✅ **DENTRO il budget** (3.48 GiB / 6 GiB = 58%) |

### 4.2 Memoria host prima/dopo caricamento del modello

| Misura | Prima del caricamento | Dopo il caricamento | Delta |
|---|---|---|---|
| Free (MiB) | 1901 | 61 | -1840 |
| Wired (MiB) | 2755 | 6110 | **+3355** |
| Inactive (MiB) | 8183 | 8281 | +98 |
| Compressor stored (MiB) | 20717 | 21015 | +298 |

Il delta Wired (+3.3 GiB) corrisponde all'allocazione Metal per il modello. Non si osserva
incremento di Compressor stored significativo durante l'inferenza (solo +298 MiB, entro il
normale movimento del sistema).

### 4.3 Memoria disponibile durante i 15 test

| Momento | Available (MiB) | Compressed stored (MiB) |
|---|---|---|
| Baseline (prima dei run) | 8568 | 20777 |
| Dopo C1 run 10 + tool call run 5 | 8322 | 20761 |
| Variazione | -246 | -16 |

Nessuna pressione di memoria significativa. La macchina è rimasta pienamente utilizzabile.

---

## 5. Risultati C1 — Generazione OpenAPI 3.0.3

**Fixture:** Pet Store API, OpenAPI 3.0.3, 3 path, 1 schema.  
**Prompt temperature:** 0.1 | **max_tokens:** 2048 | **Timeout:** 120 s

### 5.1 Confronto tra varianti di prompt

Il test C1 è stato eseguito in **10 run totali**: 5 con il prompt compatto v1 (baseline)
e 5 con il prompt strutturato v2 (lista di requisiti espliciti).

| Variante | Descrizione | Pass | Fail | Pass rate |
|---|---|---|---|---|
| **v1 (compatto)** | Requisiti in prosa inline, singola frase | 0/5 | 5/5 | **0%** |
| **v2 (esplicito)** | Requisiti come elenco puntato strutturato | 5/5 | 0/5 | **100%** |

**Errore v1 (sistematico su tutti i run):** `POST /pets: missing response 400`  
Il modello produceva JSON valido e ben formato, ma ometteva sistematicamente il codice
di risposta 400 per la creazione (errore di input), includendo solo il 201.

**Analisi:** Il comportamento è riproducibile e deterministico con temperature=0.1.
Il modello interpreta il requisito "400 for invalid input" come opzionale o già
implicito. Con la formulazione esplicita v2 (`POST /pets: ... AND 400 (invalid input)`)
il 400 è sempre incluso.

**Implicazione per G4 (servizio assistente):** usare sempre prompt con requisiti
elencati esplicitamente per le operazioni POST/PUT che richiedono codici di errore.

### 5.2 Qualità dell'output (v2, 5 run)

Tutti e 5 i documenti generati con v2 sono:
- JSON parsabile (parse_ok = true)
- Conformi alla struttura OpenAPI 3.0.3 (`"openapi": "3.0.3"`)
- Corretti per titolo (`"Pet Store API"`) e versione (`"1.0.0"`)
- Con tutti i path richiesti (`/pets`, `/pets/{id}`)
- Con parametro `id` corretto (in=path, required=true)
- Schema `Pet` con `id`, `name`, `status` required, enum `[available, sold]`
- Tutti i codici risposta: 200, 201, 400, 404

Nessun markdown spurio, nessuna prosa aggiuntiva: output JSON puro.

### 5.3 Latenza e throughput C1 (10 run complessivi)

| Metrica | Valore |
|---|---|
| Latenza minima | 6.918 s |
| Latenza massima | 9.478 s |
| **Latenza media** | **8.31 s** |
| Throughput medio | **46.7 tok/s** |
| Limit PoC (piano) | 120 s per chiamata |
| Esito latenza | ✅ PASS (8.31 s «« 120 s) |

---

## 6. Risultati Tool/Function Calling

**Run:** 5  
**Strumenti esposti:** `get_schema_rules` (read), `validate_openapi_schema` (validate)  
**Prompt:** richiesta multi-step (recuperare regole, poi validare documento)

| Run | Tool chiamato | Argomenti validi (JSON) | Pass |
|---|---|---|---|
| 1 | `get_schema_rules` | ✅ `{group_id: "poc-g2", artifact_id: "inventory-api"}` | ✅ |
| 2 | `get_schema_rules` | ✅ | ✅ |
| 3 | `get_schema_rules` | ✅ | ✅ |
| 4 | `get_schema_rules` | ✅ | ✅ |
| 5 | `get_schema_rules` | ✅ | ✅ |

**Pass rate: 5/5 (100%)**

Osservazioni:
- `finish_reason: tool_calls` confermato in tutti i run: il modello non descrive la chiamata nel testo, esegue l'evento `tool_calls` nello struttura JSON della risposta.
- Il modello chiama prima `get_schema_rules` (corretto: bisogna recuperare le regole prima di validare).
- Gli argomenti sono sempre JSON valido con i campi `group_id` e `artifact_id` corretti.
- La latenza tool call è molto bassa (0.9–1.7 s): il modello emette pochi token per la chiamata.

### 6.1 Latenza tool calling (5 run)

| Metrica | Valore |
|---|---|
| Latenza minima | 0.900 s |
| Latenza massima | 1.724 s |
| **Latenza media** | **1.07 s** |
| Throughput medio | 42.1 tok/s |

---

## 7. Verifica endpoint OpenAI-compatible

```sh
# /v1/models
curl -s http://localhost:11434/v1/models
# → {"data":[{"id":"granite4:latest","object":"model",...}],"object":"list"}

# Smoke test
curl -s -X POST http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"granite4:latest","messages":[{"role":"user","content":"Reply with exactly: OK"}],"temperature":0,"max_tokens":10}'
# → {"choices":[{"finish_reason":"stop","message":{"content":"OK",...}}],...}
```

L'API esposta da Ollama è pienamente compatibile OpenAI (`/v1/chat/completions`).

---

## 8. Artefatti prodotti da questa validazione

| File | Descrizione |
|---|---|
| `examples/openapi-ai-assistant/fixtures/inventory-api-openapi303.json` | Fixture OpenAPI 3.0.3 per i test successivi (G3, G4) |
| `examples/openapi-ai-assistant/scripts/g2-validate-model.py` | Script di validazione riproducibile (Python 3, stdlib only) |
| `/tmp/g2-results.json` | Risultati JSON completi dei 15 run (non committato, contiene metriche raw) |

---

## 9. Gate G2 — Valutazione criteri di avanzamento

| Criterio (piano §6) | Esito |
|---|---|
| Modello e tool calling funzionanti | ✅ PASS (5/5 tool calls, 5/5 OAS generation v2) |
| Nessun OOM | ✅ PASS (no swap-in, no OOM, macchina utilizzabile) |
| Budget RAM < 6 GiB | ✅ PASS (3.48 GiB reale, 58% del budget) |
| Tempi misurati e documentati | ✅ PASS (8.31 s media C1, 1.07 s media tool call) |
| Metal confermato nei log | ✅ PASS (41/41 layer su GPU, MTLGPUFamilyApple7) |
| Generazione OAS 3.0.3 valida | ✅ PASS (5/5 con prompt esplicito v2) |
| Latenza < 120 s per chiamata | ✅ PASS (max osservato: 9.5 s) |

**Gate G2: PASS** ✅

---

## 10. Osservazioni e raccomandazioni per G3/G4

1. **Sensibilità al prompt (Finding F1):** IBM Granite 4.0 MoE è fortemente sensibile alla forma del prompt. I requisiti delle operazioni POST/PUT devono essere elencati esplicitamente come bullet con "AND" per ogni codice di risposta richiesto. Prompt compatti in prosa lineare producono omissioni sistematiche di codici 4xx.

2. **Context window sufficiente:** Con 131k token di contesto, il modello può contenere agevolmente lo schema OpenAPI (2–3k token), le definizioni dei tool (1–2k), la descrizione del task e la risposta. Nessun problema di budget per le fixture del PoC.

3. **Tool calling affidabile:** La meccanica di function calling di Granite 4.0 MoE è robusta: `finish_reason: tool_calls`, argomenti in JSON valido, scelta sequenziale degli strumenti coerente con la catena richiesta.

4. **Footprint Metal:** il modello consuma ~3.5 GiB di unified memory GPU durante l'inferenza, lasciando ~21.5 GiB di "device memory" libera (su 25 GiB totali accessibili da Metal). Margine abbondante per i servizi locali del PoC (Registry, UI, MCP stdio).

5. **CPU-mapped fallback:** 200 MiB dei pesi restano mappati su CPU. Non è un costo prestazionale apprezzabile: a riposo si trova in pagine inattive.

6. **Temperatura 0.1 sufficiente:** risultati deterministici per le fixture del PoC senza seed esplicito. Il piano indica che il seed deve essere verificato prima di essere dichiarato supportato: in Ollama 0.40.9 il parametro `seed` è accettato nell'API ma la riproducibilità completa non è garantita.

---

## 11. Comandi di riproduzione

```sh
# 1. Avvia Ollama con Metal
OLLAMA_FLASH_ATTENTION="1" OLLAMA_KV_CACHE_TYPE="q8_0" \
  OLLAMA_HOST="127.0.0.1:11434" \
  /opt/homebrew/opt/ollama/bin/ollama serve &

# 2. Scarica il modello (2.1 GB, una sola volta)
ollama pull granite4:latest

# 3. Verifica endpoint e Metal
curl -s http://localhost:11434/v1/models
# Verifica log: grep "offloaded.*layers.*GPU" /tmp/ollama-server.log

# 4. Esegui la validazione G2
python3 examples/openapi-ai-assistant/scripts/g2-validate-model.py \
  --base-url http://localhost:11434/v1 \
  --model granite4:latest \
  --runs 10 \
  --out /tmp/g2-results.json
```

**Nota:** il processo Ollama usa la porta 11434. Se la porta è già occupata cambiare
`OLLAMA_HOST` ed aggiornare `--base-url`. Il processo server non deve girare come servizio
systemd/launchd per evitare conflitti con l'istanza temporanea del PoC.
