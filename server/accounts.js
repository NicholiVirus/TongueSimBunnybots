// Driver accounts (username + password) and the ranked leaderboard.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { sanitizeMods, ROBOTS } from '../shared/robots.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 90;

// Accounts allowed to remove leaderboard scores. Add usernames here, or set LEADERBOARD_ADMINS
// (comma-separated) on the host. Matching ignores upper/lower case.
const ADMINS = ['611_Nick'];

// One leaderboard per scoring architecture, plus OVERALL (each driver's best on any of them).
export const BOARDS = {
  overall: 'Overall',
  passthrough: 'Passthrough elevator',
  separate: 'Hopper + separate elevator',
  opposite: 'Hopper front + elevator back',
  elevIntake: 'Intake-elevator + hopper',
};

const USER_RE = /^[A-Za-z0-9_-]{3,20}$/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const key = (name) => name.toLowerCase();

export class Accounts {
  constructor(store, { admins = process.env.LEADERBOARD_ADMINS } = {}) {
    this.store = store;
    this.admins = new Set([...ADMINS, ...String(admins || '').split(',')].map((s) => key(s.trim())).filter(Boolean));
    this.pruneSessions();
  }

  get db() {
    return this.store.doc;
  }

  isAdmin(name) {
    return !!name && this.admins.has(key(name));
  }

  publicUser(u) {
    return { name: u.name, team: u.team || '', admin: this.isAdmin(u.name) };
  }

  async register(name, password, team) {
    name = String(name ?? '').trim();
    password = String(password ?? '');
    if (!USER_RE.test(name)) throw new Error('Username: 3–20 letters, numbers, _ or -');
    if (password.length < 6 || password.length > 200) throw new Error('Password must be at least 6 characters');
    if (this.db.users[key(name)]) throw new Error('That username is taken');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    if (this.db.users[key(name)]) throw new Error('That username is taken'); // lost a race while hashing
    const u = { name, salt, hash, team: cleanTeam(team), created: Date.now() };
    this.db.users[key(name)] = u;
    this.store.changed();
    return { token: this.newSession(u), user: this.publicUser(u) };
  }

  async login(name, password) {
    const u = this.db.users[key(String(name ?? '').trim())];
    // hash even for unknown users so response time doesn't reveal which usernames exist
    const hash = (await scrypt(String(password ?? ''), u?.salt || 'x', 64)).toString('hex');
    if (!u || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'))) throw new Error('Wrong username or password');
    return { token: this.newSession(u), user: this.publicUser(u) };
  }

  newSession(u) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.sessions[sha(token)] = { user: key(u.name), exp: Date.now() + SESSION_DAYS * 864e5 };
    this.store.changed();
    return token;
  }

  userFor(token) {
    if (!token || typeof token !== 'string') return null;
    const s = this.db.sessions[sha(token)];
    if (!s || s.exp < Date.now()) return null;
    return this.db.users[s.user] || null;
  }

  logout(token) {
    const k = typeof token === 'string' ? sha(token) : null;
    if (k && this.db.sessions[k]) {
      delete this.db.sessions[k];
      this.store.changed();
    }
  }

  setTeam(u, team) {
    u.team = cleanTeam(team);
    this.store.changed();
  }

  pruneSessions() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.db.sessions)) if (s.exp < now) delete this.db.sessions[k];
  }

  // ---------------------------------------------------------------- leaderboard
  // A ranked run's score is kept if it beats the driver's best for that architecture.
  submit(u, { score, totals, robot, mods, team }) {
    const md = sanitizeMods(mods);
    const arch = md.mech;
    const id = `${key(u.name)}|${arch}`;
    const prev = this.db.scores[id];
    const entry = { user: key(u.name), name: u.name, team: cleanTeam(team), arch, robot: ROBOTS[robot] ? robot : 'team', mods: md, score, totals, date: Date.now() };
    const best = !prev || score > prev.score;
    if (best) {
      this.db.scores[id] = entry;
      this.store.changed();
    }
    return { best, prev: prev?.score ?? null, arch, rank: this.rankOf(arch, u.name), overallRank: this.rankOf('overall', u.name) };
  }

  board(board) {
    const all = Object.values(this.db.scores);
    let rows;
    if (board === 'overall') {
      const top = new Map();
      for (const e of all) if (!top.has(e.user) || e.score > top.get(e.user).score) top.set(e.user, e);
      rows = [...top.values()];
    } else rows = all.filter((e) => e.arch === board);
    return rows.sort((a, b) => b.score - a.score || a.date - b.date);
  }

  rankOf(board, name) {
    const i = this.board(board).findIndex((e) => e.user === key(name));
    return i < 0 ? null : i + 1;
  }

  remove(admin, user, arch) {
    if (!this.isAdmin(admin?.name)) throw new Error('Only leaderboard admins can remove scores');
    const id = `${key(String(user ?? ''))}|${arch}`;
    if (!this.db.scores[id]) throw new Error('Score not found');
    delete this.db.scores[id];
    this.store.changed();
  }
}

const cleanTeam = (t) =>
  String(t ?? '')
    .replace(/\D/g, '')
    .slice(0, 5);
