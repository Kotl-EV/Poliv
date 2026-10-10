import type { Point, SegmentResult } from './types.ts'

/** Волна от конца трубы до головки. Концы совпадают с точками. */
export function funnyPoints(a: Point, b: Point): Point[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const amp = Math.min(len * 0.22, 7)
  const humps = 3
  const steps = humps * 6
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const wave = Math.sin(t * Math.PI * humps) * amp * Math.sin(t * Math.PI)
    points.push({ x: a.x + dx * t + nx * wave, y: a.y + dy * t + ny * wave })
  }
  return points
}

export type PipeTag = { text: string; x: number; y: number; rotate: number }

/** Подпись диаметра у середины участка, сбоку от линии и текстом вверх. */
export function pipeTags(segments: SegmentResult[], ppm: number | null, k: number): PipeTag[] {
  const minPx = ppm && ppm > 0 ? 0.55 * ppm : 36
  const gap = 8 / Math.max(k, 0.05)
  const tags: PipeTag[] = []
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.odMm === null) continue
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const len = Math.hypot(dx, dy)
    if (len < minPx) continue
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / len
    const ny = dx / len
    tags.push({
      text: `Ø${segment.odMm}`,
      x: (segment.a.x + segment.b.x) / 2 + nx * gap,
      y: (segment.a.y + segment.b.y) / 2 + ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}
