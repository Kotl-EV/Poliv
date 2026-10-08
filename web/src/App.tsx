import { useEffect, useState } from 'react'
import { api, type User } from './api'
import { AuthPage } from './pages/Auth'
import { EditorPage } from './pages/Editor'
import { ProjectsPage } from './pages/Projects'

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  const go = (to: string) => {
    history.pushState({}, '', to)
    setPath(window.location.pathname)
  }

  if (user === undefined) return <div className="boot">Загрузка…</div>

  const projectId = path.startsWith('/projects/') ? decodeURIComponent(path.slice('/projects/'.length)) : ''

  if (!user) {
    return (
      <AuthPage
        mode={path === '/register' ? 'register' : 'login'}
        onMode={(mode) => go(mode === 'register' ? '/register' : '/')}
        onUser={(next) => {
          setUser(next)
          go('/projects')
        }}
      />
    )
  }

  if (projectId) return <EditorPage projectId={projectId} user={user} go={go} onLogout={() => setUser(null)} />
  return <ProjectsPage user={user} go={go} onLogout={() => setUser(null)} />
}
