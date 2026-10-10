import { dripMeasure } from './analyze.ts'
import { V_MAX } from './pipes.ts'
import type { Drip, FittingKind, Point, SegmentResult } from './types.ts'

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

export type FlowArrow = { x: number; y: number; rotationDeg: number }

/** Стрелка по ходу воды, ближе к концу участка. Без расхода и на коротком участке её нет. */
export function flowArrows(segments: SegmentResult[], ppm: number | null, k: number): FlowArrow[] {
  const minPx = ppm && ppm > 0 ? 0.55 * ppm : 36
  const arrows: FlowArrow[] = []
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.downB === undefined) continue
    if (!(segment.flowLph && segment.flowLph > 0)) continue
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const len = Math.hypot(dx, dy)
    if (len < minPx) continue
    const ux = dx / len
    const uy = dy / len
    const dirx = segment.downB ? ux : -ux
    const diry = segment.downB ? uy : -uy
    const t = 0.62
    arrows.push({
      x: segment.a.x + dx * t,
      y: segment.a.y + dy * t,
      rotationDeg: Math.round((Math.atan2(dirx, -diry) * 180) / Math.PI * 10) / 10,
    })
  }
  return arrows
}

/** Подпись диаметра и длины у середины участка, сбоку от линии и текстом вверх. */
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
    const metres = segment.lengthM === null
      ? ''
      : ` · ${segment.lengthM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м`
    tags.push({
      text: `Ø${segment.odMm}${metres}`,
      x: (segment.a.x + segment.b.x) / 2 + nx * gap,
      y: (segment.a.y + segment.b.y) / 2 + ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}

export type SpeedTag = { text: string; x: number; y: number; rotate: number; hot: boolean }

/** Скорость с другой стороны от диаметра. Выше 1,5 м/с подпись горячая. Нулевой и короткий участок молчат. */
export function speedTags(segments: SegmentResult[], ppm: number | null, k: number): SpeedTag[] {
  const minPx = ppm && ppm > 0 ? 0.55 * ppm : 36
  const gap = 8 / Math.max(k, 0.05)
  const tags: SpeedTag[] = []
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.velocity === null || !(segment.velocity > 0)) continue
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const len = Math.hypot(dx, dy)
    if (len < minPx) continue
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / len
    const ny = dx / len
    tags.push({
      text: `${segment.velocity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м/с`,
      x: (segment.a.x + segment.b.x) / 2 - nx * gap,
      y: (segment.a.y + segment.b.y) / 2 - ny * gap,
      rotate: Math.round(deg * 10) / 10,
      hot: segment.velocity > V_MAX,
    })
  }
  return tags
}

export type LossTag = { text: string; x: number; y: number; rotate: number }

/** Потери напора дальше диаметра, с той же стороны. Без потерь и на коротком участке подписи нет. */
export function lossTags(segments: SegmentResult[], ppm: number | null, k: number): LossTag[] {
  const minPx = ppm && ppm > 0 ? 0.55 * ppm : 36
  const gap = 22 / Math.max(k, 0.05)
  const tags: LossTag[] = []
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.headLossM === null || !(segment.headLossM > 0)) continue
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const len = Math.hypot(dx, dy)
    if (len < minPx) continue
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / len
    const ny = dx / len
    tags.push({
      text: `потери ${segment.headLossM.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м`,
      x: (segment.a.x + segment.b.x) / 2 + nx * gap,
      y: (segment.a.y + segment.b.y) / 2 + ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}

/** Длина капельной линии у её самого длинного звена. Без масштаба подписи нет. */
export function dripTags(lines: { points: Point[] }[], ppm: number | null, k: number): PipeTag[] {
  if (!ppm || ppm <= 0) return []
  const minPx = 0.55 * ppm
  const gap = 8 / Math.max(k, 0.05)
  const tags: PipeTag[] = []
  for (const line of lines) {
    let total = 0
    let best: { a: Point; b: Point; len: number } | null = null
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1]
      const b = line.points[i]
      if (!a || !b) continue
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      total += len
      if (!best || len > best.len) best = { a, b, len }
    }
    if (!best || total < minPx) continue
    const dx = best.b.x - best.a.x
    const dy = best.b.y - best.a.y
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / best.len
    const ny = dx / best.len
    const lengthM = total / ppm
    tags.push({
      text: `${lengthM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м`,
      x: (best.a.x + best.b.x) / 2 + nx * gap,
      y: (best.a.y + best.b.y) / 2 + ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}

/** Капельницы и их расход с другой стороны от длины. Голая трубка и короткая линия молчат. */
export function dripFlowTags(lines: Drip[], ppm: number | null, k: number): PipeTag[] {
  if (!ppm || ppm <= 0) return []
  const minPx = 0.55 * ppm
  const gap = 8 / Math.max(k, 0.05)
  const tags: PipeTag[] = []
  for (const line of lines) {
    const measured = dripMeasure(line, ppm)
    if (!(measured.emitters > 0)) continue
    let total = 0
    let best: { a: Point; b: Point; len: number } | null = null
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1]
      const b = line.points[i]
      if (!a || !b) continue
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      total += len
      if (!best || len > best.len) best = { a, b, len }
    }
    if (!best || total < minPx) continue
    const dx = best.b.x - best.a.x
    const dy = best.b.y - best.a.y
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / best.len
    const ny = dx / best.len
    tags.push({
      text: `${measured.emitters.toLocaleString('ru-RU')} шт · ${Math.round(measured.flowLph).toLocaleString('ru-RU')} л/ч`,
      x: (best.a.x + best.b.x) / 2 - nx * gap,
      y: (best.a.y + best.b.y) / 2 - ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}

/** Длина гильзы у её середины. Без масштаба и короче 0,55 м подписи нет. */
export function sleeveTags(sleeves: { a: Point; b: Point }[], ppm: number | null, k: number): PipeTag[] {
  if (!ppm || ppm <= 0) return []
  const minPx = 0.55 * ppm
  const gap = 8 / Math.max(k, 0.05)
  const tags: PipeTag[] = []
  for (const sleeve of sleeves) {
    const dx = sleeve.b.x - sleeve.a.x
    const dy = sleeve.b.y - sleeve.a.y
    const len = Math.hypot(dx, dy)
    if (len < minPx) continue
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const nx = -dy / len
    const ny = dx / len
    const lengthM = len / ppm
    tags.push({
      text: `${lengthM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м`,
      x: (sleeve.a.x + sleeve.b.x) / 2 + nx * gap,
      y: (sleeve.a.y + sleeve.b.y) / 2 + ny * gap,
      rotate: Math.round(deg * 10) / 10,
    })
  }
  return tags
}

export type FittingShape = {
  lines: { x1: number; y1: number; x2: number; y2: number }[]
  /** Радиус кружка. Пусто — кружка нет. */
  dot: number | null
  poly: Point[] | null
}

/** Знак фитинга в местных координатах. Верх смотрит по rotationDeg. */
export function fittingShape(kind: FittingKind, k: number): FittingShape {
  const r = 6 / Math.max(k, 0.05)
  if (kind === 'cap') return { lines: [{ x1: -r, y1: 0, x2: r, y2: 0 }], dot: null, poly: null }
  if (kind === 'elbow') {
    const s = Math.sin((42 * Math.PI) / 180) * r
    const c = Math.cos((42 * Math.PI) / 180) * r
    return {
      lines: [
        { x1: 0, y1: 0, x2: s, y2: -c },
        { x1: 0, y1: 0, x2: -s, y2: -c },
      ],
      dot: null,
      poly: null,
    }
  }
  if (kind === 'reducer') {
    return { lines: [], dot: null, poly: [{ x: 0, y: -r }, { x: r * 0.65, y: r * 0.5 }, { x: -r * 0.65, y: r * 0.5 }] }
  }
  if (kind === 'tee') return { lines: [], dot: r * 0.45, poly: null }
  if (kind === 'cross') {
    return {
      lines: [
        { x1: -r, y1: 0, x2: r, y2: 0 },
        { x1: 0, y1: -r, x2: 0, y2: r },
      ],
      dot: null,
      poly: null,
    }
  }
  return { lines: [], dot: r * 0.55, poly: null }
}
