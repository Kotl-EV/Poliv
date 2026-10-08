import type { PipeSeriesId } from './pipes.ts'

export type Point = { x: number; y: number }

export type ZoneKind = 'lawn' | 'bed' | 'shrub' | 'path' | 'concrete' | 'water' | 'building'
export type Soil = 'sand' | 'loam' | 'clay'
export type Slope = 'flat' | 'mild' | 'steep'
export type Climate = 'shade' | 'open' | 'wind'

export type Zone = {
  id: string
  name: string
  kind: ZoneKind
  points: Point[]
  /** Quadratic control for edge i → i+1. Null = straight. */
  bends?: (Point | null)[]
  doseMm: number
  soil: Soil
  slope: Slope
  climate: Climate
}

export type Sprinkler = {
  id: string
  nozzleId: string
  x: number
  y: number
  radiusM: number
  arcDeg: number
  rotationDeg: number
  flowLph: number
}

export type Pipe = {
  id: string
  points: Point[]
}

export type Valve = {
  id: string
  name: string
  x: number
  y: number
}

export type Drip = {
  id: string
  points: Point[]
  spacingM: number
  emitterLph: number
}

export type Source = {
  x: number
  y: number
  pressureBar: number
  flowLimitLph: number | null
}

export type Trench = {
  widthM: number
  depthM: number
}

export type Doc = {
  version: 1
  pxPerMeter: number | null
  pipeSeries: PipeSeriesId
  sheetM?: { w: number; h: number }
  gridOn?: boolean
  snapGrid?: boolean
  zones: Zone[]
  sprinklers: Sprinkler[]
  pipes: Pipe[]
  valves: Valve[]
  drips: Drip[]
  source: Source | null
  trench: Trench
}

export type SegmentStatus = 'ok' | 'unfed' | 'cycle'

export type SegmentResult = {
  pipeId: string
  a: Point
  b: Point
  lengthM: number | null
  flowLph: number | null
  odMm: number | null
  idMm: number | null
  name: string | null
  velocity: number | null
  headLossM: number | null
  residualHeadM: number | null
  status: SegmentStatus
}

export type Analysis = {
  segments: SegmentResult[]
  pipes: { odMm: number; name: string; lengthM: number }[]
  nozzles: { nozzleId: string; name: string; count: number; flowLph: number }[]
  zones: {
    id: string
    name: string
    kind: ZoneKind
    areaM2: number | null
    precipMmH: number | null
    doseMm: number
    runtimeMin: number | null
    soil: Soil
    slope: Slope
    climate: Climate
    appliedMm: number
    intakeMmH: number
    cycles: number | null
    soakMin: number
  }[]
  totalFlowLph: number
  connectedFlowLph: number
  sourceHeadM: number | null
  minResidualHeadM: number | null
  programMin: number | null
  clockMin: number | null
  stations: { id: string; name: string; flowLph: number; runtimeMin: number | null; cycles: number | null; soakMin: number }[]
  drips: { lengthM: number | null; emitters: number; flowLph: number }
  fittings: { name: string; count: number }[]
  trench: { widthM: number; depthM: number; lengthM: number | null; volumeM3: number | null }
  warnings: string[]
}
