import { useEffect, useState } from 'react'
import { api, type ProjectSummary, type User } from '../api'

export function ProjectsPage({ user, go, onLogout }: { user: User; go: (to: string) => void; onLogout: () => void }) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null)
  const [name, setName] = useState('Новый участок')
  const [error, setError] = useState('')

  useEffect(() => {
    api.projects().then(setItems).catch((err: Error) => setError(err.message))
  }, [])

  async function create() {
    setError('')
    try {
      const project = await api.createProject(name.trim() || 'Новый участок')
      go(`/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать проект')
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить проект?')) return
    await api.deleteProject(id)
    setItems((current) => current?.filter((item) => item.id !== id) ?? null)
  }

  async function logout() {
    await api.logout()
    onLogout()
    go('/')
  }

  return (
    <main className="desk">
      <header className="top">
        <p className="mark">Полив</p>
        <span className="who">{user.name}</span>
        <button className="ghost" onClick={logout}>Выйти</button>
      </header>
      <section className="sheet">
        <h1>Проекты</h1>
        <div className="create">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Название проекта" />
          <button className="primary" onClick={create}>Создать</button>
        </div>
        {error && <p className="error">{error}</p>}
        {items === null && <p>Загрузка…</p>}
        {items?.length === 0 && <p>Пока нет проектов. Создайте первый чертёж.</p>}
        <ul className="project-list">
          {items?.map((item) => (
            <li key={item.id}>
              <button className="open" onClick={() => go(`/projects/${item.id}`)}>
                <strong>{item.name}</strong>
                <span>{new Date(item.updatedAt).toLocaleString('ru-RU')}</span>
              </button>
              <button className="ghost" onClick={() => remove(item.id)}>Удалить</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
