import type { PipeSeriesId } from './pipes.ts'
import type { HatchId } from './landscape.ts'

export type { HatchId }

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
  /** Вырезы внутри контура, против часовой или по часовой — без разницы. */
  holes?: Point[][]
  doseMm: number
  soil: Soil
  slope: Slope
  climate: Climate
  /** Штриховка. Пусто — рисунок по умолчанию для kind. */
  hatch?: HatchId
  /** Прозрачность контура, 0.15–1. Пусто — без дополнительного приглушения. */
  opacity?: number
  /** Обводка #rrggbb. Пусто — цвет поверхности. */
  stroke?: string
  /** Толщина обводки в пикселях листа. Пусто — обычная. */
  pen?: number
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
  /** Высота выдвижения корпуса. Пусто — 10 см. */
  riseCm?: 15 | 30
}

/** Магистраль идёт от источника к клапанам, зональная — от клапана к дождевателям. */
export type PipeRole = 'main' | 'zone'

export type Pipe = {
  id: string
  points: Point[]
  /** Пусто у старых файлов: участок за клапаном считается зональным, остальное магистралью. */
  role?: PipeRole
  /** Клапан, из которого выходит эта линия. Нужен, когда несколько клапанов стоят в одном боксе. */
  valveId?: string
}

export type Valve = {
  id: string
  name: string
  x: number
  y: number
  /** Клапанный бокс. Пусто — клапан сам по себе. */
  boxId?: string
}

export type ValveBox = {
  id: string
  name: string
  x: number
  y: number
}

export type Hydrant = {
  id: string
  x: number
  y: number
}

export type Sleeve = {
  id: string
  a: Point
  b: Point
}

export type Drip = {
  id: string
  points: Point[]
  spacingM: number
  emitterLph: number
  /** Трубка без капельниц: подвод к кольцу. Пусто значит с капельницами. */
  bare?: boolean
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

export type Note = {
  id: string
  x: number
  y: number
  text: string
  sizeM: number
  /** Цвет #rrggbb. Пусто — чернила чертежа. */
  color?: string
  bold?: boolean
  /** Остриё стрелки. Пусто — подпись без выноски. */
  leader?: Point
}

export type PlantKind = 'tree' | 'bush'

export type PlantForm =
  | 'leaf' | 'round' | 'spread' | 'conifer' | 'column' | 'weep' | 'palm' | 'clump'
  | 'oak' | 'pine' | 'spruce' | 'birch' | 'fruit' | 'olive' | 'cypress' | 'bamboo'
  | 'ball' | 'wide' | 'needle' | 'bloom' | 'group' | 'cushion'
  | 'hedge' | 'rose' | 'box' | 'fern' | 'grass' | 'spiral'

export type Plant = {
  id: string
  kind: PlantKind
  x: number
  y: number
  radiusM: number
  /** Крона. Пусто — лиственное дерево или шаровидный куст. */
  form?: PlantForm
  /** Поворот по часовой, градусы. Пусто — без поворота. */
  rotationDeg?: number
}

export type Measure = {
  id: string
  a: Point
  b: Point
}

/** Знак на плане. На полив не влияет. */
export type FixtureKind =
  | 'boulder' | 'rocks' | 'slab' | 'steps' | 'wall' | 'pebble'
  | 'bench' | 'chair' | 'table' | 'sofa' | 'picnic' | 'swing' | 'hammock' | 'stool'
  | 'bollard' | 'lamp' | 'spot' | 'lantern' | 'spike' | 'twin'
  | 'sedan' | 'suv' | 'wagon' | 'pickup' | 'van' | 'bike' | 'moto'
  | 'lounger' | 'daybed' | 'parasol' | 'grill' | 'tub'
  | 'planter' | 'pots' | 'pergola' | 'gazebo' | 'fountain' | 'statue' | 'greenhouse' | 'sandbox'
  | 'compass' | 'scalebar' | 'controller'

export type Fixture = {
  id: string
  kind: FixtureKind
  x: number
  y: number
  /** Половина длинной стороны, м. */
  radiusM: number
  /** Поворот по часовой, градусы. Пусто — без поворота. */
  rotationDeg?: number
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
  /** Клапанные боксы. Пусто у старых файлов. */
  boxes?: ValveBox[]
  /** Гидранты. Пусто у старых файлов. */
  hydrants?: Hydrant[]
  /** Гильзы, футляры на пересечениях. Пусто у старых файлов. */
  sleeves?: Sleeve[]
  drips: Drip[]
  source: Source | null
  trench: Trench
  /** Подписи на чертеже. Пусто у старых файлов. */
  notes?: Note[]
  /** Деревья и кусты. Расчёт ставит капельницы к ним. */
  plants?: Plant[]
  /** Камни, мебель, свет, машины, шезлонги и знаки листа. */
  fixtures?: Fixture[]
  /** Размеры, которые остаются на чертеже. */
  measures?: Measure[]
  /** Привязка к вершинам. Пусто значит включена. */
  snapVertex?: boolean
  /** Точка, вокруг которой крутят и масштабируют контур. */
  anchor?: Point
  /** Ортогональ без Shift. Пусто значит выключена. */
  ortho?: boolean
  /** Дни и старт пульта. Пусто — понедельник, среда и пятница в 06:00. */
  program?: Program
}

/** Дни пульта: 0 — понедельник … 6 — воскресенье. */
export type Program = {
  days: number[]
  startHour: number
  startMin: number
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
  role: PipeRole
  /** Клапан, после которого идёт участок. Пусто — магистраль или нет станции. */
  stationId: string
  /** Вода течёт от a к b. Пусто — направление неизвестно. */
  downB?: boolean
}

export type PlanIssue = {
  text: string
  kind: 'sprinkler' | 'drip' | 'valve'
  id: string
}

export type StationMark = {
  id: string
  kind: 'sprinkler' | 'drip'
  stationId: string
}

export type FittingKind = 'cap' | 'elbow' | 'reducer' | 'tee' | 'cross' | 'node'

/** Знак фитинга на узле трубы. Считается вместе со спецификацией. */
export type FittingMark = {
  x: number
  y: number
  /** Куда смотрит знак: по часовой от верха, градусы. */
  rotationDeg: number
  kind: FittingKind
  name: string
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
  /** Углы, переходы, тройники, крестовины и заглушки на узлах. Гидрант и старт капли сюда не входят. */
  fittingMarks: FittingMark[]
  /** Короткий гибкий хвост от узла трубы до головки, не дальше метра. */
  tails: { a: Point; b: Point; lengthM: number }[]
  trench: { widthM: number; depthM: number; lengthM: number | null; volumeM3: number | null }
  warnings: string[]
  /** По одному на оторванный дождеватель, трубку или клапан. Текст предупреждения остаётся общим. */
  issues: PlanIssue[]
  /** Головка или капля, которые питает станция. Номер на плане берётся отсюда. */
  marks: StationMark[]
  /** Остаток давления у головки, которая стоит на сети. Свободная головка сюда не входит. */
  pressureMarks: PressureMark[]
}

/** Остаток у дождевателя после потерь в трубах. */
export type PressureMark = {
  id: string
  x: number
  y: number
  /** Бар, уже округлён до десятой. */
  bar: number
  /** Ниже 2 бар, головке мало. */
  low: boolean
}
