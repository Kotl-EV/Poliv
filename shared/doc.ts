import { nozzleById } from './nozzles.ts'
import { DEFAULT_SERIES, seriesById } from './pipes.ts'
import type { Climate, Doc, Drip, Pipe, Point, Slope, Soil, Source, Sprinkler, Trench, Valve, Zone, ZoneKind } from './types.ts'

export const SNAP_PX = 14

export function emptyDoc(): Doc {
  return {
    version: 1,
    pxPerMeter: null,
    pipeSeries: DEFAULT_SERIES,
    zones: [],
    sprinklers: [],
    pipes: [],
    valves: [],
    drips: [],
    source: null,
    trench: { widthM: 0.3, depthM: 0.4 },
  }
}

export function parseTrench(value: unknown): Trench | null {
  if (value === undefined || value === null) return { widthM: 0.3, depthM: 0.4 }
  if (typeof value !== 'object') return null
  const widthM = num((value as Trench).widthM)
  const depthM = num((value as Trench).depthM)
  if (widthM === null || depthM === null) return null
  if (widthM < 0.1 || widthM > 1.2 || depthM < 0.15 || depthM > 1.5) return null
  return { widthM, depthM }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f]/g, '').trim()
  if (!clean || clean.length > max) return null
  return clean
}

function point(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null
  const x = num((value as Point).x)
  const y = num((value as Point).y)
  if (x === null || y === null) return null
  return { x, y }
}

function points(value: unknown, min: number, max: number): Point[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null
  const out: Point[] = []
  for (const item of value) {
    const p = point(item)
    if (!p) return null
    out.push(p)
  }
  return out
}

const KINDS = new Set<ZoneKind>(['lawn', 'bed', 'path'])

export function defaultDose(kind: ZoneKind): number {
  if (kind === 'bed') return 8
  if (kind === 'path') return 0
  return 6
}

const SOILS = new Set<Soil>(['sand', 'loam', 'clay'])
const SLOPES = new Set<Slope>(['flat', 'mild', 'steep'])
const CLIMATES = new Set<Climate>(['shade', 'open', 'wind'])
const CLIMATE_FACTOR: Record<Climate, number> = { shade: 0.7, open: 1, wind: 1.3 }
const INTAKE: Record<Soil, number> = { sand: 25, loam: 12, clay: 5 }
const SLOPE_FACTOR: Record<Slope, number> = { flat: 1, mild: 0.75, steep: 0.5 }
const SOAK: Record<Soil, number> = { sand: 15, loam: 30, clay: 45 }

export function asSoil(value: unknown): Soil {
  return typeof value === 'string' && SOILS.has(value as Soil) ? value as Soil : 'loam'
}

export function asSlope(value: unknown): Slope {
  return typeof value === 'string' && SLOPES.has(value as Slope) ? value as Slope : 'flat'
}

export function asClimate(value: unknown): Climate {
  return typeof value === 'string' && CLIMATES.has(value as Climate) ? value as Climate : 'open'
}

export function climateFactor(climate: Climate): number {
  return CLIMATE_FACTOR[climate]
}

export function intakeMmH(soil: Soil, slope: Slope): number {
  return INTAKE[soil] * SLOPE_FACTOR[slope]
}

export function soakMinutes(soil: Soil): number {
  return SOAK[soil]
}

/** Сколько включений нужно, чтобы вылить норму, не превышая впитывание. */
export function cyclePlan(runtimeMin: number | null, precipMmH: number | null, soil: Soil, slope: Slope): { cycles: number | null; soakMin: number } {
  const soakMin = soakMinutes(soil)
  if (runtimeMin === null) return { cycles: null, soakMin }
  if (runtimeMin <= 0) return { cycles: 0, soakMin: 0 }
  const intake = intakeMmH(soil, slope)
  if (!precipMmH || precipMmH <= intake) return { cycles: 1, soakMin: 0 }
  const cycles = Math.ceil(runtimeMin / ((intake / precipMmH) * 60) - 1e-9)
  return { cycles, soakMin: cycles > 1 ? soakMin : 0 }
}

export function parseDoc(value: unknown): Doc | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Doc>
  if (raw.version !== 1) return null
  const px = raw.pxPerMeter
  if (px !== null && (typeof px !== 'number' || !Number.isFinite(px) || px <= 0 || px > 100_000)) return null
  if (!Array.isArray(raw.zones) || raw.zones.length > 200) return null
  if (!Array.isArray(raw.sprinklers) || raw.sprinklers.length > 2000) return null
  if (!Array.isArray(raw.pipes) || raw.pipes.length > 2000) return null
  if (raw.valves !== undefined && (!Array.isArray(raw.valves) || raw.valves.length > 500)) return null
  if (raw.drips !== undefined && (!Array.isArray(raw.drips) || raw.drips.length > 400)) return null

  const zones: Zone[] = []
  for (const item of raw.zones) {
    if (!item || typeof item !== 'object') return null
    const id = text(item.id, 80)
    const name = text(item.name, 80)
    const pts = points(item.points, 3, 500)
    if (!id || !name || !pts || !KINDS.has(item.kind)) return null
    const dose = num(item.doseMm)
    const doseMm = dose === null ? defaultDose(item.kind) : dose
    if (doseMm < 0 || doseMm > 40) return null
    zones.push({
      id,
      name,
      kind: item.kind,
      points: pts,
      doseMm,
      soil: asSoil(item.soil),
      slope: asSlope(item.slope),
      climate: asClimate(item.climate),
    })
  }

  const sprinklers: Sprinkler[] = []
  for (const item of raw.sprinklers) {
    if (!item || typeof item !== 'object') return null
    const id = text(item.id, 80)
    const x = num(item.x)
    const y = num(item.y)
    const radiusM = num(item.radiusM)
    const arcDeg = num(item.arcDeg)
    const rotationDeg = num(item.rotationDeg)
    const flowLph = num(item.flowLph)
    const nozzleId = text(item.nozzleId, 40)
    if (!id || !nozzleId || x === null || y === null || radiusM === null || arcDeg === null || rotationDeg === null || flowLph === null) {
      return null
    }
    if (radiusM <= 0 || radiusM > 40 || arcDeg <= 0 || arcDeg > 360 || flowLph < 0 || flowLph > 20_000) return null
    sprinklers.push({
      id,
      nozzleId: nozzleById(nozzleId).id === nozzleId ? nozzleId : nozzleById(nozzleId).id,
      x,
      y,
      radiusM,
      arcDeg,
      rotationDeg,
      flowLph,
    })
  }

  const pipes: Pipe[] = []
  for (const item of raw.pipes) {
    if (!item || typeof item !== 'object') return null
    const id = text(item.id, 80)
    const pts = points(item.points, 2, 500)
    if (!id || !pts) return null
    pipes.push({ id, points: pts })
  }

  let source: Source | null = null
  if (raw.source !== null && raw.source !== undefined) {
    source = sourceOf(raw.source)
    if (!source) return null
  }

  const valves = parseValves(raw.valves)
  const drips = parseDrips(raw.drips)
  if (!valves || !drips) return null

  const pipeSeries = seriesById(typeof raw.pipeSeries === 'string' ? raw.pipeSeries : DEFAULT_SERIES).id
  const trench = parseTrench(raw.trench)
  if (!trench) return null

  return { version: 1, pxPerMeter: px, pipeSeries, zones, sprinklers, pipes, valves, drips, source, trench }
}

function parseValves(value: unknown): Valve[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const valves: Valve[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const id = text(item.id, 80)
    const name = text(item.name, 80)
    const place = point(item)
    if (!id || !name || !place) return null
    valves.push({ id, name, x: place.x, y: place.y })
  }
  return valves
}

function parseDrips(value: unknown): Drip[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const drips: Drip[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const id = text(item.id, 80)
    const pts = points(item.points, 2, 500)
    const spacingM = num(item.spacingM)
    const emitterLph = num(item.emitterLph)
    if (!id || !pts || spacingM === null || emitterLph === null) return null
    if (spacingM < 0.05 || spacingM > 2 || emitterLph < 0.2 || emitterLph > 40) return null
    drips.push({ id, points: pts, spacingM, emitterLph })
  }
  return drips
}

function sourceOf(value: unknown): Source | null {
  const place = point(value)
  if (!place || !value || typeof value !== 'object') return null
  const raw = value as Partial<Source>
  const pressure = num(raw.pressureBar)
  const limit = raw.flowLimitLph === null || raw.flowLimitLph === undefined ? null : num(raw.flowLimitLph)
  return {
    x: place.x,
    y: place.y,
    pressureBar: pressure !== null && pressure >= 0.2 && pressure <= 16 ? pressure : 3,
    flowLimitLph: limit !== null && limit > 0 && limit <= 1_000_000 ? limit : null,
  }
}
