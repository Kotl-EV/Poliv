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

/** Короче этого прямая без подписи: маленький кусок трубы молчит. */
const PIPE_TAG_MIN_M = 4

/** Подпись диаметра и длины у середины длинной прямой. Короткие куски одной прямой делят одну подпись. */
export function pipeTags(segments: SegmentResult[], ppm: number | null, k: number): PipeTag[] {
  const minPx = ppm && ppm > 0 ? PIPE_TAG_MIN_M * ppm : 36
  const gap = 8 / Math.max(k, 0.05)
  const tags: PipeTag[] = []
  for (const run of straightRuns(segments)) {
    const px = run.reduce((sum, segment) => sum + Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y), 0)
    if (px < minPx) continue
    const od = run[0]?.odMm
    if (od === null || od === undefined) continue
    const lengthM = runMetres(run)
    const metres = lengthM === null ? '' : ` · ${lengthM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м`
    const text = `Ø${od}${metres}`
    if (!captionFits(px, text, k)) continue
    const spot = runSpot(run, px / 2)
    if (!spot) continue
    tags.push({
      text,
      x: spot.x + spot.nx * gap,
      y: spot.y + spot.ny * gap,
      rotate: spot.rotate,
    })
  }
  return tags
}

/** Текст шире участка не ставим: на листе он закрыл бы соседние трубы. */
function captionFits(len: number, text: string, k: number): boolean {
  const font = 11 / Math.max(k, 0.05)
  return len >= text.length * font * 0.58
}

function runMetres(run: SegmentResult[]): number | null {
  if (run.some((segment) => segment.lengthM === null)) return null
  return run.reduce((sum, segment) => sum + (segment.lengthM ?? 0), 0)
}

function runSpot(run: SegmentResult[], at: number): { x: number; y: number; nx: number; ny: number; rotate: number } | null {
  let remain = at
  for (const segment of run) {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    if (remain > len && segment !== run[run.length - 1]) {
      remain -= len
      continue
    }
    const t = Math.min(1, Math.max(0, remain / len))
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    return {
      x: segment.a.x + dx * t,
      y: segment.a.y + dy * t,
      nx: -dy / len,
      ny: dx / len,
      rotate: Math.round(deg * 10) / 10,
    }
  }
  return null
}

/** Прямая одного диаметра. Поворот больше 15° начинает новую подпись, прямой ход идёт сквозь тройник. */
function straightRuns(segments: SegmentResult[]): SegmentResult[][] {
  const usable = segments.filter((segment) => {
    if (segment.status !== 'ok' || segment.odMm === null) return false
    return Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) > 0.5
  })
  const keyOf = (point: Point) => `${Math.round(point.x)}:${Math.round(point.y)}`
  const at = new Map<string, number[]>()
  usable.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const key = keyOf(point)
      const list = at.get(key) ?? []
      list.push(index)
      at.set(key, list)
    }
  })
  const used = new Set<number>()
  const runs: SegmentResult[][] = []
  const cos15 = Math.cos((15 * Math.PI) / 180)
  for (let index = 0; index < usable.length; index++) {
    if (used.has(index)) continue
    used.add(index)
    const run = [usable[index]]
    grow(run, true)
    grow(run, false)
    runs.push(run)
  }
  return runs

  function grow(run: SegmentResult[], forward: boolean) {
    while (run.length) {
      const tip = forward ? run[run.length - 1] : run[0]
      const from = forward ? tip.b : tip.a
      const back = forward ? tip.a : tip.b
      const dir = unit(from.x - back.x, from.y - back.y)
      if (!dir) return
      const nexts = (at.get(keyOf(from)) ?? []).filter((item) => !used.has(item))
      let pick: number | null = null
      let jointIsA = false
      for (const item of nexts) {
        const cand = usable[item]
        if (cand.odMm !== tip.odMm) continue
        const atA = keyOf(cand.a) === keyOf(from)
        const far = atA ? cand.b : cand.a
        const step = unit(far.x - from.x, far.y - from.y)
        if (!step || dir.x * step.x + dir.y * step.y < cos15) continue
        if (pick !== null) return
        pick = item
        jointIsA = atA
      }
      if (pick === null) return
      const cand = usable[pick]
      used.add(pick)
      const ordered = jointIsA ? cand : { ...cand, a: cand.b, b: cand.a }
      if (forward) run.push(ordered)
      else run.unshift(ordered)
    }
  }
}

function unit(x: number, y: number): { x: number; y: number } | null {
  const len = Math.hypot(x, y)
  if (len < 1e-6) return null
  return { x: x / len, y: y / len }
}

export type SpeedTag = { text: string; x: number; y: number; rotate: number; hot: boolean }

/** Скорость с другой стороны от диаметра, только быстрее 1,5 м/с. Спокойный, нулевой и короткий участок молчат. */
export function speedTags(segments: SegmentResult[], ppm: number | null, k: number): SpeedTag[] {
  const minPx = ppm && ppm > 0 ? 0.55 * ppm : 36
  const gap = 8 / Math.max(k, 0.05)
  const tags: SpeedTag[] = []
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.velocity === null || !(segment.velocity > V_MAX)) continue
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
