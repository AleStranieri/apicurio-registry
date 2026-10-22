# Baseline Linux per la consegna a Bob

Data: 22 ottobre 2026. Branch: `poc/openapi-ai-assistant`.
Base precedente: `1356fa08a3dedd6a919550c5fe533092b4a66a37`.
Per identificare lo snapshot consegnato usare `git rev-parse HEAD` sul clone.

## Controlli rieseguiti prima del push

Node `24.18.0`, npm `11.16.0`, Linux x86_64. Dipendenze già installate:
questa verifica non costituisce un'installazione da clone pulito.

| Comando | Directory | Risultato |
|---|---|---|
| `npm test` | `ui/ui-app` | PASS: 28 file, 269 test |
| `npm run build` | `ui/ui-app` | PASS: TypeScript e Vite |
| `npm run build` | `console-plugin` | PASS: Webpack produzione |
| ESLint sui file TS/TSX modificati e `vite.config.mts` | `ui/ui-app` | PASS |
| `node --check console-plugin/tests/verify-apitomy-poc.cjs` | radice | PASS |
| `git diff --check` | radice | PASS |

Vite segnala gli script config/version senza `type="module"` e chunk grandi.
Webpack segnala la dipendenza con import dinamico di Kiota.
I lockfile e i loro checksum sono in [versions.lock.yaml](versions.lock.yaml).
I log di questa esecuzione rimangono locali in `/tmp/apicurio-bob-*.log`.

## Evidenze browser preesistenti

Il rapporto locale `console-plugin/.runtime/apitomy-poc/browser-report.json`
contiene 21 verifiche riuscite, nessun errore pagina, worker locali e nessuna
richiesta CDN. Include JSON/YAML, edit/undo/redo, save/reload, fallback,
recovery, Source e cambio documento; la fixture iniziale rimane invariata.
Questo rapporto proviene dall'esecuzione precedente, non da un nuovo run
durante la preparazione del push. Cache, screenshot e rapporto grezzo non
sono pubblicati nel fork.

Il rapporto registra anche richieste console in errore (404/500/502) verso
API OpenShift/servizi assenti in Kind e traduzioni plugin mancanti. Non è una
verifica positiva di OKD o ODH. I dettagli di riproduzione sono in
[APITOMY-POC.md](../../console-plugin/APITOMY-POC.md).

## Verifiche ancora da eseguire

Installazione da clone pulito, immagini ARM64/digest, browser Mac, console
compatibile e fattibilità ODH sono da verificare con Bob. Il modello Metal,
l'assistente AI e il relativo percorso MCP non sono validati da questi test.
I workflow esistenti limitano i job al proprietario `Apicurio`: un push sul
fork personale non implica l'esecuzione della pipeline upstream.
