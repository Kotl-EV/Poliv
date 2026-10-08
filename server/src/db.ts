import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(process.cwd(), 'data')
mkdirSync(root, { recursive: true })
mkdirSync(path.join(root, 'backgrounds'), { recursive: true })

export const dataRoot = root

export const db = new DatabaseSync(path.join(root, 'poliv.db'))
db.exec('PRAGMA foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    doc_json TEXT NOT NULL,
    background_mime TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

migrateSnapOptIn()

function migrateSnapOptIn() {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get('snap_opt_in_v1') as { value: string } | undefined
  if (done) return
  const projects = db.prepare('SELECT id, doc_json FROM projects').all() as { id: string; doc_json: string }[]
  const update = db.prepare('UPDATE projects SET doc_json = ? WHERE id = ?')
  for (const project of projects) {
    try {
      const doc = JSON.parse(project.doc_json) as { snapGrid?: unknown }
      if (doc && doc.snapGrid === true) {
        doc.snapGrid = false
        update.run(JSON.stringify(doc), project.id)
      }
    } catch {
      // skip a broken row
    }
  }
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('snap_opt_in_v1', '1')
}

export type UserRow = { id: string; email: string; name: string; password_hash: string }
export type ProjectRow = {
  id: string
  user_id: string
  name: string
  doc_json: string
  background_mime: string | null
  created_at: string
  updated_at: string
}
