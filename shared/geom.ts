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

/** 0° смотрит вверх, угол растёт по часовой. */
export function polar(origin: Point, radius: number, bearingDeg: number): Point {
  const rad = (bearingDeg * Math.PI) / 180
  return {
    x: origin.x + radius * Math.sin(rad),
    y: origin.y - radius * Math.cos(rad),
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
