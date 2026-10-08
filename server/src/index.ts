import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express, { type Request, type Response, type NextFunction } from 'express'
import { emptyDoc, parseDoc } from '../../shared/doc.ts'
import { dataRoot, db, type ProjectRow, type UserRow } from './db.ts'
import { hashPassword, newToken, tokenHash, verifyPassword } from './password.ts'

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8787)
const HOST = process.env.HOST || (process.env.SERVER_PORT ? '0.0.0.0' : '127.0.0.1')
const COOKIE = 'poliv_session'
const WEEK = 30 * 24 * 3600 * 1000

const app = express()
app.use(express.json({ limit: '8mb' }))
app.use(cookieParser())

function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ error })
}

function currentUser(req: Request): UserRow | null {
  const token = req.cookies?.[COOKIE]
  if (typeof token !== 'string' || !token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.password_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash(token), new Date().toISOString()) as UserRow | undefined
  return row ?? null
}

function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req)
  if (!user) {
    sendError(res, 401, 'Нужно войти')
    return
  }
  res.locals.user = user
  next()
}

function setSession(res: Response, userId: string) {
  const token = newToken()
  const expires = new Date(Date.now() + WEEK)
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires.toISOString())
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: WEEK })
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/register', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (name.length < 1 || name.length > 80) return sendError(res, 400, 'Укажите имя')
  if (!email.includes('@') || email.length > 120) return sendError(res, 400, 'Укажите почту')
  if (password.length < 8 || password.length > 200) return sendError(res, 400, 'Пароль должен быть от 8 символов')
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) return sendError(res, 409, 'Такая почта уже зарегистрирована')
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email,
    name,
    await hashPassword(password),
    new Date().toISOString(),
  )
  setSession(res, id)
  res.status(201).json({ id, email, name })
})

app.post('/api/auth/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const user = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email) as UserRow | undefined
  if (!user || !(await verifyPassword(password, user.password_hash))) return sendError(res, 401, 'Неверная почта или пароль')
  setSession(res, user.id)
  res.json({ id: user.id, email: user.email, name: user.name })
})

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.[COOKIE]
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req)
  if (!user) return sendError(res, 401, 'Нужно войти')
  res.json({ id: user.id, email: user.email, name: user.name })
})

app.get('/api/projects', requireUser, (_req, res) => {
  const user = res.locals.user as UserRow
  const rows = db
    .prepare('SELECT id, name, updated_at, background_mime FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id) as { id: string; name: string; updated_at: string; background_mime: string | null }[]
  res.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      hasBackground: Boolean(row.background_mime),
    })),
  )
})

app.post('/api/projects', requireUser, (req, res) => {
  const user = res.locals.user as UserRow
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (name.length < 1 || name.length > 120) return sendError(res, 400, 'Укажите название проекта')
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO projects (id, user_id, name, doc_json, background_mime, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  ).run(id, user.id, name, JSON.stringify(emptyDoc()), now, now)
  res.status(201).json({ id, name, doc: emptyDoc(), hasBackground: false, updatedAt: now })
})

function ownProject(res: Response, id: string): ProjectRow | null {
  const user = res.locals.user as UserRow
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id) as ProjectRow | undefined
  return row ?? null
}

app.get('/api/projects/:id', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row) return sendError(res, 404, 'Проект не найден')
  let stored = emptyDoc()
  try {
    stored = parseDoc(JSON.parse(row.doc_json)) ?? emptyDoc()
  } catch {
    stored = emptyDoc()
  }
  res.json({
    id: row.id,
    name: row.name,
    doc: stored,
    hasBackground: Boolean(row.background_mime),
    updatedAt: row.updated_at,
  })
})

app.put('/api/projects/:id', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row) return sendError(res, 404, 'Проект не найден')
  let name = row.name
  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== 'string' || req.body.name.trim().length < 1 || req.body.name.trim().length > 120) {
      return sendError(res, 400, 'Укажите название проекта')
    }
    name = req.body.name.trim()
  }
  let docJson = row.doc_json
  if (req.body?.doc !== undefined) {
    const doc = parseDoc(req.body.doc)
    if (!doc) return sendError(res, 400, 'Чертёж записан в неизвестном виде')
    docJson = JSON.stringify(doc)
  }
  const now = new Date().toISOString()
  db.prepare('UPDATE projects SET name = ?, doc_json = ?, updated_at = ? WHERE id = ?').run(name, docJson, now, row.id)
  res.json({ id: row.id, name, updatedAt: now })
})

app.delete('/api/projects/:id', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row) return sendError(res, 404, 'Проект не найден')
  db.prepare('DELETE FROM projects WHERE id = ?').run(row.id)
  const file = path.join(dataRoot, 'backgrounds', row.id)
  try {
    unlinkSync(file)
  } catch {
    /* подложки могло не быть */
  }
  res.json({ ok: true })
})

function readImage(body: unknown): { mime: string; buf: Buffer } | null {
  const dataUrl = typeof (body as { dataUrl?: unknown })?.dataUrl === 'string' ? (body as { dataUrl: string }).dataUrl : ''
  const marker = ';base64,'
  const semi = dataUrl.indexOf(marker)
  if (!dataUrl.startsWith('data:') || semi < 0) return null
  const mime = dataUrl.slice('data:'.length, semi)
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return null
  const buf = Buffer.from(dataUrl.slice(semi + marker.length), 'base64')
  if (buf.length < 16 || buf.length > 6_000_000) return null
  return { mime, buf }
}

app.put('/api/projects/:id/background', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row) return sendError(res, 404, 'Проект не найден')
  const image = readImage(req.body)
  if (!image) return sendError(res, 400, 'Нужна картинка PNG, JPEG, WEBP или GIF до 6 МБ')
  writeFileSync(path.join(dataRoot, 'backgrounds', row.id), image.buf)
  const now = new Date().toISOString()
  db.prepare('UPDATE projects SET background_mime = ?, updated_at = ? WHERE id = ?').run(image.mime, now, row.id)
  res.json({ hasBackground: true, updatedAt: now })
})

app.delete('/api/projects/:id/background', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row) return sendError(res, 404, 'Проект не найден')
  try {
    unlinkSync(path.join(dataRoot, 'backgrounds', row.id))
  } catch {
    /* файла уже нет */
  }
  const now = new Date().toISOString()
  db.prepare('UPDATE projects SET background_mime = NULL, updated_at = ? WHERE id = ?').run(now, row.id)
  res.json({ hasBackground: false, updatedAt: now })
})

app.get('/api/projects/:id/background', requireUser, (req, res) => {
  const row = ownProject(res, req.params.id)
  if (!row?.background_mime) return sendError(res, 404, 'Подложки нет')
  const buf = readFileSync(path.join(dataRoot, 'backgrounds', row.id))
  res.setHeader('Content-Type', row.background_mime)
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.send(buf)
})

const dist = path.resolve(process.cwd(), 'dist')
if (existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error)
    return
  }
  const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: number }).status) : 500
  if (status === 400) return sendError(res, 400, 'Некорректный запрос')
  if (status === 413) return sendError(res, 413, 'Файл слишком большой')
  console.error(error)
  sendError(res, 500, 'Ошибка сервера')
})

app.listen(PORT, HOST, () => {
  console.log(`Poliv is listening on http://${HOST}:${PORT}`)
})
