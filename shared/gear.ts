import { dist, pointInZone } from './geom.ts'
import { sleeveLengthM } from './join.ts'
import { nozzleById, rotorMark, type Nozzle, type NozzleKind, type NozzlePattern } from './nozzles.ts'
import { seriesById } from './pipes.ts'
import type { Analysis, Doc, Drip } from './types.ts'

/** Корпус и сопло — две позиции: в магазине их берут отдельно. */
export type GearLine = { name: string; qty: string }

export type GearList = { lines: GearLine[]; notes: string[] }

const KIND_ORDER: NozzleKind[] = ['fan', 'rotator', 'rotor', 'bubbler']

const KIND_WORD: Record<NozzleKind, string> = {
  fan: 'веер',
  rotator: 'ротатор',
  rotor: 'ротор',
  bubbler: 'баблер',
}

export const GEAR_HINT = 'Веер и ротатор садятся в выдвижной корпус, ротор — в свой. Сектор веера входит в сопло, сектор ротора крутится на корпусе.'

export function gearHint(doc: Doc): string | null {
  for (const head of doc.sprinklers) {
    const kind = nozzleById(head.nozzleId).kind
    if (kind === 'fan' || kind === 'rotator' || kind === 'rotor') return GEAR_HINT
  }
  return null
}

/** Текст для сообщения в магазин: название и количество, затем замечания. */
export function gearText(list: GearList): string {
  const rows = ['К закупке']
  for (const line of list.lines) rows.push(`${line.name} — ${line.qty}`)
  for (const note of list.notes) rows.push(note)
  return rows.join('\n')
}

export function gearList(doc: Doc, analysis: Analysis): GearList {
  const lines: GearLine[] = []
  const nozzles = new Map<string, { kind: NozzleKind; pattern: NozzlePattern; radius: number; arc: number; name: string; count: number }>()
  const sprayRise = new Map<number, number>()
  const rotorRise = new Map<number, number>()

  for (const head of doc.sprinklers) {
    const nozzle = nozzleById(head.nozzleId)
    const kind = nozzle.kind
    const pattern = nozzle.pattern ?? 'fixed'
    const rise = head.riseCm === 15 || head.riseCm === 30 ? head.riseCm : 10
    if (kind === 'fan' || kind === 'rotator') sprayRise.set(rise, (sprayRise.get(rise) ?? 0) + 1)
    else if (kind === 'rotor') rotorRise.set(rise, (rotorRise.get(rise) ?? 0) + 1)
    const radius = Math.round(head.radiusM * 10) / 10
    const arc = Math.max(1, Math.min(360, Math.round(head.arcDeg)))
    const flow = Math.round(head.flowLph)
    const key = gearKey(nozzle, radius, arc, flow)
    const row = nozzles.get(key) ?? { kind, pattern, radius, arc, name: nozzleName(nozzle, radius, arc, flow), count: 0 }
    row.count += 1
    nozzles.set(key, row)
  }

  for (const rise of [10, 15, 30]) {
    const count = sprayRise.get(rise)
    if (count) lines.push({ name: `Корпус выдвижной 1/2" ${rise} см`, qty: pieces(count) })
  }
  for (const rise of [10, 15, 30]) {
    const count = rotorRise.get(rise)
    if (count) lines.push({ name: `Корпус ротора ${rise} см`, qty: pieces(count) })
  }
  const patternOrder: NozzlePattern[] = ['fixed', 'adjust', 'corner', 'low', 'strip']
  const sortedNozzles = [...nozzles.values()].sort((a, b) => {
    const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    if (kind) return kind
    const pattern = patternOrder.indexOf(a.pattern) - patternOrder.indexOf(b.pattern)
    if (pattern) return pattern
    if (a.radius !== b.radius) return a.radius - b.radius
    return a.arc - b.arc
  })
  for (const row of sortedNozzles) lines.push({ name: row.name, qty: pieces(row.count) })

  const dripGroups = new Map<string, { flow: number; spacing: number; lengthM: number; runs: number; known: boolean }>()
  let bareM = 0
  let bareRuns = 0
  let bareKnown = false
  for (const drip of doc.drips) {
    if (drip.bare) {
      bareRuns += 1
      const length = dripLengthM(drip, doc.pxPerMeter)
      if (length !== null) {
        bareKnown = true
        bareM += length
      }
      continue
    }
    const flow = Math.round(drip.emitterLph * 10) / 10
    const spacing = Math.round(drip.spacingM * 100) / 100
    const key = `${flow}|${spacing}`
    const group = dripGroups.get(key) ?? { flow, spacing, lengthM: 0, runs: 0, known: false }
    group.runs += 1
    const length = dripLengthM(drip, doc.pxPerMeter)
    if (length !== null) {
      group.known = true
      group.lengthM += length
    }
    dripGroups.set(key, group)
  }
  if (bareRuns) {
    lines.push({ name: 'Трубка ПЭ 16 без капельниц', qty: bareKnown ? metres(bareM) : pieces(bareRuns) })
  }
  for (const group of [...dripGroups.values()].sort((a, b) => a.flow - b.flow || a.spacing - b.spacing)) {
    lines.push({
      name: `Капельная трубка ${textNum(group.flow)} л/ч, шаг ${textNum(group.spacing)} м`,
      qty: group.known ? metres(group.lengthM) : pieces(group.runs),
    })
  }

  if (doc.valves.length) lines.push({ name: 'Клапан электромагнитный', qty: pieces(doc.valves.length) })

  const boxes = doc.boxes ?? []
  const boxSizes = new Map<number, number>()
  for (const box of boxes) {
    const seats = doc.valves.filter((valve) => valve.boxId === box.id).length
    boxSizes.set(seats, (boxSizes.get(seats) ?? 0) + 1)
  }
  for (const [seats, count] of [...boxSizes.entries()].sort((a, b) => a[0] - b[0])) {
    const name = seats === 0
      ? 'Клапанный бокс'
      : `Клапанный бокс на ${seats} ${ruNoun(seats, 'клапан', 'клапана', 'клапанов')}`
    lines.push({ name, qty: pieces(count) })
  }

  const hydrants = doc.hydrants ?? []
  if (hydrants.length) lines.push({ name: 'Гидрант', qty: pieces(hydrants.length) })

  const sleeves = doc.sleeves ?? []
  if (sleeves.length) {
    const length = sleeveLengthM(sleeves, doc.pxPerMeter)
    lines.push({
      name: 'Гильза',
      qty: length === null ? pieces(sleeves.length) : `${pieces(sleeves.length)} · ${metres(length)}`,
    })
  }

  if (analysis.tails.length) {
    const length = analysis.tails.reduce((sum, tail) => sum + tail.lengthM, 0)
    lines.push({ name: 'Гибкая подводка', qty: `${pieces(analysis.tails.length)} · ${metres(length)}` })
  }

  const series = seriesById(doc.pipeSeries).name.replace(/^ПЭ\s+/, '')
  for (const row of analysis.pipes) {
    lines.push({ name: `Труба ${row.name}, ${series}`, qty: metres(row.lengthM) })
  }
  for (const row of analysis.fittings) {
    if (row.name === 'Гидрант') continue
    lines.push({ name: row.name, qty: pieces(row.count) })
  }

  return { lines, notes: mixNotes(doc) }
}

function gearKey(nozzle: Nozzle, radius: number, arc: number, flow: number): string {
  const pattern = nozzle.pattern ?? 'fixed'
  if (nozzle.kind === 'bubbler') return `bubbler|${flow}|${arc}`
  if (pattern === 'strip') return `strip|${nozzle.id}|${radius}`
  if (nozzle.kind === 'rotor') {
    const mark = rotorMark(radius, pattern === 'low')
    return `${pattern}|rotor|${mark.code}`
  }
  if (pattern === 'adjust' || pattern === 'corner') {
    return `${pattern}|${nozzle.kind}|${radius}`
  }
  return `${pattern}|${nozzle.kind}|${radius}|${arc}`
}

function nozzleName(nozzle: Nozzle, radius: number, arc: number, flowLph: number): string {
  const kind = nozzle.kind
  const pattern = nozzle.pattern ?? 'fixed'
  if (kind === 'bubbler') {
    const litres = textNum(flowLph / 60)
    return arc >= 359 ? `Баблер ${litres} л/мин` : `Баблер ${litres} л/мин, ${arc}°`
  }
  if (pattern === 'strip') {
    const sized = Math.abs(radius - nozzle.radiusM) >= 0.05
    return sized ? `${nozzle.name}, вылет ${textNum(radius)} м` : nozzle.name
  }
  if (pattern === 'corner') return `Ротатор угловой ${textNum(radius)} м`
  if (kind === 'rotor') return rotorBuyName(radius, pattern === 'low')
  const title = kind === 'fan' ? 'Сопло веерное' : 'Сопло-ротатор'
  if (pattern === 'adjust') return `${title} регулируемое ${textNum(radius)} м`
  return `${title} ${textNum(radius)} м, ${arc}°`
}

function rotorBuyName(radius: number, low: boolean): string {
  const mark = rotorMark(radius, low)
  const code = `№${mark.code.replace('.', ',')}`
  const shelf = textNum(mark.radiusM)
  const tail = Math.abs(radius - mark.radiusM) < 0.35 ? '' : `, вылет ${textNum(radius)} м`
  return low ? `Сопло ротора ${code}, низкий угол, ${shelf} м${tail}` : `Сопло ротора ${code}, ${shelf} м${tail}`
}

function mixNotes(doc: Doc): string[] {
  const notes: string[] = []
  for (const zone of doc.zones) {
    const kinds = new Set<NozzleKind>()
    for (const head of doc.sprinklers) {
      if (pointInZone(head, zone.points, zone.holes)) kinds.add(nozzleById(head.nozzleId).kind)
    }
    if (kinds.size < 2) continue
    const words = KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => KIND_WORD[kind])
    notes.push(`Зона «${zone.name}» смешивает ${joinRu(words)}. Такие типы стоят на разных клапанах.`)
  }
  return notes
}

function dripLengthM(drip: Drip, ppm: number | null): number | null {
  if (!ppm || ppm <= 0 || drip.points.length < 2) return null
  let length = 0
  for (let i = 1; i < drip.points.length; i++) length += dist(drip.points[i - 1], drip.points[i])
  return length / ppm
}

function joinRu(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} и ${words[words.length - 1]}`
}

function ruNoun(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function pieces(count: number): string {
  return `${count} шт.`
}

function metres(length: number): string {
  return `${textNum(length)} м`
}

function textNum(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}
