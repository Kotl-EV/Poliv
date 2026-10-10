export type NozzleKind = 'fan' | 'rotator' | 'rotor' | 'bubbler'

export type Nozzle = {
  id: string
  kind: NozzleKind
  name: string
  radiusM: number
  arcDeg: number
  flowLph: number
}

const ARCS = [90, 180, 270, 360] as const

/** Свои типы, без каталогов производителей. Внутри семейства 90° / 180° / 360° = 1 / 2 / 4. */
export const NOZZLES: Nozzle[] = [
  ...family('fan', 'Веер', [2, 3, 4.5], 4.5, 360),
  ...family('rotator', 'Ротатор', [4, 6, 9], 6, 360),
  ...family('rotor', 'Ротор', [8, 10, 12, 15], 10, 720),
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

function family(kind: NozzleKind, title: string, radii: number[], baseM: number, baseFlow: number): Nozzle[] {
  const out: Nozzle[] = []
  for (const radiusM of radii) {
    for (const arcDeg of ARCS) {
      const half = Math.max(2, Math.round(Math.round(baseFlow * (radiusM / baseM) ** 2) / 2) * 2)
      const flowLph = arcDeg === 90 ? half / 2 : arcDeg === 270 ? Math.round(half * 1.5) : arcDeg === 360 ? half * 2 : half
      out.push({
        id: legacyId(kind, radiusM, arcDeg) ?? `${kind === 'rotator' ? 'rot' : kind}${tag(radiusM)}-${arcDeg}`,
        kind,
        name: `${title} ${metres(radiusM)} м ${arcDeg}°`,
        radiusM,
        arcDeg,
        flowLph,
      })
    }
  }
  return out
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
