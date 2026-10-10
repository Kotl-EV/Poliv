import { climateFactor, cyclePlan, defaultDose, intakeMmH, SNAP_PX } from './doc.ts'
import { dist, pointInZone, zoneAreaPx } from './geom.ts'
import { nozzleById } from './nozzles.ts'
import { barToHeadM, headLossM, MIN_SPRINKLER_BAR, pickPipe, seriesById } from './pipes.ts'
import type { Analysis, Doc, Drip, Point, SegmentResult } from './types.ts'

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

function zoneRows(doc: Doc): Analysis['zones'] {
  return doc.zones.map((zone) => {
    const areaM2 = doc.pxPerMeter ? zoneAreaPx(zone.points, zone.holes) / (doc.pxPerMeter * doc.pxPerMeter) : null
    let flow = 0
    for (const sprinkler of doc.sprinklers) {
      if (pointInZone(sprinkler, zone.points, zone.holes)) flow += sprinkler.flowLph
    }
    for (const drip of doc.drips) {
      if (pointInZone(centroid(drip.points), zone.points, zone.holes)) flow += dripMeasure(drip, doc.pxPerMeter).flowLph
    }
    const precipMmH = areaM2 && areaM2 > 0 ? flow / areaM2 : null
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
    const row = map.get(sprinkler.nozzleId) ?? { nozzleId: sprinkler.nozzleId, name: nozzle.name, count: 0, flowLph: 0 }
    row.count += 1
    row.flowLph += sprinkler.flowLph
    map.set(sprinkler.nozzleId, row)
  }
  return [...map.values()]
}

function blank(doc: Doc, warnings: string[], totalFlowLph: number): Analysis {
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
    trench: trenchRow(doc),
    warnings,
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
    pushDoseWarnings(doc, warnings)
    return blank(doc, warnings, totalFlowLph)
  }

  const { nodes, index } = cluster(flat)
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
  let loose = 0
  for (const sprinkler of doc.sprinklers) {
    const hit = nearest(sprinkler, nodes)
    if (!hit || hit.distance > SNAP_PX) {
      loose += 1
      continue
    }
    demand.set(hit.node.id, (demand.get(hit.node.id) ?? 0) + sprinkler.flowLph)
  }
  if (loose) warnings.push(loose === 1 ? 'Один дождеватель не стоит на трубе и в расход сети не входит.' : `${loose} дождевателей не стоят на трубе и в расход сети не входят.`)

  let looseDrip = 0
  for (const drip of doc.drips) {
    const hit = nearest(drip.points[0], nodes)
    const flow = dripMeasure(drip, doc.pxPerMeter).flowLph
    if (!hit || hit.distance > SNAP_PX || flow <= 0) {
      looseDrip += 1
      continue
    }
    demand.set(hit.node.id, (demand.get(hit.node.id) ?? 0) + flow)
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
  const pipeTotals = new Map<number, { odMm: number; name: string; lengthM: number }>()
  let connectedFlowLph = 0
  let stations: Analysis['stations'] = []
  const sourceHeadM = doc.source ? barToHeadM(doc.source.pressureBar) : null
  let minResidualHeadM: number | null = null
  const series = seriesById(doc.pipeSeries)

  if (sourceId === null) {
    for (const edge of edges) segments.push(segment(doc, edge, null, null, 'unfed'))
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
    const valveAt = new Map<number, string>()
    let looseValve = 0
    let stackedValve = false
    for (const valve of doc.valves) {
      const hit = nearest(valve, nodes)
      if (!hit || hit.distance > SNAP_PX || !seen.has(hit.node.id)) {
        looseValve += 1
        continue
      }
      if (valveAt.has(hit.node.id)) stackedValve = true
      else valveAt.set(hit.node.id, valve.id)
    }
    if (looseValve) warnings.push(looseValve === 1 ? 'Клапан не стоит на трубе.' : `${looseValve} клапанов не стоят на трубе.`)
    if (stackedValve) warnings.push('Два клапана на одной точке считаются одним.')

    const stationOf = new Map<number, string>()
    const assign = (node: number, station: string) => {
      const next = valveAt.get(node) ?? station
      stationOf.set(node, next)
      for (const child of children.get(node) ?? []) assign(child, next)
    }
    assign(sourceId, '')

    let nested = false
    for (const node of valveAt.keys()) {
      const above = parent.get(node)
      if (above !== null && above !== undefined && stationOf.get(above)) nested = true
    }
    if (nested) warnings.push('Клапан стоит за другим клапаном. Труба считается по наибольшей станции, расходы станций не складываются.')
    if (valveAt.size) {
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

    stations = withStationRuntime(doc, nodes, seen, stationOf, doc.valves.flatMap((valve) => {
      const hit = nearest(valve, nodes)
      if (!hit || valveAt.get(hit.node.id) !== valve.id) return []
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
        segments.push({
          pipeId: edge.pipeId,
          a: edge.p1,
          b: edge.p2,
          lengthM,
          flowLph: flow,
          odMm: picked.pipe.odMm,
          idMm: picked.pipe.idMm,
          name: picked.pipe.name,
          velocity: picked.velocity,
          headLossM: loss,
          residualHeadM: residual,
          status: 'ok',
        })
        order.push(child)
      }
    }

    let hanging = false
    for (const edge of edges) {
      if (sized.has(edge.key)) continue
      const status = seen.has(edge.a) && seen.has(edge.b) ? 'cycle' : 'unfed'
      if (status === 'unfed') hanging = true
      segments.push(segment(doc, edge, null, null, status))
    }
    if (hanging) warnings.push('Часть труб не соединена с источником.')

    for (const [nodeId, flow] of demand) {
      if (flow <= 0 || !headAt.has(nodeId)) continue
      const head = headAt.get(nodeId)!
      if (minResidualHeadM === null || head < minResidualHeadM) minResidualHeadM = head
    }
    if (minResidualHeadM !== null && minResidualHeadM < barToHeadM(MIN_SPRINKLER_BAR) - 1e-6) {
      warnings.push('На дальнем дождевателе после потерь в трубах остаётся меньше 2 бар.')
    }
  }

  if (doc.source?.flowLimitLph && connectedFlowLph > doc.source.flowLimitLph + 1e-6) {
    warnings.push(`Расход сети ${Math.round(connectedFlowLph)} л/ч выше лимита источника ${Math.round(doc.source.flowLimitLph)} л/ч.`)
  }

  pushDoseWarnings(doc, warnings)
  const zones = zoneRows(doc)
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
    fittings: fittingsOf(doc, nodes, segments, sourceId),
    trench: trenchRow(doc),
    warnings: unique(warnings),
  }
}

function withStationRuntime(
  doc: Doc,
  nodes: Node[],
  seen: Set<number>,
  stationOf: Map<number, string>,
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
    const hit = nearest(sprinkler, nodes)
    if (!hit || hit.distance > SNAP_PX || !seen.has(hit.node.id)) continue
    take(sprinkler, stationOf.get(hit.node.id))
  }
  for (const drip of doc.drips) {
    if (dripMeasure(drip, doc.pxPerMeter).flowLph <= 0) continue
    const hit = nearest(drip.points[0], nodes)
    if (!hit || hit.distance > SNAP_PX || !seen.has(hit.node.id)) continue
    take(centroid(drip.points), stationOf.get(hit.node.id))
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

function segment(doc: Doc, edge: Edge, flow: number | null, name: string | null, status: SegmentResult['status']): SegmentResult {
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
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

export function dripMeasure(drip: Drip, pxPerMeter: number | null): { lengthM: number | null; emitters: number; flowLph: number } {
  let lengthPx = 0
  for (let i = 0; i < drip.points.length - 1; i++) lengthPx += dist(drip.points[i], drip.points[i + 1])
  if (!pxPerMeter) return { lengthM: null, emitters: 0, flowLph: 0 }
  const lengthM = lengthPx / pxPerMeter
  const emitters = Math.max(1, Math.round(lengthM / drip.spacingM))
  return { lengthM, emitters, flowLph: emitters * drip.emitterLph }
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

function fittingsOf(doc: Doc, nodes: Node[], segments: SegmentResult[], sourceId: number | null): Analysis['fittings'] {
  const counts = new Map<string, number>()
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
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
  const dripNodes = new Set<number>()
  let dripStarts = 0
  for (const drip of doc.drips) {
    const hit = nearest(drip.points[0], nodes)
    if (!hit || hit.distance > SNAP_PX || dripMeasure(drip, doc.pxPerMeter).flowLph <= 0) continue
    dripNodes.add(hit.node.id)
    dripStarts += 1
  }
  if (dripStarts) counts.set('Старт капельной трубки', dripStarts)

  for (const [nodeId, list] of arms) {
    const node = nodes[nodeId]
    if (!node) continue
    if (list.length === 1) {
      if (nodeId === sourceId || sprinklerNodes.has(nodeId) || dripNodes.has(nodeId)) continue
      add(`Заглушка ПЭ ${list[0].od}`)
      continue
    }
    if (list.length === 2) {
      const [first, second] = list
      const turn = angleDeg(nodes[first.node], node, nodes[second.node])
      if (first.od === second.od && Math.abs(turn - 180) <= 15) continue
      if (first.od === second.od) add(`Угол ПЭ ${first.od}`)
      else add(`Переход ПЭ ${Math.max(first.od, second.od)}×${Math.min(first.od, second.od)}`)
      continue
    }
    const kind = list.length === 3 ? 'Тройник' : list.length === 4 ? 'Крестовина' : 'Узел'
    add(`${kind} ${sizeLabel(list.map((item) => item.od))}`)
  }

  return [...counts.entries()].map(([name, count]) => ({ name, count }))
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
