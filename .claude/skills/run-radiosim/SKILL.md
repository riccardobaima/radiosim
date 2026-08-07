---
name: run-radiosim
description: Avvia RadioSim in locale e verifica che funzioni — server WebSocket, endpoint HTTP, protocollo PTT/admin e UI in browser. Usa questa skill quando ti viene chiesto di avviare, far girare, testare o fare screenshot dell'app, o di confermare che una modifica funziona davvero (non solo che compila).
---

# Avviare e verificare RadioSim

App = server Node (Express + `ws`) che serve `public/` e fa signaling WebRTC.
L'audio è P2P: **il server non vede mai l'audio**, quindi verificare il server
non verifica l'audio. Vedi "Cosa NON è verificabile" in fondo.

## 1. Avvio

Le dipendenze sono già in `node_modules/` (Node ≥ 18; testato su 24.14.1).
Se manca, `npm install`.

Avvia in **background**, su una porta non standard per non collidere con altro:

```bash
PORT=3210 ACCESS_PASSWORD=test123 ADMIN_PASSWORD=admin123 \
ADMIN_CALLSIGNS=ADMIN,COORD MAX_USERS_PER_CHANNEL=3 \
ROOMS=SALA-ALPHA,SALA-BRAVO node server/index.js
```

Passa **tutte** queste env: senza `ACCESS_PASSWORD` il server parte in dev mode
ad accesso libero e i percorsi auth non vengono esercitati. Boot atteso:

```
[VERSION] 1.5.15
[AUTH] Codice di accesso ATTIVO
[ADMIN] Funzione admin ATTIVA (callsigns: ADMIN, COORD)
[LIMIT] Max 3 utenti per canale
[ROOMS] Stanze disponibili: SALA-ALPHA, SALA-BRAVO
```

Il log del server è la fonte di verità migliore: `[JOIN]`, `[TX START]`,
`[ADMIN KILL]`, `[REJOIN]`, `[LEAVE pending]` / `[LEAVE final]`. Leggilo
sempre insieme all'esito dei test.

## 2. Smoke HTTP

```bash
curl -s localhost:3210/health   # {"status":"ok","version":...,"rooms":N,"uptime":N}
curl -s localhost:3210/version
curl -s localhost:3210/rooms    # deve riflettere la env ROOMS
curl -s localhost:3210/status   # {} a vuoto; con utenti: {"SALA-ALPHA__CH1":{users,currentTx}}
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" localhost:3210/
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" localhost:3210/manuale.html
```

## 3. Driver del protocollo WebSocket

`drive.js` (accanto a questo file) apre client `ws` reali e copre 16 casi:
auth, whitelist stanze, duplicati, PTT + canale occupato, `/status` durante TX,
admin kill, limite utenti, signaling WebRTC, grazia di riconnessione.

```bash
NODE_PATH="$PWD/node_modules" node .claude/skills/run-radiosim/drive.js
```

`NODE_PATH` serve solo se lo esegui da fuori la root del progetto. Atteso:
`16 passati, 0 falliti` (exit 0). Se tocchi il protocollo, estendi `drive.js`.

### Trappole che fanno fallire i test senza che ci sia un bug

- **Grazia di riconnessione 10 s** (`PENDING_RECONNECT_MS`): alla chiusura di un
  socket il server NON emette subito `user_left` — aspetta 10 s per permettere un
  rejoin silenzioso. Ogni attesa su `user_left` va oltre i 10 s (usa 14000 ms).
- **Rate limit 5 tentativi falliti / 60 s per IP**: un giro completo del driver
  brucia 2 tentativi (password errata + admin errata). Più di 2 rerun ravvicinati
  → `RATE_LIMIT` al posto del codice atteso. Riavvia il server per azzerare
  (lo stato è in memoria).
- Le stanze sono su **whitelist**: un `room` fuori da `ROOMS` viene rifiutato con
  `INVALID_ROOM`, non accettato come testo libero.
- Attenzione ai waiter scaduti se scrivi un driver tuo: vanno rimossi dalla coda
  al timeout, altrimenti intercettano i messaggi successivi e il test seguente
  va in timeout su un messaggio che il server ha davvero inviato.

## 4. UI in browser

Apri `http://localhost:3210` con gli strumenti `claude-in-chrome` e **guarda lo
screenshot**. Sequenza per arrivare al canale:

1. Compila NOMINATIVO (`ALFA-1`) e CODICE ACCESSO (`test123`), clicca
   **ENTRA SUL CANALE**.
2. Compare il dialog in-page **PERMESSO MICROFONO** → clicca **HO CAPITO**.
3. Parte il prompt nativo Chrome del microfono. È UI del browser, **non
   cliccabile via automazione**: se il permesso non è già memorizzato per
   `localhost`, la UI resta su "CONNESSIONE IN CORSO..." e serve l'utente.
   Il join WS però è già avvenuto — verificalo nel log server e su `/status`.
4. A permesso concesso: pill **IN RETE**, "Microfono pronto", CANALE LIBERO.
5. Clicca il PTT → LOG CANALE mostra `TRASMISSIONE IN CORSO` + `fine
   trasmissione`, il server logga `[TX START]` / `[TX STOP]`.

Da controllare a vista: versione nell'header allineata a `package.json`, logo FIR,
select STANZA popolata da `ROOMS`, `/manuale.html` che renderizza.

## 5. Chiusura

Ferma il processo in background quando hai finito: il server resta in ascolto e
la porta 3210 resta occupata per il giro successivo.

## Cosa NON è verificabile così

**Audio reale.** WebRTC è peer-to-peer: serve un secondo dispositivo con
microfono vero. Il driver verifica che l'`offer` sia instradata al destinatario
giusto, non che l'audio si senta. Idem per roger beep, effetto radio e slider
volume: vanno provati a mano, in due.
