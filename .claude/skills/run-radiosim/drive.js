// Driver end-to-end del protocollo RadioSim: PTT, admin, limiti, auth.
const WebSocket = require('ws');
const URL = 'ws://localhost:3210';
let pass = 0, fail = 0;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  ok ? pass++ : fail++;
};

function client(label) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex(w => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    label, ws,
    open: () => new Promise(r => ws.on('open', r)),
    send: o => ws.send(JSON.stringify(o)),
    // Attende un messaggio che soddisfa match (anche se già arrivato).
    want(match, timeout = 3000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => {
          // Rimuove il waiter scaduto: altrimenti intercetta messaggi futuri
          const j = waiters.indexOf(w);
          if (j >= 0) waiters.splice(j, 1);
          reject(new Error(`${label}: timeout attesa messaggio`));
        }, timeout);
      });
    },
    close: () => ws.close(),
  };
}

const byType = t => m => m.type === t;

(async () => {
  // 1 — password sbagliata
  const bad = client('BAD');
  await bad.open();
  bad.send({ type: 'join', callsign: 'PIPPO', room: 'SALA-ALPHA', channel: '1', password: 'sbagliata' });
  let m = await bad.want(byType('error'));
  check('password errata rifiutata', m.code === 'WRONG_PASSWORD', m.code);
  bad.close();

  // 2 — stanza non in whitelist ROOMS
  const badRoom = client('BADROOM');
  await badRoom.open();
  badRoom.send({ type: 'join', callsign: 'PIPPO', room: 'SALA-INESISTENTE', channel: '1', password: 'test123' });
  m = await badRoom.want(byType('error'));
  check('stanza fuori whitelist rifiutata', m.code === 'INVALID_ROOM', m.code);
  badRoom.close();

  // 3 — join valido A
  const a = client('A');
  await a.open();
  a.send({ type: 'join', callsign: 'ALFA-1', room: 'SALA-ALPHA', channel: '1', password: 'test123' });
  const joinedA = await a.want(byType('joined'));
  check('join valido ALFA-1', joinedA.callsign === 'ALFA-1' && joinedA.isAdmin === false, `id=${joinedA.id.slice(0, 8)}`);

  // 4 — join valido B + notifica ad A
  const b = client('B');
  await b.open();
  b.send({ type: 'join', callsign: 'BRAVO-2', room: 'SALA-ALPHA', channel: '1', password: 'test123' });
  const joinedB = await b.want(byType('joined'));
  const notify = await a.want(byType('user_joined'));
  check('join BRAVO-2 + notifica ad ALFA-1', notify.callsign === 'BRAVO-2' && joinedB.users.length === 2, `${joinedB.users.length} utenti sul canale`);

  // 5 — nominativo duplicato
  const dup = client('DUP');
  await dup.open();
  dup.send({ type: 'join', callsign: 'ALFA-1', room: 'SALA-ALPHA', channel: '1', password: 'test123' });
  m = await dup.want(byType('error'));
  check('nominativo duplicato rifiutato', m.code === 'CALLSIGN_TAKEN', m.code);
  dup.close();

  // 6 — PTT: A trasmette, B riceve lo start
  a.send({ type: 'ptt_start' });
  const txA = await a.want(byType('ptt_start'));
  const rxB = await b.want(byType('ptt_start'));
  check('PTT start propagato a entrambi', txA.callsign === 'ALFA-1' && rxB.callsign === 'ALFA-1');

  // 7 — canale occupato: B non può trasmettere
  b.send({ type: 'ptt_start' });
  m = await b.want(byType('ptt_denied'));
  check('canale occupato → ptt_denied', m.reason === 'CHANNEL_BUSY' && m.speaker === 'ALFA-1', `speaker=${m.speaker}`);

  // 8 — /status riflette il TX in corso
  const st = await (await fetch('http://localhost:3210/status')).json();
  const room = st['SALA-ALPHA__CH1'];
  check('/status mostra TX in corso', room && room.currentTx === 'ALFA-1' && room.users.length === 2, JSON.stringify(room));

  // 9 — stop PTT
  a.send({ type: 'ptt_stop' });
  m = await b.want(byType('ptt_stop'));
  check('PTT stop propagato', m.callsign === 'ALFA-1');

  // 10 — admin: password errata
  const badAdmin = client('BADADM');
  await badAdmin.open();
  badAdmin.send({ type: 'join', callsign: 'COORD', room: 'SALA-ALPHA', channel: '1', adminPassword: 'nope' });
  m = await badAdmin.want(byType('error'));
  check('admin con password errata rifiutato', m.code === 'WRONG_ADMIN_PASSWORD', m.code);
  badAdmin.close();

  // 11 — admin valido (secondo callsign della lista CSV)
  const adm = client('ADM');
  await adm.open();
  adm.send({ type: 'join', callsign: 'COORD', room: 'SALA-ALPHA', channel: '1', adminPassword: 'admin123' });
  const joinedAdm = await adm.want(byType('joined'));
  check('admin COORD (lista CSV) autenticato', joinedAdm.isAdmin === true);

  // 12 — limite MAX_USERS_PER_CHANNEL=3
  const full = client('FULL');
  await full.open();
  full.send({ type: 'join', callsign: 'DELTA-4', room: 'SALA-ALPHA', channel: '1', password: 'test123' });
  m = await full.want(byType('error'));
  check('4° utente bloccato da MAX_USERS_PER_CHANNEL=3', m.code === 'CHANNEL_FULL', m.code);
  full.close();

  // 13 — admin kill TX
  await b.want(byType('user_joined')).catch(() => {});
  b.send({ type: 'ptt_start' });
  await b.want(byType('ptt_start'));
  adm.send({ type: 'admin_kill_tx' });
  m = await b.want(byType('ptt_stop'));
  check('admin sblocca il canale', m.forcedBy === 'COORD' && m.callsign === 'BRAVO-2', `forcedBy=${m.forcedBy}`);

  // 14 — signaling WebRTC inoltrato al destinatario giusto
  a.send({ type: 'offer', targetId: joinedB.id, sdp: 'FAKE-SDP' });
  m = await b.want(byType('offer'));
  check('offer WebRTC inoltrata a destinatario', m.sdp === 'FAKE-SDP' && m.fromCallsign === 'ALFA-1');

  // 15 — rejoin entro la finestra di grazia: nessun user_left per gli altri
  a.close();
  await new Promise(r => setTimeout(r, 1000));
  const a2 = client('A2');
  await a2.open();
  a2.send({ type: 'join', callsign: 'ALFA-1', room: 'SALA-ALPHA', channel: '1', password: 'test123' });
  const rejoined = await a2.want(byType('joined'));
  const leaked = await b.want(byType('user_left'), 1500).catch(() => null);
  check('rejoin entro grazia 10s senza user_left', rejoined.callsign === 'ALFA-1' && leaked === null,
        leaked ? 'user_left spurio!' : 'rejoin silenzioso');

  // 16 — disconnessione definitiva dopo la finestra di grazia (10 s)
  a2.close();
  m = await b.want(byType('user_left'), 14000);
  check('user_left dopo scadenza grazia', m.callsign === 'ALFA-1', `${m.users.length} utenti rimasti`);

  b.close(); adm.close();
  await new Promise(r => setTimeout(r, 300));
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRORE DRIVER:', e.message); process.exit(2); });
