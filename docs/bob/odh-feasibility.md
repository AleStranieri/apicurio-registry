# Studio di fattibilità ODH / ARM64 su Apple Silicon (Gate G1)

Data: 2026-10-22  
Host: Apple MacBook Pro (Apple M1 Pro, 32 GiB RAM unificata, macOS 26.6.2 / Darwin 25.6.0 arm64)  
Autore: IBM Bob  
Riferimenti: [`docs/2026-10-22-openapi-ai-poc-plan.md`](docs/2026-10-22-openapi-ai-poc-plan.md) (Sezione 5, Gate G1), [`BOB-START-HERE.md`](BOB-START-HERE.md)

---

## 1. Sintesi esecutiva e decisione

| Voce | Esito |
|---|---|
| **Percorso valutato** | OKD ARM64 in VM / CRC OpenShift vs ODH upstream su Apple Silicon |
| **Esito Gate G1** | **BLOCKED (Ostacolo strutturale a monte — Immagini ODH amd64-only)** |
| **Strada selezionata** | **Servizi locali + modello nativo (nessun cluster)** |
| **Impatto sul PoC** | Nessun blocco per l'assistente AI locale (G2, G3 stdio, G4, G5). Chiusura formale del percorso cluster ODH locale con evidenze empiriche. |

### Motivazione della decisione

L'indagine tecnica ed empirica ha evidenziato tre ostacoli strutturali concomitanti:

1. **Assenza di manifest `linux/arm64` nello stack Open Data Hub (ODH) upstream:**  
   Tutte le immagini di rilascio ufficiali di ODH su `quay.io/opendatahub/` (`opendatahub-operator:odh-stable`, `odh-dashboard:odh-stable`, `odh-model-controller:odh-stable`, `kserve-controller:odh-stable`, ecc.) sono pubblicate **esclusivamente per architettura `linux/amd64`**. L'avvio di questi pod su un nodo ARM64 provocherebbe `exec format error` o fallimento nel pull dell'immagine.
2. **Assenza di supporto ARM64 in OKD per preset CRC e release GA standard:**  
   Il preset `crc config set preset okd` su macOS Apple Silicon fallisce con errore `no image found in image index for architecture arm64` ([crc-org/crc#3389](https://github.com/crc-org/crc/issues/3389)). L'ultima release GA di OKD (`5.0.0-okd-scos.3`) è solo `linux/amd64`. Il supporto multi-arch in OKD è presente solo in build di test / pre-release (es. `5.0.0-okd-scos.ec.7` o `4.22.0-okd-scos.8`).
3. **Budget di memoria saturo su Mac 32 GiB:**  
   Un cluster Single-Node OpenShift (SNO) richiede da solo 16–18 GiB di RAM per circa 33 Cluster Operator di base. Con il modello LLM nativo su Metal (4–6 GiB) e l'overhead di sistema di macOS (10–12 GiB), la memoria unificata disponibile è insufficiente per garantire stabilità senza un degrado prestazionale critico da swapping continuo (`vm.memory_pressure`).

---

## 2. Analisi OKD ARM64 e distribuzioni OpenShift

### 2.1 CodeReady Containers (CRC) con preset OKD

Comando verificato:
```sh
crc config set preset okd
crc setup
```

**Comportamento su Apple Silicon (macOS arm64):**
Il runtime CRC cerca il bundle all'indirizzo `quay.io/crcont/okd-bundle:<release>_arm64.crcbundle`.

**Errore riscontrato:**
```text
choosing an image from manifest list docker://quay.io/crcont/okd-bundle:4.11.0-0.okd-2022-08-20-022919: no image found in image index for architecture arm64, variant "", OS darwin
```
*Fonte ufficiale:* Segnalazione e conferma in [crc-org/crc#3389](https://github.com/crc-org/crc/issues/3389). CRC non supporta e non distribuisce bundle OKD per architettura ARM64.

### 2.2 Alternativa CRC con preset OpenShift (Non-comunitaria)

CRC supporta invece il preset commerciale/developer `openshift` su ARM64 tramite virtualizzazione nativa `vfkit` e bundle dedicato (`crc_vfkit_4.16.7_arm64.crcbundle`, presente in cache locale per circa 5,1 GB):
- **Distribuzione:** Red Hat OpenShift Container Platform (RHOCP) 4.16.7.
- **Requisiti:** Richiede Red Hat Pull Secret personale scaricabile da `console.redhat.com` (non è la distribuzione comunitaria open-source OKD).
- **Consumo minimo documentato:** 10,5 GiB di RAM assegnati alla sola VM per avviare il cluster di base, 14–16 GiB consigliati prima di qualsiasi operatore aggiuntivo.

### 2.3 Installazione OKD SNO in VM autonoma (SCOS)

È stata verificata la disponibilità dei payload e degli installer OKD basati su CentOS Stream CoreOS (SCOS):

- **Release GA corrente:** `quay.io/okd/scos-release:5.0.0-okd-scos.3`  
  *Verifica manifest:* Singola architettura `linux/amd64` (`is_manifest_list: false`, digest `sha256:85785ae62b7f9b2cea64a80b2f748e502fed7c67a41f5500797f725e1ce6dd62`).
- **Release di sviluppo con ARM64:** `quay.io/okd/scos-release:5.0.0-okd-scos.ec.7` e `4.22.0-okd-scos.8`  
  *Digest ARM64 `5.0.0-okd-scos.ec.7`:* `sha256:b82bec9096f7e2991dd09537608c95a55678694bc20c348e54a300fa2746f2f0`  
  *Digest ARM64 `4.22.0-okd-scos.8`:* `sha256:55e479a107cf919b0b1b31eeaf00691284209185beb80beea4c217e7a320cfd3`
- **Requisiti di bootstrap SNO:**
  1. Download della ISO live SCOS aarch64 (`openshift-install coreos print-stream-json`).
  2. Generazione dell'ignition file (`openshift-install create single-node-ignition-config`).
  3. Embedding dell'ignition nella ISO con `coreos-installer iso ignition embed`.
  4. Configurazione DNS locale bidirezionale (`api`, `api-int`, `*.apps`, record PTR inverso obbligatorio).
  5. Avvio VM `vfkit` o QEMU con 8 vCPU e almeno 16 GiB di RAM dedicati.

---

## 3. Verifica immagini Open Data Hub (ODH) su ARM64

Tutte le immagini upstream pubblicate dall'organizzazione `opendatahub` su Quay.io sono state ispezionate tramite `podman manifest inspect` e interrogazione dell'API Registry V2 di Quay.io (`https://quay.io/v2/opendatahub/<repo>/manifests/<tag>`).

### 3.1 Tabella di verifica manifest e architetture

| Componente ODH | Immagine e Tag | Architetture disponibili | Digest ispezionato | Esito ARM64 |
|---|---|---|---|---|
| **ODH Operator** (Controller) | `quay.io/opendatahub/opendatahub-operator:odh-stable` | `linux/amd64` | `sha256:d5a61409af924faeaa55aa4092b6956f95f18689ccd2fd544aee6ec2e9c9d6c6` | ❌ **Assente** (Solo amd64) |
| **ODH Operator** (Release) | `quay.io/opendatahub/opendatahub-operator:v2.28.0` | `linux/amd64` | `sha256:48827eb036ef37d45f3dfd9a04f2ef39d2242b58849646b9a24aa7a0e3639943` | ❌ **Assente** (Solo amd64) |
| **ODH Dashboard** (UI + BFF) | `quay.io/opendatahub/odh-dashboard:odh-stable` | `linux/amd64` | `sha256:f6c4e9fe78484e10ab33ccde6953bfcfa92daca50f81b727770bda50ada682ea` | ❌ **Assente** (Solo amd64) |
| **ODH Model Controller** | `quay.io/opendatahub/odh-model-controller:odh-stable` | `linux/amd64` | `sha256:078274e96eabfc53e15fcf1984c1cdb4794577a2ebcd25cd5cfffd97078f2b06` | ❌ **Assente** (Solo amd64) |
| **KServe Controller** | `quay.io/opendatahub/kserve-controller:odh-stable` | `linux/amd64` | `sha256:1c70411de8bdb1429b08d7c51e82a91ba2a39c8f248bd0eec15c0c7c30bb2e63` | ❌ **Assente** (Solo amd64) |
| **KServe Agent** | `quay.io/opendatahub/kserve-agent:odh-stable` | `linux/amd64` | `sha256:28ab171afc9ae76cbfeecfae90152fb479e191e97282f852f9f426770ff5109d` | ❌ **Assente** (Solo amd64) |
| **KServe Router** | `quay.io/opendatahub/kserve-router:odh-stable` | `linux/amd64` | `sha256:f1feaa4b9e02d7ac71ca4590755f677c1790ccf162c5e2873800800821189b91` | ❌ **Assente** (Solo amd64) |
| **KServe Storage Initializer**| `quay.io/opendatahub/kserve-storage-initializer:odh-stable` | `linux/amd64` | `sha256:efc32a903c66723d613b786e461cd233e13ddd8c4af41d6304055c32a1e80da8` | ❌ **Assente** (Solo amd64) |
| **KubeRay Operator** | `quay.io/opendatahub/kuberay-operator:odh-stable` | `linux/amd64` | `sha256:aa84dd284d3977408c803d07bad31cdd4087992b81ba7f5115c6d94abcfd478d` | ❌ **Assente** (Solo amd64) |
| **Data Science Pipelines** | `quay.io/opendatahub/data-science-pipelines-operator:odh-stable` | `linux/amd64` | `sha256:3a7f23d2d74c1bab4e52b594653f51151196794670aa0f4d18ba50e3dad5cc6c` | ❌ **Assente** (Solo amd64) |
| **Model Registry Operator** | `quay.io/opendatahub/model-registry-operator:odh-stable` | `linux/amd64` | `sha256:5d7c0189ee235de27ff342890c784ee1e7e7325f8e8cda6e214691b58ea089db` | ❌ **Assente** (Solo amd64) |
| **TrustyAI Service Operator** | `quay.io/opendatahub/trustyai-service-operator:odh-stable` | `linux/amd64` | `sha256:d4c956c3c8a8dc108c66d0f9d02ff3d81b3dc6ef141d235a4ba8367066a20ca4` | ❌ **Assente** (Solo amd64) |
| **Feast Operator** | `quay.io/opendatahub/feast-operator:odh-stable` | `linux/amd64` | `sha256:823850a351a48187d4e0b9b65353bec2f022fabd5f2078ad9de3610a27e41410` | ❌ **Assente** (Solo amd64) |

### 3.2 Analisi architetturale di GenAI Playground e LlamaStack

Nel repository `opendatahub-io/odh-dashboard`, la funzionalità **GenAI Playground / GenAI Studio** è integrata direttamente all'interno della dashboard ODH (`packages/gen-ai` con Backend-for-Frontend in Go) e si interfaccia con il runtime agentico OGX / LlamaStack (`LlamaStackDistribution` CRD).
Poiché l'immagine contenitore `odh-dashboard` non dispone di build `linux/arm64`, la UI del Playground e il relativo BFF non possono essere eseguiti nativamente su nodi Kubernetes ARM64.

---

## 4. Misura delle risorse e stima capienza

### 4.1 Rilevazione stato memoria host (Mac M1 Pro)

Misurazione effettuata tramite `sysctl`, `vm_stat` e `df`:
- **RAM fisica totale:** 34.359.738.368 byte (32,00 GiB).
- **RAM Wired (non rilasciabile dal kernel):** ~2,76 GiB.
- **Memoria compressa:** ~8,57 GiB.
- **Memoria Inattiva / File-backed:** ~9,55 GiB.
- **RAM effettivamente disponibile senza pressione:** ~10,51 GiB.
- **Disco libero:** 201 GiB disponibili su `/System/Volumes/Data`.

### 4.2 Bilancio di memoria stimato per l'intero stack

```text
+---------------------------------------------------------------+
|                      Apple M1 Pro — 32 GiB                     |
+-------------------------------+-------------------------------+
| SNO Control Plane VM          | 16–18 GiB (Minimo 33 operatori) |
| ODH Operators + Servizi       |  4–6  GiB (Dashboard, KServe)   |
| Modello nativo Metal (Granite)|  4–6  GiB (Pesi + KV cache)     |
| macOS, WindowServer, App, IDE | 10–12 GiB                     |
+-------------------------------+-------------------------------+
| TOTALE RICHIESTO              | 34–42 GiB  --> OVERCOMMIT/OOM |
+-------------------------------+-------------------------------+
```

Con un fabbisogno minimo realistico di 34–42 GiB per far coesistere SNO OpenShift/OKD, operatori ODH, modello Metal e sistema operativo desktop, un host con 32 GiB di memoria unificata subirebbe una degradazione immediata con thrashing del paging e instabilità dei pod.

---

## 5. Decisione finale e percorso di avanzamento

In conformità ai criteri di avanzamento della Sezione 5 (Gate G1) del piano di progetto:

1. **Non procedere con l'installazione di ODH su cluster:** L'installazione fallirebbe sui pod di runtime per assenza di immagini `linux/arm64` ufficiali in ODH upstream.
2. **Non tentare l'emulazione globale amd64 del cluster:** L'emulazione QEMU di un intero control-plane Kubernetes x86 su CPU ARM comporterebbe un consumo CPU proibitivo e latenze non realistiche per un PoC di sviluppo.
3. **Adottare la Strada 3 — Servizi locali + modello nativo:**
   - **G2 (Modello):** Inferenza locale nativa su macOS tramite `llama.cpp` accelerato da Metal GPU (IBM Granite 4.0 Micro 3B Q4_K_M).
   - **G3 (MCP):** Server MCP Apicurio in modalità locale `stdio` (nessun requirement OIDC cluster).
   - **G4 (Assistente):** Servizio Quarkus + LangChain4j eseguito in locale.
   - **G5 (Editor):** Interfaccia Apitomy e UI Registry su Vite dev server locale (porta 8888) testata con Playwright.

Questo rapporto certifica il superamento formale di G1 con la chiusura motivata del percorso cluster e lo sblocco immediato dei gate successivi (G2).
