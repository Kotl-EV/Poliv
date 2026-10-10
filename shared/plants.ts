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

export type PlantGlyph = { fills: string[]; shade?: number[]; veins: string[]; dots: PlantDot[] }

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

/** 0 — основной зелёный, 1 — светлая шапка, −1 — тень снизу. */
export function crownFill(paint: PlantPaint, shade = 0): string {
  if (shade > 0.2) return mixHex(paint.leaf, '#f7f3ea', 0.4)
  if (shade < -0.2) return mixHex(paint.leaf, '#102016', 0.42)
  return paint.leaf
}

export function plantGlyph(form: PlantForm): PlantGlyph {
  if (form === 'round') {
    return drawn(
      [circle(1), circle(0.62), disk(-0.16, -0.22, 0.28)],
      [-1, 0, 1],
      ribs(8, 0.72, -Math.PI / 2),
      [trunk(0, 0, 0.08)],
    )
  }
  if (form === 'leaf') {
    return drawn(
      [
        scallop({ count: 11, inner: 0.74, outer: 1, turn: -Math.PI / 2, wobble: 0.07 }),
        scallop({ count: 7, inner: 0.42, outer: 0.66, turn: 0.5, wobble: 0.1 }),
        disk(-0.2, -0.24, 0.26),
      ],
      [-1, 0, 1],
      ribs(7, 0.7, -Math.PI / 2),
      [trunk(0, 0, 0.07)],
    )
  }
  if (form === 'spread') {
    const crowns = [{ x: 0, y: 0, r: 0.58, turn: 0.2 }, ...around(5, 0.42, -Math.PI / 2).map((spot, i) => ({ ...spot, r: 0.48, turn: i * 0.7 }))]
    return drawn(
      crowns.map((spot) => scallop({ count: 8, inner: spot.r * 0.7, outer: spot.r, turn: spot.turn, wobble: 0.09, cx: spot.x, cy: spot.y })),
      [-1, 0, 1, 0, 1, 0],
      ribs(5, 0.35, 0.4),
      [trunk(0, 0, 0.065)],
    )
  }
  if (form === 'conifer') {
    return drawn(
      [star(18, 0.55, 1, -Math.PI / 2), star(12, 0.28, 0.62, 0.15), disk(-0.08, -0.12, 0.16)],
      [0, -1, 1],
      [circle(0.28), ...ribs(8, 0.78, -Math.PI / 2)],
      [trunk(0, 0, 0.07)],
    )
  }
  if (form === 'column') {
    return drawn(
      [
        scallop({ count: 10, inner: 0.78, outer: 1, turn: -Math.PI / 2, wobble: 0.03, sx: 0.46, sy: 1 }),
        scallop({ count: 8, inner: 0.7, outer: 0.86, turn: 0.2, wobble: 0.02, sx: 0.32, sy: 0.82 }),
        disk(0, -0.15, 0.12),
      ],
      [-1, 0, 1],
      ribs(5, 0.72, -Math.PI / 2, 0.46, 1),
      [trunk(0, 0.2, 0.05)],
    )
  }
  if (form === 'weep') {
    return drawn(
      [
        scallop({ count: 16, inner: 0.86, outer: 1, turn: -Math.PI / 2, wobble: 0.04 }),
        circle(0.58),
        disk(-0.12, -0.16, 0.22),
      ],
      [-1, 0, 1],
      [circle(0.34), ...ribs(12, 0.9, -Math.PI / 2)],
      [trunk(0, 0, 0.06)],
    )
  }
  if (form === 'palm') {
    const fills: string[] = []
    const shade: number[] = []
    for (let i = 0; i < 9; i++) {
      const angle = -Math.PI / 2 + (i / 9) * TAU
      fills.push(frond(angle, 0.78 + (i % 3) * 0.1, 0.11 + (i % 2) * 0.03))
      shade.push(i % 2 === 0 ? -1 : 0)
    }
    for (let i = 0; i < 6; i++) {
      fills.push(frond(-Math.PI / 2 + (i / 6) * TAU + 0.3, 0.42, 0.07))
      shade.push(1)
    }
    return drawn(fills, shade, [], [trunk(0, 0, 0.1), trunk(0, 0, 0.045)])
  }
  if (form === 'clump') {
    const spots = around(3, 0.36, -Math.PI / 2)
    return drawn(
      [
        ...spots.map((spot, i) => scallop({ count: 8, inner: 0.4, outer: 0.58, turn: i, wobble: 0.07, cx: spot.x, cy: spot.y })),
        ...spots.map((spot) => disk(spot.x - 0.08, spot.y - 0.1, 0.16)),
      ],
      [-1, 0, -1, 1, 1, 1],
      [],
      spots.map((spot) => trunk(spot.x, spot.y, 0.045)),
    )
  }
  if (form === 'oak') {
    return drawn(
      [
        scallop({ count: 8, inner: 0.58, outer: 1, turn: 0.35, wobble: 0.16, sx: 1.12, sy: 1.02 }),
        scallop({ count: 6, inner: 0.4, outer: 0.62, turn: 1.2, wobble: 0.12, sx: 0.85, sy: 0.75 }),
        disk(-0.18, -0.16, 0.22),
      ],
      [-1, 0, 1],
      ribs(6, 0.62, 0.2, 1.05, 0.95),
      [trunk(0, 0.05, 0.09)],
    )
  }
  if (form === 'pine') {
    return drawn(
      [star(11, 0.34, 1, -Math.PI / 2), star(8, 0.16, 0.48, 0.3), disk(-0.06, -0.08, 0.12)],
      [0, -1, 1],
      ribs(11, 0.86, -Math.PI / 2),
      [trunk(0, 0, 0.055)],
    )
  }
  if (form === 'spruce') {
    return drawn(
      [star(14, 0.52, 1, 0.1), star(10, 0.28, 0.62, 0.4), star(7, 0.12, 0.32, 0.7)],
      [0, -1, 1],
      ribs(6, 0.4, 0.2),
      [trunk(0, 0, 0.05)],
    )
  }
  if (form === 'birch') {
    return drawn(
      [
        scallop({ count: 14, inner: 0.82, outer: 1, turn: 0.1, wobble: 0.03, sx: 0.72, sy: 1.05 }),
        scallop({ count: 8, inner: 0.62, outer: 0.78, turn: 0.4, wobble: 0.04, sx: 0.48, sy: 0.72 }),
      ],
      [0, 1],
      ribs(6, 0.55, -0.5, 0.7, 1),
      [trunk(0, 0.08, 0.055), ...around(8, 0.38, 0.2).map((spot) => ({ x: spot.x * 0.85, y: spot.y, r: 0.03, bloom: true }))],
    )
  }
  if (form === 'fruit') {
    return drawn(
      [
        scallop({ count: 12, inner: 0.8, outer: 1, turn: 0.5, wobble: 0.05 }),
        circle(0.55),
        disk(-0.14, -0.18, 0.2),
      ],
      [-1, 0, 1],
      ribs(6, 0.5, 0.3),
      [trunk(0, 0, 0.05), ...around(9, 0.52, -0.2).map((spot, i) => ({ x: spot.x, y: spot.y, r: i % 3 === 0 ? 0.1 : 0.07, bloom: true }))],
    )
  }
  if (form === 'olive') {
    return drawn(
      [
        scallop({ count: 10, inner: 0.68, outer: 1, turn: 1.1, wobble: 0.1, sx: 1.16, sy: 0.74 }),
        scallop({ count: 7, inner: 0.4, outer: 0.58, turn: 0.4, wobble: 0.08, sx: 0.9, sy: 0.5 }),
        disk(-0.22, -0.08, 0.16),
      ],
      [-1, 0, 1],
      ribs(6, 0.55, 0.5, 1.1, 0.7),
      [trunk(0, 0.04, 0.06)],
    )
  }
  if (form === 'cypress') {
    return drawn(
      [
        scallop({ count: 12, inner: 0.86, outer: 1, turn: -0.2, wobble: 0.02, sx: 0.3, sy: 1.08 }),
        scallop({ count: 8, inner: 0.75, outer: 0.9, turn: 0.3, wobble: 0.02, sx: 0.18, sy: 0.72 }),
        disk(0, -0.2, 0.07),
      ],
      [-1, 0, 1],
      ribs(4, 0.8, -Math.PI / 2, 0.28, 1.05),
      [trunk(0, 0.35, 0.04)],
    )
  }
  if (form === 'bamboo') {
    const stems = [-0.48, -0.16, 0.16, 0.48]
    const fills = stems.map((x, index) => scallop({ count: 8, inner: 0.55, outer: 0.95, turn: index * 0.5, wobble: 0.03, sx: 0.14, sy: 1.02, cx: x, cy: (index % 2) * 0.04 }))
    for (const x of stems) fills.push(frond(-Math.PI / 2 + x, 0.42, 0.08))
    return drawn(
      fills,
      [-1, 0, -1, 0, 1, 1, 1, 1],
      [],
      stems.flatMap((x) => [trunk(x, 0.2, 0.03), trunk(x, -0.15, 0.025)]),
    )
  }
  if (form === 'ball') {
    return drawn(
      [
        scallop({ count: 9, inner: 0.72, outer: 1, turn: 0.4, wobble: 0.08 }),
        circle(0.58),
        disk(-0.14, -0.18, 0.24),
      ],
      [-1, 0, 1],
      ribs(6, 0.55, 0.2),
      [],
    )
  }
  if (form === 'wide') {
    const spots = [{ x: -0.42, y: 0.06 }, { x: 0, y: -0.1 }, { x: 0.42, y: 0.08 }]
    return drawn(
      [
        ...spots.map((spot, i) => scallop({ count: 7, inner: 0.34, outer: 0.5, turn: i * 0.8, wobble: 0.1, cx: spot.x, cy: spot.y })),
        ...spots.map((spot) => disk(spot.x - 0.08, spot.y - 0.1, 0.16)),
      ],
      [-1, 0, -1, 1, 1, 1],
      [],
      [],
    )
  }
  if (form === 'needle') {
    return drawn(
      [star(12, 0.58, 1, -Math.PI / 2), star(8, 0.22, 0.5, 0.2), disk(-0.06, -0.08, 0.14)],
      [0, -1, 1],
      ribs(8, 0.7, -Math.PI / 2),
      [],
    )
  }
  if (form === 'bloom') {
    return drawn(
      [
        scallop({ count: 8, inner: 0.7, outer: 1, turn: 0.2, wobble: 0.06 }),
        circle(0.48),
        disk(-0.12, -0.14, 0.18),
      ],
      [-1, 0, 1],
      ribs(5, 0.45, 0.5),
      around(7, 0.62, -Math.PI / 2).map((spot, i) => ({ x: spot.x, y: spot.y, r: i % 2 ? 0.12 : 0.08, bloom: true })),
    )
  }
  if (form === 'group') {
    const spots = [{ x: -0.3, y: 0.16, r: 0.5 }, { x: 0.32, y: 0.12, r: 0.46 }, { x: 0.02, y: -0.3, r: 0.42 }]
    return drawn(
      [
        ...spots.map((spot, i) => scallop({ count: 7, inner: spot.r * 0.68, outer: spot.r, turn: i, wobble: 0.08, cx: spot.x, cy: spot.y })),
        ...spots.map((spot) => disk(spot.x - 0.06, spot.y - 0.08, spot.r * 0.35)),
      ],
      [-1, 0, -1, 1, 1, 1],
      [],
      spots.map((spot) => trunk(spot.x, spot.y + 0.04, 0.035)),
    )
  }
  if (form === 'hedge') {
    return drawn(
      [
        scallop({ count: 18, inner: 0.86, outer: 1, turn: 0.04, wobble: 0.02, sx: 1.18, sy: 0.46 }),
        scallop({ count: 12, inner: 0.8, outer: 0.92, turn: 0.2, wobble: 0.015, sx: 1.02, sy: 0.24 }),
      ],
      [-1, 1],
      [-0.7, -0.35, 0, 0.35, 0.7].map((x) => `M ${num(x)} -0.28 L ${num(x)} 0.28`),
      [],
    )
  }
  if (form === 'rose') {
    return drawn(
      [
        scallop({ count: 7, inner: 0.5, outer: 0.86, turn: 0.6, wobble: 0.07 }),
        circle(0.36),
        disk(-0.08, -0.1, 0.14),
      ],
      [-1, 0, 1],
      ribs(5, 0.4, 0.4),
      around(5, 0.22, 0.3).map((spot) => ({ x: spot.x, y: spot.y, r: 0.13, bloom: true })),
    )
  }
  if (form === 'box') {
    return drawn(
      [roundedBox(0.82, 0.14), roundedBox(0.48, 0.08)],
      [-1, 1],
      ['M -0.7 0 H 0.7', 'M 0 -0.7 V 0.7'],
      [],
    )
  }
  if (form === 'fern') {
    const fills: string[] = []
    const shade: number[] = []
    for (let i = 0; i < 8; i++) {
      fills.push(frond(-Math.PI / 2 + (i / 8) * TAU, 0.78 + (i % 3) * 0.08, 0.09))
      shade.push(i % 2 ? 0 : -1)
    }
    for (let i = 0; i < 8; i++) {
      fills.push(frond(-Math.PI / 2 + ((i + 0.5) / 8) * TAU, 0.4, 0.05))
      shade.push(1)
    }
    return drawn(fills, shade, [], [trunk(0, 0, 0.04)])
  }
  if (form === 'grass') {
    const stems = [-0.55, -0.28, 0, 0.28, 0.55]
    return drawn(
      stems.map((x, index) => scallop({ count: 6, inner: 0.48, outer: 0.96, turn: -1.15 + index * 0.04, wobble: 0.05, sx: 0.12, sy: 1.05, cx: x, cy: 0 })),
      [-1, 0, 1, 0, -1],
      [],
      stems.map((x, index) => ({ x, y: -0.72 - (index % 2) * 0.08, r: 0.045, bloom: true })),
    )
  }
  if (form === 'spiral') {
    return drawn(
      [scallop({ count: 20, inner: 0.94, outer: 1, turn: 0.15, wobble: 0.012 }), circle(0.62), circle(0.28)],
      [-1, 0, 1],
      [circle(0.78), circle(0.46)],
      [trunk(0, 0, 0.05)],
    )
  }
  return drawn(
    [
      scallop({ count: 10, inner: 0.72, outer: 1, turn: 0.15, wobble: 0.05, sx: 1.15, sy: 0.62 }),
      scallop({ count: 8, inner: 0.5, outer: 0.7, turn: 0.8, wobble: 0.06, sx: 0.9, sy: 0.4 }),
      disk(-0.16, -0.08, 0.16),
    ],
    [-1, 0, 1],
    ribs(5, 0.4, 0.2, 1.05, 0.55),
    around(6, 0.55, 0.4).map((spot) => ({ x: spot.x * 0.85, y: spot.y * 0.5, r: 0.06, bloom: true })),
  )
}

export function plantMarkup(plant: Plant, ppm: number, k: number): string {
  const radius = Math.max(plant.radiusM * ppm, 4)
  const form = formOf(plant)
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  const pen = num(1.25 / k)
  const vein = num(0.9 / k)
  const fills = glyph.fills.map((d, index) => `<path d="${d}" fill="${crownFill(paint, glyph.shade?.[index] ?? 0)}" stroke="${paint.ink}" stroke-width="${pen}" vector-effect="non-scaling-stroke"/>`).join('')
  const veins = glyph.veins.map((d) => `<path d="${d}" fill="none" stroke="${paint.vein}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`).join('')
  const dots = glyph.dots.map((dot) => {
    const fill = dot.bloom ? paint.accent : paint.trunk
    const stroke = dot.bloom ? paint.ink : '#3e2614'
    return `<circle cx="${num(dot.x)}" cy="${num(dot.y)}" r="${num(dot.r)}" fill="${fill}" stroke="${stroke}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`
  }).join('')
  return `<g transform="translate(${num(plant.x)} ${num(plant.y)}) scale(${num(radius)})">${fills}${veins}${dots}</g>`
}

function drawn(fills: string[], shade: number[], veins: string[], dots: PlantDot[]): PlantGlyph {
  return { fills, shade, veins, dots }
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
  return disk(0, 0, r)
}

function disk(cx: number, cy: number, r: number): string {
  return `M ${num(cx + r)} ${num(cy)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx - r)} ${num(cy)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx + r)} ${num(cy)} Z`
}

function mixHex(from: string, to: string, t: number): string {
  const a = Number.parseInt(from.slice(1), 16)
  const b = Number.parseInt(to.slice(1), 16)
  const ch = (shift: number) => {
    const left = (a >> shift) & 255
    const right = (b >> shift) & 255
    return Math.round(left + (right - left) * t).toString(16).padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
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
