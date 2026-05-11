# 🎙 RadioSim — Guida al Deploy su Render

## Struttura del progetto

```
radiosim/
├── server/
│   └── index.js        ← Backend Node.js (WebSocket + WebRTC signaling)
├── public/
│   └── index.html      ← Frontend PWA (radio UI)
├── package.json
├── railway.toml        ← Legacy (vecchia config Railway, inerte su Render)
└── .gitignore
```

> Il file `railway.toml` è un residuo del vecchio deploy su Railway: su Render non viene letto e può essere ignorato. Si può anche eliminare senza conseguenze.

---

## ✅ Prerequisiti (5 minuti)

1. **Account GitHub** — gratuito su https://github.com
2. **Account Render** — gratuito su https://render.com (accedi con GitHub)
3. **Git** installato sul tuo PC — https://git-scm.com/downloads

---

## 🚀 Deploy passo per passo

### PASSO 1 — Crea un repository GitHub

```bash
cd radiosim
git init
git add .
git commit -m "RadioSim v1.0"
```

Poi vai su https://github.com/new e crea un repository (es. `radiosim`).

```bash
git remote add origin https://github.com/TUO-USERNAME/radiosim.git
git branch -M main
git push -u origin main
```

---

### PASSO 2 — Crea il servizio su Render

1. Vai su **https://dashboard.render.com** → **New +** → **Web Service**.
2. Connetti il tuo repository GitHub `radiosim`.
3. Compila il form:
   - **Name**: `radiosim` (o quello che preferisci)
   - **Region**: la più vicina ai volontari (es. `Frankfurt` per l'Italia)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` per i test, `Starter` o superiore per uso reale (Free va in sleep dopo 15 minuti di inattività)
4. Clicca **Create Web Service**. Render scarica il codice ed esegue il primo deploy (~2-5 min).
5. Quando vedi **Live** in verde ✅ è pronto.

---

### PASSO 3 — Ottieni l'URL pubblico

Render assegna automaticamente un URL `.onrender.com` al servizio (es. `https://radiosim-xxxx.onrender.com`). Lo trovi in alto nella dashboard del servizio.

> ✅ **HTTPS è automatico**. Il frontend usa `wss://` (WebSocket sicuro) automaticamente quando la pagina è servita su HTTPS.

---

### PASSO 4 — Imposta i codici di accesso (Environment)

Vai su Render → servizio `radiosim` → tab **Environment** → **Add Environment Variable** e aggiungi:

| Variabile | Obbligatoria | Cosa fa |
|-----------|:-:|---------|
| `ACCESS_PASSWORD` | sì (in produzione) | Codice di accesso per i volontari. Senza questa variabile l'accesso è libero (modalità dev). |
| `ADMIN_PASSWORD` | facoltativa | Abilita il ruolo admin (vedi sezione dedicata sotto). Se non impostata, nessuno può entrare come admin. |
| `ADMIN_CALLSIGN` | facoltativa | Nominativo singolo che identifica l'admin. Default: `ADMIN`. Da preferire `ADMIN_CALLSIGNS` se servono più istruttori. |
| `ADMIN_CALLSIGNS` | facoltativa | Lista CSV di nominativi admin (es. `MARCO-IST,LUCA-IST,SARA-IST`). Sostituisce `ADMIN_CALLSIGN`. Tutti gli istruttori condividono la stessa `ADMIN_PASSWORD` ma mantengono il proprio callsign distintivo nei log. |
| `MAX_USERS_PER_CHANNEL` | facoltativa | Tetto al numero di utenti per coppia stanza+canale. Default `0` o assente = illimitato. Suggerito `8` per mantenere fluida la mesh WebRTC. Gli admin entrano sempre, anche se il canale è pieno. |
| `ROOMS` | facoltativa | Lista CSV delle stanze disponibili nel menu (es. `SALA-ALPHA,SALA-BRAVO,SALA-CHARLIE,SALA-DELTA`). Default: queste 4 stanze. La stanza inserita dal client deve essere nella lista, altrimenti il join viene rifiutato con `INVALID_ROOM`. |

> ⚠️ **Attenzione**: dopo aver salvato una variabile, Render riavvia automaticamente il servizio (~30-60 s). Controlla che non ci siano spazi accidentali a inizio/fine quando incolli i valori.

---

### PASSO 5 — Condividi con i volontari

Invia ai volontari il link Render + il valore di `ACCESS_PASSWORD`. Niente da installare:
- Su **PC/Mac**: apri il link in Chrome o Firefox
- Su **Android**: apri in Chrome → "Aggiungi alla schermata Home" per installarlo come app
- Su **iPhone**: apri in Safari → "Aggiungi a Home" per installarlo come app

---

## 🎛 Come usare RadioSim

| Campo | Istruzioni |
|-------|-----------|
| **Nominativo** | Inserisci il tuo callsign (es. ALFA-1, BRAVO-2). 2-12 caratteri, solo `A-Z`, `0-9`, `-`, `_`. |
| **Canale** | Tutti devono scegliere lo stesso canale (1-4). |
| **Stanza** | Tutti devono selezionare la stessa stanza dal menu (default `SALA-ALPHA..DELTA`, configurabile via `ROOMS`). Stanze diverse sono completamente isolate. |

### PTT (Push To Talk)
- **PC**: tieni premuta la **barra spaziatrice**
- **Mobile**: tieni premuto il **grande pulsante PTT**
- Come su una vera radio: **solo uno parla alla volta** per coppia stanza+canale

---

## 🔧 Aggiornamenti futuri

Ogni volta che modifichi il codice:

```bash
git add .
git commit -m "Descrizione modifica"
git push
```

Render rileva il push su `main` e rideploya automaticamente (~1-3 minuti). La versione mostrata nell'header dell'app (`v1.5.x`) ti permette di verificare quale build è live.

---

## 📊 Monitoraggio

- **Health check**: `https://tuo-url.onrender.com/health` → restituisce `{"status":"ok","version":"...","rooms":N,"uptime":SECONDI}`
- **Stato stanze**: `https://tuo-url.onrender.com/status` → elenco stanze e canali attivi
- **Versione corrente**: `https://tuo-url.onrender.com/version`

Esempio risposta `/status`:
```json
{
  "FORMAZIONE-01__CH1": {
    "users": ["ALFA-1", "BRAVO-2", "CHARLIE-3"],
    "currentTx": null
  }
}
```

I log applicativi (`[JOIN]`, `[TX START]`, `[VALIDATE]`, `[HEARTBEAT]`, ecc.) si trovano nella dashboard Render → tab **Logs**.

---

## 👮 Funzione ADMIN (sblocca canale)

Per gestire situazioni in cui un volontario tiene il PTT premuto per errore o per sbloccare il canale durante un'esercitazione, è disponibile un ruolo **admin**.

### Come si attiva

Imposta `ADMIN_PASSWORD` (e opzionalmente `ADMIN_CALLSIGN`) su Render → vedi **PASSO 4** sopra. Senza `ADMIN_PASSWORD` la funzione admin è **disattivata** e nessuno può entrare con il nominativo admin.

### Come si usa

1. Il coordinatore apre l'app come tutti gli altri.
2. Inserisce come **NOMINATIVO** quello configurato in `ADMIN_CALLSIGN` (default `ADMIN`).
3. Compila il campo **CODICE ADMIN** con la password admin (il campo CODICE ACCESSO può essere lasciato vuoto in questo caso).
4. Sceglie stessa stanza/canale dei volontari da supervisionare.
5. Una volta dentro: vede il pulsante rosso **🔴 SBLOCCA CANALE** sotto il PTT.
6. Il pulsante è attivo solo quando il canale è occupato. Cliccando, dopo conferma, interrompe la trasmissione in corso.
7. L'admin può comunque parlare e ricevere come tutti gli altri.
8. L'admin può entrare anche se il canale ha raggiunto `MAX_USERS_PER_CHANNEL` — utile per intervenire durante un'esercitazione satura.

Tutti gli utenti del canale vedono il badge `ADMIN` accanto al nominativo del coordinatore, e nel log appare un avviso quando l'admin sblocca il canale.

---

## 🔒 Note tecniche

| Aspetto | Soluzione |
|---------|-----------|
| Audio peer-to-peer | WebRTC mesh (audio diretto tra dispositivi, server non transita audio) |
| Segnalazione PTT | WebSocket sul server Render |
| Effetto radio | Disattivato di default (audio raw garantito). Aggiungere `?radiofx=1` all'URL per attivare il filtro 300-3000 Hz |
| STUN server | Google STUN (gratuito, per NAT traversal) |
| Microfono | Attivato solo durante PTT — privacy garantita |
| Riconnessione automatica | Backoff esponenziale: 2s → 4s → 8s → 16s → 30s, con jitter ±20% per evitare picchi sul server |
| Liveness server-side | Heartbeat WS PING/PONG ogni 30s. I client zombie (mobile sospeso, rete caduta) vengono droppati in 30-60s |
| Validazione input | Server-side: callsign 2-12 char, stanza 1-24 char, charset `[A-Z0-9_-]`, canale `1-4`. I payload non conformi vengono rifiutati con `INVALID_INPUT`. |
| Rate limit auth | 5 tentativi password sbagliata per IP / 60s, poi blocco temporaneo. |
| Roger beep | Tono 880 Hz a fine TX, generato in Web Audio. |

---

## 💡 Consigli per la formazione

1. **Test audio**: prima di ogni sessione, ogni volontario fa una breve trasmissione di test.
2. **Disciplina radio**: usate le procedure reali (nominativo chiamante + nominativo chiamato).
3. **Stanze multiple**: potete creare stanze separate per gruppi diversi (es. `GRUPPO-A`, `GRUPPO-B`). Stanze diverse sono completamente isolate, anche sullo stesso canale.
4. **Canali multipli**: usate canali diversi (1-4) per simulare frequenze operative differenti. Sono i talkgroup DMR `Fir-Dig-1_slot_A/B`, `Fir-Dig-2_slot_A/B`. Più persone su canali diversi = trasmissioni in parallelo senza conflitti.
5. **Limite utenti**: per gruppi grandi (>10) imposta `MAX_USERS_PER_CHANNEL=8` e spalma sui 4 canali.

---

## ❓ Troubleshooting

**Il microfono non funziona**
→ Il browser chiede il permesso al primo accesso. Cerca l'icona 🔒 in alto a sinistra e abilita il microfono.

**"Nominativo già in uso"**
→ Un altro volontario ha già usato quel callsign nella stessa stanza+canale. Cambia nominativo.

**"Nominativo non valido (2-12 caratteri...)"**
→ Il callsign deve essere 2-12 caratteri tra `A-Z`, `0-9`, `-`, `_`. Niente spazi, accenti o simboli.

**"Canale pieno: massimo N utenti"**
→ Hai impostato `MAX_USERS_PER_CHANNEL` e quel canale ha raggiunto il tetto. Prova un altro canale (1-4) o togli/alza la variabile su Render.

**Audio distorto o assente**
→ Ricarica la pagina (Ctrl+F5 su PC) per essere sicuro di avere l'ultima versione. Verifica che lo slider VOLUME RICEZIONE non sia a zero e che il volume del dispositivo/browser sia alto.
→ Su Safari iOS: tocca un punto qualsiasi della pagina dopo essere entrato nel canale per sbloccare l'audio. Disattiva la modalità silenzioso del telefono.
→ Se non si sente nulla con 2+ utenti: aprire la console (F12 su PC) e cercare errori in rosso — segnalali per supporto.

**"Codice di accesso non valido" anche se è giusto**
→ Verifica che la variabile `ACCESS_PASSWORD` su Render non abbia spazi accidentali a inizio/fine. Le password sono case-sensitive. Dopo 5 tentativi errati il server blocca l'IP per 60 secondi (rate limit anti brute-force).

**Disconnessioni continue (loop di leave/enter nel log)**
→ Tipicamente smartphone con schermo che si spegne o app in background. Tieni lo schermo sempre acceso. Su Render free, verifica anche che il servizio non stia "dormendo" (su piano Free dopo 15 min di inattività). Sul piano Starter o superiore non succede.

**Latenza alta**
→ WebRTC usa STUN per connettersi direttamente. In rari casi (firewall aziendali) serve un server TURN — contattaci per la configurazione.
