import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url')
  const key = (await scryptAsync(password, salt, 32)) as Buffer
  return `scrypt$${salt}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const key = (await scryptAsync(password, salt, 32)) as Buffer
  const expected = Buffer.from(hash, 'base64url')
  if (key.length !== expected.length) return false
  return timingSafeEqual(key, expected)
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
