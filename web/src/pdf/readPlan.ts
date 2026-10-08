import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { layoutPlan, pxPerMeterFromPage, scaleBarPxPerMeter, segmentRole, sheetScaleRatio, type InkSeg, type Rgb } from '../../../shared/plan.ts'
import type { Doc, Point } from '../../../shared/types.ts'

export type ReadPlan = {
  png: string
  width: number
  height: number
  doc: Doc | null
  note: string
}

export function configurePdfWorker(src: string) {
  GlobalWorkerOptions.workerSrc = src
}

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number; convertToViewportPoint: (x: number, y: number) => [number, number] }
  getTextContent: () => Promise<{ items: { str?: string }[] }>
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
}

export async function renderPlanPdf(data: ArrayBuffer): Promise<{ png: string; width: number; height: number }> {
  const pdf = await openPdf(data)
  try {
    const page = (await pdf.getPage(1)) as unknown as PdfPage
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(1.7, 1600 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const png = await renderPng(page, viewport)
    return { png, width: Math.round(viewport.width), height: Math.round(viewport.height) }
  } finally {
    await pdf.destroy()
  }
}

export async function readPlanPdf(data: ArrayBuffer): Promise<ReadPlan> {
  const pdf = await openPdf(data)
  try {
    const page = (await pdf.getPage(1)) as unknown as PdfPage
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(1.7, 1600 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const described = await describe(page, viewport, base.width)
    const png = await renderPng(page, viewport)
    return { png, width: Math.round(viewport.width), height: Math.round(viewport.height), doc: described.doc, note: described.note }
  } finally {
    await pdf.destroy()
  }
}

/** То же чтение без картинки: для проверки листа в Node. */
export async function describePlan(data: Uint8Array): Promise<{ doc: Doc | null; note: string; width: number; height: number }> {
  const pdf = await openPdf(data)
  try {
    const page = (await pdf.getPage(1)) as unknown as PdfPage
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(1.7, 1600 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const described = await describe(page, viewport, base.width)
    return { ...described, width: viewport.width, height: viewport.height }
  } finally {
    await pdf.destroy()
  }
}

async function openPdf(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return getDocument({ data: bytes, useSystemFonts: true }).promise
}

async function describe(page: PdfPage, viewport: ReturnType<PdfPage['getViewport']>, pageWidthPt: number) {
  const text = await page.getTextContent()
  const ratio = sheetScaleRatio(text.items.map((item) => item.str ?? '').join('\n'))
  const pxPerMeter = ratio
    ? pxPerMeterFromPage(viewport.width, pageWidthPt, ratio)
    : await readScaleBar(page, viewport)
  const scaleLabel = ratio ? `Масштаб 1:${ratio}.` : pxPerMeter ? 'Масштаб с линейки на листе.' : ''
  if (!pxPerMeter) {
    return { doc: null, note: 'На листе нет подписи масштаба. Подложка поставлена, длины по ней ещё не посчитаны.' }
  }
  const segments = await inkSegments(page, viewport, pxPerMeter)
  const doc = layoutPlan({ width: viewport.width, height: viewport.height, pxPerMeter }, segments)
  if (!doc) {
    return { doc: null, note: `${scaleLabel} Участок на листе не выделился, подложка поставлена.`.trim() }
  }
  const lawns = doc.zones.filter((zone) => zone.kind === 'lawn').length
  const beds = doc.zones.filter((zone) => zone.kind === 'bed').length
  const note = [
    scaleLabel,
    lawns ? `Газонов: ${lawns}.` : '',
    beds ? `Клумб: ${beds}.` : '',
    `Дождевателей: ${doc.sprinklers.length}.`,
    'Источник стоит у границы участка — перетащите его к вводу воды.',
  ].filter(Boolean).join(' ')
  return { doc, note }
}

async function readScaleBar(page: PdfPage, viewport: ReturnType<PdfPage['getViewport']>): Promise<number | null> {
  const op = await page.getOperatorList()
  const paint = new Set([OPS.stroke, OPS.closeStroke])
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: { ctm: number[]; stroke: Rgb }[] = []
  let stroke: Rgb = [0, 0, 0]
  const dark = (rgb: Rgb) => rgb.every((value) => (value > 1 ? value / 255 : value) < 0.35)
  const mapPoint = (x: number, y: number): Point => {
    const px = ctm[0] * x + ctm[2] * y + ctm[4]
    const py = ctm[1] * x + ctm[3] * y + ctm[5]
    const [vx, vy] = viewport.convertToViewportPoint(px, py)
    return { x: vx, y: vy }
  }
  const strokes: { a: Point; b: Point }[] = []
  for (let i = 0; i < op.fnArray.length; i++) {
    const fn = op.fnArray[i]
    const args = op.argsArray[i] as number[] | undefined
    if (fn === OPS.save) stack.push({ ctm: ctm.slice(), stroke: [...stroke] })
    else if (fn === OPS.restore) {
      const prev = stack.pop()
      if (prev) { ctm = prev.ctm; stroke = prev.stroke }
    } else if (fn === OPS.transform && args) {
      const [a, b, c, d, e, f] = ctm
      const [a2, b2, c2, d2, e2, f2] = args
      ctm = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]
    } else if (fn === OPS.setStrokeRGBColor && args) stroke = norm(args)
    else if (fn === OPS.setStrokeGray && args) stroke = gray(args[0])
    else if (fn === OPS.constructPath && Array.isArray(args) && dark(stroke)) {
      let k = i + 1
      while (k < op.fnArray.length && !paint.has(op.fnArray[k]) && op.fnArray[k] !== OPS.constructPath) k++
      if (!paint.has(op.fnArray[k])) continue
      const [ops, coords] = args as unknown as [number[], number[]]
      for (const points of subpathPoints(ops, coords, mapPoint)) {
        for (let p = 1; p < points.length; p++) strokes.push({ a: points[p - 1], b: points[p] })
      }
    }
  }
  return scaleBarPxPerMeter(strokes)
}

async function renderPng(page: PdfPage, viewport: { width: number; height: number }): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось нарисовать лист')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}

async function inkSegments(page: PdfPage, viewport: ReturnType<PdfPage['getViewport']>, pxPerMeter: number): Promise<InkSeg[]> {
  const op = await page.getOperatorList()
  let fill: Rgb = [0, 0, 0]
  let stroke: Rgb = [0, 0, 0]
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: { ctm: number[]; fill: Rgb; stroke: Rgb }[] = []
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const segments: InkSeg[] = []

  const apply = (m: number[]) => {
    const [a, b, c, d, e, f] = ctm
    const [a2, b2, c2, d2, e2, f2] = m
    ctm = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]
  }
  const mapPoint = (x: number, y: number): Point => {
    const px = ctm[0] * x + ctm[2] * y + ctm[4]
    const py = ctm[1] * x + ctm[3] * y + ctm[5]
    const [vx, vy] = viewport.convertToViewportPoint(px, py)
    return { x: vx, y: vy }
  }

  for (let i = 0; i < op.fnArray.length; i++) {
    const fn = op.fnArray[i]
    const args = op.argsArray[i] as number[] | undefined
    if (fn === OPS.save) stack.push({ ctm: ctm.slice(), fill: [...fill], stroke: [...stroke] })
    else if (fn === OPS.restore) {
      const prev = stack.pop()
      if (prev) { ctm = prev.ctm; fill = prev.fill; stroke = prev.stroke }
    } else if (fn === OPS.transform && args) apply(args)
    else if (fn === OPS.setFillRGBColor && args) fill = norm(args)
    else if (fn === OPS.setStrokeRGBColor && args) stroke = norm(args)
    else if (fn === OPS.setFillGray && args) fill = gray(args[0])
    else if (fn === OPS.setStrokeGray && args) stroke = gray(args[0])
    else if (fn === OPS.constructPath && Array.isArray(args)) {
      const [ops, coords] = args as unknown as [number[], number[]]
      const subpaths = subpathPoints(ops, coords, mapPoint)
      let k = i + 1
      while (k < op.fnArray.length && !paint.has(op.fnArray[k]) && op.fnArray[k] !== OPS.constructPath) k++
      if (!paint.has(op.fnArray[k])) continue
      const kind = op.fnArray[k]
      const color = kind === OPS.stroke || kind === OPS.closeStroke ? stroke : colorful(fill) ? fill : stroke
      const close = kind === OPS.closeStroke || kind === OPS.closeFillStroke || kind === OPS.closeEOFillStroke
      for (const points of subpaths) {
        const ring = close && points.length > 2 ? [...points, points[0]] : points
        for (let p = 1; p < ring.length; p++) {
          const role = segmentRole(ring[p - 1], ring[p], color, pxPerMeter)
          if (role) segments.push({ a: ring[p - 1], b: ring[p], role })
        }
      }
    }
  }
  return segments
}

function subpathPoints(ops: number[], coords: number[], mapPoint: (x: number, y: number) => Point): Point[][] {
  const paths: Point[][] = []
  let current: Point[] = []
  let j = 0
  const push = (x: number, y: number) => {
    const point = mapPoint(x, y)
    current.push(point)
  }
  for (const code of ops) {
    if (code === OPS.moveTo) {
      if (current.length > 1) paths.push(current)
      current = []
      push(coords[j], coords[j + 1])
      j += 2
    } else if (code === OPS.lineTo) {
      push(coords[j], coords[j + 1])
      j += 2
    } else if (code === OPS.curveTo) {
      push(coords[j + 4], coords[j + 5])
      j += 6
    } else if (code === OPS.curveTo2 || code === OPS.curveTo3) {
      push(coords[j + 2], coords[j + 3])
      j += 4
    } else if (code === OPS.rectangle) {
      const x = coords[j]
      const y = coords[j + 1]
      const w = coords[j + 2]
      const h = coords[j + 3]
      if (current.length > 1) paths.push(current)
      current = [mapPoint(x, y), mapPoint(x + w, y), mapPoint(x + w, y + h), mapPoint(x, y + h), mapPoint(x, y)]
      paths.push(current)
      current = []
      j += 4
    }
  }
  if (current.length > 1) paths.push(current)
  return paths
}

function norm(args: number[]): Rgb {
  const scale = args[0] > 1 || args[1] > 1 || args[2] > 1 ? 255 : 1
  return [args[0] / scale, args[1] / scale, args[2] / scale]
}

function gray(value: number): Rgb {
  const channel = value > 1 ? value / 255 : value
  return [channel, channel, channel]
}

function colorful(rgb: Rgb): boolean {
  return Math.max(...rgb) - Math.min(...rgb) > 0.08
}
