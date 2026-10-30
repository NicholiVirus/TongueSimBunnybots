// Ranked leaderboard: runs are saved under the driver name typed in the menu (no accounts).
// A driver appears once per robot (drivetrain + full build) with their best run on it; the same
// name can show up again only with a different robot. Boards: overall and per scoring mechanism.
import crypto from 'node:crypto';
import { sanitizeMods, ROBOTS } from '../shared/robots.js';

export const BOARDS = {
  overall: 'Overall',
  passthrough: 'Passthrough elevator',
  separate: 'Hopper + separate elevator',
  opposite: 'Hopper front + elevator back',
  elevIntake: 'Intake-elevator + hopper',
};
const KEEP = 100; // runs kept per mechanism
const DEFAULT_ADMIN_KEY = 'TUNGTUNG'; // used when ADMIN_KEY isn't set on the host

export class Leaderboard {
  // adminKey: secret that lets the admin remove runs (ADMIN_KEY on the host, else DEFAULT_ADMIN_KEY)
  constructor(store, { adminKey = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY } = {}) {
    this.store = store;
    this.adminKey = adminKey || null;
    delete store.doc.users; // left over from the old account system
    delete store.doc.sessions;
    const s = store.doc.scores;
    if (!Array.isArray(s)) store.doc.scores = s ? Object.values(s) : []; // older saves kept one per driver
    for (const e of store.doc.scores) e.id ??= crypto.randomUUID();
    // older saves kept every run: keep only the best per driver + robot
    const best = new Map();
    for (const e of this.board('overall')) if (!best.has(slot(e))) best.set(slot(e), e);
    store.doc.scores = [...best.values()];
  }

  get runs() {
    return this.store.doc.scores;
  }

  isAdmin(key) {
    if (!this.adminKey || typeof key !== 'string') return false;
    const a = crypto.createHash('sha256').update(key).digest();
    const b = crypto.createHash('sha256').update(this.adminKey).digest();
    return crypto.timingSafeEqual(a, b);
  }

  submit({ name, team, score, totals, robot, mods }) {
    const md = sanitizeMods(mods);
    const entry = { id: crypto.randomUUID(), name, team: cleanTeam(team), arch: md.mech, robot: ROBOTS[robot] ? robot : 'team', mods: md, score, totals, date: Date.now() };
    const prev = this.runs.find((e) => slot(e) === slot(entry));
    const improved = !prev || score > prev.score;
    if (!improved) return { improved, best: prev.score, arch: md.mech, rank: this.rankOf(md.mech, prev.id), overallRank: this.rankOf('overall', prev.id) };
    if (prev) this.store.doc.scores = this.runs.filter((e) => e !== prev);
    this.runs.push(entry);
    // trim each mechanism to its best KEEP runs
    const mine = this.board(md.mech);
    if (mine.length > KEEP) {
      const drop = new Set(mine.slice(KEEP).map((e) => e.id));
      this.store.doc.scores = this.runs.filter((e) => !drop.has(e.id));
    }
    this.store.changed();
    return { improved, best: score, arch: md.mech, rank: this.rankOf(md.mech, entry.id), overallRank: this.rankOf('overall', entry.id) };
  }

  board(board) {
    const rows = board === 'overall' ? [...this.runs] : this.runs.filter((e) => e.arch === board);
    return rows.sort((a, b) => b.score - a.score || a.date - b.date);
  }

  rankOf(board, id) {
    const i = this.board(board).findIndex((e) => e.id === id);
    return i < 0 ? null : i + 1;
  }

  remove(key, id) {
    if (!this.isAdmin(key)) throw new Error('Wrong admin key');
    const n = this.runs.length;
    this.store.doc.scores = this.runs.filter((e) => e.id !== id);
    if (this.runs.length === n) throw new Error('Run not found');
    this.store.changed();
  }
}

// one leaderboard entry per driver name (any case) + drivetrain + build
const slot = (e) => `${String(e.name).toLowerCase()}|${e.robot}|${JSON.stringify(sanitizeMods(e.mods))}`;

const cleanTeam = (t) =>
  String(t ?? '')
    .replace(/\D/g, '')
    .slice(0, 5);
