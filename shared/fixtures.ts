import type { Fixture, FixtureKind } from './types.ts'

const TAU = Math.PI * 2

export type FixtureGroup = 'stone' | 'seat' | 'light' | 'car' | 'sun' | 'yard' | 'mark'

export type FixtureSpec = { id: FixtureKind; label: string; group: FixtureGroup; radiusM: number }

export const FIXTURES: FixtureSpec[] = [
  { id: 'boulder', label: 'Камень', group: 'stone', radiusM: 0.55 },
  { id: 'rocks', label: 'Россыпь', group: 'stone', radiusM: 0.85 },
  { id: 'slab', label: 'Плита', group: 'stone', radiusM: 0.7 },
  { id: 'steps', label: 'Шаги', group: 'stone', radiusM: 0.9 },
  { id: 'wall', label: 'Стенка', group: 'stone', radiusM: 1.2 },
  { id: 'pebble', label: 'Галька', group: 'stone', radiusM: 0.6 },
  { id: 'bench', label: 'Скамья', group: 'seat', radiusM: 0.9 },
  { id: 'chair', label: 'Кресло', group: 'seat', radiusM: 0.45 },
  { id: 'table', label: 'Стол', group: 'seat', radiusM: 0.7 },
  { id: 'sofa', label: 'Диван', group: 'seat', radiusM: 1.05 },
  { id: 'picnic', label: 'Пикник', group: 'seat', radiusM: 1.2 },
  { id: 'swing', label: 'Качели', group: 'seat', radiusM: 0.8 },
  { id: 'hammock', label: 'Гамак', group: 'seat', radiusM: 1.1 },
  { id: 'stool', label: 'Табурет', group: 'seat', radiusM: 0.28 },
  { id: 'bollard', label: 'Боллард', group: 'light', radiusM: 0.18 },
  { id: 'lamp', label: 'Фонарь', group: 'light', radiusM: 0.32 },
  { id: 'spot', label: 'Прожектор', group: 'light', radiusM: 0.28 },
  { id: 'lantern', label: 'Светильник', group: 'light', radiusM: 0.3 },
  { id: 'spike', label: 'Штырь', group: 'light', radiusM: 0.18 },
  { id: 'twin', label: 'Пара', group: 'light', radiusM: 0.45 },
  { id: 'sedan', label: 'Седан', group: 'car', radiusM: 2.25 },
  { id: 'suv', label: 'Внедорожник', group: 'car', radiusM: 2.35 },
  { id: 'wagon', label: 'Универсал', group: 'car', radiusM: 2.5 },
  { id: 'pickup', label: 'Пикап', group: 'car', radiusM: 2.6 },
  { id: 'van', label: 'Фургон', group: 'car', radiusM: 2.45 },
  { id: 'bike', label: 'Велосипед', group: 'car', radiusM: 0.9 },
  { id: 'moto', label: 'Мото', group: 'car', radiusM: 1.1 },
  { id: 'lounger', label: 'Шезлонг', group: 'sun', radiusM: 1 },
  { id: 'daybed', label: 'Лежак', group: 'sun', radiusM: 1.1 },
  { id: 'parasol', label: 'Зонт', group: 'sun', radiusM: 1.2 },
  { id: 'grill', label: 'Мангал', group: 'sun', radiusM: 0.45 },
  { id: 'tub', label: 'Купель', group: 'sun', radiusM: 0.9 },
  { id: 'planter', label: 'Кашпо', group: 'yard', radiusM: 0.4 },
  { id: 'pots', label: 'Горшки', group: 'yard', radiusM: 0.55 },
  { id: 'pergola', label: 'Пергола', group: 'yard', radiusM: 1.5 },
  { id: 'gazebo', label: 'Беседка', group: 'yard', radiusM: 1.4 },
  { id: 'fountain', label: 'Фонтан', group: 'yard', radiusM: 0.8 },
  { id: 'statue', label: 'Скульптура', group: 'yard', radiusM: 0.4 },
  { id: 'greenhouse', label: 'Теплица', group: 'yard', radiusM: 1.6 },
  { id: 'sandbox', label: 'Песочница', group: 'yard', radiusM: 0.9 },
  { id: 'compass', label: 'Компас', group: 'mark', radiusM: 0.65 },
  { id: 'scalebar', label: 'Масштаб', group: 'mark', radiusM: 2 },
  { id: 'controller', label: 'Пульт', group: 'mark', radiusM: 0.42 },
]

export const FIXTURE_GROUPS: { id: FixtureGroup; label: string }[] = [
  { id: 'stone', label: 'Камни' },
  { id: 'seat', label: 'Мебель' },
  { id: 'light', label: 'Свет' },
  { id: 'car', label: 'Машины' },
  { id: 'sun', label: 'Шезлонги' },
  { id: 'yard', label: 'Двор' },
  { id: 'mark', label: 'Элементы' },
]

export type FixturePart = { d: string; fill: string; stroke: string }
export type FixtureLine = { d: string; stroke: string }
export type FixtureGlyph = { parts: FixturePart[]; lines: FixtureLine[] }

const INK = '#1c2822'
const WOOD = '#a56b38'
const WOOD_DARK = '#5c3d24'
const STONE = '#8d877e'
const STONE_DARK = '#5e5954'
const GLASS = '#b7d4e4'
const WHEEL = '#1a1e22'
const CLOTH = '#e4ddd2'
const SUN = '#d15a42'

export function fixtureSpec(kind: FixtureKind): FixtureSpec {
  return FIXTURES.find((item) => item.id === kind) ?? FIXTURES[0]
}

export function groupOf(kind: FixtureKind): FixtureGroup {
  return fixtureSpec(kind).group
}

export function fixtureKinds(group: FixtureGroup): FixtureKind[] {
  return FIXTURES.filter((item) => item.group === group).map((item) => item.id)
}

/** Пустая строка и чужой знак — null, документ не берём. */
export function parseFixtureKind(value: unknown): FixtureKind | null {
  if (typeof value !== 'string') return null
  return FIXTURES.find((item) => item.id === value)?.id ?? null
}

function extraGlyph(kind: FixtureKind): FixtureGlyph | null {
  if (kind === 'steps') {
    return {
      parts: [
        { d: ellipse(-0.68, 0.22, 0.24, 0.16), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(-0.22, -0.12, 0.24, 0.16), fill: '#9a948a', stroke: STONE_DARK },
        { d: ellipse(0.24, 0.18, 0.24, 0.16), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0.7, -0.16, 0.24, 0.16), fill: '#7d776f', stroke: STONE_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'wall') {
    return {
      parts: [{ d: roundRect(-0.96, -0.28, 1.92, 0.56, 0.04), fill: STONE, stroke: STONE_DARK }],
      lines: [
        { d: 'M -0.48 -0.28 V 0.28', stroke: STONE_DARK },
        { d: 'M 0 -0.28 V 0.28', stroke: STONE_DARK },
        { d: 'M 0.48 -0.28 V 0.28', stroke: STONE_DARK },
      ],
    }
  }
  if (kind === 'pebble') {
    return {
      parts: [
        { d: ellipse(-0.55, 0.22, 0.18, 0.12), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(-0.18, -0.28, 0.14, 0.1), fill: '#9a948a', stroke: STONE_DARK },
        { d: ellipse(0.12, 0.18, 0.2, 0.13), fill: '#7d776f', stroke: STONE_DARK },
        { d: ellipse(0.52, -0.08, 0.14, 0.1), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0.28, -0.48, 0.1, 0.08), fill: '#b7b1a8', stroke: STONE_DARK },
        { d: ellipse(-0.42, -0.38, 0.12, 0.08), fill: '#9a948a', stroke: STONE_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'picnic') {
    return {
      parts: [
        { d: roundRect(-0.92, -0.78, 1.84, 0.22, 0.04), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(-0.92, 0.56, 1.84, 0.22, 0.04), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(-0.62, -0.28, 1.24, 0.56, 0.05), fill: '#d7b98a', stroke: WOOD_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'swing') {
    return {
      parts: [
        { d: ellipse(-0.72, 0.62, 0.1, 0.1), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0.72, 0.62, 0.1, 0.1), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: roundRect(-0.42, 0.12, 0.84, 0.18, 0.04), fill: WOOD, stroke: WOOD_DARK },
      ],
      lines: [
        { d: 'M -0.72 0.62 L 0 -0.88 L 0.72 0.62', stroke: WOOD_DARK },
        { d: 'M -0.22 0.12 L -0.12 -0.28', stroke: WOOD_DARK },
        { d: 'M 0.22 0.12 L 0.12 -0.28', stroke: WOOD_DARK },
      ],
    }
  }
  if (kind === 'hammock') {
    return {
      parts: [
        { d: roundRect(-0.92, -0.72, 0.12, 1.44, 0.03), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: roundRect(0.8, -0.72, 0.12, 1.44, 0.03), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: blob(0, 0.22, 0.68, 0.32, 6, 0.1, 0.4), fill: CLOTH, stroke: '#8a8175' },
      ],
      lines: [{ d: 'M -0.8 -0.55 Q 0 -0.15 0.8 -0.55', stroke: '#8a8175' }],
    }
  }
  if (kind === 'stool') {
    return {
      parts: [{ d: ellipse(0, 0, 0.72, 0.72), fill: WOOD, stroke: WOOD_DARK }],
      lines: [],
    }
  }
  if (kind === 'spike') {
    return {
      parts: [
        { d: poly([[0, -0.88], [-0.22, 0.78], [0.22, 0.78]]), fill: '#2c3230', stroke: INK },
        { d: ellipse(0, -0.48, 0.16, 0.12), fill: '#f4e7b0', stroke: '#8a7030' },
      ],
      lines: [],
    }
  }
  if (kind === 'twin') {
    return {
      parts: [
        { d: ellipse(-0.42, 0, 0.32, 0.32), fill: '#2a2e2c', stroke: INK },
        { d: ellipse(-0.42, 0, 0.12, 0.12), fill: '#e6c75a', stroke: '#8a7030' },
        { d: ellipse(0.42, 0, 0.32, 0.32), fill: '#2a2e2c', stroke: INK },
        { d: ellipse(0.42, 0, 0.12, 0.12), fill: '#e6c75a', stroke: '#8a7030' },
      ],
      lines: [],
    }
  }
  if (kind === 'pickup') return car('#6a5344', -0.98, 0.7, -0.78, 0.62, 0.48)
  if (kind === 'van') return car('#3e4c5e', -0.96, 0.88, -0.55, 1.15, 0.62)
  if (kind === 'bike') {
    return {
      parts: [
        { d: ellipse(-0.55, 0.18, 0.28, 0.28), fill: '#f7f3ea', stroke: WHEEL },
        { d: ellipse(0.55, 0.18, 0.28, 0.28), fill: '#f7f3ea', stroke: WHEEL },
        { d: ellipse(-0.55, 0.18, 0.06, 0.06), fill: WHEEL, stroke: WHEEL },
        { d: ellipse(0.55, 0.18, 0.06, 0.06), fill: WHEEL, stroke: WHEEL },
      ],
      lines: [
        { d: 'M -0.55 0.18 L 0.05 -0.42 L 0.55 0.18', stroke: INK },
        { d: 'M 0.05 -0.42 L 0.28 -0.62', stroke: INK },
        { d: 'M -0.1 -0.05 L 0.18 0.42', stroke: INK },
      ],
    }
  }
  if (kind === 'moto') {
    return {
      parts: [
        { d: ellipse(-0.58, 0.22, 0.24, 0.24), fill: WHEEL, stroke: WHEEL },
        { d: ellipse(0.58, 0.12, 0.32, 0.32), fill: WHEEL, stroke: WHEEL },
        { d: roundRect(-0.28, -0.22, 0.72, 0.42, 0.1), fill: '#314238', stroke: INK },
      ],
      lines: [{ d: 'M 0.05 -0.22 L 0.35 -0.55', stroke: INK }],
    }
  }
  if (kind === 'grill') {
    return {
      parts: [
        { d: roundRect(-0.72, -0.42, 1.44, 0.84, 0.06), fill: '#2c2420', stroke: INK },
        { d: ellipse(-0.48, 0.4, 0.08, 0.08), fill: INK, stroke: INK },
        { d: ellipse(0.48, 0.4, 0.08, 0.08), fill: INK, stroke: INK },
        { d: ellipse(0, 0.02, 0.22, 0.12), fill: '#8a3030', stroke: '#5c2018' },
      ],
      lines: [
        { d: 'M -0.55 -0.24 H 0.55', stroke: '#c9a15b' },
        { d: 'M -0.55 -0.08 H 0.55', stroke: '#c9a15b' },
        { d: 'M -0.55 0.08 H 0.55', stroke: '#c9a15b' },
        { d: 'M -0.55 0.24 H 0.55', stroke: '#c9a15b' },
      ],
    }
  }
  if (kind === 'tub') {
    return {
      parts: [
        { d: ellipse(0, 0, 0.88, 0.72), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0, 0, 0.62, 0.48), fill: '#7eb6d4', stroke: '#2a6288' },
      ],
      lines: [],
    }
  }
  if (kind === 'planter') {
    return {
      parts: [
        { d: roundRect(-0.72, -0.72, 1.44, 1.44, 0.08), fill: '#a85a3a', stroke: '#6a3424' },
        { d: ellipse(0, 0.08, 0.46, 0.46), fill: '#24522c', stroke: '#24522c' },
        { d: ellipse(-0.08, -0.06, 0.28, 0.24), fill: '#3d7a45', stroke: '#24522c' },
        { d: ellipse(0.16, 0.02, 0.16, 0.14), fill: '#6aaa4a', stroke: '#24522c' },
      ],
      lines: [],
    }
  }
  if (kind === 'pots') {
    return {
      parts: [
        { d: ellipse(-0.42, 0.18, 0.3, 0.34), fill: '#a85a3a', stroke: '#6a3424' },
        { d: ellipse(-0.42, -0.02, 0.16, 0.14), fill: '#3d7a45', stroke: '#24522c' },
        { d: ellipse(0.18, 0.22, 0.26, 0.3), fill: '#c4784a', stroke: '#6a3424' },
        { d: ellipse(0.18, 0.04, 0.14, 0.12), fill: '#3d7a45', stroke: '#24522c' },
        { d: ellipse(0.5, -0.22, 0.2, 0.22), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0.5, -0.34, 0.1, 0.08), fill: '#3d7a45', stroke: '#24522c' },
      ],
      lines: [],
    }
  }
  if (kind === 'pergola') {
    return {
      parts: [
        { d: roundRect(-0.92, -0.72, 1.84, 1.44, 0.03), fill: '#d7b98a', stroke: WOOD_DARK },
        { d: ellipse(-0.72, -0.5, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0.72, -0.5, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(-0.72, 0.5, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0.72, 0.5, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
      ],
      lines: [
        { d: 'M -0.92 0 H 0.92', stroke: WOOD_DARK },
        { d: 'M 0 -0.72 V 0.72', stroke: WOOD_DARK },
        { d: 'M -0.46 -0.72 V 0.72', stroke: WOOD_DARK },
        { d: 'M 0.46 -0.72 V 0.72', stroke: WOOD_DARK },
      ],
    }
  }
  if (kind === 'gazebo') {
    return {
      parts: [
        { d: ellipse(0, 0, 0.9, 0.9), fill: '#d7b98a', stroke: WOOD_DARK },
        { d: ellipse(0, -0.62, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0.54, -0.32, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0.54, 0.32, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0, 0.62, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(-0.54, 0.32, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(-0.54, -0.32, 0.08, 0.08), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: ellipse(0, 0, 0.28, 0.28), fill: '#efe8dc', stroke: WOOD_DARK },
      ],
      lines: [
        { d: 'M 0 -0.7 L 0.55 0.15 L 0 0.7 L -0.55 0.15 Z', stroke: WOOD_DARK },
      ],
    }
  }
  if (kind === 'fountain') {
    return {
      parts: [
        { d: ellipse(0, 0, 0.9, 0.9), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0, 0, 0.62, 0.62), fill: '#7eb6d4', stroke: '#2a6288' },
        { d: ellipse(0, 0, 0.18, 0.18), fill: '#f7f3ea', stroke: STONE_DARK },
        { d: ellipse(0, -0.28, 0.07, 0.07), fill: '#d7eefe', stroke: '#2a6288' },
      ],
      lines: [{ d: 'M 0 -0.1 V -0.55', stroke: '#d7eefe' }],
    }
  }
  if (kind === 'statue') {
    return {
      parts: [
        { d: roundRect(-0.38, 0.2, 0.76, 0.55, 0.04), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(0, -0.08, 0.32, 0.28), fill: '#b7b1a8', stroke: STONE_DARK },
        { d: ellipse(0, -0.42, 0.14, 0.16), fill: '#d5cfc6', stroke: STONE_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'greenhouse') {
    return {
      parts: [
        { d: roundRect(-0.92, -0.55, 1.84, 1.1, 0.04), fill: GLASS, stroke: '#6d8ea0' },
        { d: roundRect(-0.16, 0.05, 0.32, 0.5, 0.02), fill: '#e7f3ea', stroke: '#3d7a45' },
      ],
      lines: [
        { d: 'M -0.92 0 H 0.92', stroke: '#6d8ea0' },
        { d: 'M -0.46 -0.55 V 0.55', stroke: '#6d8ea0' },
        { d: 'M 0 -0.55 V 0.55', stroke: '#6d8ea0' },
        { d: 'M 0.46 -0.55 V 0.55', stroke: '#6d8ea0' },
      ],
    }
  }
  if (kind === 'sandbox') {
    return {
      parts: [
        { d: roundRect(-0.88, -0.62, 1.76, 1.24, 0.06), fill: '#e2c27a', stroke: WOOD_DARK },
        { d: ellipse(0.42, 0.18, 0.14, 0.14), fill: SUN, stroke: '#8a3030' },
      ],
      lines: [],
    }
  }
  return null
}

export function fixtureGlyph(kind: FixtureKind): FixtureGlyph {
  const extra = extraGlyph(kind)
  if (extra) return extra
  if (kind === 'boulder') {
    return {
      parts: [
        { d: blob(0.08, 0.06, 0.78, 0.66, 7, 0.16, 0.4), fill: STONE_DARK, stroke: STONE_DARK },
        { d: blob(-0.06, -0.04, 0.7, 0.58, 7, 0.14, 0.9), fill: STONE, stroke: STONE_DARK },
        { d: ellipse(-0.22, -0.2, 0.16, 0.1), fill: '#c8c2b8', stroke: STONE_DARK },
      ],
      lines: [{ d: 'M -0.2 -0.05 Q 0.05 0.12 0.28 -0.08', stroke: STONE_DARK }],
    }
  }
  if (kind === 'rocks') {
    return {
      parts: [
        { d: blob(-0.38, 0.12, 0.48, 0.4, 6, 0.14, 0.2), fill: '#9a948a', stroke: STONE_DARK },
        { d: blob(0.32, 0.16, 0.4, 0.34, 6, 0.12, 1.1), fill: STONE, stroke: STONE_DARK },
        { d: blob(0.02, -0.28, 0.36, 0.3, 6, 0.15, 0.6), fill: '#7d776f', stroke: STONE_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'slab') {
    return {
      parts: [{ d: poly([[-0.92, -0.42], [-0.55, -0.68], [0.78, -0.5], [0.96, 0.28], [0.2, 0.66], [-0.84, 0.46]]), fill: '#b7b1a8', stroke: STONE_DARK }],
      lines: [{ d: 'M -0.4 -0.2 L 0.55 0.08', stroke: '#8a847c' }],
    }
  }
  if (kind === 'bench') {
    return {
      parts: [
        { d: roundRect(-0.96, -0.18, 1.92, 0.36, 0.05), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(-0.9, -0.32, 0.14, 0.64, 0.03), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: roundRect(0.76, -0.32, 0.14, 0.64, 0.03), fill: WOOD_DARK, stroke: WOOD_DARK },
      ],
      lines: [{ d: 'M -0.78 -0.22 L 0.78 -0.22', stroke: WOOD_DARK }],
    }
  }
  if (kind === 'chair') {
    return {
      parts: [
        { d: roundRect(-0.46, -0.62, 0.92, 0.24, 0.06), fill: WOOD_DARK, stroke: WOOD_DARK },
        { d: roundRect(-0.4, -0.28, 0.8, 0.78, 0.08), fill: WOOD, stroke: WOOD_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'table') {
    return {
      parts: [
        { d: roundRect(-0.78, -0.95, 0.28, 0.28, 0.06), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(0.5, -0.95, 0.28, 0.28, 0.06), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(-0.78, 0.67, 0.28, 0.28, 0.06), fill: WOOD, stroke: WOOD_DARK },
        { d: roundRect(0.5, 0.67, 0.28, 0.28, 0.06), fill: WOOD, stroke: WOOD_DARK },
        { d: ellipse(0, 0, 0.62, 0.62), fill: '#d7b98a', stroke: WOOD_DARK },
      ],
      lines: [],
    }
  }
  if (kind === 'sofa') {
    return {
      parts: [
        { d: roundRect(-0.96, -0.46, 1.92, 0.92, 0.14), fill: '#6e5b4c', stroke: '#3e3228' },
        { d: roundRect(-0.96, -0.46, 0.22, 0.92, 0.08), fill: '#56483c', stroke: '#3e3228' },
        { d: roundRect(0.74, -0.46, 0.22, 0.92, 0.08), fill: '#56483c', stroke: '#3e3228' },
        { d: roundRect(-0.62, -0.28, 0.58, 0.56, 0.08), fill: '#8a7462', stroke: '#3e3228' },
        { d: roundRect(0.04, -0.28, 0.58, 0.56, 0.08), fill: '#8a7462', stroke: '#3e3228' },
      ],
      lines: [],
    }
  }
  if (kind === 'bollard') {
    return {
      parts: [
        { d: ellipse(0, 0, 0.62, 0.62), fill: '#2a2e2c', stroke: INK },
        { d: ellipse(0, 0, 0.24, 0.24), fill: '#e6c75a', stroke: '#8a7030' },
      ],
      lines: [],
    }
  }
  if (kind === 'lamp') {
    const lines: FixtureLine[] = []
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * TAU
      lines.push({ d: ray(angle, 0.48, 0.95), stroke: '#8a7030' })
    }
    return {
      parts: [
        { d: ellipse(0, 0, 0.4, 0.4), fill: '#f4e7b0', stroke: INK },
        { d: ellipse(0, 0, 0.12, 0.12), fill: '#1c2822', stroke: INK },
      ],
      lines,
    }
  }
  if (kind === 'spot') {
    return {
      parts: [
        { d: poly([[0, -0.9], [-0.62, 0.55], [0.62, 0.55]]), fill: '#2c3230', stroke: INK },
        { d: ellipse(0, -0.55, 0.2, 0.12), fill: '#f2e2a0', stroke: '#8a7030' },
      ],
      lines: [],
    }
  }
  if (kind === 'lantern') {
    return {
      parts: [
        { d: roundRect(-0.55, -0.55, 1.1, 1.1, 0.16), fill: '#243028', stroke: INK },
        { d: ellipse(0, 0, 0.28, 0.28), fill: '#f4e7b0', stroke: '#8a7030' },
      ],
      lines: [
        { d: 'M -0.55 0 H 0.55', stroke: '#d7cbb8' },
        { d: 'M 0 -0.55 V 0.55', stroke: '#d7cbb8' },
      ],
    }
  }
  if (kind === 'sedan') return car('#3e4c5e', -0.96, 0.68, -0.18, 0.55, 0.46)
  if (kind === 'suv') return car('#314238', -0.9, 0.84, -0.28, 0.78, 0.58)
  if (kind === 'wagon') return car('#4a4038', -0.98, 0.72, -0.08, 0.92, 0.52)
  if (kind === 'lounger') {
    return {
      parts: [
        { d: roundRect(-0.96, -0.28, 1.92, 0.56, 0.1), fill: CLOTH, stroke: '#8a8175' },
        { d: roundRect(0.42, -0.22, 0.46, 0.44, 0.08), fill: SUN, stroke: '#8a3030' },
      ],
      lines: [{ d: 'M -0.7 -0.28 V 0.28 M -0.2 -0.28 V 0.28 M 0.25 -0.28 V 0.28', stroke: '#b7aea2' }],
    }
  }
  if (kind === 'daybed') {
    return {
      parts: [
        { d: roundRect(-0.96, -0.5, 1.92, 1, 0.12), fill: '#efe8dc', stroke: '#8a8175' },
        { d: roundRect(-0.78, -0.32, 0.42, 0.64, 0.08), fill: SUN, stroke: '#8a3030' },
        { d: roundRect(0.36, -0.32, 0.42, 0.64, 0.08), fill: '#3f7ea8', stroke: '#1d4e72' },
      ],
      lines: [],
    }
  }
  if (kind === 'parasol') {
    const parts: FixturePart[] = []
    for (let i = 0; i < 8; i++) {
      parts.push({ d: wedge(i, 8, 0.92), fill: i % 2 === 0 ? '#3f7ea8' : '#f4f7f8', stroke: '#1d4e72' })
    }
    parts.push({ d: ellipse(0, 0, 0.08, 0.08), fill: '#c9a15b', stroke: WOOD_DARK })
    return { parts, lines: [] }
  }
  if (kind === 'compass') {
    return {
      parts: [
        { d: ellipse(0, 0, 0.92, 0.92), fill: '#f7f3ea', stroke: INK },
        { d: poly([[0, -0.78], [0.2, -0.02], [-0.2, -0.02]]), fill: '#9a3030', stroke: '#9a3030' },
        { d: poly([[0, 0.78], [0.2, 0.02], [-0.2, 0.02]]), fill: INK, stroke: INK },
        { d: poly([[0.78, 0], [0.02, 0.16], [0.02, -0.16]]), fill: '#8a8175', stroke: '#8a8175' },
        { d: poly([[-0.78, 0], [-0.02, 0.16], [-0.02, -0.16]]), fill: '#8a8175', stroke: '#8a8175' },
        { d: ellipse(0, 0, 0.07, 0.07), fill: INK, stroke: INK },
      ],
      lines: [],
    }
  }
  if (kind === 'scalebar') {
    return {
      parts: [
        { d: roundRect(-0.96, -0.16, 0.48, 0.32, 0.02), fill: INK, stroke: INK },
        { d: roundRect(-0.48, -0.16, 0.48, 0.32, 0.02), fill: '#f7f3ea', stroke: INK },
        { d: roundRect(0, -0.16, 0.48, 0.32, 0.02), fill: INK, stroke: INK },
        { d: roundRect(0.48, -0.16, 0.48, 0.32, 0.02), fill: '#f7f3ea', stroke: INK },
      ],
      lines: [],
    }
  }
  return {
    parts: [
      { d: roundRect(-0.62, -0.9, 1.24, 1.8, 0.1), fill: '#243028', stroke: INK },
      { d: roundRect(-0.46, -0.72, 0.92, 0.62, 0.05), fill: '#d5e6c8', stroke: '#6d8a62' },
      { d: ellipse(-0.28, 0.22, 0.1, 0.1), fill: '#f4e7b0', stroke: '#8a7030' },
      { d: ellipse(0, 0.22, 0.1, 0.1), fill: '#f7f3ea', stroke: '#8a8175' },
      { d: ellipse(0.28, 0.22, 0.1, 0.1), fill: '#f7f3ea', stroke: '#8a8175' },
      { d: ellipse(-0.14, 0.52, 0.1, 0.1), fill: '#9a3030', stroke: '#9a3030' },
      { d: ellipse(0.14, 0.52, 0.1, 0.1), fill: '#f7f3ea', stroke: '#8a8175' },
    ],
    lines: [],
  }
}

export function fixtureMarkup(item: Fixture, ppm: number, k: number): string {
  const spin = item.rotationDeg ? ` rotate(${num(item.rotationDeg)})` : ''
  if (item.kind === 'scalebar') return scaleMarkup(item, ppm, k, spin)
  const radius = Math.max(item.radiusM * ppm, 4)
  const glyph = fixtureGlyph(item.kind)
  const pen = num(1.15 / k)
  const parts = glyph.parts.map((part) => (
    `<path d="${part.d}" fill="${part.fill}" stroke="${part.stroke}" stroke-width="${pen}" vector-effect="non-scaling-stroke"/>`
  )).join('')
  const lines = glyph.lines.map((line) => (
    `<path d="${line.d}" fill="none" stroke="${line.stroke}" stroke-width="${pen}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
  )).join('')
  return `<g transform="translate(${num(item.x)} ${num(item.y)})${spin} scale(${num(radius)})">${parts}${lines}</g>`
}

function scaleMarkup(item: Fixture, ppm: number, k: number, spin: string): string {
  const metres = Math.max(item.radiusM * 2, 0.2)
  const len = Math.max(metres * ppm, 8)
  const half = len / 2
  const stroke = num(1.4 / k)
  const stepM = metres <= 6 ? 1 : metres <= 16 ? 2 : 5
  let ticks = ''
  for (let metre = 0; metre <= metres + 0.001; metre += stepM) {
    const x = -half + (metre / metres) * len
    ticks += `<line x1="${num(x)}" y1="${num(-5 / k)}" x2="${num(x)}" y2="${num(5 / k)}" stroke="#1c2822" stroke-width="${stroke}"/>`
  }
  const label = `${trim(metres)} м`
  return `<g transform="translate(${num(item.x)} ${num(item.y)})${spin}"><line x1="${num(-half)}" y1="0" x2="${num(half)}" y2="0" stroke="#1c2822" stroke-width="${stroke}"/>${ticks}<text x="0" y="${num(-7 / k)}" text-anchor="middle" font-size="${num(11 / k)}" fill="#1c2822" font-family="sans-serif">${label}</text></g>`
}

function car(body: string, x: number, height: number, cabinX: number, cabinW: number, cabinH: number): FixtureGlyph {
  const y = -height / 2
  const cabinY = -cabinH / 2
  return {
    parts: [
      { d: roundRect(x, y, -x * 2, height, 0.16), fill: body, stroke: INK },
      { d: roundRect(cabinX, cabinY, cabinW, cabinH, 0.08), fill: GLASS, stroke: '#6d8ea0' },
      { d: ellipse(x + 0.28, y - 0.02, 0.1, 0.07), fill: WHEEL, stroke: WHEEL },
      { d: ellipse(-x - 0.28, y - 0.02, 0.1, 0.07), fill: WHEEL, stroke: WHEEL },
      { d: ellipse(x + 0.28, y + height + 0.02, 0.1, 0.07), fill: WHEEL, stroke: WHEEL },
      { d: ellipse(-x - 0.28, y + height + 0.02, 0.1, 0.07), fill: WHEEL, stroke: WHEEL },
      { d: ellipse(x + 0.14, y + height * 0.28, 0.055, 0.045), fill: '#f4e7b0', stroke: '#8a7030' },
      { d: ellipse(x + 0.14, y + height * 0.72, 0.055, 0.045), fill: '#f4e7b0', stroke: '#8a7030' },
    ],
    lines: [{ d: `M ${num(x + 0.22)} ${num(y + height * 0.5)} H ${num(Math.min(cabinX, -x - 0.2))}`, stroke: '#d7cbb8' }],
  }
}

function ray(angle: number, inner: number, outer: number): string {
  return `M ${num(Math.cos(angle) * inner)} ${num(Math.sin(angle) * inner)} L ${num(Math.cos(angle) * outer)} ${num(Math.sin(angle) * outer)}`
}

function wedge(index: number, count: number, radius: number): string {
  const a0 = -Math.PI / 2 + (index / count) * TAU
  const a1 = -Math.PI / 2 + ((index + 1) / count) * TAU
  return `M 0 0 L ${num(Math.cos(a0) * radius)} ${num(Math.sin(a0) * radius)} A ${num(radius)} ${num(radius)} 0 0 1 ${num(Math.cos(a1) * radius)} ${num(Math.sin(a1) * radius)} Z`
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${num(cx + rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 1 ${num(cx - rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 1 ${num(cx + rx)} ${num(cy)} Z`
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2)
  const x2 = x + w
  const y2 = y + h
  return `M ${num(x + radius)} ${num(y)} H ${num(x2 - radius)} Q ${num(x2)} ${num(y)} ${num(x2)} ${num(y + radius)} V ${num(y2 - radius)} Q ${num(x2)} ${num(y2)} ${num(x2 - radius)} ${num(y2)} H ${num(x + radius)} Q ${num(x)} ${num(y2)} ${num(x)} ${num(y2 - radius)} V ${num(y + radius)} Q ${num(x)} ${num(y)} ${num(x + radius)} ${num(y)} Z`
}

function poly(points: [number, number][]): string {
  return `${points.map((point, index) => `${index === 0 ? 'M' : ' L'} ${num(point[0])} ${num(point[1])}`).join('')} Z`
}

function blob(cx: number, cy: number, rx: number, ry: number, count: number, wobble: number, turn: number): string {
  const startX = cx + Math.cos(turn) * rx
  const startY = cy + Math.sin(turn) * ry
  let d = `M ${num(startX)} ${num(startY)}`
  for (let i = 0; i < count; i++) {
    const mid = turn + ((i + 0.5) / count) * TAU
    const end = turn + ((i + 1) / count) * TAU
    const wave = 1 + wobble * Math.sin(i * 2.1 + count)
    const cx1 = cx + Math.cos(mid) * rx * wave
    const cy1 = cy + Math.sin(mid) * ry * wave
    const ex = cx + Math.cos(end) * rx
    const ey = cy + Math.sin(end) * ry
    d += ` Q ${num(cx1)} ${num(cy1)} ${num(ex)} ${num(ey)}`
  }
  return `${d} Z`
}

function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
