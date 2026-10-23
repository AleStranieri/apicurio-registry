# G5 — Decisioni su Axiom, input messaggi e ricerca

Data: 23 ottobre 2026. Stato iniziale: analisi del codice e scelta progettuale.
Aggiornamento: G5 implementato localmente; decisione finale e prove in fondo al documento.
Documento collegato al [piano principale, sezione 9](2026-10-22-openapi-ai-poc-plan.md#9-g5--integrazione-nelleditor).

## Decisioni da conservare

1. Preferire un componente ufficiale PatternFly per l'input, valutando prima `MessageBar`
   di `@patternfly/chatbot`. Se la dipendenza risulta sproporzionata o incompatibile,
   usare `TextArea` e `Button` di PatternFly già presenti.
2. Non copiare Axiom come requisito. Confrontare ogni parte con la soluzione minima per
   G5 e riusarla solo se offre un vantaggio dimostrabile.
3. Conservare il contratto G4 `POST /proposals` e le garanzie sulla bozza corrente.
   Il componente visuale non deve imporre sessioni, SSE o un nuovo backend.
4. Rimandare OpenViking: nessuna installazione o indicizzazione eseguita. La ricerca locale
   è sufficiente per questa analisi; manca una misura che giustifichi un altro servizio.

## Evidenze e provenienza

- Registry: branch `poc/openapi-ai-assistant`, G4 nel commit `795045447`.
  [Contratto e comandi](../examples/openapi-ai-assistant/README.md),
  [28 test e replay reali, inclusi i fallimenti](../examples/openapi-ai-assistant/reports/g4-validation.md).
- [Axiom](https://github.com/Apitomy/apitomy-axiom/tree/97b06f36446cdb7afcdb7935e52138bd3a241fa7):
  clone locale in `/Users/astranier/Documents/dev/apitomy-axiom`, commit
  `97b06f36446cdb7afcdb7935e52138bd3a241fa7`, branch `main` al momento dell'analisi.
  Letti componenti, dipendenze, test mirati e codice di validazione/Apply. Non eseguiti build
  o test Axiom; nessuna istanza Axiom avviata o modificata.
- PatternFly: letti [MessageBar.tsx](https://github.com/patternfly/chatbot/blob/main/packages/module/src/MessageBar/MessageBar.tsx)
  e [manifest del pacchetto](https://github.com/patternfly/chatbot/blob/main/packages/module/package.json)
  sul ramo `main`. Questi link sono mobili: prima dell'implementazione fissare la release
  pubblicata scelta e verificare i suoi sorgenti e il lockfile. Nessuna release ancora selezionata.

## Cosa offre Axiom e quanto conviene riusarlo

Percorsi relativi al checkout Axiom fissato sopra:

| Parte esaminata | Valore per G5 | Decisione |
|---|---|---|
| `ui/src/components/assistant/AssistantMessageInput.tsx` | Input multilinea, invio, stop, disabilitazione e prefill tramite nonce | Confrontare con MessageBar; non copiare automaticamente |
| `ui/src/components/assistant/AssistantChatPanel.tsx` | Coordinamento conversazione, eventi e interrupt | Troppo legato alle sessioni Axiom per un riuso diretto nel contratto attuale |
| `ui/src/components/assistant/AssistantMessageList.tsx` | Rendering di messaggi e tool | Dipende anche da tema, markdown, permessi e altri componenti Axiom; selezionare solo comportamenti necessari |
| `ui/src/components/assistant/AssistantGeneratedItems.tsx` | Anteprima e diagnostica degli elementi prodotti | Riferimento UX; elementi e modali sono specifici delle configurazioni Axiom |
| `app/src/main/java/io/apitomy/axiom/app/assistant/AssistantItemValidator.java` | Delega a validatori reali condivisi | Principio coerente con G4; i validatori di dominio Axiom non validano OpenAPI |
| `app/src/main/java/io/apitomy/axiom/app/assistant/AssistantSessionManager.java`, `applySession` | Blocca Apply in presenza di errori e importa configurazioni | Apply Axiom persiste dati; G5 applica solo alla bozza e richiede un'integrazione diversa |

I test `AssistantChatPanel.test.tsx` verificano override di invio, disabilitazione e prefill;
`AssistantGeneratedItems.test.tsx` verifica anteprime dei tipi Axiom. Sono esempi da studiare,
non evidenza che siano già coperti i rischi G5 di bozza obsoleta, navigazione e undo/redo.

Il manifest Axiom consultato usa React 19.3.1 e PatternFly React 6.7.0; il nostro plugin
usa React 18.3.1 e PatternFly 6.6.1, la UI standalone React 19.3.0 e PatternFly 6.6.1.
Il backend Axiom richiede Java 25; G4 è compilato con JDK 21 e target Java 17.
Queste differenze richiedono verifica prima di importare componenti o aggiungere dipendenze.

## Perché partire da MessageBar

L'estensione è mantenuta nel progetto PatternFly e usa PatternFly 6. Il sorgente consultato
espone invio, gestione del cambiamento del testo, disabilitazione e pulsante Stop; il manifest
dichiara peer React e React DOM `^18 || ^19`.

Questo rende MessageBar un candidato coerente con entrambi i frontend, ma non prova ancora
compatibilità della release, qualità dell'integrazione o convenienza del bundle. Il pacchetto
include anche funzionalità e dipendenze ulteriori rispetto al solo input. Servono verifica
di import, dipendenze risolte, CSS e dimensioni prodotte nelle due build.

Non adottare automaticamente l'intera chat: G5 deve mostrare anche diff semantico,
diagnostica e azioni di applicazione alla bozza. Il controller applicativo gestirà:

- bozza e istruzione correnti, `requestId`, identità, revisione e hash;
- stato della richiesta, errori e conservazione dell'istruzione per riprovare;
- annullamento dell'attesa e rifiuto delle risposte tardive;
- controllo di obsolescenza sia alla ricezione sia al clic su Applica;
- applicazione tramite API pubbliche dell'editor, con comportamento undo verificato.

Il pulsante Stop è un elemento UI. Il contratto G4 non contiene un endpoint di cancellazione:
interrompere la fetch o ignorare il risultato non dimostra che l'inferenza server sia stata
fermata. L'interfaccia e i test devono rispettare questa distinzione.

## OpenViking: valutato, rinviato

La [documentazione ufficiale](https://docs.openviking.net/en/getting-started/01-introduction)
descrive risorse, memoria tra sessioni e ricerca semantica; il
[quickstart](https://docs.openviking.net/en/getting-started/02-quickstart) prevede un servizio
e, nel percorso self-hosted descritto, configurazioni per embedding e VLM.

Per esplorare Registry e Axiom non è emersa una necessità di aggiungere questa infrastruttura.
Non assumere che il modello Granite già presente copra anche gli embedding richiesti.
Se il corpus cresce o servono ricerche concettuali ripetute tra sessioni, fare una prova separata
su domande con risposta nota: confrontare evidenze trovate, correttezza, latenza e costo di
indicizzazione/manutenzione con la ricerca locale. Verificare release e integrazione effettive
prima di installare o considerarlo una dipendenza del prodotto.

## Ordine di lavoro per G5

1. Verificare Source non applicato e API pubbliche dell'istanza editor montata: cattura bozza,
   applicazione undoable e ripristino. Questi aspetti non sono risolti dai componenti chat Axiom.
2. Confrontare MessageBar della release selezionata con TextArea/Button già presenti.
   Confermare dipendenze, accessibilità, tastiera, testo controllato, CSS e bundle sui due frontend.
3. Implementare controller e pannello minimo sul contratto G4; adattare parti Axiom solo dove
   il confronto dimostra un vantaggio, conservando provenienza e licenza applicabili.
4. Testare errori, istruzione preservata, bozza obsoleta, navigazione, doppio invio, annullamento,
   Applica/rifiuta/ripristina e salvataggio esplicito. Verificare UI e console plugin separatamente.
5. Registrare nel piano la release scelta, i componenti effettivamente riusati, le prove e
   le limitazioni. Nessun PASS di compatibilità prima delle build e dei test.


## Decisione finale implementata

Valutata la release pubblicata `@patternfly/chatbot@6.9.0`, tarball ufficiale
[chatbot-6.9.0.tgz](https://registry.npmjs.org/@patternfly/chatbot/-/chatbot-6.9.0.tgz),
SHA-256 `263ae952c5193e85bad7690a8e8317a1c82cbbbcdb9ed36534f6ff9dc053bad8`.
Letti `package.json`, `src/MessageBar/MessageBar.tsx`, dichiarazioni e JS ESM,
`dist/css/main.css` (119730 byte). I peer React/DOM ammettono 18/19, ma le dipendenze
PF partono da `^6.7.0-prerelease.*`, oltre a peer Monaco `^0.56.0` (qui 0.57.0).
Il pacchetto include analytics e markdown; MessageBar importa anche allegati/menu/microfono.
La dimensione del tarball scompattato è 14317761 byte: non è una misura del bundle
finale né del costo trasferito di MessageBar. Il CSS è globale `pf-chatbot`, non lo
stylesheet già confinato dell'editor.

Scartato per il costo di introdurre un'altra linea PF e dipendenze per un solo input.
Non installato o compilato nei due frontend: la compatibilità della release non è
certificata. Scelti `TextArea` e `Button` già installati, verificati con test/render React
18.3.1 e 19.3.0 e build Webpack/Vite separate, mantenendo PF 6.6.1.
Nessun sorgente Axiom copiato: il controller locale `/proposals` è più piccolo del ponte
sessioni/SSE. OpenViking resta fuori dalle dipendenze.

Il limite undo e il blocco Source sono effettivi, non ipotesi: vedere
[report G5](../examples/openapi-ai-assistant/reports/g5-validation.md) e README aggiornato.
Restano il browser del vero host console, la matrice modello e ODH.
