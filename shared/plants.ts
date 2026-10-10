import type { Plant, PlantForm, PlantKind } from './types.ts'

const TAU = Math.PI * 2

export const TREE_FORMS: { id: PlantForm; label: string }[] = [
  { id: 'leaf', label: 'Лиственное' },
  { id: 'round', label: 'Круглое' },
  { id: 'spread', label: 'Раскидистое' },
  { id: 'conifer', label: 'Хвойное' },
  { id: 'column', label: 'Колонна' },
  { id: 'weep', label: 'Плакучее' },
  { id: 'palm', label: 'Пальма' },
  { id: 'clump', label: 'Многоствольное' },
  { id: 'oak', label: 'Дуб' },
  { id: 'pine', label: 'Сосна' },
  { id: 'spruce', label: 'Ель' },
  { id: 'birch', label: 'Берёза' },
  { id: 'fruit', label: 'Плодовое' },
  { id: 'olive', label: 'Олива' },
  { id: 'cypress', label: 'Кипарис' },
  { id: 'bamboo', label: 'Бамбук' },
]

export const BUSH_FORMS: { id: PlantForm; label: string }[] = [
  { id: 'ball', label: 'Шаровидный' },
  { id: 'wide', label: 'Раскидистый' },
  { id: 'needle', label: 'Хвойный' },
  { id: 'bloom', label: 'Цветущий' },
  { id: 'group', label: 'Группа' },
  { id: 'cushion', label: 'Подушка' },
  { id: 'hedge', label: 'Изгородь' },
  { id: 'rose', label: 'Роза' },
  { id: 'box', label: 'Самшит' },
  { id: 'fern', label: 'Папоротник' },
  { id: 'grass', label: 'Злак' },
  { id: 'spiral', label: 'Спираль' },
]

export type PlantPaint = { leaf: string; ink: string; vein: string; trunk: string; accent: string }

export type PlantDot = { x: number; y: number; r: number; bloom?: boolean }

export type PlantGlyph = { fills: string[]; veins: string[]; dots: PlantDot[] }

const PAINT: Record<PlantForm, PlantPaint> = {
  leaf: { leaf: '#3e7c3a', ink: '#1b4a22', vein: '#2c6430', trunk: '#6b4423', accent: '#e7b7c6' },
  round: { leaf: '#4a8a40', ink: '#1d4e24', vein: '#326c38', trunk: '#6b4423', accent: '#e7b7c6' },
  spread: { leaf: '#3a7438', ink: '#173f20', vein: '#2a5c30', trunk: '#5c3a1e', accent: '#e7b7c6' },
  conifer: { leaf: '#1e4a34', ink: '#12382a', vein: '#163828', trunk: '#4a3420', accent: '#d7e2c8' },
  column: { leaf: '#24563a', ink: '#123224', vein: '#1c4630', trunk: '#4a3420', accent: '#d7e2c8' },
  weep: { leaf: '#4c8648', ink: '#1e4c28', vein: '#3a7040', trunk: '#6b4423', accent: '#e7b7c6' },
  palm: { leaf: '#2f8a4a', ink: '#145c2c', vein: '#1f6e38', trunk: '#8a5a2a', accent: '#d8ecb0' },
  clump: { leaf: '#3d7840', ink: '#1a4624', vein: '#2d6234', trunk: '#6b4423', accent: '#e7b7c6' },
  ball: { leaf: '#4e8c46', ink: '#1e5228', vein: '#3a7440', trunk: '#6b4423', accent: '#f0c3d0' },
  wide: { leaf: '#468044', ink: '#1a4a26', vein: '#326838', trunk: '#6b4423', accent: '#f0c3d0' },
  needle: { leaf: '#2a5840', ink: '#123226', vein: '#1e4634', trunk: '#4a3420', accent: '#d7e2c8' },
  bloom: { leaf: '#4a8648', ink: '#1c4e28', vein: '#356c3c', trunk: '#6b4423', accent: '#e7a0b8' },
  group: { leaf: '#3f7a42', ink: '#184422', vein: '#2e6236', trunk: '#6b4423', accent: '#f2d2a8' },
  cushion: { leaf: '#5a9460', ink: '#24562e', vein: '#467850', trunk: '#6b4423', accent: '#f0c3d0' },
  oak: { leaf: '#2f6a32', ink: '#14381c', vein: '#245628', trunk: '#5c3a1e', accent: '#e7b7c6' },
  pine: { leaf: '#3d7a48', ink: '#1a4a28', vein: '#2f6840', trunk: '#6b4423', accent: '#d7e2c8' },
  spruce: { leaf: '#1a4030', ink: '#0e2c22', vein: '#163628', trunk: '#4a3420', accent: '#d7e2c8' },
  birch: { leaf: '#c5d6a8', ink: '#4a6244', vein: '#7a9460', trunk: '#d2c2a6', accent: '#4a3b2a' },
  fruit: { leaf: '#4e8a3c', ink: '#1e4e22', vein: '#3a7034', trunk: '#6b4423', accent: '#d24a3a' },
  olive: { leaf: '#8d9a62', ink: '#3e4a28', vein: '#667244', trunk: '#6b4423', accent: '#e7e2c0' },
  cypress: { leaf: '#1d4634', ink: '#10281c', vein: '#183828', trunk: '#4a3420', accent: '#d7e2c8' },
  bamboo: { leaf: '#7aaa3a', ink: '#3a6218', vein: '#5c8a28', trunk: '#c4a05a', accent: '#d8ecb0' },
  hedge: { leaf: '#3a7840', ink: '#184422', vein: '#2c6234', trunk: '#6b4423', accent: '#e7b7c6' },
  rose: { leaf: '#3f7a34', ink: '#1a441c', vein: '#2e6230', trunk: '#6b4423', accent: '#c4365a' },
  box: { leaf: '#2f6e3a', ink: '#14341c', vein: '#245c30', trunk: '#6b4423', accent: '#d7e2c8' },
  fern: { leaf: '#4a9a48', ink: '#1e5a28', vein: '#3a8438', trunk: '#5c3a1e', accent: '#d8ecb0' },
  grass: { leaf: '#6aaa4a', ink: '#2e6a28', vein: '#4e8a38', trunk: '#c4a05a', accent: '#e7e2c0' },
  spiral: { leaf: '#3d7a44', ink: '#184422', vein: '#2a5c34', trunk: '#6b4423', accent: '#d7e2c8' },
}

export function formsFor(kind: PlantKind): { id: PlantForm; label: string }[] {
  return kind === 'tree' ? TREE_FORMS : BUSH_FORMS
}

export function formOf(plant: { kind: PlantKind; form?: string | null }): PlantForm {
  const hit = formsFor(plant.kind).find((item) => item.id === plant.form)
  return hit ? hit.id : plant.kind === 'tree' ? 'leaf' : 'ball'
}

/** Пустая строка — поля нет. null — документ сломан. */
export function parsePlantForm(value: unknown, kind: PlantKind): PlantForm | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  return formsFor(kind).find((item) => item.id === value)?.id
}

export function plantPaint(form: PlantForm): PlantPaint {
  return PAINT[form]
}

export function plantGlyph(form: PlantForm): PlantGlyph {
  if (form === 'round') {
    return { fills: [circle(1)], veins: ribs(6, 0.62, -Math.PI / 2), dots: [trunk(0, 0, 0.07)] }
  }
  if (form === 'leaf') {
    return {
      fills: [scallop({ count: 11, inner: 0.74, outer: 1, turn: -Math.PI / 2, wobble: 0.07 })],
      veins: ribs(7, 0.58, -Math.PI / 2),
      dots: [trunk(0, 0, 0.065)],
    }
  }
  if (form === 'spread') {
    const crowns = [{ x: 0, y: 0, r: 0.58, turn: 0.2 }, ...around(5, 0.4, -Math.PI / 2).map((spot, i) => ({ ...spot, r: 0.5, turn: i * 0.7 }))]
    return {
      fills: crowns.map((spot) => scallop({ count: 8, inner: spot.r * 0.72, outer: spot.r, turn: spot.turn, wobble: 0.08, cx: spot.x, cy: spot.y })),
      veins: [],
      dots: [trunk(0, 0, 0.06)],
    }
  }
  if (form === 'conifer') {
    return {
      fills: [star(18, 0.58, 1, -Math.PI / 2)],
      veins: [circle(0.22)],
      dots: [trunk(0, 0, 0.07)],
    }
  }
  if (form === 'column') {
    return {
      fills: [scallop({ count: 10, inner: 0.78, outer: 1, turn: -Math.PI / 2, wobble: 0.03, sx: 0.48, sy: 0.98 })],
      veins: ribs(5, 0.7, -Math.PI / 2, 0.48, 0.98),
      dots: [trunk(0, 0, 0.06)],
    }
  }
  if (form === 'weep') {
    return {
      fills: [scallop({ count: 16, inner: 0.86, outer: 1, turn: -Math.PI / 2, wobble: 0.04 })],
      veins: [circle(0.55), circle(0.32), ...ribs(10, 0.8, -Math.PI / 2)],
      dots: [trunk(0, 0, 0.055)],
    }
  }
  if (form === 'palm') {
    const fills: string[] = []
    for (let i = 0; i < 9; i++) {
      const angle = -Math.PI / 2 + (i / 9) * TAU
      const len = 0.78 + (i % 3) * 0.1
      fills.push(frond(angle, len, 0.1 + (i % 2) * 0.03))
    }
    return { fills, veins: [], dots: [trunk(0, 0, 0.09)] }
  }
  if (form === 'clump') {
    const spots = around(3, 0.34, -Math.PI / 2)
    return {
      fills: spots.map((spot, i) => scallop({ count: 8, inner: 0.42, outer: 0.58, turn: i, wobble: 0.06, cx: spot.x, cy: spot.y })),
      veins: [],
      dots: spots.map((spot) => trunk(spot.x, spot.y, 0.045)),
    }
  }
  if (form === 'oak') {
    return {
      fills: [scallop({ count: 8, inner: 0.62, outer: 1, turn: 0.35, wobble: 0.14, sx: 1.18, sy: 1.05 })],
      veins: ribs(6, 0.55, 0.2),
      dots: [trunk(0, 0, 0.07)],
    }
  }
  if (form === 'pine') {
    return {
      fills: [star(11, 0.42, 1, -Math.PI / 2)],
      veins: [circle(0.18)],
      dots: [trunk(0, 0, 0.06)],
    }
  }
  if (form === 'spruce') {
    return {
      fills: [star(14, 0.55, 1, 0.1), star(10, 0.32, 0.58, 0.4)],
      veins: [],
      dots: [trunk(0, 0, 0.055)],
    }
  }
  if (form === 'birch') {
    return {
      fills: [scallop({ count: 14, inner: 0.82, outer: 1, turn: 0.1, wobble: 0.03, sx: 0.78, sy: 1.08 })],
      veins: ribs(5, 0.5, -0.4, 0.78, 1.08),
      dots: [trunk(0, 0, 0.08), ...around(7, 0.42, 0.3).map((spot) => ({ x: spot.x, y: spot.y, r: 0.035, bloom: true }))],
    }
  }
  if (form === 'fruit') {
    return {
      fills: [scallop({ count: 12, inner: 0.8, outer: 1, turn: 0.5, wobble: 0.05 })],
      veins: ribs(5, 0.4, 0.2),
      dots: around(8, 0.55, -0.4).map((spot) => ({ x: spot.x, y: spot.y, r: 0.09, bloom: true })),
    }
  }
  if (form === 'olive') {
    return {
      fills: [scallop({ count: 10, inner: 0.7, outer: 1, turn: 1.1, wobble: 0.09, sx: 1.28, sy: 0.78 })],
      veins: ribs(5, 0.5, 0.4, 1.28, 0.78),
      dots: [trunk(0, 0, 0.06)],
    }
  }
  if (form === 'cypress') {
    return {
      fills: [scallop({ count: 12, inner: 0.86, outer: 1, turn: -0.2, wobble: 0.02, sx: 0.32, sy: 1.12 })],
      veins: ribs(4, 0.72, -Math.PI / 2, 0.32, 1.12),
      dots: [trunk(0, 0, 0.05)],
    }
  }
  if (form === 'bamboo') {
    const stems = [-0.55, -0.18, 0.18, 0.55]
    return {
      fills: stems.map((x, index) => scallop({ count: 8, inner: 0.55, outer: 0.9, turn: index * 0.4, wobble: 0.02, sx: 0.16, sy: 1.05, cx: x, cy: (index % 2) * 0.06 })),
      veins: [],
      dots: stems.map((x) => trunk(x, 0.15, 0.035)),
    }
  }
  if (form === 'ball') {
    return { fills: [scallop({ count: 9, inner: 0.7, outer: 1, turn: 0.4, wobble: 0.08 })], veins: ribs(5, 0.45, 0.2), dots: [] }
  }
  if (form === 'wide') {
    const spots = [{ x: -0.4, y: 0.05 }, { x: 0.02, y: -0.08 }, { x: 0.4, y: 0.06 }]
    return {
      fills: spots.map((spot, i) => scallop({ count: 7, inner: 0.36, outer: 0.52, turn: i * 0.8, wobble: 0.1, cx: spot.x, cy: spot.y })),
      veins: [],
      dots: [],
    }
  }
  if (form === 'needle') {
    return { fills: [star(12, 0.62, 1, -Math.PI / 2)], veins: [], dots: [] }
  }
  if (form === 'bloom') {
    return {
      fills: [scallop({ count: 8, inner: 0.72, outer: 1, turn: 0.2, wobble: 0.05 })],
      veins: ribs(4, 0.4, 0.4),
      dots: around(6, 0.62, -Math.PI / 2).map((spot) => ({ x: spot.x, y: spot.y, r: 0.11, bloom: true })),
    }
  }
  if (form === 'group') {
    const spots = [{ x: -0.28, y: 0.16, r: 0.48 }, { x: 0.3, y: 0.12, r: 0.44 }, { x: 0.02, y: -0.28, r: 0.4 }]
    return {
      fills: spots.map((spot, i) => scallop({ count: 7, inner: spot.r * 0.7, outer: spot.r, turn: i, wobble: 0.07, cx: spot.x, cy: spot.y })),
      veins: [],
      dots: [],
    }
  }
  if (form === 'hedge') {
    return {
      fills: [scallop({ count: 16, inner: 0.84, outer: 1, turn: 0.05, wobble: 0.025, sx: 1.55, sy: 0.42 })],
      veins: [],
      dots: [],
    }
  }
  if (form === 'rose') {
    return {
      fills: [scallop({ count: 7, inner: 0.55, outer: 0.82, turn: 0.6, wobble: 0.06 })],
      veins: ribs(5, 0.35, 0.3),
      dots: around(5, 0.28, 0.2).map((spot) => ({ x: spot.x, y: spot.y, r: 0.14, bloom: true })),
    }
  }
  if (form === 'box') {
    return { fills: [roundedBox(0.86, 0.16)], veins: [], dots: [] }
  }
  if (form === 'fern') {
    const fills: string[] = []
    for (let i = 0; i < 8; i++) fills.push(frond(-Math.PI / 2 + (i / 8) * TAU, 0.72 + (i % 3) * 0.1, 0.08))
    return { fills, veins: [], dots: [] }
  }
  if (form === 'grass') {
    const stems = [-0.55, -0.28, 0, 0.28, 0.55]
    return {
      fills: stems.map((x, index) => scallop({ count: 6, inner: 0.5, outer: 0.92, turn: -1.2 + index * 0.05, wobble: 0.04, sx: 0.13, sy: 1.08, cx: x, cy: 0.02 })),
      veins: [],
      dots: [],
    }
  }
  if (form === 'spiral') {
    return {
      fills: [scallop({ count: 20, inner: 0.94, outer: 1, turn: 0.15, wobble: 0.015 })],
      veins: [circle(0.7), circle(0.42), circle(0.18)],
      dots: [],
    }
  }
  const spots = around(5, 0.72, 0.3)
  return {
    fills: [scallop({ count: 10, inner: 0.78, outer: 1, turn: 0.15, wobble: 0.04, sx: 1.18, sy: 0.7 })],
    veins: [],
    dots: spots.map((spot) => ({ x: spot.x * 0.7, y: spot.y * 0.55, r: 0.07, bloom: true })),
  }
}

export function plantMarkup(plant: Plant, ppm: number, k: number): string {
  const radius = Math.max(plant.radiusM * ppm, 4)
  const form = formOf(plant)
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  const pen = num(1.25 / k)
  const vein = num(0.9 / k)
  const fills = glyph.fills.map((d) => `<path d="${d}" fill="${paint.leaf}" stroke="${paint.ink}" stroke-width="${pen}" vector-effect="non-scaling-stroke"/>`).join('')
  const veins = glyph.veins.map((d) => `<path d="${d}" fill="none" stroke="${paint.vein}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`).join('')
  const dots = glyph.dots.map((dot) => {
    const fill = dot.bloom ? paint.accent : paint.trunk
    const stroke = dot.bloom ? paint.ink : '#3e2614'
    return `<circle cx="${num(dot.x)}" cy="${num(dot.y)}" r="${num(dot.r)}" fill="${fill}" stroke="${stroke}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`
  }).join('')
  return `<g transform="translate(${num(plant.x)} ${num(plant.y)}) scale(${num(radius)})">${fills}${veins}${dots}</g>`
}

function trunk(x: number, y: number, r: number): PlantDot {
  return { x, y, r }
}

function around(count: number, dist: number, turn: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const angle = turn + (i / count) * TAU
    out.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist })
  }
  return out
}

function scallop(opt: {
  count: number
  inner: number
  outer: number
  turn: number
  wobble: number
  sx?: number
  sy?: number
  cx?: number
  cy?: number
}): string {
  const sx = opt.sx ?? 1
  const sy = opt.sy ?? 1
  const cx = opt.cx ?? 0
  const cy = opt.cy ?? 0
  const start = at(opt.inner, opt.turn, sx, sy, cx, cy)
  let d = `M ${num(start.x)} ${num(start.y)}`
  for (let i = 0; i < opt.count; i++) {
    const mid = opt.turn + ((i + 0.5) / opt.count) * TAU
    const end = opt.turn + ((i + 1) / opt.count) * TAU
    const wave = 1 + opt.wobble * Math.sin(i * 1.7 + opt.count)
    const c = at(opt.outer * wave, mid, sx, sy, cx, cy)
    const e = at(opt.inner, end, sx, sy, cx, cy)
    d += ` Q ${num(c.x)} ${num(c.y)} ${num(e.x)} ${num(e.y)}`
  }
  return `${d} Z`
}

function star(spikes: number, inner: number, outer: number, turn: number, sx = 1, sy = 1): string {
  const steps = spikes * 2
  let d = ''
  for (let i = 0; i < steps; i++) {
    const angle = turn + (i / steps) * TAU
    const radius = i % 2 === 0 ? outer * (1 + 0.035 * Math.sin(i * 0.9)) : inner
    const spot = at(radius, angle, sx, sy, 0, 0)
    d += `${i === 0 ? 'M' : ' L'} ${num(spot.x)} ${num(spot.y)}`
  }
  return `${d} Z`
}

function ribs(count: number, len: number, turn: number, sx = 1, sy = 1): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const angle = turn + (i / count) * TAU
    const c = at(len * 0.46, angle + 0.38, sx, sy, 0, 0)
    const e = at(len, angle, sx, sy, 0, 0)
    out.push(`M 0 0 Q ${num(c.x)} ${num(c.y)} ${num(e.x)} ${num(e.y)}`)
  }
  return out
}

function frond(angle: number, len: number, width: number): string {
  const tip = at(len, angle, 1, 1, 0, 0)
  const mid = at(len * 0.52, angle, 1, 1, 0, 0)
  const px = Math.cos(angle + Math.PI / 2) * width
  const py = Math.sin(angle + Math.PI / 2) * width
  return `M 0 0 Q ${num(mid.x + px)} ${num(mid.y + py)} ${num(tip.x)} ${num(tip.y)} Q ${num(mid.x - px)} ${num(mid.y - py)} 0 0 Z`
}

function circle(r: number): string {
  return `M ${num(r)} 0 A ${num(r)} ${num(r)} 0 1 1 ${num(-r)} 0 A ${num(r)} ${num(r)} 0 1 1 ${num(r)} 0 Z`
}

function roundedBox(size: number, radius: number): string {
  const x = -size
  const y = -size
  const x2 = size
  const y2 = size
  const r = Math.min(radius, size)
  return `M ${num(x + r)} ${num(y)} H ${num(x2 - r)} Q ${num(x2)} ${num(y)} ${num(x2)} ${num(y + r)} V ${num(y2 - r)} Q ${num(x2)} ${num(y2)} ${num(x2 - r)} ${num(y2)} H ${num(x + r)} Q ${num(x)} ${num(y2)} ${num(x)} ${num(y2 - r)} V ${num(y + r)} Q ${num(x)} ${num(y)} ${num(x + r)} ${num(y)} Z`
}

function at(radius: number, angle: number, sx: number, sy: number, cx: number, cy: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius * sx, y: cy + Math.sin(angle) * radius * sy }
}

function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
