import { nozzleById, type Nozzle } from './nozzles.ts'
import type { Point } from './types.ts'

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Hit-test in screen pixels: world distance × zoom. */
export function withinScreen(origin: Point, click: Point, k: number, screenPx: number): boolean {
  return dist(origin, click) * k <= screenPx
}

export function polygonAreaPx(points: Point[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function pointInPolygon(p: Point, points: Point[]): boolean {
  if (points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    const hit = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (hit) inside = !inside
  }
  return inside
}

/** Площадь контура за вычетом отверстий. */
export function zoneAreaPx(points: Point[], holes?: Point[][] | null): number {
  const holeArea = (holes ?? []).reduce((sum, hole) => sum + polygonAreaPx(hole), 0)
  return Math.max(0, polygonAreaPx(points) - holeArea)
}

/** Точка внутри контура и снаружи его отверстий. */
export function pointInZone(point: Point, points: Point[], holes?: Point[][] | null): boolean {
  if (!pointInPolygon(point, points)) return false
  return !(holes ?? []).some((hole) => hole.length >= 3 && pointInPolygon(point, hole))
}

export function zoneShapeD(points: Point[], bends?: (Point | null)[] | null, holes?: Point[][] | null): string {
  let d = zonePathD(points, bends, true)
  for (const hole of holes ?? []) d += zonePathD(hole, null, true)
  return d
}

export function boundsOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

export type AlignSide = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Сдвиг, после которого сторона moving совпадает со стороной target. Верх — меньший y. */
export function alignShift(
  moving: { minX: number; minY: number; maxX: number; maxY: number },
  target: { minX: number; minY: number; maxX: number; maxY: number },
  side: AlignSide,
): { dx: number; dy: number } {
  if (side === 'left') return { dx: target.minX - moving.minX, dy: 0 }
  if (side === 'right') return { dx: target.maxX - moving.maxX, dy: 0 }
  if (side === 'top') return { dx: 0, dy: target.minY - moving.minY }
  if (side === 'bottom') return { dx: 0, dy: target.maxY - moving.maxY }
  return {
    dx: (target.minX + target.maxX) / 2 - (moving.minX + moving.maxX) / 2,
    dy: (target.minY + target.maxY) / 2 - (moving.minY + moving.maxY) / 2,
  }
}

/** Растягивает точку так, чтобы габарит контура стал width × height. */
export function mapToSize(
  point: Point,
  box: { minX: number; minY: number; w: number; h: number },
  width: number,
  height: number,
): Point {
  const sx = box.w > 1e-9 ? width / box.w : 1
  const sy = box.h > 1e-9 ? height / box.h : 1
  return { x: box.minX + (point.x - box.minX) * sx, y: box.minY + (point.y - box.minY) * sy }
}

/** 0° смотрит вверх, угол растёт по часовой. */
export function polar(origin: Point, radius: number, bearingDeg: number): Point {
  const rad = (bearingDeg * Math.PI) / 180
  return {
    x: origin.x + radius * Math.sin(rad),
    y: origin.y - radius * Math.cos(rad),
  }
}

export function bearingDeg(from: Point, to: Point): number {
  return ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360
}

export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function snapDeg(deg: number, step: number): number {
  if (!(step > 0)) return normDeg(deg)
  return normDeg(Math.round(deg / step) * step)
}

export function clockwiseDeltaDeg(from: number, to: number): number {
  let d = normDeg(to) - normDeg(from)
  if (d <= 0) d += 360
  return d
}

export function sprinklerArcFromStart(rotationDeg: number, arcDeg: number, startDeg: number): { rotationDeg: number; arcDeg: number } {
  const end = rotationDeg + arcDeg / 2
  const arc = Math.min(360, Math.max(8, clockwiseDeltaDeg(startDeg, end)))
  return { rotationDeg: normDeg(startDeg + arc / 2), arcDeg: arc }
}

export function sprinklerArcFromEnd(rotationDeg: number, arcDeg: number, endDeg: number): { rotationDeg: number; arcDeg: number } {
  const start = rotationDeg - arcDeg / 2
  const arc = Math.min(360, Math.max(8, clockwiseDeltaDeg(start, endDeg)))
  return { rotationDeg: normDeg(start + arc / 2), arcDeg: arc }
}

export function aimSprinkler(
  origin: Point,
  rotationDeg: number,
  arcDeg: number,
  point: Point,
  mode: 'rot' | 'start' | 'end',
  step: number | null = null,
): { rotationDeg: number; arcDeg: number } {
  const bearing = step ? snapDeg(bearingDeg(origin, point), step) : bearingDeg(origin, point)
  if (mode === 'rot') return { rotationDeg: bearing, arcDeg }
  if (mode === 'start') return sprinklerArcFromStart(rotationDeg, arcDeg, bearing)
  return sprinklerArcFromEnd(rotationDeg, arcDeg, bearing)
}

/** Отражённый курс форсунки через прямую a–b. 0 — вверх, дальше по часовой. */
export function mirrorHeading(rotationDeg: number, a: Point, b: Point): number {
  const rad = (rotationDeg * Math.PI) / 180
  const vx = Math.sin(rad)
  const vy = -Math.cos(rad)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return normDeg(rotationDeg)
  const ux = dx / len
  const uy = dy / len
  const along = vx * ux + vy * uy
  return bearingDeg({ x: 0, y: 0 }, { x: 2 * along * ux - vx, y: 2 * along * uy - vy })
}

const MIRROR_NOZZLE: Record<string, string> = {
  'fan-lcs': 'fan-rcs',
  'fan-rcs': 'fan-lcs',
  'rot-lcs': 'rot-rcs',
  'rot-rcs': 'rot-lcs',
}

/** Угловая полоса меняется на парную. Остальные сопла остаются собой. */
export function mirrorNozzleId(id: string): string {
  return MIRROR_NOZZLE[id] ?? id
}

export function pointInSpray(
  head: { x: number; y: number; radiusM: number; arcDeg: number; rotationDeg: number; nozzleId?: string },
  point: Point,
  ppm: number,
): boolean {
  const strip = head.nozzleId ? stripOf(nozzleById(head.nozzleId)) : null
  if (strip) return pointInStrip(head, head.rotationDeg, head.radiusM * ppm, strip.widthPx(ppm), strip.side, point)
  const radius = head.radiusM * ppm
  if (!(radius > 0) || dist(head, point) > radius * 1.02) return false
  if (head.arcDeg >= 359) return false
  return Math.abs(normDeg(bearingDeg(head, point) - head.rotationDeg + 180) - 180) <= head.arcDeg / 2 + 3
}

export function pickSprinkler(
  heads: { id: string; x: number; y: number; radiusM: number; arcDeg: number; rotationDeg: number }[],
  point: Point,
  k: number,
  ppm: number,
  nodePx = 16,
): string | null {
  let bestId: string | null = null
  let bestD = nodePx
  for (const head of heads) {
    const d = dist(head, point) * k
    if (d <= bestD) {
      bestD = d
      bestId = head.id
    }
  }
  if (bestId) return bestId
  for (let i = heads.length - 1; i >= 0; i--) {
    if (pointInSpray(heads[i], point, ppm)) return heads[i].id
  }
  return null
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function subPoints(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scalePoint(point: Point, k: number): Point {
  return { x: point.x * k, y: point.y * k }
}

export function snapToGrid(point: Point, step: number): Point {
  if (!(step > 0)) return point
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  }
}

export function orthoFrom(origin: Point, point: Point): Point {
  if (Math.abs(point.x - origin.x) >= Math.abs(point.y - origin.y)) return { x: point.x, y: origin.y }
  return { x: origin.x, y: point.y }
}

export function nearestScreen(point: Point, targets: Point[], k: number, screenPx: number): Point | null {
  let best: Point | null = null
  let bestD = screenPx
  for (const target of targets) {
    const d = dist(point, target) * k
    if (d <= bestD) {
      best = target
      bestD = d
    }
  }
  return best
}

export function closestOnSegment(point: Point, a: Point, b: Point): { point: Point; t: number; distance: number } {
  const ab = subPoints(b, a)
  const len2 = ab.x * ab.x + ab.y * ab.y
  const t = len2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / len2))
  const hit = { x: a.x + ab.x * t, y: a.y + ab.y * t }
  return { point: hit, t, distance: dist(point, hit) }
}

/**
 * Сторона ряда, которая смотрит внутрь контура.
 * 1 — слева по ходу линии, -1 — справа. Проба берётся у первого заметного отрезка.
 */
export function sideInto(points: Point[], ring: Point[], holes?: Point[][] | null): 1 | -1 {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = dist(a, b)
    if (len < 1e-6) continue
    const step = Math.min(12, Math.max(2, len * 0.2))
    const leftX = (b.y - a.y) / len
    const leftY = -(b.x - a.x) / len
    const probe = { x: (a.x + b.x) / 2 + leftX * step, y: (a.y + b.y) / 2 + leftY * step }
    return pointInZone(probe, ring, holes) ? 1 : -1
  }
  return 1
}

export type ZoneSeat = { x: number; y: number; rotationDeg: number; arcDeg: number }

type SeatZone = {
  points: Point[]
  bends?: (Point | null)[] | null
  holes?: Point[][] | null
  /** Газон выигрывает у клумбы, если кромка одна и та же. */
  spray?: boolean
}

type SeatHit = {
  dist: number
  at: Point
  vertex: Point | null
  vertexRing: Point[] | null
  segmentA: Point
  segmentB: Point
  outline: Point[]
  holes?: Point[][] | null
  spray: boolean
}

function inwardUnit(a: Point, b: Point, outline: Point[], holes?: Point[][] | null): Point | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null
  const left = { x: dy / len, y: -dx / len }
  const step = Math.min(12, Math.max(2, len * 0.2))
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const probe = { x: mid.x + left.x * step, y: mid.y + left.y * step }
  return pointInZone(probe, outline, holes) ? left : { x: -left.x, y: -left.y }
}

function headingInto(origin: Point, dir: Point, outline: Point[], holes?: Point[][] | null): number {
  const len = Math.hypot(dir.x, dir.y) || 1
  const ux = dir.x / len
  const uy = dir.y / len
  for (const sign of [1, -1]) {
    for (const step of [8, 3]) {
      const probe = { x: origin.x + ux * step * sign, y: origin.y + uy * step * sign }
      if (pointInZone(probe, outline, holes)) return bearingDeg(origin, probe)
    }
  }
  return bearingDeg(origin, { x: origin.x + ux, y: origin.y + uy })
}

/** Внутренний угол у вершины, в градусах. Курс — уже выбранная биссектриса внутрь. */
function interiorArc(vertex: Point, ring: Point[], heading: number): number {
  const index = ring.findIndex((item) => dist(item, vertex) < 0.75)
  if (index < 0) return 180
  const prev = ring[(index - 1 + ring.length) % ring.length]
  const next = ring[(index + 1) % ring.length]
  if (dist(prev, vertex) < 1e-6 || dist(next, vertex) < 1e-6) return 180
  const wedge = clockwiseDeltaDeg(bearingDeg(vertex, prev), bearingDeg(vertex, next))
  const into = clockwiseDeltaDeg(bearingDeg(vertex, prev), heading)
  const span = into <= wedge + 0.5 ? wedge : 360 - wedge
  if (!(span > 0) || span > 360) return 180
  return span
}

function bisectorHeading(vertex: Point, ring: Point[], outline: Point[], holes?: Point[][] | null): number {
  const index = ring.findIndex((item) => dist(item, vertex) < 0.75)
  if (index < 0) return 0
  const prev = ring[(index - 1 + ring.length) % ring.length]
  const next = ring[(index + 1) % ring.length]
  const first = inwardUnit(prev, vertex, outline, holes)
  const second = inwardUnit(vertex, next, outline, holes)
  const dir = { x: (first?.x ?? 0) + (second?.x ?? 0), y: (first?.y ?? 0) + (second?.y ?? 0) }
  if (Math.hypot(dir.x, dir.y) < 1e-6) return headingInto(vertex, first ?? second ?? { x: 0, y: 1 }, outline, holes)
  return headingInto(vertex, dir, outline, holes)
}

function nearestCorner(at: Point, corners: Point[], cornerDist: number): Point | null {
  let best: Point | null = null
  let bestD = cornerDist
  for (const vertex of corners) {
    const d = dist(at, vertex)
    if (d <= bestD) {
      best = vertex
      bestD = d
    }
  }
  return best
}

function preferSeat(next: SeatHit, best: SeatHit | null, click: Point): boolean {
  if (!best) return true
  const gap = next.dist - best.dist
  if (gap > 1) return false
  if (gap < -1) return true
  if (next.spray !== best.spray) return next.spray
  if (gap < -0.5) return true
  if (Math.abs(gap) <= 0.5) {
    const nextIn = pointInZone(click, next.outline, next.holes)
    const bestIn = pointInZone(click, best.outline, best.holes)
    if (nextIn !== bestIn) return nextIn
  }
  return false
}

/**
 * Клик у кромки сажает головку на контур и поворачивает сектор внутрь.
 * У вершины берётся биссектриса внутреннего угла, у ребра — нормаль внутрь.
 * arcDeg — этот внутренний угол, на ребре 180.
 * Дальше maxDist возвращает null. cornerDist — насколько близко к вершине ещё угол.
 */
export function seatOnZone(point: Point, zones: SeatZone[], maxDist: number, cornerDist: number): ZoneSeat | null {
  if (!(maxDist > 0) || !(cornerDist >= 0)) return null
  let best: SeatHit | null = null
  for (const zone of zones) {
    if (zone.points.length < 3) continue
    const parts: { flat: Point[]; corners: Point[] }[] = []
    const outer = outlineOf(zone.points, zone.bends)
    if (outer.length >= 3) parts.push({ flat: outer, corners: zone.points })
    for (const hole of zone.holes ?? []) {
      const flat = outlineOf(hole)
      if (flat.length >= 3) parts.push({ flat, corners: hole })
    }
    for (const part of parts) {
      const closed = dist(part.flat[0], part.flat[part.flat.length - 1]) < 1e-6 ? part.flat : [...part.flat, part.flat[0]]
      const hit = nearestOnPolyline(point, closed)
      if (!hit || hit.distance > maxDist) continue
      const segmentA = closed[hit.index]
      const segmentB = closed[hit.index + 1]
      if (!segmentA || !segmentB) continue
      const vertex = nearestCorner(hit.point, part.corners, cornerDist)
      const next: SeatHit = {
        dist: hit.distance,
        at: vertex ?? hit.point,
        vertex,
        vertexRing: vertex ? part.corners : null,
        segmentA,
        segmentB,
        outline: zone.points,
        holes: zone.holes,
        spray: zone.spray === true,
      }
      if (preferSeat(next, best, point)) best = next
    }
  }
  if (!best) return null
  const rotationDeg = best.vertex && best.vertexRing
    ? bisectorHeading(best.vertex, best.vertexRing, best.outline, best.holes)
    : headingInto(best.at, inwardUnit(best.segmentA, best.segmentB, best.outline, best.holes) ?? { x: 0, y: 1 }, best.outline, best.holes)
  const arcDeg = best.vertex && best.vertexRing ? interiorArc(best.vertex, best.vertexRing, rotationDeg) : 180
  return { x: best.at.x, y: best.at.y, rotationDeg, arcDeg }
}

/**
 * Длина ребра index → следующая вершина становится lengthPx.
 * Первая вершина ребра стоит, вторая едет по тому же направлению. Дуга масштабируется от первой вершины.
 */
export function resizeEdge(
  points: Point[],
  bends: (Point | null)[] | null | undefined,
  index: number,
  lengthPx: number,
): { points: Point[]; bends: (Point | null)[] | null } | null {
  if (points.length < 2 || index < 0 || index >= points.length) return null
  if (!(lengthPx >= 0.05) || lengthPx > 1e7) return null
  const next = (index + 1) % points.length
  const a = points[index]
  const b = points[next]
  if (!a || !b) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const moved = { x: a.x + (dx / len) * lengthPx, y: a.y + (dy / len) * lengthPx }
  const out = points.map((point, i) => (i === next ? moved : { x: point.x, y: point.y }))
  if (!bends?.some(Boolean)) return { points: out, bends: null }
  const scale = lengthPx / len
  const copy = points.map((_, i) => {
    const bend = bends[i]
    if (!bend || i !== index) return bend ? { x: bend.x, y: bend.y } : null
    return { x: a.x + (bend.x - a.x) * scale, y: a.y + (bend.y - a.y) * scale }
  })
  return { points: out, bends: copy }
}

/**
 * Скругление вершины. Прямые обрываются на радиусе, между касательными — дуга.
 * Управляющая точка дуги — бывший угол, так что обе стороны остаются касательными.
 */
export function filletVertex(
  points: Point[],
  bends: (Point | null)[] | null | undefined,
  index: number,
  radiusPx: number,
): { points: Point[]; bends: (Point | null)[] } | null {
  if (points.length < 3 || points.length >= 500 || index < 0 || index >= points.length) return null
  if (!(radiusPx >= 0.05) || radiusPx > 1e7) return null
  const count = points.length
  const prev = points[(index - 1 + count) % count]
  const corner = points[index]
  const next = points[(index + 1) % count]
  if (!prev || !corner || !next) return null
  const lenIn = Math.hypot(prev.x - corner.x, prev.y - corner.y)
  const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y)
  if (lenIn < 1e-6 || lenOut < 1e-6) return null
  const u = { x: (prev.x - corner.x) / lenIn, y: (prev.y - corner.y) / lenIn }
  const v = { x: (next.x - corner.x) / lenOut, y: (next.y - corner.y) / lenOut }
  const dot = Math.min(1, Math.max(-1, u.x * v.x + u.y * v.y))
  const theta = Math.acos(dot)
  if (theta < 0.05 || theta > Math.PI - 0.05) return null
  const tanHalf = Math.tan(theta / 2)
  if (!(tanHalf > 1e-6)) return null
  const offset = radiusPx / tanHalf
  if (offset >= lenIn - 0.05 || offset >= lenOut - 0.05) return null
  const start = { x: corner.x + u.x * offset, y: corner.y + u.y * offset }
  const end = { x: corner.x + v.x * offset, y: corner.y + v.y * offset }
  const out = points.map((point) => ({ x: point.x, y: point.y }))
  out.splice(index, 1, start, end)
  const src = bends && bends.length === count ? bends : points.map(() => null)
  const copy = src.map((bend) => (bend ? { x: bend.x, y: bend.y } : null))
  copy.splice(index, 0, { x: corner.x, y: corner.y })
  return { points: out, bends: copy }
}

/** Ближайшая точка на ломаной. */
export function nearestOnPolyline(point: Point, points: Point[]): { point: Point; distance: number; index: number } | null {
  if (points.length < 2) return null
  let best: { point: Point; distance: number; index: number } | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const hit = closestOnSegment(point, points[i], points[i + 1])
    if (!best || hit.distance < best.distance) best = { point: hit.point, distance: hit.distance, index: i }
  }
  return best
}

/** 1 — курсор слева по ходу, -1 — справа, 0 — курсор слишком близко к линии. */
export function sideOfPoint(points: Point[], cursor: Point, minDist = 8): 1 | -1 | 0 {
  const hit = nearestOnPolyline(cursor, points)
  if (!hit || hit.distance < minDist) return 0
  const a = points[hit.index]
  const b = points[hit.index + 1]
  if (!a || !b) return 0
  const dot = (cursor.x - a.x) * (b.y - a.y) - (cursor.y - a.y) * (b.x - a.x)
  if (Math.abs(dot) < 1e-6) return 0
  return dot > 0 ? 1 : -1
}

/**
 * Головки вдоль ломаной. Сторона 1 — слева по ходу (вверх, если линия идёт вправо).
 * Шаг включает оба конца. Одна головка встаёт посередине, если округление даёт 1.
 */
export function headsAlong(
  points: Point[],
  spacingPx: number,
  side: 1 | -1,
): { x: number; y: number; rotationDeg: number }[] {
  if (points.length < 2 || !(spacingPx > 0)) return []
  const spans: { a: Point; b: Point; len: number }[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const len = dist(points[i - 1], points[i])
    if (len < 1e-6) continue
    spans.push({ a: points[i - 1], b: points[i], len })
    total += len
  }
  if (!(total > 0)) return []
  const count = Math.max(1, Math.round(total / spacingPx))
  const out: { x: number; y: number; rotationDeg: number }[] = []
  for (let i = 0; i < count; i++) {
    const at = count === 1 ? total / 2 : (i / (count - 1)) * total
    let walked = 0
    for (const span of spans) {
      if (walked + span.len + 1e-6 < at) {
        walked += span.len
        continue
      }
      const t = Math.max(0, Math.min(1, (at - walked) / span.len))
      const x = span.a.x + (span.b.x - span.a.x) * t
      const y = span.a.y + (span.b.y - span.a.y) * t
      const dx = span.b.x - span.a.x
      const dy = span.b.y - span.a.y
      const len = Math.hypot(dx, dy) || 1
      const nx = side === 1 ? dy / len : -dy / len
      const ny = side === 1 ? -dx / len : dx / len
      out.push({ x, y, rotationDeg: bearingDeg({ x, y }, { x: x + nx, y: y + ny }) })
      break
    }
  }
  return out
}

/** Quadratic control from a point on the curve at t = 0.5. */
export function controlFromHandle(a: Point, b: Point, handle: Point): Point {
  return { x: 2 * handle.x - (a.x + b.x) / 2, y: 2 * handle.y - (a.y + b.y) / 2 }
}

export function handleFromControl(a: Point, b: Point, control: Point): Point {
  return { x: 0.25 * a.x + 0.5 * control.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * control.y + 0.25 * b.y }
}

export function quadPoint(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  }
}

export function sampleQuad(a: Point, control: Point, b: Point, steps = 8): Point[] {
  const out: Point[] = []
  for (let i = 1; i <= steps; i++) out.push(quadPoint(a, control, b, i / steps))
  return out
}

export function outlineOf(points: Point[], bends?: (Point | null)[] | null, steps = 8): Point[] {
  if (points.length === 0) return []
  const out: Point[] = [points[0]]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const bend = bends?.[i]
    if (bend) out.push(...sampleQuad(a, bend, b, steps))
    else if (i < points.length - 1 || points.length >= 3) out.push(b)
  }
  if (points.length >= 3) {
    const last = out[out.length - 1]
    if (last && dist(last, points[0]) < 1e-6) out.pop()
  }
  return out
}

/** Дуги становятся ломаной. null — даже грубый шаг не влезает в max точек. */
export function flattenRing(points: Point[], bends?: (Point | null)[] | null, max = 480): Point[] | null {
  if (!bends?.some(Boolean)) return points.slice()
  for (const steps of [8, 4, 2, 1]) {
    const ring = outlineOf(points, bends, steps)
    if (ring.length >= 3 && ring.length <= max) return ring
  }
  return null
}

export function polylineLength(points: Point[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i])
  return sum
}

export function ringLength(points: Point[], bends?: (Point | null)[] | null): number {
  if (points.length < 2) return 0
  const outline = outlineOf(points, bends)
  if (points.length < 3) return polylineLength(outline)
  return polylineLength(outline) + dist(outline[outline.length - 1], outline[0])
}

export function zonePathD(points: Point[], bends?: (Point | null)[] | null, close = true): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  const last = close ? points.length : Math.max(0, points.length - 1)
  for (let i = 0; i < last; i++) {
    const b = points[(i + 1) % points.length]
    const bend = bends?.[i]
    d += bend ? ` Q ${bend.x} ${bend.y} ${b.x} ${b.y}` : ` L ${b.x} ${b.y}`
  }
  if (close && points.length >= 3) d += ' Z'
  return d
}

export function rotateAround(point: Point, origin: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const x = point.x - origin.x
  const y = point.y - origin.y
  return { x: origin.x + x * c - y * s, y: origin.y + x * s + y * c }
}

export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

export function scaleAround(point: Point, origin: Point, k: number): Point {
  return {
    x: origin.x + (point.x - origin.x) * k,
    y: origin.y + (point.y - origin.y) * k,
  }
}

export function mirrorAround(point: Point, origin: Point, axis: 'x' | 'y'): Point {
  if (axis === 'x') return { x: 2 * origin.x - point.x, y: point.y }
  return { x: point.x, y: 2 * origin.y - point.y }
}

export function rectPoints(a: Point, b: Point, square = false): Point[] {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx === 0 ? 1 : Math.sign(dx)) * s
    dy = (dy === 0 ? 1 : Math.sign(dy)) * s
  }
  return [
    { x: a.x, y: a.y },
    { x: a.x + dx, y: a.y },
    { x: a.x + dx, y: a.y + dy },
    { x: a.x, y: a.y + dy },
  ]
}

export function circlePoints(center: Point, edge: Point, count = 24): Point[] {
  const r = dist(center, edge)
  if (!(r > 0) || count < 3) return []
  const n = Math.max(8, count)
  const out: Point[] = []
  for (let i = 0; i < n; i++) out.push(polar(center, r, (i / n) * 360))
  return out
}

function unit(vector: Point): Point {
  const len = Math.hypot(vector.x, vector.y)
  if (len < 1e-9) return { x: 0, y: 0 }
  return { x: vector.x / len, y: vector.y / len }
}

function sideNormal(vector: Point): Point {
  const u = unit(vector)
  return { x: -u.y, y: u.x }
}

/** Outline of a thick freehand stroke — brush path becomes a polygon. */
export function strokeToPolygon(points: Point[], radius: number): Point[] {
  if (!(radius > 0)) return []
  const line: Point[] = []
  for (const point of points) {
    const last = line[line.length - 1]
    if (!last || dist(last, point) > radius * 0.12) line.push(point)
  }
  if (line.length === 0) return []
  if (line.length === 1) return circlePoints(line[0], { x: line[0].x + radius, y: line[0].y }, 20)

  function offsetAt(index: number, side: 1 | -1): Point {
    const cur = line[index]
    const prev = line[index - 1]
    const next = line[index + 1]
    const a = prev ? subPoints(cur, prev) : subPoints(next, cur)
    const b = next ? subPoints(next, cur) : subPoints(cur, prev)
    const n1 = sideNormal(a)
    const n2 = sideNormal(b)
    let nx = n1.x + n2.x
    let ny = n1.y + n2.y
    const len = Math.hypot(nx, ny)
    if (len < 0.25) {
      nx = n1.x
      ny = n1.y
    } else {
      nx /= len
      ny /= len
    }
    const miter = Math.min(3, 1 / Math.max(0.35, Math.abs(n1.x * nx + n1.y * ny)))
    return { x: cur.x + nx * radius * miter * side, y: cur.y + ny * radius * miter * side }
  }

  function cap(origin: Point, forward: Point): Point[] {
    const u = unit(forward)
    const out: Point[] = []
    for (let i = 1; i <= 7; i++) {
      const t = (i / 8) * Math.PI
      out.push({
        x: origin.x + (-u.y * Math.cos(t) + u.x * Math.sin(t)) * radius,
        y: origin.y + (u.x * Math.cos(t) + u.y * Math.sin(t)) * radius,
      })
    }
    return out
  }

  const left = line.map((_, index) => offsetAt(index, 1))
  const right = line.map((_, index) => offsetAt(index, -1))
  const end = line[line.length - 1]
  const start = line[0]
  return [
    ...left,
    ...cap(end, subPoints(end, line[line.length - 2])),
    ...right.slice().reverse(),
    ...cap(start, subPoints(start, line[1])),
  ]
}

function signedRingArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function lineHit(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  return { x: a.x + t * rx, y: a.y + t * ry }
}

function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return false
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4
}

function ringCrosses(points: Point[]): boolean {
  const n = points.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = Math.min(Math.abs(i - j), n - Math.abs(i - j))
      if (gap <= 1) continue
      if (properCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true
    }
  }
  return false
}

/**
 * Смещение замкнутого контура. Положительный delta раздувает фигуру наружу.
 * null — смещение сломало контур или съело его целиком.
 */
export function offsetRing(points: Point[], delta: number): Point[] | null {
  if (points.length < 3 || !Number.isFinite(delta)) return null
  if (Math.abs(delta) < 1e-9) return points.map((point) => ({ ...point }))
  const ring = signedRingArea(points) < 0 ? [...points].reverse() : [...points]
  const lines: { a: Point; b: Point }[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const nx = (dy / len) * delta
    const ny = (-dx / len) * delta
    lines.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } })
  }
  if (lines.length < 3) return null
  const out: Point[] = []
  const limit = Math.max(4 * Math.abs(delta), 1e-6)
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length]
    const cur = lines[i]
    const hit = lineHit(prev.a, prev.b, cur.a, cur.b)
    const origin = ring[i % ring.length]
    if (!hit || dist(hit, origin) > limit) {
      out.push(prev.b, cur.a)
      continue
    }
    out.push(hit)
  }
  const cleaned: Point[] = []
  for (const point of out) {
    const last = cleaned[cleaned.length - 1]
    if (!last || dist(last, point) > 0.05) cleaned.push(point)
  }
  if (cleaned.length >= 2 && dist(cleaned[0], cleaned[cleaned.length - 1]) <= 0.05) cleaned.pop()
  if (cleaned.length < 3) return null
  if (signedRingArea(cleaned) <= 1) return null
  if (ringCrosses(cleaned)) return null
  if (offsetCollapsed(ring, cleaned, delta)) return null
  return cleaned
}

/** Смещение, которое вывернуло или съело фигуру, не оставляя внутренней полосы. */
function offsetCollapsed(original: Point[], result: Point[], delta: number): boolean {
  const gap = Math.abs(delta)
  let checks = 0
  let hits = 0
  for (let i = 0; i < original.length; i++) {
    const a = original[i]
    const b = original[(i + 1) % original.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const inward = delta < 0 ? gap * 1.25 : gap * 0.45
    const side = delta < 0 ? 1 : -1
    const point = {
      x: (a.x + b.x) / 2 + (-dy / len) * inward * side,
      y: (a.y + b.y) / 2 + (dx / len) * inward * side,
    }
    if (delta < 0 && !pointInPolygon(point, original)) continue
    checks += 1
    if (pointInPolygon(point, result)) hits += 1
  }
  if (checks === 0) return true
  return hits === 0
}

type StripSide = 'center' | 'left' | 'right'

function stripOf(nozzle: Nozzle): { side: StripSide; widthPx: (ppm: number) => number } | null {
  if (nozzle.pattern !== 'strip' || !nozzle.widthM || !nozzle.strip) return null
  const side: StripSide = nozzle.strip === 'left' ? 'left' : nozzle.strip === 'right' ? 'right' : 'center'
  return { side, widthPx: (ppm) => nozzle.widthM! * ppm }
}

export function coverPath(
  head: { x: number; y: number; rotationDeg: number; radiusM: number; arcDeg: number },
  ppm: number,
  nozzle: Nozzle,
): string {
  const strip = stripOf(nozzle)
  if (strip) return stripPath(head, head.rotationDeg, head.radiusM * ppm, strip.widthPx(ppm), strip.side)
  return sectorPath(head, head.radiusM * ppm, head.rotationDeg, head.arcDeg)
}

export function pointInStrip(
  origin: Point,
  rotationDeg: number,
  forwardPx: number,
  widthPx: number,
  side: StripSide,
  point: Point,
): boolean {
  const local = stripLocal(origin, rotationDeg, point)
  if (local.along < -forwardPx * 0.02 || local.along > forwardPx * 1.02) return false
  if (side === 'left') return local.across <= widthPx * 0.02 && local.across >= -widthPx * 1.02
  if (side === 'right') return local.across >= -widthPx * 0.02 && local.across <= widthPx * 1.02
  const half = widthPx / 2
  return local.across >= -half * 1.02 && local.across <= half * 1.02
}

export function stripHandlePoint(
  origin: Point,
  rotationDeg: number,
  forwardPx: number,
  widthPx: number,
  side: StripSide,
): Point {
  const across = side === 'left' ? -widthPx / 2 : side === 'right' ? widthPx / 2 : 0
  return stripWorld(origin, rotationDeg, across, forwardPx)
}

function stripPath(origin: Point, rotationDeg: number, forwardPx: number, widthPx: number, side: StripSide): string {
  const across0 = side === 'left' ? -widthPx : side === 'right' ? 0 : -widthPx / 2
  const across1 = side === 'left' ? 0 : side === 'right' ? widthPx : widthPx / 2
  const corners = [
    stripWorld(origin, rotationDeg, across0, 0),
    stripWorld(origin, rotationDeg, across1, 0),
    stripWorld(origin, rotationDeg, across1, forwardPx),
    stripWorld(origin, rotationDeg, across0, forwardPx),
  ]
  return `M ${corners[0].x} ${corners[0].y} L ${corners[1].x} ${corners[1].y} L ${corners[2].x} ${corners[2].y} L ${corners[3].x} ${corners[3].y} Z`
}

function stripLocal(origin: Point, rotationDeg: number, point: Point): { across: number; along: number } {
  const aim = (rotationDeg * Math.PI) / 180
  const fx = Math.sin(aim)
  const fy = -Math.cos(aim)
  const rx = Math.cos(aim)
  const ry = Math.sin(aim)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return { across: dx * rx + dy * ry, along: dx * fx + dy * fy }
}

function stripWorld(origin: Point, rotationDeg: number, across: number, along: number): Point {
  const aim = (rotationDeg * Math.PI) / 180
  const fx = Math.sin(aim)
  const fy = -Math.cos(aim)
  const rx = Math.cos(aim)
  const ry = Math.sin(aim)
  return { x: origin.x + rx * across + fx * along, y: origin.y + ry * across + fy * along }
}

export type NoteLeader = {
  shaft: [Point, Point]
  head: [Point, Point, Point]
}

/** Стрелка от подписи к острию. Слишком короткая не рисуется. */
export function noteLeader(from: Point, tip: Point, k: number): NoteLeader | null {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy)
  const head = 11 / Math.max(k, 0.05)
  if (!(len > head + 1)) return null
  const ux = dx / len
  const uy = dy / len
  const base = { x: tip.x - ux * head, y: tip.y - uy * head }
  const wing = 4.5 / Math.max(k, 0.05)
  return {
    shaft: [from, base],
    head: [
      tip,
      { x: base.x - uy * wing, y: base.y + ux * wing },
      { x: base.x + uy * wing, y: base.y - ux * wing },
    ],
  }
}

export function sectorPath(origin: Point, radius: number, rotationDeg: number, arcDeg: number): string {
  if (radius <= 0) return ''
  if (arcDeg >= 359.9) {
    return `M ${origin.x - radius} ${origin.y} a ${radius} ${radius} 0 1 1 ${radius * 2} 0 a ${radius} ${radius} 0 1 1 ${-radius * 2} 0`
  }
  const start = rotationDeg - arcDeg / 2
  const end = rotationDeg + arcDeg / 2
  const a = polar(origin, radius, start)
  const b = polar(origin, radius, end)
  const large = arcDeg > 180 ? 1 : 0
  return `M ${origin.x} ${origin.y} L ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y} Z`
}
