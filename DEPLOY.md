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

### PASSO 4 — Condividi con i volontari

Invia ai volontari il link Railway. Niente da installare:
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
→ Ricarica la pagina. Su Safari iOS potrebbe servire un tap sulla pagina prima che l'audio si attivi.

**Latenza alta**
→ WebRTC usa STUN per connettersi direttamente. In rari casi (firewall aziendali) serve un server TURN — contattaci per la configurazione.
