import { TICK } from '/shared/sim.js';
import { ROBOTS, ROBOT_IDS, getRobotConfig, sanitizeMods, modsLabel, randomMods, MECHS, TEAM_LOCKS, buildFor, sanitizeLoad } from '/shared/robots.js';
import { SceneView } from './render/scene.js';
import { Input } from './input.js';
import { Hud, renderResults } from './hud.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { StartPicker } from './setup.js';
import { LocalSession, NetSession } from './session.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['menu', 'practice', 'lobby', 'pause', 'results', 'modal'];

// ------------------------------------------------------------------ persistent settings
const DEFAULT_TEAM = '611';
const DEFAULTS = { name: '', team: DEFAULT_TEAM, robot: 'team', camera: 'chase', quality: 'high', fieldOriented: true, autoStow: true, minimap: true, sound: true };
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
  paused: false,
  session: null,
  room: null,
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
$('in-load').value = sanitizeLoad(settings.load);
const updateBlurb = () => {
  $('robot-blurb').textContent = getRobotConfig(robotSel.value).blurb || '';
  $('load-row').classList.toggle('hidden', getRobotConfig(robotSel.value).mods.mech !== 'claw'); // only Charles has a choice
};
updateBlurb();
// mechanism configuration
const readMods = () => sanitizeMods({ ground: $('cfg-ground').checked, depot: $('cfg-depot').checked, ramp: $('cfg-ramp').checked, maxLevel: Number($('cfg-level').value), mech: $('cfg-mech').value });
const CFG_IDS = ['cfg-ground', 'cfg-depot', 'cfg-ramp', 'cfg-level', 'cfg-mech'];
// a robot preset (Charles) or a team number (e.g. 526) can come with a fixed build
const buildLock = () => ROBOTS[robotSel.value]?.build || TEAM_LOCKS[$('in-team').value.trim()] || null;
const writeMods = (m) => {
  const lock = buildLock();
  for (const id of CFG_IDS) $(id).disabled = !!lock;
  const md = sanitizeMods(lock || m);
  for (const o of [...$('cfg-mech').options]) if (!MECHS[o.value]) o.remove(); // locked-only mechanisms from an earlier pick
  if (lock && !MECHS[md.mech])
    $('cfg-mech').add(new Option(ROBOTS[robotSel.value]?.build ? `${ROBOTS[robotSel.value].name} — real robot build (locked)` : `Team ${$('in-team').value.trim()} build (locked)`, md.mech));
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
    if (buildLock()) return;
    settings.mods = readMods();
    saveSettings();
    writeMods(settings.mods);
    if (net.connected) net.send({ t: 'robot', robot: robotSel.value, mods: settings.mods });
  });
}
const profile = () => ({
  name: $('in-name').value.trim() || 'Driver',
  team: $('in-team').value.replace(/\D/g, '').slice(0, 5) || DEFAULT_TEAM,
  robot: robotSel.value,
  load: sanitizeLoad($('in-load').value),
  pose: startPoseFor(),
  mods: buildLock() ? sanitizeMods(MECHS[settings.mods?.mech] ? settings.mods : null) : readMods(),
});
for (const el of [$('in-name'), $('in-team'), robotSel, $('in-load')]) {
  el.addEventListener('change', () => {
    Object.assign(settings, profile());
    saveSettings();
    updateBlurb();
    writeMods(settings.mods);
    if (net.connected) {
      sendHello();
      net.send({ t: 'robot', robot: robotSel.value, mods: profile().mods });
    }
  });
}

// ------------------------------------------------------------------ starting position picker (menu)
// Saved in alliance view (driver-station wall on the right); the match mirrors it for blue.
const DEFAULT_POSE = { x: 7.55, y: 0.95, th: Math.PI };
const startPoseFor = () => settings.startPose || DEFAULT_POSE;
const startPicker = new StartPicker({
  getPose: () => startPoseFor(),
  getCfg: () => getRobotConfig(robotSel.value, profile().mods),
  setPose(p) {
    settings.startPose = p;
    saveSettings();
    if (net.connected) sendHello();
    $('start-summary').textContent = `x ${p.x.toFixed(1)} · y ${p.y.toFixed(1)} · ${Math.round((((p.th * 180) / Math.PI) % 360) + 360) % 360}°`;
  },
});
$('start-cfg').addEventListener('toggle', () => $('start-cfg').open && startPicker.draw());
for (const el of [robotSel, $('in-load')]) el.addEventListener('change', () => startPicker.draw());
startPicker.set(startPoseFor());

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
      load: p.load,
      name: p.name,
      team: p.team,
      allies: Number($('pr-allies').value),
      opps: Number($('pr-opps').value),
      skill: Number($('pr-skill').value),
      autoRamp: $('pr-autoramp').checked,
      officialRules: $('pr-official').checked,
      pose: startPoseFor(),
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
  'add-bot': (b) => net.send({ t: 'bot', slot: b.dataset.slot, add: true, robot: POOL[Math.floor(Math.random() * POOL.length)] }),
  'remove-bot': (b) => net.send({ t: 'bot', slot: b.dataset.slot, add: false }),
  kick: (b) => net.send({ t: 'kick', pid: b.dataset.pid }),
};

// ------------------------------------------------------------------ practice bot builds
const POOL = ['team', 'divebomb', 'r526', 'r709', 'kitbot', 'speedy', 'tank'];
const randomBots = () => ({
  ally: [0, 1].map(() => ({ robot: POOL[Math.floor(Math.random() * POOL.length)], mods: randomMods() })),
  opp: [0, 1, 2].map(() => ({ robot: POOL[Math.floor(Math.random() * POOL.length)], mods: randomMods() })),
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
    const md = buildFor(b.robot, '', b.mods);
    const fixed = !!ROBOTS[b.robot]?.build; // Charles plays its real build
    const row = document.createElement('div');
    row.className = `bot-row ${a}`;
    const opt = (v, t, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
    row.innerHTML = `
      <div class="top"><b>${label}</b>
        <select data-k="robot">${ROBOT_IDS.map((id) => opt(id, ROBOTS[id].name, id === b.robot)).join('')}</select>
        <button class="btn tiny ghost" data-k="dice" title="Random build">🎲</button></div>
      <details ${fixed ? 'class="fixed"' : ''}><summary>${esc(modsLabel(md))}${fixed ? ' 🔒' : ''}</summary>
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
      else if (k && !fixed) b.mods = sanitizeMods({ ...md, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'maxLevel' ? Number(e.target.value) : e.target.value });
      const open = row.querySelector('details').open;
      renderBotRows();
      if (open) box.children[rows.findIndex((r) => r.b === b)]?.querySelector('details')?.setAttribute('open', '');
    });
    row.querySelector('[data-k="dice"]').addEventListener('click', () => {
      b.robot = POOL[Math.floor(Math.random() * POOL.length)];
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
  // practice freezes until you resume; shared online matches can't
  const solo = app.session.local;
  app.paused = !!solo;
  $('pause-note').textContent = solo ? 'Paused — the match clock is frozen until you resume.' : 'Online match keeps running while this menu is open.';
  show('pause');
  input.enabled = false;
}
function resume() {
  app.paused = false;
  tickClock = performance.now(); // don't replay the paused time
  acc = 0;
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
  sendHello();
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
      writeMods(settings.mods);
      updateBlurb();
      net.send({ t: 'robot', robot: sel.value, mods: profile().mods });
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

// ------------------------------------------------------------------ profile -> server
function sendHello() {
  net.send({ t: 'hello', ...profile() });
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

// ------------------------------------------------------------------ controller menu navigation
// D-pad / left stick moves between the controls of the open screen, A presses, B goes back.
const TOP_SCREENS = ['modal', 'pause', 'results', 'practice', 'lobby', 'menu'];
function uiNav(cmd) {
  const scr = TOP_SCREENS.map($).find((el) => !el.classList.contains('hidden'));
  if (!scr) return;
  if (cmd === 'back') {
    const id = scr.id;
    if (id === 'modal') closeModal();
    else if (id === 'pause') resume();
    else if (id === 'practice') show('menu');
    else if (id === 'lobby') actions.leave();
    else if (id === 'results') actions.quit();
    return;
  }
  const els = [...scr.querySelectorAll('button, select, input, summary, [data-action]')].filter((el) => el.offsetParent !== null && !el.disabled && el.tabIndex !== -1);
  if (!els.length) return;
  const cur = document.activeElement;
  let i = els.indexOf(cur);
  if (i < 0) {
    // nothing focused yet: start on the main button of the screen
    (scr.querySelector('.btn.primary:not([disabled])') || els[0]).focus();
    return;
  }
  if ((cmd === 'left' || cmd === 'right') && cur.tagName === 'SELECT') {
    const d = cmd === 'right' ? 1 : -1;
    cur.selectedIndex = (cur.selectedIndex + d + cur.options.length) % cur.options.length;
    cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if ((cmd === 'left' || cmd === 'right') && cur.type === 'range') {
    cur.value = String(Number(cur.value) + (cmd === 'right' ? 5 : -5));
    cur.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (cmd === 'accept') {
    if (cur.tagName === 'SELECT') {
      cur.selectedIndex = (cur.selectedIndex + 1) % cur.options.length;
      cur.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (cur.tagName === 'INPUT' && cur.type !== 'checkbox' && cur.type !== 'range') cur.select?.();
    else cur.click();
    return;
  }
  i = (i + (cmd === 'down' || cmd === 'right' ? 1 : -1) + els.length) % els.length;
  els[i].focus();
  els[i].scrollIntoView?.({ block: 'nearest' });
}
// controllers are polled on their own 60 Hz timer (not the render loop) so quick taps aren't missed on slow frames
let padClock = performance.now();
setInterval(() => {
  const now = performance.now();
  input.pollPads(
    SCREENS.some((id) => !$(id).classList.contains('hidden')),
    Math.min(0.1, (now - padClock) / 1000),
  );
  padClock = now;
  if (input.usingPad) {
    document.body.classList.add('pad-nav');
    input.usingPad = false;
  }
}, 16);
window.addEventListener('mousemove', () => document.body.classList.remove('pad-nav'));
window.addEventListener('gamepadconnected', (e) => {
  status(`Controller connected: ${e.gamepad.id.slice(0, 40)}`);
  hud.hint?.('Controller connected');
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
// 60 Hz sim/input ticks run on their own clock, not the render frame rate, so a slow GPU (or a
// busy laptop) still sends exactly 60 inputs/s online and practice runs at real speed.
let tickClock = performance.now();
const tickBoundary = () => tickClock - acc * 1000; // time the last sim tick covers up to
function pumpTicks() {
  const s = app.session;
  const now = performance.now();
  const dt = Math.max(0, Math.min(0.5, (now - tickClock) / 1000));
  tickClock = now;
  if (!s || app.paused) return;
  acc += dt;
  if (acc < TICK) return;
  let n = 0;
  const me = s.you ? s.view(now / 1000, 1)?.robots.get(s.you) : null;
  while (acc >= TICK && n++ < 30) {
    acc -= TICK;
    const inp = input.sample({ forward: scene.controlForward(), heading: me?.th ?? 0, fieldOriented: settings.fieldOriented, autoStow: settings.autoStow });
    s.tick(inp);
  }
  if (acc > TICK) acc = 0;
}
setInterval(pumpTicks, 4);

function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can be slightly before `last`
  last = now;
  const s = app.session;

  for (const a of input.takeActions()) {
    if (a.startsWith('ui:')) {
      uiNav(a.slice(3));
      continue;
    }
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
    pumpTicks();
    // sample the match at this frame's display time (the rAF timestamp), not whenever this callback
    // happens to run, so the robot moves the same distance every frame instead of stuttering
    view = s.view(now / 1000, (now - tickBoundary()) / (TICK * 1000));
    if (view) {
      view.rosterById = app.rosterById;
      handleEvents(s.drainEvents());
      const ns = $('netstat');
      ns.classList.toggle('hidden', !!s.local);
      if (!s.local && s.stats) {
        const st = s.stats;
        const txt = `ping ${st.rtt} ms · buffer ${st.delayMs} ms`;
        if (ns.textContent !== txt) ns.textContent = txt;
      }
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
window.__hh = { app, scene, settings, input };

// deep link: /?room=ABCD
const qp = new URLSearchParams(location.search);
if (qp.get('room')) {
  $('in-code').value = qp.get('room').toUpperCase().slice(0, 4);
  online({ t: 'join', code: $('in-code').value });
}
if (qp.get('practice') !== null) actions['practice-start']();
