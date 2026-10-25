# Magazzino – carico/scarico per iPad iOS 9.3

Web app per gestire un magazzino diviso per categorie (Bere, Cibo…), pensata per un iPad bloccato a iOS 9.3.

- **Frontend** (`public/`): HTML + CSS + JavaScript ES5 puro, senza framework né build. Usa `XMLHttpRequest` (Safari 9 non ha `fetch`), niente CSS Grid né variabili CSS, pulsanti grandi per il touch.
- **Database**: Supabase (`supabase/schema.sql`).
- **Proxy** (`lib/forward.js`): l'iPad non parla direttamente con Supabase. Passa da `/api/proxy`, che aggiunge la chiave segreta. Lo stesso codice gira:
  - sul **Mac** (`server.js`), per l'iPad in casa;
  - su **Vercel** (`api/proxy.js`), per accedere da altri dispositivi.

## Perché l'iPad deve passare dal Mac

iOS 9 non riconosce più molti certificati HTTPS moderni (ad esempio quelli Let's Encrypt usati da Vercel, dopo la scadenza del vecchio certificato radice nel 2021). Su iOS 9 potresti quindi non riuscire ad aprire il sito Vercel o a contattare Supabase.

Per evitarlo, il Mac serve l'app all'iPad in **HTTP sulla rete di casa** e parla lui con Supabase in HTTPS:

```
iPad (Safari 9) --HTTP--> Mac :3000 (server.js) --HTTPS--> Supabase
Telefono/PC moderni --HTTPS--> Vercel (api/proxy.js) --HTTPS--> Supabase
```

## 1. Supabase

1. Crea un progetto su supabase.com.
2. Apri **SQL Editor**, incolla il contenuto di `supabase/schema.sql` ed eseguilo. Crea le tabelle `categorie`, `articoli` e `movimenti` e la funzione `registra_movimento` (carico/scarico atomico, che rifiuta gli scarichi superiori alla giacenza).
3. Da **Project Settings → API Keys** copia l'URL del progetto e la chiave **secret** (o la vecchia `service_role`).

> Per aggiungere categorie (es. "Pulizia") basta inserire una riga nella tabella `categorie`: l'app la mostra da sola.

## 2. Mac (server per l'iPad)

Serve Node.js 18 o più recente (`brew install node`). Non ci sono dipendenze da installare.

```bash
cd ~/magazzino
cp .env.example .env      # poi inserisci SUPABASE_URL e SUPABASE_SERVICE_KEY
node server.js            # -> http://<nome-del-mac>.local:3000
```

Per avviarlo in automatico all'accensione del Mac:

```bash
# modifica i percorsi in mac/it.magazzino.server.plist (utente e `which node`)
cp mac/it.magazzino.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/it.magazzino.server.plist
```

**Home Assistant** usa la porta 8123, quindi può convivere con il server sulla 3000. Se vuoi, aggiungi il magazzino come pagina nella barra laterale di HA (scheda *Webpage* / `panel_iframe`) con l'indirizzo `http://<ip-del-mac>:3000`.

Se Home Assistant gira in Docker o in una VM, il server Node va avviato su macOS e non dentro HA.

## 3. Vercel

1. Carica la cartella su un repository GitHub e importalo in Vercel (preset "Other", nessun comando di build).
2. In **Settings → Environment Variables** imposta `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e **`APP_PIN`**. Il PIN è importante perché il sito è pubblico.
3. Fai il deploy. `vercel.json` pubblica `public/` e la funzione `api/proxy.js`.

## 4. iPad

1. In Safari apri `http://<nome-del-mac>.local:3000` (oppure l'IP del Mac, es. `http://192.168.1.20:3000`). Conviene dare al Mac un IP fisso dal router.
2. Tocca **Condividi → Aggiungi a Home**: l'app si aprirà a schermo intero come un'app nativa.
3. Se hai impostato `APP_PIN`, l'iPad lo chiede la prima volta e poi lo ricorda.

## Riconoscimento prodotti da foto (Google Gemini)

Il pulsante **📷 Foto** apre la fotocamera dell'iPad (o la libreria foto). La foto viene ridotta a 1024 px e raddrizzata sull'iPad, poi inviata al server (`/api/riconosci`). Il server la passa all'API Gemini di Google insieme all'elenco degli articoli già in magazzino.

Gemini restituisce i prodotti visti con nome, categoria, unità, quantità ed eventuale codice a barre, e prova ad abbinarli agli articoli esistenti. Prima di confermare puoi:

- scegliere tra **Carico** e **Scarico**;
- cambiare l'abbinamento: un articolo esistente oppure "Nuovo articolo" con nome modificabile;
- correggere la quantità con − e +;
- escludere una riga.

I movimenti vengono registrati con la nota "Da foto".

**Configurazione**

1. Crea una chiave su https://aistudio.google.com → *Get API key*.
2. Aggiungi `GEMINI_API_KEY=...` nel `.env` del Mac e nelle variabili di Vercel, poi riavvia il server o rifai il deploy.
3. Facoltativo: `GEMINI_MODEL` per scegliere il modello. Il predefinito è `gemini-flash-latest`, l'alias di Google che punta sempre al modello Flash più recente.

Note per iOS 9:

- Safari 9 non permette l'inquadratura dal vivo, quindi si scatta una foto alla volta.
- Per foto migliori scatta da vicino, con buona luce e con le etichette verso la fotocamera.
- Ogni foto è una richiesta a Gemini: controlla limiti e costi su AI Studio.

## Controllo configurazione

Apri `/api/proxy?p=stato` (es. `https://tuo-progetto.vercel.app/api/proxy?p=stato` oppure `http://nome-mac.local:3000/api/proxy?p=stato`). La pagina mostra, senza rivelare segreti:

- se `SUPABASE_URL` è impostato;
- che tipo di chiave hai messo (serve `sb_secret_...` o `service_role`);
- se il PIN è attivo e quanti caratteri ha;
- se la chiave Gemini è impostata e quale modello è in uso;
- il risultato di una prova di collegamento a Supabase.

Su Vercel, dopo aver cambiato una variabile, serve un nuovo deploy (Deployments → ⋯ → Redeploy).

## Modalità demo

Se il server non ha la configurazione di Supabase (o apri `public/index.html` direttamente), l'app parte in **modalità DEMO**: mostra un badge arancione e usa dati di esempio salvati sull'iPad. Utile per provare l'interfaccia prima di configurare Supabase.

## Funzioni

- **Giacenze**: schede per articolo con quantità, unità e scorta minima. Gli articoli sotto scorta sono evidenziati in rosso. Filtri per categoria, filtro "Sotto scorta" e ricerca.
- **Carico / Scarico**: tastierino numerico grande, tasti rapidi +1/+6/+12/+24, "Tutto" per lo scarico e nota facoltativa.
- **Articoli**: crea, modifica ed elimina (tasto ⋯ sulla scheda). La quantità iniziale viene registrata come primo carico.
- **Movimenti**: storico degli ultimi 200 carichi e scarichi con data, ora e nota.

## Sicurezza

- La chiave segreta di Supabase sta solo sul server (`.env` sul Mac, variabili su Vercel). L'RLS è attiva senza policy, quindi le tabelle non sono raggiungibili con la chiave pubblica.
- Il proxy accetta solo le tabelle dell'app e la funzione `registra_movimento`.
- `APP_PIN` è una protezione semplice, adatta a un prototipo. Per più utenti si possono aggiungere gli account di Supabase Auth.
