import { SNAP_PX, defaultDose, emptyDoc } from './doc.ts'
import { placeDripAtPlant } from './drip.ts'
import { dist, pointInPolygon, pointInZone, polygonAreaPx, zoneAreaPx } from './geom.ts'
import { isDripKind, isObstacleKind, isSprayKind, isWetKind } from './landscape.ts'
import { nozzleById } from './nozzles.ts'
import { placeSprayOnPolygon, ringsOverlap, type SprayFamily } from './spray.ts'
import type { Doc, PipeRole, Point, Zone, ZoneKind } from './types.ts'

export type Rgb = [number, number, number]
export type InkRole = 'structure' | 'hatch' | 'plant' | 'bed' | 'grid' | 'stipple'
export type InkSeg = { a: Point; b: Point; role: InkRole }

const MAX_HEADS = 120
const MAX_DRIPS = 48
const STATION_LPH = 1500
const MIN_LAWN_M2 = 8
const PLANT_DRIP_MIN = 90

type HeadSpot = { key: number; point: Point; nozzleId: string; rotationDeg: number }
type LaidPipe = { id: string; points: Point[]; role: PipeRole }
type DripSpot = { key: number; points: Point[]; spacingM: number; emitterLph: number }

/** Подпись «Масштаб 1:200» на листе. */
export function sheetScaleRatio(text: string): number | null {
  const match = text.match(/масштаб\s*1\s*[:：]\s*(\d{2,5})/i)
  if (!match) return null
  const ratio = Number(match[1])
  if (ratio < 20 || ratio > 5000) return null
  return ratio
}

/** Пиксели картинки на метр земли. Ширина листа — в пунктах PDF, уже с поворотом страницы. */
export function pxPerMeterFromPage(pageWidthPx: number, pageWidthPt: number, ratio: number): number {
  const groundM = (pageWidthPt / 72) * 0.0254 * ratio
  return pageWidthPx / groundM
}

/**
 * Линейка вида 0–1–2–10–20: длинный штрих и поперечные засечки.
 * Возвращает пиксели на метр в той же системе, что и отрезки.
 */
export function scaleBarPxPerMeter(strokes: { a: Point; b: Point }[]): number | null {
  const horiz: { x0: number; x1: number; y: number }[] = []
  const ticks: { x: number; y: number }[] = []
  for (const stroke of strokes) {
    const dx = stroke.b.x - stroke.a.x
    const dy = stroke.b.y - stroke.a.y
    const len = Math.hypot(dx, dy)
    if (Math.abs(dy) <= 1.4 && len >= 20 && len <= 420) {
      horiz.push({ x0: Math.min(stroke.a.x, stroke.b.x), x1: Math.max(stroke.a.x, stroke.b.x), y: (stroke.a.y + stroke.b.y) / 2 })
    } else if (Math.abs(dx) <= 1.4 && len >= 2.5 && len <= 18) {
      ticks.push({ x: (stroke.a.x + stroke.b.x) / 2, y: (stroke.a.y + stroke.b.y) / 2 })
    }
  }
  let best: number | null = null
  let bestScore = 0
  for (const bar of horiz) {
    const xs = [bar.x0, bar.x1]
    for (const tick of ticks) {
      if (Math.abs(tick.y - bar.y) > 8 || tick.x < bar.x0 - 4 || tick.x > bar.x1 + 4) continue
      if (xs.some((x) => Math.abs(x - tick.x) <= 2.5)) continue
      xs.push(tick.x)
    }
    xs.sort((a, b) => a - b)
    if (xs.length < 4) continue
    const gaps: number[] = []
    for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1])
    const shortest = Math.min(...gaps)
    const small = gaps.filter((gap) => gap <= shortest * 1.6)
    const unit = small.reduce((sum, gap) => sum + gap, 0) / small.length
    if (unit < 3) continue
    const parts = gaps.map((gap) => gap / unit)
    if (parts.some((part) => Math.abs(part - Math.round(part)) > 0.32)) continue
    if (Math.max(...parts.map((part) => Math.round(part))) < 4) continue
    const meters = parts.reduce((sum, part) => sum + Math.round(part), 0)
    if (meters < 8 || meters > 100) continue
    const head = Math.round(parts[0]) === 1 && Math.round(parts[1]) === 1
    const score = (head ? 100 : 0) + meters
    if (score <= bestScore) continue
    bestScore = score
    best = (xs[xs.length - 1] - xs[0]) / meters
  }
  return best
}

function channel(value: number): number {
  return value > 1 ? value / 255 : value
}

/** Ось листа — рамка и штамп. Цветные и косые линии — сам участок. */
export function segmentRole(a: Point, b: Point, rgb: Rgb, pxPerMeter: number): InkRole | null {
  const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
  const lenM = lenPx / pxPerMeter
  if (lenM < 0.12) return null
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  const axis = dx + dy === 0 || dx < 0.18 * (dx + dy) || dy < 0.18 * (dx + dy)
  if (axis) return null
  const r = channel(rgb[0])
  const g = channel(rgb[1])
  const bl = channel(rgb[2])
  if (g > 0.45 && g > r + 0.12 && g > bl + 0.08) return 'plant'
  if (r > 0.72 && r > g && g > 0.22 && bl < 0.5 && r - bl > 0.35) return 'bed'
  if (r < 0.22 && g < 0.22 && bl < 0.25) {
    if (lenM < 1.35) return 'hatch'
    if (lenM < 2.4) return 'grid'
    return 'structure'
  }
  const max = Math.max(r, g, bl)
  const min = Math.min(r, g, bl)
  if (g >= r && g + 0.02 >= bl && g > 0.5 && r > 0.35 && max - min < 0.28 && lenM >= 0.04 && lenM <= 2.5) return 'stipple'
  if (max - min < 0.1 && max >= 0.72 && lenM >= 0.7 && lenM <= 90) return 'grid'
  return null
}

type Cell = { c: number; r: number }

export function layoutPlan(page: { width: number; height: number; pxPerMeter: number }, segments: InkSeg[]): Doc | null {
  const ppm = page.pxPerMeter
  if (!(ppm > 0) || page.width < 8 || page.height < 8) return null
  const cellM = Math.max(0.5, (SNAP_PX + 2) / ppm)
  const cellPx = cellM * ppm
  const cols = Math.max(1, Math.ceil(page.width / cellPx))
  const rows = Math.max(1, Math.ceil(page.height / cellPx))
  const keyOf = (c: number, r: number) => c + r * cols
  const stamp = new Map<number, { structure: number; hatch: number; plant: number; bed: number; grid: number; stipple: number }>()

  const mark = (c: number, r: number, role: InkRole) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return
    const key = keyOf(c, r)
    const row = stamp.get(key) ?? { structure: 0, hatch: 0, plant: 0, bed: 0, grid: 0, stipple: 0 }
    row[role] += 1
    stamp.set(key, row)
  }

  const gridSegs = peelGrid(segments, ppm)
  for (const seg of segments) {
    const role: InkRole = gridSegs.has(seg) ? 'grid' : seg.role === 'grid' ? 'hatch' : seg.role
    const steps = Math.max(1, Math.ceil(Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) / cellPx))
    for (let s = 0; s <= steps; s++) {
      const x = seg.a.x + ((seg.b.x - seg.a.x) * s) / steps
      const y = seg.a.y + ((seg.b.y - seg.a.y) * s) / steps
      mark(Math.floor(x / cellPx), Math.floor(y / cellPx), role)
    }
  }
  if (stamp.size < 4) return null

  const inkKeys = [...stamp.keys()]
  const components = connected(inkKeys, cols, rows)
  components.sort((a, b) => b.length - a.length)
  const largest = components[0]
  if (!largest || largest.length < 4) return null
  let hull = convexHull(largest.map((key) => center(key)))
  if (hull.length < 3) return null

  const included = new Set(largest)
  for (const component of components.slice(1)) {
    const mid = centroid(component.map((key) => center(key)))
    if (pointInPolygon(mid, hull) || distanceToRing(mid, hull) <= 2.5 * ppm) {
      for (const key of component) included.add(key)
    }
  }
  hull = convexHull([...included].map((key) => center(key)))
  if (hull.length < 3) return null
  const siteM2 = polygonAreaPx(hull) / (ppm * ppm)
  if (siteM2 < 40) return null

  const inside: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pointInPolygon(center(keyOf(c, r)), hull)) inside.push(keyOf(c, r))
    }
  }
  const counts = (key: number) => stamp.get(key) ?? { structure: 0, hatch: 0, plant: 0, bed: 0, grid: 0, stipple: 0 }

  const buildings = findBuildings(segments.filter((seg) => seg.role === 'structure' && !gridSegs.has(seg)), ppm, siteM2)
    .filter((ring) => pointInPolygon(centroid(ring), hull))
    .filter((ring) => quietInterior(ring))
  const bedCap = Math.min(80, siteM2 * 0.2)
  const beds = ringsInside(joinRings(segments.filter((seg) => seg.role === 'bed'), 0.8 * ppm), hull, siteM2, 4, 0.4)
    .filter((ring) => polygonAreaPx(ring) / (ppm * ppm) <= bedCap)
  const plantRings = ringsInside(joinRings(segments.filter((seg) => seg.role === 'plant'), 0.45 * ppm), hull, siteM2, 6, 0.25)
    .filter((ring) => polygonAreaPx(ring) / (ppm * ppm) <= bedCap)
    .filter((ring) => !beds.some((bed) => pointInPolygon(centroid(ring), bed)))
  const knownBeds = [...beds, ...plantRings]
  const plantKeys = inside.filter((key) => {
    const row = counts(key)
    if (row.plant < 1) return false
    const point = center(key)
    return !knownBeds.some((ring) => pointInPolygon(point, ring))
  })
  const plantClusters = connected(plantKeys, cols, rows)
    .flatMap((part) => splitCells(part, bedCap, cellM * cellM, cols, rows))
    .map((part) => convexHull(part.map((key) => center(key))))
    .filter((ring) => {
      const area = polygonAreaPx(ring) / (ppm * ppm)
      return area >= 6 && area <= bedCap
    })
  const bedRings = [...knownBeds, ...plantClusters].slice(0, 24)

  const buildingAt = (key: number) => buildings.some((ring) => pointInPolygon(center(key), ring))
  const bedAt = (key: number) => bedRings.some((ring) => pointInPolygon(center(key), ring))

  const paving: number[] = []
  const lawnKeys: number[] = []
  // На генплане с сеткой мощения пустая бумага — не газон. На дендроплане сетки нет, пустые клетки остаются газоном.
  const bareIsDry = gridSegs.size >= 24
  for (const key of inside) {
    if (buildingAt(key)) continue
    if (bedAt(key) || counts(key).plant >= 2 || counts(key).bed >= 1) continue
    if (counts(key).grid >= 1 || counts(key).hatch >= 3) {
      paving.push(key)
      continue
    }
    if (bareIsDry && counts(key).plant < 1 && counts(key).hatch < 1 && counts(key).stipple < 1) continue
    lawnKeys.push(key)
  }

  const ids = sequencer()
  const zones: Zone[] = []
  const lawnParts = connected(lawnKeys, cols, rows).filter((part) => part.length * cellM * cellM >= MIN_LAWN_M2)
  for (const [index, part] of lawnParts.entries()) {
    const traced = zoneRing(part, cols, cellPx)
    const ring = simplify(traced.length >= 3 ? traced : convexHull(part.map((key) => center(key))), 0.9 * ppm)
    if (ring.length < 3) continue
    zones.push({
      id: ids('zone'),
      name: index === 0 ? 'Газон' : `Газон ${index + 1}`,
      kind: 'lawn' as const,
      points: ring,
      doseMm: defaultDose('lawn'),
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    })
  }

  bedRings.forEach((ring, index) => {
    const points = simplify(ring, 0.6 * ppm)
    if (points.length < 3 || points.length > 500) return
    if (polygonAreaPx(points) / (ppm * ppm) < 4) return
    zones.push({
      id: ids('zone'),
      name: index === 0 ? 'Клумба' : `Клумба ${index + 1}`,
      kind: 'bed' as const,
      points,
      doseMm: defaultDose('bed'),
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    })
  })

  if (process.env.PLAN_DEBUG) {
    const roles = { structure: 0, hatch: 0, plant: 0, bed: 0, grid: 0, stipple: 0 }
    for (const seg of segments) roles[seg.role] += 1
    console.log(JSON.stringify({ siteM2: Math.round(siteM2), roles, grid: gridSegs.size, buildings: buildings.length, lawns: lawnParts.length, pavingCells: paving.length }))
  }
  const pathParts = connected(paving, cols, rows)
    .filter((part) => part.length * cellM * cellM >= 8)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
  pathParts.forEach((part, index) => {
    const traced = zoneRing(part, cols, cellPx)
    const ring = simplify(traced.length >= 3 ? traced : convexHull(part.map((key) => center(key))), 1.1 * ppm)
    if (ring.length < 3) return
    zones.push({
      id: ids('zone'),
      name: index === 0 ? 'Мощение' : `Мощение ${index + 1}`,
      kind: 'path' as const,
      points: ring,
      doseMm: defaultDose('path'),
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    })
  })

  const allowed = new Set(inside.filter((key) => !buildingAt(key)))
  const heads: HeadSpot[] = []
  for (const part of lawnParts) {
    heads.push(...placeSprayHeads({
      part,
      ppm,
      cellPx,
      cols,
      origin: { x: 0, y: 0 },
      center,
      holes: [...buildings, ...bedRings],
    }))
    if (heads.length >= MAX_HEADS) break
  }
  if (heads.length > MAX_HEADS) heads.length = MAX_HEADS

  const drips: DripSpot[] = []

  if (heads.length === 0 && drips.length === 0) return null

  const avoidRoot = [...heads.map((head) => head.point), ...drips.map((drip) => drip.points[0])]
  const root = boundaryCell(inside, hull, cols, rows, center, allowed, avoidRoot)
  if (root === null) return null
  const taken = new Set<number>([root])
  for (const head of heads) {
    const next = !taken.has(head.key) ? head.key : freeCell(head.key, allowed, taken, cols, rows)
    if (next === null) {
      head.key = -1
      continue
    }
    head.key = next
    taken.add(next)
  }
  for (const drip of drips) {
    if (!taken.has(drip.key)) {
      taken.add(drip.key)
      continue
    }
    const next = freeCell(drip.key, allowed, taken, cols, rows)
    if (next === null) {
      drip.key = -1
      continue
    }
    drip.key = next
    taken.add(next)
  }
  const placedHeads = heads.filter((head) => head.key >= 0)
  const placedDrips = drips.filter((drip) => drip.key >= 0)
  const reachable = steiner(root, [...placedHeads.map((head) => head.key), ...placedDrips.map((drip) => drip.key)], allowed, cols, rows)
  const keptHeads = placedHeads.filter((head) => reachable.has(head.key))
  const keptDrips = placedDrips.filter((drip) => reachable.has(drip.key))
  if (keptHeads.length === 0 && keptDrips.length === 0) return null

  const consumers = [
    ...keptHeads.map((head) => ({ key: head.key, flow: nozzleById(head.nozzleId).flowLph, kind: 'spray' as const })),
    ...keptDrips.map((drip) => ({ key: drip.key, flow: dripFlow(drip, ppm), kind: 'drip' as const })),
  ]
  const zoneRuntime = new Map<string, number>()
  for (const zone of zones) {
    const area = zoneAreaPx(zone.points, zone.holes) / (ppm * ppm)
    if (zone.doseMm <= 0 || area <= 0) {
      zoneRuntime.set(zone.id, 0)
      continue
    }
    let flow = 0
    for (const head of keptHeads) {
      if (pointInZone(head.point, zone.points, zone.holes)) flow += nozzleById(head.nozzleId).flowLph
    }
    for (const drip of keptDrips) {
      if (!isDripKind(zone.kind)) continue
      if (pointInZone(centroid(drip.points), zone.points, zone.holes)) flow += dripFlow(drip, ppm)
    }
    zoneRuntime.set(zone.id, flow > 0 ? (zone.doseMm / (flow / area)) * 60 : 0)
  }
  const runtimeAt = (point: Point) => {
    let best = 0
    for (const zone of zones) {
      if (!pointInZone(point, zone.points, zone.holes)) continue
      best = Math.max(best, zoneRuntime.get(zone.id) ?? 0)
    }
    return best
  }
  const runtimeOf = new Map<number, number>()
  for (const head of keptHeads) runtimeOf.set(head.key, Math.max(runtimeOf.get(head.key) ?? 0, runtimeAt(head.point)))
  for (const drip of keptDrips) runtimeOf.set(drip.key, PLANT_DRIP_MIN)
  consumers.sort((a, b) => (runtimeOf.get(b.key) ?? 0) - (runtimeOf.get(a.key) ?? 0) || b.flow - a.flow || a.key - b.key)
  const groups: { key: number; flow: number; kind: 'spray' | 'drip' }[][] = []
  const bins: { flow: number; runtime: number; kind: 'spray' | 'drip' }[] = []
  for (const item of consumers) {
    const runtime = runtimeOf.get(item.key) ?? 0
    let best = -1
    let bestCost = Infinity
    for (let i = 0; i < bins.length; i++) {
      if (bins[i].kind !== item.kind) continue
      if (bins[i].flow + item.flow > STATION_LPH) continue
      const cost = Math.max(bins[i].runtime, runtime) - bins[i].runtime
      const tighter = cost < bestCost || (cost === bestCost && best !== -1 && bins[i].flow > bins[best].flow)
      if (tighter) {
        bestCost = cost
        best = i
      }
    }
    if (best === -1) {
      groups.push([item])
      bins.push({ flow: item.flow, runtime, kind: item.kind })
    } else {
      groups[best].push(item)
      bins[best].flow += item.flow
      bins[best].runtime = Math.max(bins[best].runtime, runtime)
    }
  }

  const terminalKeys = new Set(consumers.map((item) => item.key))
  const reserved = new Set<number>([root, ...terminalKeys])
  const spots: number[] = []
  for (const group of groups) {
    if (groups.length === 1) {
      spots.push(root)
      continue
    }
    const mid = centroid(group.map((item) => center(item.key)))
    let best: number | null = null
    let bestD = Infinity
    for (const key of allowed) {
      if (reserved.has(key)) continue
      const distance = dist(center(key), mid)
      if (distance < bestD) {
        bestD = distance
        best = key
      }
    }
    const valveSpot: number = best ?? root
    spots.push(valveSpot)
    if (valveSpot !== root) reserved.add(valveSpot)
  }
  const reached = new Set<number>()
  const valveKeys: number[] = []
  const pipes: LaidPipe[] = []
  const clear = (a: Point, b: Point) => segmentClear(a, b, buildings, cellPx)
  const trunkAllowed = new Set<number>([root])
  for (const key of allowed) if (!terminalKeys.has(key)) trunkAllowed.add(key)
  for (const spot of spots) trunkAllowed.add(spot)
  const trunk = steiner(root, spots.filter((spot) => spot !== root), trunkAllowed, cols, rows)
  const trunkCells = new Set(trunk.keys())
  pipes.push(...pipesFromTree(trunk, center, ids, clear, new Set(spots), 'main'))
  for (let i = 0; i < groups.length; i++) {
    const spot = spots[i]
    if (spot !== root && !trunk.has(spot)) {
      pipes.push({ id: ids('pipe'), points: [center(root), center(spot)], role: 'main' })
    }
    const owned = groups[i].map((item) => item.key)
    const local = new Set<number>([spot])
    for (const key of allowed) {
      if (key !== spot && trunkCells.has(key)) continue
      if (terminalKeys.has(key) && !owned.includes(key)) continue
      if (spots.some((other) => other === key && other !== spot)) continue
      local.add(key)
    }
    const { prev } = dijkstra(new Map([[spot, null]]), local, cols, rows, terminalKeys)
    let hit = false
    for (const key of owned) {
      const cells = key === spot ? [spot] : pathTo(prev, key, spot)
      if (cells && cells.length >= 2) {
        const points = shorten(cells.map(center), clear)
        if (points.length >= 2) pipes.push({ id: ids('pipe'), points, role: 'zone' })
        hit = true
        reached.add(key)
        continue
      }
      if (key === spot) {
        hit = true
        reached.add(key)
        continue
      }
      pipes.push({ id: ids('pipe'), points: [center(spot), center(key)], role: 'zone' })
      hit = true
      reached.add(key)
    }
    if (hit && !valveKeys.includes(spot)) valveKeys.push(spot)
  }
  const finalHeads = keptHeads.filter((head) => reached.has(head.key))
  const finalDrips = keptDrips.filter((drip) => reached.has(drip.key))
  if (finalHeads.length === 0 && finalDrips.length === 0) return null
  for (const head of finalHeads) {
    const at = center(head.key)
    if (dist(at, head.point) > 1) pipes.push({ id: ids('pipe'), points: [at, head.point], role: 'zone' })
  }
  const sourcePoint = sourceOutside(center(root), centroid(hull), cellPx, page)
  pipes.unshift({ id: ids('pipe'), points: [sourcePoint, center(root)], role: 'main' })
  const doc = emptyDoc()
  doc.pxPerMeter = ppm
  doc.zones = zones
  doc.source = { x: sourcePoint.x, y: sourcePoint.y, pressureBar: 3, flowLimitLph: null }
  doc.sprinklers = finalHeads.map((head) => {
    const nozzle = nozzleById(head.nozzleId)
    return {
      id: ids('head'),
      nozzleId: nozzle.id,
      x: head.point.x,
      y: head.point.y,
      radiusM: nozzle.radiusM,
      arcDeg: nozzle.arcDeg,
      rotationDeg: head.rotationDeg,
      flowLph: nozzle.flowLph,
    }
  })
  doc.drips = finalDrips.map((drip) => ({ id: ids('drip'), points: drip.points, spacingM: drip.spacingM, emitterLph: drip.emitterLph }))
  doc.valves = valveKeys.map((key, index) => ({ id: ids('valve'), name: `Клапан ${index + 1}`, ...center(key) }))
  doc.pipes = treePipes(pipes, SNAP_PX, ids)
  return doc

  function center(key: number): Point {
    const c = key % cols
    const r = Math.floor(key / cols)
    return { x: (c + 0.5) * cellPx, y: (r + 0.5) * cellPx }
  }

  function quietInterior(ring: Point[]): boolean {
    let total = 0
    let noisy = 0
    for (const key of inside) {
      if (!pointInPolygon(center(key), ring)) continue
      total += 1
      const row = counts(key)
      if (row.plant > 0 || row.hatch >= 3) noisy += 1
    }
    return total >= 4 && noisy / total < 0.12
  }
}

/** Схема полива по зонам и источнику, которые уже начертил пользователь. */
export function layoutIrrigation(doc: Doc, family: SprayFamily = 'auto'): Doc | null {
  const ppm = doc.pxPerMeter
  const source = doc.source
  if (ppm == null || !(ppm > 0) || !source) return null
  const irrigable = doc.zones.filter((zone) => isWetKind(zone.kind) && zone.points.length >= 3)
  if (irrigable.length === 0) return null

  const cellM = Math.max(0.5, (SNAP_PX + 2) / ppm)
  const cellPx = cellM * ppm
  const pts: Point[] = [source]
  for (const zone of doc.zones) pts.push(...zone.points)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of pts) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const pad = cellPx * 2
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellPx))
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellPx))
  const keyOf = (c: number, r: number) => c + r * cols
  const center = (key: number): Point => {
    const c = key % cols
    const r = Math.floor(key / cols)
    return { x: minX + (c + 0.5) * cellPx, y: minY + (r + 0.5) * cellPx }
  }
  const lawnKeys: number[] = []
  const allowed = new Set<number>()
  const hull = convexHull(pts)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = keyOf(c, r)
      const point = center(key)
      const mask = wetMask(point, doc.zones)
      if (mask === 'spray') lawnKeys.push(key)
      if (mask !== 'hard' && (mask !== null || (hull.length >= 3 && pointInPolygon(point, hull)))) allowed.add(key)
    }
  }

  const lawnSet = new Set(lawnKeys)
  const heads: HeadSpot[] = []
  for (const zone of doc.zones) {
    if (!isSprayKind(zone.kind) || zone.points.length < 3) continue
    if (zoneAreaPx(zone.points, zone.holes) / (ppm * ppm) < MIN_LAWN_M2) continue
    const holes = [
      ...(zone.holes ?? []),
      ...doc.zones
        .filter((other) => other.id !== zone.id && (isDripKind(other.kind) || isObstacleKind(other.kind)))
        .filter((other) => ringsOverlap(zone.points, other.points))
        .map((other) => other.points),
    ]
    for (const spot of placeSprayOnPolygon(zone.points, holes, ppm, family)) {
      if (heads.length >= MAX_HEADS) break
      const key = snapHeadKey(spot.point, lawnSet, center) ?? snapHeadKey(spot.point, allowed, center)
      if (key === null) continue
      heads.push({ key, ...spot })
    }
  }
  if (heads.length > MAX_HEADS) heads.length = MAX_HEADS

  const drips: DripSpot[] = []
  for (const plant of doc.plants ?? []) {
    if (drips.length >= MAX_DRIPS) break
    if (!plantGetsDrip(plant, doc.zones)) continue
    const run = placeDripAtPlant(plant, ppm)
    if (!run || run.points.length < 2) continue
    const spot = nearestKey(run.points[0], allowed, center)
    if (spot === null) continue
    drips.push({ key: spot, points: run.points, spacingM: run.spacingM, emitterLph: run.emitterLph })
  }

  if (heads.length === 0 && drips.length === 0) return null
  const avoidRoot = [...heads.map((head) => head.point), ...drips.map((drip) => drip.points[0])]
  const root = nearestKey(source, allowed, center, avoidRoot, SNAP_PX) ?? nearestKey(source, allowed, center)
  if (root === null) return null

  const taken = new Set<number>([root])
  for (const head of heads) {
    const next = !taken.has(head.key) ? head.key : freeCell(head.key, allowed, taken, cols, rows)
    if (next === null) {
      head.key = -1
      continue
    }
    head.key = next
    taken.add(next)
  }
  for (const drip of drips) {
    if (!taken.has(drip.key)) {
      taken.add(drip.key)
      continue
    }
    const next = freeCell(drip.key, allowed, taken, cols, rows)
    if (next === null) {
      drip.key = -1
      continue
    }
    drip.key = next
    taken.add(next)
  }
  const placedHeads = heads.filter((head) => head.key >= 0)
  const placedDrips = drips.filter((drip) => drip.key >= 0)
  const reachable = steiner(root, [...placedHeads.map((head) => head.key), ...placedDrips.map((drip) => drip.key)], allowed, cols, rows)
  const keptHeads = placedHeads.filter((head) => reachable.has(head.key))
  const keptDrips = placedDrips.filter((drip) => reachable.has(drip.key))
  if (keptHeads.length === 0 && keptDrips.length === 0) return null

  const consumers = [
    ...keptHeads.map((head) => ({ key: head.key, flow: nozzleById(head.nozzleId).flowLph, kind: 'spray' as const })),
    ...keptDrips.map((drip) => ({ key: drip.key, flow: dripFlow(drip, ppm), kind: 'drip' as const })),
  ]
  const zoneRuntime = new Map<string, number>()
  for (const zone of doc.zones) {
    const area = zoneAreaPx(zone.points, zone.holes) / (ppm * ppm)
    if (zone.doseMm <= 0 || area <= 0) {
      zoneRuntime.set(zone.id, 0)
      continue
    }
    let flow = 0
    for (const head of keptHeads) {
      if (pointInZone(head.point, zone.points, zone.holes)) flow += nozzleById(head.nozzleId).flowLph
    }
    for (const drip of keptDrips) {
      if (!isDripKind(zone.kind)) continue
      if (pointInZone(centroid(drip.points), zone.points, zone.holes)) flow += dripFlow(drip, ppm)
    }
    zoneRuntime.set(zone.id, flow > 0 ? (zone.doseMm / (flow / area)) * 60 : 0)
  }
  const runtimeAt = (point: Point) => {
    let best = 0
    for (const zone of doc.zones) {
      if (!pointInZone(point, zone.points, zone.holes)) continue
      best = Math.max(best, zoneRuntime.get(zone.id) ?? 0)
    }
    return best
  }
  const runtimeOf = new Map<number, number>()
  for (const head of keptHeads) runtimeOf.set(head.key, Math.max(runtimeOf.get(head.key) ?? 0, runtimeAt(head.point)))
  for (const drip of keptDrips) runtimeOf.set(drip.key, PLANT_DRIP_MIN)
  consumers.sort((a, b) => (runtimeOf.get(b.key) ?? 0) - (runtimeOf.get(a.key) ?? 0) || b.flow - a.flow || a.key - b.key)
  const groups: { key: number; flow: number; kind: 'spray' | 'drip' }[][] = []
  const bins: { flow: number; runtime: number; kind: 'spray' | 'drip' }[] = []
  for (const item of consumers) {
    const runtime = runtimeOf.get(item.key) ?? 0
    let best = -1
    let bestCost = Infinity
    for (let i = 0; i < bins.length; i++) {
      if (bins[i].kind !== item.kind) continue
      if (bins[i].flow + item.flow > STATION_LPH) continue
      const cost = Math.max(bins[i].runtime, runtime) - bins[i].runtime
      const tighter = cost < bestCost || (cost === bestCost && best !== -1 && bins[i].flow > bins[best].flow)
      if (tighter) {
        bestCost = cost
        best = i
      }
    }
    if (best === -1) {
      groups.push([item])
      bins.push({ flow: item.flow, runtime, kind: item.kind })
    } else {
      groups[best].push(item)
      bins[best].flow += item.flow
      bins[best].runtime = Math.max(bins[best].runtime, runtime)
    }
  }

  const terminalKeys = new Set(consumers.map((item) => item.key))
  const reserved = new Set<number>([root, ...terminalKeys])
  const spots: number[] = []
  for (const group of groups) {
    if (groups.length === 1) {
      spots.push(root)
      continue
    }
    const mid = centroid(group.map((item) => center(item.key)))
    let best: number | null = null
    let bestD = Infinity
    for (const key of allowed) {
      if (reserved.has(key)) continue
      const distance = dist(center(key), mid)
      if (distance < bestD) {
        bestD = distance
        best = key
      }
    }
    const valveSpot: number = best ?? root
    spots.push(valveSpot)
    if (valveSpot !== root) reserved.add(valveSpot)
  }
  const reached = new Set<number>()
  const valveKeys: number[] = []
  const pipes: LaidPipe[] = []
  const ids = sequencer()
  const buildings = doc.zones.filter((zone) => zone.kind === 'building' || zone.kind === 'water').map((zone) => zone.points)
  const clear = (a: Point, b: Point) => segmentClear(a, b, buildings, cellPx)
  const trunkAllowed = new Set<number>([root])
  for (const key of allowed) if (!terminalKeys.has(key)) trunkAllowed.add(key)
  for (const spot of spots) trunkAllowed.add(spot)
  const trunk = steiner(root, spots.filter((spot) => spot !== root), trunkAllowed, cols, rows)
  const trunkCells = new Set(trunk.keys())
  pipes.push(...pipesFromTree(trunk, center, ids, clear, new Set(spots), 'main'))
  for (let i = 0; i < groups.length; i++) {
    const spot = spots[i]
    if (spot !== root && !trunk.has(spot)) {
      pipes.push({ id: ids('pipe'), points: [center(root), center(spot)], role: 'main' })
    }
    const owned = groups[i].map((item) => item.key)
    const local = new Set<number>([spot])
    for (const key of allowed) {
      if (key !== spot && trunkCells.has(key)) continue
      if (terminalKeys.has(key) && !owned.includes(key)) continue
      if (spots.some((other) => other === key && other !== spot)) continue
      local.add(key)
    }
    const { prev } = dijkstra(new Map([[spot, null]]), local, cols, rows, terminalKeys)
    let hit = false
    for (const key of owned) {
      const cells = key === spot ? [spot] : pathTo(prev, key, spot)
      if (cells && cells.length >= 2) {
        const points = shorten(cells.map(center), clear)
        if (points.length >= 2) pipes.push({ id: ids('pipe'), points, role: 'zone' })
        hit = true
        reached.add(key)
        continue
      }
      if (key === spot) {
        hit = true
        reached.add(key)
        continue
      }
      pipes.push({ id: ids('pipe'), points: [center(spot), center(key)], role: 'zone' })
      hit = true
      reached.add(key)
    }
    if (hit && !valveKeys.includes(spot)) valveKeys.push(spot)
  }
  const finalHeads = keptHeads.filter((head) => reached.has(head.key))
  const finalDrips = keptDrips.filter((drip) => reached.has(drip.key))
  if (finalHeads.length === 0 && finalDrips.length === 0) return null
  for (const head of finalHeads) {
    const at = center(head.key)
    if (dist(at, head.point) > 1) pipes.push({ id: ids('pipe'), points: [at, head.point], role: 'zone' })
  }
  for (const drip of finalDrips) {
    const at = center(drip.key)
    const start = drip.points[0]
    if (start && dist(at, start) > 1) pipes.push({ id: ids('pipe'), points: [at, start], role: 'zone' })
  }

  pipes.unshift({ id: ids('pipe'), points: [{ x: source.x, y: source.y }, center(root)], role: 'main' })
  return {
    ...doc,
    sprinklers: finalHeads.map((head) => {
      const nozzle = nozzleById(head.nozzleId)
      return {
        id: ids('head'),
        nozzleId: nozzle.id,
        x: head.point.x,
        y: head.point.y,
        radiusM: nozzle.radiusM,
        arcDeg: nozzle.arcDeg,
        rotationDeg: head.rotationDeg,
        flowLph: nozzle.flowLph,
      }
    }),
    drips: finalDrips.map((drip) => ({ id: ids('drip'), points: drip.points, spacingM: drip.spacingM, emitterLph: drip.emitterLph })),
    valves: valveKeys.map((key, index) => ({ id: ids('valve'), name: `Клапан ${index + 1}`, ...center(key) })),
    pipes: treePipes(pipes, SNAP_PX, ids),
  }
}

function sequencer(): (prefix: string) => string {
  let n = 0
  return (prefix) => `${prefix}-${++n}`
}

function treePipes(
  pipes: LaidPipe[],
  snap: number,
  ids: (prefix: string) => string,
): LaidPipe[] {
  const segs: { a: Point; b: Point; len: number; role: PipeRole }[] = []
  for (const pipe of pipes) {
    for (let i = 1; i < pipe.points.length; i++) {
      const a = pipe.points[i - 1]
      const b = pipe.points[i]
      const len = dist(a, b)
      if (len < 0.5) continue
      segs.push({ a, b, len, role: pipe.role })
    }
  }
  segs.sort((left, right) => left.len - right.len)
  const nodes: Point[] = []
  const parent: number[] = []
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i]
    return i
  }
  const idx = (point: Point): number => {
    const hit = nodes.findIndex((node) => dist(node, point) <= snap)
    if (hit >= 0) return hit
    nodes.push(point)
    parent.push(parent.length)
    return nodes.length - 1
  }
  const kept: { a: Point; b: Point; role: PipeRole }[] = []
  for (const seg of segs) {
    const a = idx(seg.a)
    const b = idx(seg.b)
    if (a === b) continue
    const pa = find(a)
    const pb = find(b)
    if (pa === pb) continue
    parent[pa] = pb
    kept.push({ a: seg.a, b: seg.b, role: seg.role })
  }
  return kept.map((seg) => ({ id: ids('pipe'), points: [seg.a, seg.b], role: seg.role }))
}

function splitCells(keys: number[], maxArea: number, cellArea: number, cols: number, rows: number): number[][] {
  const maxCells = Math.max(4, Math.floor(maxArea / Math.max(cellArea, 1e-6)))
  if (keys.length <= maxCells) return [keys]
  const remaining = new Set(keys)
  const chunks: number[][] = []
  const dirs = [-1, 1, -cols, cols, -cols - 1, -cols + 1, cols - 1, cols + 1]
  while (remaining.size) {
    const start = remaining.values().next().value as number
    remaining.delete(start)
    const chunk: number[] = []
    const queue = [start]
    while (queue.length && chunk.length < maxCells) {
      const key = queue.shift()!
      chunk.push(key)
      if (chunk.length >= maxCells) break
      const c = key % cols
      for (const dir of dirs) {
        const next = key + dir
        if (!remaining.has(next) || next < 0 || next >= cols * rows) continue
        if (Math.abs((next % cols) - c) > 1) continue
        remaining.delete(next)
        queue.push(next)
      }
    }
    for (const key of queue) remaining.add(key)
    chunks.push(chunk)
  }
  return chunks
}

function freeCell(near: number, allowed: Set<number>, taken: Set<number>, cols: number, rows: number): number | null {
  const queue = [near]
  const seen = new Set<number>([near])
  while (queue.length) {
    const key = queue.shift()!
    if (allowed.has(key) && !taken.has(key)) return key
    const c = key % cols
    for (const next of [key - 1, key + 1, key - cols, key + cols]) {
      if (next < 0 || next >= cols * rows || seen.has(next)) continue
      if (Math.abs((next % cols) - c) > 1) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return null
}

function connected(keys: number[], cols: number, rows: number): number[][] {
  const set = new Set(keys)
  const seen = new Set<number>()
  const parts: number[][] = []
  const dirs = [-1, 1, -cols, cols, -cols - 1, -cols + 1, cols - 1, cols + 1]
  for (const start of keys) {
    if (seen.has(start)) continue
    const part: number[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const key = queue.pop()!
      part.push(key)
      for (const dir of dirs) {
        const next = key + dir
        if (!set.has(next) || seen.has(next)) continue
        const c = key % cols
        const nc = next % cols
        if (Math.abs(nc - c) > 1) continue
        if (next < 0 || next >= cols * rows) continue
        seen.add(next)
        queue.push(next)
      }
    }
    parts.push(part)
  }
  return parts
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const uniq = sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1].x || point.y !== sorted[index - 1].y)
  if (uniq.length <= 2) return uniq
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const point of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let i = uniq.length - 1; i >= 0; i--) {
    const point = uniq[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function distanceToRing(point: Point, ring: Point[]): number {
  if (pointInPolygon(point, ring)) return 0
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointSegmentDistance(point, ring[i], ring[(i + 1) % ring.length]))
  }
  return best
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len === 0) return dist(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

type RuledLine = { ux: number; uy: number; nx: number; ny: number; offset: number; p0: number; p1: number; segs: InkSeg[] }

function linePoint(line: RuledLine, along: number): Point {
  return { x: line.nx * line.offset + line.ux * along, y: line.ny * line.offset + line.uy * along }
}

function projectOn(line: RuledLine, point: Point): { offset: number; along: number } {
  return { offset: point.x * line.nx + point.y * line.ny, along: point.x * line.ux + point.y * line.uy }
}

/** Частая параллельная штриховка — мощение, а не стены домов. */
function peelGrid(segments: InkSeg[], ppm: number): Set<InkSeg> {
  const lines: RuledLine[] = []
  for (const seg of segments) {
    if (seg.role !== 'grid' && seg.role !== 'structure') continue
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    let theta = Math.atan2(dy, dx)
    if (theta < 0) theta += Math.PI
    const ux = Math.cos(theta)
    const uy = Math.sin(theta)
    const fresh: RuledLine = { ux, uy, nx: -uy, ny: ux, offset: 0, p0: 0, p1: 0, segs: [seg] }
    const a = projectOn(fresh, seg.a)
    const b = projectOn(fresh, seg.b)
    fresh.offset = (a.offset + b.offset) / 2
    fresh.p0 = Math.min(a.along, b.along)
    fresh.p1 = Math.max(a.along, b.along)
    let hit: RuledLine | null = null
    for (const line of lines) {
      if (Math.abs(fresh.ux * line.ux + fresh.uy * line.uy) < 0.99) continue
      const mid = linePoint(line, (line.p0 + line.p1) / 2)
      const placed = projectOn(fresh, mid)
      if (Math.abs(placed.offset - fresh.offset) > 0.22 * ppm) continue
      const start = projectOn(fresh, linePoint(line, line.p0)).along
      const end = projectOn(fresh, linePoint(line, line.p1)).along
      const q0 = Math.min(start, end)
      const q1 = Math.max(start, end)
      if (fresh.p1 < q0 - 1.2 * ppm || fresh.p0 > q1 + 1.2 * ppm) continue
      const n = line.segs.length
      const left = projectOn(line, seg.a)
      const right = projectOn(line, seg.b)
      line.offset = (line.offset * n + (left.offset + right.offset) / 2) / (n + 1)
      line.p0 = Math.min(line.p0, left.along, right.along)
      line.p1 = Math.max(line.p1, left.along, right.along)
      line.segs.push(seg)
      hit = line
      break
    }
    if (!hit) lines.push(fresh)
  }
  const long = lines.filter((line) => line.p1 - line.p0 >= 1.5 * ppm)
  const sideGap = (line: RuledLine, other: RuledLine) => {
    const mid = linePoint(other, (other.p0 + other.p1) / 2)
    return projectOn(line, mid).offset - line.offset
  }
  const overlap = (line: RuledLine, other: RuledLine) => {
    const start = projectOn(line, linePoint(other, other.p0)).along
    const end = projectOn(line, linePoint(other, other.p1)).along
    return Math.min(line.p1, Math.max(start, end)) - Math.max(line.p0, Math.min(start, end))
  }
  const parallel = (line: RuledLine, other: RuledLine) => Math.abs(line.ux * other.ux + line.uy * other.uy) >= 0.99
  const core = new Set<RuledLine>()
  for (const line of long) {
    let left = 0
    let right = 0
    for (const other of long) {
      if (other === line || !parallel(line, other)) continue
      const gap = sideGap(line, other)
      const distM = Math.abs(gap) / ppm
      if (distM < 0.28 || distM > 2 || overlap(line, other) < 1.2 * ppm) continue
      if (gap > 0) right += 1
      else left += 1
    }
    if (left >= 2 && right >= 2) core.add(line)
  }
  const picked = new Set<InkSeg>()
  for (const line of long) {
    let near = core.has(line)
    if (!near) {
      for (const other of core) {
        if (!parallel(line, other)) continue
        const distM = Math.abs(sideGap(other, line)) / ppm
        if (distM < 0.22 || distM > 1.35 || overlap(other, line) < 1.2 * ppm) continue
        near = true
        break
      }
    }
    if (!near) continue
    for (const seg of line.segs) picked.add(seg)
  }
  return picked
}

function findBuildings(segments: InkSeg[], ppm: number, siteM2: number): Point[][] {
  const merged = mergeCollinear(segments.map((seg) => [seg.a, seg.b] as [Point, Point]), 0.8 * ppm, 1.2 * ppm)
  const nodes: Point[] = []
  const nodeId = (point: Point) => {
    const hit = nodes.findIndex((node) => dist(node, point) <= 1.1 * ppm)
    if (hit >= 0) return hit
    nodes.push(point)
    return nodes.length - 1
  }
  const edges: [number, number][] = []
  const edgeKey = new Set<string>()
  for (const [a, b] of merged) {
    if (dist(a, b) < 2.5 * ppm) continue
    const ia = nodeId(a)
    const ib = nodeId(b)
    if (ia === ib) continue
    const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`
    if (edgeKey.has(key)) continue
    edgeKey.add(key)
    edges.push([ia, ib])
  }
  const adj = new Map<number, number[]>()
  for (const [a, b] of edges) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const quads: Point[][] = []
  const seen = new Set<string>()
  for (const [a, b] of edges) {
    for (const c of adj.get(b) ?? []) {
      if (c === a) continue
      for (const d of adj.get(c) ?? []) {
        if (d === b || d === a) continue
        if (!(adj.get(d) ?? []).includes(a)) continue
        const ids = [a, b, c, d]
        const mark = [...ids].sort((p, q) => p - q).join('-')
        if (seen.has(mark)) continue
        seen.add(mark)
        if (!rightAngles(nodes, ids)) continue
        const ring = ids.map((id) => nodes[id])
        const area = polygonAreaPx(ring) / (ppm * ppm)
        if (area < 16 || area > 240 || area > siteM2 * 0.45) continue
        quads.push(ring)
      }
    }
  }
  return quads
}

function rightAngles(nodes: Point[], ids: number[]): boolean {
  for (let i = 0; i < 4; i++) {
    const prev = nodes[ids[(i + 3) % 4]]
    const cur = nodes[ids[i]]
    const next = nodes[ids[(i + 1) % 4]]
    const ux = prev.x - cur.x
    const uy = prev.y - cur.y
    const vx = next.x - cur.x
    const vy = next.y - cur.y
    const dot = ux * vx + uy * vy
    const lu = Math.hypot(ux, uy)
    const lv = Math.hypot(vx, vy)
    if (lu < 1 || lv < 1) return false
    const cos = dot / (lu * lv)
    if (Math.abs(cos) > 0.35) return false
  }
  return true
}

function mergeCollinear(segments: [Point, Point][], across: number, gap: number): [Point, Point][] {
  let items = segments.filter(([a, b]) => dist(a, b) > across)
  let changed = true
  let guard = 0
  while (changed && guard < 4000 && items.length > 1) {
    changed = false
    guard += 1
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const merged = mergePair(items[i], items[j], across, gap)
        if (!merged) continue
        items = items.filter((_, index) => index !== i && index !== j)
        items.push(merged)
        changed = true
        break outer
      }
    }
  }
  return items
}

function mergePair(a: [Point, Point], b: [Point, Point], across: number, gap: number): [Point, Point] | null {
  const ang = (seg: [Point, Point]) => Math.atan2(seg[1].y - seg[0].y, seg[1].x - seg[0].x)
  const delta = Math.abs(angleDiff(ang(a), ang(b)))
  if (delta > 0.2 && Math.abs(delta - Math.PI) > 0.2) return null
  const line = a
  if (pointSegmentDistance(b[0], line[0], line[1]) > across && distanceToInfinite(b[0], line) > across) return null
  if (distanceToInfinite(b[1], line) > across) return null
  const dir = unit(line[0], line[1])
  const proj = (point: Point) => point.x * dir.x + point.y * dir.y
  const spanA = [proj(a[0]), proj(a[1])].sort((p, q) => p - q)
  const spanB = [proj(b[0]), proj(b[1])].sort((p, q) => p - q)
  if (spanB[0] > spanA[1] + gap || spanA[0] > spanB[1] + gap) return null
  const points = [a[0], a[1], b[0], b[1]]
  let min = points[0]
  let max = points[0]
  let minP = proj(min)
  let maxP = minP
  for (const point of points) {
    const value = proj(point)
    if (value < minP) { minP = value; min = point }
    if (value > maxP) { maxP = value; max = point }
  }
  return [min, max]
}

function distanceToInfinite(point: Point, line: [Point, Point]): number {
  const dx = line[1].x - line[0].x
  const dy = line[1].y - line[0].y
  const len = Math.hypot(dx, dy)
  if (len === 0) return dist(point, line[0])
  return Math.abs((point.x - line[0].x) * dy - (point.y - line[0].y) * dx) / len
}

function unit(a: Point, b: Point): Point {
  const len = dist(a, b) || 1
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function joinRings(segments: InkSeg[], tol: number): Point[][] {
  const unused = segments.map((seg) => [seg.a, seg.b] as [Point, Point])
  const rings: Point[][] = []
  while (unused.length) {
    const [a, b] = unused.pop()!
    const chain = [a, b]
    let grew = true
    while (grew) {
      grew = false
      for (let i = unused.length - 1; i >= 0; i--) {
        const seg = unused[i]
        const head = chain[0]
        const tail = chain[chain.length - 1]
        if (dist(seg[0], tail) <= tol) { chain.push(seg[1]); unused.splice(i, 1); grew = true }
        else if (dist(seg[1], tail) <= tol) { chain.push(seg[0]); unused.splice(i, 1); grew = true }
        else if (dist(seg[0], head) <= tol) { chain.unshift(seg[1]); unused.splice(i, 1); grew = true }
        else if (dist(seg[1], head) <= tol) { chain.unshift(seg[0]); unused.splice(i, 1); grew = true }
      }
    }
    if (chain.length >= 4 && dist(chain[0], chain[chain.length - 1]) <= tol * 1.4) {
      const areaPx = polygonAreaPx(chain)
      if (areaPx > 0) rings.push(chain)
    }
  }
  return rings
}

function ringsInside(rings: Point[][], hull: Point[], siteM2: number, minM2: number, maxShare: number): Point[][] {
  const hullArea = polygonAreaPx(hull)
  if (hullArea <= 0) return []
  return rings.filter((ring) => {
    if (!pointInPolygon(centroid(ring), hull)) return false
    const areaM2 = (polygonAreaPx(ring) / hullArea) * siteM2
    return areaM2 >= minM2 && areaM2 <= siteM2 * maxShare
  })
}

function scaleRing(points: Point[], cellPx: number): Point[] {
  return points.map((point) => ({ x: point.x * cellPx, y: point.y * cellPx }))
}

function wetMask(point: Point, zones: { kind: ZoneKind; points: Point[]; holes?: Point[][] }[]): 'spray' | 'drip' | 'soft' | 'hard' | null {
  let spray = false
  let drip = false
  let soft = false
  let hard = false
  for (const zone of zones) {
    if (zone.points.length < 3 || !pointInZone(point, zone.points, zone.holes)) continue
    if (zone.kind === 'building' || zone.kind === 'water') hard = true
    else if (isObstacleKind(zone.kind)) soft = true
    else if (isDripKind(zone.kind)) drip = true
    else if (isSprayKind(zone.kind)) spray = true
  }
  if (hard) return 'hard'
  if (soft) return 'soft'
  if (drip) return 'drip'
  if (spray) return 'spray'
  return null
}

function snapHeadKey(point: Point, partSet: Set<number>, center: (key: number) => Point): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const key of partSet) {
    const distance = dist(center(key), point)
    if (distance < bestD) {
      bestD = distance
      best = key
    }
  }
  return best
}

function placeSprayHeads(opts: {
  part: number[]
  ppm: number
  cellPx: number
  cols: number
  origin: Point
  center: (key: number) => Point
  holes?: Point[][]
}): HeadSpot[] {
  const { part, ppm, cellPx, cols, origin, center, holes = [] } = opts
  if (part.length === 0) return []
  const partSet = new Set(part)
  const loops = maskLoops(part, cols)
    .map((loop) => loop.map((point) => ({ x: origin.x + point.x * cellPx, y: origin.y + point.y * cellPx })))
    .filter((loop) => loop.length >= 3)
  loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
  const outer = simplify(loops[0] ?? convexHull(part.map(center)), 0.8 * ppm)
  const inner = loops.slice(1)
    .map((loop) => simplify(loop, 0.8 * ppm))
    .filter((loop) => loop.length >= 3 && polygonAreaPx(loop) / (ppm * ppm) >= 2)
  const spots = placeSprayOnPolygon(outer, [...inner, ...holes], ppm)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const key of part) {
    const at = center(key)
    minX = Math.min(minX, at.x)
    minY = Math.min(minY, at.y)
    maxX = Math.max(maxX, at.x)
    maxY = Math.max(maxY, at.y)
  }
  const heads: HeadSpot[] = []
  for (const spot of spots) {
    const point = {
      x: Math.min(maxX, Math.max(minX, spot.point.x)),
      y: Math.min(maxY, Math.max(minY, spot.point.y)),
    }
    const key = snapHeadKey(point, partSet, center)
    if (key === null) continue
    heads.push({ key, point, nozzleId: spot.nozzleId, rotationDeg: spot.rotationDeg })
  }
  return heads
}

function zoneRing(keys: number[], cols: number, cellPx: number): Point[] {
  const loops = maskLoops(keys, cols).map((loop) => scaleRing(loop, cellPx))
  if (loops.length === 0) return []
  loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
  let outer = signedArea(loops[0]) < 0 ? [...loops[0]].reverse() : loops[0]
  for (const hole of loops.slice(1)) {
    if (Math.abs(signedArea(hole)) < Math.abs(signedArea(outer)) * 0.02) continue
    if (!pointInPolygon(centroid(hole), outer)) continue
    const oriented = signedArea(hole) > 0 ? [...hole].reverse() : hole
    outer = keyhole(outer, oriented)
  }
  return outer
}

function keyhole(outer: Point[], hole: Point[]): Point[] {
  let best = Infinity
  let bi = 0
  let bj = 0
  for (let i = 0; i < outer.length; i++) {
    for (let j = 0; j < hole.length; j++) {
      const distance = dist(outer[i], hole[j])
      if (distance < best) {
        best = distance
        bi = i
        bj = j
      }
    }
  }
  return [
    ...outer.slice(0, bi + 1),
    ...hole.slice(bj),
    ...hole.slice(0, bj + 1),
    outer[bi],
    ...outer.slice(bi + 1),
  ]
}

function maskLoops(keys: number[], cols: number): Point[][] {
  const set = new Set(keys)
  const edges: [number, number][] = []
  for (const key of keys) {
    const c = key % cols
    const r = Math.floor(key / cols)
    const sides: [number, number, number, number][] = [
      [c, r, c + 1, r],
      [c + 1, r, c + 1, r + 1],
      [c + 1, r + 1, c, r + 1],
      [c, r + 1, c, r],
    ]
    const nbr = [key - cols, key + 1, key + cols, key - 1]
    sides.forEach((side, index) => {
      const next = nbr[index]
      const nc = next % cols
      if (set.has(next) && Math.abs(nc - c) <= 1) return
      edges.push([side[0] + side[1] * (cols + 1), side[2] + side[3] * (cols + 1)])
    })
  }
  const from = new Map<number, number[]>()
  for (const [a, b] of edges) from.set(a, [...(from.get(a) ?? []), b])
  const used = new Set<string>()
  const loops: Point[][] = []
  for (const [a, b] of edges) {
    const startKey = `${a}-${b}`
    if (used.has(startKey)) continue
    const loop = [a]
    let cur = a
    let next = b
    let guard = 0
    while (guard < edges.length + 2) {
      guard += 1
      used.add(`${cur}-${next}`)
      loop.push(next)
      if (next === a) break
      const options = (from.get(next) ?? []).filter((to) => !used.has(`${next}-${to}`))
      if (options.length === 0) break
      cur = next
      next = options[0]
    }
    if (loop[0] !== loop[loop.length - 1] || loop.length < 4) continue
    loops.push(loop.slice(0, -1).map((corner) => cornerPoint(corner, cols)))
  }
  return loops
}

function cornerPoint(corner: number, cols: number): Point {
  const stride = cols + 1
  return { x: (corner % stride), y: Math.floor(corner / stride) }
}

function signedArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function simplify(points: Point[], tol: number): Point[] {
  if (points.length < 4) return points
  const keep = douglas(points, tol)
  return keep.length >= 3 ? keep.slice(0, 500) : points.slice(0, 500)
}

function douglas(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points
  let max = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const distance = pointSegmentDistance(points[i], points[0], points[end])
    if (distance > max) { max = distance; index = i }
  }
  if (max <= tol) return [points[0], points[end]]
  return [...douglas(points.slice(0, index + 1), tol).slice(0, -1), ...douglas(points.slice(index), tol)]
}

function nearestKey(point: Point, keys: Set<number>, at: (key: number) => Point, avoid: Point[] = [], minDist = 0): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const key of keys) {
    const atKey = at(key)
    if (minDist > 0 && avoid.some((item) => dist(atKey, item) <= minDist)) continue
    const distance = dist(atKey, point)
    if (distance < bestD) { bestD = distance; best = key }
  }
  return best
}

function boundaryCell(inside: number[], hull: Point[], cols: number, rows: number, at: (key: number) => Point, allowed: Set<number>, avoid: Point[] = []): number | null {
  const set = new Set(inside)
  let best: number | null = null
  let bestY = -Infinity
  for (const key of inside) {
    if (!allowed.has(key)) continue
    const c = key % cols
    const r = Math.floor(key / cols)
    const touch = [key - 1, key + 1, key - cols, key + cols].some((next) => {
      if (next < 0 || next >= cols * rows) return true
      if (Math.abs((next % cols) - c) > 1) return false
      return !set.has(next)
    })
    if (!touch) continue
    const point = at(key)
    if (avoid.some((item) => dist(point, item) <= SNAP_PX)) continue
    if (point.y > bestY) { bestY = point.y; best = key }
  }
  if (best !== null) return best
  return nearestKey(centroid(hull), allowed, at, avoid, SNAP_PX) ?? nearestKey(centroid(hull), allowed, at)
}

type Tree = Map<number, number | null>

function steiner(root: number, terminals: number[], allowed: Set<number>, cols: number, rows: number): Tree {
  const tree: Tree = new Map([[root, null]])
  const blocked = new Set(terminals)
  const left = new Set(terminals.filter((key) => key !== root && allowed.has(key)))
  while (left.size) {
    const { distMap, prev } = dijkstra(tree, allowed, cols, rows, blocked)
    let best: number | null = null
    let bestD = Infinity
    for (const key of left) {
      const distance = distMap.get(key)
      if (distance !== undefined && distance < bestD) { bestD = distance; best = key }
    }
    if (best === null || bestD === Infinity) break
    let cur: number | undefined = best
    while (cur !== undefined && !tree.has(cur)) {
      const parent = prev.get(cur)
      if (parent === undefined) break
      tree.set(cur, parent)
      cur = parent
    }
    left.delete(best)
  }
  return tree
}

function pathTo(prev: Map<number, number>, target: number, origin: number): number[] | null {
  const path = [target]
  const guard = new Set<number>()
  let cur = target
  while (cur !== origin) {
    const parent = prev.get(cur)
    if (parent === undefined || guard.has(cur)) return null
    guard.add(cur)
    cur = parent
    path.push(cur)
  }
  path.reverse()
  return path
}

function dijkstra(tree: Tree, allowed: Set<number>, cols: number, rows: number, blocked: Set<number>): { distMap: Map<number, number>; prev: Map<number, number> } {
  const distMap = new Map<number, number>()
  const prev = new Map<number, number>()
  const heap: { key: number; d: number }[] = []
  const push = (key: number, d: number) => {
    heap.push({ key, d })
    let i = heap.length - 1
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      if (heap[p].d <= heap[i].d) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (!last || !top) return null
    if (heap.length) {
      heap[0] = last
      let i = 0
      while (true) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l].d < heap[s].d) s = l
        if (r < heap.length && heap[r].d < heap[s].d) s = r
        if (s === i) break
        ;[heap[i], heap[s]] = [heap[s], heap[i]]
        i = s
      }
    }
    return top
  }
  for (const key of tree.keys()) {
    distMap.set(key, 0)
    push(key, 0)
  }
  const seen = new Set<number>()
  while (heap.length) {
    const item = pop()
    if (!item || seen.has(item.key)) continue
    seen.add(item.key)
    if (blocked.has(item.key)) continue
    const c = item.key % cols
    const nbr = [item.key - 1, item.key + 1, item.key - cols, item.key + cols]
    for (const next of nbr) {
      if (!allowed.has(next) || seen.has(next)) continue
      if (next < 0 || next >= cols * rows) continue
      if (Math.abs((next % cols) - c) > 1) continue
      const nd = item.d + 1
      if (nd < (distMap.get(next) ?? Infinity)) {
        distMap.set(next, nd)
        prev.set(next, item.key)
        push(next, nd)
      }
    }
  }
  return { distMap, prev }
}

function pipesFromTree(
  tree: Tree,
  at: (key: number) => Point,
  ids: (prefix: string) => string,
  clear: (a: Point, b: Point) => boolean,
  extraJoints: Set<number>,
  role: PipeRole,
): LaidPipe[] {
  const children = new Map<number, number[]>()
  for (const [key, parent] of tree) {
    if (parent === null) continue
    children.set(parent, [...(children.get(parent) ?? []), key])
  }
  const joints = new Set<number>()
  for (const [key, parent] of tree) {
    const degree = (parent === null ? 0 : 1) + (children.get(key)?.length ?? 0)
    if (degree !== 2 || parent === null || extraJoints.has(key)) joints.add(key)
  }
  const pipes: LaidPipe[] = []
  const seen = new Set<string>()
  for (const start of joints) {
    for (const next of children.get(start) ?? []) {
      const path = [start]
      let cur = next
      while (!joints.has(cur)) {
        path.push(cur)
        const step = (children.get(cur) ?? [])[0]
        if (step === undefined) break
        cur = step
      }
      path.push(cur)
      const mark = `${path[0]}-${path[path.length - 1]}`
      if (seen.has(mark)) continue
      seen.add(mark)
      const points = shorten(path.map(at), clear)
      if (points.length >= 2) pipes.push({ id: ids('pipe'), points, role })
    }
  }
  return pipes
}

function shorten(points: Point[], clear: (a: Point, b: Point) => boolean): Point[] {
  if (points.length < 3) return points
  const out = [points[0]]
  let i = 0
  while (i < points.length - 1) {
    let j = points.length - 1
    while (j > i + 1 && !clear(points[i], points[j])) j -= 1
    out.push(points[j])
    i = j
  }
  return out
}

function segmentClear(a: Point, b: Point, buildings: Point[][], cellPx: number): boolean {
  const steps = Math.max(1, Math.ceil(dist(a, b) / (cellPx * 0.5)))
  for (let s = 0; s <= steps; s++) {
    const point = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
    if (buildings.some((ring) => pointInPolygon(point, ring))) return false
  }
  return true
}

function sourceOutside(root: Point, mid: Point, cellPx: number, page: { width: number; height: number }): Point {
  const dx = root.x - mid.x
  const dy = root.y - mid.y
  const len = Math.hypot(dx, dy) || 1
  const point = { x: root.x + (dx / len) * cellPx * 1.5, y: root.y + (dy / len) * cellPx * 1.5 }
  return {
    x: Math.max(2, Math.min(page.width - 2, point.x)),
    y: Math.max(2, Math.min(page.height - 2, point.y)),
  }
}

function polylinePx(points: Point[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i])
  return sum
}

function plantGetsDrip(plant: Point, zones: Zone[]): boolean {
  let wet = false
  for (const zone of zones) {
    if (zone.points.length < 3 || !pointInZone(plant, zone.points, zone.holes)) continue
    if (isObstacleKind(zone.kind)) return false
    if (isWetKind(zone.kind)) wet = true
  }
  return wet
}

function dripFlow(drip: DripSpot, ppm: number): number {
  const lengthM = polylinePx(drip.points) / ppm
  const spacing = drip.spacingM > 0 ? drip.spacingM : 0.3
  return Math.max(1, Math.round(lengthM / spacing)) * drip.emitterLph
}
