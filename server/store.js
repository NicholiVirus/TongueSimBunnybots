// Persistent storage for accounts, login sessions and the leaderboard.
// The whole state is one small JSON document:
//   - DATABASE_URL set  -> kept in Postgres (one row), survives redeploys on hosts like Render
//   - otherwise         -> DATA_DIR/data.json (default ./data); fine locally, but wiped on hosts
//                          with a throwaway disk unless that folder is on a persistent disk
import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = () => ({ users: {}, sessions: {}, scores: {} });

export async function openStore({ databaseUrl = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR || 'data' } = {}) {
  const backend = databaseUrl ? await pgBackend(databaseUrl) : fileBackend(dataDir);
  const doc = { ...EMPTY(), ...((await backend.load()) || {}) };
  let timer = null;
  let saving = Promise.resolve();
  const flush = () => {
    timer = null;
    const snapshot = JSON.stringify(doc);
    saving = saving.then(() => backend.save(snapshot)).catch((err) => console.error('store: save failed', err.message));
    return saving;
  };
  return {
    kind: backend.kind,
    doc,
    // batch writes: at most one save per 300 ms
    changed() {
      timer ??= setTimeout(flush, 300);
    },
    async close() {
      if (timer) {
        clearTimeout(timer);
        await flush();
      }
      await saving;
      await backend.close?.();
    },
  };
}

function fileBackend(dir) {
  const file = path.join(dir, 'data.json');
  return {
    kind: `file ${file}`,
    async load() {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('store: could not read', file, err.message);
        return null;
      }
    },
    async save(json) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, json);
      await fs.rename(tmp, file); // atomic: never leaves a half-written file
    },
  };
}

async function pgBackend(url) {
  const { default: pg } = await import('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 2 });
  await pool.query('CREATE TABLE IF NOT EXISTS hh_store (id text PRIMARY KEY, doc jsonb NOT NULL)');
  return {
    kind: 'postgres',
    async load() {
      const { rows } = await pool.query("SELECT doc FROM hh_store WHERE id = 'main'");
      return rows[0]?.doc || null;
    },
    async save(json) {
      await pool.query("INSERT INTO hh_store (id, doc) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc", [json]);
    },
    close: () => pool.end(),
  };
}
