# Handoff a IBM Bob — Apitomy e PoC AI

Repository: <https://github.com/AleStranieri/apicurio-registry>

Branch di lavoro: `poc/openapi-ai-assistant`.
Baseline editor: `poc/console-plugin-apitomy-editor`.

## Cosa contiene questa consegna

Il codice include il PoC Apitomy integrato nella UI Registry e nel console plugin,
con test, proxy e worker Monaco locali. L'assistente AI e il deployment ODH **sono
ancora da implementare**. Il lavoro richiesto inizialmente a Bob è verificare la
base sul Mac M1 Pro/32 GB e risolvere la fattibilità ODH/ARM; poi eseguire le prove
reali del modello e del codice AI che verrà sviluppato su questo branch.

- [Piano completo e criteri di avanzamento](docs/2026-10-22-openapi-ai-poc-plan.md)
- [Dettagli e limiti dell'editor](console-plugin/APITOMY-POC.md)
- [Risultati della preparazione Linux](docs/bob/baseline-validation.md)
- [Versioni della base e checksum dei lockfile](docs/bob/versions.lock.yaml)
- [Modello del rapporto da restituire](docs/bob/REPORT-TEMPLATE.md)

## Prompt da incollare in Bob

> Lavora nel fork AleStranieri/apicurio-registry, branch
> poc/openapi-ai-assistant. Leggi AGENTS.md, BOB-START-HERE.md e il piano collegato.
> Il tuo host è un Mac M1 Pro con 32 GB, ma devi rilevare le risorse effettivamente
> disponibili. Esegui prima G0 e la verifica G1 ODH/ARM, riportando fonti, release,
> immagini, comandi ed errori reali. CRC con preset OKD non supporta Apple Silicon:
> verifica OKD ARM in VM; considera CRC/OpenShift solo come alternativa esplicita
> alla distribuzione comunitaria. Non considerare Kind + console come OKD.
> Riproduci il PoC Apitomy usando il percorso standalone qui sotto e fai build del
> console plugin. Separa test standalone, test console, test modello e test ODH.
> Procedi con G2 (modello nativo Metal) sulle attività indipendenti; G3/G4/G5
> richiedono il relativo codice quando disponibile. Non dichiarare implementato
> l'assistente AI perché il piano esiste. Non pubblicare PR upstream. Restituisci
> il rapporto compilato con SHA, risultati anche negativi e log senza segreti.

## 1. Clone e identificazione della versione

```sh
git clone --branch poc/openapi-ai-assistant https://github.com/AleStranieri/apicurio-registry.git
cd apicurio-registry
git rev-parse HEAD
git status --short
git remote add upstream https://github.com/Apicurio/apicurio-registry.git
```

Annotare lo SHA nel rapporto prima dei test. Il fork è pubblico; nessun token,
kubeconfig, password, peso del modello o dump di dati deve essere committato.
Le modifiche che Bob eventualmente fa devono essere distinguibili dalla base
testata e avere commit DCO (`git commit -s`) quando richiesti.

## 2. Prerequisiti e build della base

Usare Node 24 LTS e npm; il controllo Linux è stato fatto con Node 24.18.0 / npm
11.16.0. Per Java/MCP servirà JDK 21+, ma non è richiesto per la sola UI.
Usare un runtime container funzionante sul Mac. Non installare cluster o modelli
prima dell'inventario risorse. I download richiedono rete.

```sh
node --version
npm --version
uname -m
sw_vers
sysctl hw.memsize
df -h .

cd typescript-sdk
npm ci
node ../ui/.scripts/ensure-sdk-built.cjs
cd ../ui/ui-app
npm ci
npm test
npm run build
cd ../../console-plugin
npm ci --legacy-peer-deps
npm run build
cd ..
```

L'SDK genera il client Kiota al primo avvio: è una dipendenza reale della build,
non serve copiare `node_modules` o `dist` dal PC Linux. I lockfile sono inclusi,
compreso quello del console plugin. Eseguire le build in sequenza per limitare il
picco RAM. Non usare `npm install --force` per superare errori senza diagnosticarli.

## 3. Avvio standalone sul Mac, senza cluster

Questo riproduce l'editor condiviso; non costituisce un test di ODH o della console.
Le porte 8080, 8888 e 8889 devono essere libere. Su Linux sono già usate in parte
dal PoC esistente: non avviare questa compose sopra quell'ambiente.

Prima verificare che le immagini 3.3.1 abbiano ARM64, ad esempio con
`podman manifest inspect docker.io/apicurio/apicurio-registry:3.3.1` e il comando
equivalente per `apicurio-registry-ui:3.3.1`. Annotare i digest effettivi.
Se manca ARM64, riportarlo: non introdurre emulazione amd64 senza distinguerla nel
rapporto. Il file compose non forza l'architettura.

```sh
podman compose -f console-plugin/poc/compose.yaml up -d
curl --fail http://localhost:8080/apis/registry/v3/system/info
```

Attendere la readiness prima di creare la fixture; in caso di errore controllare
`podman compose -f console-plugin/poc/compose.yaml logs registry`.
Chi usa Docker Compose può sostituire `podman compose` con `docker compose`.
Il Registry di questo setup è usa-e-getta: non affidargli dati da conservare.

```sh
curl --fail-with-body -X POST http://localhost:8080/apis/registry/v3/groups/default/artifacts \
  -H 'Content-Type: application/json' \
  --data-binary @console-plugin/poc/fixture.json
```

Se la fixture esiste già (409), leggerla e verificare titolo `Pet Store API` e
versione `1` in stato DRAFT; non sovrascrivere dati esistenti per far passare i test.

Su un clone nuovo, copiare la configurazione locale ignorata da Git. Se `config.js`
esiste già, confrontarlo prima di sostituirlo.

```sh
cp console-plugin/poc/config-bob.js ui/ui-app/config.js
cp ui/ui-app/configs/version.js ui/ui-app/version.js
cd ui/ui-app
npm run dev -- --host 127.0.0.1 --strictPort
```

Aprire <http://localhost:8888/explore/default/bob-apitomy-baseline/versions/1/editor>.
Il vecchio editor viene servito dal container sulla porta 8889; la UI modificata
viene servita da Vite sulla porta 8888. Il container della UI 3.3.1 da solo non
contiene il nuovo codice Apitomy.

## 4. Test browser sul Mac

In un altro terminale, dalla radice del repository, installare Playwright in una
directory locale ignorata. La versione seguente è quella usata nella verifica
Linux; conservarla nel rapporto, inclusa la versione del browser scaricato.

```sh
npm install --prefix console-plugin/.runtime/browser-tools --no-audit --no-fund playwright@1.64.0-alpha-1790635538000
console-plugin/.runtime/browser-tools/node_modules/.bin/playwright install chromium
```

Impostare `PLAYWRIGHT_MODULE` con il percorso assoluto della directory
`console-plugin/.runtime/browser-tools/node_modules/playwright` nel proprio clone.
Non impostare `PLAYWRIGHT_CHROMIUM_EXECUTABLE` al percorso Linux: in assenza della
variabile Playwright usa il Chromium installato per il Mac.

```sh
export PLAYWRIGHT_MODULE="$PWD/console-plugin/.runtime/browser-tools/node_modules/playwright"
POC_EDITOR_BASE_URL=http://localhost:8888/explore/default/ \
POC_FIXTURE_ID=bob-apitomy-baseline \
node console-plugin/tests/verify-apitomy-poc.cjs
```

Il test crea e rimuove solo artefatti temporanei `apitomy-poc-*`; controlla che la
fixture iniziale resti invariata. Le evidenze sono sotto
`console-plugin/.runtime/apitomy-poc/`. Le richieste in errore vanno lette nel
rapporto JSON: non ignorare errori Registry perché la pagina si apre.

## 5. Console plugin e ODH

La build del plugin è verificabile già con il passo 2. Per il test completo serve
una console compatibile con React 18/PatternFly 6 e la risorsa ApicurioRegistry3.
Il vecchio `console-plugin/start-console.sh` forza amd64 e non configura il proxy
Registry del PoC: **non usarlo come launcher Mac di questa consegna**.

Bob deve prima individuare la console/cluster compatibile nel gate G1. Per una
console di sviluppo separata dal cluster, i collegamenti necessari sono:

- asset plugin → dev server Webpack porta 9001;
- service proxy console `/api/proxy/plugin/apicurio-registry/registry-api/`
  → Webpack `/registry-api/` → Registry porta 8080;
- browser → UI legacy porta 8889;
- console → API del cluster con credenziali locali, mai nel repository.

La configurazione `BRIDGE_PLUGIN_PROXY` usata sul PC Linux è documentata in
`APITOMY-POC.md`. Sul Mac l'endpoint visto dal container deve raggiungere l'host
attraverso il networking del runtime: `localhost` dentro una VM/container non è
il Mac. Il CR di laboratorio deve avere nome `simple`, namespace `default`,
`spec.app.ingress.host: http://localhost:8080` e
`spec.ui.ingress.host: http://localhost:8889` per usare la rotta predefinita del test.
Verificare le CRD reali del cluster prima di applicare il CR.

Non sono consegnati token del cluster Linux né un cluster già installato. La
verifica ODH/ARM è il primo lavoro di Bob, con i limiti e le alternative del piano.
Il passaggio ODH resta aperto finché non ci sono evidenze reali.

## 6. Consegna della verifica

Compilare `docs/bob/REPORT-TEMPLATE.md` in una copia sotto `.runtime`, allegando
SHA, architetture, comandi, test, tempi, log ripuliti e screenshot. Distinguere
PASS/FAIL/BLOCKED/NOT RUN. Riportare qui il rapporto per la review finale.

Per fermare il solo stack disposable creato dal passo 3:

```sh
podman compose -f console-plugin/poc/compose.yaml down
```

Questo può perdere i dati del Registry di prova. Non fare prune globale e non
rimuovere altri container o cluster aziendali.
