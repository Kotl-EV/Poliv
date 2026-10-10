import { stationInk, stationNo } from './analyze.ts'
import { emitterPoints } from './drip.ts'
import { fixtureMarkup } from './fixtures.ts'
import { plantMarkup } from './plants.ts'
import { gridStepM, precipWash, surfaceOf, SURFACES, DEFAULT_PPM, DEFAULT_SHEET_M, hatchOf, hatchPatternMarkup, HATCHES } from './landscape.ts'
import { centroid, coverPath, noteLeader, pointInZone, zoneShapeD } from './geom.ts'
import { headCaption, nozzleById } from './nozzles.ts'
import { programTable, runtimeLabel } from './program.ts'
import { gearHint, gearList } from './gear.ts'
import { sleeveLengthM } from './join.ts'
import { dripFlowTags, dripTags, fittingShape, flowArrows, funnyPoints, lossTags, pipeTags, sleeveTags, speedTags } from './pipeview.ts'
import { pipeWeight, pressureLabel, sourceLabel, valveFlowLabel } from './pipes.ts'
import type { Analysis, Doc, FittingMark, Plant, Point } from './types.ts'

export const SHEET_DPI = 150

export type PaperId = 'a4' | 'a3'

export type SheetLayers = {
  underlay: boolean
  grid: boolean
  landscape: boolean
  /** Имя зоны в её середине. */
  names: boolean
  /** Площадь зоны в её середине. */
  area: boolean
  spray: boolean
  pipes: boolean
  drip: boolean
  fittings: boolean
  /** Радиусы дождевателей. Пусто в старом снимке значит включены. */
  cover: boolean
  precip: boolean
  /** Минуты и циклы на зоне и на клапане. */
  runtime: boolean
  headInfo: boolean
  /** Лист без штриховок, чёрными линиями. */
  draft: boolean
}

export const DEFAULT_SHEET_LAYERS: SheetLayers = {
  underlay: true,
  grid: true,
  landscape: true,
  names: false,
  area: false,
  spray: true,
  pipes: true,
  drip: true,
  fittings: true,
  cover: true,
  precip: false,
  runtime: false,
  headInfo: false,
  draft: false,
}

export const PAPERS: { id: PaperId; name: string; wMm: number; hMm: number }[] = [
  { id: 'a4', name: 'A4 альбом', wMm: 297, hMm: 210 },
  { id: 'a3', name: 'A3 альбом', wMm: 420, hMm: 297 },
]

export type SheetPage = {
  name: string
  svg: string
  widthPx: number
  heightPx: number
  widthPt: number
  heightPt: number
}

export type SheetOpts = {
  title: string
  date?: string
  paper?: PaperId
  layers?: Partial<SheetLayers>
  underlay?: { href: string; w: number; h: number } | null
  includeSpec?: boolean
}

export function paperOf(id: PaperId = 'a4'): { id: PaperId; name: string; wMm: number; hMm: number } {
  return PAPERS.find((item) => item.id === id) ?? PAPERS[0]
}

export function mmToPx(mm: number, dpi = SHEET_DPI): number {
  return Math.round((mm * dpi) / 25.4)
}

export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4
}

export function contentBounds(doc: Doc, underlay?: { w: number; h: number } | null): { minX: number; minY: number; maxX: number; maxY: number } {
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const push = (point: Point) => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (underlay) {
    push({ x: 0, y: 0 })
    push({ x: underlay.w, y: underlay.h })
  }
  for (const zone of doc.zones) for (const point of zone.points) push(point)
  for (const pipe of doc.pipes) for (const point of pipe.points) push(point)
  for (const drip of doc.drips) for (const point of drip.points) push(point)
  for (const head of doc.sprinklers) {
    const r = (head.radiusM || 0) * ppm
    push(head)
    push({ x: head.x - r, y: head.y - r })
    push({ x: head.x + r, y: head.y + r })
  }
  for (const valve of doc.valves) push(valve)
  for (const box of doc.boxes ?? []) push(box)
  for (const hydrant of doc.hydrants ?? []) push(hydrant)
  for (const sleeve of doc.sleeves ?? []) {
    push(sleeve.a)
    push(sleeve.b)
  }
  for (const note of doc.notes ?? []) {
    push(note)
    if (note.leader) push(note.leader)
  }
  for (const plant of doc.plants ?? []) {
    const r = plant.radiusM * ppm
    push(plant)
    push({ x: plant.x - r, y: plant.y - r })
    push({ x: plant.x + r, y: plant.y + r })
  }
  for (const fixture of doc.fixtures ?? []) {
    const r = fixture.radiusM * ppm
    push(fixture)
    push({ x: fixture.x - r, y: fixture.y - r })
    push({ x: fixture.x + r, y: fixture.y + r })
  }
  for (const measure of doc.measures ?? []) {
    push(measure.a)
    push(measure.b)
  }
  if (doc.source) push(doc.source)
  if (doc.anchor) push(doc.anchor)
  if (!Number.isFinite(minX)) {
    const sheet = doc.sheetM ?? DEFAULT_SHEET_M
    return { minX: 0, minY: 0, maxX: sheet.w * ppm, maxY: sheet.h * ppm }
  }
  const pad = 0.8 * ppm
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export function buildSheetPages(doc: Doc, analysis: Analysis, opts: SheetOpts): SheetPage[] {
  const layers = { ...DEFAULT_SHEET_LAYERS, ...opts.layers }
  const pages = [schemePage(doc, analysis, { ...opts, layers })]
  if (opts.includeSpec !== false) pages.push(...specPages(doc, analysis, opts))
  return pages
}

function schemePage(doc: Doc, analysis: Analysis, opts: SheetOpts & { layers: SheetLayers }): SheetPage {
  const paper = paperOf(opts.paper)
  const widthPx = mmToPx(paper.wMm)
  const heightPx = mmToPx(paper.hMm)
  const m = (n: number) => mmToPx(n)
  const margin = m(8)
  const legendW = m(52)
  const stampH = m(22)
  const plot = {
    x: margin,
    y: margin,
    w: widthPx - margin * 2 - legendW - m(4),
    h: heightPx - margin * 2 - stampH - m(3),
  }
  const bounds = contentBounds(doc, opts.underlay)
  const worldW = Math.max(1, bounds.maxX - bounds.minX)
  const worldH = Math.max(1, bounds.maxY - bounds.minY)
  const fit = Math.min(plot.w / worldW, plot.h / worldH)
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  const rawScale = 1000 / Math.max((fit * ppm * 25.4) / SHEET_DPI, 0.001)
  const scale = niceScale(rawScale)
  const k = fit * (rawScale / scale)
  const ox = plot.x + (plot.w - worldW * k) / 2 - bounds.minX * k
  const oy = plot.y + (plot.h - worldH * k) / 2 - bounds.minY * k
  const date = opts.date ?? isoDate()
  const layers = opts.layers
  const draft = layers.draft
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">`)
  if (!draft) parts.push(patterns(ppm))
  parts.push(`<rect width="${widthPx}" height="${heightPx}" fill="#f7f3ea"/>`)
  parts.push(`<rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" fill="${draft ? '#ffffff' : '#e7efe6'}" stroke="#1c2822" stroke-width="1.2"/>`)
  parts.push(`<clipPath id="plot-clip"><rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}"/></clipPath>`)
  parts.push(`<g clip-path="url(#plot-clip)"><g transform="translate(${fmt(ox)} ${fmt(oy)}) scale(${fmt(k)})">`)
  if (layers.grid) parts.push(gridSvg(bounds, ppm, k))
  if (layers.underlay && opts.underlay) {
    parts.push(
      `<image href="${xml(opts.underlay.href)}" x="0" y="0" width="${fmt(opts.underlay.w)}" height="${fmt(opts.underlay.h)}" opacity="0.88" preserveAspectRatio="none"/>`,
    )
  }
  if (layers.landscape) {
    for (const zone of doc.zones) {
      const surface = surfaceOf(zone.kind)
      const fade = !draft && zone.opacity !== undefined ? ` opacity="${fmt(zone.opacity)}"` : ''
      const row = analysis.zones.find((item) => item.id === zone.id)
      const fill = draft ? '#ffffff' : layers.precip ? precipWash(row?.precipMmH ?? null) : `url(#sheet-${hatchOf(zone)})`
      const stroke = draft ? '#1c2822' : zone.stroke || surface.stroke
      parts.push(
        `<path d="${xml(zoneShapeD(zone.points, zone.bends, zone.holes))}" fill="${fill}" fill-rule="evenodd" stroke="${xml(stroke)}" stroke-width="${fmt((zone.pen ?? 1.3) / k)}"${fade}/>`,
      )
      const middle = centroid(zone.points)
      const captions: { text: string; size: number }[] = []
      if (layers.names && zone.name) captions.push({ text: zone.name, size: 13 })
      if (layers.area && row?.areaM2 != null) captions.push({ text: `${num(row.areaM2)} м²`, size: 13 })
      if (layers.precip) captions.push({ text: row?.precipMmH == null ? 'нет осадков' : `${num(row.precipMmH)} мм/ч`, size: 13 })
      if (layers.runtime && row) {
        const label = runtimeLabel(row.runtimeMin, row.cycles)
        if (label) captions.push({ text: label, size: 12 })
      }
      captions.forEach((caption, index) => {
        parts.push(plotLabel(middle.x, middle.y + index * (16 / k), k, caption.text, caption.size))
      })
    }
    for (const fixture of doc.fixtures ?? []) parts.push(fixtureMarkup(fixture, ppm, k))
    for (const plant of doc.plants ?? []) parts.push(plantSvg(plant, ppm, k))
    for (const note of doc.notes ?? []) {
      if (note.leader) {
        const mark = noteLeader(note, note.leader, k)
        if (mark) {
          const ink = draft ? '#1c2822' : note.color || '#1c2822'
          const [from, to] = mark.shaft
          const pts = mark.head.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(' ')
          parts.push(
            `<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="${xml(ink)}" stroke-width="${fmt(1.2 / k)}" stroke-linecap="round"/>`,
          )
          parts.push(`<polygon points="${pts}" fill="${xml(ink)}"/>`)
        }
      }
      parts.push(
        `<text x="${fmt(note.x)}" y="${fmt(note.y)}" fill="${xml(note.color || '#1c2822')}" font-size="${fmt(note.sizeM * ppm)}" font-family="sans-serif"${note.bold ? ' font-weight="700"' : ''}>${xml(note.text)}</text>`,
      )
    }
    for (const measure of doc.measures ?? []) parts.push(measureSvg(measure, ppm, k))
  }
  if (layers.spray && layers.cover) {
    for (const head of doc.sprinklers) {
      const wash = draft ? 'none' : layers.precip ? precipWash(precipAt(doc, analysis, head)) : 'rgba(47,122,72,0.18)'
      parts.push(
        `<path d="${xml(coverPath(head, ppm, nozzleById(head.nozzleId)))}" fill="${wash}" stroke="${draft ? '#1c2822' : '#24633a'}" stroke-width="${fmt(1 / k)}"/>`,
      )
    }
  }
  if (layers.pipes) {
    for (const segment of analysis.segments) {
      parts.push(
        `<line x1="${fmt(segment.a.x)}" y1="${fmt(segment.a.y)}" x2="${fmt(segment.b.x)}" y2="${fmt(segment.b.y)}" stroke="${draft ? '#1c2822' : segmentInk(analysis, segment)}" stroke-width="${fmt(pipeWeight(segment.role) / k)}" stroke-linecap="round"/>`,
      )
    }
    for (const arrow of flowArrows(analysis.segments, doc.pxPerMeter, k)) {
      const r = 5 / Math.max(k, 0.05)
      const pts = `0,${fmt(-r)} ${fmt(r * 0.72)},${fmt(r * 0.55)} ${fmt(-r * 0.72)},${fmt(r * 0.55)}`
      const ink = draft ? '#1c2822' : '#1f4d6e'
      parts.push(
        `<polygon data-flow="1" points="${pts}" fill="${ink}" stroke="${draft ? '#1c2822' : '#14364c'}" stroke-width="${fmt(0.8 / Math.max(k, 0.05))}" transform="translate(${fmt(arrow.x)} ${fmt(arrow.y)}) rotate(${fmt(arrow.rotationDeg)})"/>`,
      )
    }
    for (const tail of analysis.tails) {
      const pts = funnyPoints(tail.a, tail.b).map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(' ')
      parts.push(
        `<polyline points="${pts}" fill="none" stroke="${draft ? '#1c2822' : '#8a5a16'}" stroke-width="${fmt(2.2 / k)}" stroke-linecap="round"/>`,
      )
    }
    for (const tag of pipeTags(analysis.segments, doc.pxPerMeter, k)) {
      parts.push(
        `<text x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
    for (const tag of speedTags(analysis.segments, doc.pxPerMeter, k)) {
      const fill = draft || !tag.hot ? '#1c2822' : '#8d2b1f'
      parts.push(
        `<text data-speed="1" x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="${fill}" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
    for (const tag of lossTags(analysis.segments, doc.pxPerMeter, k)) {
      parts.push(
        `<text data-loss="1" x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
    for (const mark of analysis.fittingMarks) parts.push(fittingMarkSvg(mark, k, draft))
  }
  if (layers.drip) {
    const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
    for (const drip of doc.drips) {
      const pts = drip.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')
      const mark = analysis.marks.find((item) => item.kind === 'drip' && item.id === drip.id)
      const stroke = draft ? '#1c2822' : mark ? stationInk(analysis.stations, mark.stationId) : '#6b3fa0'
      const dash = drip.bare ? '' : ` stroke-dasharray="${fmt(7 / k)} ${fmt(5 / k)}"`
      parts.push(
        `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${fmt(2.2 / k)}"${dash} stroke-linecap="round"/>`,
      )
      if (drip.bare) continue
      for (const point of emitterPoints(drip.points, drip.spacingM, ppm)) {
        parts.push(`<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="${fmt(2.4 / k)}" fill="${stroke}"/>`)
      }
    }
    for (const tag of dripTags(doc.drips, doc.pxPerMeter, k)) {
      parts.push(
        `<text x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
    for (const tag of dripFlowTags(doc.drips, doc.pxPerMeter, k)) {
      parts.push(
        `<text data-drip-flow="1" x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
  }
  if (layers.spray) {
    for (const head of doc.sprinklers) {
      const r = 4.5 / k
      const mark = analysis.marks.find((item) => item.kind === 'sprinkler' && item.id === head.id)
      const ink = mark ? stationInk(analysis.stations, mark.stationId) : '#1c2822'
      const fill = draft ? '#ffffff' : head.nozzleId.startsWith('bub') ? '#2a6288' : '#fffdf8'
      parts.push(`<circle cx="${fmt(head.x)}" cy="${fmt(head.y)}" r="${fmt(r)}" fill="${fill}" stroke="${draft ? '#1c2822' : ink}" stroke-width="${fmt(1.6 / k)}"/>`)
      const pressure = analysis.pressureMarks.find((item) => item.id === head.id)
      if (pressure) {
        const pressureInk = draft || !pressure.low ? '#1c2822' : '#8d2b1f'
        parts.push(
          `<text data-pressure="1" x="${fmt(pressure.x + 14 / k)}" y="${fmt(pressure.y)}" fill="${pressureInk}" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="start" dominant-baseline="middle">${xml(pressureLabel(pressure.bar))}</text>`,
        )
      }
      if (layers.headInfo) {
        parts.push(
          `<text x="${fmt(head.x)}" y="${fmt(head.y + 22 / k)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="700" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle">${xml(headCaption(head))}</text>`,
        )
      }
      if (!mark) continue
      const no = stationNo(analysis.stations, mark.stationId)
      parts.push(
        `<text x="${fmt(head.x)}" y="${fmt(head.y - 12 / k)}" fill="${ink}" font-size="${fmt(11 / k)}" font-weight="700" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle">${no}</text>`,
      )
    }
  }
  if (layers.fittings) {
    for (const sleeve of doc.sleeves ?? []) {
      parts.push(
        `<line x1="${fmt(sleeve.a.x)}" y1="${fmt(sleeve.a.y)}" x2="${fmt(sleeve.b.x)}" y2="${fmt(sleeve.b.y)}" stroke="#5c564e" stroke-width="${fmt(7 / k)}" stroke-linecap="round"/>`,
        `<line x1="${fmt(sleeve.a.x)}" y1="${fmt(sleeve.a.y)}" x2="${fmt(sleeve.b.x)}" y2="${fmt(sleeve.b.y)}" stroke="#f4efe4" stroke-width="${fmt(2.4 / k)}" stroke-linecap="round"/>`,
      )
    }
    for (const tag of sleeveTags(doc.sleeves ?? [], doc.pxPerMeter, k)) {
      parts.push(
        `<text x="${fmt(tag.x)}" y="${fmt(tag.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${fmt(tag.rotate)} ${fmt(tag.x)} ${fmt(tag.y)})">${xml(tag.text)}</text>`,
      )
    }
    for (const box of doc.boxes ?? []) {
      const w = 22 / k
      const h = 14 / k
      parts.push(
        `<rect x="${fmt(box.x - w)}" y="${fmt(box.y - h)}" width="${fmt(w * 2)}" height="${fmt(h * 2)}" rx="${fmt(2 / k)}" fill="#efe8dc" stroke="#5c3d24" stroke-width="${fmt(1.6 / k)}"/>`,
      )
    }
    for (const hydrant of doc.hydrants ?? []) {
      const r = 4.5 / k
      parts.push(
        `<circle cx="${fmt(hydrant.x)}" cy="${fmt(hydrant.y)}" r="${fmt(r)}" fill="#1f4d6e" stroke="#14364c" stroke-width="${fmt(1.4 / k)}"/>`,
      )
    }
    for (const valve of doc.valves) {
      const r = 5 / k
      const no = stationNo(analysis.stations, valve.id)
      const ink = no > 0 ? stationInk(analysis.stations, valve.id) : '#6b3fa0'
      parts.push(
        `<polygon points="${fmt(valve.x)},${fmt(valve.y - r)} ${fmt(valve.x + r)},${fmt(valve.y)} ${fmt(valve.x)},${fmt(valve.y + r)} ${fmt(valve.x - r)},${fmt(valve.y)}" fill="#f7f3ea" stroke="${ink}" stroke-width="${fmt(1.6 / k)}"/>`,
      )
      if (no > 0) {
        parts.push(
          `<text x="${fmt(valve.x)}" y="${fmt(valve.y - 12 / k)}" fill="${ink}" font-size="${fmt(11 / k)}" font-weight="700" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle">${no}</text>`,
        )
      }
      const station = analysis.stations.find((row) => row.id === valve.id)
      if (layers.runtime && station) {
        const label = runtimeLabel(station.runtimeMin, station.cycles)
        if (label) parts.push(plotLabel(valve.x, valve.y + 16 / k, k, label, 11))
      }
      if (station && station.flowLph > 0) {
        parts.push(
          `<text data-valve-flow="1" x="${fmt(valve.x + 14 / k)}" y="${fmt(valve.y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="start" dominant-baseline="middle">${xml(valveFlowLabel(station.flowLph))}</text>`,
        )
      }
    }
    if (doc.source) {
      const s = 5 / k
      parts.push(
        `<rect x="${fmt(doc.source.x - s)}" y="${fmt(doc.source.y - s)}" width="${fmt(s * 2)}" height="${fmt(s * 2)}" fill="#1f6b45" stroke="#143c28" stroke-width="${fmt(1.4 / k)}"/>`,
      )
      parts.push(
        `<text data-source="1" x="${fmt(doc.source.x)}" y="${fmt(doc.source.y - 16 / k)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(11 / k)}" font-weight="600" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${xml(sourceLabel(doc.source))}</text>`,
      )
    }
  }
  parts.push(scaleBar(bounds, ppm, k, scale))
  parts.push('</g></g>')
  parts.push(legendSvg(doc, analysis, layers, plot.x + plot.w + m(4), plot.y, legendW, plot.h))
  parts.push(stampSvg(opts.title, date, paper.name, scale, margin, heightPx - margin - stampH, widthPx - margin * 2, stampH))
  parts.push('</svg>')
  return {
    name: 'Схема',
    svg: parts.join(''),
    widthPx,
    heightPx,
    widthPt: mmToPt(paper.wMm),
    heightPt: mmToPt(paper.hMm),
  }
}

type SpecLine = { title?: string; cells: string[] }

function specPages(doc: Doc, analysis: Analysis, opts: SheetOpts): SheetPage[] {
  const paper = paperOf(opts.paper)
  const widthPx = mmToPx(paper.wMm)
  const heightPx = mmToPx(paper.hMm)
  const margin = mmToPx(12)
  const packed = packSpec(specLines(doc, analysis), heightPx, margin)
  return packed.map((lines, index) => specSheet(lines, opts, paper, widthPx, heightPx, margin, index))
}

function specLines(doc: Doc, analysis: Analysis): SpecLine[] {
  const lines: SpecLine[] = []
  const pushTitle = (title: string) => lines.push({ title, cells: [] })
  const push = (...cells: string[]) => lines.push({ cells })
  const gear = gearList(doc, analysis)
  if (gear.lines.length) {
    pushTitle('К закупке')
    for (const line of gear.lines) push(line.name, line.qty)
    for (const note of gear.notes) push(note)
    const hint = gearHint(doc)
    if (hint) push(hint)
  }
  pushTitle('Зоны')
  if (analysis.zones.length === 0) push('Зон нет')
  for (const zone of analysis.zones) {
    push(
      zone.name,
      surfaceOf(zone.kind).label,
      zone.areaM2 === null ? '—' : `${num(zone.areaM2)} м²`,
      zone.runtimeMin === null ? '' : `${num(zone.runtimeMin, 1)} мин`,
    )
  }
  pushTitle('Дождеватели')
  if (analysis.nozzles.length === 0) push('Дождевателей нет')
  for (const row of analysis.nozzles) push(row.name, `${row.count} шт.`, `${num(row.flowLph, 0)} л/ч`)
  push('В сети', '', `${num(analysis.connectedFlowLph, 0)} л/ч`)
  pushTitle('Трубы')
  if (analysis.pipes.length === 0) push('Диаметры появятся, когда источник стоит на трубе')
  for (const row of analysis.pipes) push(row.name, `${num(row.lengthM)} м`)
  pushTitle('Клапаны')
  if (doc.valves.length === 0) push('Клапанов нет, вся сеть поливается сразу')
  for (const valve of doc.valves) {
    const station = analysis.stations.find((row) => row.id === valve.id)
    push(valve.name, station ? `${num(station.flowLph, 0)} л/ч` : 'не на трубе', station?.runtimeMin ? `${num(station.runtimeMin, 1)} мин` : '')
  }
  pushTitle('Капля')
  if (doc.drips.length === 0) push('Капельной трубки нет')
  else {
    push('Трубка', `${num(analysis.drips.lengthM)} м`)
    push('Капельницы', `${analysis.drips.emitters} шт.`)
    push('Расход', `${num(analysis.drips.flowLph, 0)} л/ч`)
  }
  if (analysis.tails.length) {
    pushTitle('Гибкие хвосты')
    const length = analysis.tails.reduce((sum, tail) => sum + tail.lengthM, 0)
    push('Хвост', `${analysis.tails.length} шт.`, `${num(length)} м`)
  }
  const sleeves = doc.sleeves ?? []
  if (sleeves.length) {
    pushTitle('Гильзы')
    const length = sleeveLengthM(sleeves, doc.pxPerMeter)
    push('Гильза', `${sleeves.length} шт.`, length === null ? '—' : `${num(length)} м`)
  }
  pushTitle('Траншея')
  push('Сечение', `${num(doc.trench.widthM, 2)} × ${num(doc.trench.depthM, 2)} м`)
  push('Длина', analysis.trench.lengthM === null ? '—' : `${num(analysis.trench.lengthM)} м`)
  push('Объём', analysis.trench.volumeM3 === null ? '—' : `${num(analysis.trench.volumeM3, 2)} м³`)
  pushTitle('Фитинги')
  if (analysis.fittings.length === 0) push('—')
  for (const row of analysis.fittings) push(row.name, `${row.count} шт.`)
  const table = programTable(doc, analysis)
  if (table) {
    pushTitle('Пульт')
    for (const line of table.lines) push(line.name, line.when, line.note)
  }
  for (const warning of analysis.warnings) push('!', warning)
  return lines
}

function packSpec(lines: SpecLine[], heightPx: number, margin: number): SpecLine[][] {
  const bottom = heightPx - margin - 16
  const start = margin + 36
  const pages: SpecLine[][] = []
  let page: SpecLine[] = []
  let y = start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const need = specLineHeight(line)
    const next = lines[i + 1]
    const follow = line.title && next && !next.title ? specLineHeight(next) : 0
    if (page.length > 0 && y + need + follow > bottom) {
      pages.push(page)
      page = []
      y = start
    }
    page.push(line)
    y += need
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

function specLineHeight(line: SpecLine): number {
  return line.title ? 26 : 18
}

function specSheet(
  lines: SpecLine[],
  opts: SheetOpts,
  paper: { wMm: number; hMm: number },
  widthPx: number,
  heightPx: number,
  margin: number,
  index: number,
): SheetPage {
  const date = opts.date ?? isoDate()
  const rowH = 18
  const colX = [margin, margin + mmToPx(70), margin + mmToPx(130), margin + mmToPx(190)]
  let y = margin + 36
  const continued = index > 0 ? ', продолжение' : ''
  const body: string[] = []
  body.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">`)
  body.push(`<rect width="${widthPx}" height="${heightPx}" fill="#f7f3ea"/>`)
  body.push(`<rect x="${margin}" y="${margin}" width="${widthPx - margin * 2}" height="${heightPx - margin * 2}" fill="none" stroke="#1c2822" stroke-width="1.4"/>`)
  body.push(`<text x="${margin + 8}" y="${margin + 22}" font-size="16" font-weight="700" font-family="Segoe UI, PT Sans, Arial, sans-serif">Спецификация — ${xml(opts.title)}${xml(continued)}</text>`)
  body.push(`<text x="${widthPx - margin - 8}" y="${margin + 22}" font-size="11" text-anchor="end" fill="#5c564c" font-family="Segoe UI, PT Sans, Arial, sans-serif">${xml(date)}</text>`)
  for (const line of lines) {
    if (line.title) {
      y += 8
      body.push(`<text x="${margin + 8}" y="${y}" font-size="11" font-weight="700" letter-spacing="0.06em" font-family="Segoe UI, PT Sans, Arial, sans-serif">${xml(line.title.toUpperCase())}</text>`)
      y += rowH
      continue
    }
    line.cells.forEach((cell, i) => {
      body.push(`<text x="${colX[i] ?? colX[0]}" y="${y}" font-size="12" font-family="Segoe UI, PT Sans, Arial, sans-serif">${xml(cell)}</text>`)
    })
    y += rowH
  }
  body.push('</svg>')
  return {
    name: index === 0 ? 'Спецификация' : `Спецификация ${index + 1}`,
    svg: body.join(''),
    widthPx,
    heightPx,
    widthPt: mmToPt(paper.wMm),
    heightPt: mmToPt(paper.hMm),
  }
}

function legendSvg(doc: Doc, analysis: Analysis, layers: SheetLayers, x: number, y: number, w: number, h: number): string {
  const items: { swatch: string; label: string }[] = []
  if (layers.landscape) {
    const used = new Set(doc.zones.map((zone) => zone.kind))
    for (const surface of SURFACES) {
      if (used.has(surface.id)) items.push({ swatch: `<rect width="12" height="12" fill="${surface.fill}" stroke="${surface.stroke}"/>`, label: surface.label })
    }
  }
  if (layers.spray && doc.sprinklers.length) items.push({ swatch: `<circle cx="6" cy="6" r="5" fill="#fffdf8" stroke="#1c2822"/>`, label: 'Дождеватель' })
  if (layers.drip && doc.drips.length) items.push({ swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="#6b3fa0" stroke-width="2" stroke-dasharray="4 3"/>`, label: 'Капля' })
  if (layers.pipes && analysis.segments.some((segment) => segment.role === 'main')) {
    items.push({ swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="#1c2822" stroke-width="4" stroke-linecap="round"/>`, label: 'Магистраль' })
  }
  if (layers.pipes && analysis.segments.some((segment) => segment.role === 'zone')) {
    const stationIds: string[] = []
    for (const segment of analysis.segments) {
      if (segment.role !== 'zone' || segment.status !== 'ok' || !segment.stationId) continue
      if (!stationIds.includes(segment.stationId)) stationIds.push(segment.stationId)
    }
    if (stationIds.length === 0) {
      items.push({ swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="#2f6f97" stroke-width="2" stroke-linecap="round"/>`, label: 'Зональная' })
    } else {
      for (const id of stationIds) {
        const station = analysis.stations.find((item) => item.id === id)
        const valve = doc.valves.find((item) => item.id === id)
        const box = valve?.boxId ? (doc.boxes ?? []).find((item) => item.id === valve.boxId) : undefined
        const kinds = new Set(analysis.marks.filter((item) => item.stationId === id).map((item) => item.kind))
        const type = kinds.has('sprinkler') && kinds.has('drip') ? 'дождевание и капля' : kinds.has('drip') ? 'капля' : kinds.has('sprinkler') ? 'дождевание' : ''
        const bits = [`Станция ${stationNo(analysis.stations, id)}`]
        if (station?.name) bits.push(station.name)
        if (box) bits.push(box.name)
        if (type) bits.push(type)
        if (station) bits.push(`${Math.round(station.flowLph)} л/ч`)
        items.push({
          swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="${stationInk(analysis.stations, id)}" stroke-width="3" stroke-linecap="round"/>`,
          label: bits.join(' · '),
        })
      }
    }
  }
  if (layers.landscape) {
    for (const zone of analysis.zones) {
      const swatch = layers.precip ? precipWash(zone.precipMmH) : surfaceOf(zone.kind).fill
      items.push({
        swatch: `<rect width="12" height="12" fill="${swatch}" stroke="#1c2822"/>`,
        label: `${zone.name} · ${num(zone.areaM2)} м² · ${num(zone.precipMmH)} мм/ч`,
      })
    }
  }
  if (layers.precip) {
    items.push({ swatch: `<rect width="12" height="12" fill="rgba(86,146,196,0.48)" stroke="#1c2822"/>`, label: 'Мало, до 8 мм/ч' })
    items.push({ swatch: `<rect width="12" height="12" fill="rgba(78,156,82,0.46)" stroke="#1c2822"/>`, label: 'Норма, 8–22 мм/ч' })
    items.push({ swatch: `<rect width="12" height="12" fill="rgba(196,84,62,0.46)" stroke="#1c2822"/>`, label: 'Много, больше 22 мм/ч' })
  }
  if (layers.pipes && analysis.tails.length) {
    items.push({ swatch: `<path d="M0 6 Q3 2 6 6 T12 6" fill="none" stroke="#8a5a16" stroke-width="1.6"/>`, label: 'Гибкий хвост' })
  }
  if (layers.pipes) {
    for (const row of analysis.pipes) {
      items.push({ swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="${pipeColor(row.odMm, 'ok')}" stroke-width="3"/>`, label: row.name })
    }
  }
  if (layers.fittings && doc.valves.length) items.push({ swatch: `<polygon points="6,1 11,6 6,11 1,6" fill="#f7f3ea" stroke="#6b3fa0"/>`, label: 'Клапан' })
  if (layers.fittings && (doc.boxes ?? []).length) items.push({ swatch: `<rect x="1" y="2" width="10" height="8" rx="1" fill="#efe8dc" stroke="#5c3d24"/>`, label: 'Клапанный бокс' })
  if (layers.fittings && (doc.hydrants ?? []).length) items.push({ swatch: `<circle cx="6" cy="6" r="4" fill="#1f4d6e" stroke="#14364c"/>`, label: 'Гидрант' })
  if (layers.fittings && (doc.sleeves ?? []).length) items.push({ swatch: `<line x1="0" y1="6" x2="12" y2="6" stroke="#5c564e" stroke-width="4" stroke-linecap="round"/>`, label: 'Гильза' })
  if (layers.fittings && doc.source) items.push({ swatch: `<rect x="1" y="1" width="10" height="10" fill="#1f6b45" stroke="#143c28"/>`, label: 'Источник' })
  const parts = [`<g font-family="Segoe UI, PT Sans, Arial, sans-serif">`]
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f7f3ea" stroke="#1c2822" stroke-width="1.2"/>`)
  parts.push(`<text x="${x + 10}" y="${y + 18}" font-size="11" font-weight="700" letter-spacing="0.05em">ЛЕГЕНДА</text>`)
  let row = y + 34
  for (const item of items) {
    if (row > y + h - 16) break
    parts.push(`<g transform="translate(${x + 10} ${row - 10})">${item.swatch}</g>`)
    parts.push(`<text x="${x + 28}" y="${row}" font-size="11">${xml(item.label)}</text>`)
    row += 18
  }
  parts.push('</g>')
  return parts.join('')
}

function stampSvg(title: string, date: string, paper: string, scale: number, x: number, y: number, w: number, h: number): string {
  const mid = x + w * 0.42
  const right = x + w * 0.72
  return [
    `<g font-family="Segoe UI, PT Sans, Arial, sans-serif">`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f7f3ea" stroke="#1c2822" stroke-width="1.4"/>`,
    `<line x1="${mid}" y1="${y}" x2="${mid}" y2="${y + h}" stroke="#1c2822"/>`,
    `<line x1="${right}" y1="${y}" x2="${right}" y2="${y + h}" stroke="#1c2822"/>`,
    `<text x="${x + 10}" y="${y + 16}" font-size="13" font-weight="700" letter-spacing="0.08em">ПОЛИВ</text>`,
    `<text x="${x + 10}" y="${y + 34}" font-size="11" fill="#5c564c">Схема системы полива</text>`,
    `<text x="${mid + 10}" y="${y + 18}" font-size="13" font-weight="650">${xml(title)}</text>`,
    `<text x="${mid + 10}" y="${y + 36}" font-size="11" fill="#5c564c">${xml(date)}</text>`,
    `<text x="${right + 10}" y="${y + 18}" font-size="12">Масштаб 1:${scale}</text>`,
    `<text x="${right + 10}" y="${y + 36}" font-size="11" fill="#5c564c">${xml(paper)}</text>`,
    `</g>`,
  ].join('')
}

function scaleBar(bounds: { minX: number; minY: number; maxX: number; maxY: number }, ppm: number, k: number, _scale: number): string {
  const worldM = (bounds.maxX - bounds.minX) / ppm
  const barM = worldM >= 40 ? 10 : worldM >= 16 ? 5 : 2
  const x = bounds.minX + 0.4 * ppm
  const y = bounds.maxY - 0.55 * ppm
  const w = barM * ppm
  const t = 0.12 * ppm
  return [
    `<g fill="#1c2822" font-family="Segoe UI, PT Sans, Arial, sans-serif">`,
    `<line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(x + w)}" y2="${fmt(y)}" stroke="#1c2822" stroke-width="${fmt(1.8 / k)}"/>`,
    `<line x1="${fmt(x)}" y1="${fmt(y - t)}" x2="${fmt(x)}" y2="${fmt(y + t)}" stroke="#1c2822" stroke-width="${fmt(1.8 / k)}"/>`,
    `<line x1="${fmt(x + w)}" y1="${fmt(y - t)}" x2="${fmt(x + w)}" y2="${fmt(y + t)}" stroke="#1c2822" stroke-width="${fmt(1.8 / k)}"/>`,
    `<text x="${fmt(x + w / 2)}" y="${fmt(y - 0.22 * ppm)}" font-size="${fmt(11 / k)}" text-anchor="middle">${barM} м</text>`,
    `</g>`,
  ].join('')
}

function gridSvg(bounds: { minX: number; minY: number; maxX: number; maxY: number }, ppm: number, k: number): string {
  const minorM = gridStepM(k, ppm)
  const majorM = minorM >= 5 ? 10 : 5
  const parts: string[] = ['<g>']
  const startX = Math.floor(bounds.minX / (minorM * ppm)) * minorM * ppm
  const startY = Math.floor(bounds.minY / (minorM * ppm)) * minorM * ppm
  for (let x = startX; x <= bounds.maxX + 0.01; x += minorM * ppm) {
    const major = Math.abs(x / (majorM * ppm) - Math.round(x / (majorM * ppm))) < 1e-6
    parts.push(
      `<line x1="${fmt(x)}" y1="${fmt(bounds.minY)}" x2="${fmt(x)}" y2="${fmt(bounds.maxY)}" stroke="${major ? 'rgba(46,90,62,0.28)' : 'rgba(46,90,62,0.10)'}" stroke-width="${fmt(1 / k)}"/>`,
    )
  }
  for (let y = startY; y <= bounds.maxY + 0.01; y += minorM * ppm) {
    const major = Math.abs(y / (majorM * ppm) - Math.round(y / (majorM * ppm))) < 1e-6
    parts.push(
      `<line x1="${fmt(bounds.minX)}" y1="${fmt(y)}" x2="${fmt(bounds.maxX)}" y2="${fmt(y)}" stroke="${major ? 'rgba(46,90,62,0.28)' : 'rgba(46,90,62,0.10)'}" stroke-width="${fmt(1 / k)}"/>`,
    )
  }
  parts.push('</g>')
  return parts.join('')
}

function fittingMarkSvg(mark: FittingMark, k: number, draft: boolean): string {
  const ink = draft ? '#1c2822' : '#243028'
  const shape = fittingShape(mark.kind, k)
  const width = fmt(1.6 / Math.max(k, 0.05))
  const bits: string[] = []
  for (const line of shape.lines) {
    bits.push(
      `<line x1="${fmt(line.x1)}" y1="${fmt(line.y1)}" x2="${fmt(line.x2)}" y2="${fmt(line.y2)}" stroke="${ink}" stroke-width="${width}" stroke-linecap="round"/>`,
    )
  }
  if (shape.dot !== null) {
    bits.push(`<circle cx="0" cy="0" r="${fmt(shape.dot)}" fill="${draft ? '#ffffff' : '#f7f3ea'}" stroke="${ink}" stroke-width="${width}"/>`)
  }
  if (shape.poly) {
    const pts = shape.poly.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(' ')
    bits.push(`<polygon points="${pts}" fill="${ink}"/>`)
  }
  return `<g data-fitting="${mark.kind}" transform="translate(${fmt(mark.x)} ${fmt(mark.y)}) rotate(${fmt(mark.rotationDeg)})">${bits.join('')}</g>`
}

function plotLabel(x: number, y: number, k: number, label: string, size: number): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" fill="#1c2822" stroke="#f7f3ea" stroke-width="${fmt(3 / k)}" paint-order="stroke" font-size="${fmt(size / k)}" font-weight="700" font-family="Segoe UI, PT Sans, Arial, sans-serif" text-anchor="middle">${xml(label)}</text>`
}

function patterns(ppm: number): string {
  const body = HATCHES.map((item) => hatchPatternMarkup(item.id, ppm, `sheet-${item.id}`)).join('')
  return `<defs>${body}</defs>`
}

function precipAt(doc: Doc, analysis: Analysis, point: Point): number | null {
  const zone = doc.zones.find((item) => pointInZone(point, item.points, item.holes))
  if (!zone) return null
  return analysis.zones.find((item) => item.id === zone.id)?.precipMmH ?? null
}

function segmentInk(analysis: Analysis, segment: Analysis['segments'][number]): string {
  if (segment.role === 'zone' && segment.status === 'ok' && segment.stationId) return stationInk(analysis.stations, segment.stationId)
  return pipeColor(segment.odMm, segment.status)
}

function pipeColor(od: number | null, status: string): string {
  if (status !== 'ok') return '#8a8175'
  if (od === 16) return '#2f6f97'
  if (od === 20) return '#2c7a4b'
  if (od === 25) return '#b86a09'
  if (od === 32) return '#a33b22'
  if (od === 40) return '#7a3150'
  if (od === 50) return '#4d457f'
  return '#243028'
}

function measureSvg(measure: { a: Point; b: Point }, ppm: number, k: number): string {
  const dx = measure.b.x - measure.a.x
  const dy = measure.b.y - measure.a.y
  const span = Math.hypot(dx, dy) || 1
  const length = span / ppm
  const label = length >= 10 ? length.toFixed(1) : length.toFixed(2)
  const tick = 7 / k
  const ox = (-dy / span) * tick
  const oy = (dx / span) * tick
  const midX = (measure.a.x + measure.b.x) / 2 + ox * (12 / 7)
  const midY = (measure.a.y + measure.b.y) / 2 + oy * (12 / 7)
  const stroke = `stroke="#8d2b1f" stroke-width="${fmt(1.3 / k)}"`
  return [
    `<line x1="${fmt(measure.a.x)}" y1="${fmt(measure.a.y)}" x2="${fmt(measure.b.x)}" y2="${fmt(measure.b.y)}" ${stroke}/>`,
    `<line x1="${fmt(measure.a.x - ox)}" y1="${fmt(measure.a.y - oy)}" x2="${fmt(measure.a.x + ox)}" y2="${fmt(measure.a.y + oy)}" ${stroke}/>`,
    `<line x1="${fmt(measure.b.x - ox)}" y1="${fmt(measure.b.y - oy)}" x2="${fmt(measure.b.x + ox)}" y2="${fmt(measure.b.y + oy)}" ${stroke}/>`,
    `<text x="${fmt(midX)}" y="${fmt(midY)}" fill="#8d2b1f" font-size="${fmt(11 / k)}" text-anchor="middle" font-family="sans-serif">${label} м</text>`,
  ].join('')
}

function plantSvg(plant: Plant, ppm: number, k: number): string {
  return plantMarkup(plant, ppm, k)
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

function num(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

function niceScale(raw: number): number {
  const steps = [20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000]
  for (const step of steps) {
    if (step >= raw * 0.97) return step
  }
  return Math.ceil(raw / 100) * 100
}

function isoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${day}.${m}.${y}`
}
