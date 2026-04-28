/**
 * RadioSim — Server WebSocket
 * Gestisce canali radio virtuali con logica PTT e segnalazione WebRTC
 */

const express = require('express');
const http    = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT            = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const AUTH_ENABLED    = ACCESS_PASSWORD.length > 0;

if (AUTH_ENABLED) console.log('[AUTH] Codice di accesso ATTIVO');
else              console.log('[AUTH] Nessun codice — accesso libero (dev mode)');

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
// Stato globale
// rooms[roomKey] = {
//   channel: '1',
//   clients: Map<ws, { id, callsign, room, channel }>,
//   currentTx: null   // callsign di chi sta trasmettendo
// }
// ─────────────────────────────────────────────
const rooms = new Map();

function getRoomKey(room, channel) {
  return `${room}__CH${channel}`;
}

function getOrCreateRoom(room, channel) {
  const key = getRoomKey(room, channel);
  if (!rooms.has(key)) {
    rooms.set(key, { channel, clients: new Map(), currentTx: null });
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
    callsign: m.callsign
  }));
}

// ─────────────────────────────────────────────
// WebSocket handler
// ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let meta = null;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket.remoteAddress
           || 'unknown';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── JOIN ───────────────────────────────
      case 'join': {
        const { callsign, room, channel, password } = msg;
        if (!callsign || !room || !channel) return;

        if (AUTH_ENABLED) {
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

        meta = { id: uuidv4(), callsign, room, channel };
        const r = getOrCreateRoom(room, channel);

        // Controlla nominativo duplicato
        let nameConflict = false;
        r.clients.forEach(m => {
          if (m.callsign === callsign) nameConflict = true;
        });
        if (nameConflict) {
          ws.send(JSON.stringify({ type: 'error', code: 'CALLSIGN_TAKEN',
            message: `Il nominativo ${callsign} è già in uso su questo canale.` }));
          return;
        }

        r.clients.set(ws, meta);

        // Conferma al nuovo utente
        ws.send(JSON.stringify({
          type: 'joined',
          id: meta.id,
          callsign,
          channel,
          room,
          users: getUserList(room, channel),
          currentTx: r.currentTx
        }));

        // Notifica agli altri
        broadcast(room, channel, {
          type: 'user_joined',
          id: meta.id,
          callsign,
          users: getUserList(room, channel)
        }, ws);

        console.log(`[JOIN] ${callsign} → stanza:${room} canale:${channel} (${r.clients.size} utenti)`);
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
        console.log(`[TX START] ${meta.callsign}`);

        // Notifica a tutti (incluso il mittente per conferma)
        broadcastAll(room, channel, {
          type: 'ptt_start',
          callsign: meta.callsign,
          id: meta.id
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
        console.log(`[TX STOP] ${meta.callsign}`);

        broadcastAll(room, channel, {
          type: 'ptt_stop',
          callsign: meta.callsign
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
  ws.on('close', () => {
    if (!meta) return;
    const { room, channel, callsign } = meta;
    const key = getRoomKey(room, channel);
    const r = rooms.get(key);
    if (!r) return;

    r.clients.delete(ws);
    if (r.currentTx === callsign) r.currentTx = null;

    console.log(`[LEAVE] ${callsign} (${r.clients.size} rimasti)`);

    broadcast(room, channel, {
      type: 'user_left',
      callsign,
      id: meta.id,
      users: getUserList(room, channel)
    });

    // Pulisci stanza vuota
    if (r.clients.size === 0) {
      rooms.delete(key);
      console.log(`[ROOM] Stanza ${key} rimossa (vuota)`);
    }
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
  rooms: rooms.size,
  uptime: Math.floor(process.uptime())
}));

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
