import { boundsOf, centroid, circlePoints, closestOnSegment, dist, pointInPolygon, pointInZone, polygonAreaPx, strokeToPolygon, zoneAreaPx } from './geom.ts'
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

function tipReach(tip: BrushTip, radius: number): number {
  return tip === 'triangle' ? radius * 1.25 : radius
}

function coversTip(tip: BrushTip, center: Point, radius: number, x: number, y: number): boolean {
  if (tip === 'square') return Math.abs(x - center.x) <= radius && Math.abs(y - center.y) <= radius
  if (tip === 'round') return (x - center.x) ** 2 + (y - center.y) ** 2 <= radius * radius
  return pointInPolygon({ x, y }, stamp(center, radius, 'triangle'))
}

function clockwiseTurn(inX: number, inY: number, outX: number, outY: number): number {
  const cross = inX * outY - inY * outX
  const dot = inX * outX + inY * outY
  let angle = Math.atan2(cross, dot)
  if (angle < 0) angle += Math.PI * 2
  return angle
}

function distToSeg(point: Point, a: Point, b: Point): number {
  return closestOnSegment(point, a, b).distance
}

function rdpOpen(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }))
  let max = 0
  let index = 0
  const a = points[0]
  const b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const gap = distToSeg(points[i], a, b)
    if (gap > max) {
      max = gap
      index = i
    }
  }
  if (max <= tol) return [{ ...a }, { ...b }]
  const left = rdpOpen(points.slice(0, index + 1), tol)
  const right = rdpOpen(points.slice(index), tol)
  return [...left.slice(0, -1), ...right]
}

function rdpClosed(points: Point[], tol: number): Point[] {
  if (points.length < 8) return points
  let far = 1
  let best = -1
  for (let i = 1; i < points.length; i++) {
    const gap = dist(points[0], points[i])
    if (gap > best) {
      best = gap
      far = i
    }
  }
  if (far <= 1 || far >= points.length - 1) return points
  const one = rdpOpen(points.slice(0, far + 1), tol)
  const two = rdpOpen([...points.slice(far), points[0]], tol)
  const ring = [...one.slice(0, -1), ...two.slice(0, -1)]
  return ring.length >= 3 ? ring : points
}

function simplifyRing(points: Point[], tol: number): Point[] {
  let ring = points
  let limit = tol
  for (let pass = 0; pass < 5; pass++) {
    if (ring.length < 8) break
    if (pass > 0 && ring.length <= 240) break
    const next = rdpClosed(ring, limit)
    if (next.length >= ring.length) break
    ring = next
    limit *= 1.7
  }
  return ring
}

function traceMask(mask: Uint8Array, cols: number, rows: number, minX: number, minY: number, cell: number): Region[] {
  type Seg = { ax: number; ay: number; bx: number; by: number; used: boolean }
  const segs: Seg[] = []
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 1
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!filled(i, j)) continue
      if (!filled(i, j - 1)) segs.push({ ax: i, ay: j, bx: i + 1, by: j, used: false })
      if (!filled(i + 1, j)) segs.push({ ax: i + 1, ay: j, bx: i + 1, by: j + 1, used: false })
      if (!filled(i, j + 1)) segs.push({ ax: i + 1, ay: j + 1, bx: i, by: j + 1, used: false })
      if (!filled(i - 1, j)) segs.push({ ax: i, ay: j + 1, bx: i, by: j, used: false })
    }
  }
  const from = new Map<string, number[]>()
  const key = (x: number, y: number) => `${x},${y}`
  segs.forEach((seg, index) => {
    const list = from.get(key(seg.ax, seg.ay)) ?? []
    list.push(index)
    from.set(key(seg.ax, seg.ay), list)
  })
  const world = (ix: number, iy: number): Point => ({ x: minX + ix * cell, y: minY + iy * cell })
  const raw: Point[][] = []
  for (let start = 0; start < segs.length; start++) {
    if (segs[start].used) continue
    const ring: Point[] = []
    let index = start
    let guard = segs.length + 2
    let closed = false
    while (guard-- > 0) {
      const current = segs[index]
      current.used = true
      ring.push(world(current.ax, current.ay))
      if (current.bx === segs[start].ax && current.by === segs[start].ay && ring.length >= 3) {
        closed = true
        break
      }
      const options = (from.get(key(current.bx, current.by)) ?? []).filter((item) => !segs[item].used)
      if (options.length === 0) break
      const inX = current.bx - current.ax
      const inY = current.by - current.ay
      let best = options[0]
      let bestTurn = Infinity
      for (const option of options) {
        const edge = segs[option]
        const angle = clockwiseTurn(inX, inY, edge.bx - edge.ax, edge.by - edge.ay)
        if (angle < bestTurn) {
          bestTurn = angle
          best = option
        }
      }
      index = best
    }
    if (closed) raw.push(ring)
  }
  const minArea = Math.max(1, cell * cell * 1.5)
  const cleaned = raw
    .map((ring) => {
      const rawArea = Math.abs(signedArea(ring))
      let simple = simplifyRing(ring, cell * 0.7)
      if (Math.abs(signedArea(simple)) < rawArea * 0.75) simple = simplifyRing(ring, cell * 0.25)
      return cleanRing(simple)
    })
    .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) >= minArea)
  const positive = cleaned.filter((ring) => signedArea(ring) > 0)
  const negative = cleaned.filter((ring) => signedArea(ring) < 0)
  const outers = positive.filter((ring) => !positive.some((other) => (
    other !== ring && Math.abs(signedArea(other)) > Math.abs(signedArea(ring)) + 1 && pointInPolygon(centroid(ring), other)
  )))
  const regions: Region[] = outers.map((points) => ({ points, holes: [] as Point[][] }))
  for (const hole of negative) {
    const center = centroid(hole)
    const host = regions
      .filter((region) => pointInZone(center, region.points, region.holes))
      .sort((left, right) => polygonAreaPx(left.points) - polygonAreaPx(right.points))[0]
    if (!host) continue
    host.holes = [...(host.holes ?? []), hole]
  }
  for (const ring of positive) {
    if (outers.includes(ring)) continue
    regions.push({ points: ring })
  }
  return regions
    .map((region) => ({
      points: region.points,
      holes: (region.holes ?? []).filter((hole) => polygonAreaPx(hole) >= minArea),
    }))
    .filter((region) => zoneAreaPx(region.points, region.holes) >= minArea)
    .map((region) => (region.holes && region.holes.length > 0 ? region : { points: region.points }))
}

/** Закрашенный штрих: один или несколько залитых контуров, без самопересечения ленты. */
export function brushParts(points: Point[], radius: number, tip: BrushTip): Region[] {
  if (!(radius > 0) || points.length === 0) return []
  const line: Point[] = []
  for (const point of points) {
    const last = line[line.length - 1]
    if (!last || dist(last, point) >= Math.max(0.4, radius * 0.08)) line.push(point)
  }
  if (line.length === 0) return []
  if (line.length === 1) {
    if (tip === 'round') {
      const ring = circlePoints(line[0], { x: line[0].x + radius, y: line[0].y }, 24)
      return ring.length >= 3 ? [{ points: ring }] : []
    }
    return [{ points: stamp(line[0], radius, tip) }]
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of line) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const reach = tipReach(tip, radius)
  minX -= reach
  minY -= reach
  maxX += reach
  maxY += reach
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  let cell = Math.max(radius / 8, 0.35)
  const maxCells = 640
  if (spanX / cell > maxCells) cell = spanX / maxCells
  if (spanY / cell > maxCells) cell = spanY / maxCells
  const cols = Math.max(1, Math.ceil(spanX / cell))
  const rows = Math.max(1, Math.ceil(spanY / cell))
  const mask = new Uint8Array(cols * rows)
  const samples: Point[] = []
  const step = Math.max(cell * 0.75, radius * 0.22)
  for (let i = 0; i < line.length; i++) {
    samples.push(line[i])
    if (i === 0) continue
    const a = line[i - 1]
    const b = line[i]
    const len = dist(a, b)
    for (let travel = step; travel < len; travel += step) {
      const t = travel / len
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  for (const sample of samples) {
    const i0 = Math.max(0, Math.floor((sample.x - reach - minX) / cell))
    const i1 = Math.min(cols - 1, Math.ceil((sample.x + reach - minX) / cell))
    const j0 = Math.max(0, Math.floor((sample.y - reach - minY) / cell))
    const j1 = Math.min(rows - 1, Math.ceil((sample.y + reach - minY) / cell))
    for (let j = j0; j <= j1; j++) {
      const row = j * cols
      for (let i = i0; i <= i1; i++) {
        if (mask[row + i]) continue
        const x = minX + (i + 0.5) * cell
        const y = minY + (j + 0.5) * cell
        if (coversTip(tip, sample, radius, x, y)) mask[row + i] = 1
      }
    }
  }
  const traced = traceMask(mask, cols, rows, minX, minY, cell)
  if (traced.length > 0) return traced
  if (tip === 'round') {
    const ring = strokeToPolygon(line, radius)
    return ring.length >= 3 ? [{ points: ring }] : []
  }
  return []
}

/** Кисть: круг, квадрат или треугольник. Закраска возвращает залитый контур, а не ленту штриха. */
export function brushOutline(points: Point[], radius: number, tip: BrushTip): Region | null {
  const parts = brushParts(points, radius, tip)
  if (parts.length === 0) return null
  return parts.reduce((best, region) => (areaOf(region) > areaOf(best) ? region : best))
}

function ringsCross(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a2 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) {
      const b2 = b[(j + 1) % b.length]
      const hit = crossParams(a[i], a2, b[j], b2)
      if (hit && hit.t >= -1e-6 && hit.t <= 1 + 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) return true
    }
  }
  return false
}

/** Два контура делят площадь или хотя бы ребро. */
export function regionsOverlap(a: Region, b: Region): boolean {
  const ab = boundsOf([...a.points, ...(a.holes ?? []).flat()])
  const bb = boundsOf([...b.points, ...(b.holes ?? []).flat()])
  if (ab.maxX < bb.minX || bb.maxX < ab.minX || ab.maxY < bb.minY || bb.maxY < ab.minY) return false
  if (a.points.some((point) => pointInZone(point, b.points, b.holes))) return true
  if (b.points.some((point) => pointInZone(point, a.points, a.holes))) return true
  return ringsCross(a.points, b.points)
}

function weldByClip(regions: Region[]): Region[] | null {
  let acc = regions.slice()
  let guard = acc.length * acc.length + 2
  let moved = true
  while (moved && guard-- > 0) {
    moved = false
    for (let i = 0; i < acc.length && !moved; i++) {
      for (let j = i + 1; j < acc.length; j++) {
        if (!regionsOverlap(acc[i], acc[j])) continue
        const parts = clipRegions('union', acc[i], acc[j])
        const area = parts.reduce((sum, region) => sum + areaOf(region), 0)
        const floor = Math.max(areaOf(acc[i]), areaOf(acc[j]))
        if (parts.length === 0 || area < floor * 0.9) return null
        acc = [...acc.slice(0, i), ...acc.slice(i + 1, j), ...acc.slice(j + 1), ...parts]
        moved = true
        break
      }
    }
  }
  return acc
}

/** Склеивает пересекающиеся заливки в общие контуры. null — склейка развалилась. */
export function weldRegions(regions: Region[]): Region[] | null {
  const solid = regions.filter((region) => region.points.length >= 3 && areaOf(region) > 0)
  if (solid.length <= 1) return solid
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const region of solid) {
    for (const point of [...region.points, ...(region.holes ?? []).flat()]) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1)
  if (span > 1600) return weldByClip(solid)
  const cell = Math.max(span / 420, 0.4)
  const cols = Math.ceil((maxX - minX) / cell) + 2
  const rows = Math.ceil((maxY - minY) / cell) + 2
  if (cols > 460 || rows > 460) return weldByClip(solid)
  const mask = new Uint8Array(cols * rows)
  const originX = minX - cell
  const originY = minY - cell
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const point = { x: originX + (i + 0.5) * cell, y: originY + (j + 0.5) * cell }
      if (solid.some((region) => pointInZone(point, region.points, region.holes))) mask[j * cols + i] = 1
    }
  }
  const traced = traceMask(mask, cols, rows, originX, originY, cell)
  if (traced.length === 0) return null
  const before = solid.reduce((sum, region) => sum + areaOf(region), 0)
  const after = traced.reduce((sum, region) => sum + areaOf(region), 0)
  const largest = solid.reduce((best, region) => Math.max(best, areaOf(region)), 0)
  if (after < largest * 0.85 || after > before * 1.12) return weldByClip(solid)
  return traced
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
