import type { Doc } from '@shared/types.ts'

export type User = { id: string; email: string; name: string }

export type ProjectSummary = {
  id: string
  name: string
  updatedAt: string
  hasBackground: boolean
}

export type ProjectDetail = ProjectSummary & { doc: Doc }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    credentials: 'include',
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error || 'Запрос не выполнился')
  return data as T
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  register: (body: { name: string; email: string; password: string }) =>
    request<User>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  projects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) => request<ProjectDetail>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  project: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  saveProject: (id: string, body: { name?: string; doc?: Doc }) =>
    request<{ id: string; name: string; updatedAt: string }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  uploadBackground: (id: string, dataUrl: string) =>
    request<{ hasBackground: boolean }>(`/api/projects/${id}/background`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  deleteBackground: (id: string) => request<{ hasBackground: boolean }>(`/api/projects/${id}/background`, { method: 'DELETE' }),
}
