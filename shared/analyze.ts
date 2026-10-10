import { climateFactor, cyclePlan, defaultDose, intakeMmH, SNAP_PX } from './doc.ts'
import { bearingDeg, closestOnSegment, dist, pointInZone, zoneAreaPx } from './geom.ts'
import { isDripKind } from './landscape.ts'
import { nozzleById } from './nozzles.ts'
import { barToHeadM, headLossM, headMToBar, MIN_SPRINKLER_BAR, pickPipe, seriesById } from './pipes.ts'
import type { Analysis, Doc, Drip, FittingMark, PipeRole, Point, PressureMark, SegmentResult, Valve, Zone } from './types.ts'

/** Гибкий хвост дотягивается до головки не дальше этого расстояния. */
const FUNNY_M = 1

const STATION_INKS = ['#c23b22', '#1f6f97', '#2c7a4b', '#b86a09', '#6b3fa0', '#0f6e6e', '#8a4b2f', '#3d4f8a']

export function stationNo(stations: { id: string }[], stationId: string): number {
  const index = stations.findIndex((item) => item.id === stationId)
  return index < 0 ? 0 : index + 1
}

export function stationInk(stations: { id: string }[], stationId: string): string {
  const index = stations.findIndex((item) => item.id === stationId)
  if (index < 0) return '#243028'
  return STATION_INKS[index % STATION_INKS.length]
}

type Node = { id: number; x: number; y: number; points: Point[] }

type Edge = {
  key: string
  pipeId: string
  a: number
  b: number
  p1: Point
  p2: Point
  lengthPx: number
}

function cluster(points: Point[]): { nodes: Node[]; index: number[] } {
  const parent = points.map((_, i) => i)
  const find = (i: number): number => {
    let n = i
    while (parent[n] !== n) n = parent[n]
    let c = i
    while (parent[c] !== n) {
      const next = parent[c]
      parent[c] = n
      c = next
    }
    return n
  }
  const unite = (a: number, b: number) => {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent[pa] = pb
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (dist(points[i], points[j]) <= SNAP_PX) unite(i, j)
    }
  }
  const groups = new Map<number, number[]>()
  points.forEach((_, i) => {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(i)
    else groups.set(root, [i])
  })
  const nodes: Node[] = []
  const index = new Array<number>(points.length)
  for (const idxs of groups.values()) {
    let x = 0
    let y = 0
    const members: Point[] = []
    for (const i of idxs) {
      x += points[i].x
      y += points[i].y
      members.push(points[i])
    }
    const id = nodes.length
    nodes.push({ id, x: x / idxs.length, y: y / idxs.length, points: members })
    for (const i of idxs) index[i] = id
  }
  return { nodes, index }
}

function nearest(p: Point, nodes: Node[]): { node: Node; distance: number } | null {
  let best: { node: Node; distance: number } | null = null
  for (const node of nodes) {
    const distance = Math.hypot(node.x - p.x, node.y - p.y)
    if (!best || distance < best.distance) best = { node, distance }
  }
  return best
}

function hitchPoint(point: Point, nodes: Node[], ppm: number | null): { node: Node; distance: number; tail: boolean } | null {
  const hit = nearest(point, nodes)
  if (!hit) return null
  if (hit.distance <= SNAP_PX) return { ...hit, tail: false }
  if (ppm && ppm > 0 && hit.distance <= FUNNY_M * ppm) return { ...hit, tail: true }
  return null
}

function zoneRows(doc: Doc): Analysis['zones'] {
  return doc.zones.map((zone) => {
    const areaM2 = doc.pxPerMeter ? zoneAreaPx(zone.points, zone.holes) / (doc.pxPerMeter * doc.pxPerMeter) : null
    const wetM2 = canopyM2(zone, doc) ?? areaM2
    let flow = 0
    for (const sprinkler of doc.sprinklers) {
      if (pointInZone(sprinkler, zone.points, zone.holes)) flow += sprinkler.flowLph
    }
    for (const drip of doc.drips) {
      if (pointInZone(centroid(drip.points), zone.points, zone.holes)) flow += dripMeasure(drip, doc.pxPerMeter).flowLph
    }
    const precipMmH = wetM2 && wetM2 > 0 ? flow / wetM2 : null
    const doseMm = zone.doseMm >= 0 && zone.doseMm <= 40 ? zone.doseMm : defaultDose(zone.kind)
    const climate = zone.climate ?? 'open'
    const appliedMm = doseMm * climateFactor(climate)
    const runtimeMin = appliedMm <= 0 ? 0 : precipMmH && precipMmH > 0 ? (appliedMm / precipMmH) * 60 : null
    const soil = zone.soil ?? 'loam'
    const slope = zone.slope ?? 'flat'
    const plan = cyclePlan(runtimeMin, precipMmH, soil, slope)
    return {
      id: zone.id,
      name: zone.name,
      kind: zone.kind,
      areaM2,
      precipMmH,
      doseMm,
      runtimeMin,
      soil,
      slope,
      climate,
      appliedMm,
      intakeMmH: intakeMmH(soil, slope),
      cycles: plan.cycles,
      soakMin: plan.soakMin,
    }
  })
}

function pushDoseWarnings(doc: Doc, warnings: string[]) {
  for (const zone of zoneRows(doc)) {
    if (zone.doseMm > 0 && zone.runtimeMin === null) warnings.push(`Зона «${zone.name}»: нет осадков, время полива не посчитано.`)
    if (zone.cycles !== null && zone.cycles > 1) warnings.push(`Зона «${zone.name}» поливается в ${zone.cycles} ${cyclesWord(zone.cycles)}: осадки выше впитывания почвы.`)
  }
}

function cyclesWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'цикл'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'цикла'
  return 'циклов'
}

function slotClock(runtimeMin: number | null, cycles: number | null, soakMin: number): number | null {
  if (runtimeMin === null || cycles === null) return null
  if (cycles <= 1) return runtimeMin
  return runtimeMin + (cycles - 1) * soakMin
}

function govern(zones: Analysis['zones']): Analysis['zones'][number] | null {
  let best: Analysis['zones'][number] | null = null
  for (const zone of zones) {
    if (zone.runtimeMin === null) continue
    const longer = !best || zone.runtimeMin > (best.runtimeMin ?? -1)
    const sameButMoreCycles = !!best && zone.runtimeMin === best.runtimeMin && (zone.cycles ?? 0) > (best.cycles ?? 0)
    if (longer || sameButMoreCycles) best = zone
  }
  return best
}

function clockMinutes(zones: Analysis['zones'], stations: Analysis['stations']): number | null {
  if (stations.length === 0) {
    if (programMinutes(zones, []) === null) return null
    const best = govern(zones.filter((zone) => zone.doseMm > 0))
    if (!best) return programMinutes(zones, [])
    return slotClock(best.runtimeMin, best.cycles, best.soakMin)
  }
  if (stations.some((station) => station.runtimeMin === null || station.cycles === null)) return null
  return stations.reduce((sum, station) => sum + (slotClock(station.runtimeMin, station.cycles, station.soakMin) ?? 0), 0)
}

function programMinutes(zones: Analysis['zones'], stations: Analysis['stations']): number | null {
  if (stations.length === 0) {
    const needed = zones.filter((zone) => zone.doseMm > 0)
    if (needed.some((zone) => zone.runtimeMin === null)) return null
    if (needed.length === 0) return zones.length ? 0 : null
    return Math.max(...needed.map((zone) => zone.runtimeMin ?? 0))
  }
  if (stations.some((station) => station.runtimeMin === null)) return null
  return stations.reduce((sum, station) => sum + (station.runtimeMin ?? 0), 0)
}

function nozzleRows(doc: Doc): Analysis['nozzles'] {
  const map = new Map<string, { nozzleId: string; name: string; count: number; flowLph: number }>()
  for (const sprinkler of doc.sprinklers) {
    const nozzle = nozzleById(sprinkler.nozzleId)
    const radius = Math.round(sprinkler.radiusM * 10) / 10
    const sized = Math.abs(radius - nozzle.radiusM) >= 0.05
    const text = Number.isInteger(radius) ? String(radius) : radius.toFixed(1)
    const name = sized ? `${nozzle.name} ${text} м` : nozzle.name
    const key = `${sprinkler.nozzleId}@${radius}`
    const row = map.get(key) ?? { nozzleId: sprinkler.nozzleId, name, count: 0, flowLph: 0 }
    row.count += 1
    row.flowLph += sprinkler.flowLph
    map.set(key, row)
  }
  return [...map.values()]
}

function blank(doc: Doc, warnings: string[], totalFlowLph: number, issues: Analysis['issues']): Analysis {
  const zones = zoneRows(doc)
  return {
    segments: [],
    pipes: [],
    nozzles: nozzleRows(doc),
    zones,
    totalFlowLph,
    connectedFlowLph: 0,
    sourceHeadM: doc.source ? barToHeadM(doc.source.pressureBar) : null,
    minResidualHeadM: null,
    programMin: programMinutes(zones, []),
    clockMin: clockMinutes(zones, []),
    stations: [],
    drips: dripSummary(doc),
    fittings: [],
    fittingMarks: [],
    tails: [],
    trench: trenchRow(doc),
    warnings,
    issues,
    marks: [],
    pressureMarks: [],
  }
}

function trenchRow(doc: Doc): Analysis['trench'] {
  const widthM = doc.trench?.widthM ?? 0.3
  const depthM = doc.trench?.depthM ?? 0.4
  if (!doc.pxPerMeter) return { widthM, depthM, lengthM: null, volumeM3: null }
  let lengthPx = 0
  for (const pipe of doc.pipes) {
    for (let i = 0; i < pipe.points.length - 1; i++) lengthPx += dist(pipe.points[i], pipe.points[i + 1])
  }
  const lengthM = lengthPx / doc.pxPerMeter
  return { widthM, depthM, lengthM, volumeM3: lengthM * widthM * depthM }
}

export function analyze(doc: Doc): Analysis {
  const warnings: string[] = []
  const issues: Analysis['issues'] = []
  if (!doc.pxPerMeter) warnings.push('Задайте масштаб двумя точками, чтобы площади и длины считались в метрах.')

  const totalFlowLph = doc.sprinklers.reduce((sum, item) => sum + item.flowLph, 0) + doc.drips.reduce((sum, item) => sum + dripMeasure(item, doc.pxPerMeter).flowLph, 0)
  const flat: Point[] = []
  for (const pipe of doc.pipes) {
    for (const point of pipe.points) flat.push(point)
  }

  if (flat.length === 0) {
    if (doc.sprinklers.length) warnings.push('Дождеватели не стоят на трубе и в расход сети не входят.')
    if (doc.drips.length) warnings.push(doc.drips.length === 1 ? 'Капельная трубка не стоит на трубе и в расход сети не входит.' : `${doc.drips.length} капельных трубок не стоят на трубе и в расход сети не входят.`)
    if (doc.valves.length) warnings.push(doc.valves.length === 1 ? 'Клапан не стоит на трубе.' : `${doc.valves.length} клапанов не стоят на трубе.`)
    if (doc.source) warnings.push('Поставьте источник на трубу.')
    for (const sprinkler of doc.sprinklers) issues.push({ text: 'Дождеватель не стоит на трубе.', kind: 'sprinkler', id: sprinkler.id })
    for (const drip of doc.drips) issues.push({ text: 'Капельная трубка не стоит на трубе.', kind: 'drip', id: drip.id })
    for (const valve of doc.valves) issues.push({ text: 'Клапан не стоит на трубе.', kind: 'valve', id: valve.id })
    pushDoseWarnings(doc, warnings)
    return blank(doc, warnings, totalFlowLph, issues)
  }

  const { nodes, index } = cluster(flat)
  const pipeById = new Map(doc.pipes.map((pipe) => [pipe.id, pipe]))
  const roleOf = (pipeId: string, parentStation: string, childStation: string): PipeRole => {
    const set = pipeById.get(pipeId)?.role
    if (set === 'main' || set === 'zone') return set
    if (parentStation !== '' && childStation !== '') return 'zone'
    return 'main'
  }
  const edges: Edge[] = []
  let cursor = 0
  for (const pipe of doc.pipes) {
    for (let i = 0; i < pipe.points.length - 1; i++) {
      const a = index[cursor + i]
      const b = index[cursor + i + 1]
      const p1 = pipe.points[i]
      const p2 = pipe.points[i + 1]
      if (a !== b) {
        edges.push({
          key: `${pipe.id}:${i}`,
          pipeId: pipe.id,
          a,
          b,
          p1,
          p2,
          lengthPx: dist(p1, p2),
        })
      }
    }
    cursor += pipe.points.length
  }

  const demand = new Map<number, number>()
  const tails: Analysis['tails'] = []
  let loose = 0
  for (const sprinkler of doc.sprinklers) {
    const hit = hitchPoint(sprinkler, nodes, doc.pxPerMeter)
    if (!hit) {
      loose += 1
      issues.push({ text: 'Дождеватель не стоит на трубе.', kind: 'sprinkler', id: sprinkler.id })
      continue
    }
    demand.set(hit.node.id, (demand.get(hit.node.id) ?? 0) + sprinkler.flowLph)
    if (hit.tail && doc.pxPerMeter) {
      tails.push({ a: { x: hit.node.x, y: hit.node.y }, b: { x: sprinkler.x, y: sprinkler.y }, lengthM: hit.distance / doc.pxPerMeter })
    }
  }
  if (loose) warnings.push(loose === 1 ? 'Один дождеватель не стоит на трубе и в расход сети не входит.' : `${loose} дождевателей не стоят на трубе и в расход сети не входят.`)

  const feed = dripFeed(doc, nodes)
  let looseDrip = 0
  for (const drip of doc.drips) {
    const node = feed.nodeOf.get(drip.id)
    const flow = dripMeasure(drip, doc.pxPerMeter).flowLph
    const reached = node !== undefined
    if (!reached || (drip.bare !== true && flow <= 0)) {
      looseDrip += 1
      issues.push({ text: 'Капельная трубка не стоит на трубе.', kind: 'drip', id: drip.id })
      continue
    }
    if (flow > 0) demand.set(node, (demand.get(node) ?? 0) + flow)
  }
  if (looseDrip) warnings.push(looseDrip === 1 ? 'Капельная трубка не стоит на трубе и в расход сети не входит.' : `${looseDrip} капельных трубок не стоят на трубе и в расход сети не входят.`)

  const adj = new Map<number, Edge[]>()
  for (const edge of edges) {
    const left = adj.get(edge.a) ?? []
    left.push(edge)
    adj.set(edge.a, left)
    const right = adj.get(edge.b) ?? []
    right.push(edge)
    adj.set(edge.b, right)
  }

  const sourceHit = doc.source ? nearest(doc.source, nodes) : null
  const sourceId = sourceHit && sourceHit.distance <= SNAP_PX ? sourceHit.node.id : null
  if (!doc.source || sourceId === null) warnings.push('Поставьте источник на трубу.')

  const segments: SegmentResult[] = []
  let marks: Analysis['marks'] = []
  let pressureMarks: PressureMark[] = []
  const pipeTotals = new Map<number, { odMm: number; name: string; lengthM: number }>()
  let connectedFlowLph = 0
  let stations: Analysis['stations'] = []
  const sourceHeadM = doc.source ? barToHeadM(doc.source.pressureBar) : null
  let minResidualHeadM: number | null = null
  const series = seriesById(doc.pipeSeries)

  if (sourceId === null) {
    for (const edge of edges) segments.push(segment(doc, edge, null, null, 'unfed', roleOf(edge.pipeId, '', '')))
  } else {
    const parent = new Map<number, number | null>()
    const seen = new Set<number>([sourceId])
    const edgeByChild = new Map<number, Edge>()
    const queue = [sourceId]
    parent.set(sourceId, null)
    let cycle = false
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of adj.get(current) ?? []) {
        const next = edge.a === current ? edge.b : edge.a
        if (!seen.has(next)) {
          seen.add(next)
          parent.set(next, current)
          edgeByChild.set(next, edge)
          queue.push(next)
        } else if (parent.get(current) !== next) {
          cycle = true
        }
      }
    }
    if (cycle) warnings.push('В сети есть петля. Диаметры посчитаны по дереву от источника.')

    const children = new Map<number, number[]>()
    for (const [node, above] of parent) {
      if (above === null) continue
      const list = children.get(above) ?? []
      list.push(node)
      children.set(above, list)
    }
    const pipeValve = new Map<string, string>()
    for (const pipe of doc.pipes) {
      if (pipe.valveId) pipeValve.set(pipe.id, pipe.valveId)
    }
    const valveAt = new Map<number, string>()
    const valveGroups = new Map<number, string[]>()
    let looseValve = 0
    let stackedValve = false
    for (const valve of doc.valves) {
      const hit = nearest(valveAnchor(doc, valve), nodes)
      if (!hit || hit.distance > SNAP_PX || !seen.has(hit.node.id)) {
        looseValve += 1
        issues.push({ text: 'Клапан не стоит на трубе.', kind: 'valve', id: valve.id })
        continue
      }
      const list = valveGroups.get(hit.node.id) ?? []
      list.push(valve.id)
      valveGroups.set(hit.node.id, list)
    }
    for (const [nodeId, ids] of valveGroups) {
      if (ids.length === 1) {
        valveAt.set(nodeId, ids[0])
        continue
      }
      const owned = new Set<string>()
      for (const edge of adj.get(nodeId) ?? []) {
        const tag = pipeValve.get(edge.pipeId)
        if (tag && ids.includes(tag)) owned.add(tag)
      }
      if (owned.size > 0) continue
      stackedValve = true
      valveAt.set(nodeId, ids[0])
    }
    if (looseValve) warnings.push(looseValve === 1 ? 'Клапан не стоит на трубе.' : `${looseValve} клапанов не стоят на трубе.`)
    if (stackedValve) warnings.push('Два клапана на одной точке считаются одним.')

    const stationOf = new Map<number, string>()
    const assign = (node: number, station: string) => {
      const next = valveAt.get(node) ?? station
      stationOf.set(node, next)
      for (const child of children.get(node) ?? []) {
        const edge = edgeByChild.get(child)
        const tag = edge ? pipeValve.get(edge.pipeId) : undefined
        const here = valveGroups.get(node) ?? []
        assign(child, tag && here.includes(tag) ? tag : next)
      }
    }
    assign(sourceId, '')

    let nested = false
    for (const node of valveAt.keys()) {
      const above = parent.get(node)
      if (above !== null && above !== undefined && stationOf.get(above)) nested = true
    }
    if (nested) warnings.push('Клапан стоит за другим клапаном. Труба считается по наибольшей станции, расходы станций не складываются.')
    if (valveAt.size || valveGroups.size) {
      let open = false
      for (const [nodeId, flow] of demand) {
        if (flow > 0 && stationOf.get(nodeId) === '') open = true
      }
      if (open) warnings.push('Часть полива не за клапаном и входит в каждую станцию.')
    }

    const part = new Map<number, Map<string, number>>()
    const walkParts = (node: number): Map<string, number> => {
      const totals = new Map<string, number>()
      const own = demand.get(node) ?? 0
      if (own > 0) {
        const station = stationOf.get(node) ?? ''
        totals.set(station, own)
      }
      for (const child of children.get(node) ?? []) {
        for (const [key, value] of walkParts(child)) totals.set(key, (totals.get(key) ?? 0) + value)
      }
      part.set(node, totals)
      return totals
    }
    const rootParts = walkParts(sourceId)
    connectedFlowLph = designFlow(rootParts)

    stations = withStationRuntime(doc, nodes, seen, stationOf, feed, doc.valves.flatMap((valve) => {
      const hit = nearest(valveAnchor(doc, valve), nodes)
      if (!hit || !seen.has(hit.node.id)) return []
      const owns = valveAt.get(hit.node.id) === valve.id || [...stationOf.values()].includes(valve.id)
      if (!owns) return []
      let flowLph = 0
      for (const [nodeId, flow] of demand) {
        if (stationOf.get(nodeId) === valve.id) flowLph += flow
      }
      return [{ id: valve.id, name: valve.name, flowLph }]
    }))

    const headAt = new Map<number, number>()
    if (sourceHeadM !== null) headAt.set(sourceId, sourceHeadM)
    const sized = new Set<string>()
    const order = [sourceId]
    for (let i = 0; i < order.length; i++) {
      const current = order[i]
      for (const child of children.get(current) ?? []) {
        const edge = edgeByChild.get(child)
        if (!edge) continue
        const flow = designFlow(part.get(child) ?? new Map())
        const picked = pickPipe(flow, doc.pipeSeries)
        if (picked.overspeed) warnings.push(`На участке расход ${Math.round(flow)} л/ч не укладывается в ${series.sizes.at(-1)?.name} при 1,5 м/с.`)
        const lengthM = doc.pxPerMeter ? edge.lengthPx / doc.pxPerMeter : null
        if (lengthM !== null) {
          const row = pipeTotals.get(picked.pipe.odMm) ?? { odMm: picked.pipe.odMm, name: picked.pipe.name, lengthM: 0 }
          row.lengthM += lengthM
          pipeTotals.set(picked.pipe.odMm, row)
        }
        const loss = lengthM === null ? null : headLossM(flow, picked.pipe.idMm, lengthM)
        const start = headAt.get(current)
        const residual = loss === null || start === undefined ? null : start - loss
        if (residual !== null) headAt.set(child, residual)
        sized.add(edge.key)
        const childNode = nodes[child]
        const downB = !childNode || dist(edge.p2, childNode) <= dist(edge.p1, childNode)
        segments.push({
          pipeId: edge.pipeId,
          a: edge.p1,
          b: edge.p2,
          lengthM,
          flowLph: flow,
          downB,
          odMm: picked.pipe.odMm,
          idMm: picked.pipe.idMm,
          name: picked.pipe.name,
          velocity: picked.velocity,
          headLossM: loss,
          residualHeadM: residual,
          status: 'ok',
          role: roleOf(edge.pipeId, stationOf.get(current) ?? '', stationOf.get(child) ?? ''),
          stationId: stationOf.get(child) || stationOf.get(current) || '',
        })
        order.push(child)
      }
    }

    let hanging = false
    for (const edge of edges) {
      if (sized.has(edge.key)) continue
      const status = seen.has(edge.a) && seen.has(edge.b) ? 'cycle' : 'unfed'
      if (status === 'unfed') hanging = true
      segments.push(segment(doc, edge, null, null, status, roleOf(edge.pipeId, '', '')))
    }
    if (hanging) warnings.push('Часть труб не соединена с источником.')
    marks = stationMarks(doc, nodes, seen, stationOf, feed)

    for (const [nodeId, flow] of demand) {
      if (flow <= 0 || !headAt.has(nodeId)) continue
      const head = headAt.get(nodeId)!
      if (minResidualHeadM === null || head < minResidualHeadM) minResidualHeadM = head
    }
    if (minResidualHeadM !== null && minResidualHeadM < barToHeadM(MIN_SPRINKLER_BAR) - 1e-6) {
      warnings.push('На дальнем дождевателе после потерь в трубах остаётся меньше 2 бар.')
    }
    for (const sprinkler of doc.sprinklers) {
      const hit = hitchPoint(sprinkler, nodes, doc.pxPerMeter)
      if (!hit || !seen.has(hit.node.id)) continue
      const head = headAt.get(hit.node.id)
      if (head === undefined) continue
      const raw = headMToBar(head)
      pressureMarks.push({
        id: sprinkler.id,
        x: sprinkler.x,
        y: sprinkler.y,
        bar: Math.round(raw * 10) / 10,
        low: raw < MIN_SPRINKLER_BAR - 1e-6,
      })
    }
  }

  if (doc.source?.flowLimitLph && connectedFlowLph > doc.source.flowLimitLph + 1e-6) {
    warnings.push(`Расход сети ${Math.round(connectedFlowLph)} л/ч выше лимита источника ${Math.round(doc.source.flowLimitLph)} л/ч.`)
  }

  pushDoseWarnings(doc, warnings)
  const zones = zoneRows(doc)
  const fitted = fittingsOf(doc, nodes, segments, sourceId, feed)
  return {
    segments,
    pipes: [...pipeTotals.values()].sort((a, b) => a.odMm - b.odMm),
    nozzles: nozzleRows(doc),
    zones,
    totalFlowLph,
    connectedFlowLph,
    sourceHeadM,
    minResidualHeadM,
    programMin: programMinutes(zones, stations),
    clockMin: clockMinutes(zones, stations),
    stations,
    drips: dripSummary(doc),
    fittings: fitted.rows,
    fittingMarks: fitted.marks,
    tails,
    trench: trenchRow(doc),
    warnings: unique(warnings),
    issues,
    marks,
    pressureMarks,
  }
}

function withStationRuntime(
  doc: Doc,
  nodes: Node[],
  seen: Set<number>,
  stationOf: Map<number, string>,
  feed: DripFeed,
  stations: { id: string; name: string; flowLph: number }[],
): Analysis['stations'] {
  const zones = zoneRows(doc)
  const hits: { station: string; zoneIds: string[] }[] = []
  const take = (point: Point, station: string | undefined) => {
    if (!station) return
    hits.push({
      station,
      zoneIds: doc.zones.filter((zone) => pointInZone(point, zone.points, zone.holes)).map((zone) => zone.id),
    })
  }
  for (const sprinkler of doc.sprinklers) {
    const hit = hitchPoint(sprinkler, nodes, doc.pxPerMeter)
    if (!hit || !seen.has(hit.node.id)) continue
    take(sprinkler, stationOf.get(hit.node.id))
  }
  for (const drip of doc.drips) {
    if (dripMeasure(drip, doc.pxPerMeter).flowLph <= 0) continue
    const nodeId = feed.nodeOf.get(drip.id)
    if (nodeId === undefined || !seen.has(nodeId)) continue
    take(centroid(drip.points), stationOf.get(nodeId))
  }
  const byId = new Map(zones.map((zone) => [zone.id, zone]))
  return stations.map((station) => {
    const mine = hits.filter((item) => item.station === station.id)
    const touched: Analysis['zones'] = []
    let unknown = false
    for (const item of mine) {
      for (const id of item.zoneIds) {
        const zone = byId.get(id)
        if (!zone) continue
        if (zone.runtimeMin === null) unknown = true
        else if (!touched.some((row) => row.id === zone.id)) touched.push(zone)
      }
    }
    const best = govern(touched)
    if (unknown && !best) return { ...station, runtimeMin: null, cycles: null, soakMin: 0 }
    if (!best) return { ...station, runtimeMin: 0, cycles: 0, soakMin: 0 }
    return {
      ...station,
      runtimeMin: best.runtimeMin,
      cycles: unknown ? null : best.cycles,
      soakMin: best.soakMin,
    }
  })
}

function segment(doc: Doc, edge: Edge, flow: number | null, name: string | null, status: SegmentResult['status'], role: PipeRole): SegmentResult {
  return {
    pipeId: edge.pipeId,
    a: edge.p1,
    b: edge.p2,
    lengthM: doc.pxPerMeter ? edge.lengthPx / doc.pxPerMeter : null,
    flowLph: flow,
    odMm: null,
    idMm: null,
    name,
    velocity: null,
    headLossM: null,
    residualHeadM: null,
    status,
    role,
    stationId: '',
  }
}

function valveAnchor(doc: Doc, valve: Valve): Point {
  if (!valve.boxId) return valve
  const box = (doc.boxes ?? []).find((item) => item.id === valve.boxId)
  return box ?? valve
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

/** Площадь крон на клумбе или в кустах. По ней считается мм/ч капельного полива. */
function canopyM2(zone: Zone, doc: Doc): number | null {
  if (!isDripKind(zone.kind)) return null
  const plants = (doc.plants ?? []).filter((plant) => pointInZone(plant, zone.points, zone.holes))
  if (!plants.length) return null
  let area = 0
  for (const plant of plants) {
    if (plant.radiusM > 0) area += Math.PI * plant.radiusM * plant.radiusM
  }
  return area > 0.05 ? area : null
}

export function dripMeasure(drip: Drip, pxPerMeter: number | null): { lengthM: number | null; emitters: number; flowLph: number } {
  let lengthPx = 0
  for (let i = 0; i < drip.points.length - 1; i++) lengthPx += dist(drip.points[i], drip.points[i + 1])
  if (!pxPerMeter) return { lengthM: null, emitters: 0, flowLph: 0 }
  const lengthM = lengthPx / pxPerMeter
  if (drip.bare) return { lengthM, emitters: 0, flowLph: 0 }
  const emitters = Math.max(1, Math.round(lengthM / drip.spacingM))
  return { lengthM, emitters, flowLph: emitters * drip.emitterLph }
}

type DripFeed = {
  nodeOf: Map<string, number>
  onPipe: Set<string>
  rootOf: Map<string, string>
}

function polylinesTouch(a: Point[], b: Point[]): boolean {
  for (const point of a) {
    for (let i = 0; i < b.length - 1; i++) {
      if (closestOnSegment(point, b[i], b[i + 1]).distance <= SNAP_PX) return true
    }
  }
  for (const point of b) {
    for (let i = 0; i < a.length - 1; i++) {
      if (closestOnSegment(point, a[i], a[i + 1]).distance <= SNAP_PX) return true
    }
  }
  return false
}

function pipeTouch(drip: Drip, nodes: Node[]): number | null {
  let best: { id: number; distance: number } | null = null
  for (const point of drip.points) {
    const hit = nearest(point, nodes)
    if (!hit || hit.distance > SNAP_PX) continue
    if (!best || hit.distance < best.distance) best = { id: hit.node.id, distance: hit.distance }
  }
  return best?.id ?? null
}

/** Капля достаёт до трубы сама или через цепочку трубок. Корень — трубка, которая стоит на узле. */
function dripFeed(doc: Doc, nodes: Node[]): DripFeed {
  const onPipe = new Map<string, number>()
  for (const drip of doc.drips) {
    const node = pipeTouch(drip, nodes)
    if (node !== null) onPipe.set(drip.id, node)
  }
  const touch = new Map<string, string[]>()
  for (let i = 0; i < doc.drips.length; i++) {
    for (let j = i + 1; j < doc.drips.length; j++) {
      if (!polylinesTouch(doc.drips[i].points, doc.drips[j].points)) continue
      const left = touch.get(doc.drips[i].id) ?? []
      left.push(doc.drips[j].id)
      touch.set(doc.drips[i].id, left)
      const right = touch.get(doc.drips[j].id) ?? []
      right.push(doc.drips[i].id)
      touch.set(doc.drips[j].id, right)
    }
  }
  const nodeOf = new Map<string, number>()
  const rootOf = new Map<string, string>()
  const queue = [...onPipe.keys()]
  for (const id of queue) {
    nodeOf.set(id, onPipe.get(id)!)
    rootOf.set(id, id)
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const next of touch.get(id) ?? []) {
      if (rootOf.has(next)) continue
      rootOf.set(next, rootOf.get(id)!)
      nodeOf.set(next, nodeOf.get(id)!)
      queue.push(next)
    }
  }
  return { nodeOf, onPipe: new Set(onPipe.keys()), rootOf }
}

function stationMarks(
  doc: Doc,
  nodes: Node[],
  seen: Set<number>,
  stationOf: Map<number, string>,
  feed: DripFeed,
): Analysis['marks'] {
  const marks: Analysis['marks'] = []
  for (const sprinkler of doc.sprinklers) {
    const hit = hitchPoint(sprinkler, nodes, doc.pxPerMeter)
    if (!hit || !seen.has(hit.node.id)) continue
    const stationId = stationOf.get(hit.node.id) ?? ''
    if (!stationId) continue
    marks.push({ id: sprinkler.id, kind: 'sprinkler', stationId })
  }
  for (const drip of doc.drips) {
    const nodeId = feed.nodeOf.get(drip.id)
    if (nodeId === undefined || !seen.has(nodeId)) continue
    const stationId = stationOf.get(nodeId) ?? ''
    if (!stationId) continue
    marks.push({ id: drip.id, kind: 'drip', stationId })
  }
  return marks
}

function dripSummary(doc: Doc): Analysis['drips'] {
  let lengthM = 0
  let emitters = 0
  let flowLph = 0
  let known = false
  for (const drip of doc.drips) {
    const row = dripMeasure(drip, doc.pxPerMeter)
    flowLph += row.flowLph
    emitters += row.emitters
    if (row.lengthM !== null) {
      known = true
      lengthM += row.lengthM
    }
  }
  return { lengthM: known ? lengthM : null, emitters, flowLph }
}

function centroid(points: Point[]): Point {
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

function designFlow(parts: Map<string, number>): number {
  let open = 0
  let largest = 0
  let hasStation = false
  for (const [key, value] of parts) {
    if (key === '') open += value
    else {
      hasStation = true
      if (value > largest) largest = value
    }
  }
  return hasStation ? open + largest : open
}

function fittingsOf(
  doc: Doc,
  nodes: Node[],
  segments: SegmentResult[],
  sourceId: number | null,
  feed: DripFeed,
): { rows: Analysis['fittings']; marks: FittingMark[] } {
  const counts = new Map<string, number>()
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
  const marks: FittingMark[] = []
  const arms = new Map<number, { node: number; od: number }[]>()
  for (const segment of segments) {
    if (segment.status !== 'ok' || segment.odMm === null) continue
    const left = nearest(segment.a, nodes)
    const right = nearest(segment.b, nodes)
    if (!left || !right || left.node.id === right.node.id) continue
    const ab = arms.get(left.node.id) ?? []
    ab.push({ node: right.node.id, od: segment.odMm })
    arms.set(left.node.id, ab)
    const ba = arms.get(right.node.id) ?? []
    ba.push({ node: left.node.id, od: segment.odMm })
    arms.set(right.node.id, ba)
  }

  const sprinklerNodes = new Set<number>()
  for (const sprinkler of doc.sprinklers) {
    const hit = nearest(sprinkler, nodes)
    if (hit && hit.distance <= SNAP_PX) sprinklerNodes.add(hit.node.id)
  }
  const hydrantNodes = new Set<number>()
  let hydrants = 0
  for (const hydrant of doc.hydrants ?? []) {
    const hit = nearest(hydrant, nodes)
    if (!hit || hit.distance > SNAP_PX) continue
    hydrantNodes.add(hit.node.id)
    hydrants += 1
  }
  if (hydrants) counts.set('Гидрант', hydrants)
  const dripNodes = new Set<number>()
  let dripStarts = 0
  for (const drip of doc.drips) {
    if (!feed.onPipe.has(drip.id)) continue
    const node = feed.nodeOf.get(drip.id)
    if (node === undefined) continue
    const own = dripMeasure(drip, doc.pxPerMeter).flowLph
    let feeds = own > 0
    if (!feeds) {
      for (const other of doc.drips) {
        if (other.id === drip.id || feed.onPipe.has(other.id)) continue
        if (feed.rootOf.get(other.id) !== drip.id) continue
        if (dripMeasure(other, doc.pxPerMeter).flowLph <= 0) continue
        feeds = true
        break
      }
    }
    if (!feeds) continue
    dripNodes.add(node)
    dripStarts += 1
  }
  if (dripStarts) counts.set('Старт капельной трубки', dripStarts)

  for (const [nodeId, list] of arms) {
    const node = nodes[nodeId]
    if (!node) continue
    const place = (kind: FittingMark['kind'], name: string, rotationDeg: number) => {
      add(name)
      marks.push({ x: node.x, y: node.y, rotationDeg, kind, name })
    }
    if (list.length === 1) {
      if (nodeId === sourceId || sprinklerNodes.has(nodeId) || dripNodes.has(nodeId) || hydrantNodes.has(nodeId)) continue
      const other = nodes[list[0].node]
      place('cap', `Заглушка ПЭ ${list[0].od}`, other ? bearingDeg(node, other) : 0)
      continue
    }
    if (list.length === 2) {
      const [first, second] = list
      const turn = angleDeg(nodes[first.node], node, nodes[second.node])
      if (first.od === second.od && Math.abs(turn - 180) <= 15) continue
      const aim = bisectorDeg(node, nodes[first.node], nodes[second.node])
      if (first.od === second.od) place('elbow', `Угол ПЭ ${first.od}`, aim)
      else place('reducer', `Переход ПЭ ${Math.max(first.od, second.od)}×${Math.min(first.od, second.od)}`, aim)
      continue
    }
    const word = list.length === 3 ? 'Тройник' : list.length === 4 ? 'Крестовина' : 'Узел'
    const kind = list.length === 3 ? 'tee' : list.length === 4 ? 'cross' : 'node'
    place(kind, `${word} ${sizeLabel(list.map((item) => item.od))}`, 0)
  }

  return { rows: [...counts.entries()].map(([name, count]) => ({ name, count })), marks }
}

function bisectorDeg(node: Node, a: Node | undefined, b: Node | undefined): number {
  if (!a || !b) return 0
  const d1 = Math.hypot(a.x - node.x, a.y - node.y) || 1
  const d2 = Math.hypot(b.x - node.x, b.y - node.y) || 1
  const ux = (a.x - node.x) / d1 + (b.x - node.x) / d2
  const uy = (a.y - node.y) / d1 + (b.y - node.y) / d2
  if (ux === 0 && uy === 0) return bearingDeg(node, a)
  return bearingDeg(node, { x: node.x + ux, y: node.y + uy })
}

function sizeLabel(sizes: number[]): string {
  const unique = [...new Set(sizes)]
  if (unique.length === 1) return `ПЭ ${unique[0]}`
  return `ПЭ ${sizes.slice().sort((a, b) => b - a).join('×')}`
}

function angleDeg(a: Node, b: Node, c: Node): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const denom = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (denom === 0) return 180
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / denom))
  return (Math.acos(cos) * 180) / Math.PI
}
