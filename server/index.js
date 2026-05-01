/**
 * RadioSim — Server WebSocket
 * Gestisce canali radio virtuali con logica PTT e segnalazione WebRTC
 */

const express = require('express');
const http    = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');

// Versione app: letta da package.json, da bumpare manualmente ad ogni commit
const APP_VERSION = require('../package.json').version;
console.log(`[VERSION] ${APP_VERSION}`);

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT            = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const AUTH_ENABLED    = ACCESS_PASSWORD.length > 0;
const ADMIN_CALLSIGN  = (process.env.ADMIN_CALLSIGN || 'ADMIN').toUpperCase();
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '';
const ADMIN_ENABLED   = ADMIN_PASSWORD.length > 0;
// Limite utenti per canale (per stanza). 0 o assente = illimitato.
const MAX_USERS_PER_CHANNEL = Math.max(0, parseInt(process.env.MAX_USERS_PER_CHANNEL || '0', 10));
// Finestra di grazia per la riconnessione: dopo close, l'utente resta
// "in pending" per N ms. Se entro quel tempo rifa join con stesso
// callsign+stanza+canale dallo stesso IP, sopprimiamo il broadcast di
// user_left e user_joined e manteniamo lo stesso id server-side.
const PENDING_RECONNECT_MS = 10000;

if (AUTH_ENABLED)  console.log('[AUTH] Codice di accesso ATTIVO');
else               console.log('[AUTH] Nessun codice — accesso libero (dev mode)');
if (ADMIN_ENABLED) console.log(`[ADMIN] Funzione admin ATTIVA (callsign: ${ADMIN_CALLSIGN})`);
else               console.log('[ADMIN] Funzione admin DISATTIVATA (manca ADMIN_PASSWORD)');
if (MAX_USERS_PER_CHANNEL > 0) console.log(`[LIMIT] Max ${MAX_USERS_PER_CHANNEL} utenti per canale`);
else                           console.log('[LIMIT] Nessun limite utenti per canale');

// ─────────────────────────────────────────────
// Rate limit per password sbagliate (per IP)
// ─────────────────────────────────────────────
const RL_MAX        = 5;          // tentativi falliti
const RL_WINDOW_MS  = 60_000;     // finestra di 60 s
const failedAttempts = new Map(); // ip -> { count, resetAt }

function checkRate(ip) {
  const now = Date.now();
  const e = failedAttempts.get(ip);
  if (!e || now > e.resetAt) return true;
  return e.count < RL_MAX;
}
function recordFail(ip) {
  const now = Date.now();
  const e = failedAttempts.get(ip);
  if (!e || now > e.resetAt) failedAttempts.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
  else e.count++;
}
// Pulizia periodica
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of failedAttempts) if (now > e.resetAt) failedAttempts.delete(ip);
}, RL_WINDOW_MS);

// ─────────────────────────────────────────────
// Validazione input — allineata ai limiti del client
// (callsign maxlength 12, room maxlength 24, charset A-Z0-9-_)
// Il client viene reso in innerHTML, quindi qui ci difendiamo da
// payload manomessi che possano contenere HTML/script.
// ─────────────────────────────────────────────
const CALLSIGN_RE = /^[A-Z0-9_-]{2,12}$/;
const ROOM_RE     = /^[A-Z0-9_-]{1,24}$/;
const VALID_CHANNELS = new Set(['1', '2', '3', '4']);

function validateJoin(callsign, room, channel) {
  if (typeof callsign !== 'string' || !CALLSIGN_RE.test(callsign)) {
    return 'Nominativo non valido (2-12 caratteri: A-Z, 0-9, - _).';
  }
  if (typeof room !== 'string' || !ROOM_RE.test(room)) {
    return 'Stanza non valida (max 24 caratteri: A-Z, 0-9, - _).';
  }
  if (!VALID_CHANNELS.has(String(channel))) {
    return 'Canale non valido.';
  }
  return null;
}

// ─────────────────────────────────────────────
// Stato globale
// rooms[roomKey] = {
//   channel: '1',
//   clients: Map<ws, { id, callsign, room, channel }>,
//   currentTx: null,   // callsign di chi sta trasmettendo
//   currentTxId: null  // id (uuid) di chi sta trasmettendo, per inviarlo al client
// }
// ─────────────────────────────────────────────
const rooms = new Map();

function getRoomKey(room, channel) {
  return `${room}__CH${channel}`;
}

function getOrCreateRoom(room, channel) {
  const key = getRoomKey(room, channel);
  if (!rooms.has(key)) {
    rooms.set(key, { channel, clients: new Map(), currentTx: null, currentTxId: null });
  }
  return rooms.get(key);
}

function broadcast(room, channel, payload, excludeWs = null) {
  const key = getRoomKey(room, channel);
  const r = rooms.get(key);
  if (!r) return;
  const msg = JSON.stringify(payload);
  r.clients.forEach((meta, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function broadcastAll(room, channel, payload) {
  broadcast(room, channel, payload, null);
}

function getUserList(room, channel) {
  const key = getRoomKey(room, channel);
  const r = rooms.get(key);
  if (!r) return [];
  return Array.from(r.clients.values()).map(m => ({
    id: m.id,
    callsign: m.callsign,
    isAdmin: !!m.isAdmin
  }));
}

// ─────────────────────────────────────────────
// Heartbeat — drop dei client zombie via PING/PONG di protocollo WS
// (es. dispositivo mobile sospeso: il TCP resta semi-aperto per ore se
// non controllato attivamente). Latenza di rilevamento: 30-60 s.
// ─────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 30000;
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[HEARTBEAT] Client non risponde — drop');
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL_MS);
wss.on('close', () => clearInterval(heartbeatInterval));

// ─────────────────────────────────────────────
// WebSocket handler
// ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let meta = null;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket.remoteAddress
           || 'unknown';

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── JOIN ───────────────────────────────
      case 'join': {
        const { callsign, room, channel, password, adminPassword } = msg;
        if (!callsign || !room || !channel) return;

        const validationError = validateJoin(callsign, room, channel);
        if (validationError) {
          console.log(`[VALIDATE] Join rifiutato da ${ip}: ${validationError}`);
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_INPUT',
            message: validationError }));
          return;
        }

        const isAdminCallsign = callsign.toUpperCase() === ADMIN_CALLSIGN;
        let isAdmin = false;

        if (isAdminCallsign) {
          // Percorso admin: richiede ADMIN_PASSWORD (sostituisce il codice utente)
          if (!ADMIN_ENABLED) {
            ws.send(JSON.stringify({ type: 'error', code: 'ADMIN_DISABLED',
              message: 'Funzione admin non configurata sul server.' }));
            return;
          }
          if (!checkRate(ip)) {
            ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMIT',
              message: 'Troppi tentativi. Attendi un minuto e riprova.' }));
            return;
          }
          if (adminPassword !== ADMIN_PASSWORD) {
            recordFail(ip);
            console.log(`[ADMIN] Tentativo fallito da ${ip}`);
            ws.send(JSON.stringify({ type: 'error', code: 'WRONG_ADMIN_PASSWORD',
              message: 'Codice admin non valido.' }));
            return;
          }
          isAdmin = true;
        } else if (AUTH_ENABLED) {
          // Percorso utente normale
          if (!checkRate(ip)) {
            ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMIT',
              message: 'Troppi tentativi. Attendi un minuto e riprova.' }));
            return;
          }
          if (password !== ACCESS_PASSWORD) {
            recordFail(ip);
            console.log(`[AUTH] Tentativo fallito da ${ip} (callsign: ${callsign})`);
            ws.send(JSON.stringify({ type: 'error', code: 'WRONG_PASSWORD',
              message: 'Codice di accesso non valido.' }));
            return;
          }
        }

        const r = getOrCreateRoom(room, channel);

        // Cerca un eventuale client in attesa di rejoin con stesso callsign
        let pendingEntry = null;
        r.clients.forEach((m, prevWs) => {
          if (m.callsign === callsign && m.pendingClose) {
            pendingEntry = { meta: m, ws: prevWs };
          }
        });

        if (pendingEntry) {
          // Stesso IP → riconnessione legittima. IP diverso → collisione, rifiuta.
          if (pendingEntry.meta.ip !== ip) {
            console.log(`[REJOIN] Rifiutato: ${callsign} è in pending da IP ${pendingEntry.meta.ip}, richiesta da ${ip}`);
            ws.send(JSON.stringify({ type: 'error', code: 'CALLSIGN_TAKEN',
              message: `Il nominativo ${callsign} è già in uso su questo canale.` }));
            return;
          }
          // Cancella timer di leave e sostituisci ws mantenendo lo stesso id
          if (pendingEntry.meta.closeTimer) clearTimeout(pendingEntry.meta.closeTimer);
          pendingEntry.meta.pendingClose = false;
          pendingEntry.meta.closeTimer = null;
          r.clients.delete(pendingEntry.ws);
          meta = pendingEntry.meta;
          r.clients.set(ws, meta);

          ws.send(JSON.stringify({
            type: 'joined',
            id: meta.id,
            callsign, channel, room,
            isAdmin: meta.isAdmin,
            users: getUserList(room, channel),
            currentTx: r.currentTx
          }));
          // Niente broadcast user_joined: per gli altri client è una transizione invisibile
          console.log(`[REJOIN] ${callsign} riconnesso silenziosamente (id mantenuto: ${meta.id})`);
          break;
        }

        // Controllo capienza canale (gli admin entrano sempre, anche se pieno)
        if (!isAdmin && MAX_USERS_PER_CHANNEL > 0 && r.clients.size >= MAX_USERS_PER_CHANNEL) {
          console.log(`[LIMIT] Canale ${room}__CH${channel} pieno (${r.clients.size}/${MAX_USERS_PER_CHANNEL}) — rifiutato ${callsign}`);
          ws.send(JSON.stringify({ type: 'error', code: 'CHANNEL_FULL',
            message: `Canale pieno: massimo ${MAX_USERS_PER_CHANNEL} utenti per canale. Prova un altro canale.` }));
          return;
        }

        // Controlla nominativo duplicato (su client già attivi, non in pending)
        let nameConflict = false;
        r.clients.forEach(m => {
          if (m.callsign === callsign) nameConflict = true;
        });
        if (nameConflict) {
          ws.send(JSON.stringify({ type: 'error', code: 'CALLSIGN_TAKEN',
            message: `Il nominativo ${callsign} è già in uso su questo canale.` }));
          return;
        }

        meta = { id: uuidv4(), callsign, room, channel, isAdmin, ip, pendingClose: false, closeTimer: null };

        r.clients.set(ws, meta);

        // Conferma al nuovo utente
        ws.send(JSON.stringify({
          type: 'joined',
          id: meta.id,
          callsign,
          channel,
          room,
          isAdmin,
          users: getUserList(room, channel),
          currentTx: r.currentTx
        }));

        // Notifica agli altri
        broadcast(room, channel, {
          type: 'user_joined',
          id: meta.id,
          callsign,
          isAdmin,
          users: getUserList(room, channel)
        }, ws);

        console.log(`[JOIN] ${callsign}${isAdmin ? ' (ADMIN)' : ''} → stanza:${room} canale:${channel} (${r.clients.size} utenti)`);
        break;
      }

      // ── PTT START ──────────────────────────
      case 'ptt_start': {
        if (!meta) return;
        const { room, channel } = meta;
        const r = rooms.get(getRoomKey(room, channel));
        if (!r) return;

        // Se canale occupato da altri, rifiuta
        if (r.currentTx && r.currentTx !== meta.callsign) {
          ws.send(JSON.stringify({ type: 'ptt_denied',
            reason: 'CHANNEL_BUSY', speaker: r.currentTx }));
          return;
        }

        r.currentTx = meta.callsign;
        r.currentTxId = meta.id;
        console.log(`[TX START] ${meta.callsign}`);

        // Notifica a tutti (incluso il mittente per conferma)
        broadcastAll(room, channel, {
          type: 'ptt_start',
          callsign: meta.callsign,
          id: meta.id
        });
        break;
      }

      // ── ADMIN KILL TX ──────────────────────
      // Solo admin: forza il rilascio del PTT in corso sulla stanza/canale
      case 'admin_kill_tx': {
        if (!meta || !meta.isAdmin) return;
        const { room, channel } = meta;
        const r = rooms.get(getRoomKey(room, channel));
        if (!r || !r.currentTx) return;

        const previousTx = r.currentTx;
        const previousTxId = r.currentTxId;
        r.currentTx = null;
        r.currentTxId = null;
        console.log(`[ADMIN KILL] ${meta.callsign} ha sbloccato il canale (era: ${previousTx})`);

        broadcastAll(room, channel, {
          type: 'ptt_stop',
          callsign: previousTx,
          id: previousTxId,
          forcedBy: meta.callsign
        });
        break;
      }

      // ── PTT STOP ───────────────────────────
      case 'ptt_stop': {
        if (!meta) return;
        const { room, channel } = meta;
        const r = rooms.get(getRoomKey(room, channel));
        if (!r) return;
        if (r.currentTx !== meta.callsign) return;

        r.currentTx = null;
        r.currentTxId = null;
        console.log(`[TX STOP] ${meta.callsign}`);

        broadcastAll(room, channel, {
          type: 'ptt_stop',
          callsign: meta.callsign,
          id: meta.id
        });
        break;
      }

      // ── WEBRTC SIGNALING ───────────────────
      // offer / answer / ice-candidate → inoltro al destinatario
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!meta) return;
        const { room, channel } = meta;
        const r = rooms.get(getRoomKey(room, channel));
        if (!r) return;

        // Cerca il destinatario per ID
        r.clients.forEach((m, destWs) => {
          if (m.id === msg.targetId && destWs.readyState === WebSocket.OPEN) {
            destWs.send(JSON.stringify({ ...msg, fromId: meta.id, fromCallsign: meta.callsign }));
          }
        });
        break;
      }

      // ── LEAVE (logout esplicito) ───────────
      // Niente grazia di riconnessione: cleanup immediato + broadcast user_left.
      case 'leave': {
        if (!meta) return;
        const { room, channel, callsign } = meta;
        const r = rooms.get(getRoomKey(room, channel));
        if (!r) return;
        if (meta.closeTimer) { clearTimeout(meta.closeTimer); meta.closeTimer = null; }
        meta.pendingClose = false;
        r.clients.delete(ws);
        if (r.currentTx === callsign) { r.currentTx = null; r.currentTxId = null; }
        console.log(`[LEAVE explicit] ${callsign} (${r.clients.size} rimasti)`);
        broadcast(room, channel, {
          type: 'user_left', callsign, id: meta.id,
          users: getUserList(room, channel)
        });
        if (r.clients.size === 0) {
          rooms.delete(getRoomKey(room, channel));
          console.log(`[ROOM] Stanza ${getRoomKey(room, channel)} rimossa (vuota)`);
        }
        meta = null;
        try { ws.close(); } catch {}
        break;
      }

      // ── CHAT (opzionale) ───────────────────
      case 'chat': {
        if (!meta) return;
        broadcast(meta.room, meta.channel, {
          type: 'chat',
          callsign: meta.callsign,
          text: String(msg.text).slice(0, 200),
          ts: Date.now()
        });
        break;
      }
    }
  });

  // ── DISCONNESSIONE ─────────────────────────
  // Apre una finestra di grazia: per PENDING_RECONNECT_MS l'utente resta
  // in r.clients con flag pendingClose, in modo che gli altri continuino
  // a vederlo nella lista. Se entro la finestra arriva un nuovo join con
  // stesso callsign+room+channel dallo stesso IP, il rejoin è silenzioso.
  // Altrimenti scade il timer e si emette user_left "vero".
  ws.on('close', () => {
    if (!meta) return;
    const { room, channel, callsign } = meta;
    const key = getRoomKey(room, channel);
    const r = rooms.get(key);
    if (!r) return;

    // Se la TX era questo utente, libera comunque subito il canale
    if (r.currentTx === callsign) { r.currentTx = null; r.currentTxId = null; }

    meta.pendingClose = true;
    console.log(`[LEAVE pending] ${callsign} — grazia ${PENDING_RECONNECT_MS}ms`);

    meta.closeTimer = setTimeout(() => {
      // Se nel frattempo c'è stato rejoin, pendingClose è già false: skip.
      if (!meta.pendingClose) return;
      r.clients.delete(ws);
      console.log(`[LEAVE final] ${callsign} (${r.clients.size} rimasti)`);
      broadcast(room, channel, {
        type: 'user_left',
        callsign,
        id: meta.id,
        users: getUserList(room, channel)
      });
      if (r.clients.size === 0) {
        rooms.delete(key);
        console.log(`[ROOM] Stanza ${key} rimossa (vuota)`);
      }
    }, PENDING_RECONNECT_MS);
  });

  ws.on('error', (err) => console.error('[WS ERROR]', err.message));
});

// ─────────────────────────────────────────────
// Static files (frontend)
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// Health check per Railway
app.get('/health', (_, res) => res.json({
  status: 'ok',
  version: APP_VERSION,
  rooms: rooms.size,
  uptime: Math.floor(process.uptime())
}));

// Versione corrente — usata dal frontend per mostrare la build attiva
app.get('/version', (_, res) => res.json({ version: APP_VERSION }));

// Rooms status (debug)
app.get('/status', (_, res) => {
  const data = {};
  rooms.forEach((r, key) => {
    data[key] = {
      users: Array.from(r.clients.values()).map(m => m.callsign),
      currentTx: r.currentTx
    };
  });
  res.json(data);
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎙  RadioSim Server avviato su porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   App:    http://localhost:${PORT}\n`);
});
