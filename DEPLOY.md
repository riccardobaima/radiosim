# 🎙 RadioSim — Guida al Deploy su Railway

## Struttura del progetto

```
radiosim/
├── server/
│   └── index.js        ← Backend Node.js (WebSocket + WebRTC signaling)
├── public/
│   └── index.html      ← Frontend PWA (radio UI)
├── package.json
├── railway.toml        ← Configurazione Railway (auto-deploy)
└── .gitignore
```

---

## ✅ Prerequisiti (5 minuti)

1. **Account GitHub** — gratuito su https://github.com
2. **Account Railway** — gratuito su https://railway.app (accedi con GitHub)
3. **Git** installato sul tuo PC — https://git-scm.com/downloads

---

## 🚀 Deploy passo per passo

### PASSO 1 — Crea un repository GitHub

```bash
# Apri il terminale nella cartella del progetto
cd radiosim

# Inizializza git
git init
git add .
git commit -m "RadioSim v1.0"
```

Poi vai su https://github.com/new e crea un repository (es. `radiosim`).

```bash
# Collega e carica
git remote add origin https://github.com/TUO-USERNAME/radiosim.git
git branch -M main
git push -u origin main
```

---

### PASSO 2 — Deploy su Railway

1. Vai su **https://railway.app** e clicca **"New Project"**
2. Scegli **"Deploy from GitHub repo"**
3. Seleziona il repository `radiosim`
4. Railway rileva automaticamente il `railway.toml` e avvia il deploy
5. Dopo ~60 secondi vedrai **"Active"** in verde ✅

---

### PASSO 3 — Ottieni l'URL pubblico

1. Nel progetto Railway, clicca sul servizio → tab **"Settings"**
2. Scorri fino a **"Networking"** → **"Generate Domain"**
3. Ottieni un URL tipo: `https://radiosim-production.up.railway.app`

> ⚠️ **Importante:** Railway assegna HTTPS automaticamente.
> Il frontend usa `wss://` (WebSocket sicuro) in automatico su HTTPS.

---

### PASSO 4 — Imposta i codici di accesso (Variables)

Vai su Railway → progetto `radiosim` → tab **"Variables"** e aggiungi:

| Variabile | Obbligatoria | Cosa fa |
|-----------|:-:|---------|
| `ACCESS_PASSWORD` | sì (in produzione) | Codice di accesso per i volontari. Senza questa variabile l'accesso è libero (modalità dev). |
| `ADMIN_PASSWORD` | facoltativa | Abilita il ruolo admin (vedi sezione dedicata sotto). Se non impostata, nessuno può entrare come admin. |
| `ADMIN_CALLSIGN` | facoltativa | Nominativo che identifica l'admin. Default: `ADMIN`. |
| `MAX_USERS_PER_CHANNEL` | facoltativa | Tetto al numero di utenti per coppia stanza+canale. Default `0` o assente = illimitato. Suggerito `8` per mantenere fluida la mesh WebRTC. Gli admin entrano sempre, anche se il canale è pieno. |

> ⚠️ **Attenzione**: dopo aver salvato una variabile, Railway riavvia automaticamente il servizio (~30 s). Controlla che non ci siano spazi accidentali a inizio/fine quando incolli il valore.

---

### PASSO 5 — Condividi con i volontari

Invia ai volontari il link Railway + il `ACCESS_PASSWORD` che hai impostato. Niente da installare:
- Su **PC/Mac**: apri il link in Chrome o Firefox
- Su **Android**: apri in Chrome → "Aggiungi alla schermata Home" per installarlo come app
- Su **iPhone**: apri in Safari → "Aggiungi a Home" per installarlo come app

---

## 🎛 Come usare RadioSim

| Campo | Istruzioni |
|-------|-----------|
| **Nominativo** | Inserisci il tuo callsign (es. ALFA-1, BRAVO-2) |
| **Canale** | Tutti devono scegliere lo stesso canale |
| **Stanza** | Tutti devono inserire lo stesso codice stanza (es. `ESERCITAZIONE-24`) |

### PTT (Push To Talk)
- **PC**: tieni premuta la **barra spaziatrice**
- **Mobile**: tieni premuto il **grande pulsante PTT**
- Come su una vera radio: **solo uno parla alla volta**

---

## 🔧 Aggiornamenti futuri

Ogni volta che modifichi il codice:

```bash
git add .
git commit -m "Descrizione modifica"
git push
```

Railway rileva il push e rideploya automaticamente (< 60 secondi).

---

## 📊 Monitoraggio

- **Health check**: `https://tuo-url.railway.app/health`
- **Stato stanze**: `https://tuo-url.railway.app/status`

Esempio risposta `/status`:
```json
{
  "FORMAZIONE-01__CH1": {
    "users": ["ALFA-1", "BRAVO-2", "CHARLIE-3"],
    "currentTx": null
  }
}
```

---

## 👮 Funzione ADMIN (sblocca canale)

Per gestire situazioni in cui un volontario tiene il PTT premuto per errore o per sbloccare il canale durante un'esercitazione, è disponibile un ruolo **admin**.

### Come si attiva

Imposta `ADMIN_PASSWORD` (e opzionalmente `ADMIN_CALLSIGN`) su Railway → vedi **PASSO 4** sopra. Senza `ADMIN_PASSWORD` la funzione admin è **disattivata** e nessuno può entrare con il nominativo admin.

### Come si usa

1. Il coordinatore apre l'app come tutti gli altri.
2. Inserisce come **NOMINATIVO** quello configurato in `ADMIN_CALLSIGN` (default `ADMIN`).
3. Compila il campo **CODICE ADMIN** con la password admin (il campo CODICE ACCESSO può essere lasciato vuoto in questo caso).
4. Sceglie stessa stanza/canale dei volontari da supervisionare.
5. Una volta dentro: vede il pulsante rosso **🔴 SBLOCCA CANALE** sotto il PTT.
6. Il pulsante è attivo solo quando il canale è occupato. Cliccando, dopo conferma, interrompe la trasmissione in corso.
7. L'admin può comunque parlare e ricevere come tutti gli altri.

Tutti gli utenti del canale vedono il badge `ADMIN` accanto al nominativo del coordinatore, e nel log appare un avviso quando l'admin sblocca il canale.

---

## 🔒 Note tecniche

| Aspetto | Soluzione |
|---------|-----------|
| Audio peer-to-peer | WebRTC (traffico audio diretto tra dispositivi) |
| Segnalazione PTT | WebSocket sul server Railway |
| Effetto radio | Web Audio API (filtri passa-banda 300–3000 Hz) |
| STUN server | Google STUN (gratuito, per NAT traversal) |
| Microfono | Attivato solo durante PTT — privacy garantita |
| Riconnessione | Automatica dopo 4 secondi in caso di disconnessione |

---

## 💡 Consigli per la formazione

1. **Test audio**: prima di ogni sessione, ogni volontario fa una breve trasmissione di test
2. **Disciplina radio**: usate le procedure reali (nominativo chiamante + nominativo chiamato)
3. **Stanze multiple**: potete creare stanze separate per gruppi diversi (es. `GRUPPO-A`, `GRUPPO-B`)
4. **Canali multipli**: usate canali diversi per simulare frequenze operative differenti

---

## ❓ Troubleshooting

**Il microfono non funziona**
→ Il browser chiede il permesso al primo accesso. Cerca l'icona 🔒 in alto a sinistra e abilita il microfono.

**"Nominativo già in uso"**
→ Un altro volontario ha già usato quel callsign nella stessa stanza. Cambia nominativo.

**Audio distorto o assente**
→ Ricarica la pagina (Ctrl+F5 su PC) per essere sicuro di avere l'ultima versione. Verifica che lo slider VOLUME RICEZIONE non sia a zero e che il volume del dispositivo/browser sia alto.
→ Su Safari iOS: tocca un punto qualsiasi della pagina dopo essere entrato nel canale per sbloccare l'audio. Disattiva la modalità silenzioso del telefono.
→ Se non si sente nulla con 2+ utenti: aprire la console (F12 su PC) e cercare errori in rosso — segnalali per supporto.

**"Codice di accesso non valido" anche se è giusto**
→ Verifica che la variabile su Railway non abbia spazi accidentali a inizio/fine quando l'hai incollata. Le password sono case-sensitive. Dopo 5 tentativi errati il server blocca l'IP per 60 secondi (rate limit anti brute-force).

**Latenza alta**
→ WebRTC usa STUN per connettersi direttamente. In rari casi (firewall aziendali) serve un server TURN — contattaci per la configurazione.
