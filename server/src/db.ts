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
`)

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
