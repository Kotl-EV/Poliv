export type NozzleKind = 'fan' | 'rotator' | 'rotor' | 'bubbler'

/** Как на полке: фиксированный сектор, регулируемое, полоса, угол, низкий угол. Без таблиц давления. */
export type NozzlePattern = 'fixed' | 'adjust' | 'strip' | 'corner' | 'low'

export type StripPlace = 'side' | 'end' | 'left' | 'right'

export type Nozzle = {
  id: string
  kind: NozzleKind
  name: string
  radiusM: number
  arcDeg: number
  flowLph: number
  pattern?: NozzlePattern
  /** Регулируемое и угловое сопло: сектор крутится в этих пределах. */
  arcMin?: number
  arcMax?: number
  /** Полоса: ширина прямоугольника. Длина вперёд лежит в radiusM. */
  widthM?: number
  strip?: StripPlace
}

const ARCS = [90, 120, 180, 270, 360] as const

/** Свои типы. Внутри семейства 90° / 180° / 360° = 1 / 2 / 4, 120° — треть круга. */
export const NOZZLES: Nozzle[] = [
  ...family('fan', 'Веер', [2, 3, 4.5], 4.5, 360),
  ...family('rotator', 'Ротатор', [4, 6, 9], 6, 360),
  ...family('rotor', 'Ротор', [8, 10, 12, 15], 10, 720),
  ...adjustable('fan', 'Веер', [2, 3, 4.5], 4.5, 360, 0, 360),
  ...adjustable('rotator', 'Ротатор', [4, 6, 9], 6, 360, 90, 360),
  ...family('rotor', 'Ротор низкий угол', [6, 8, 10], 10, 720, 'rotorLa').map((item) => ({ ...item, pattern: 'low' as const })),
  strip('fan', 'fan-ss', 'side'),
  strip('fan', 'fan-es', 'end'),
  strip('fan', 'fan-lcs', 'left'),
  strip('fan', 'fan-rcs', 'right'),
  strip('rotator', 'rot-ss', 'side'),
  strip('rotator', 'rot-es', 'end'),
  strip('rotator', 'rot-lcs', 'left'),
  strip('rotator', 'rot-rcs', 'right'),
  corner(),
  bubbler('bub60', 0.5, 360, 60),
  bubbler('bub120', 0.5, 360, 120),
  bubbler('bub240', 0.6, 360, 240),
  bubbler('bub240h', 0.6, 180, 240),
  bubbler('bub480', 0.9, 360, 480),
]

export function nozzleById(id: string): Nozzle {
  return NOZZLES.find((item) => item.id === id) ?? NOZZLES.find((item) => item.id === 'fan180') ?? NOZZLES[0]
}

export function nozzlesOf(kind: NozzleKind): Nozzle[] {
  return NOZZLES.filter((item) => item.kind === kind)
}

/** Радиус стандартного ротора при ~3 бар. Номер — обычный номер сопла, одна точка, не таблица давлений. */
const ROTOR_MARKS: { code: string; radiusM: number; low: boolean }[] = [
  { code: '0.75', radiusM: 9.1, low: false },
  { code: '1', radiusM: 9.4, low: false },
  { code: '1.5', radiusM: 10.1, low: false },
  { code: '2', radiusM: 11, low: false },
  { code: '3', radiusM: 11.6, low: false },
  { code: '4', radiusM: 12.2, low: false },
  { code: '6', radiusM: 13.1, low: false },
  { code: '8', radiusM: 13.7, low: false },
  { code: '1', radiusM: 7.3, low: true },
  { code: '3', radiusM: 9.8, low: true },
  { code: '4', radiusM: 10.4, low: true },
  { code: '6', radiusM: 11.6, low: true },
]

export function rotorMark(radiusM: number, low: boolean): { code: string; radiusM: number } {
  const rows = ROTOR_MARKS.filter((item) => item.low === low)
  let best = rows[0]
  let gap = Infinity
  for (const row of rows) {
    const next = Math.abs(row.radiusM - radiusM)
    if (next < gap) {
      best = row
      gap = next
    }
  }
  return { code: best.code, radiusM: best.radiusM }
}

function family(kind: NozzleKind, title: string, radii: number[], baseM: number, baseFlow: number, idPrefix?: string): Nozzle[] {
  const out: Nozzle[] = []
  for (const radiusM of radii) {
    const half = halfFlow(baseFlow, radiusM, baseM)
    for (const arcDeg of ARCS) {
      out.push({
        id: (idPrefix ? null : legacyId(kind, radiusM, arcDeg)) ?? `${idPrefix ?? (kind === 'rotator' ? 'rot' : kind)}${tag(radiusM)}-${arcDeg}`,
        kind,
        name: `${title} ${metres(radiusM)} м ${arcDeg}°`,
        radiusM,
        arcDeg,
        flowLph: flowForArc(half, arcDeg),
        pattern: 'fixed',
      })
    }
  }
  return out
}

function adjustable(kind: NozzleKind, title: string, radii: number[], baseM: number, baseFlow: number, arcMin: number, arcMax: number): Nozzle[] {
  return radii.map((radiusM) => {
    const half = halfFlow(baseFlow, radiusM, baseM)
    return {
      id: `${kind === 'rotator' ? 'rot' : kind}${tag(radiusM)}-adj`,
      kind,
      name: `${title} регулируемое ${metres(radiusM)} м`,
      radiusM,
      arcDeg: 180,
      flowLph: half,
      pattern: 'adjust' as const,
      arcMin,
      arcMax,
    }
  })
}

function strip(kind: 'fan' | 'rotator', id: string, place: StripPlace): Nozzle {
  const side = place === 'side'
  const forward = side ? 1.5 : 4.5
  const width = side ? 9 : 1.5
  const placeName = place === 'side' ? 'боковая' : place === 'end' ? 'торцевая' : place === 'left' ? 'угловая левая' : 'угловая правая'
  const title = kind === 'fan' ? 'Полоса' : 'Полоса-ротатор'
  const size = side ? '1,5×9' : '1,5×4,5'
  return {
    id,
    kind,
    name: `${title} ${placeName} ${size} м`,
    radiusM: forward,
    arcDeg: 180,
    flowLph: stripFlow(kind, forward * width),
    pattern: 'strip',
    widthM: width,
    strip: place,
  }
}

function corner(): Nozzle {
  return {
    id: 'rot-corner',
    kind: 'rotator',
    name: 'Ротатор угловой 2–4,5 м',
    radiusM: 4,
    arcDeg: 90,
    flowLph: halfFlow(360, 4, 6) / 2,
    pattern: 'corner',
    arcMin: 45,
    arcMax: 105,
  }
}

function halfFlow(baseFlow: number, radiusM: number, baseM: number): number {
  return Math.max(2, Math.round(Math.round(baseFlow * (radiusM / baseM) ** 2) / 2) * 2)
}

function flowForArc(half: number, arcDeg: number): number {
  if (arcDeg === 90) return half / 2
  if (arcDeg === 120) return Math.round((half * 2) / 3)
  if (arcDeg === 270) return Math.round(half * 1.5)
  if (arcDeg === 360) return half * 2
  return half
}

/** Осадки полосы как у полного круга своего семейства. */
function stripFlow(kind: 'fan' | 'rotator', areaM2: number): number {
  const radius = kind === 'fan' ? 4.5 : 6
  const precip = 720 / (Math.PI * radius * radius)
  return Math.max(2, Math.round((precip * areaM2) / 2) * 2)
}

function legacyId(kind: NozzleKind, radiusM: number, arcDeg: number): string | null {
  if (kind === 'fan' && radiusM === 4.5) {
    if (arcDeg === 90) return 'fan90'
    if (arcDeg === 180) return 'fan180'
    if (arcDeg === 360) return 'fan360'
  }
  if (kind === 'rotor' && radiusM === 10) {
    if (arcDeg === 90) return 'rotor90'
    if (arcDeg === 180) return 'rotor'
    if (arcDeg === 360) return 'rotor360'
  }
  return null
}

function bubbler(id: string, radiusM: number, arcDeg: number, flowLph: number): Nozzle {
  const litres = flowLph / 60
  const amount = Number.isInteger(litres) ? String(litres) : litres.toFixed(1)
  const sector = arcDeg >= 359 ? '' : ` ${arcDeg}°`
  return { id, kind: 'bubbler', name: `Баблер ${amount} л/мин${sector}`, radiusM, arcDeg, flowLph }
}

function tag(radiusM: number): string {
  return Number.isInteger(radiusM) ? String(radiusM) : String(radiusM).replace('.', '')
}

function metres(radiusM: number): string {
  return Number.isInteger(radiusM) ? String(radiusM) : radiusM.toFixed(1)
}
