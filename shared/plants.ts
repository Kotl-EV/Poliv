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

/** inked — сколько первых заливок получают обводку на плане. Дальше только цвет, иначе мелкая листва слипается. */
export type PlantGlyph = { fills: string[]; shade?: number[]; veins: string[]; dots: PlantDot[]; inked?: number }

const PAINT: Record<PlantForm, PlantPaint> = {
  leaf: { leaf: '#6fbe45', ink: '#3c7a28', vein: '#c4844a', trunk: '#a86b32', accent: '#e7b7c6' },
  round: { leaf: '#7ec84e', ink: '#4a8a32', vein: '#5c9a38', trunk: '#a86b32', accent: '#e7b7c6' },
  spread: { leaf: '#62b43e', ink: '#3a7828', vein: '#b56a3a', trunk: '#9a6230', accent: '#e7b7c6' },
  conifer: { leaf: '#1e4a34', ink: '#12382a', vein: '#6a4a30', trunk: '#4a3420', accent: '#d7e2c8' },
  column: { leaf: '#3f8f4a', ink: '#246034', vein: '#b56a3a', trunk: '#8a5a30', accent: '#d7e2c8' },
  weep: { leaf: '#78c255', ink: '#468a34', vein: '#c4844a', trunk: '#a86b32', accent: '#e7b7c6' },
  palm: { leaf: '#4cb85a', ink: '#2a7a38', vein: '#2f8a44', trunk: '#c4844a', accent: '#d8ecb0' },
  clump: { leaf: '#6ab844', ink: '#3e842c', vein: '#c4844a', trunk: '#a86b32', accent: '#e7b7c6' },
  ball: { leaf: '#5cb84a', ink: '#2f7a30', vein: '#b56a3a', trunk: '#8a5a30', accent: '#f0c3d0' },
  wide: { leaf: '#62b44a', ink: '#347a2c', vein: '#b56a3a', trunk: '#8a5a30', accent: '#e23d32' },
  needle: { leaf: '#2a6e52', ink: '#143828', vein: '#3a4030', trunk: '#4a3420', accent: '#c5d4bc' },
  bloom: { leaf: '#58b44c', ink: '#2f7a32', vein: '#b56a3a', trunk: '#8a5a30', accent: '#e25d86' },
  group: { leaf: '#54a848', ink: '#2c742c', vein: '#b56a3a', trunk: '#8a5a30', accent: '#e7c27a' },
  cushion: { leaf: '#7ec06e', ink: '#4a8a46', vein: '#b56a3a', trunk: '#8a5a30', accent: '#d9a0c4' },
  oak: { leaf: '#5aaa3c', ink: '#347828', vein: '#a86b32', trunk: '#8a5428', accent: '#e7b7c6' },
  pine: { leaf: '#6aaa48', ink: '#3c7a30', vein: '#b56a3a', trunk: '#8a5a30', accent: '#d7e2c8' },
  spruce: { leaf: '#2d6a40', ink: '#1a4630', vein: '#6a4a30', trunk: '#4a3420', accent: '#d7e2c8' },
  birch: { leaf: '#d2e4a4', ink: '#6a8a48', vein: '#d2c4a4', trunk: '#efe6d4', accent: '#4a3b2a' },
  fruit: { leaf: '#6fbe45', ink: '#3c7a28', vein: '#c4844a', trunk: '#a86b32', accent: '#e23d32' },
  olive: { leaf: '#a8b56e', ink: '#5c6a38', vein: '#b56a3a', trunk: '#8a5a30', accent: '#e7e2c0' },
  cypress: { leaf: '#2a6840', ink: '#184830', vein: '#6a4a30', trunk: '#4a3420', accent: '#d7e2c8' },
  bamboo: { leaf: '#8ec83e', ink: '#5a8a22', vein: '#c4a05a', trunk: '#d4b06a', accent: '#d8ecb0' },
  hedge: { leaf: '#4aaa48', ink: '#2a742c', vein: '#2f6e34', trunk: '#5c3a1e', accent: '#e7b7c6' },
  rose: { leaf: '#4a9a40', ink: '#246828', vein: '#a86b32', trunk: '#7a4a28', accent: '#d21848' },
  box: { leaf: '#2f8a44', ink: '#186030', vein: '#2a6434', trunk: '#5c3a1e', accent: '#d5e6c4' },
  fern: { leaf: '#52c056', ink: '#2a8430', vein: '#3a9a40', trunk: '#6a4428', accent: '#d8f0a8' },
  grass: { leaf: '#a4cc55', ink: '#5a8a2c', vein: '#7aaa40', trunk: '#c4a05a', accent: '#f3e7c2' },
  spiral: { leaf: '#4a9a48', ink: '#2a742c', vein: '#3a7840', trunk: '#6b4423', accent: '#d7e2c8' },
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
      [circle(1), circle(0.72), circle(0.46), disk(-0.06, -0.08, 0.18)],
      [-1, 0, 1, 0],
      ticks(18, 0.5, 0.96, 0.1),
      [trunk(0, 0, 0.05)],
      1,
    )
  }
  if (form === 'leaf') {
    const puffs = around(8, 0.46, 0.3)
    const fills = [scallop({ count: 15, inner: 0.76, outer: 1, turn: 0.42, wobble: 0.09 })]
    const shade = [-1]
    puffs.forEach((spot, i) => {
      fills.push(clump(spot.x, spot.y, i % 2 ? 0.32 : 0.26, i * 0.65, 6))
      shade.push(i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0)
    })
    fills.push(disk(-0.1, -0.12, 0.2), disk(0.16, 0.08, 0.14))
    shade.push(1, 0)
    return drawn(fills, shade, [...fork(0.4, 0.7, 0.4), ...fork(2.5, 0.64, 0.36), ...fork(4.4, 0.56, 0.32)], [trunk(0, 0, 0.07)], 1)
  }
  if (form === 'spread') {
    const arms = around(6, 0.5, -0.5)
    const fills = arms.map((spot, i) => clump(spot.x, spot.y, i % 2 ? 0.34 : 0.28, i * 0.8, 6))
    const shade = arms.map((_, i) => (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1))
    fills.push(disk(0.02, -0.02, 0.14))
    shade.push(1)
    return drawn(
      fills,
      shade,
      arms.map((spot) => fork(Math.atan2(spot.y, spot.x), 0.58, 0.2)[0]),
      [trunk(0, 0, 0.08)],
      arms.length,
    )
  }
  if (form === 'conifer') {
    return drawn(
      [star(18, 0.55, 1, -Math.PI / 2), star(12, 0.28, 0.62, 0.15), disk(-0.08, -0.1, 0.14)],
      [0, -1, 1],
      ribs(8, 0.72, -Math.PI / 2),
      [trunk(0, 0, 0.06)],
      1,
    )
  }
  if (form === 'column') {
    const puffs = around(6, 0.22, 0.4)
    const fills = [scallop({ count: 12, inner: 0.82, outer: 1, turn: 0.25, wobble: 0.035, sx: 0.42, sy: 1 })]
    const shade = [-1]
    puffs.forEach((spot, i) => {
      fills.push(clump(spot.x * 0.7, spot.y * 0.72, 0.16, i, 5))
      shade.push(i % 2 ? 1 : 0)
    })
    return drawn(fills, shade, ribs(4, 0.7, -Math.PI / 2, 0.36, 0.9), [trunk(0, 0.15, 0.045)], 1)
  }
  if (form === 'weep') {
    const drops = around(9, 0.58, 0.35)
    const fills = [scallop({ count: 18, inner: 0.78, outer: 0.96, turn: 0.08, wobble: 0.045 })]
    const shade = [-1]
    drops.forEach((spot, i) => {
      fills.push(clump(spot.x, spot.y, 0.24, i * 0.5, 5))
      shade.push(i % 2 ? 0 : 1)
    })
    fills.push(disk(0, 0, 0.16))
    shade.push(0)
    return drawn(
      fills,
      shade,
      drops.map((spot) => fork(Math.atan2(spot.y, spot.x), 0.5, 0.16)[0]),
      [trunk(0, 0, 0.06)],
      1,
    )
  }
  if (form === 'palm') {
    const fills: string[] = []
    const shade: number[] = []
    for (let i = 0; i < 9; i++) {
      const angle = -Math.PI / 2 + (i / 9) * TAU
      fills.push(frond(angle, 0.82 + (i % 3) * 0.08, 0.14 + (i % 2) * 0.03))
      shade.push(i % 2 === 0 ? -1 : 0)
    }
    for (let i = 0; i < 6; i++) {
      fills.push(frond(-Math.PI / 2 + (i / 6) * TAU + 0.28, 0.4, 0.08))
      shade.push(1)
    }
    fills.push(disk(0, 0, 0.12))
    shade.push(1)
    return drawn(fills, shade, [], [trunk(0, 0, 0.09)], 9)
  }
  if (form === 'clump') {
    const bubbles = [
      { x: 0, y: -0.02, r: 0.4 },
      { x: -0.4, y: -0.18, r: 0.34 },
      { x: 0.38, y: -0.14, r: 0.32 },
      { x: -0.26, y: 0.36, r: 0.3 },
      { x: 0.32, y: 0.34, r: 0.28 },
      { x: 0.02, y: -0.5, r: 0.22 },
      { x: -0.02, y: 0.06, r: 0.14 },
    ]
    return drawn(
      bubbles.map((spot) => disk(spot.x, spot.y, spot.r)),
      [-1, 0, 0, -1, 1, 0, 1],
      [],
      bubbles.slice(0, 5).map((spot) => trunk(spot.x, spot.y, 0.028)),
      5,
    )
  }
  if (form === 'oak') {
    const lobes = around(6, 0.42, 0.5)
    const fills = [scallop({ count: 8, inner: 0.62, outer: 1, turn: 0.55, wobble: 0.14, sx: 1.05, sy: 0.98 })]
    const shade = [-1]
    lobes.forEach((spot, i) => {
      fills.push(clump(spot.x, spot.y, i % 2 ? 0.36 : 0.3, i * 0.9, 5))
      shade.push(i % 2 ? 0 : 1)
    })
    fills.push(disk(-0.08, -0.06, 0.16))
    shade.push(1)
    return drawn(fills, shade, [...fork(0.9, 0.62, 0.34), ...fork(3.1, 0.58, 0.3)], [trunk(0, 0.02, 0.09)], 1)
  }
  if (form === 'pine') {
    const tips = around(8, 0.72, 0.2)
    const fills = [star(9, 0.2, 1, 0.25)]
    const shade = [0]
    tips.forEach((spot, i) => {
      fills.push(clump(spot.x, spot.y, 0.18, i, 4))
      shade.push(i % 2 ? 1 : -1)
    })
    return drawn(fills, shade, ribs(8, 0.78, 0.25), [trunk(0, 0, 0.05)], 1)
  }
  if (form === 'spruce') {
    return drawn(
      [star(16, 0.62, 1, 0.35), star(11, 0.32, 0.68, 0.7), star(8, 0.14, 0.36, 0.15)],
      [0, -1, 1],
      ribs(6, 0.4, 0.2),
      [trunk(0, 0, 0.045)],
      1,
    )
  }
  if (form === 'birch') {
    const leaves = around(14, 0.52, 0.15)
    const fills = [scallop({ count: 16, inner: 0.84, outer: 1, turn: 0.12, wobble: 0.04, sx: 0.92, sy: 1.02 })]
    const shade = [0]
    leaves.forEach((spot, i) => {
      fills.push(disk(spot.x, spot.y, i % 3 === 0 ? 0.14 : 0.1))
      shade.push(i % 2 ? 1 : -1)
    })
    fills.push(disk(-0.06, -0.1, 0.16))
    shade.push(1)
    return drawn(fills, shade, [...fork(-0.4, 0.62, 0.28), ...fork(1.7, 0.58, 0.32), ...fork(3.8, 0.5, 0.26)], [trunk(0, 0, 0.06)], 1)
  }
  if (form === 'fruit') {
    const fruit = around(8, 0.48, -0.2)
    return drawn(
      [
        scallop({ count: 13, inner: 0.78, outer: 1, turn: 0.62, wobble: 0.07 }),
        circle(0.52),
        disk(-0.1, -0.14, 0.18),
      ],
      [-1, 0, 1],
      [...fork(0.7, 0.55, 0.3), ...fork(2.8, 0.5, 0.28)],
      [trunk(0, 0, 0.05), ...fruit.map((spot, i) => ({ x: spot.x, y: spot.y, r: i % 2 ? 0.09 : 0.065, bloom: true }))],
      1,
    )
  }
  if (form === 'olive') {
    const puffs = around(7, 0.4, 0.6).map((spot) => ({ x: spot.x * 1.15, y: spot.y * 0.62 }))
    const fills = [scallop({ count: 11, inner: 0.7, outer: 1, turn: 1.05, wobble: 0.09, sx: 1.12, sy: 0.7 })]
    const shade = [-1]
    puffs.forEach((spot, i) => {
      fills.push(clump(spot.x, spot.y, 0.24, i * 0.7, 5))
      shade.push(i % 2 ? 1 : 0)
    })
    return drawn(fills, shade, [...fork(0.3, 0.55, 0.25), ...fork(2.6, 0.48, 0.3)], [trunk(0, 0.02, 0.05)], 1)
  }
  if (form === 'cypress') {
    return drawn(
      [
        scallop({ count: 14, inner: 0.88, outer: 1, turn: -0.35, wobble: 0.02, sx: 0.32, sy: 1.04 }),
        scallop({ count: 10, inner: 0.78, outer: 0.9, turn: 0.4, wobble: 0.015, sx: 0.2, sy: 0.7 }),
        disk(0, -0.18, 0.07),
      ],
      [-1, 0, 1],
      ribs(4, 0.78, -Math.PI / 2, 0.26, 1),
      [trunk(0, 0.28, 0.035)],
      1,
    )
  }
  if (form === 'bamboo') {
    const culms = [
      { x: -0.34, y: 0.12, r: 0.3 },
      { x: 0.08, y: -0.22, r: 0.34 },
      { x: 0.4, y: 0.16, r: 0.26 },
      { x: -0.06, y: 0.36, r: 0.22 },
      { x: 0.18, y: -0.5, r: 0.18 },
    ]
    return drawn(
      culms.map((spot) => disk(spot.x, spot.y, spot.r)),
      [-1, 0, 1, 0, -1],
      [],
      culms.map((spot) => trunk(spot.x, spot.y, 0.035)),
      culms.length,
    )
  }
  if (form === 'ball') {
    const ring = around(6, 0.48, 0.35)
    return drawn(
      [
        scallop({ count: 16, inner: 0.8, outer: 1, turn: 0.25, wobble: 0.055 }),
        scallop({ count: 10, inner: 0.42, outer: 0.62, turn: 1.1, wobble: 0.07 }),
        disk(-0.14, -0.18, 0.2),
        ...ring.map((spot, i) => clump(spot.x, spot.y, 0.28, i * 0.8, 5)),
      ],
      [-1, 0, 1, 0, -1, 1, -1, 0, 1],
      [...fork(0.4, 0.62, 0.32), ...fork(2.3, 0.55, 0.38), ...fork(4.2, 0.5, 0.3)],
      [trunk(0, 0.02, 0.04)],
      1,
    )
  }
  if (form === 'wide') {
    const arms = [
      { x: -0.5, y: 0.1, r: 0.4, turn: 0.3 },
      { x: 0.08, y: -0.32, r: 0.38, turn: 1.2 },
      { x: 0.48, y: 0.06, r: 0.4, turn: 2.1 },
      { x: -0.08, y: 0.36, r: 0.3, turn: 0.7 },
    ]
    return drawn(
      [
        ...arms.map((arm) => clump(arm.x, arm.y, arm.r, arm.turn, 6)),
        ...arms.slice(0, 3).map((arm) => disk(arm.x - 0.06, arm.y - 0.08, arm.r * 0.38)),
      ],
      [-1, 0, -1, 1, 1, 1, 0],
      arms.flatMap((arm) => {
        const angle = Math.atan2(arm.y, arm.x)
        return fork(angle, Math.hypot(arm.x, arm.y) + arm.r * 0.35, 0.28).slice(0, 2)
      }),
      [trunk(0, 0.04, 0.045), { x: 0.5, y: -0.08, r: 0.05, bloom: true }, { x: -0.42, y: -0.08, r: 0.04, bloom: true }],
      4,
    )
  }
  if (form === 'needle') {
    const tips = around(8, 0.78, 0.15)
    return drawn(
      [
        star(18, 0.46, 1.02, -Math.PI / 2, 1, 0.92),
        star(12, 0.18, 0.52, 0.4, 0.88, 0.8),
        disk(-0.06, -0.08, 0.12),
        ...tips.map((spot) => clump(spot.x, spot.y, 0.16, spot.x * 3, 4)),
      ],
      [0, -1, 1, 1, 0, 1, -1, 1, 0, 1, -1],
      ribs(10, 0.84, -Math.PI / 2, 1, 0.92),
      [trunk(0, 0, 0.04)],
      1,
    )
  }
  if (form === 'bloom') {
    const heads = around(8, 0.58, -0.4)
    return drawn(
      [
        scallop({ count: 14, inner: 0.74, outer: 1, turn: 0.15, wobble: 0.07 }),
        scallop({ count: 8, inner: 0.36, outer: 0.52, turn: 0.8, wobble: 0.06 }),
        disk(-0.12, -0.16, 0.18),
        ...heads.map((spot, i) => disk(spot.x, spot.y, i % 2 ? 0.13 : 0.1)),
      ],
      [-1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [...fork(-0.2, 0.5, 0.4), ...fork(2.2, 0.48, 0.35)],
      heads.map((spot, i) => ({ x: spot.x, y: spot.y, r: i % 2 ? 0.09 : 0.065, bloom: true })),
      1,
    )
  }
  if (form === 'group') {
    const spots = [
      { x: -0.38, y: 0.18, r: 0.48, turn: 0.45 },
      { x: 0.4, y: 0.12, r: 0.44, turn: 1.35 },
      { x: 0.02, y: -0.34, r: 0.4, turn: 2.2 },
    ]
    return drawn(
      [
        ...spots.map((spot) => clump(spot.x, spot.y, spot.r, spot.turn, 7)),
        ...spots.map((spot) => disk(spot.x - 0.06, spot.y - 0.08, spot.r * 0.32)),
      ],
      [-1, 0, -1, 1, 1, 0],
      spots.flatMap((spot) => fork(Math.atan2(spot.y, spot.x), spot.r * 0.85, 0.4)),
      spots.map((spot) => trunk(spot.x, spot.y + 0.02, 0.035)),
      3,
    )
  }
  if (form === 'cushion') {
    const bumps = around(7, 0.46, 0.55).map((spot) => ({ x: spot.x * 1.12, y: spot.y * 0.62 }))
    return drawn(
      [
        scallop({ count: 15, inner: 0.72, outer: 1, turn: 1.15, wobble: 0.06, sx: 1.16, sy: 0.64 }),
        scallop({ count: 9, inner: 0.4, outer: 0.56, turn: 0.45, wobble: 0.05, sx: 0.86, sy: 0.38 }),
        disk(-0.08, -0.04, 0.12),
        ...bumps.map((spot, i) => clump(spot.x, spot.y, 0.22, i * 0.6, 5)),
      ],
      [-1, 0, 1, 0, -1, 1, 0, -1, 1, 0],
      bumps.map((spot) => `M 0 0 Q ${num(spot.x * 0.4)} ${num(spot.y * 0.3)} ${num(spot.x)} ${num(spot.y)}`),
      around(8, 0.34, 0.2).map((spot, i) => ({ x: spot.x * 1.05, y: spot.y * 0.55, r: i % 2 ? 0.055 : 0.04, bloom: true })),
      1,
    )
  }
  if (form === 'hedge') {
    const xs = [-0.74, -0.25, 0.25, 0.74]
    return drawn(
      [
        scallop({ count: 22, inner: 0.9, outer: 1, turn: 0.03, wobble: 0.016, sx: 1.16, sy: 0.46 }),
        scallop({ count: 16, inner: 0.84, outer: 0.96, turn: 0.2, wobble: 0.01, sx: 1, sy: 0.16, cy: -0.1 }),
        ...xs.map((x, i) => scallop({ count: 8, inner: 0.64, outer: 0.92, turn: 0.5 + i, wobble: 0.04, sx: 0.2, sy: 0.32, cx: x, cy: 0.03 })),
      ],
      [-1, 1, 0, -1, 0, 1],
      xs.map((x) => `M ${num(x)} ${num(-0.2)} L ${num(x)} ${num(0.24)}`),
      [],
      1,
    )
  }
  if (form === 'rose') {
    const flowers = around(5, 0.36, -0.15)
    return drawn(
      [
        scallop({ count: 9, inner: 0.48, outer: 0.8, turn: 0.65, wobble: 0.09 }),
        disk(-0.04, -0.06, 0.12),
        ...[0, 1, 2, 3, 4, 5].map((i) => spray(-Math.PI / 2 + (i / 6) * TAU, 0.66, 0.085, i % 2 ? 0.28 : -0.22)),
      ],
      [-1, 1, 0, -1, 0, -1, 1, 0],
      flowers.flatMap((spot) => fork(Math.atan2(spot.y, spot.x), 0.5, 0.18).slice(0, 1)),
      flowers.map((spot) => ({ x: spot.x, y: spot.y, r: 0.15, bloom: true })),
      1,
    )
  }
  if (form === 'box') {
    return drawn(
      [
        roundedBox(0.9, 0.12),
        roundedBox(0.6, 0.08),
        roundedBox(0.32, 0.05),
        scallop({ count: 14, inner: 0.7, outer: 0.8, turn: 0.25, wobble: 0.015 }),
      ],
      [-1, 0, 1, 0],
      ['M -0.78 0 H 0.78', 'M 0 -0.78 V 0.78', 'M -0.52 -0.52 H 0.52', 'M -0.52 0.52 H 0.52'],
      around(8, 0.46, Math.PI / 8).map((spot) => ({ x: spot.x, y: spot.y, r: 0.04, bloom: true })),
      2,
    )
  }
  if (form === 'fern') {
    const fills: string[] = []
    const shade: number[] = []
    const veins: string[] = []
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI / 2 + (i / 7) * TAU
      const len = 0.74 + (i % 3) * 0.1
      fills.push(fernFrond(angle, len, 5))
      shade.push(i % 2 ? -1 : 0)
      const tip = at(len * 0.92, angle, 1, 1, 0, 0)
      veins.push(`M 0 0 L ${num(tip.x)} ${num(tip.y)}`)
    }
    for (let i = 0; i < 4; i++) {
      const angle = -Math.PI / 3 + (i / 4) * TAU
      fills.push(fernFrond(angle, 0.4, 3))
      shade.push(1)
    }
    return drawn(fills, shade, veins, [trunk(0, 0, 0.04)])
  }
  if (form === 'grass') {
    const fills = [scallop({ count: 10, inner: 0.18, outer: 0.34, turn: 0.2, wobble: 0.1 })]
    const shade = [0]
    const plumes: PlantDot[] = []
    const blades = 16
    for (let i = 0; i < blades; i++) {
      const angle = -Math.PI / 2 + (i / blades) * TAU
      const len = 0.58 + (i % 5) * 0.08
      const bend = (i % 2 ? 1 : -1) * (0.5 + (i % 3) * 0.16)
      fills.push(spray(angle, len, 0.07 + (i % 4) * 0.014, bend))
      shade.push(i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0)
      if (i % 3 === 0) {
        const tip = at(len * 0.94, angle + bend, 1, 1, 0, 0)
        plumes.push({ x: tip.x, y: tip.y, r: 0.04, bloom: true })
      }
    }
    return drawn(fills, shade, [], [trunk(0, 0.02, 0.04), ...plumes])
  }
  if (form === 'spiral') {
    return drawn(
      [
        scallop({ count: 18, inner: 0.9, outer: 1, turn: 0.55, wobble: 0.018 }),
        spiralBand(1.35, 0.18, 0.84, 0.12),
        disk(0.05, -0.06, 0.3),
        disk(-0.08, 0.05, 0.14),
      ],
      [-1, -1, 0, 1],
      [spiralVein(1.35, 0.2, 0.78)],
      [trunk(0, 0, 0.04), { x: 0.22, y: -0.16, r: 0.035, bloom: true }, { x: -0.16, y: 0.14, r: 0.03, bloom: true }],
      1,
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
  const inked = glyph.inked ?? glyph.fills.length
  const fills = glyph.fills.map((d, index) => {
    const stroke = index < inked ? paint.ink : 'none'
    const width = index < inked ? pen : '0'
    return `<path d="${d}" fill="${crownFill(paint, glyph.shade?.[index] ?? 0)}" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`
  }).join('')
  const veins = glyph.veins.map((d) => `<path d="${d}" fill="none" stroke="${paint.vein}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`).join('')
  const dots = glyph.dots.map((dot) => {
    const fill = dot.bloom ? paint.accent : paint.trunk
    const stroke = dot.bloom ? paint.ink : '#3e2614'
    return `<circle cx="${num(dot.x)}" cy="${num(dot.y)}" r="${num(dot.r)}" fill="${fill}" stroke="${stroke}" stroke-width="${vein}" vector-effect="non-scaling-stroke"/>`
  }).join('')
  return `<g transform="translate(${num(plant.x)} ${num(plant.y)}) scale(${num(radius)})">${fills}${veins}${dots}</g>`
}

function drawn(fills: string[], shade: number[], veins: string[], dots: PlantDot[], inked?: number): PlantGlyph {
  return { fills, shade, veins, dots, ...(inked ? { inked } : {}) }
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

function ticks(count: number, inner: number, outer: number, turn: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const angle = turn + (i / count) * TAU
    const a = at(inner, angle, 1, 1, 0, 0)
    const b = at(outer, angle, 1, 1, 0, 0)
    out.push(`M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)}`)
  }
  return out
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

function clump(cx: number, cy: number, r: number, turn: number, lobes: number): string {
  return scallop({ count: lobes, inner: r * 0.55, outer: r, turn, wobble: 0.16, cx, cy })
}

function spray(angle: number, len: number, width: number, bend: number): string {
  const tipA = angle + bend
  const tip = at(len, tipA, 1, 1, 0, 0)
  const belly = at(len * 0.55, angle + bend * 0.45, 1, 1, 0, 0)
  const px = -Math.sin(tipA) * width
  const py = Math.cos(tipA) * width
  return `M 0 0 Q ${num(belly.x + px)} ${num(belly.y + py)} ${num(tip.x)} ${num(tip.y)} Q ${num(belly.x - px * 0.65)} ${num(belly.y - py * 0.65)} 0 0 Z`
}

function fernFrond(angle: number, len: number, pairs: number): string {
  const pts: { x: number; y: number }[] = []
  const push = (along: number, side: number) => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    pts.push({ x: c * along - s * side, y: s * along + c * side })
  }
  push(0, 0)
  for (let i = 1; i <= pairs; i++) {
    const t = i / pairs
    const along = len * (0.16 + 0.72 * t)
    const w = len * (0.07 + 0.2 * Math.sin(t * Math.PI))
    push(along - len * 0.05, w * 0.28)
    push(along, w)
    push(along + len * 0.04, w * 0.22)
  }
  push(len * 0.98, 0)
  for (let i = pairs; i >= 1; i--) {
    const t = i / pairs
    const along = len * (0.16 + 0.72 * t)
    const w = len * (0.07 + 0.2 * Math.sin(t * Math.PI)) * 0.92
    push(along + len * 0.04, -w * 0.22)
    push(along, -w)
    push(along - len * 0.05, -w * 0.28)
  }
  let d = `M ${num(pts[0].x)} ${num(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) d += ` L ${num(pts[i].x)} ${num(pts[i].y)}`
  return `${d} Z`
}

function fork(angle: number, len: number, spread: number): string[] {
  const mid = at(len * 0.48, angle, 1, 1, 0, 0)
  const tip = at(len, angle, 1, 1, 0, 0)
  const left = at(len * 0.92, angle - spread, 1, 1, 0, 0)
  const right = at(len * 0.92, angle + spread, 1, 1, 0, 0)
  return [
    `M 0 0 Q ${num(mid.x)} ${num(mid.y)} ${num(tip.x)} ${num(tip.y)}`,
    `M ${num(mid.x)} ${num(mid.y)} Q ${num((mid.x + left.x) / 2)} ${num((mid.y + left.y) / 2)} ${num(left.x)} ${num(left.y)}`,
    `M ${num(mid.x)} ${num(mid.y)} Q ${num((mid.x + right.x) / 2)} ${num((mid.y + right.y) / 2)} ${num(right.x)} ${num(right.y)}`,
  ]
}

function spiralBand(turns: number, start: number, end: number, width: number): string {
  const steps = 42
  const outer: { x: number; y: number }[] = []
  const inner: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = -Math.PI / 2 + t * turns * TAU
    const radius = start + (end - start) * t
    outer.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    const innerR = Math.max(0.04, radius - width)
    inner.push({ x: Math.cos(angle) * innerR, y: Math.sin(angle) * innerR })
  }
  let d = `M ${num(outer[0].x)} ${num(outer[0].y)}`
  for (let i = 1; i < outer.length; i++) d += ` L ${num(outer[i].x)} ${num(outer[i].y)}`
  for (let i = inner.length - 1; i >= 0; i--) d += ` L ${num(inner[i].x)} ${num(inner[i].y)}`
  return `${d} Z`
}

function spiralVein(turns: number, start: number, end: number): string {
  const steps = 36
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = t * turns * TAU
    const radius = start + (end - start) * t
    d += `${i === 0 ? 'M' : ' L'} ${num(Math.cos(angle) * radius)} ${num(Math.sin(angle) * radius)}`
  }
  return d
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
