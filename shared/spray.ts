import { dist, pointInPolygon, polygonAreaPx, polar } from './geom.ts'
import { nozzleById } from './nozzles.ts'
import type { Point } from './types.ts'

export const FAN_M = 4.5
export const ROTOR_M = 10
export const HEAD_SPACING = 0.9
export const MIN_HEAD_SEP = 0.68
const MIN_LAWN_M2 = 8
const INSET_M = 0.22
const MAX_HEADS = 120
const COVER_FRAC = 0.86
const OVERSPRAY_MAX = 0.22
const TARGET_FRAC = 0.87
const KEEP_FRAC = 0.84
const FILL_TARGET = 0.97
const FILL_KEEP = 0.95
const VIS_STEPS = 72
const FAN_IDS = { 90: 'fan90', 180: 'fan180', 360: 'fan360' } as const
const ROTOR_IDS = { 90: 'rotor90', 180: 'rotor', 360: 'rotor360' } as const

export type SpraySpot = { point: Point; nozzleId: string; rotationDeg: number; radiusM: number; flowLph: number }

type ArcIds = { 90: string; 180: string; 360: string }
type Family = { radiusM: number; kind: 'fan' | 'rotor' }
type Prepared = {
  outer: Point[]
  holeRings: Point[][]
  ppm: number
  inside: (point: Point) => boolean
  minSpan: number
  samples: Point[]
  weights: Float64Array
}

type Candidate = { point: Point; vertex: boolean; edge: boolean }

type Option = {
  spot: SpraySpot
  mask: Uint8Array
  overspray: number
  flow: number
  radiusM: number
  vertex: boolean
}

export type SprayFamily = 'auto' | 'fan' | 'rotor'

/** Покрытие газона: радиус под ширину, head-to-head, без плотной укладки вокруг клумб. */
export function placeSprayOnPolygon(ring: Point[], holes: Point[][], ppm: number, family: SprayFamily = 'auto'): SpraySpot[] {
  const prep = prepareLawn(ring, holes, ppm)
  if (!prep) return []
  if (family === 'fan') return lay(prep, FAN_M, 'fan', false)
  if (family === 'rotor') return lay(prep, ROTOR_M, 'rotor', true)
  return pickThrow(prep)
}

function prepareLawn(ring: Point[], holes: Point[][], ppm: number): Prepared | null {
  if (ring.length < 3 || !(ppm > 0)) return null
  const outer = orient(simplifyRing(ring, 0.2 * ppm), true)
  if (outer.length < 3) return null
  const area = polygonAreaPx(outer) / (ppm * ppm)
  if (area < MIN_LAWN_M2) return null
  const holeRings = holes
    .map((hole) => orient(simplifyRing(hole, 0.2 * ppm), false))
    .filter((hole) => hole.length >= 3 && polygonAreaPx(hole) / (ppm * ppm) >= 1)
  const inside = (point: Point) => lawnAt(point, outer, holeRings)
  const { minSpan } = spansOf(outer, ppm)
  const stepM = area > 400 ? 0.75 : area > 140 ? 0.5 : 0.42
  const samples = sampleLawn(outer, holeRings, ppm, stepM)
  if (samples.length === 0) return null
  return { outer, holeRings, ppm, inside, minSpan, samples, weights: sampleWeights(samples, [outer, ...holeRings], ppm) }
}

/** Шаг 0,5 м от короткого веера до радиуса, который ещё помещается в короткую сторону. */
function throwChoices(minSpan: number): number[] {
  const cap = Math.min(12, Math.max(FAN_M, minSpan * 1.05))
  const found: number[] = []
  for (let radius = 2.5; radius <= cap + 0.001; radius += 0.5) found.push(Math.round(radius * 2) / 2)
  return found
}

function pickThrow(prep: Prepared): SpraySpot[] {
  let best: SpraySpot[] = []
  let bestScore = Infinity
  for (const radius of throwChoices(prep.minSpan)) {
    const kind = radius <= 5.5 ? 'fan' as const : 'rotor' as const
    const heads = lay(prep, radius, kind, false)
    const score = layoutScore(heads, prep, radius)
    if (score < bestScore) {
      bestScore = score
      best = heads
    }
  }
  return best
}

function layoutScore(heads: SpraySpot[], prep: Prepared, radiusM: number): number {
  if (heads.length === 0) return Infinity
  const cover = coveredCount(heads, prep.samples, prep.ppm) / prep.samples.length
  let waste = 0
  for (const head of heads) waste += oversprayFrac(head, prep.ppm, prep.inside)
  waste /= heads.length
  const miss = Math.max(0, 0.96 - cover)
  return miss * 100000 + heads.length * 100 + waste * 1200 + radiusM
}

function lay(prep: Prepared, radiusM: number, kind: 'fan' | 'rotor', fallback: boolean): SpraySpot[] {
  const { outer, holeRings, ppm, inside, minSpan, samples, weights } = prep
  const primary: Family = { radiusM, kind }
  const wide = minSpan > radiusM * 1.85
  const target = wide ? FILL_TARGET : TARGET_FRAC
  const keep = wide ? FILL_KEEP : KEEP_FRAC
  const candidates = collectCandidates(outer, holeRings, ppm, inside, radiusM, wide)
  const primaryOpts: Option[] = []
  for (const cand of candidates) primaryOpts.push(...optionsAt(cand, primary, samples, ppm, inside))
  const heads = seedCorners(outer, primaryOpts, ppm)
  heads.push(...pickHeads(primaryOpts, samples, weights, ppm, target, heads))
  const families: Family[] = [primary]
  if (fallback && coveredCount(heads, samples, ppm) < samples.length * keep) {
    const fans: Family = { radiusM: FAN_M, kind: 'fan' }
    families.push(fans)
    const fanOpts: Option[] = []
    for (const cand of candidates) fanOpts.push(...optionsAt(cand, fans, samples, ppm, inside))
    heads.push(...pickHeads(fanOpts, samples, weights, ppm, target, heads))
  }
  if (wide) {
    let guard = 0
    while (guard < 30 && heads.length < MAX_HEADS && coveredCount(heads, samples, ppm) < samples.length * target) {
      guard += 1
      const covered = new Uint8Array(samples.length)
      for (const head of heads) applyMask(covered, coverageMask(head, samples, ppm))
      const extra = rescueDry(samples, covered, heads, candidates, families, inside, ppm, 0.03)
      if (!extra) break
      heads.push(extra)
    }
  } else if (coveredCount(heads, samples, ppm) < samples.length * KEEP_FRAC) {
    const covered = new Uint8Array(samples.length)
    for (const head of heads) applyMask(covered, coverageMask(head, samples, ppm))
    const extra = rescueDry(samples, covered, heads, candidates, families, inside, ppm)
    if (extra) heads.push(extra)
  }
  pruneHeads(heads, samples, weights, outer, ppm, keep)
  return heads
}

function arcIds(kind: 'fan' | 'rotor'): ArcIds {
  return kind === 'fan' ? FAN_IDS : ROTOR_IDS
}

function flowFor(kind: 'fan' | 'rotor', arcDeg: number, radiusM: number): number {
  const base = kind === 'fan' ? FAN_M : ROTOR_M
  const slot = arcDeg >= 359 ? 360 : arcDeg <= 100 ? 90 : 180
  const nozzle = nozzleById(arcIds(kind)[slot])
  if (Math.abs(radiusM - base) < 0.001) return nozzle.flowLph
  return Math.max(1, Math.round(nozzle.flowLph * (radiusM / base) ** 2))
}

export function ringsOverlap(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false
  if (pointInPolygon(centroid(a), b) || pointInPolygon(centroid(b), a)) return true
  return a.some((point) => pointInPolygon(point, b)) || b.some((point) => pointInPolygon(point, a))
}

function optionsAt(
  cand: Candidate,
  family: Family,
  samples: Point[],
  ppm: number,
  inside: (point: Point) => boolean,
): Option[] {
  const radiusPx = family.radiusM * ppm
  const flags = visibleFlags(cand.point, radiusPx, inside)
  const run = longestRun(flags)
  if (run.len === 0) return []
  const visDeg = (run.len / VIS_STEPS) * 360
  const aim = (((run.start + run.len / 2) / VIS_STEPS) * 360) % 360
  const ids = nozzlesForSector(visDeg, family, maxThrowRoom(cand.point, ppm, inside), cand.edge || cand.vertex)
  const out: Option[] = []
  for (const nozzleId of ids) {
    const nozzle = nozzleById(nozzleId)
    const spot: SpraySpot = {
      point: cand.point,
      nozzleId,
      rotationDeg: nozzle.arcDeg >= 359 ? 0 : aim,
      radiusM: family.radiusM,
      flowLph: flowFor(family.kind, nozzle.arcDeg, family.radiusM),
    }
    const overspray = oversprayFrac(spot, ppm, inside)
    if (overspray > OVERSPRAY_MAX) continue
    const mask = coverageMask(spot, samples, ppm)
    let hits = 0
    for (let i = 0; i < mask.length; i++) hits += mask[i]
    if (hits < 2) continue
    out.push({
      spot,
      mask,
      overspray,
      flow: spot.flowLph,
      radiusM: family.radiusM,
      vertex: cand.vertex,
    })
  }
  return out
}

function nozzlesForSector(visDeg: number, family: Family, throwRoomM: number, onEdge: boolean): string[] {
  const ids = arcIds(family.kind)
  const found: string[] = []
  if (onEdge) {
    if (visDeg >= 48 && visDeg <= 148) found.push(ids[90])
    if (visDeg >= 125 && visDeg <= 255) found.push(ids[180])
  }
  if (visDeg >= 305 && throwRoomM >= family.radiusM * 0.9) found.push(ids[360])
  if (found.length === 0 && onEdge && visDeg >= 55) {
    found.push(visDeg < 155 ? ids[90] : ids[180])
  }
  return found
}

function visibleFlags(point: Point, radiusPx: number, inside: (sample: Point) => boolean): boolean[] {
  const flags = new Array<boolean>(VIS_STEPS).fill(true)
  for (const frac of [0.48, 0.78]) {
    const radius = radiusPx * frac
    for (let i = 0; i < VIS_STEPS; i++) {
      if (!inside(polar(point, radius, (i / VIS_STEPS) * 360))) flags[i] = false
    }
  }
  return flags
}

function collectCandidates(
  outer: Point[],
  holes: Point[][],
  ppm: number,
  inside: (point: Point) => boolean,
  throwM: number,
  fill: boolean,
): Candidate[] {
  const inset = INSET_M * ppm
  const minGap = Math.max(0.62 * throwM, 1.8) * ppm
  const edgeStep = throwM * ppm
  const points: Candidate[] = []
  const push = (point: Point, vertex: boolean, edge: boolean) => {
    const placed = inside(point) ? point : nudgeInside(point, { x: 0, y: 0 }, inset, inside)
    if (!inside(placed)) return
    const near = points.find((other) => dist(other.point, placed) < minGap)
    if (near) {
      if (vertex && !near.vertex) near.vertex = true
      if (edge && !near.edge) near.edge = true
      return
    }
    points.push({ point: placed, vertex, edge })
  }
  const addRing = (ring: Point[], verts: boolean, edges: boolean) => {
    const n = ring.length
    if (verts) {
      for (let i = 0; i < n; i++) {
        const prev = ring[(i + n - 1) % n]
        const cur = ring[i]
        const next = ring[(i + 1) % n]
        if (Math.abs(turnAngle(prev, cur, next)) > 16 * Math.PI / 180) {
          push(nudgeInside(cur, leftNormal(prev, cur, next), inset, inside), true, true)
        }
      }
    }
    if (!edges) return
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const len = dist(a, b)
      const count = Math.max(1, Math.round(len / edgeStep))
      const inward = leftOf(a, b)
      for (let k = 1; k < count; k++) {
        const t = k / count
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        push(nudgeInside(at, inward, inset, inside), false, true)
      }
    }
  }
  addRing(outer, true, true)
  for (const hole of holes) {
    const holeArea = polygonAreaPx(hole) / (ppm * ppm)
    if (holeArea < 20) continue
    addRing(hole, true, holeArea >= 40)
  }
  const need = throwM * 0.78 * ppm
  const step = 0.85 * throwM * ppm
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
  const rings = [outer, ...holes]
  const clearance = (point: Point) => {
    let best = Infinity
    for (const ring of rings) best = Math.min(best, distanceToRing(point, ring))
    return best
  }
  for (let x = minX + step; x < maxX; x += step) {
    for (let y = minY + step; y < maxY; y += step) {
      const point = { x, y }
      if (!inside(point)) continue
      const cl = clearance(point)
      if (cl < need) continue
      const neighbors = [
        { x: x + step, y },
        { x: x - step, y },
        { x, y: y + step },
        { x, y: y - step },
      ]
      if (neighbors.some((item) => inside(item) && clearance(item) > cl + 0.12 * ppm)) continue
      push(point, false, false)
    }
  }
  if (fill) {
    const gap = HEAD_SPACING * throwM * ppm
    const spanX = maxX - minX
    const spanY = maxY - minY
    const nx = Math.max(1, Math.round(spanX / gap))
    const ny = Math.max(1, Math.round(spanY / gap))
    const skirt = 0.45 * throwM * ppm
    for (let ix = 1; ix < nx; ix++) {
      for (let iy = 1; iy < ny; iy++) {
        const point = { x: minX + (spanX * ix) / nx, y: minY + (spanY * iy) / ny }
        if (!inside(point) || clearance(point) < skirt) continue
        push(point, false, true)
      }
    }
  }
  return points
}

function coverageMask(head: SpraySpot, samples: Point[], ppm: number): Uint8Array {
  const mask = new Uint8Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    if (headCovers(head, samples[i], ppm, COVER_FRAC)) mask[i] = 1
  }
  return mask
}

function oversprayFrac(head: SpraySpot, ppm: number, inside: (point: Point) => boolean): number {
  const nozzle = nozzleById(head.nozzleId)
  const radius = head.radiusM * ppm * 0.92
  const steps = 36
  let outside = 0
  if (nozzle.arcDeg >= 359) {
    for (let i = 0; i < steps; i++) {
      if (!inside(polar(head.point, radius, (i / steps) * 360))) outside += 1
    }
    return outside / steps
  }
  const start = head.rotationDeg - nozzle.arcDeg / 2
  for (let i = 0; i < steps; i++) {
    const bearingDeg = start + ((i + 0.5) / steps) * nozzle.arcDeg
    if (!inside(polar(head.point, radius, bearingDeg))) outside += 1
  }
  return outside / steps
}

function spacingBonus(option: Option, heads: SpraySpot[], ppm: number): number {
  if (heads.length === 0) return 0
  const target = option.radiusM * HEAD_SPACING * ppm
  let best = 0
  for (const head of heads) {
    const gap = dist(head.point, option.spot.point)
    const other = head.radiusM * HEAD_SPACING * ppm
    const want = (target + other) / 2
    const err = Math.abs(gap - want) / Math.max(want, 1)
    if (err < 0.38) best = Math.max(best, 3.2 * (1 - err / 0.38))
  }
  return best
}

function tooClose(option: Option, heads: SpraySpot[], ppm: number): boolean {
  for (const head of heads) {
    const other = head.radiusM
    const limit = Math.min(option.radiusM, other) * MIN_HEAD_SEP * ppm
    if (dist(option.spot.point, head.point) < Math.max(limit, 0.55 * ppm)) return true
  }
  return false
}

function seedCorners(outer: Point[], options: Option[], ppm: number): SpraySpot[] {
  const heads: SpraySpot[] = []
  const n = outer.length
  for (let i = 0; i < n; i++) {
    const prev = outer[(i + n - 1) % n]
    const cur = outer[i]
    const next = outer[(i + 1) % n]
    if (Math.abs(turnAngle(prev, cur, next)) <= 16 * Math.PI / 180) continue
    let best: Option | null = null
    for (const option of options) {
      if (dist(option.spot.point, cur) > 2.8 * ppm) continue
      const arc = nozzleById(option.spot.nozzleId).arcDeg
      if (arc > 200) continue
      if (!best) {
        best = option
        continue
      }
      const bestArc = nozzleById(best.spot.nozzleId).arcDeg
      if (arc < bestArc - 8 || (Math.abs(arc - bestArc) <= 8 && option.overspray < best.overspray)) best = option
    }
    if (!best || tooClose(best, heads, ppm)) continue
    heads.push(best.spot)
  }
  return heads
}

function pickHeads(
  options: Option[],
  samples: Point[],
  weights: Float64Array,
  ppm: number,
  targetFrac: number,
  existing: SpraySpot[] = [],
): SpraySpot[] {
  if (options.length === 0) return []
  const covered = new Uint8Array(samples.length)
  for (const head of existing) applyMask(covered, coverageMask(head, samples, ppm))
  const used = new Array<boolean>(options.length).fill(false)
  const heads: SpraySpot[] = []
  const target = Math.ceil(samples.length * targetFrac)
  const minGain = Math.max(2.4, samples.length * 0.02)
  const placed = () => existing.concat(heads)
  for (let guard = 0; guard < MAX_HEADS; guard++) {
    let wet = 0
    for (let i = 0; i < covered.length; i++) wet += covered[i]
    if (wet >= target) break
    let best = -1
    let bestScore = -Infinity
    for (let i = 0; i < options.length; i++) {
      if (used[i]) continue
      const option = options[i]
      if (tooClose(option, placed(), ppm)) continue
      let gain = 0
      let waste = 0
      for (let s = 0; s < samples.length; s++) {
        if (!option.mask[s]) continue
        if (covered[s]) waste += weights[s]
        else gain += weights[s]
      }
      if (gain < minGain) continue
      const overlap = waste / (gain + waste + 1e-6)
      if (overlap > 0.7) continue
      const spacing = spacingBonus(option, placed(), ppm)
      const local = option.vertex ? 1.18 : 1
      const score =
        local * gain * (1 - 1.5 * option.overspray) * (1 - 0.62 * overlap) - 0.42 * waste + spacing - option.flow / 2000 - 6
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best < 0) break
    const picked = options[best]
    for (let i = 0; i < options.length; i++) {
      if (dist(options[i].spot.point, picked.spot.point) < 0.55 * picked.radiusM * ppm) used[i] = true
    }
    heads.push(picked.spot)
    applyMask(covered, picked.mask)
  }
  return heads
}

function coveredCount(heads: SpraySpot[], samples: Point[], ppm: number): number {
  let wet = 0
  for (const sample of samples) {
    if (heads.some((head) => headCovers(head, sample, ppm, COVER_FRAC))) wet += 1
  }
  return wet
}

function rescueDry(
  samples: Point[],
  covered: Uint8Array,
  heads: SpraySpot[],
  candidates: Candidate[],
  families: Family[],
  inside: (point: Point) => boolean,
  ppm: number,
  minFrac = 0.08,
): SpraySpot | null {
  const dry: Point[] = []
  for (let i = 0; i < samples.length; i++) {
    if (!covered[i]) dry.push(samples[i])
  }
  if (dry.length === 0) return null
  const cx = dry.reduce((sum, p) => sum + p.x, 0) / dry.length
  const cy = dry.reduce((sum, p) => sum + p.y, 0) / dry.length
  const seeds: Point[] = []
  const centroid = inside({ x: cx, y: cy }) ? { x: cx, y: cy } : nudgeInside({ x: cx, y: cy }, { x: 0, y: 0 }, 0.4 * ppm, inside)
  if (inside(centroid)) seeds.push(centroid)
  const nearest = candidates
    .slice()
    .sort((a, b) => dist(a.point, { x: cx, y: cy }) - dist(b.point, { x: cx, y: cy }))
    .slice(0, 8)
  for (const cand of nearest) seeds.push(cand.point)
  const stride = Math.max(1, Math.floor(dry.length / 70))
  for (let i = 0; i < dry.length; i += stride) seeds.push(dry[i])

  let best: SpraySpot | null = null
  let bestGain = Math.max(2, dry.length * minFrac)
  for (const point of seeds) {
    if (!inside(point)) continue
    if (heads.some((head) => dist(head.point, point) < head.radiusM * MIN_HEAD_SEP * ppm)) continue
    for (const family of families) {
      for (const opt of optionsAt({ point, vertex: false, edge: true }, family, dry, ppm, inside)) {
        let gain = 0
        for (let i = 0; i < dry.length; i++) {
          if (opt.mask[i]) gain += 1
        }
        const score = gain * (1 - 1.4 * opt.overspray)
        if (score > bestGain) {
          bestGain = score
          best = opt.spot
        }
      }
    }
  }
  return best
}

function pruneHeads(heads: SpraySpot[], samples: Point[], weights: Float64Array, outer: Point[], ppm: number, keepFrac = KEEP_FRAC): void {
  const corners = outer.filter((_, i) => {
    const n = outer.length
    const prev = outer[(i + n - 1) % n]
    const cur = outer[i]
    const next = outer[(i + 1) % n]
    return Math.abs(turnAngle(prev, cur, next)) > 16 * Math.PI / 180
  })
  const isCorner = (head: SpraySpot) => corners.some((vertex) => dist(head.point, vertex) < 1.6 * ppm)
  const uniqueOf = (index: number) => {
    let unique = 0
    for (let s = 0; s < samples.length; s++) {
      if (!headCovers(heads[index], samples[s], ppm, COVER_FRAC)) continue
      let other = false
      for (let j = 0; j < heads.length; j++) {
        if (j === index) continue
        if (headCovers(heads[j], samples[s], ppm, COVER_FRAC)) {
          other = true
          break
        }
      }
      if (!other) unique += weights[s]
    }
    return unique
  }
  const minCover = Math.ceil(samples.length * keepFrac)
  let changed = true
  while (changed && heads.length > 3) {
    changed = false
    let drop = -1
    let dropScore = Infinity
    for (let i = 0; i < heads.length; i++) {
      const ri = heads[i].radiusM
      for (let j = i + 1; j < heads.length; j++) {
        const rj = heads[j].radiusM
        if (dist(heads[i].point, heads[j].point) >= 0.6 * Math.min(ri, rj) * ppm) continue
        const dropI = isCorner(heads[i]) ? j : isCorner(heads[j]) ? i : uniqueOf(i) <= uniqueOf(j) ? i : j
        if (isCorner(heads[dropI]) && isCorner(heads[dropI === i ? j : i])) continue
        const unique = uniqueOf(dropI)
        if (unique < dropScore) {
          dropScore = unique
          drop = dropI
        }
      }
    }
    if (drop < 0) {
      const totalW = weights.reduce((sum, w) => sum + w, 0)
      for (let i = 0; i < heads.length; i++) {
        if (isCorner(heads[i])) continue
        const unique = uniqueOf(i)
        if (unique < dropScore) {
          dropScore = unique
          drop = i
        }
      }
      if (drop >= 0 && dropScore > Math.max(3.2, totalW * 0.03)) drop = -1
    }
    if (drop < 0) break
    const kept = heads.filter((_, i) => i !== drop)
    if (coveredCount(kept, samples, ppm) < minCover && dropScore > 0.4) break
    heads.splice(drop, 1)
    changed = true
  }
}

function sampleWeights(samples: Point[], rings: Point[][], ppm: number): Float64Array {
  const weights = new Float64Array(samples.length)
  const edge = 1.15 * ppm
  for (let i = 0; i < samples.length; i++) {
    let cl = Infinity
    for (const ring of rings) cl = Math.min(cl, distanceToRing(samples[i], ring))
    weights[i] = 1 + 1.6 * Math.max(0, 1 - cl / edge)
  }
  return weights
}

function applyMask(covered: Uint8Array, mask: Uint8Array): void {
  for (let i = 0; i < covered.length; i++) {
    if (mask[i]) covered[i] = 1
  }
}

function maxThrowRoom(point: Point, ppm: number, inside: (sample: Point) => boolean): number {
  let best = 0
  for (let i = 0; i < 16; i++) {
    const bearingDeg = (i / 16) * 360
    let reach = 0
    for (let s = 0.35 * ppm; s <= 12 * ppm; s += 0.45 * ppm) {
      if (!inside(polar(point, s, bearingDeg))) break
      reach = s
    }
    best = Math.max(best, reach)
  }
  return best / ppm
}

function headCovers(head: SpraySpot, sample: Point, ppm: number, frac = 1.02): boolean {
  const nozzle = nozzleById(head.nozzleId)
  if (dist(head.point, sample) > head.radiusM * ppm * frac) return false
  if (nozzle.arcDeg >= 359) return true
  let delta = bearing(head.point, sample) - head.rotationDeg
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return Math.abs(delta) <= nozzle.arcDeg / 2 + 5
}

function longestRun(flags: boolean[]): { start: number; len: number } {
  const n = flags.length
  if (n === 0) return { start: 0, len: 0 }
  if (flags.every(Boolean)) return { start: 0, len: n }
  const ext = flags.concat(flags)
  let bestStart = 0
  let bestLen = 0
  let i = 0
  while (i < ext.length) {
    if (!ext[i]) {
      i += 1
      continue
    }
    let j = i
    while (j < ext.length && ext[j]) j += 1
    const len = Math.min(j - i, n)
    if (len > bestLen && i < n) {
      bestLen = len
      bestStart = i
    }
    i = j
  }
  return { start: bestStart, len: bestLen }
}

function lawnAt(point: Point, outer: Point[], holes: Point[][]): boolean {
  if (!pointInPolygon(point, outer)) return false
  return holes.every((hole) => !pointInPolygon(point, hole))
}

function nudgeInside(point: Point, dir: Point, inset: number, inside: (point: Point) => boolean): Point {
  const len = Math.hypot(dir.x, dir.y)
  const ux = len > 1e-6 ? dir.x / len : 0
  const uy = len > 1e-6 ? dir.y / len : 0
  for (const scale of [1, 0.55, 1.7, 0.28, 0]) {
    const next = { x: point.x + ux * inset * scale, y: point.y + uy * inset * scale }
    if (inside(next)) return next
  }
  return point
}

function leftOf(a: Point, b: Point): Point {
  return { x: -(b.y - a.y), y: b.x - a.x }
}

function leftNormal(prev: Point, cur: Point, next: Point): Point {
  const a = leftOf(prev, cur)
  const b = leftOf(cur, next)
  const n = { x: a.x + b.x, y: a.y + b.y }
  if (Math.hypot(n.x, n.y) < 1e-6) return a
  return n
}

function turnAngle(prev: Point, cur: Point, next: Point): number {
  const a = Math.atan2(cur.y - prev.y, cur.x - prev.x)
  const b = Math.atan2(next.y - cur.y, next.x - cur.x)
  let turn = b - a
  while (turn > Math.PI) turn -= Math.PI * 2
  while (turn < -Math.PI) turn += Math.PI * 2
  return turn
}

function sampleLawn(outer: Point[], holes: Point[][], ppm: number, stepM: number): Point[] {
  const step = stepM * ppm
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
  const samples: Point[] = []
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const point = { x, y }
      if (lawnAt(point, outer, holes)) samples.push(point)
    }
  }
  return samples
}

function spansOf(points: Point[], ppm: number): { minSpan: number; maxSpan: number; angle: number; mid: Point } {
  const angle = principal(points)
  const mid = centroid(points)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const point of points) {
    const u = (point.x - mid.x) * c + (point.y - mid.y) * s
    const v = -(point.x - mid.x) * s + (point.y - mid.y) * c
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const spanU = (maxU - minU) / ppm
  const spanV = (maxV - minV) / ppm
  return { minSpan: Math.min(spanU, spanV), maxSpan: Math.max(spanU, spanV), angle, mid }
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

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function distanceToRing(point: Point, ring: Point[]): number {
  if (ring.length < 2) return Infinity
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

function bearing(from: Point, to: Point): number {
  return ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360
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
  const keep = douglas(points, tol)
  return keep.length >= 3 ? keep : points
}

function douglas(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points
  let maxD = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegmentDistance(points[i], first, last)
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
