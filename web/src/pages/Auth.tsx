import { useState, type FormEvent } from 'react'
import { api, type User } from '../api'

export function AuthPage({
  mode,
  onMode,
  onUser,
}: {
  mode: 'login' | 'register'
  onMode: (mode: 'login' | 'register') => void
  onUser: (user: User) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = mode === 'register' ? await api.register({ name, email, password }) : await api.login({ email, password })
      onUser(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="card" onSubmit={submit}>
        <p className="mark">Полив</p>
        <h1>{mode === 'register' ? 'Новый аккаунт' : 'Вход'}</h1>
        <p className="lead">Проект автополива: участок, дождеватели, трубы и спецификация.</p>
        {mode === 'register' && (
          <label>
            Имя
            <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
          </label>
        )}
        <label>
          Почта
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} type="submit">
          {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
        </button>
        <button
          className="text"
          type="button"
          onClick={() => onMode(mode === 'register' ? 'login' : 'register')}
        >
          {mode === 'register' ? 'Уже есть аккаунт' : 'Создать аккаунт'}
        </button>
      </form>
    </main>
  )
}
