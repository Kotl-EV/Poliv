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

export function pointInSpray(
  head: { x: number; y: number; radiusM: number; arcDeg: number; rotationDeg: number },
  point: Point,
  ppm: number,
): boolean {
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
