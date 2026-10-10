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

export type HatchNode =
  | { kind: 'fill'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'path'; d: string; stroke: string; width?: number; cap?: 'round' | 'butt' }
  | { kind: 'dot'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'chip'; cx: number; cy: number; rx: number; ry: number; fill: string; turn: number }

export type HatchTile = { w: number; h: number; nodes: HatchNode[] }

/** Плитка штриховки в пикселях чертежа. Одна и та же на доске и на листе. */
export function hatchTile(id: HatchId, ppm: number): HatchTile {
  const u = Math.max(12, Math.round(ppm * 0.9 * 100) / 100)
  switch (id) {
    case 'lawn':
      return { w: u, h: u, nodes: [fill(0, 0, u, u, 'rgba(98,158,84,0.42)'), ...grass(u, u)] }
    case 'lawn-stripe':
      return {
        w: u,
        h: u * 2,
        nodes: [
          fill(0, 0, u, u * 2, 'rgba(98,158,84,0.42)'),
          fill(0, 0, u, u, 'rgba(24,78,32,0.20)'),
          ...grass(u, u * 2),
        ],
      }
    case 'bed':
      return { w: u, h: u, nodes: [fill(0, 0, u, u, 'rgba(186,124,58,0.44)'), ...flowers(u)] }
    case 'bed-mulch':
      return { w: u, h: u, nodes: [fill(0, 0, u, u, 'rgba(132,86,42,0.52)'), ...mulch(u)] }
    case 'shrub':
      return { w: u * 2, h: u * 2, nodes: [fill(0, 0, u * 2, u * 2, 'rgba(48,100,56,0.48)'), ...shrubs(u * 2)] }
    case 'path':
      return {
        w: u,
        h: u,
        nodes: [
          fill(0, 0, u, u, 'rgba(168,160,148,0.48)'),
          { kind: 'path', d: `M 0 ${f(u / 2)} L ${f(u / 2)} 0 L ${f(u)} ${f(u / 2)} L ${f(u / 2)} ${f(u)} Z`, stroke: '#6e675e', width: 1 },
          ...grit(u, u, '#8a8276', '#d5cbb8'),
        ],
      }
    case 'path-diagonal':
      return {
        w: u,
        h: u,
        nodes: [
          fill(0, 0, u, u, 'rgba(168,160,148,0.48)'),
          { kind: 'path', d: `M 0 ${f(u)} L ${f(u)} 0 M 0 ${f(u / 2)} L ${f(u / 2)} 0 M ${f(u / 2)} ${f(u)} L ${f(u)} ${f(u / 2)}`, stroke: '#6e675e', width: 1 },
          ...grit(u, u, '#8a8276', '#d5cbb8'),
        ],
      }
    case 'path-brick':
      return brick(u)
    case 'path-honey': {
      const honey = honeycomb(u)
      return {
        w: honey.w,
        h: honey.h,
        nodes: [
          fill(0, 0, honey.w, honey.h, 'rgba(168,160,148,0.48)'),
          { kind: 'path', d: honey.d, stroke: '#6e675e', width: 1 },
          ...honeyDots(u),
        ],
      }
    }
    case 'concrete':
      return {
        w: u,
        h: u,
        nodes: [
          fill(0, 0, u, u, 'rgba(186,186,182,0.58)'),
          { kind: 'path', d: `M 0 ${f(u / 2)} L ${f(u)} ${f(u / 2)} M ${f(u / 2)} 0 L ${f(u / 2)} ${f(u)}`, stroke: '#8a8a86', width: 1.15 },
          ...grit(u, u, '#6a6a66', '#f4f4f0'),
        ],
      }
    case 'water':
      return waves(u)
    case 'building':
      return {
        w: u,
        h: u,
        nodes: [
          fill(0, 0, u, u, 'rgba(118,108,100,0.55)'),
          { kind: 'path', d: diagonal(u), stroke: '#4e4842', width: 1.05 },
        ],
      }
    default: {
      const never: never = id
      return never
    }
  }
}

/** Один <pattern> для печатного листа или другого SVG. */
export function hatchPatternMarkup(id: HatchId, ppm: number, patternId: string): string {
  const tile = hatchTile(id, ppm)
  const body = tile.nodes.map(paintNode).join('')
  return `<pattern id="${patternId}" width="${f(tile.w)}" height="${f(tile.h)}" patternUnits="userSpaceOnUse">${body}</pattern>`
}

function fill(x: number, y: number, w: number, h: number, color: string): HatchNode {
  return { kind: 'fill', x, y, w, h, fill: color }
}

function grass(w: number, h: number): HatchNode[] {
  const spots: [number, number, number][] = [
    [0.18, 0.38, -0.15],
    [0.42, 0.34, 0.2],
    [0.68, 0.42, -0.05],
    [0.86, 0.36, 0.12],
    [0.28, 0.58, 0.28],
    [0.54, 0.52, -0.22],
    [0.78, 0.64, 0.08],
    [0.16, 0.82, -0.08],
    [0.4, 0.78, 0.18],
    [0.64, 0.88, -0.25],
    [0.86, 0.76, 0.04],
  ]
  let dark = ''
  let light = ''
  const unit = Math.min(w, h)
  spots.forEach(([fx, fy, turn], index) => {
    const x = fx * w
    const y = fy * h
    const len = unit * (index % 2 ? 0.2 : 0.15)
    const piece = tuft(x, y, len, turn)
    if (index % 3 === 0) light += `${piece} `
    else dark += `${piece} `
  })
  return [
    { kind: 'path', d: dark.trim(), stroke: '#1f5c2e', width: 1.45, cap: 'round' },
    { kind: 'path', d: light.trim(), stroke: '#d4f0a8', width: 1.2, cap: 'round' },
  ]
}

function tuft(x: number, y: number, len: number, turn: number): string {
  const aim = -Math.PI / 2 + turn
  const tips = [aim - 0.42, aim, aim + 0.4]
  return tips.map((angle, index) => {
    const reach = index === 1 ? len : len * 0.82
    return `M ${f(x)} ${f(y)} L ${f(x + Math.cos(angle) * reach)} ${f(y + Math.sin(angle) * reach)}`
  }).join(' ')
}

function flowers(u: number): HatchNode[] {
  const blooms: [number, number, number, string][] = [
    [0.24, 0.3, 0.13, '#d24b55'],
    [0.68, 0.28, 0.11, '#e2b23a'],
    [0.46, 0.68, 0.12, '#e07aa0'],
    [0.8, 0.74, 0.1, '#f3f0e6'],
  ]
  const nodes: HatchNode[] = []
  for (const [fx, fy, scale, color] of blooms) nodes.push(...blossom(fx * u, fy * u, u * scale, color))
  nodes.push(
    { kind: 'dot', cx: u * 0.16, cy: u * 0.72, r: u * 0.045, fill: '#3f8a3a' },
    { kind: 'dot', cx: u * 0.58, cy: u * 0.18, r: u * 0.04, fill: '#2f6e32' },
    { kind: 'path', d: `M ${f(u * 0.12)} ${f(u * 0.78)} Q ${f(u * 0.2)} ${f(u * 0.62)} ${f(u * 0.3)} ${f(u * 0.74)}`, stroke: '#2f6e32', width: 0.9, cap: 'round' },
  )
  return nodes
}

function blossom(cx: number, cy: number, r: number, color: string): HatchNode[] {
  const petals: HatchNode[] = []
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i / 5) * Math.PI * 2
    petals.push({
      kind: 'dot',
      cx: cx + Math.cos(angle) * r * 0.62,
      cy: cy + Math.sin(angle) * r * 0.62,
      r: r * 0.48,
      fill: color,
    })
  }
  petals.push({ kind: 'dot', cx, cy, r: r * 0.32, fill: '#fff6d2' })
  return petals
}

function mulch(u: number): HatchNode[] {
  const chips: [number, number, number, number, number, string][] = [
    [0.2, 0.28, 0.16, 0.07, 28, '#4a2e16'],
    [0.46, 0.18, 0.13, 0.055, -18, '#7a5230'],
    [0.72, 0.32, 0.15, 0.06, 50, '#5c3a1e'],
    [0.3, 0.55, 0.12, 0.05, -40, '#8a6840'],
    [0.58, 0.48, 0.17, 0.065, 12, '#3e2814'],
    [0.82, 0.62, 0.11, 0.05, -55, '#6b4424'],
    [0.18, 0.78, 0.14, 0.055, 36, '#7a5230'],
    [0.48, 0.8, 0.16, 0.06, -8, '#4a2e16'],
    [0.74, 0.84, 0.12, 0.045, 22, '#a07848'],
  ]
  const nodes: HatchNode[] = chips.map(([fx, fy, rx, ry, turn, color]) => ({
    kind: 'chip',
    cx: fx * u,
    cy: fy * u,
    rx: rx * u,
    ry: ry * u,
    turn,
    fill: color,
  }))
  nodes.push(
    { kind: 'dot', cx: u * 0.36, cy: u * 0.36, r: u * 0.03, fill: '#2c1c10' },
    { kind: 'dot', cx: u * 0.9, cy: u * 0.16, r: u * 0.025, fill: '#c4a078' },
    { kind: 'dot', cx: u * 0.1, cy: u * 0.48, r: u * 0.028, fill: '#5c3a1e' },
  )
  return nodes
}

function shrubs(size: number): HatchNode[] {
  const spots: [number, number, number][] = [
    [0.3, 0.34, 0.2],
    [0.72, 0.6, 0.17],
    [0.4, 0.78, 0.11],
  ]
  const nodes: HatchNode[] = []
  for (const [fx, fy, scale] of spots) {
    const cx = fx * size
    const cy = fy * size
    const r = size * scale
    nodes.push(
      { kind: 'dot', cx, cy, r, fill: '#245c32' },
      { kind: 'dot', cx: cx - r * 0.38, cy: cy + r * 0.22, r: r * 0.7, fill: '#3d8a48' },
      { kind: 'dot', cx: cx + r * 0.36, cy: cy - r * 0.16, r: r * 0.58, fill: '#8ec878' },
    )
  }
  return nodes
}

function grit(w: number, h: number, dark: string, light: string): HatchNode[] {
  const spots: [number, number, number, number][] = [
    [0.18, 0.22, 0.035, 0],
    [0.62, 0.16, 0.025, 1],
    [0.84, 0.38, 0.04, 0],
    [0.3, 0.7, 0.03, 1],
    [0.72, 0.78, 0.028, 0],
    [0.12, 0.58, 0.022, 1],
    [0.48, 0.42, 0.02, 0],
  ]
  return spots.map(([fx, fy, scale, tone]) => ({
    kind: 'dot',
    cx: fx * w,
    cy: fy * h,
    r: Math.max(0.6, Math.min(w, h) * scale),
    fill: tone ? light : dark,
  }))
}

function brick(u: number): HatchTile {
  const w = u * 2
  const h = u
  return {
    w,
    h,
    nodes: [
      fill(0, 0, w, h, 'rgba(176,150,128,0.5)'),
      fill(0, 0, u, h / 2, 'rgba(120,92,72,0.16)'),
      fill(u / 2, h / 2, u, h / 2, 'rgba(120,92,72,0.14)'),
      {
        kind: 'path',
        d: `M 0 ${f(h / 2)} L ${f(w)} ${f(h / 2)} M ${f(u)} 0 L ${f(u)} ${f(h / 2)} M ${f(u / 2)} ${f(h / 2)} L ${f(u / 2)} ${f(h)} M ${f(u * 1.5)} ${f(h / 2)} L ${f(u * 1.5)} ${f(h)}`,
        stroke: '#6e675e',
        width: 1.05,
      },
      { kind: 'dot', cx: u * 0.35, cy: h * 0.25, r: Math.max(0.6, u * 0.03), fill: '#8a7260' },
      { kind: 'dot', cx: u * 1.35, cy: h * 0.72, r: Math.max(0.6, u * 0.025), fill: '#f0e4d4' },
    ],
  }
}

function honeyDots(u: number): HatchNode[] {
  const r = u * 0.62
  const w = Math.sqrt(3) * r
  const row = r * 1.5
  const dot = Math.max(0.8, u * 0.055)
  return [
    { kind: 'dot', cx: w / 2, cy: r, r: dot, fill: '#9a9286' },
    { kind: 'dot', cx: 0, cy: r + row, r: dot, fill: '#9a9286' },
    { kind: 'dot', cx: w, cy: r + row, r: dot, fill: '#9a9286' },
  ]
}

function waves(u: number): HatchTile {
  const w = u * 2
  const h = u
  const line = (y: number, amp: number) => {
    const mid = w / 2
    return `M 0 ${f(y)} Q ${f(w * 0.25)} ${f(y - amp)} ${f(mid)} ${f(y)} T ${f(w)} ${f(y)}`
  }
  return {
    w,
    h,
    nodes: [
      fill(0, 0, w, h, 'rgba(78,148,196,0.38)'),
      { kind: 'path', d: line(h * 0.28, h * 0.1), stroke: '#2f6f9a', width: 1.35, cap: 'round' },
      { kind: 'path', d: line(h * 0.52, h * 0.08), stroke: '#7eb6d4', width: 1.15, cap: 'round' },
      { kind: 'path', d: line(h * 0.76, h * 0.1), stroke: '#2a6288', width: 1.25, cap: 'round' },
    ],
  }
}

function diagonal(size: number): string {
  const parts: string[] = []
  const step = size / 4
  for (let i = 1; i <= 3; i++) {
    const d = step * i
    parts.push(`M 0 ${f(d)} L ${f(size - d)} ${f(size)}`)
    parts.push(`M ${f(d)} 0 L ${f(size)} ${f(size - d)}`)
  }
  parts.push(`M 0 0 L ${f(size)} ${f(size)}`)
  return parts.join(' ')
}

function paintNode(node: HatchNode): string {
  if (node.kind === 'fill') {
    return `<rect x="${f(node.x)}" y="${f(node.y)}" width="${f(node.w)}" height="${f(node.h)}" fill="${node.fill}"/>`
  }
  if (node.kind === 'dot') {
    return `<circle cx="${f(node.cx)}" cy="${f(node.cy)}" r="${f(node.r)}" fill="${node.fill}"/>`
  }
  if (node.kind === 'chip') {
    return `<ellipse cx="${f(node.cx)}" cy="${f(node.cy)}" rx="${f(node.rx)}" ry="${f(node.ry)}" fill="${node.fill}" transform="rotate(${f(node.turn)} ${f(node.cx)} ${f(node.cy)})"/>`
  }
  return `<path d="${node.d}" fill="none" stroke="${node.stroke}" stroke-width="${f(node.width ?? 1)}" stroke-linecap="${node.cap ?? 'butt'}"/>`
}

function f(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
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
