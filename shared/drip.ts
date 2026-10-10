import { centroid, dist, pointInPolygon, polygonAreaPx } from './geom.ts'
import type { Point, Soil, ZoneKind } from './types.ts'

const INSET_M = 0.15
const MIN_LATERAL_M = 0.4
const MAX_LATERALS = 120
const SAMPLE_M = 0.38
const AXIS_DEG = 8
const BED_LATERAL_M = 0.3
const SHRUB_LATERAL_M = 0.4
const EMITTER_LPH = 2
const SOIL_K: Record<Soil, number> = { sand: 0.85, loam: 1, clay: 1.15 }

export type DripOpts = { kind?: ZoneKind; soil?: Soil }

export type DripRun = {
  points: Point[]
  spacingM: number
  emitterLph: number
}

/** Кольцо капельниц у ствола. Куст — две капельницы, дерево — по кроне. */
export function placeDripAtPlant(
  plant: { kind: 'tree' | 'bush'; x: number; y: number; radiusM: number },
  ppm: number,
): DripRun | null {
  if (!(ppm > 0) || !(plant.radiusM > 0)) return null
  const tree = plant.kind === 'tree'
  const radiusM = tree ? clamp(plant.radiusM * 0.55, 0.35, 1.2) : clamp(plant.radiusM * 0.45, 0.18, 0.45)
  const count = tree ? clampInt(Math.round((2 * Math.PI * radiusM) / 0.6), 3, 6) : 2
  const steps = 16
  const radiusPx = radiusM * ppm
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    points.push({ x: plant.x + Math.cos(angle) * radiusPx, y: plant.y + Math.sin(angle) * radiusPx })
  }
  let px = 0
  for (let i = 1; i < points.length; i++) px += dist(points[i - 1], points[i])
  const spacingM = px / ppm / count
  if (!(spacingM >= 0.05) || spacingM > 2) return null
  return { points, spacingM, emitterLph: tree ? 4 : EMITTER_LPH }
}

/** Точки капельниц вдоль трубки. Число совпадает с расчётом расхода. */
export function emitterPoints(points: Point[], spacingM: number, ppm: number): Point[] {
  if (!(ppm > 0) || !(spacingM > 0) || points.length < 2) return []
  const spacing = spacingM * ppm
  let length = 0
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i])
  if (!(length > 0)) return []
  const count = Math.max(1, Math.round(length / spacing))
  const step = length / count
  const out: Point[] = []
  let walked = 0
  let target = step / 2
  for (let i = 1; i < points.length && out.length < count; i++) {
    const a = points[i - 1]
    const b = points[i]
    const seg = dist(a, b)
    if (seg < 1e-9) continue
    while (target <= walked + seg + 1e-6 && out.length < count) {
      const t = Math.max(0, Math.min(1, (target - walked) / seg))
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      target += step
    }
    walked += seg
  }
  return out
}

/** Кольцо капельниц: центр в точке курсора, линия проходит через узел на подводе. */
export function dripRingPoints(anchor: Point, center: Point, steps = 24): Point[] | null {
  const radius = dist(anchor, center)
  if (radius < 4) return null
  const a0 = Math.atan2(anchor.y - center.y, anchor.x - center.x)
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + (i / steps) * Math.PI * 2
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius })
  }
  points[0] = { x: anchor.x, y: anchor.y }
  points[points.length - 1] = { x: anchor.x, y: anchor.y }
  return points
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

type Lateral = { offset: number; a: Point; b: Point }

/** Капельные линии: латерали вдоль длинной стороны, змейка только внутри контура. */
export function placeDripOnPolygon(ring: Point[], holes: Point[][], ppm: number, opts: DripOpts = {}): DripRun[] {
  if (ring.length < 3 || !(ppm > 0)) return []
  const outer = orient(simplifyRing(ring, 0.12 * ppm), true)
  if (outer.length < 3) return []
  const holeRings = holes
    .map((hole) => orient(simplifyRing(hole, 0.12 * ppm), false))
    .filter((hole) => hole.length >= 3 && polygonAreaPx(hole) / (ppm * ppm) >= 0.3)
    .filter((hole) => pointInPolygon(centroid(hole), outer))
  const pitch = dripPitch(opts.kind, opts.soil)
  const work = orthogonalize(outer, ppm) ?? outer
  const parts = reflexVertices(work).length > 0 ? decomposeRectilinear(work, ppm) : [work]
  const runs: DripRun[] = []
  for (const part of parts) {
    if (polygonAreaPx(part) / (ppm * ppm) < 0.8) continue
    for (const path of layoutPart(part, holeRings, ppm, pitch)) {
      runs.push({ points: path, spacingM: pitch.emitterM, emitterLph: pitch.emitterLph })
    }
  }
  return runs
}

function layoutPart(
  outer: Point[],
  holes: Point[][],
  ppm: number,
  pitch: { lateralM: number; emitterM: number; emitterLph: number },
): Point[][] {
  const inside = (point: Point) => wetAt(point, outer, holes)
  const spacing = pitch.lateralM * ppm
  const inset = INSET_M * ppm
  const samples = sampleWet(outer, holes, ppm)
  const rectilinear = axisShare(outer) >= 0.7
  let best: Lateral[] = []
  let bestScore = -Infinity
  for (const angle of candidateAngles(outer)) {
    const laterals = lateralsAt(outer, holes, ppm, angle, spacing, inset)
    if (laterals.length === 0) continue
    const score = scoreLaterals(laterals, samples, spacing, ppm, angle, rectilinear)
    if (score > bestScore) {
      bestScore = score
      best = laterals
    }
  }
  if (best.length === 0) {
    const fallback = lateralsAt(outer, holes, ppm, principal(outer), spacing, inset)
    if (fallback.length === 0) return []
    best = fallback
  }
  const stitched = stitchLaterals(best, spacing, inside, spacing * 1.8)
  return stitched
    .filter((points) => points.length >= 2 && polylineLen(points) >= MIN_LATERAL_M * ppm)
    .map((points) => startAtEdge(points, outer))
}

function startAtEdge(path: Point[], ring: Point[]): Point[] {
  if (path.length < 2) return path
  const d0 = distToRing(path[0], ring)
  const d1 = distToRing(path[path.length - 1], ring)
  return d0 <= d1 ? path : [...path].reverse()
}

export function dripPitch(kind: ZoneKind | undefined, soil: Soil | undefined): { lateralM: number; emitterM: number; emitterLph: number } {
  const shrub = kind === 'shrub'
  const k = soil && soil in SOIL_K ? SOIL_K[soil] : 1
  const lateralM = (shrub ? SHRUB_LATERAL_M : BED_LATERAL_M) * k
  const emitterM = shrub ? 0.4 : 0.3
  return { lateralM, emitterM, emitterLph: EMITTER_LPH }
}

function lateralsAt(
  outer: Point[],
  holes: Point[][],
  ppm: number,
  angle: number,
  spacing: number,
  inset: number,
): Lateral[] {
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const nx = -uy
  const ny = ux
  const mid = centroid(outer)
  let minO = Infinity
  let maxO = -Infinity
  for (const point of outer) {
    const o = (point.x - mid.x) * nx + (point.y - mid.y) * ny
    minO = Math.min(minO, o)
    maxO = Math.max(maxO, o)
  }
  const width = maxO - minO
  const origins = scanOffsets(minO, maxO, spacing, inset)
  const minLen = MIN_LATERAL_M * ppm
  const out: Lateral[] = []
  for (const o of origins) {
    const origin = { x: mid.x + nx * o, y: mid.y + ny * o }
    const segs = clipScan(outer, holes, origin, { x: ux, y: uy })
    for (const seg of segs) {
      const trimmed = trimSeg(seg[0], seg[1], inset, minLen)
      if (!trimmed) continue
      const a0 = (trimmed[0].x - mid.x) * ux + (trimmed[0].y - mid.y) * uy
      const a1 = (trimmed[1].x - mid.x) * ux + (trimmed[1].y - mid.y) * uy
      const a = a0 <= a1 ? trimmed[0] : trimmed[1]
      const b = a0 <= a1 ? trimmed[1] : trimmed[0]
      out.push({ offset: o, a, b })
    }
  }
  if (out.length === 0 && width > 0) {
    const segs = clipScan(outer, holes, mid, { x: ux, y: uy })
    for (const seg of segs) {
      const trimmed = trimSeg(seg[0], seg[1], inset * 0.4, minLen)
      if (!trimmed) continue
      out.push({ offset: 0, a: trimmed[0], b: trimmed[1] })
    }
  }
  return out
}

function scanOffsets(minO: number, maxO: number, spacing: number, inset: number): number[] {
  const width = maxO - minO
  const mid = (minO + maxO) / 2
  const usable = width - 2 * inset
  if (width <= 0) return [mid]
  if (usable < spacing * 0.5) return [mid]
  let count = Math.max(1, Math.round(usable / spacing))
  if (count > MAX_LATERALS) count = MAX_LATERALS
  const span = (count - 1) * spacing
  let start = mid - span / 2
  const pad = inset * 0.5
  if (start < minO + pad) start = minO + pad
  if (start + span > maxO - pad) start = Math.max(minO + pad, maxO - pad - span)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(start + i * spacing)
  return out
}

function clipScan(outer: Point[], holes: Point[][], origin: Point, dir: Point): Point[][] {
  const hits: { t: number; point: Point }[] = []
  const add = (ring: Point[]) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const sx = b.x - a.x
      const sy = b.y - a.y
      const rxs = dir.x * sy - dir.y * sx
      if (Math.abs(rxs) < 1e-9) continue
      const qpx = a.x - origin.x
      const qpy = a.y - origin.y
      const t = (qpx * sy - qpy * sx) / rxs
      const u = (qpx * dir.y - qpy * dir.x) / rxs
      if (u < -1e-4 || u > 1 + 1e-4) continue
      hits.push({ t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t } })
    }
  }
  add(outer)
  for (const hole of holes) add(hole)
  hits.sort((a, b) => a.t - b.t)
  const uniq: { t: number; point: Point }[] = []
  for (const hit of hits) {
    if (!uniq.length || Math.abs(hit.t - uniq[uniq.length - 1].t) > 1e-4) uniq.push(hit)
  }
  const segs: Point[][] = []
  for (let i = 0; i + 1 < uniq.length; i++) {
    const t = (uniq[i].t + uniq[i + 1].t) / 2
    const mid = { x: origin.x + dir.x * t, y: origin.y + dir.y * t }
    if (wetAt(mid, outer, holes)) segs.push([uniq[i].point, uniq[i + 1].point])
  }
  return segs
}

function trimSeg(a: Point, b: Point, pad: number, minLen: number): Point[] | null {
  const len = dist(a, b)
  if (len < minLen) return null
  const cut = Math.min(pad, len * 0.35)
  if (len - 2 * cut < minLen * 0.85) return null
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  return [
    { x: a.x + ux * cut, y: a.y + uy * cut },
    { x: b.x - ux * cut, y: b.y - uy * cut },
  ]
}

function stitchLaterals(laterals: Lateral[], spacing: number, inside: (point: Point) => boolean, maxConn: number): Point[][] {
  if (laterals.length === 0) return []
  const used = new Array<boolean>(laterals.length).fill(false)
  const order = laterals.map((_, i) => i).sort((i, j) => laterals[i].offset - laterals[j].offset || laterals[i].a.x - laterals[j].a.x)
  const runs: Point[][] = []
  for (const start of order) {
    if (used[start]) continue
    used[start] = true
    const first = laterals[start]
    const path: Point[] = [first.a, first.b]
    let end = first.b
    let offset = first.offset
    while (true) {
      let best = -1
      let bestGap = Infinity
      let bestNear: Point | null = null
      let bestFar: Point | null = null
      for (let i = 0; i < laterals.length; i++) {
        if (used[i]) continue
        const dOff = Math.abs(laterals[i].offset - offset)
        if (dOff < spacing * 0.55 || dOff > spacing * 1.45) continue
        const nearA = dist(end, laterals[i].a)
        const nearB = dist(end, laterals[i].b)
        const useA = nearA <= nearB
        const near = useA ? laterals[i].a : laterals[i].b
        const far = useA ? laterals[i].b : laterals[i].a
        const gap = useA ? nearA : nearB
        if (gap > maxConn || gap >= bestGap) continue
        if (!segmentInside(end, near, inside)) continue
        best = i
        bestGap = gap
        bestNear = near
        bestFar = far
      }
      if (best < 0 || !bestNear || !bestFar) break
      used[best] = true
      if (bestGap > 1e-3) path.push(bestNear)
      path.push(bestFar)
      end = bestFar
      offset = laterals[best].offset
    }
    if (path.length >= 2) runs.push(dedupePath(path))
  }
  return runs
}

function segmentInside(a: Point, b: Point, inside: (point: Point) => boolean): boolean {
  for (let i = 1; i <= 6; i++) {
    const t = i / 7
    if (!inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false
  }
  return true
}

function scoreLaterals(
  laterals: Lateral[],
  samples: Point[],
  spacing: number,
  ppm: number,
  angle: number,
  rectilinear: boolean,
): number {
  if (samples.length === 0) return 0
  const coverR = spacing * 0.62
  let hit = 0
  for (const sample of samples) {
    if (laterals.some((lat) => pointSegDist(sample, lat.a, lat.b) <= coverR)) hit += 1
  }
  const coverage = hit / samples.length
  let length = 0
  for (const lat of laterals) length += dist(lat.a, lat.b)
  const expected = (samples.length * SAMPLE_M * SAMPLE_M) / (spacing / ppm)
  const density = length / ppm / Math.max(1e-3, expected)
  const densPen = Math.abs(density - 1)
  const fragPen = laterals.length / Math.max(3, expected / 8)
  let score = coverage - 0.18 * densPen - 0.03 * fragPen
  if (axisDelta(angle) < AXIS_DEG * Math.PI / 180) score += rectilinear ? 0.08 : 0.02
  return score
}

function candidateAngles(ring: Point[]): number[] {
  const raw: number[] = [0, Math.PI / 2, principal(ring), principal(ring) + Math.PI / 2]
  let longest = 0
  let longAng = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len > longest) {
      longest = len
      longAng = Math.atan2(dy, dx)
    }
  }
  raw.push(longAng, longAng + Math.PI / 2)
  const unique: number[] = []
  for (const angle of raw) {
    const folded = foldAngle(angle)
    if (unique.some((item) => angleNear(item, folded))) continue
    unique.push(folded)
  }
  return unique
}

function sampleWet(outer: Point[], holes: Point[][], ppm: number): Point[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of outer) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const step = SAMPLE_M * ppm
  const samples: Point[] = []
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const point = { x, y }
      if (wetAt(point, outer, holes)) samples.push(point)
    }
  }
  return samples
}

function wetAt(point: Point, outer: Point[], holes: Point[][]): boolean {
  if (!pointInPolygon(point, outer)) return false
  return !holes.some((hole) => pointInPolygon(point, hole))
}

function axisShare(ring: Point[]): number {
  let axis = 0
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    total += len
    if (axisDelta(Math.atan2(dy, dx)) < AXIS_DEG * Math.PI / 180) axis += len
  }
  return total > 0 ? axis / total : 0
}

function principal(points: Point[]): number {
  const mid = centroid(points)
  let xx = 0
  let xy = 0
  let yy = 0
  for (const point of points) {
    const dx = point.x - mid.x
    const dy = point.y - mid.y
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy)
}

function foldAngle(angle: number): number {
  let x = angle % Math.PI
  if (x < 0) x += Math.PI
  return x
}

function angleNear(a: number, b: number): boolean {
  const d = Math.abs(foldAngle(a) - foldAngle(b))
  return Math.min(d, Math.PI - d) < (AXIS_DEG * Math.PI) / 180
}

function axisDelta(angle: number): number {
  const folded = foldAngle(angle)
  return Math.min(folded, Math.abs(folded - Math.PI / 2), Math.PI - folded)
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

function orient(points: Point[], ccw: boolean): Point[] {
  if (points.length < 3) return points
  const isCcw = signedArea(points) > 0
  return isCcw === ccw ? points : [...points].reverse()
}

function simplifyRing(points: Point[], tol: number): Point[] {
  if (points.length < 4) return points
  const closed = dist(points[0], points[points.length - 1]) < 1e-6
  const open = closed ? points.slice(0, -1) : points
  const keep = douglas(open, tol)
  return keep.length >= 3 ? keep : open
}

function douglas(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points
  let maxD = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegDist(points[i], first, last)
    if (d > maxD) {
      maxD = d
      index = i
    }
  }
  if (maxD <= tol) return [first, last]
  const left = douglas(points.slice(0, index + 1), tol)
  const right = douglas(points.slice(index), tol)
  return [...left.slice(0, -1), ...right]
}

function pointSegDist(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len === 0) return dist(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function polylineLen(points: Point[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i])
  return sum
}

function dedupePath(points: Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (!prev || dist(prev, point) > 1e-3) out.push(point)
  }
  return out
}

function distToRing(point: Point, ring: Point[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointSegDist(point, ring[i], ring[(i + 1) % ring.length]))
  }
  return best
}

function orthogonalize(ring: Point[], ppm: number): Point[] | null {
  if (axisShare(ring) < 0.72) return null
  const pts = ring.map((point) => ({ x: point.x, y: point.y }))
  const tol = 0.2 * ppm
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)) {
        if (Math.abs(a.y - b.y) < tol * 3) {
          const y = (a.y + b.y) / 2
          a.y = y
          b.y = y
        }
      } else if (Math.abs(a.x - b.x) < tol * 3) {
        const x = (a.x + b.x) / 2
        a.x = x
        b.x = x
      }
    }
  }
  const cleaned = cleanRing(pts)
  if (cleaned.length < 4) return null
  for (let i = 0; i < cleaned.length; i++) {
    const a = cleaned[i]
    const b = cleaned[(i + 1) % cleaned.length]
    if (Math.abs(a.x - b.x) > tol && Math.abs(a.y - b.y) > tol) return null
  }
  return cleaned
}

function reflexVertices(ring: Point[]): number[] {
  const out: number[] = []
  const n = ring.length
  const ccw = signedArea(ring) > 0
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]
    const b = ring[i]
    const c = ring[(i + 1) % n]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (ccw ? cross < -1e-6 : cross > 1e-6) out.push(i)
  }
  return out
}

function decomposeRectilinear(ring: Point[], ppm: number): Point[][] {
  const parts: Point[][] = []
  const stack = [orient(ring, true)]
  let guard = 0
  while (stack.length && guard++ < 24) {
    const cur = stack.pop()!
    if (cur.length < 4 || reflexVertices(cur).length === 0) {
      parts.push(cur)
      continue
    }
    const cut = bestCut(cur, ppm)
    if (!cut) {
      parts.push(cur)
      continue
    }
    const [a, b] = splitAlong(cur, cut)
    if (a.length >= 4) stack.push(orient(a, true))
    if (b.length >= 4) stack.push(orient(b, true))
  }
  while (stack.length) parts.push(stack.pop()!)
  return parts.length ? parts : [ring]
}

type Cut = { i: number; hit: Point; j: number; len: number }

function bestCut(ring: Point[], ppm: number): Cut | null {
  const dirs: Point[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  let best: Cut | null = null
  const n = ring.length
  for (const i of reflexVertices(ring)) {
    const origin = ring[i]
    const prev = ring[(i - 1 + n) % n]
    const next = ring[(i + 1) % n]
    for (const dir of dirs) {
      if (edgeAlong(origin, prev, dir) || edgeAlong(origin, next, dir)) continue
      const hit = rayHit(ring, i, dir)
      if (!hit || hit.len < 0.2 * ppm) continue
      const mid = { x: (origin.x + hit.point.x) / 2, y: (origin.y + hit.point.y) / 2 }
      if (!pointInPolygon(mid, ring)) continue
      if (!best || hit.len < best.len) best = { i, hit: hit.point, j: hit.edge, len: hit.len }
    }
  }
  return best
}

function edgeAlong(origin: Point, other: Point, dir: Point): boolean {
  const dx = other.x - origin.x
  const dy = other.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return true
  return (dx / len) * dir.x + (dy / len) * dir.y > 0.95
}

function rayHit(ring: Point[], i: number, dir: Point): { point: Point; edge: number; len: number } | null {
  const origin = ring[i]
  const n = ring.length
  let best: { point: Point; edge: number; len: number } | null = null
  for (let e = 0; e < n; e++) {
    if (e === i || e === (i - 1 + n) % n) continue
    const a = ring[e]
    const b = ring[(e + 1) % n]
    const sx = b.x - a.x
    const sy = b.y - a.y
    const rxs = dir.x * sy - dir.y * sx
    if (Math.abs(rxs) < 1e-9) continue
    const t = ((a.x - origin.x) * sy - (a.y - origin.y) * sx) / rxs
    const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / rxs
    if (t < 0.15 || u < -1e-4 || u > 1 + 1e-4) continue
    if (!best || t < best.len) {
      best = { point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t }, edge: e, len: t }
    }
  }
  return best
}

function splitAlong(ring: Point[], cut: Cut): [Point[], Point[]] {
  const n = ring.length
  const snap = 1e-3
  const jVert = dist(cut.hit, ring[cut.j]) < snap ? cut.j : dist(cut.hit, ring[(cut.j + 1) % n]) < snap ? (cut.j + 1) % n : -1
  if (jVert >= 0) return [cleanRing(walk(ring, cut.i, jVert)), cleanRing(walk(ring, jVert, cut.i))]
  const a = walk(ring, cut.i, cut.j)
  if (dist(a[a.length - 1], cut.hit) > snap) a.push(cut.hit)
  const b: Point[] = [ring[cut.i], cut.hit]
  let k = (cut.j + 1) % n
  while (k !== cut.i) {
    b.push(ring[k])
    k = (k + 1) % n
  }
  return [cleanRing(a), cleanRing(b)]
}

function walk(ring: Point[], from: number, to: number): Point[] {
  const pts: Point[] = [ring[from]]
  let k = from
  while (k !== to) {
    k = (k + 1) % ring.length
    pts.push(ring[k])
  }
  return pts
}

function cleanRing(points: Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (!prev || dist(prev, point) > 1e-3) out.push(point)
  }
  if (out.length >= 2 && dist(out[0], out[out.length - 1]) < 1e-3) out.pop()
  const slim: Point[] = []
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length]
    const cur = out[i]
    const next = out[(i + 1) % out.length]
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
    if (Math.abs(cross) < 1e-4 && dist(prev, next) > 1e-3) continue
    slim.push(cur)
  }
  return slim.length >= 3 ? slim : out
}
