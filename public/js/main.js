import { TICK } from '/shared/sim.js';
import { ROBOTS, ROBOT_IDS, getRobotConfig, sanitizeMods, modsLabel, randomMods, MECHS, TEAM_LOCKS } from '/shared/robots.js';
import { SceneView } from './render/scene.js';
import { Input } from './input.js';
import { Hud, renderResults } from './hud.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { LocalSession, NetSession } from './session.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['menu', 'practice', 'lobby', 'pause', 'results', 'modal'];

// ------------------------------------------------------------------ persistent settings
const DEFAULTS = { name: '', team: '', robot: 'team', camera: 'chase', quality: 'high', fieldOriented: true, autoStow: true, minimap: true, sound: true };
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('hh-settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
function saveSettings() {
  try {
    localStorage.setItem('hh-settings', JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

// ------------------------------------------------------------------ core objects
const scene = new SceneView($('view'));
const input = new Input();
const hud = new Hud();
const audio = new Audio();
const net = new Net();
scene.setQuality(settings.quality);
audio.enabled = settings.sound;
hud.showMinimap = settings.minimap;

const app = {
  session: null,
  room: null,
  paused: false,
  resultsShown: false,
  overlayReturn: null,
};

// ------------------------------------------------------------------ screens
function show(screen) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== screen);
}
function inMatch() {
  return !!app.session;
}

// ------------------------------------------------------------------ profile (menu)
const robotSel = $('in-robot');
for (const id of ROBOT_IDS) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = ROBOTS[id].name;
  robotSel.appendChild(o);
}
$('in-name').value = settings.name;
$('in-team').value = settings.team;
robotSel.value = ROBOTS[settings.robot] ? settings.robot : 'team';
const updateBlurb = () => ($('robot-blurb').textContent = getRobotConfig(robotSel.value).blurb || '');
updateBlurb();
// mechanism configuration
const readMods = () => sanitizeMods({ ground: $('cfg-ground').checked, depot: $('cfg-depot').checked, ramp: $('cfg-ramp').checked, maxLevel: Number($('cfg-level').value), mech: $('cfg-mech').value });
const CFG_IDS = ['cfg-ground', 'cfg-depot', 'cfg-ramp', 'cfg-level', 'cfg-mech'];
const writeMods = (m) => {
  // some team numbers come with a locked build (e.g. 526)
  const lock = TEAM_LOCKS[$('in-team').value.trim()];
  for (const id of CFG_IDS) $(id).disabled = !!lock;
  const md = sanitizeMods(lock || m);
  if (lock && ![...$('cfg-mech').options].some((o) => o.value === md.mech)) $('cfg-mech').add(new Option(`Team ${$('in-team').value.trim()} build (locked)`, md.mech));
  $('cfg-ground').checked = md.ground;
  $('cfg-depot').checked = md.depot;
  $('cfg-ramp').checked = md.ramp;
  $('cfg-level').value = String(md.maxLevel);
  $('cfg-mech').value = md.mech;
  $('cfg-summary').textContent = modsLabel(md) + (lock ? ' 🔒' : '');
};
writeMods(settings.mods);
for (const id of ['cfg-ground', 'cfg-depot', 'cfg-ramp', 'cfg-level', 'cfg-mech']) {
  $(id).addEventListener('change', () => {
    settings.mods = readMods();
    saveSettings();
    writeMods(settings.mods);
    if (net.connected) net.send({ t: 'robot', robot: robotSel.value, mods: settings.mods });
  });
}
const profile = () => ({
  name: $('in-name').value.trim() || 'Driver',
  team: $('in-team').value.replace(/\D/g, '').slice(0, 5),
  robot: robotSel.value,
  mods: TEAM_LOCKS[$('in-team').value.trim()] ? settings.mods : readMods(),
});
for (const el of [$('in-name'), $('in-team'), robotSel]) {
  el.addEventListener('change', () => {
    Object.assign(settings, profile());
    saveSettings();
    updateBlurb();
    writeMods(settings.mods);
    if (net.connected) {
      net.send({ t: 'hello', ...profile() });
      net.send({ t: 'robot', robot: robotSel.value, mods: readMods() });
    }
  });
}

// ------------------------------------------------------------------ buttons
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const act = b.dataset.action;
  const fn = actions[act];
  if (fn) fn(b);
});

const actions = {
  practice: () => {
    renderBotRows();
    show('practice');
  },
  'bots-random': () => {
    practiceBots = randomBots();
    renderBotRows();
  },
  back: () => show('menu'),
  'practice-start': () => {
    const p = profile();
    startLocal({
      alliance: $('pr-alliance').value,
      station: Number($('pr-station').value),
      robot: p.robot,
      mods: p.mods,
      name: p.name,
      team: p.team || '0000',
      allies: Number($('pr-allies').value),
      opps: Number($('pr-opps').value),
      skill: Number($('pr-skill').value),
      autoRamp: $('pr-autoramp').checked,
      officialRules: $('pr-official').checked,
      bots: structuredClone(practiceBots),
    });
  },
  quick: () => online({ t: 'quick' }),
  create: () => online({ t: 'create', isPublic: true }),
  'create-private': () => online({ t: 'create', isPublic: false }),
  join: () => {
    const code = $('in-code').value.trim().toUpperCase();
    if (code.length !== 4) return status('Enter a 4-letter room code');
    online({ t: 'join', code });
  },
  controls: () => openModal('tpl-controls'),
  rules: () => openModal('tpl-rules'),
  settings: () => openModal('tpl-settings'),
  'close-modal': () => closeModal(),
  resume: () => resume(),
  restart: () => {
    if (app.session?.local) {
      app.session.reset();
      beginMatchView();
    } else if (app.room?.host === net.id) net.send({ t: 'start' });
    resume();
  },
  quit: () => quitToMenu(),
  again: () => {
    if (app.session?.local) {
      app.session.reset();
      beginMatchView();
      return;
    }
    if (app.room?.host === net.id) net.send({ t: 'lobby' });
    else toLobby();
  },
  'copy-link': () => {
    const url = `${location.origin}/?room=${app.room?.code}`;
    navigator.clipboard?.writeText(url).then(
      () => addChat(null, 'Invite link copied'),
      () => addChat(null, url),
    );
  },
  leave: () => {
    net.send({ t: 'leave' });
    app.room = null;
    show('menu');
  },
  spectate: () => net.send({ t: 'slot', slot: 'spec' }),
  'fill-bots': () => net.send({ t: 'fillBots' }),
  start: () => net.send({ t: 'start' }),
  'take-slot': (b) => net.send({ t: 'slot', slot: b.dataset.slot }),
  'add-bot': (b) => net.send({ t: 'bot', slot: b.dataset.slot, add: true, robot: ['team', 'speedy', 'tank'][Math.floor(Math.random() * 3)] }),
  'remove-bot': (b) => net.send({ t: 'bot', slot: b.dataset.slot, add: false }),
  kick: (b) => net.send({ t: 'kick', pid: b.dataset.pid }),
};

// ------------------------------------------------------------------ practice bot builds
const POOL = ['team', 'speedy', 'tank'];
const randomBots = () => ({
  ally: [0, 1].map(() => ({ robot: POOL[Math.floor(Math.random() * 3)], mods: randomMods() })),
  opp: [0, 1, 2].map(() => ({ robot: POOL[Math.floor(Math.random() * 3)], mods: randomMods() })),
});
let practiceBots = randomBots();

function renderBotRows() {
  const box = $('pr-bots');
  box.innerHTML = '';
  const mine = $('pr-alliance').value;
  const other = mine === 'red' ? 'blue' : 'red';
  const rows = [
    ...practiceBots.ally.slice(0, Number($('pr-allies').value)).map((b, i) => ({ b, label: `Partner ${i + 1}`, a: mine })),
    ...practiceBots.opp.slice(0, Number($('pr-opps').value)).map((b, i) => ({ b, label: `Opponent ${i + 1}`, a: other })),
  ];
  if (!rows.length) box.innerHTML = '<p class="muted small">No bots — solo practice.</p>';
  for (const { b, label, a } of rows) {
    const md = sanitizeMods(b.mods);
    const row = document.createElement('div');
    row.className = `bot-row ${a}`;
    const opt = (v, t, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
    row.innerHTML = `
      <div class="top"><b>${label}</b>
        <select data-k="robot">${ROBOT_IDS.map((id) => opt(id, ROBOTS[id].name, id === b.robot)).join('')}</select>
        <button class="btn tiny ghost" data-k="dice" title="Random build">🎲</button></div>
      <details><summary>${esc(modsLabel(md))}</summary>
        <div class="config-grid">
          <label class="check"><input type="checkbox" data-k="ground" ${md.ground ? 'checked' : ''}/> Ground intake</label>
          <label class="check"><input type="checkbox" data-k="depot" ${md.depot ? 'checked' : ''}/> Depot intake</label>
          <label class="check"><input type="checkbox" data-k="ramp" ${md.ramp ? 'checked' : ''}/> Ramp intake</label>
          <label>Highest shelf<select data-k="maxLevel">${['Oven only', 'LEVEL 1', 'LEVEL 2', 'LEVEL 3'].map((t, i) => opt(i, t, i === md.maxLevel)).join('')}</select></label>
          <label class="wide">Mechanism<select data-k="mech">${Object.entries(MECHS)
            .map(([k, t]) => opt(k, t, k === md.mech))
            .join('')}</select></label>
        </div></details>`;
    row.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (k === 'robot') b.robot = e.target.value;
      else if (k) b.mods = sanitizeMods({ ...md, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'maxLevel' ? Number(e.target.value) : e.target.value });
      const open = row.querySelector('details').open;
      renderBotRows();
      if (open) box.children[rows.findIndex((r) => r.b === b)]?.querySelector('details')?.setAttribute('open', '');
    });
    row.querySelector('[data-k="dice"]').addEventListener('click', () => {
      b.robot = POOL[Math.floor(Math.random() * 3)];
      b.mods = randomMods();
      renderBotRows();
    });
    box.appendChild(row);
  }
}
for (const id of ['pr-alliance', 'pr-allies', 'pr-opps']) $(id).addEventListener('change', renderBotRows);

function status(msg) {
  $('net-status').textContent = msg;
}

// ------------------------------------------------------------------ modal + settings
function openModal(tplId) {
  app.overlayReturn = [...SCREENS].find((s) => !$(s).classList.contains('hidden')) || null;
  $('modal-body').innerHTML = '';
  $('modal-body').appendChild($(tplId).content.cloneNode(true));
  for (const el of $('modal-body').querySelectorAll('[data-setting]')) {
    const k = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
    el.addEventListener('change', () => {
      settings[k] = el.type === 'checkbox' ? el.checked : el.value;
      saveSettings();
      applySettings();
    });
  }
  show('modal');
}
function closeModal() {
  if (app.overlayReturn && app.overlayReturn !== 'modal') show(app.overlayReturn);
  else if (inMatch()) show(null);
  else show('menu');
}
function applySettings() {
  scene.setQuality(settings.quality);
  audio.enabled = settings.sound;
  hud.showMinimap = settings.minimap;
  $('minimap').classList.toggle('hidden', !settings.minimap);
}
applySettings();

$('lobby-autoramp').addEventListener('change', (e) => net.send({ t: 'settings', autoRamp: e.target.checked }));
$('lobby-official').addEventListener('change', (e) => {
  settings.officialRules = e.target.checked;
  saveSettings();
  net.send({ t: 'settings', officialRules: e.target.checked });
});
// remember the rules choice between matches
$('pr-official').checked = !!settings.officialRules;
$('pr-official').addEventListener('change', (e) => {
  settings.officialRules = e.target.checked;
  saveSettings();
});

input.onChat = () => {
  if (!app.session || app.session.local) return;
  $('ingame-chat').classList.remove('hidden');
  $('chat-in2').focus();
};

// ------------------------------------------------------------------ local practice
function startLocal(opts) {
  app.session = new LocalSession(opts);
  app.room = null;
  beginMatchView();
}

function beginMatchView() {
  const s = app.session;
  scene.setMatch(s.roster, s.you, settings.camera);
  app.rosterById = new Map(s.roster.map((r) => [r.id, r]));
  app.paused = false;
  app.resultsShown = false;
  hud.lastPhase = null;
  hud.lastCount = null;
  show(null);
  hud.show(true);
  $('ingame-chat').classList.add('hidden');
  input.enabled = true;
}

function quitToMenu() {
  if (app.session && !app.session.local) net.send({ t: 'leave' });
  app.session = null;
  app.room = null;
  scene.clearMatch();
  hud.show(false);
  show('menu');
}

function pause() {
  if (!inMatch()) return;
  app.paused = app.session.local;
  $('pause-note').textContent = app.session.local ? 'Practice is paused.' : 'Online match keeps running while this menu is open.';
  show('pause');
  input.enabled = false;
}
function resume() {
  app.paused = false;
  show(null);
  input.enabled = true;
}

// ------------------------------------------------------------------ online
async function online(msg) {
  status('Connecting…');
  try {
    await net.connect();
  } catch (err) {
    status(`${err.message}. Online play needs the Node server (npm start).`);
    return;
  }
  net.send({ t: 'hello', ...profile() });
  net.send(msg);
  if (msg.t === 'create' && settings.officialRules) net.send({ t: 'settings', officialRules: true }); // host's saved rules choice
  status('');
}

net.on('room', ({ room }) => {
  app.room = room;
  document.body.classList.toggle('is-host', room.host === net.id);
  renderLobby(room);
  if (!inMatch() && (room.phase === 'lobby' || room.phase === 'results')) {
    const onModal = !$('modal').classList.contains('hidden');
    if (!onModal) show('lobby');
  }
});
net.on('start', (msg) => {
  app.session = new NetSession(net, msg);
  beginMatchView();
  if (!msg.you) hud.hint('Spectating — press C to change camera');
});
net.on('snap', (msg) => app.session && !app.session.local && app.session.onSnap(msg));
net.on('results', (msg) => {
  if (!app.session || app.session.local) return;
  app.netResult = msg;
  setTimeout(() => showResults(msg), 1200);
});
net.on('lobby', () => toLobby());
net.on('chat', ({ from, text }) => addChat(from, text));
net.on('error', ({ msg }) => {
  status(msg);
  addChat(null, msg);
});
net.on('kicked', () => {
  quitToMenu();
  status('You were removed from the room');
});
net.on('close', () => {
  if (app.session && !app.session.local) quitToMenu();
  if (app.room) show('menu');
  app.room = null;
  status('Disconnected from server');
});

function toLobby() {
  app.session = null;
  scene.clearMatch();
  hud.show(false);
  if (app.room) {
    renderLobby(app.room);
    show('lobby');
  } else show('menu');
}

function renderLobby(room) {
  $('lobby-code').textContent = room.code;
  const isHost = room.host === net.id;
  for (const a of ['red', 'blue']) {
    const box = document.querySelector(`.slots[data-alliance="${a}"]`);
    box.innerHTML = '';
    for (let n = 1; n <= 3; n++) {
      const id = `${a}${n}`;
      const sl = room.slots[id];
      const div = document.createElement('div');
      div.className = 'slot';
      let who;
      let btns = '';
      if (!sl) {
        who = `<b class="muted">Open</b><span>Driver station ${n}</span>`;
        btns = `<button class="btn tiny" data-action="take-slot" data-slot="${id}">Take</button>`;
        if (isHost) btns += ` <button class="btn tiny ghost" data-action="add-bot" data-slot="${id}">+ Bot</button>`;
      } else if (sl.type === 'bot') {
        who = `<b>🤖 ${esc(sl.name)}</b><span>${esc(getRobotConfig(sl.robot).name)}<span class="cfg-tag">${esc(modsLabel(sl.mods))}</span></span>`;
        btns = `<button class="btn tiny" data-action="take-slot" data-slot="${id}">Take</button>`;
        if (isHost) btns += ` <button class="btn tiny ghost" data-action="remove-bot" data-slot="${id}">✕</button>`;
      } else {
        const me = sl.pid === net.id;
        if (me) div.classList.add('me');
        who = `<b>${esc(sl.name)}${sl.pid === room.host ? ' ★' : ''}</b><span>${sl.team ? '#' + esc(sl.team) + ' · ' : ''}${esc(getRobotConfig(sl.robot).name)}<span class="cfg-tag">${esc(modsLabel(sl.mods))}</span></span>`;
        if (isHost && !me) btns = `<button class="btn tiny ghost" data-action="kick" data-pid="${sl.pid}">Kick</button>`;
        if (me) {
          btns = `<select class="robot-pick">${ROBOT_IDS.map((r) => `<option value="${r}" ${r === sl.robot ? 'selected' : ''}>${esc(ROBOTS[r].name)}</option>`).join('')}</select>`;
        }
      }
      div.innerHTML = `<div class="st">${n}</div><div class="who">${who}</div>${btns}`;
      box.appendChild(div);
    }
  }
  for (const sel of document.querySelectorAll('.robot-pick')) {
    sel.addEventListener('change', () => {
      robotSel.value = sel.value;
      settings.robot = sel.value;
      saveSettings();
      net.send({ t: 'robot', robot: sel.value, mods: readMods() });
    });
  }
  const ar = $('lobby-autoramp');
  ar.checked = !!room.settings?.autoRamp;
  ar.disabled = !isHost;
  $('lobby-official').checked = !!room.settings?.officialRules;
  $('lobby-official').disabled = !isHost;
  $('lobby-specs').textContent = room.spectators.length ? room.spectators.map((s) => s.name).join(', ') : '—';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function addChat(from, text) {
  for (const id of ['chat-log', 'chat-log2']) {
    const log = $(id);
    const line = document.createElement('div');
    if (from) line.innerHTML = `<b>${esc(from)}:</b> ${esc(text)}`;
    else {
      line.className = 'sys';
      line.textContent = text;
    }
    log.appendChild(line);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
}
for (const id of ['chat-in', 'chat-in2']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = e.target.value.trim();
      if (v) net.send({ t: 'chat', text: v });
      e.target.value = '';
      if (id === 'chat-in2') {
        e.target.blur();
        $('ingame-chat').classList.add('hidden');
      }
    }
    if (e.key === 'Escape') e.target.blur();
  });
}

// ------------------------------------------------------------------ results
function showResults(res) {
  if (app.resultsShown) return;
  app.resultsShown = true;
  renderResults(res, app.session?.roster);
  $('res-banner').scrollIntoView?.();
  show('results');
  input.enabled = false;
  const againBtn = document.querySelector('#results [data-action="again"]');
  const local = app.session?.local;
  againBtn.textContent = local ? 'Play Again' : app.room?.host === net.id ? 'Back to Lobby' : 'Lobby';
}

// ------------------------------------------------------------------ events -> HUD/audio
function handleEvents(events) {
  const you = app.session?.you;
  const myAlliance = you ? app.rosterById.get(you)?.alliance : null;
  for (const e of events) {
    switch (e.type) {
      case 'score':
        hud.toast(`+${e.pts}  ${e.label}`, e.alliance);
        if (e.robot === you) audio.score();
        break;
      case 'stun': {
        const v = app.rosterById.get(e.robot);
        hud.toast(`⚡ ${v?.team || v?.name || 'A robot'} is STUNNED for 5 s`, 'foul');
        if (e.robot === you) hud.hint('⚡ Stunned — frozen for 5 s');
        break;
      }
      case 'foul':
        hud.toast(`FOUL ${e.rule} — ${e.alliance.toUpperCase()} (${e.desc}) +${e.pts} ${e.alliance === 'red' ? 'BLUE' : 'RED'}`, 'foul');
        audio.foul();
        break;
      case 'hint':
        if (e.robot === you) hud.hint(e.msg);
        break;
      case 'intake':
        if (e.robot === you) audio.intake();
        break;
      case 'feed':
        if (e.robot === you) audio.intake();
        break;
      case 'trade':
        hud.toast(`${e.alliance.toUpperCase()} oven: 3 carrots → ${e.to.toUpperCase()} depot${e.cake ? ' · CARROT CAKE baked!' : ''}`, e.alliance);
        break;
      case 'endgame':
        hud.banner('ENDGAME', '#ffd84a');
        audio.endgame();
        break;
      case 'park':
        if (e.alliance === myAlliance || !myAlliance) hud.toast(`${e.alliance.toUpperCase()} PARKED${e.held ? ` + HAUL ×${e.held}` : ''}`, e.alliance);
        break;
      default:
    }
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can be slightly before `last`
  last = now;
  const s = app.session;

  for (const a of input.takeActions()) {
    if (a === 'pause') {
      if (!$('modal').classList.contains('hidden')) closeModal();
      else if (!$('pause').classList.contains('hidden')) resume();
      else if (inMatch() && $('results').classList.contains('hidden')) pause();
    }
    if (!s) continue;
    if (a === 'camera') hud.hint(`Camera: ${scene.cycleCamera()}`);
    if (a === 'orient') {
      settings.fieldOriented = !settings.fieldOriented;
      saveSettings();
      hud.hint(settings.fieldOriented ? 'Field-oriented drive' : 'Robot-oriented drive');
    }
    if (a === 'minimap') {
      settings.minimap = !settings.minimap;
      saveSettings();
      applySettings();
    }
  }

  let view = null;
  if (s) {
    if (!app.paused) {
      acc += dt;
      let n = 0;
      const me = s.you && acc >= TICK ? s.view(performance.now() / 1000, 1)?.robots.get(s.you) : null;
      while (acc >= TICK && n++ < 8) {
        acc -= TICK;
        const inp = input.sample({ forward: scene.controlForward(), heading: me?.th ?? 0, fieldOriented: settings.fieldOriented, autoStow: settings.autoStow });
        s.tick(inp);
      }
      if (acc > TICK) acc = 0;
    }
    view = s.view(performance.now() / 1000, Math.min(1, acc / TICK));
    if (view) {
      view.rosterById = app.rosterById;
      handleEvents(s.drainEvents());
      hud.update(view, { you: s.you, alliance: scene.alliance, fieldOriented: settings.fieldOriented, camName: scene.camName(), audio }, dt);
      if (s.local && s.result && !app.resultsShown) {
        app.resultsShown = 'pending';
        setTimeout(() => {
          app.resultsShown = false;
          if (app.session === s) showResults(s.result);
        }, 1500);
      }
    }
  }
  scene.render(view, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__hh = { app, scene, settings };

// deep link: /?room=ABCD
const qp = new URLSearchParams(location.search);
if (qp.get('room')) {
  $('in-code').value = qp.get('room').toUpperCase().slice(0, 4);
  online({ t: 'join', code: $('in-code').value });
}
if (qp.get('practice') !== null) actions['practice-start']();
