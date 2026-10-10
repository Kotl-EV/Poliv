import { centroid, closestOnSegment, dist, pointInPolygon, polygonAreaPx, strokeToPolygon, zoneAreaPx } from './geom.ts'
import type { Point } from './types.ts'

export type ClipOp = 'union' | 'intersect' | 'diff' | 'xor'
export type BrushTip = 'round' | 'square' | 'triangle'
export type Region = { points: Point[]; holes?: Point[][] }

const JOIN = 1e-3

function quant(n: number): number {
  return Math.round(n * 1e4) / 1e4
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

function contains(point: Point, region: Region): boolean {
  if (!pointInPolygon(point, region.points)) return false
  return !(region.holes ?? []).some((hole) => hole.length >= 3 && pointInPolygon(point, hole))
}

function inResult(op: ClipOp, point: Point, a: Region, b: Region): boolean {
  const inA = contains(point, a)
  const inB = contains(point, b)
  if (op === 'union') return inA || inB
  if (op === 'intersect') return inA && inB
  if (op === 'diff') return inA && !inB
  return inA !== inB
}

function segmentsOf(points: Point[]): { a: Point; b: Point }[] {
  const out: { a: Point; b: Point }[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (dist(a, b) > JOIN) out.push({ a, b })
  }
  return out
}

function crossParams(a: Point, b: Point, c: Point, d: Point): { t: number; u: number } | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return { t, u }
}

function paramOf(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return 0
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2
}

function offsetSample(a: Point, b: Point, side: 1 | -1, along = 0.5, gap = 0.35): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const px = a.x + dx * along
  const py = a.y + dy * along
  return { x: px + (-dy / len) * gap * side, y: py + (dx / len) * gap * side }
}

function sideInside(a: Point, b: Point, side: 1 | -1, op: ClipOp, subject: Region, clip: Region): boolean {
  for (const gap of [0.3, 0.7]) {
    const left = inResult(op, offsetSample(a, b, side, 0.5, gap), subject, clip)
    const right = inResult(op, offsetSample(a, b, side, 0.62, gap), subject, clip)
    if (left === right) return left
  }
  return inResult(op, offsetSample(a, b, side), subject, clip)
}

function cleanRing(points: Point[]): Point[] {
  const raw: Point[] = []
  for (const point of points) {
    const next = { x: quant(point.x), y: quant(point.y) }
    const last = raw[raw.length - 1]
    if (!last || dist(last, next) > JOIN) raw.push(next)
  }
  if (raw.length >= 2 && dist(raw[0], raw[raw.length - 1]) <= JOIN) raw.pop()
  const out: Point[] = []
  for (let i = 0; i < raw.length; i++) {
    const prev = raw[(i - 1 + raw.length) % raw.length]
    const cur = raw[i]
    const next = raw[(i + 1) % raw.length]
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
    if (Math.abs(cross) > 1e-3) out.push(cur)
  }
  return out.length >= 3 ? out : raw
}

function turn(incoming: Point, outgoing: Point): number {
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
  let angle = Math.atan2(cross, dot)
  if (angle < 0) angle += Math.PI * 2
  return angle
}

function stitch(directed: { a: Point; b: Point }[]): Point[][] {
  type Edge = { a: Point; b: Point; used: boolean }
  const edges: Edge[] = directed.map((edge) => ({ ...edge, used: false }))
  const from = new Map<string, number[]>()
  const key = (point: Point) => `${point.x},${point.y}`
  edges.forEach((edge, index) => {
    const list = from.get(key(edge.a)) ?? []
    list.push(index)
    from.set(key(edge.a), list)
  })
  const rings: Point[][] = []
  for (let start = 0; start < edges.length; start++) {
    if (edges[start].used) continue
    const ring: Point[] = [edges[start].a]
    let index = start
    edges[start].used = true
    let guard = edges.length + 2
    let closed = false
    while (guard-- > 0) {
      const current = edges[index]
      if (key(current.b) === key(edges[start].a) && ring.length >= 3) {
        closed = true
        break
      }
      const incoming = { x: current.b.x - current.a.x, y: current.b.y - current.a.y }
      const options = (from.get(key(current.b)) ?? []).filter((item) => !edges[item].used)
      if (options.length === 0) break
      let best = options[0]
      let bestTurn = Infinity
      for (const option of options) {
        const edge = edges[option]
        const outgoing = { x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y }
        const angle = turn(incoming, outgoing)
        if (angle < bestTurn) {
          bestTurn = angle
          best = option
        }
      }
      edges[best].used = true
      ring.push(edges[best].a)
      index = best
    }
    if (closed) rings.push(ring)
  }
  return rings
}

/** Булева операция двух областей. Контуры могут быть вогнутыми, отверстия сохраняются. */
export function clipRegions(op: ClipOp, subject: Region, clip: Region): Region[] {
  if (subject.points.length < 3 || clip.points.length < 3) return []
  const pool: Point[] = []
  const canon = (point: Point): Point => {
    const next = { x: quant(point.x), y: quant(point.y) }
    const found = pool.find((item) => dist(item, next) <= JOIN)
    if (found) return found
    pool.push(next)
    return next
  }
  const source = [
    ...segmentsOf(subject.points),
    ...(subject.holes ?? []).flatMap(segmentsOf),
    ...segmentsOf(clip.points),
    ...(clip.holes ?? []).flatMap(segmentsOf),
  ].map((segment) => ({ a: canon(segment.a), b: canon(segment.b) }))
    .filter((segment) => dist(segment.a, segment.b) > JOIN)

  const cuts: Point[] = []
  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      const hit = crossParams(source[i].a, source[i].b, source[j].a, source[j].b)
      if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6 || hit.u <= 1e-6 || hit.u >= 1 - 1e-6) continue
      cuts.push(canon({
        x: source[i].a.x + (source[i].b.x - source[i].a.x) * hit.t,
        y: source[i].a.y + (source[i].b.y - source[i].a.y) * hit.t,
      }))
    }
  }

  const pieces: { a: Point; b: Point }[] = []
  for (const segment of source) {
    const marks: { t: number; p: Point }[] = [
      { t: 0, p: segment.a },
      { t: 1, p: segment.b },
    ]
    const consider = (point: Point) => {
      const nearest = closestOnSegment(point, segment.a, segment.b)
      if (nearest.distance > JOIN || nearest.t <= 1e-5 || nearest.t >= 1 - 1e-5) return
      marks.push({ t: nearest.t, p: canon(point) })
    }
    for (const point of cuts) consider(point)
    for (const other of source) {
      consider(other.a)
      consider(other.b)
    }
    marks.sort((left, right) => left.t - right.t)
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].t - marks[i - 1].t < 1e-5) continue
      const a = marks[i - 1].p
      const b = marks[i].p
      if (dist(a, b) <= JOIN) continue
      pieces.push({ a, b })
    }
  }

  const seen = new Set<string>()
  const directed: { a: Point; b: Point }[] = []
  for (const piece of pieces) {
    const insideLeft = sideInside(piece.a, piece.b, 1, op, subject, clip)
    const insideRight = sideInside(piece.a, piece.b, -1, op, subject, clip)
    let a = piece.a
    let b = piece.b
    if (insideLeft && !insideRight) {
      // keep
    } else if (insideRight && !insideLeft) {
      a = piece.b
      b = piece.a
    } else {
      continue
    }
    const id = `${a.x},${a.y}|${b.x},${b.y}`
    if (seen.has(id)) continue
    seen.add(id)
    directed.push({ a, b })
  }

  const rings = stitch(directed).map(cleanRing).filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) >= 1)
  const positive = rings.filter((ring) => signedArea(ring) > 0)
  const negative = rings.filter((ring) => signedArea(ring) < 0)
  const outers = positive.filter((ring) => !positive.some((other) => (
    other !== ring && Math.abs(signedArea(other)) > Math.abs(signedArea(ring)) + 1 && pointInPolygon(centroid(ring), other)
  )))
  const regions: Region[] = outers.map((points) => ({ points, holes: [] }))
  for (const hole of negative) {
    const center = centroid(hole)
    const host = regions
      .filter((region) => pointInPolygon(center, region.points))
      .sort((left, right) => polygonAreaPx(left.points) - polygonAreaPx(right.points))[0]
    if (!host) continue
    const wound = signedArea(hole) < 0 ? [...hole].reverse() : hole
    host.holes = [...(host.holes ?? []), wound]
  }
  for (const ring of positive) {
    if (outers.includes(ring)) continue
    regions.push({ points: ring, holes: [] })
  }
  return regions
    .map((region) => ({
      points: region.points,
      holes: (region.holes ?? []).filter((hole) => polygonAreaPx(hole) >= 1),
    }))
    .filter((region) => zoneAreaPx(region.points, region.holes) >= 1)
    .map((region) => (region.holes && region.holes.length > 0 ? region : { points: region.points }))
}

function stamp(center: Point, radius: number, tip: BrushTip): Point[] {
  if (tip === 'triangle') {
    const height = radius * Math.sqrt(3)
    return [
      { x: center.x, y: center.y - (height * 2) / 3 },
      { x: center.x + radius, y: center.y + height / 3 },
      { x: center.x - radius, y: center.y + height / 3 },
    ]
  }
  return [
    { x: center.x - radius, y: center.y - radius },
    { x: center.x + radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius },
    { x: center.x - radius, y: center.y + radius },
  ]
}

function areaOf(region: Region): number {
  return zoneAreaPx(region.points, region.holes)
}

/** Кисть IRRISketch: круг, квадрат или треугольник вдоль штриха. */
export function brushOutline(points: Point[], radius: number, tip: BrushTip): Region | null {
  if (!(radius > 0) || points.length === 0) return null
  if (tip === 'round') {
    const ring = strokeToPolygon(points, radius)
    return ring.length >= 3 ? { points: ring } : null
  }
  const line: Point[] = []
  for (const point of points) {
    const last = line[line.length - 1]
    if (!last || dist(last, point) >= radius * 0.2) line.push(point)
  }
  if (line.length === 0) return null
  const stamps: Point[][] = [stamp(line[0], radius, tip)]
  const step = radius * 0.45
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const len = dist(a, b)
    for (let travel = step; travel < len; travel += step) {
      const t = travel / len
      stamps.push(stamp({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, radius, tip))
      if (stamps.length > 240) break
    }
    stamps.push(stamp(b, radius, tip))
    if (stamps.length > 240) break
  }
  let current: Region = { points: stamps[0] }
  for (let i = 1; i < stamps.length; i++) {
    const parts = clipRegions('union', current, { points: stamps[i] })
    if (parts.length === 0) continue
    current = parts.reduce((best, region) => (areaOf(region) > areaOf(best) ? region : best))
  }
  return current.points.length >= 3 ? current : null
}

/** Отражение точки через прямую a–b. */
export function mirrorAcross(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return { x: point.x, y: point.y }
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2
  const px = a.x + t * dx
  const py = a.y + t * dy
  return { x: 2 * px - point.x, y: 2 * py - point.y }
}

function halfPlane(a: Point, b: Point, side: 1 | -1, reach: number): Point[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = (-dy / len) * side
  const ny = (dx / len) * side
  const origin = { x: a.x - ux * reach, y: a.y - uy * reach }
  const far = { x: b.x + ux * reach, y: b.y + uy * reach }
  return [
    origin,
    far,
    { x: far.x + nx * reach, y: far.y + ny * reach },
    { x: origin.x + nx * reach, y: origin.y + ny * reach },
  ]
}

function reachOf(region: Region, a: Point, b: Point): number {
  let reach = dist(a, b)
  const points = [...region.points, ...(region.holes ?? []).flat()]
  for (const point of points) reach = Math.max(reach, dist(a, point), dist(b, point))
  return reach * 4 + 50
}

/** Режет область прямой a–b. null, если линия не даёт двух кусков. */
export function splitRegion(region: Region, a: Point, b: Point): Region[] | null {
  if (region.points.length < 3 || dist(a, b) < 1e-3) return null
  const reach = reachOf(region, a, b)
  const parts = [
    ...clipRegions('intersect', region, { points: halfPlane(a, b, 1, reach) }),
    ...clipRegions('intersect', region, { points: halfPlane(a, b, -1, reach) }),
  ].filter((part) => zoneAreaPx(part.points, part.holes) >= 1)
  return parts.length >= 2 ? parts : null
}
