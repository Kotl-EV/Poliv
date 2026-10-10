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

export type HatchId =
  | 'lawn' | 'lawn-stripe'
  | 'bed' | 'bed-mulch'
  | 'shrub'
  | 'path' | 'path-diagonal' | 'path-brick' | 'path-honey'
  | 'concrete' | 'water' | 'building'

export const HATCHES: { id: HatchId; kind: ZoneKind; label: string }[] = [
  { id: 'lawn', kind: 'lawn', label: 'Трава' },
  { id: 'lawn-stripe', kind: 'lawn', label: 'Полосы' },
  { id: 'bed', kind: 'bed', label: 'Цветы' },
  { id: 'bed-mulch', kind: 'bed', label: 'Мульча' },
  { id: 'shrub', kind: 'shrub', label: 'Кусты' },
  { id: 'path', kind: 'path', label: 'Ромб' },
  { id: 'path-diagonal', kind: 'path', label: 'Диагональ' },
  { id: 'path-brick', kind: 'path', label: 'Кирпич' },
  { id: 'path-honey', kind: 'path', label: 'Соты' },
  { id: 'concrete', kind: 'concrete', label: 'Бетон' },
  { id: 'water', kind: 'water', label: 'Вода' },
  { id: 'building', kind: 'building', label: 'Здание' },
]

/** Цвета обводки и подписей. */
export const INKS = ['#2a6b32', '#8a5a16', '#5c564e', '#2a6288', '#8d2b1f', '#1c2822'] as const

export function hatchesFor(kind: ZoneKind): { id: HatchId; kind: ZoneKind; label: string }[] {
  return HATCHES.filter((item) => item.kind === kind)
}

/** Штриховка контура. Чужая для этой поверхности сбрасывается на обычную. */
export function hatchOf(zone: { kind: ZoneKind; hatch?: string | null }): HatchId {
  const hit = HATCHES.find((item) => item.id === zone.hatch && item.kind === zone.kind)
  if (hit) return hit.id
  const fallback = surfaceOf(zone.kind).pattern
  const known = HATCHES.find((item) => item.id === fallback)
  return known ? known.id : 'lawn'
}

/** Соты: два ряда шестиугольников в одной плитке. */
export function honeycomb(u: number): { w: number; h: number; d: string } {
  const r = u * 0.62
  const w = Math.sqrt(3) * r
  const row = r * 1.5
  const hex = (cx: number, cy: number) => {
    const pts: string[] = []
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`)
    }
    return `M ${pts.join(' L ')} Z`
  }
  return {
    w,
    h: row * 2,
    d: [hex(w / 2, r), hex(0, r + row), hex(w, r + row)].join(' '),
  }
}

export const DEFAULT_PPM = 20
export const DEFAULT_SHEET_M = { w: 80, h: 60 }

/** Visible millimetre-paper step, metres. Snap uses the same step. */
export function gridStepM(k: number, ppm: number): number {
  const pxPerM = k * ppm
  if (pxPerM >= 12) return 1
  if (pxPerM >= 5) return 5
  return 10
}
