import type { ZoneKind } from './types.ts'

export type SurfaceWet = 'spray' | 'drip' | 'none'

export type Surface = {
  id: ZoneKind
  label: string
  wet: SurfaceWet
  fill: string
  stroke: string
  pattern: string
}

export const SURFACES: Surface[] = [
  { id: 'lawn', label: 'Газон', wet: 'spray', fill: 'rgba(72, 140, 74, 0.38)', stroke: '#2a6b32', pattern: 'lawn' },
  { id: 'bed', label: 'Клумба', wet: 'drip', fill: 'rgba(184, 122, 46, 0.40)', stroke: '#8a5a16', pattern: 'bed' },
  { id: 'shrub', label: 'Кусты', wet: 'drip', fill: 'rgba(46, 92, 52, 0.42)', stroke: '#1d4a24', pattern: 'shrub' },
  { id: 'path', label: 'Дорожка', wet: 'none', fill: 'rgba(150, 142, 132, 0.40)', stroke: '#5c564e', pattern: 'path' },
  { id: 'concrete', label: 'Бетон', wet: 'none', fill: 'rgba(168, 168, 164, 0.45)', stroke: '#6a6a66', pattern: 'concrete' },
  { id: 'water', label: 'Вода', wet: 'none', fill: 'rgba(64, 132, 176, 0.38)', stroke: '#2a6288', pattern: 'water' },
  { id: 'building', label: 'Здание', wet: 'none', fill: 'rgba(92, 84, 78, 0.42)', stroke: '#3c3834', pattern: 'building' },
]

export const SURFACE_BY_ID: Record<ZoneKind, Surface> = Object.fromEntries(SURFACES.map((item) => [item.id, item])) as Record<ZoneKind, Surface>

export function surfaceOf(kind: ZoneKind): Surface {
  return SURFACE_BY_ID[kind] ?? SURFACE_BY_ID.lawn
}

export function isSprayKind(kind: ZoneKind): boolean {
  return surfaceOf(kind).wet === 'spray'
}

export function isDripKind(kind: ZoneKind): boolean {
  return surfaceOf(kind).wet === 'drip'
}

export function isObstacleKind(kind: ZoneKind): boolean {
  return surfaceOf(kind).wet === 'none'
}

export function isWetKind(kind: ZoneKind): boolean {
  return surfaceOf(kind).wet !== 'none'
}

export const DEFAULT_PPM = 20
export const DEFAULT_SHEET_M = { w: 80, h: 60 }
