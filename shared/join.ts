import { closestOnSegment, dist } from './geom.ts'
import type { Doc, PipeRole, Point, Sprinkler } from './types.ts'

/** мм/ч: расход делим на площадь сектора. */
export function headPrecipMmH(head: Pick<Sprinkler, 'radiusM' | 'arcDeg' | 'flowLph'>): number {
  const arc = Math.min(360, Math.max(0, head.arcDeg))
  const area = Math.PI * head.radiusM * head.radiusM * (arc / 360)
  if (!(area > 0)) return 0
  return head.flowLph / area
}

export function pointOnPipes(point: Point, pipes: { points: Point[] }[], snap: number): boolean {
  for (const pipe of pipes) {
    for (let i = 1; i < pipe.points.length; i++) {
      if (closestOnSegment(point, pipe.points[i - 1], pipe.points[i]).distance <= snap) return true
    }
  }
  return false
}

/** Свободные дождеватели. После первого на линии остаются только близкие по осадкам. */
export function joinableHeads(doc: Doc, draft: Point[], snap: number): Sprinkler[] {
  const loose = doc.sprinklers.filter((head) => !pointOnPipes(head, doc.pipes, snap))
  const taken = loose.filter((head) => draft.some((point) => dist(point, head) <= snap))
  const seed = taken[0]
  if (!seed) return loose
  const rate = headPrecipMmH(seed)
  return loose.filter((head) => {
    if (head.id === seed.id) return true
    const next = headPrecipMmH(head)
    if (!(rate > 0) || !(next > 0)) return head.nozzleId === seed.nozzleId
    return Math.abs(next - rate) / rate <= 0.2
  })
}

export function draftHeadFlow(doc: Doc, draft: Point[], snap: number): number {
  let flow = 0
  for (const head of doc.sprinklers) {
    if (draft.some((point) => dist(point, head) <= snap)) flow += head.flowLph
  }
  return flow
}

/** Ближняя точка источника, бокса, клапана, гидранта или подходящего дождевателя. */
export function stickTarget(doc: Doc, raw: Point, role: PipeRole, draft: Point[], snap: number): (Point & { valveId?: string }) | null {
  const best: { current: { point: Point; distance: number; valveId?: string } | null } = { current: null }
  const consider = (point: Point, valveId?: string) => {
    const distance = dist(raw, point)
    if (distance > snap) return
    if (!best.current || distance < best.current.distance) best.current = { point, distance, valveId }
  }
  if (doc.source) consider(doc.source)
  for (const box of doc.boxes ?? []) consider(box)
  for (const valve of doc.valves) consider(valve, valve.id)
  for (const hydrant of doc.hydrants ?? []) consider(hydrant)
  if (role === 'zone') {
    for (const head of joinableHeads(doc, draft, snap)) consider(head)
  }
  const found = best.current
  if (!found) return null
  return { x: found.point.x, y: found.point.y, ...(found.valveId ? { valveId: found.valveId } : {}) }
}

export function sleeveLengthM(sleeves: { a: Point; b: Point }[], ppm: number | null): number | null {
  if (!ppm || ppm <= 0) return null
  let length = 0
  for (const sleeve of sleeves) length += dist(sleeve.a, sleeve.b)
  return length / ppm
}

const SLOTS = [
  { x: 0, y: 6 },
  { x: -8, y: 6 },
  { x: 8, y: 6 },
  { x: -8, y: -4 },
  { x: 8, y: -4 },
  { x: 0, y: -4 },
]

export function valveSlot(box: Point, index: number): Point {
  const slot = SLOTS[index % SLOTS.length]
  const ring = Math.floor(index / SLOTS.length)
  return { x: box.x + slot.x, y: box.y + slot.y + ring * 10 }
}
