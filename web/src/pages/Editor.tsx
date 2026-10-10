import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { analyze } from '@shared/analyze.ts'
import { brushOutline, clipRegions, mirrorAcross, splitRegion, type BrushTip, type ClipOp } from '@shared/clip.ts'
import { asClimate, asSlope, asSoil, defaultDose, emptyDoc, SNAP_PX } from '@shared/doc.ts'
import { exampleDoc } from '@shared/example.ts'
import {
  aimSprinkler,
  alignShift,
  circlePoints,
  closestOnSegment,
  controlFromHandle,
  boundsOf,
  centroid,
  dist,
  flattenRing,
  mapToSize,
  midpoint,
  mirrorAround,
  nearestScreen,
  normDeg,
  offsetRing,
  orthoFrom,
  pickSprinkler,
  outlineOf,
  rectPoints,
  ringLength,
  rotateAround,
  scaleAround,
  snapToGrid,
  withinScreen,
  pointInZone,
  zoneAreaPx,
  type AlignSide,
} from '@shared/geom.ts'
import { fixtureGlyph, fixtureKinds, fixtureSpec, FIXTURE_GROUPS, groupOf } from '@shared/fixtures.ts'
import { DEFAULT_PPM, DEFAULT_SHEET_M, gridStepM, hatchOf, hatchesFor, HATCHES, INKS, isDripKind, isSprayKind, isWetKind, SURFACES, surfaceOf } from '@shared/landscape.ts'
import { crownFill, formOf, formsFor, plantGlyph, plantPaint } from '@shared/plants.ts'
import { DEFAULT_SHEET_LAYERS, PAPERS, type PaperId, type SheetLayers } from '@shared/sheet.ts'
import { nozzleById, nozzlesOf, rotorMark, type Nozzle, type NozzleKind, type NozzlePattern } from '@shared/nozzles.ts'
import { SERIES, type PipeSeriesId } from '@shared/pipes.ts'
import type { Doc, Drip, Fixture, FixtureKind, HatchId, Hydrant, Measure, Note, Pipe, PipeRole, Plant, PlantForm, PlantKind, Point, Sleeve, Source, Sprinkler, Valve, ValveBox, Zone, ZoneKind } from '@shared/types.ts'
import { api, type User } from '../api'
import { draftHeadFlow, joinableHeads, sleeveLengthM, stickTarget, valveSlot } from '@shared/join.ts'
import { layoutIrrigation } from '@shared/plan.ts'
import { Board, readHit, worldPoint, type Hit, type View } from '../editor/Board'
import { exportProjectSheets } from '../pdf/exportSheet'
import { configurePdfWorker, renderPlanPdf } from '../pdf/readPlan'
import { GearBlock, Spec } from '../editor/Spec'

configurePdfWorker(workerUrl)

type Tool = 'select' | 'scale' | 'zone' | 'rect' | 'circle' | 'brush' | 'text' | 'tree' | 'bush' | 'fixture' | 'dim' | 'sprinkler' | 'pipe' | 'valve' | 'box' | 'hydrant' | 'sleeve' | 'drip' | 'source'
type Step = 'draw' | 'irrig' | 'layout' | 'spec'
type Sel = { kind: 'sprinkler' | 'zone' | 'pipe' | 'source' | 'valve' | 'box' | 'hydrant' | 'sleeve' | 'drip' | 'note' | 'plant' | 'fixture' | 'dim'; id?: string } | null

type Clip =
  | { kind: 'zone'; item: Zone }
  | { kind: 'plant'; item: Plant }
  | { kind: 'fixture'; item: Fixture }
  | { kind: 'note'; item: Note }
  | { kind: 'sprinkler'; item: Sprinkler }
  | { kind: 'valve'; item: Valve }
  | { kind: 'box'; item: ValveBox }
  | { kind: 'hydrant'; item: Hydrant }
  | { kind: 'sleeve'; item: Sleeve }
  | { kind: 'pipe'; item: Pipe }
  | { kind: 'drip'; item: Drip }
  | { kind: 'dim'; item: Measure }
type Fav = { kind: 'tree' | 'bush'; form: PlantForm } | { kind: 'fixture'; form: FixtureKind }
type LineOp = 'slice' | 'mirror'

const ALIGN_SIDES: { id: AlignSide; label: string }[] = [
  { id: 'left', label: 'Слева' },
  { id: 'right', label: 'Справа' },
  { id: 'top', label: 'Сверху' },
  { id: 'bottom', label: 'Снизу' },
  { id: 'center', label: 'Центр' },
]

const TABS: { id: Step; label: string }[] = [
  { id: 'draw', label: 'Чертёж' },
  { id: 'irrig', label: 'Полив' },
  { id: 'layout', label: 'Листы' },
  { id: 'spec', label: 'Спека' },
]

const STEP_DEFAULT_TOOL: Record<Step, Tool> = {
  draw: 'zone',
  irrig: 'source',
  layout: 'select',
  spec: 'select',
}

function uid(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
    }
  } catch {
    // insecure origin has no randomUUID
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function snapTo(point: Point, targets: Point[], limit: number): Point {
  let best = point
  let bestDistance = limit
  for (const target of targets) {
    const distance = dist(point, target)
    if (distance <= bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  return best
}

function nearestBox(doc: Doc, point: Point, limit: number): ValveBox | null {
  let best: ValveBox | null = null
  let bestDistance = limit
  for (const box of doc.boxes ?? []) {
    const distance = dist(point, box)
    if (distance <= bestDistance) {
      best = box
      bestDistance = distance
    }
  }
  return best
}

function targetsOf(doc: Doc): Point[] {
  const points: Point[] = []
  if (doc.source) points.push(doc.source)
  for (const valve of doc.valves) points.push(valve)
  for (const sprinkler of doc.sprinklers) points.push({ x: sprinkler.x, y: sprinkler.y })
  for (const drip of doc.drips) points.push(...drip.points)
  for (const pipe of doc.pipes) points.push(...pipe.points)
  for (const zone of doc.zones) points.push(...zone.points)
  for (const note of doc.notes ?? []) points.push(note)
  for (const plant of doc.plants ?? []) points.push(plant)
  for (const fixture of doc.fixtures ?? []) points.push(fixture)
  for (const box of doc.boxes ?? []) points.push(box)
  for (const hydrant of doc.hydrants ?? []) points.push(hydrant)
  for (const sleeve of doc.sleeves ?? []) points.push(sleeve.a, sleeve.b)
  for (const measure of doc.measures ?? []) {
    points.push(measure.a, measure.b)
  }
  if (doc.anchor) points.push(doc.anchor)
  return points
}

function collectVertices(doc: Doc): Point[] {
  const points: Point[] = []
  if (doc.source) points.push({ x: doc.source.x, y: doc.source.y })
  for (const valve of doc.valves) points.push({ x: valve.x, y: valve.y })
  for (const drip of doc.drips) points.push(...drip.points)
  for (const pipe of doc.pipes) points.push(...pipe.points)
  for (const zone of doc.zones) points.push(...zone.points)
  for (const box of doc.boxes ?? []) points.push({ x: box.x, y: box.y })
  for (const hydrant of doc.hydrants ?? []) points.push({ x: hydrant.x, y: hydrant.y })
  for (const sleeve of doc.sleeves ?? []) points.push(sleeve.a, sleeve.b)
  for (const measure of doc.measures ?? []) points.push(measure.a, measure.b)
  return points
}

function vertexAt(doc: Doc, hit: Hit): Point | null {
  if (hit.kind === 'zone-point') return doc.zones.find((zone) => zone.id === hit.id)?.points[hit.index] ?? null
  if (hit.kind === 'dim-point') {
    const measure = (doc.measures ?? []).find((item) => item.id === hit.id)
    if (!measure) return null
    return hit.index === 0 ? measure.a : measure.b
  }
  if (hit.kind === 'sleeve-point') {
    const sleeve = (doc.sleeves ?? []).find((item) => item.id === hit.id)
    if (!sleeve) return null
    return hit.index === 0 ? sleeve.a : sleeve.b
  }
  return null
}

function contentSize(doc: Doc, image: { w: number; h: number } | null): { w: number; h: number } {
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  const sheet = doc.sheetM ?? DEFAULT_SHEET_M
  let w = sheet.w * ppm
  let h = sheet.h * ppm
  if (image) {
    w = Math.max(w, image.w)
    h = Math.max(h, image.h)
  }
  for (const point of targetsOf(doc)) {
    w = Math.max(w, point.x + 80)
    h = Math.max(h, point.y + 80)
  }
  return { w, h }
}

export function EditorPage({
  projectId,
  user,
  go,
  onLogout,
}: {
  projectId: string
  user: User
  go: (to: string) => void
  onLogout: () => void
}) {
  const [doc, setDoc] = useState<Doc>(emptyDoc())
  const [name, setName] = useState('Участок')
  const [step, setStep] = useState<Step>('draw')
  const [tool, setTool] = useState<Tool>('zone')
  const [draft, setDraft] = useState<Point[]>([])
  const [hover, setHover] = useState<Point | null>(null)
  const [scalePoints, setScalePoints] = useState<Point[]>([])
  const [scaleMeters, setScaleMeters] = useState('5')
  const [zoneKind, setZoneKind] = useState<ZoneKind>('lawn')
  const [nozzleId, setNozzleId] = useState('fan180')
  const [riseCm, setRiseCm] = useState<10 | 15 | 30>(10)
  const [pipeRole, setPipeRole] = useState<PipeRole>('main')
  const [brushM, setBrushM] = useState(0.8)
  const [brushTip, setBrushTip] = useState<BrushTip>('round')
  const [drawHatch, setDrawHatch] = useState<HatchId | null>(null)
  const [diameterM, setDiameterM] = useState('')
  const [treeForm, setTreeForm] = useState<PlantForm>('leaf')
  const [bushForm, setBushForm] = useState<PlantForm>('ball')
  const [fixtureKind, setFixtureKind] = useState<FixtureKind>('boulder')
  const [favorites, setFavorites] = useState<Fav[]>([])
  const [mapOpen, setMapOpen] = useState(false)
  const [favOpen, setFavOpen] = useState(false)
  const underlayRef = useRef<HTMLInputElement>(null)
  const [dimPts, setDimPts] = useState<Point[]>([])
  const [offsetM, setOffsetM] = useState('0.5')
  const [sizeW, setSizeW] = useState('1')
  const [sizeH, setSizeH] = useState('1')
  const [boolPick, setBoolPick] = useState<ClipOp | null>(null)
  const [lineOp, setLineOp] = useState<LineOp | null>(null)
  const [anchorPick, setAnchorPick] = useState(false)
  const [alignPick, setAlignPick] = useState<AlignSide | null>(null)
  const [linePts, setLinePts] = useState<Point[]>([])
  const [selection, setSelection] = useState<Sel>(null)
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 1 })
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState('Загрузка…')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [planNote, setPlanNote] = useState('')
  const [paper, setPaper] = useState<PaperId>('a4')
  const [sheetLayers, setSheetLayers] = useState<SheetLayers>(DEFAULT_SHEET_LAYERS)
  const [includeSpec, setIncludeSpec] = useState(true)
  const [printBusy, setPrintBusy] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const docRef = useRef(doc)
  const draftRef = useRef<Point[]>([])
  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const ready = useRef(false)
  const drag = useRef<Hit | null>(null)
  const stretch = useRef<{ grew: boolean } | null>(null)
  const pan = useRef<{ x: number; y: number; view: View; button: number; hit: Hit; moved: boolean } | null>(null)
  const click = useRef<{ hit: Hit; x: number; y: number; moved: boolean } | null>(null)
  const grab = useRef<Point | null>(null)
  const shapeStart = useRef<Point | null>(null)
  const brushing = useRef(false)
  const clipboard = useRef<Clip | null>(null)
  const lastMark = useRef<Clip | null>(null)
  const lineRef = useRef<Point[]>([])
  const dimRef = useRef<Point[]>([])
  const sleeveRef = useRef<Point[]>([])
  const [sleevePts, setSleevePts] = useState<Point[]>([])
  const didFit = useRef(false)
  docRef.current = doc
  draftRef.current = draft

  const analysis = useMemo(() => analyze(doc), [doc])
  const board = contentSize(doc, imageSize)
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  const sizeZoneId = selection?.kind === 'zone' ? selection.id ?? '' : ''
  useEffect(() => {
    if (!sizeZoneId) return
    const zone = docRef.current.zones.find((item) => item.id === sizeZoneId)
    if (!zone) return
    const box = boundsOf(zone.points)
    setSizeW((box.w / ppm).toFixed(2))
    setSizeH((box.h / ppm).toFixed(2))
  }, [sizeZoneId, ppm])

  useEffect(() => {
    if (tool === 'dim') return
    if (dimRef.current.length === 0) return
    dimRef.current = []
    setDimPts([])
  }, [tool])

  useEffect(() => {
    if (tool === 'sleeve') return
    if (sleeveRef.current.length === 0) return
    sleeveRef.current = []
    setSleevePts([])
  }, [tool])

  useEffect(() => {
    let cancelled = false
    ready.current = false
    setLoaded(false)
    api.project(projectId)
      .then((project) => {
        if (cancelled) return
        setDoc(project.doc)
        setName(project.name)
        if (project.hasBackground) {
          const url = `/api/projects/${project.id}/background?v=${encodeURIComponent(project.updatedAt)}`
          setBackgroundUrl(url)
          measure(url, setImageSize)
        }
        setStatus('Сохранено')
        ready.current = true
        setLoaded(true)
      })
      .catch((err: Error) => setError(err.message))
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!ready.current) return
    setStatus('Сохранение…')
    const handle = window.setTimeout(() => {
      api.saveProject(projectId, { name, doc })
        .then(() => setStatus('Сохранено'))
        .catch((err: Error) => setStatus(err.message))
    }, 700)
    return () => window.clearTimeout(handle)
  }, [doc, name, projectId])

  useEffect(() => {
    if (!loaded || didFit.current) return
    didFit.current = true
    const id = window.requestAnimationFrame(() => fitTo(board.w, board.h))
    return () => window.cancelAnimationFrame(id)
  }, [loaded, board.w, board.h])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = view
      const nextK = Math.min(12, Math.max(0.06, current.k * (event.deltaY < 0 ? 1.1 : 0.9)))
      const rect = svg.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const wx = (sx - current.x) / current.k
      const wy = (sy - current.y) / current.k
      setView({ x: sx - wx * nextK, y: sy - wy * nextK, k: nextK })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [view])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copySelected()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteClipboard()
        return
      }
      if (event.key === 'Escape') {
        if (boolPick) {
          setBoolPick(null)
          return
        }
        if (alignPick) {
          setAlignPick(null)
          return
        }
        if (lineOp) {
          setLineOp(null)
          setLine([])
          return
        }
        if (anchorPick) {
          setAnchorPick(false)
          return
        }
        if (dimRef.current.length) {
          setDim([])
          return
        }
        if (sleeveRef.current.length) {
          setSleeve([])
          return
        }
        shapeStart.current = null
        brushing.current = false
        setDraftPoints([])
        setScalePoints([])
        setSelection(null)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (draftRef.current.length > 0) {
          finishDraft()
          return
        }
        if (dimRef.current.length || sleeveRef.current.length) return
        if (selection?.id) {
          duplicateSelected()
          return
        }
        const clip = lastMark.current
        if (clip) placeClip(clip)
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function remember(current = docRef.current) {
    past.current.push(structuredClone(current))
    if (past.current.length > 40) past.current.shift()
    future.current = []
  }

  function commit(next: Doc) {
    remember()
    docRef.current = next
    setDoc(next)
  }

  function undo() {
    const previous = past.current.pop()
    if (!previous) return
    future.current.push(structuredClone(docRef.current))
    setDoc(previous)
  }

  function redo() {
    const next = future.current.pop()
    if (!next) return
    past.current.push(structuredClone(docRef.current))
    setDoc(next)
  }

  function setDraftPoints(points: Point[]) {
    draftRef.current = points
    setDraft(points)
  }

  function addZone(points: Point[], holes?: Point[][]) {
    if (points.length < 3 || zoneAreaPx(points, holes) < 36) return false
    const current = docRef.current
    const surface = surfaceOf(zoneKind)
    const zone: Zone = {
      id: uid('zone'),
      name: surface.label,
      kind: zoneKind,
      doseMm: defaultDose(zoneKind),
      soil: 'loam',
      slope: 'flat',
      climate: 'open',
      points,
      ...(holes && holes.length ? { holes } : {}),
      ...(HATCHES.find((item) => item.id === drawHatch && item.kind === zoneKind) ? { hatch: drawHatch as HatchId } : {}),
    }
    commit({ ...current, zones: [...current.zones, zone] })
    setSelection({ kind: 'zone', id: zone.id })
    laid({ kind: 'zone', item: zone })
    return true
  }

  function nearDraftStart(point: Point): boolean {
    const points = draftRef.current
    if (points.length < 3) return false
    return withinScreen(points[0], point, view.k, 14)
  }

  function finishDraft() {
    const current = docRef.current
    const points = draftRef.current
    try {
      if (tool === 'zone' && points.length >= 3) {
        addZone(points)
        setDraftPoints([])
        return
      }
      if (tool === 'pipe' && points.length >= 2) {
        const home = stickTarget(current, points[0], pipeRole, [], SNAP_PX)
        const pipe: Pipe = { id: uid('pipe'), points, role: pipeRole, ...(home?.valveId ? { valveId: home.valveId } : {}) }
        commit({ ...current, pipes: [...current.pipes, pipe] })
        setSelection({ kind: 'pipe', id: pipe.id })
        laid({ kind: 'pipe', item: pipe })
        setDraftPoints([])
        return
      }
      if (tool === 'drip' && points.length >= 2) {
        const drip: Drip = { id: uid('drip'), points, spacingM: 0.3, emitterLph: 2 }
        commit({ ...current, drips: [...current.drips, drip] })
        setSelection({ kind: 'drip', id: drip.id })
        laid({ kind: 'drip', item: drip })
        setDraftPoints([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось замкнуть контур')
    }
  }

  function pickPipe(role: PipeRole) {
    if (tool !== 'pipe' || pipeRole !== role) setDraftPoints([])
    setPipeRole(role)
    setTool('pipe')
  }

  function assignPipe(id: string, role: PipeRole) {
    commit({
      ...docRef.current,
      pipes: docRef.current.pipes.map((item) => (item.id === id ? { ...item, role } : item)),
    })
  }

  function removeSelection() {
    const current = docRef.current
    if (!selection) return
    if (selection.kind === 'sprinkler') commit({ ...current, sprinklers: current.sprinklers.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'zone') commit({ ...current, zones: current.zones.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'pipe') commit({ ...current, pipes: current.pipes.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'valve') commit({ ...current, valves: current.valves.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'box') {
      commit({
        ...current,
        boxes: (current.boxes ?? []).filter((item) => item.id !== selection.id),
        valves: current.valves.map((item) => {
          if (item.boxId !== selection.id) return item
          const next = { ...item }
          delete next.boxId
          return next
        }),
      })
    }
    if (selection.kind === 'hydrant') commit({ ...current, hydrants: (current.hydrants ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'sleeve') commit({ ...current, sleeves: (current.sleeves ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'drip') commit({ ...current, drips: current.drips.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'note') commit({ ...current, notes: (current.notes ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'plant') commit({ ...current, plants: (current.plants ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'fixture') commit({ ...current, fixtures: (current.fixtures ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'dim') commit({ ...current, measures: (current.measures ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'source') commit({ ...current, source: null })
    setSelection(null)
  }

  function setLine(points: Point[]) {
    lineRef.current = points
    setLinePts(points)
  }

  function setDim(points: Point[]) {
    dimRef.current = points
    setDimPts(points)
  }

  function setSleeve(points: Point[]) {
    sleeveRef.current = points
    setSleevePts(points)
  }

  function armLine(op: LineOp) {
    setBoolPick(null)
    setAnchorPick(false)
    setAlignPick(null)
    setDraftPoints([])
    if (lineOp === op) {
      setLineOp(null)
      setLine([])
      return
    }
    setLineOp(op)
    setLine([])
  }

  function worldSnap(raw: Point, shift = false, skip?: Point | null, vertices = true): Point {
    const draftPts = draftRef.current
    const last = draftPts[draftPts.length - 1]
    const start = draftPts[0]
    if (tool === 'zone' && start && draftPts.length >= 3 && withinScreen(start, raw, view.k, 14)) return start
    if (vertices && docRef.current.snapVertex !== false) {
      const targets = collectVertices(docRef.current).filter((target) => {
        if (skip && dist(skip, target) <= 0.75) return false
        if (last && withinScreen(last, target, view.k, 8)) return false
        return true
      })
      const hit = nearestScreen(raw, targets, view.k, 12)
      if (hit) return hit
    }
    let point = raw
    if (docRef.current.snapGrid === true) point = snapToGrid(point, gridStepM(view.k, ppm) * ppm)
    if (shift && last) point = orthoFrom(last, point)
    return point
  }

  function resolveBoardHit(hit: Hit, point: Point): Hit {
    if (hit.kind === 'sprinkler-rot' || hit.kind === 'sprinkler-arc' || hit.kind === 'draft-ok' || hit.kind === 'draft-close' || hit.kind === 'plant-size' || hit.kind === 'fixture-size') return hit
    const id = pickSprinkler(docRef.current.sprinklers, point, view.k, ppm)
    if (id) return { kind: 'sprinkler', id }
    return hit
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    const raw = worldPoint(event, svgRef.current, view)
    const hit = resolveBoardHit(readHit(event.target), raw)
    if (event.button === 2) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pan.current = { x: event.clientX, y: event.clientY, view, button: 2, hit, moved: false }
      return
    }
    if ((tool === 'zone' || tool === 'pipe' || tool === 'drip') && (hit.kind === 'draft-ok' || hit.kind === 'draft-close')) {
      finishDraft()
      return
    }
    if (event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId)
      pan.current = { x: event.clientX, y: event.clientY, view, button: 1, hit, moved: true }
      return
    }
    if (boolPick) {
      const zoneId = hit.kind === 'zone' || hit.kind === 'zone-edge' || hit.kind === 'zone-point' || hit.kind === 'zone-mid' ? hit.id : ''
      if (zoneId && selection?.kind === 'zone' && zoneId !== selection.id) applyClip(boolPick, zoneId)
      else setPlanNote('Кликните по другому контуру. Esc — отмена.')
      return
    }
    if (lineOp) {
      let point = worldSnap(raw, false)
      const prev = lineRef.current
      if (lineLocked(event.shiftKey) && prev.length === 1) point = orthoFrom(prev[0], point)
      const next = [...prev, point]
      if (next.length < 2) {
        setLine(next)
        return
      }
      setLine([])
      setLineOp(null)
      if (dist(next[0], next[1]) < 2) {
        setPlanNote('Линия слишком короткая')
        return
      }
      if (lineOp === 'slice') applySlice(next[0], next[1])
      else applyMirror(next[0], next[1])
      return
    }
    if (anchorPick) {
      commit({ ...docRef.current, anchor: worldSnap(raw, false) })
      setAnchorPick(false)
      setPlanNote('Якорь поставлен. Поворот, отражение и масштаб идут вокруг него.')
      return
    }
    if (alignPick) {
      const zoneId = hit.kind === 'zone' || hit.kind === 'zone-edge' || hit.kind === 'zone-point' || hit.kind === 'zone-mid' ? hit.id : ''
      if (zoneId && selection?.kind === 'zone' && zoneId !== selection.id) {
        const other = docRef.current.zones.find((item) => item.id === zoneId)
        if (other) applyAlign(alignPick, zoneBounds(other))
        return
      }
      const pin = docRef.current.anchor
      if (pin) {
        applyAlign(alignPick, { minX: pin.x, minY: pin.y, maxX: pin.x, maxY: pin.y })
        return
      }
      setPlanNote('Кликните другой контур. Чтобы сесть на точку, сначала поставьте якорь.')
      return
    }
    const drafting = (tool === 'zone' || tool === 'pipe' || tool === 'drip') && draftRef.current.length > 0
    const placingMark = (tool === 'dim' && hit.kind !== 'dim' && hit.kind !== 'dim-point')
      || (tool === 'sleeve' && hit.kind !== 'sleeve' && hit.kind !== 'sleeve-point')
    const editHit = !placingMark && tool !== 'pipe' && (hit.kind === 'sprinkler-rot' || hit.kind === 'sprinkler-arc' || hit.kind === 'zone-point' || hit.kind === 'zone-mid' || hit.kind === 'pipe-point' || hit.kind === 'drip-point' || hit.kind === 'sprinkler' || hit.kind === 'source' || hit.kind === 'valve' || hit.kind === 'box' || hit.kind === 'hydrant' || hit.kind === 'sleeve' || hit.kind === 'sleeve-point' || hit.kind === 'note' || hit.kind === 'plant' || hit.kind === 'plant-size' || hit.kind === 'fixture' || hit.kind === 'fixture-size' || hit.kind === 'dim' || hit.kind === 'dim-point')
    if (!drafting && editHit) {
      remember()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = hit
      if (hit.kind === 'plant-size' || hit.kind === 'fixture-size') stretch.current = null
      if (hit.kind === 'dim' || hit.kind === 'sleeve') grab.current = raw
      click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
      setSelection(selectionFromHit(hit))
      return
    }
    if (!drafting && !placingMark && hit.kind === 'zone-edge') {
      click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
      setSelection({ kind: 'zone', id: hit.id })
      return
    }
    if (!drafting && !placingMark && hit.kind === 'zone' && selection?.kind === 'zone' && selection.id === hit.id) {
      remember()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = hit
      grab.current = raw
      click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
      return
    }
    click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
    if (tool === 'select') event.currentTarget.setPointerCapture(event.pointerId)

    if (tool === 'select') {
      if (hit.kind === 'zone') {
        remember()
        drag.current = hit
        grab.current = raw
        setSelection({ kind: 'zone', id: hit.id })
        return
      }
      if (hit.kind === 'pipe' || hit.kind === 'drip') setSelection({ kind: hit.kind, id: hit.id })
      else setSelection(null)
      return
    }

    const point = tool === 'scale' ? raw : worldSnap(raw, (tool === 'zone' || tool === 'pipe' || tool === 'drip') && lineLocked(event.shiftKey))
    if (tool === 'source') {
      commit(withSourcePoint(doc, point))
      setSelection({ kind: 'source' })
      return
    }
    if (tool === 'valve') {
      const current = docRef.current
      const box = nearestBox(current, raw, 36)
      const slot = box ? valveSlot(box, current.valves.filter((item) => item.boxId === box.id).length) : point
      const valve: Valve = {
        id: uid('valve'),
        name: `Клапан ${current.valves.length + 1}`,
        x: slot.x,
        y: slot.y,
        ...(box ? { boxId: box.id } : {}),
      }
      commit({ ...current, valves: [...current.valves, valve] })
      setSelection({ kind: 'valve', id: valve.id })
      laid({ kind: 'valve', item: valve })
      setPlanNote(box ? 'Клапан встал в бокс. Зональную трубу начните с этого ромба.' : '')
      return
    }
    if (tool === 'box') {
      const current = docRef.current
      if ((current.boxes ?? []).length >= 200) {
        setPlanNote('На чертеже уже 200 боксов')
        return
      }
      const box: ValveBox = { id: uid('box'), name: `Бокс ${(current.boxes ?? []).length + 1}`, x: point.x, y: point.y }
      commit({ ...current, boxes: [...(current.boxes ?? []), box] })
      setSelection({ kind: 'box', id: box.id })
      laid({ kind: 'box', item: box })
      setPlanNote('')
      return
    }
    if (tool === 'hydrant') {
      const current = docRef.current
      if ((current.hydrants ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 гидрантов')
        return
      }
      const nodes = current.pipes.flatMap((pipe) => pipe.points)
      const spot = nodes.length ? snapTo(point, nodes, SNAP_PX) : point
      const hydrant: Hydrant = { id: uid('hydrant'), x: spot.x, y: spot.y }
      commit({ ...current, hydrants: [...(current.hydrants ?? []), hydrant] })
      setSelection({ kind: 'hydrant', id: hydrant.id })
      laid({ kind: 'hydrant', item: hydrant })
      setPlanNote('')
      return
    }
    if (tool === 'sprinkler') {
      const nozzle = nozzleById(nozzleId)
      const sprinkler: Sprinkler = {
        id: uid('s'),
        nozzleId: nozzle.id,
        x: point.x,
        y: point.y,
        radiusM: nozzle.radiusM,
        arcDeg: nozzle.arcDeg,
        rotationDeg: 0,
        flowLph: nozzle.flowLph,
        ...(nozzle.kind !== 'bubbler' && riseCm !== 10 ? { riseCm } : {}),
      }
      commit({ ...doc, sprinklers: [...doc.sprinklers, sprinkler] })
      setSelection({ kind: 'sprinkler', id: sprinkler.id })
      laid({ kind: 'sprinkler', item: sprinkler })
      return
    }
    if (tool === 'text' || tool === 'tree' || tool === 'bush') {
      const id = placeMark(tool, point)
      if (id) beginStretch(event, 'plant', id)
      return
    }
    if (tool === 'fixture') {
      const id = placeFixture(point)
      if (id) beginStretch(event, 'fixture', id)
      return
    }
    if (tool === 'dim') {
      let mark = point
      const prev = dimRef.current
      if (lineLocked(event.shiftKey) && prev.length === 1) mark = orthoFrom(prev[0], raw)
      const next = [...prev, mark]
      if (next.length < 2) {
        setDim(next)
        return
      }
      setDim([])
      if (dist(next[0], next[1]) < 2) {
        setPlanNote('Размер слишком короткий')
        return
      }
      if ((docRef.current.measures ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 размеров')
        return
      }
      const measure = { id: uid('dim'), a: next[0], b: next[1] }
      commit({ ...docRef.current, measures: [...(docRef.current.measures ?? []), measure] })
      setSelection({ kind: 'dim', id: measure.id })
      laid({ kind: 'dim', item: measure })
      setPlanNote('')
      return
    }
    if (tool === 'sleeve') {
      let mark = point
      const prev = sleeveRef.current
      if (lineLocked(event.shiftKey) && prev.length === 1) mark = orthoFrom(prev[0], raw)
      const next = [...prev, mark]
      if (next.length < 2) {
        setSleeve(next)
        return
      }
      setSleeve([])
      if (dist(next[0], next[1]) < 2) {
        setPlanNote('Гильза слишком короткая')
        return
      }
      const current = docRef.current
      if ((current.sleeves ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 гильз')
        return
      }
      const sleeve: Sleeve = { id: uid('sleeve'), a: next[0], b: next[1] }
      commit({ ...current, sleeves: [...(current.sleeves ?? []), sleeve] })
      setSelection({ kind: 'sleeve', id: sleeve.id })
      laid({ kind: 'sleeve', item: sleeve })
      setPlanNote('')
      return
    }
    if (tool === 'scale') {
      setScalePoints((current) => (current.length >= 2 ? [point] : [...current, point]))
      return
    }
    if (tool === 'rect' || tool === 'circle') {
      if (tool === 'circle') {
        const diameter = Number(diameterM.replace(',', '.'))
        if (diameterM.trim() && diameter >= 0.4 && diameter <= 80) {
          const placed = addZone(circlePoints(point, { x: point.x + (diameter * ppm) / 2, y: point.y }))
          if (!placed) setPlanNote('Круг слишком мал для этого масштаба')
          return
        }
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      shapeStart.current = point
      setDraftPoints(tool === 'rect' ? rectPoints(point, point) : circlePoints(point, { x: point.x + 1, y: point.y }))
      return
    }
    if (tool === 'brush') {
      event.currentTarget.setPointerCapture(event.pointerId)
      brushing.current = true
      setDraftPoints([point])
      return
    }
    if (tool === 'zone' || tool === 'pipe' || tool === 'drip') {
      if (event.detail >= 2) {
        finishDraft()
        return
      }
      if (tool === 'zone' && nearDraftStart(raw)) {
        finishDraft()
        return
      }
      let vertex = point
      if (tool === 'pipe') {
        const stuck = stickTarget(docRef.current, raw, pipeRole, draftRef.current, SNAP_PX)
        if (stuck) vertex = { x: stuck.x, y: stuck.y }
      }
      const last = draftRef.current[draftRef.current.length - 1]
      const canFinish = tool === 'zone' ? draftRef.current.length >= 3 : draftRef.current.length >= 2
      if (canFinish && last && dist(raw, last) * view.k <= 28) {
        finishDraft()
        return
      }
      if (last && dist(vertex, last) * view.k < 4) return
      setHover(vertex)
      setDraftPoints([...draftRef.current, vertex])
    }
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    if (pan.current) {
      const gesture = pan.current
      if (gesture.button === 2 && !gesture.moved) {
        if (Math.abs(event.clientX - gesture.x) <= 3 && Math.abs(event.clientY - gesture.y) <= 3) return
        gesture.moved = true
      }
      setView({
        ...gesture.view,
        x: gesture.view.x + event.clientX - gesture.x,
        y: gesture.view.y + event.clientY - gesture.y,
      })
      return
    }
    const rawMove = worldPoint(event, svgRef.current, view)
    const drawing = tool === 'zone' || tool === 'pipe' || tool === 'drip' || tool === 'rect' || tool === 'circle' || tool === 'brush' || tool === 'dim' || tool === 'sleeve'
    let point = drawing ? worldSnap(rawMove, (tool === 'zone' || tool === 'pipe' || tool === 'drip') && lineLocked(event.shiftKey)) : rawMove
    if (lineOp && lineLocked(event.shiftKey) && lineRef.current.length === 1) point = orthoFrom(lineRef.current[0], rawMove)
    else if (lineOp) point = worldSnap(rawMove, false)
    else if (tool === 'dim' && lineLocked(event.shiftKey) && dimRef.current.length === 1) point = orthoFrom(dimRef.current[0], rawMove)
    else if (tool === 'sleeve' && lineLocked(event.shiftKey) && sleeveRef.current.length === 1) point = orthoFrom(sleeveRef.current[0], rawMove)
    if (tool === 'pipe') {
      const stuck = stickTarget(docRef.current, rawMove, pipeRole, draftRef.current, SNAP_PX)
      if (stuck) point = { x: stuck.x, y: stuck.y }
    }
    setHover(point)
    if (shapeStart.current && (tool === 'rect' || tool === 'circle')) {
      setDraftPoints(tool === 'rect' ? rectPoints(shapeStart.current, point, event.shiftKey) : circlePoints(shapeStart.current, point))
      return
    }
    if (brushing.current && tool === 'brush') {
      const last = draftRef.current[draftRef.current.length - 1]
      if (!last || dist(last, point) * view.k > 3) setDraftPoints([...draftRef.current, point])
      return
    }
    if (click.current && (Math.abs(event.clientX - click.current.x) > 3 || Math.abs(event.clientY - click.current.y) > 3)) {
      click.current.moved = true
    }
    const active = drag.current
    if (!active) return
    if (active.kind === 'sprinkler-rot' || active.kind === 'sprinkler-arc') {
      const step = event.shiftKey ? 15 : null
      setDoc((current) => aimSprinklerHit(current, active, point, step))
      return
    }
    if ((active.kind === 'zone') && grab.current) {
      const here = (tool === 'zone' || tool === 'rect' || tool === 'circle' || tool === 'brush')
        ? worldSnap(rawMove, false, null, false)
        : rawMove
      const dx = here.x - grab.current.x
      const dy = here.y - grab.current.y
      grab.current = here
      setDoc((current) => ({
        ...current,
        zones: current.zones.map((zone) => (zone.id === active.id ? shiftZone(zone, dx, dy) : zone)),
      }))
      return
    }
    if ((active.kind === 'dim' || active.kind === 'sleeve') && grab.current) {
      const dx = rawMove.x - grab.current.x
      const dy = rawMove.y - grab.current.y
      grab.current = rawMove
      if (active.kind === 'sleeve') {
        setDoc((current) => ({
          ...current,
          sleeves: (current.sleeves ?? []).map((item) => (item.id === active.id ? {
            ...item,
            a: { x: item.a.x + dx, y: item.a.y + dy },
            b: { x: item.b.x + dx, y: item.b.y + dy },
          } : item)),
        }))
        return
      }
      setDoc((current) => ({
        ...current,
        measures: (current.measures ?? []).map((item) => (item.id === active.id ? {
          ...item,
          a: { x: item.a.x + dx, y: item.a.y + dy },
          b: { x: item.b.x + dx, y: item.b.y + dy },
        } : item)),
      }))
      return
    }
    if (active.kind === 'plant-size' || active.kind === 'fixture-size') {
      const gate = stretch.current
      if (gate && !gate.grew) {
        const centre = markPoint(docRef.current, active)
        if (centre && dist(centre, rawMove) * view.k < 8) return
        gate.grew = true
      }
      const scale = ppm
      const shift = event.shiftKey
      setDoc((current) => resizeMark(current, active, rawMove, scale, shift))
      return
    }
    const vertexDrag = active.kind === 'zone-point' || active.kind === 'dim-point' || active.kind === 'sleeve-point'
    const snapped = vertexDrag
      ? worldSnap(rawMove, false, vertexAt(docRef.current, active))
      : (doc.snapGrid === true ? worldSnap(point) : point)
    setDoc((current) => moveHit(current, active, snapped))
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (pan.current) {
      const gesture = pan.current
      pan.current = null
      drag.current = null; stretch.current = null
      click.current = null
      grab.current = null
      if (gesture.button === 2 && !gesture.moved) {
        const drawing = (tool === 'zone' || tool === 'pipe' || tool === 'drip') && draftRef.current.length > 0
        if (drawing) finishDraft()
        else setSelection(selectionFromHit(gesture.hit))
      }
      return
    }
    if (shapeStart.current && (tool === 'rect' || tool === 'circle')) {
      const pts = draftRef.current
      shapeStart.current = null
      addZone(pts)
      setDraftPoints([])
      drag.current = null; stretch.current = null
      click.current = null
      grab.current = null
      return
    }
    if (tool === 'brush' && brushing.current) {
      brushing.current = false
      if (draftRef.current.length > 0) {
        const region = brushOutline(draftRef.current, (brushM * ppm) / 2, brushTip)
        if (region) addZone(region.points, region.holes)
        setDraftPoints([])
      }
      drag.current = null; stretch.current = null
      click.current = null
      grab.current = null
      return
    }
    const active = drag.current
    const tap = click.current
    drag.current = null; stretch.current = null
    pan.current = null
    click.current = null
    grab.current = null
    if (active && tap?.moved) {
      setDoc((current) => snapDrag(current, active))
    }
    if (!tap || tap.moved) return
    if (tap.hit.kind === 'zone-point' && event.detail >= 2 && tap.hit.id) {
      commit(deleteZoneVertex(docRef.current, tap.hit.id, tap.hit.index))
      return
    }
    if (tap.hit.kind === 'zone-edge' && tap.hit.id) {
      const raw = svgRef.current ? worldPoint(event, svgRef.current, view) : null
      if (raw) commit(insertZoneVertex(docRef.current, tap.hit.id, tap.hit.index, worldSnap(raw)))
    }
  }

  function applyScale() {
    if (scalePoints.length < 2) return
    const meters = Number(scaleMeters.replace(',', '.'))
    const pixels = dist(scalePoints[0], scalePoints[1])
    if (!Number.isFinite(meters) || meters <= 0 || pixels < 2) {
      setError('Укажите длину отрезка в метрах')
      return
    }
    setError('')
    commit({ ...doc, pxPerMeter: pixels / meters })
    setScalePoints([])
    setTool('zone')
  }

  function fit() {
    fitTo(board.w, board.h)
  }

  function fitTo(width: number, height: number) {
    const pane = svgRef.current?.getBoundingClientRect()
    if (!pane || width < 1 || height < 1) return
    const k = Math.min(pane.width / width, pane.height / height) * 0.92
    setView({ k, x: (pane.width - width * k) / 2, y: (pane.height - height * k) / 2 })
  }

  async function onBackground(file: File) {
    setError('')
    setStatus('Загружаю подложку…')
    let dataUrl: string
    let size: { w: number; h: number } | null = null
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const plan = await renderPlanPdf(await file.arrayBuffer())
      if (plan.png.length > 7_500_000) throw new Error('Лист слишком большой для подложки')
      dataUrl = plan.png
      size = { w: plan.width, h: plan.height }
    } else {
      dataUrl = await fileToDataUrl(file)
    }
    await api.uploadBackground(projectId, dataUrl)
    const url = `/api/projects/${projectId}/background?v=${Date.now()}`
    setBackgroundUrl(url)
    if (size) {
      setImageSize(size)
      fitTo(size.w, size.h)
    } else {
      measure(url, (next) => {
        setImageSize(next)
        fitTo(next.w, next.h)
      })
    }
    setPlanNote('Подложка на листе. Задайте масштаб линейкой по известному отрезку.')
    setStatus('Сохранено')
    setTool('scale')
  }

  async function clearBackground() {
    await api.deleteBackground(projectId)
    setBackgroundUrl(null)
    setImageSize(null)
  }

  function loadExample() {
    if (doc.sprinklers.length || doc.pipes.length || doc.zones.length || doc.valves.length || doc.drips.length) {
      if (!confirm('Заменить чертёж примером?')) return
    }
    commit(exampleDoc())
    setDraftPoints([])
    setSelection(null)
    setPlanNote('')
  }

  async function logout() {
    await api.logout()
    onLogout()
    go('/')
  }

  const scalePx = scalePoints.length === 2 ? dist(scalePoints[0], scalePoints[1]) : 0

  function openStep(next: Step) {
    setStep(next)
    shapeStart.current = null
    brushing.current = false
    setDraftPoints([])
    setScalePoints([])
    setBoolPick(null)
    setLineOp(null)
    setLine([])
    setDim([])
    setSleeve([])
    setAnchorPick(false)
    setAlignPick(null)
    setTool(STEP_DEFAULT_TOOL[next])
  }

  function runLayout() {
    const current = docRef.current
    if (!current.pxPerMeter) {
      setError('Сначала задайте масштаб')
      return
    }
    if (!current.zones.some((zone) => isWetKind(zone.kind))) {
      setError('Обведите хотя бы одну зону полива — газон, клумбу или кусты')
      return
    }
    if (!current.source) {
      setError('Поставьте источник воды')
      return
    }
    if ((current.sprinklers.length || current.pipes.length || current.valves.length || current.drips.length)
      && !confirm('Заменить текущую схему новым расчётом?')) return
    setError('')
    setStatus('Считаю схему…')
    const next = layoutIrrigation(current)
    if (!next) {
      const hasSpray = current.zones.some((zone) => isSprayKind(zone.kind))
      const hasPlant = (current.plants ?? []).length > 0
      setError(hasSpray || hasPlant
        ? 'Не удалось развести сеть. Проверьте масштаб и контуры зон.'
        : 'Капельницы ставятся к деревьям и кустам. Поставьте растение на клумбу и повторите расчёт.')
      setStatus('Сохранено')
      return
    }
    commit(next)
    const bare = current.zones.filter((zone) =>
      isDripKind(zone.kind)
      && zone.points.length >= 3
      && !(current.plants ?? []).some((plant) => pointInZone(plant, zone.points, zone.holes)),
    )
    const plantNote = bare.length ? ' Капля идёт к деревьям и кустам. Поставьте растение на пустую клумбу.' : ''
    setPlanNote(`Дождевателей: ${next.sprinklers.length}. Клапанов: ${next.valves.length}. Капельных линий: ${next.drips.length}. Список к закупке слева.${plantNote}`)
    setStatus('Сохранено')
    setTool('select')
  }

  async function runPrint(format: 'pdf' | 'png') {
    setError('')
    setPrintBusy(true)
    setStatus(format === 'pdf' ? 'Готовлю PDF…' : 'Готовлю PNG…')
    try {
      await exportProjectSheets({
        doc: docRef.current,
        analysis,
        title: name.trim() || 'Участок',
        paper,
        layers: sheetLayers,
        includeSpec,
        underlayUrl: backgroundUrl,
        imageSize,
        format,
      })
      setStatus('Сохранено')
      setPlanNote(format === 'pdf' ? 'PDF скачан.' : 'PNG скачан.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось собрать лист')
      setStatus('Сохранено')
    } finally {
      setPrintBusy(false)
    }
  }

  function selectedZoneOf(): Zone | undefined {
    if (selection?.kind !== 'zone' || !selection.id) return undefined
    return docRef.current.zones.find((item) => item.id === selection.id)
  }

  function mapSelectedZone(next: (zone: Zone) => Zone) {
    const zone = selectedZoneOf()
    if (!zone) return
    const mapped = next(zone)
    commit({
      ...docRef.current,
      zones: docRef.current.zones.map((item) => (item.id === zone.id ? mapped : item)),
    })
  }

  function lineLocked(shift: boolean): boolean {
    return shift || docRef.current.ortho === true
  }

  function armAnchor() {
    setBoolPick(null)
    setLineOp(null)
    setLine([])
    setAlignPick(null)
    setAnchorPick((on) => !on)
  }

  function armAlign(side: AlignSide) {
    setBoolPick(null)
    setLineOp(null)
    setLine([])
    setAnchorPick(false)
    setAlignPick((current) => (current === side ? null : side))
  }

  function clearAnchor() {
    const next = { ...docRef.current }
    delete next.anchor
    commit(next)
    setAnchorPick(false)
  }

  function originOf(zone: Zone): Point {
    return docRef.current.anchor ?? centroid(zone.points)
  }

  function flattenSelected() {
    const zone = selectedZoneOf()
    if (!zone) return
    const points = flattenRing(zone.points, zone.bends)
    if (!points) {
      setPlanNote('Дуга слишком подробная, контур не разобрать')
      return
    }
    setError('')
    setPlanNote('Дуги стали ломаной')
    mapSelectedZone((item) => shapeZone(item, points, item.holes))
  }

  function rotateSelected(deg: number) {
    if (selection?.kind === 'sprinkler' && selection.id) {
      const id = selection.id
      commit({
        ...docRef.current,
        sprinklers: docRef.current.sprinklers.map((item) => (
          item.id === id ? { ...item, rotationDeg: normDeg(item.rotationDeg + deg) } : item
        )),
      })
      return
    }
    mapSelectedZone((zone) => {
      const origin = originOf(zone)
      return mapZone(zone, (point) => rotateAround(point, origin, deg))
    })
  }

  function flipSelected(axis: 'x' | 'y') {
    mapSelectedZone((zone) => {
      const origin = originOf(zone)
      return mapZone(zone, (point) => mirrorAround(point, origin, axis))
    })
  }

  function scaleSelected(k: number) {
    mapSelectedZone((zone) => {
      const origin = originOf(zone)
      const points = zone.points.map((point) => scaleAround(point, origin, k))
      if (zoneAreaPx(points, zone.holes) < 36) return zone
      return mapZone(zone, (point) => scaleAround(point, origin, k))
    })
  }

  function zoneBounds(zone: Zone) {
    return boundsOf(outlineOf(zone.points, zone.bends))
  }

  function applyAlign(side: AlignSide, target: { minX: number; minY: number; maxX: number; maxY: number }) {
    const zone = selectedZoneOf()
    if (!zone) return
    const shift = alignShift(zoneBounds(zone), target, side)
    setAlignPick(null)
    if (Math.abs(shift.dx) < 0.5 && Math.abs(shift.dy) < 0.5) {
      setPlanNote('Контур уже на этом крае')
      return
    }
    setError('')
    setPlanNote('Контур выровнен')
    mapSelectedZone((item) => shiftZone(item, shift.dx, shift.dy))
  }

  function restack(front: boolean) {
    const zone = selectedZoneOf()
    if (!zone) return
    const zones = docRef.current.zones
    const index = zones.findIndex((item) => item.id === zone.id)
    if (index < 0) return
    if (front && index === zones.length - 1) return
    if (!front && index === 0) return
    const rest = zones.filter((item) => item.id !== zone.id)
    commit({ ...docRef.current, zones: front ? [...rest, zone] : [zone, ...rest] })
  }

  function parallelCopy() {
    const zone = selectedZoneOf()
    if (!zone) return
    const meters = Number(offsetM.replace(',', '.'))
    if (!Number.isFinite(meters) || meters <= 0 || meters > 20) {
      setError('Смещение укажите в метрах, больше нуля')
      return
    }
    const next = offsetRing(outlineOf(zone.points, zone.bends), meters * ppm)
    if (!next) {
      setError('Такое смещение съедает контур')
      return
    }
    const holes = (zone.holes ?? [])
      .map((hole) => offsetRing(hole, -meters * ppm))
      .filter((hole): hole is Point[] => Boolean(hole))
    const copy = shapeZone({ ...structuredClone(zone), id: uid('zone') }, next, holes)
    setError('')
    setPlanNote('Параллельная копия снаружи')
    commit({ ...docRef.current, zones: [...docRef.current.zones, copy] })
    setSelection({ kind: 'zone', id: copy.id })
  }

  function applyOffset(sign: 1 | -1) {
    const zone = selectedZoneOf()
    if (!zone) return
    const meters = Number(offsetM.replace(',', '.'))
    if (!Number.isFinite(meters) || meters <= 0 || meters > 20) {
      setError('Смещение укажите в метрах, больше нуля')
      return
    }
    const ring = outlineOf(zone.points, zone.bends)
    const next = offsetRing(ring, sign * meters * ppm)
    if (!next) {
      setError('Такое смещение съедает контур')
      return
    }
    const holes = (zone.holes ?? [])
      .map((hole) => offsetRing(hole, -sign * meters * ppm))
      .filter((hole): hole is Point[] => Boolean(hole))
    setError('')
    commit({
      ...docRef.current,
      zones: docRef.current.zones.map((item) => (item.id === zone.id ? shapeZone(item, next, holes) : item)),
    })
  }

  function applySize() {
    const zone = selectedZoneOf()
    if (!zone) return
    const widthM = Number(sizeW.replace(',', '.'))
    const heightM = Number(sizeH.replace(',', '.'))
    if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || widthM < 0.2 || heightM < 0.2 || widthM > 500 || heightM > 500) {
      setError('Ширина и высота — от 0,2 м')
      return
    }
    const box = boundsOf(zone.points)
    if (!(box.w > 1) || !(box.h > 1)) return
    const width = widthM * ppm
    const height = heightM * ppm
    const map = (point: Point) => mapToSize(point, box, width, height)
    setError('')
    commit({
      ...docRef.current,
      zones: docRef.current.zones.map((item) => (item.id === zone.id ? mapZone(item, map) : item)),
    })
  }

  function applyClip(op: ClipOp, otherId: string) {
    const subject = selectedZoneOf()
    const other = docRef.current.zones.find((item) => item.id === otherId)
    if (!subject || !other || subject.id === other.id) return
    const left = { points: outlineOf(subject.points, subject.bends), holes: subject.holes }
    const right = { points: outlineOf(other.points, other.bends), holes: other.holes }
    const overlap = clipRegions('intersect', left, right)
    const overlapArea = overlap.reduce((sum, region) => sum + zoneAreaPx(region.points, region.holes), 0)
    if (overlapArea < 1 && op !== 'union') {
      setBoolPick(null)
      setPlanNote('Контуры не пересекаются')
      return
    }
    const result = (op === 'intersect' ? overlap : clipRegions(op, left, right))
      .slice()
      .sort((a, b) => zoneAreaPx(b.points, b.holes) - zoneAreaPx(a.points, a.holes))
    if (result.length === 0) {
      setBoolPick(null)
      setError(op === 'intersect' ? 'Нет общей области' : 'После операции контур пуст')
      return
    }
    if (op === 'union' && result.length > 1) {
      setBoolPick(null)
      setPlanNote('Контуры не пересекаются')
      return
    }
    const [first, ...rest] = result
    const make = (region: (typeof result)[number], id: string): Zone => shapeZone({ ...subject, id }, region.points, region.holes)
    let zones = docRef.current.zones.map((item) => (item.id === subject.id ? make(first, subject.id) : item))
    if (op !== 'diff') zones = zones.filter((item) => item.id !== other.id)
    zones = [...zones, ...rest.map((region) => make(region, uid('zone')))]
    setError('')
    setBoolPick(null)
    setPlanNote(op === 'diff' ? 'Вырезано. Второй контур остался.' : 'Контуры пересчитаны.')
    commit({ ...docRef.current, zones })
    setSelection({ kind: 'zone', id: subject.id })
  }

  function applySlice(a: Point, b: Point) {
    const zone = selectedZoneOf()
    if (!zone) return
    const parts = splitRegion({ points: outlineOf(zone.points, zone.bends), holes: zone.holes }, a, b)
    if (!parts) {
      setPlanNote('Линия не разрезает контур')
      return
    }
    const ordered = parts.slice().sort((left, right) => zoneAreaPx(right.points, right.holes) - zoneAreaPx(left.points, left.holes))
    const [first, ...rest] = ordered
    const zones = [
      ...docRef.current.zones.map((item) => (item.id === zone.id ? shapeZone(item, first.points, first.holes) : item)),
      ...rest.map((region) => shapeZone({ ...zone, id: uid('zone') }, region.points, region.holes)),
    ]
    setError('')
    setPlanNote('Контур разрезан')
    commit({ ...docRef.current, zones })
  }

  function applyMirror(a: Point, b: Point) {
    const zone = selectedZoneOf()
    if (!zone) return
    const copy = mapZone({ ...structuredClone(zone), id: uid('zone') }, (point) => mirrorAcross(point, a, b))
    setError('')
    setPlanNote('Копия отражена через линию')
    commit({ ...docRef.current, zones: [...docRef.current.zones, copy] })
    setSelection({ kind: 'zone', id: copy.id })
  }

  function rememberFav(item: Fav) {
    const key = favKey(item)
    setFavorites((current) => [item, ...current.filter((entry) => favKey(entry) !== key)].slice(0, 8))
  }

  function closePanels() {
    setMapOpen(false)
    setFavOpen(false)
  }

  function openSurface(kind: ZoneKind) {
    setZoneKind(kind)
    setDrawHatch(null)
    closePanels()
    if (!isShapeTool(tool)) {
      setTool('zone')
      setDraftPoints([])
    }
  }

  function pickForm(kind: PlantKind, form: PlantForm) {
    if (kind === 'tree') setTreeForm(form)
    else setBushForm(form)
    rememberFav({ kind, form })
    const current = docRef.current
    const id = selection?.kind === 'plant' ? selection.id : ''
    const plant = (current.plants ?? []).find((item) => item.id === id)
    if (!plant || plant.kind !== kind || formOf(plant) === form) return
    commit({
      ...current,
      plants: (current.plants ?? []).map((item) => (item.id === plant.id ? { ...item, form } : item)),
    })
  }

  function chooseFixture(kind: FixtureKind, restyle: boolean) {
    setFixtureKind(kind)
    setTool('fixture')
    closePanels()
    setLineOp(null)
    setLine([])
    rememberFav({ kind: 'fixture', form: kind })
    if (!restyle) return
    const current = docRef.current
    const id = selection?.kind === 'fixture' ? selection.id : ''
    const item = (current.fixtures ?? []).find((entry) => entry.id === id)
    if (!item || item.kind === kind) return
    commit({
      ...current,
      fixtures: (current.fixtures ?? []).map((entry) => (entry.id === item.id ? { ...entry, kind } : entry)),
    })
  }

  function placeMark(kind: 'text' | 'tree' | 'bush', point: Point): string | null {
    const current = docRef.current
    if (kind === 'text') {
      const note: Note = { id: uid('note'), x: point.x, y: point.y, text: 'Подпись', sizeM: 0.45 }
      commit({ ...current, notes: [...(current.notes ?? []), note] })
      setSelection({ kind: 'note', id: note.id })
      laid({ kind: 'note', item: note })
      return null
    }
    const plantKind = kind === 'tree' ? 'tree' : 'bush'
    const form = plantKind === 'tree' ? treeForm : bushForm
    const plant: Plant = {
      id: uid('plant'),
      kind: plantKind,
      x: point.x,
      y: point.y,
      radiusM: plantKind === 'tree' ? 1.6 : 0.7,
      form,
    }
    commit({ ...current, plants: [...(current.plants ?? []), plant] })
    setSelection({ kind: 'plant', id: plant.id })
    laid({ kind: 'plant', item: plant })
    rememberFav({ kind: plantKind, form })
    return plant.id
  }

  function placeFixture(point: Point): string | null {
    const current = docRef.current
    if ((current.fixtures ?? []).length >= 800) {
      setPlanNote('На чертеже уже 800 объектов')
      return null
    }
    const spec = fixtureSpec(fixtureKind)
    const item: Fixture = {
      id: uid('obj'),
      kind: fixtureKind,
      x: point.x,
      y: point.y,
      radiusM: spec.radiusM,
    }
    commit({ ...current, fixtures: [...(current.fixtures ?? []), item] })
    setSelection({ kind: 'fixture', id: item.id })
    laid({ kind: 'fixture', item })
    setPlanNote('')
    rememberFav({ kind: 'fixture', form: fixtureKind })
    return item.id
  }

  function beginStretch(event: React.PointerEvent<SVGSVGElement>, kind: 'plant' | 'fixture', id: string) {
    const hit: Hit = { kind: kind === 'plant' ? 'plant-size' : 'fixture-size', id }
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = hit
    stretch.current = { grew: false }
    click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
  }

  function takenFromSelection(): Clip | null {
    const current = docRef.current
    const sel = selection
    if (!sel?.id) return null
    if (sel.kind === 'zone') {
      const item = current.zones.find((entry) => entry.id === sel.id)
      return item ? { kind: 'zone', item: structuredClone(item) } : null
    }
    if (sel.kind === 'plant') {
      const item = (current.plants ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'plant', item: structuredClone(item) } : null
    }
    if (sel.kind === 'fixture') {
      const item = (current.fixtures ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'fixture', item: structuredClone(item) } : null
    }
    if (sel.kind === 'note') {
      const item = (current.notes ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'note', item: structuredClone(item) } : null
    }
    if (sel.kind === 'sprinkler') {
      const item = current.sprinklers.find((entry) => entry.id === sel.id)
      return item ? { kind: 'sprinkler', item: structuredClone(item) } : null
    }
    if (sel.kind === 'valve') {
      const item = current.valves.find((entry) => entry.id === sel.id)
      return item ? { kind: 'valve', item: structuredClone(item) } : null
    }
    if (sel.kind === 'box') {
      const item = (current.boxes ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'box', item: structuredClone(item) } : null
    }
    if (sel.kind === 'hydrant') {
      const item = (current.hydrants ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'hydrant', item: structuredClone(item) } : null
    }
    if (sel.kind === 'sleeve') {
      const item = (current.sleeves ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'sleeve', item: structuredClone(item) } : null
    }
    if (sel.kind === 'pipe') {
      const item = current.pipes.find((entry) => entry.id === sel.id)
      return item ? { kind: 'pipe', item: structuredClone(item) } : null
    }
    if (sel.kind === 'drip') {
      const item = current.drips.find((entry) => entry.id === sel.id)
      return item ? { kind: 'drip', item: structuredClone(item) } : null
    }
    if (sel.kind === 'dim') {
      const item = (current.measures ?? []).find((entry) => entry.id === sel.id)
      return item ? { kind: 'dim', item: structuredClone(item) } : null
    }
    return null
  }

  function copySelected() {
    const clip = takenFromSelection()
    if (clip) clipboard.current = clip
  }

  function duplicateSelected() {
    const clip = takenFromSelection()
    if (clip) placeClip(clip)
  }

  function pasteClipboard() {
    const clip = clipboard.current
    if (!clip) return
    const placed = placeClip(clip)
    if (placed) clipboard.current = placed
  }

  function laid(clip: Clip): Clip {
    lastMark.current = clip
    return clip
  }

  function placeClip(clip: Clip): Clip | null {
    const current = docRef.current
    const step = 28
    if (clip.kind === 'zone') {
      if (current.zones.length >= 200) {
        setPlanNote('На чертеже уже 200 контуров')
        return null
      }
      const copy = shiftZone({ ...structuredClone(clip.item), id: uid('zone') }, step, step)
      commit({ ...current, zones: [...current.zones, copy] })
      setSelection({ kind: 'zone', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'zone', item: copy })
    }
    if (clip.kind === 'plant') {
      if ((current.plants ?? []).length >= 800) {
        setPlanNote('На чертеже уже 800 растений')
        return null
      }
      const copy: Plant = { ...structuredClone(clip.item), id: uid('plant'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, plants: [...(current.plants ?? []), copy] })
      setSelection({ kind: 'plant', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'plant', item: copy })
    }
    if (clip.kind === 'fixture') {
      if ((current.fixtures ?? []).length >= 800) {
        setPlanNote('На чертеже уже 800 объектов')
        return null
      }
      const copy: Fixture = { ...structuredClone(clip.item), id: uid('obj'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, fixtures: [...(current.fixtures ?? []), copy] })
      setSelection({ kind: 'fixture', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'fixture', item: copy })
    }
    if (clip.kind === 'note') {
      if ((current.notes ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 подписей')
        return null
      }
      const copy: Note = { ...structuredClone(clip.item), id: uid('note'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, notes: [...(current.notes ?? []), copy] })
      setSelection({ kind: 'note', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'note', item: copy })
    }
    if (clip.kind === 'sprinkler') {
      if (current.sprinklers.length >= 2000) {
        setPlanNote('На чертеже уже 2000 форсунок')
        return null
      }
      const copy: Sprinkler = { ...structuredClone(clip.item), id: uid('s'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, sprinklers: [...current.sprinklers, copy] })
      setSelection({ kind: 'sprinkler', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'sprinkler', item: copy })
    }
    if (clip.kind === 'valve') {
      if (current.valves.length >= 500) {
        setPlanNote('На чертеже уже 500 клапанов')
        return null
      }
      const copy: Valve = { ...structuredClone(clip.item), id: uid('valve'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, valves: [...current.valves, copy] })
      setSelection({ kind: 'valve', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'valve', item: copy })
    }
    if (clip.kind === 'box') {
      if ((current.boxes ?? []).length >= 200) {
        setPlanNote('На чертеже уже 200 боксов')
        return null
      }
      const copy: ValveBox = { ...structuredClone(clip.item), id: uid('box'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, boxes: [...(current.boxes ?? []), copy] })
      setSelection({ kind: 'box', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'box', item: copy })
    }
    if (clip.kind === 'hydrant') {
      if ((current.hydrants ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 гидрантов')
        return null
      }
      const copy: Hydrant = { ...structuredClone(clip.item), id: uid('hydrant'), x: clip.item.x + step, y: clip.item.y + step }
      commit({ ...current, hydrants: [...(current.hydrants ?? []), copy] })
      setSelection({ kind: 'hydrant', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'hydrant', item: copy })
    }
    if (clip.kind === 'sleeve') {
      if ((current.sleeves ?? []).length >= 400) {
        setPlanNote('На чертеже уже 400 гильз')
        return null
      }
      const copy: Sleeve = {
        ...structuredClone(clip.item),
        id: uid('sleeve'),
        a: { x: clip.item.a.x + step, y: clip.item.a.y + step },
        b: { x: clip.item.b.x + step, y: clip.item.b.y + step },
      }
      commit({ ...current, sleeves: [...(current.sleeves ?? []), copy] })
      setSelection({ kind: 'sleeve', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'sleeve', item: copy })
    }
    if (clip.kind === 'pipe') {
      if (current.pipes.length >= 2000) {
        setPlanNote('На чертеже уже 2000 труб')
        return null
      }
      const copy: Pipe = {
        ...structuredClone(clip.item),
        id: uid('pipe'),
        points: clip.item.points.map((point) => ({ x: point.x + step, y: point.y + step })),
      }
      commit({ ...current, pipes: [...current.pipes, copy] })
      setSelection({ kind: 'pipe', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'pipe', item: copy })
    }
    if (clip.kind === 'drip') {
      if (current.drips.length >= 400) {
        setPlanNote('На чертеже уже 400 капельных линий')
        return null
      }
      const copy: Drip = {
        ...structuredClone(clip.item),
        id: uid('drip'),
        points: clip.item.points.map((point) => ({ x: point.x + step, y: point.y + step })),
      }
      commit({ ...current, drips: [...current.drips, copy] })
      setSelection({ kind: 'drip', id: copy.id })
      setPlanNote('')
      return laid({ kind: 'drip', item: copy })
    }
    if ((current.measures ?? []).length >= 400) {
      setPlanNote('На чертеже уже 400 размеров')
      return null
    }
    const copy: Measure = {
      id: uid('dim'),
      a: { x: clip.item.a.x + step, y: clip.item.a.y + step },
      b: { x: clip.item.b.x + step, y: clip.item.b.y + step },
    }
    commit({ ...current, measures: [...(current.measures ?? []), copy] })
    setSelection({ kind: 'dim', id: copy.id })
    setPlanNote('')
    return laid({ kind: 'dim', item: copy })
  }

  if (!loaded) return <div className="boot">{error || 'Загрузка проекта…'}</div>

  const selectedZone = selection?.kind === 'zone' ? doc.zones.find((item) => item.id === selection.id) : undefined
  const selectedSprinkler = selection?.kind === 'sprinkler' ? doc.sprinklers.find((item) => item.id === selection.id) : undefined
  const selectedNote = selection?.kind === 'note' ? (doc.notes ?? []).find((item) => item.id === selection.id) : undefined
  const selectedPlant = selection?.kind === 'plant' ? (doc.plants ?? []).find((item) => item.id === selection.id) : undefined
  const selectedFixture = selection?.kind === 'fixture' ? (doc.fixtures ?? []).find((item) => item.id === selection.id) : undefined
  const selectedMeasure = selection?.kind === 'dim' ? (doc.measures ?? []).find((item) => item.id === selection.id) : undefined
  const selectedPipe = selection?.kind === 'pipe' ? doc.pipes.find((item) => item.id === selection.id) : undefined
  const selectedBox = selection?.kind === 'box' ? (doc.boxes ?? []).find((item) => item.id === selection.id) : undefined
  const selectedHydrant = selection?.kind === 'hydrant' ? (doc.hydrants ?? []).find((item) => item.id === selection.id) : undefined
  const selectedSleeve = selection?.kind === 'sleeve' ? (doc.sleeves ?? []).find((item) => item.id === selection.id) : undefined
  const sleeveM = selectedSleeve ? sleeveLengthM([selectedSleeve], ppm) : null
  const pipeDiameters = selectedPipe
    ? [...new Set(analysis.segments.flatMap((item) => (item.pipeId === selectedPipe.id && item.odMm ? [item.odMm] : [])))]
    : []
  const shapeOn = isShapeTool(tool)
  const elementOn = tool === 'scale' || tool === 'dim' || anchorPick || (tool === 'fixture' && groupOf(fixtureKind) === 'mark')
  const objectOn = tool === 'fixture' && groupOf(fixtureKind) !== 'mark'
  const shapeLabel = tool === 'brush' ? 'Кисть' : tool === 'rect' ? 'Прямоуг.' : tool === 'circle' ? 'Круг' : 'Полигон'
  const headKind = nozzleById(nozzleId).kind
  function pickHead(kind: NozzleKind) {
    setTool('sprinkler')
    if (headKind === kind) return
    const next = kind === 'fan' ? 'fan180' : kind === 'rotator' ? 'rot6-180' : kind === 'rotor' ? 'rotor' : 'bub240'
    setNozzleId(next)
  }
  const zoneDraft = tool === 'pipe' && pipeRole === 'zone'
  const previewPoints = zoneDraft && hover ? [...draft, hover] : draft
  const liveFlow = zoneDraft ? draftHeadFlow(doc, previewPoints, SNAP_PX) : 0
  const draftWarn = Boolean(zoneDraft && doc.source?.flowLimitLph && liveFlow > doc.source.flowLimitLph + 1e-6)
  const joinIds = zoneDraft ? joinableHeads(doc, draft, SNAP_PX).map((head) => head.id) : []
  const snapMark = hover && doc.snapVertex !== false ? nearestScreen(hover, collectVertices(doc), view.k, 1.5) : null
  const hoverLen = draft.length > 0 && hover ? dist(draft[draft.length - 1], hover) / ppm : 0
  const zoneArea = selectedZone ? zoneAreaPx(selectedZone.points, selectedZone.holes) / (ppm * ppm) : 0
  const zonePerim = selectedZone
    ? (ringLength(selectedZone.points, selectedZone.bends) + (selectedZone.holes ?? []).reduce((sum, hole) => sum + ringLength(hole), 0)) / ppm
    : 0

  return (
    <main className={step === 'spec' ? 'workshop tab-spec' : 'workshop'}>
      <header className="ws-head">
        <button className="mark link" onClick={() => go('/projects')}>Полив</button>
        <nav className="ws-tabs">
          {TABS.map((item) => (
            <button key={item.id} className={step === item.id ? 'tab active' : 'tab'} onClick={() => openStep(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <input className="name" value={name} onChange={(event) => setName(event.target.value)} aria-label="Название проекта" />
        <button className={doc.gridOn !== false ? 'icon on' : 'icon'} title="Сетка" onClick={() => setDoc((current) => ({ ...current, gridOn: current.gridOn === false }))}>#</button>
        <button className={doc.snapGrid === true ? 'icon on' : 'icon'} title="Привязка к сетке" onClick={() => setDoc((current) => ({ ...current, snapGrid: current.snapGrid !== true }))}>▦</button>
        <button className={doc.snapVertex !== false ? 'icon on' : 'icon'} title="Привязка к вершинам" onClick={() => setDoc((current) => ({ ...current, snapVertex: current.snapVertex === false }))}>◇</button>
        <button className={doc.ortho === true ? 'icon on' : 'icon'} title="Ортогональ" onClick={() => setDoc((current) => ({ ...current, ortho: current.ortho !== true }))}>⊥</button>
        <button className="icon" title="Отменить" onClick={undo}>↶</button>
        <button className="icon" title="Повторить" onClick={redo}>↷</button>
        <button className="icon" title="Вписать" onClick={fit}>▣</button>
        <span className="status">{status}</span>
        <span className="who">{user.name}</span>
        <button className="ghost" onClick={logout}>Выйти</button>
      </header>
      <aside className="ws-tools">
        {step === 'draw' && (
          <>
            <div className="tool-rail">
              {SURFACES.map((surface) => (
                <RailButton
                  key={surface.id}
                  active={!mapOpen && !favOpen && shapeOn && zoneKind === surface.id}
                  label={surface.label}
                  onClick={() => openSurface(surface.id)}
                >
                  <i className={`chip ${surface.pattern}`} />
                </RailButton>
              ))}
              <i className="rail-split" />
              <RailButton active={!mapOpen && !favOpen && tool === 'text'} label="Текст" onClick={() => { closePanels(); setTool('text'); setLineOp(null); setLine([]) }}>
                <Glyph><path d="M6 6 H18 M12 6 V19" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={!mapOpen && !favOpen && tool === 'tree'} label="Дерево" onClick={() => { closePanels(); setTool('tree'); setLineOp(null); setLine([]) }}>
                <PlantRailIcon form={treeForm} />
              </RailButton>
              <RailButton active={!mapOpen && !favOpen && tool === 'bush'} label="Куст" onClick={() => { closePanels(); setTool('bush'); setLineOp(null); setLine([]) }}>
                <PlantRailIcon form={bushForm} />
              </RailButton>
              <RailButton
                active={!mapOpen && !favOpen && objectOn}
                label="Объекты"
                onClick={() => {
                  closePanels()
                  setLineOp(null)
                  setLine([])
                  if (groupOf(fixtureKind) === 'mark') setFixtureKind('boulder')
                  setTool('fixture')
                }}
              >
                <Glyph><circle cx="8" cy="15" r="3" {...pen} /><path d="M13 9 H20 V13 H13 Z M14 13 V17 M19 13 V17" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={mapOpen} label="Карта" onClick={() => { setFavOpen(false); setMapOpen((open) => !open) }}>
                <Glyph><path d="M4 7 L9 5 L15 8 L20 6 V17 L15 19 L9 16 L4 18 Z" {...pen} /></Glyph>
              </RailButton>
              <RailButton
                active={!mapOpen && !favOpen && elementOn}
                label="Элементы"
                onClick={() => {
                  closePanels()
                  setLineOp(null)
                  setLine([])
                  setAnchorPick(false)
                  if (groupOf(fixtureKind) !== 'mark') setFixtureKind('compass')
                  setTool('fixture')
                }}
              >
                <Glyph><circle cx="12" cy="12" r="7" {...pen} /><path d="M12 6 L14.2 12 L12 11 L9.8 12 Z" {...pen} /></Glyph>
              </RailButton>
              <i className="rail-split" />
              <RailButton active={!mapOpen && !favOpen && shapeOn && isWetKind(zoneKind)} label="Поливать" onClick={() => openSurface(isWetKind(zoneKind) ? zoneKind : 'lawn')}>
                <Glyph><path d="M12 4 C12 4 7 10 7 14 a5 5 0 0 0 10 0 C17 10 12 4 12 4 Z" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={!mapOpen && !favOpen && shapeOn && !isWetKind(zoneKind)} label="Без полива" onClick={() => openSurface(isWetKind(zoneKind) ? 'path' : zoneKind)}>
                <Glyph><circle cx="12" cy="12" r="7" {...pen} /><path d="M7 17 L17 7" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={favOpen} label="Избранное" onClick={() => { setMapOpen(false); setFavOpen((open) => !open) }}>
                <Glyph><path d="M12 4 L14.2 9.2 L20 9.6 L15.6 13.2 L17 19 L12 15.8 L7 19 L8.4 13.2 L4 9.6 L9.8 9.2 Z" {...pen} /></Glyph>
              </RailButton>
              <i className="rail-split" />
              <RailButton active={tool === 'source'} label="Источник" onClick={() => { closePanels(); setTool('source') }}>
                <Glyph><rect x="6" y="6" width="12" height="12" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'valve'} label="Клапан" onClick={() => { closePanels(); setTool('valve') }}>
                <Glyph><path d="M12 4 L20 12 L12 20 L4 12 Z" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={!mapOpen && !favOpen && tool === 'fixture' && fixtureKind === 'controller'} label="Пульт" onClick={() => chooseFixture('controller', false)}>
                <Glyph><rect x="7" y="4" width="10" height="16" rx="1.5" {...pen} /><path d="M9 7 H15 V11 H9 Z" {...pen} /></Glyph>
              </RailButton>
              <RailButton
                sink
                active={!mapOpen && !favOpen && shapeOn}
                label={shapeLabel}
                onClick={() => {
                  closePanels()
                  if (!shapeOn) {
                    setTool('zone')
                    setDraftPoints([])
                  }
                }}
              >
                {tool === 'brush'
                  ? <Glyph><path d="M5 19 C8 12 10 11 14 6 C16 4 19 5 18 8 C16 12 14 13 8 18 Z" {...pen} /></Glyph>
                  : <Glyph><path d="M5 8 L12 4 L20 8 L17 19 L7 19 Z" {...pen} /></Glyph>}
              </RailButton>
            </div>
            {mapOpen && (
              <div className="tool-fly">
                <p className="tool-label">Карта</p>
                <button className="tool" onClick={() => underlayRef.current?.click()}>Загрузить план</button>
                {backgroundUrl && <button className="tool" onClick={() => clearBackground().catch((err: Error) => setError(err.message))}>Убрать подложку</button>}
                <button className="tool" onClick={loadExample}>Пример</button>
              </div>
            )}
            {!mapOpen && favOpen && (
              <div className="tool-fly">
                <p className="tool-label">Избранное</p>
                {favorites.length === 0 && <p className="hint">Выберите дерево, куст или объект. Последние появятся здесь.</p>}
                <div className="plant-grid">
                  {favorites.map((fav) => (
                    <button
                      key={favKey(fav)}
                      type="button"
                      className="plant-pick"
                      title={favLabel(fav)}
                      aria-label={favLabel(fav)}
                      onClick={() => {
                        if (fav.kind === 'fixture') chooseFixture(fav.form, false)
                        else {
                          closePanels()
                          if (fav.kind === 'tree') setTreeForm(fav.form)
                          else setBushForm(fav.form)
                          setTool(fav.kind)
                          rememberFav(fav)
                        }
                      }}
                    >
                      {fav.kind === 'fixture' ? <FixtureThumb kind={fav.form} /> : <PlantThumb form={fav.form} />}
                      <span className="plant-name">{favLabel(fav)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!mapOpen && !favOpen && (tool === 'tree' || tool === 'bush') && (
              <div className="tool-fly">
                <p className="tool-label">{tool === 'tree' ? 'Деревья' : 'Кусты'}</p>
                <PlantPicker labeled kind={tool} active={tool === 'tree' ? treeForm : bushForm} onPick={pickForm} />
              </div>
            )}
            {!mapOpen && !favOpen && objectOn && (
              <div className="tool-fly">
                <p className="tool-label">Объекты</p>
                {FIXTURE_GROUPS.filter((group) => group.id !== 'mark').map((group) => (
                  <div key={group.id}>
                    <p className="tool-label">{group.label}</p>
                    <FixturePicker kinds={fixtureKinds(group.id)} active={fixtureKind} onPick={(kind) => chooseFixture(kind, true)} />
                  </div>
                ))}
              </div>
            )}
            {!mapOpen && !favOpen && elementOn && (
              <div className="tool-fly">
                <p className="tool-label">Элементы</p>
                <FixturePicker kinds={fixtureKinds('mark')} active={tool === 'fixture' ? fixtureKind : 'compass'} onPick={(kind) => chooseFixture(kind, true)} />
                <button className={tool === 'scale' ? 'tool active' : 'tool'} onClick={() => { setTool('scale'); setScalePoints([]); setLineOp(null); setAnchorPick(false) }}>Линейка</button>
                <button className={tool === 'dim' ? 'tool active' : 'tool'} onClick={() => { setTool('dim'); setLineOp(null); setLine([]); setDim([]); setAnchorPick(false) }}>Размер</button>
                <button className={anchorPick ? 'tool active' : 'tool'} onClick={() => armAnchor()}>Якорь</button>
                {doc.anchor && <button className="tool" onClick={clearAnchor}>Убрать якорь</button>}
              </div>
            )}
            {!mapOpen && !favOpen && shapeOn && !elementOn && (
              <div className="tool-fly">
                <p className="tool-label">Полигон / кисть</p>
                <p className="tool-label">{surfaceOf(zoneKind).label}</p>
                <div className="brush-sizes">
                  {([
                    ['zone', 'Полигон'],
                    ['rect', 'Прямоуг.'],
                    ['circle', 'Круг'],
                    ['brush', 'Кисть'],
                  ] as const).map(([next, label]) => (
                    <button key={next} className={tool === next ? 'tool active' : 'tool'} onClick={() => { setTool(next); setDraftPoints([]) }}>{label}</button>
                  ))}
                </div>
                {hatchesFor(zoneKind).length > 1 && (
                  <div className="hatch-row">
                    {hatchesFor(zoneKind).map((item) => (
                      <button
                        key={item.id}
                        className={hatchOf({ kind: zoneKind, hatch: drawHatch }) === item.id ? 'tool active' : 'tool'}
                        onClick={() => setDrawHatch(item.id === surfaceOf(zoneKind).pattern ? null : item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                {tool === 'circle' && (
                  <label className="side-field">
                    Диаметр, м
                    <input
                      value={diameterM}
                      inputMode="decimal"
                      aria-label="Диаметр круга, м"
                      onChange={(event) => setDiameterM(event.target.value)}
                    />
                  </label>
                )}
                {tool === 'brush' && (
                  <>
                    <div className="brush-sizes">
                      {([
                        ['round', 'Круг'],
                        ['square', 'Квадрат'],
                        ['triangle', 'Треуг.'],
                      ] as const).map(([tip, label]) => (
                        <button key={tip} className={brushTip === tip ? 'tool active' : 'tool'} onClick={() => setBrushTip(tip)}>{label}</button>
                      ))}
                    </div>
                    <div className="brush-sizes">
                      {[0.4, 0.8, 1.6].map((width) => (
                        <button key={width} className={brushM === width ? 'tool active' : 'tool'} onClick={() => setBrushM(width)}>{width} м</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <input
              ref={underlayRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onBackground(file).catch((err: Error) => setError(err.message))
                event.target.value = ''
              }}
            />
          </>
        )}
        {step === 'irrig' && (
          <>
            <div className="tool-rail">
              <RailButton active={tool === 'sprinkler' && headKind === 'fan'} label="Форсунка" onClick={() => pickHead('fan')}>
                <Glyph><circle cx="12" cy="12" r="3" {...pen} /><path d="M12 5 A7 7 0 0 1 19 12" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'sprinkler' && headKind === 'rotator'} label="Ротатор" onClick={() => pickHead('rotator')}>
                <Glyph><circle cx="12" cy="12" r="2.2" {...pen} /><path d="M12 6 L14 9 M12 6 L10 9 M16 12 L13 13 M8 12 L11 13" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'sprinkler' && headKind === 'rotor'} label="Ротор" onClick={() => pickHead('rotor')}>
                <Glyph><circle cx="12" cy="12" r="2.2" {...pen} /><path d="M12 4 A8 8 0 0 1 20 12" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'sprinkler' && headKind === 'bubbler'} label="Баблер" onClick={() => pickHead('bubbler')}>
                <Glyph><circle cx="12" cy="12" r="3.2" {...pen} /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></Glyph>
              </RailButton>
              <RailButton active={tool === 'drip'} label="Капля" onClick={() => { setTool('drip'); setDraftPoints([]) }}>
                <Glyph><path d="M4 12 H20" {...pen} strokeDasharray="3 2" /></Glyph>
              </RailButton>
              <RailButton active={tool === 'source'} label="Источник" onClick={() => setTool('source')}>
                <Glyph><rect x="6" y="6" width="12" height="12" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'valve'} label="Клапан" onClick={() => setTool('valve')}>
                <Glyph><path d="M12 4 L20 12 L12 20 L4 12 Z" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'box'} label="Бокс" onClick={() => setTool('box')}>
                <Glyph><rect x="4" y="7" width="16" height="10" rx="2" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'hydrant'} label="Гидрант" onClick={() => setTool('hydrant')}>
                <Glyph><circle cx="12" cy="8" r="3.2" {...pen} /><path d="M12 11 V19 M8 16 H16" {...pen} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'sleeve'} label="Гильза" onClick={() => { setTool('sleeve'); setSleeve([]) }}>
                <Glyph><path d="M4 16 H20" {...pen} strokeWidth={4.2} /><path d="M5 16 H19" {...pen} strokeWidth={1.15} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'pipe' && pipeRole === 'main'} label="Магистраль" onClick={() => pickPipe('main')}>
                <Glyph><path d="M3 16 H13 L20 7" {...pen} strokeWidth={3.1} /></Glyph>
              </RailButton>
              <RailButton active={tool === 'pipe' && pipeRole === 'zone'} label="Зональная" onClick={() => pickPipe('zone')}>
                <Glyph><path d="M4 16 H14 L20 8" {...pen} strokeWidth={1.35} /></Glyph>
              </RailButton>
              <button className="rail-go" onClick={runLayout}>Схема</button>
            </div>
            <div className="tool-fly irrig-fly">
              <div className="fly-scroll">
                {tool === 'sprinkler' && (
                  <NozzleFly kind={headKind} nozzleId={nozzleId} riseCm={riseCm} onPick={setNozzleId} onRise={setRiseCm} />
                )}
                {tool === 'box' && <p className="hint">Коробка для нескольких клапанов. Клапан рядом садится в свободный слот.</p>}
                {tool === 'hydrant' && <p className="hint">Точка на трубе. В спецификации на этом конце стоит гидрант.</p>}
                {tool === 'sleeve' && <p className="hint">Два клика по концам. Длина попадёт в спецификацию.</p>}
                {tool === 'pipe' && (
                  <p className="hint">{pipeRole === 'main' ? 'Магистраль толще и идёт к клапанам.' : 'Зональная тоньше и идёт от клапана к дождевателям. Подходящие подсвечены.'}</p>
                )}
              </div>
              <div className="gear-pin">
                <p className="tool-label">Трубы</p>
                <select
                  value={doc.pipeSeries}
                  aria-label="Ряд труб"
                  onChange={(event) => setDoc((current) => ({ ...current, pipeSeries: event.target.value as PipeSeriesId }))}
                >
                  {SERIES.map((series) => (
                    <option key={series.id} value={series.id}>{series.name}</option>
                  ))}
                </select>
                <GearBlock doc={doc} analysis={analysis} compact />
              </div>
            </div>
          </>
        )}
        {step === 'layout' && (
          <div className="tool-panel">
            <p className="tool-label">Формат</p>
            {PAPERS.map((item) => (
              <button
                key={item.id}
                className={paper === item.id ? 'tool active' : 'tool'}
                onClick={() => setPaper(item.id)}
              >
                {item.name}
              </button>
            ))}
            <p className="tool-label">Слои</p>
            {([
              ['underlay', 'Подложка'],
              ['grid', 'Сетка'],
              ['landscape', 'Ландшафт'],
              ['spray', 'Дождеватели'],
              ['pipes', 'Трубы'],
              ['drip', 'Капля'],
              ['fittings', 'Клапаны'],
            ] as const).map(([key, label]) => (
              <label key={key} className="layer">
                <input
                  type="checkbox"
                  checked={sheetLayers[key]}
                  onChange={() => setSheetLayers((current) => ({ ...current, [key]: !current[key] }))}
                />
                {label}
              </label>
            ))}
            <label className="layer">
              <input type="checkbox" checked={includeSpec} onChange={() => setIncludeSpec((value) => !value)} />
              Спецификация
            </label>
            <div className="tool-gap" />
            <button className="primary" disabled={printBusy} onClick={() => runPrint('pdf')}>
              {printBusy ? 'Собираю…' : 'Скачать PDF'}
            </button>
            <button className="tool" disabled={printBusy} onClick={() => runPrint('png')}>Скачать PNG</button>
            <p className="hint">На листе — рамка, легенда и масштаб. ПКМ двигает чертёж.</p>
          </div>
        )}
        {step === 'spec' && (
          <div className="tool-panel">
            <p className="hint">Список к закупке справа. «Скопировать» кладёт его в буфер. Печать дописывает продолжение, если строк много.</p>
          </div>
        )}
      </aside>
      <div className="stage">
        <Board
          ref={svgRef}
          doc={doc}
          analysis={analysis}
          view={view}
          board={board}
          backgroundUrl={backgroundUrl}
          imageSize={imageSize}
          draft={draft}
          draftKind={zoneKind}
          sketch={tool === 'rect' || tool === 'circle' || tool === 'brush' ? tool : 'poly'}
          brushWidth={brushM * ppm}
          brushTip={brushTip}
          guide={linePts.length ? linePts : tool === 'dim' ? dimPts : tool === 'sleeve' ? sleevePts : []}
          snapMark={snapMark}
          draftLine={tool === 'drip' ? 'drip' : tool === 'pipe' ? pipeRole : 'poly'}
          draftWarn={draftWarn}
          joinIds={joinIds}
          showOk={(tool === 'zone' && draft.length >= 3) || ((tool === 'pipe' || tool === 'drip') && draft.length >= 2)}
          hover={tool === 'zone' || tool === 'pipe' || tool === 'drip' || tool === 'scale' || tool === 'rect' || tool === 'circle' || tool === 'brush' || tool === 'dim' || tool === 'sleeve' ? hover : null}
          scalePoints={scalePoints}
          selectionId={selection?.id ?? null}
          selectionKind={selection?.kind ?? null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pan.current = null
            drag.current = null; stretch.current = null
            click.current = null
            grab.current = null
          }}
          onFinishDraft={finishDraft}
          onContextMenu={(event) => event.preventDefault()}
        />
        {(tool === 'zone' || tool === 'pipe' || tool === 'drip') && draft.length >= (tool === 'zone' ? 3 : 2) && (
          <button
            type="button"
            className="ok-on-line"
            style={{
              left: view.x + draft[draft.length - 1].x * view.k,
              top: view.y + draft[draft.length - 1].y * view.k,
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              finishDraft()
            }}
            onClick={(event) => {
              event.stopPropagation()
              finishDraft()
            }}
          >
            OK
          </button>
        )}
        {tool === 'scale' && (
          <div className="ops">
            <span>{scalePoints.length < 2 ? 'Две точки известного отрезка' : `${Math.round(scalePx)} px`}</span>
            <label className="inline">
              м
              <input value={scaleMeters} onChange={(event) => setScaleMeters(event.target.value)} />
            </label>
            <button className="primary" onClick={applyScale} disabled={scalePoints.length < 2}>OK</button>
          </div>
        )}
        {selectedSprinkler && draft.length === 0 && (
          <div className="ops">
            <button className="tool" onClick={() => rotateSelected(-15)} title="Против часовой">↺ 15°</button>
            <button className="tool" onClick={() => rotateSelected(15)} title="По часовой">↻ 15°</button>
            <button className="tool" onClick={() => rotateSelected(90)} title="Повернуть на 90°">↻ 90°</button>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedNote && draft.length === 0 && (
          <div className="ops">
            <label className="inline">
              текст
              <input
                value={selectedNote.text}
                className="wide"
                aria-label="Текст подписи"
                onChange={(event) => {
                  const text = event.target.value.slice(0, 80)
                  setDoc((current) => ({
                    ...current,
                    notes: (current.notes ?? []).map((item) => (item.id === selectedNote.id ? { ...item, text } : item)),
                  }))
                }}
                onBlur={() => {
                  if (selectedNote.text.trim()) return
                  setDoc((current) => ({
                    ...current,
                    notes: (current.notes ?? []).map((item) => (item.id === selectedNote.id ? { ...item, text: 'Подпись' } : item)),
                  }))
                }}
              />
            </label>
            <label className="inline">
              м
              <input
                value={String(selectedNote.sizeM)}
                aria-label="Высота подписи, м"
                onChange={(event) => {
                  const sizeM = Number(event.target.value.replace(',', '.'))
                  if (!(sizeM >= 0.15) || sizeM > 5) return
                  setDoc((current) => ({
                    ...current,
                    notes: (current.notes ?? []).map((item) => (item.id === selectedNote.id ? { ...item, sizeM } : item)),
                  }))
                }}
              />
            </label>
            <span className="ink-row">
              {INKS.map((ink) => (
                <button
                  key={ink}
                  type="button"
                  className={selectedNote.color === ink ? 'ink active' : 'ink'}
                  style={{ background: ink }}
                  title={ink}
                  aria-label={`Цвет подписи ${ink}`}
                  onClick={() => commit({
                    ...docRef.current,
                    notes: (docRef.current.notes ?? []).map((item) => (
                      item.id === selectedNote.id ? styleNote(item, { color: item.color === ink ? null : ink }) : item
                    )),
                  })}
                />
              ))}
              <button
                className={selectedNote.bold ? 'tool active' : 'tool'}
                onClick={() => commit({
                  ...docRef.current,
                  notes: (docRef.current.notes ?? []).map((item) => (
                    item.id === selectedNote.id ? styleNote(item, { bold: !item.bold }) : item
                  )),
                })}
              >
                Жирный
              </button>
            </span>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedPlant && draft.length === 0 && (
          <div className="ops">
            <span>{formsFor(selectedPlant.kind).find((item) => item.id === formOf(selectedPlant))?.label}</span>
            <PlantPicker kind={selectedPlant.kind} active={formOf(selectedPlant)} onPick={pickForm} />
            <label className="inline">
              радиус, м
              <input
                value={String(selectedPlant.radiusM)}
                aria-label="Радиус растения, м"
                onChange={(event) => {
                  const radiusM = Number(event.target.value.replace(',', '.'))
                  if (!(radiusM >= 0.2) || radiusM > 8) return
                  setDoc((current) => ({
                    ...current,
                    plants: (current.plants ?? []).map((item) => (item.id === selectedPlant.id ? { ...item, radiusM } : item)),
                  }))
                }}
              />
            </label>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedFixture && draft.length === 0 && (
          <div className="ops">
            <span>{fixtureSpec(selectedFixture.kind).label}</span>
            <FixturePicker kinds={fixtureKinds(groupOf(selectedFixture.kind))} active={selectedFixture.kind} onPick={(kind) => chooseFixture(kind, true)} />
            <label className="inline">
              длина, м
              <input
                value={String(Math.round(selectedFixture.radiusM * 200) / 100)}
                aria-label="Длина объекта, м"
                onChange={(event) => {
                  const lengthM = Number(event.target.value.replace(',', '.'))
                  if (!(lengthM >= 0.2) || lengthM > 40) return
                  const radiusM = lengthM / 2
                  setDoc((current) => ({
                    ...current,
                    fixtures: (current.fixtures ?? []).map((item) => (item.id === selectedFixture.id ? { ...item, radiusM } : item)),
                  }))
                }}
              />
            </label>
            <label className="inline">
              °
              <input
                value={String(Math.round(selectedFixture.rotationDeg ?? 0))}
                aria-label="Поворот объекта, градусы"
                onChange={(event) => {
                  const turn = Number(event.target.value.replace(',', '.'))
                  if (!Number.isFinite(turn)) return
                  setDoc((current) => ({
                    ...current,
                    fixtures: (current.fixtures ?? []).map((item) => (
                      item.id === selectedFixture.id ? withSpin(item, turn) : item
                    )),
                  }))
                }}
              />
            </label>
            <button
              className="tool"
              onClick={() => commit({
                ...docRef.current,
                fixtures: (docRef.current.fixtures ?? []).map((item) => (
                  item.id === selectedFixture.id ? withSpin(item, (item.rotationDeg ?? 0) + 90) : item
                )),
              })}
            >
              ↻ 90°
            </button>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedPipe && draft.length === 0 && (
          <div className="ops">
            <button className={selectedPipe.role === 'zone' ? 'tool' : 'tool active'} onClick={() => assignPipe(selectedPipe.id, 'main')}>Магистраль</button>
            <button className={selectedPipe.role === 'zone' ? 'tool active' : 'tool'} onClick={() => assignPipe(selectedPipe.id, 'zone')}>Зональная</button>
            {pipeDiameters.length > 0 && <span>{pipeDiameters.map((od) => `Ø${od}`).join(' · ')}</span>}
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedBox && draft.length === 0 && (
          <div className="ops">
            <label className="inline">
              имя
              <input
                value={selectedBox.name}
                className="wide"
                aria-label="Имя клапанного бокса"
                onChange={(event) => {
                  const name = event.target.value.slice(0, 80)
                  setDoc((current) => ({
                    ...current,
                    boxes: (current.boxes ?? []).map((item) => (item.id === selectedBox.id ? { ...item, name } : item)),
                  }))
                }}
                onBlur={() => {
                  if (selectedBox.name.trim()) return
                  setDoc((current) => ({
                    ...current,
                    boxes: (current.boxes ?? []).map((item) => (item.id === selectedBox.id ? { ...item, name: 'Бокс' } : item)),
                  }))
                }}
              />
            </label>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedHydrant && draft.length === 0 && (
          <div className="ops">
            <span>Гидрант</span>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedSleeve && draft.length === 0 && (
          <div className="ops">
            <span>Гильза {sleeveM === null ? '—' : `${sleeveM.toFixed(2)} м`}</span>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedMeasure && draft.length === 0 && (
          <div className="ops">
            <span>Размер {(dist(selectedMeasure.a, selectedMeasure.b) / ppm).toFixed(2)} м</span>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedZone && draft.length === 0 && (
          <div className="ops">
            {SURFACES.map((surface) => (
              <button
                key={surface.id}
                className={selectedZone.kind === surface.id ? 'swatch active' : 'swatch'}
                onClick={() => setDoc((current) => ({
                  ...current,
                  zones: current.zones.map((zone) => zone.id === selectedZone.id ? paintZone(zone, surface.id) : zone),
                }))}
              >
                {surface.label}
              </button>
            ))}
            {hatchesFor(selectedZone.kind).length > 1 && (
              <span className="hatch-row">
                {hatchesFor(selectedZone.kind).map((item) => (
                  <button
                    key={item.id}
                    className={hatchOf(selectedZone) === item.id ? 'tool active' : 'tool'}
                    onClick={() => commit({
                      ...docRef.current,
                      zones: docRef.current.zones.map((zone) => zone.id === selectedZone.id ? withHatch(zone, item.id) : zone),
                    })}
                  >
                    {item.label}
                  </button>
                ))}
              </span>
            )}
            <span className="ink-row">
              {INKS.map((ink) => (
                <button
                  key={ink}
                  type="button"
                  className={selectedZone.stroke === ink ? 'ink active' : 'ink'}
                  style={{ background: ink }}
                  title={ink}
                  aria-label={`Обводка ${ink}`}
                  onClick={() => mapSelectedZone((zone) => styleZone(zone, { stroke: zone.stroke === ink ? null : ink }))}
                />
              ))}
              {([
                [1, '100%'],
                [0.65, '65%'],
                [0.35, '35%'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={(selectedZone.opacity ?? 1) === value ? 'tool active' : 'tool'}
                  onClick={() => mapSelectedZone((zone) => styleZone(zone, {
                    opacity: (zone.opacity ?? 1) === value ? null : value,
                  }))}
                >
                  {label}
                </button>
              ))}
              {([
                [null, 'Обычная'],
                [1, 'Тонкая'],
                [3.6, 'Жирная'],
              ] as const).map(([pen, label]) => (
                <button
                  key={label}
                  className={(selectedZone.pen ?? null) === pen ? 'tool active' : 'tool'}
                  onClick={() => mapSelectedZone((zone) => styleZone(zone, {
                    pen: (zone.pen ?? null) === pen ? null : pen,
                  }))}
                >
                  {label}
                </button>
              ))}
            </span>
            <button className="tool" onClick={() => rotateSelected(90)} title="Повернуть">↻ 90°</button>
            {doc.anchor && <span>вокруг якоря</span>}
            <button className="tool" onClick={() => flipSelected('x')} title="Отразить по горизонтали">↔</button>
            <button className="tool" onClick={() => flipSelected('y')} title="Отразить по вертикали">↕</button>
            <button className="tool" onClick={() => scaleSelected(1.1)} title="Крупнее">＋</button>
            <button className="tool" onClick={() => scaleSelected(0.9)} title="Мельче">−</button>
            <label className="inline">
              смещение, м
              <input value={offsetM} onChange={(event) => setOffsetM(event.target.value)} aria-label="Смещение, м" />
            </label>
            <button className="tool" onClick={() => applyOffset(1)} title="Раздуть контур">Наружу</button>
            <button className="tool" onClick={parallelCopy} title="Новый контур снаружи, на величину смещения">Копия наружу</button>
            <button className="tool" onClick={() => applyOffset(-1)} title="Сжать контур">Внутрь</button>
            <label className="inline">
              ширина
              <input value={sizeW} onChange={(event) => setSizeW(event.target.value)} aria-label="Ширина, м" />
            </label>
            <label className="inline">
              высота
              <input value={sizeH} onChange={(event) => setSizeH(event.target.value)} aria-label="Высота, м" />
            </label>
            <button className="tool" onClick={applySize}>Размер</button>
            {([
              ['union', 'Объединить'],
              ['diff', 'Вычесть'],
              ['intersect', 'Пересечь'],
              ['xor', 'Исключить'],
            ] as const).map(([op, label]) => (
              <button
                key={op}
                className={boolPick === op ? 'tool active' : 'tool'}
                onClick={() => {
                  setLineOp(null)
                  setLine([])
                  setAnchorPick(false)
                  setAlignPick(null)
                  setBoolPick((current) => (current === op ? null : op))
                }}
              >
                {label}
              </button>
            ))}
            <button className={lineOp === 'slice' ? 'tool active' : 'tool'} onClick={() => armLine('slice')}>Разрезать</button>
            <button className={lineOp === 'mirror' ? 'tool active' : 'tool'} onClick={() => armLine('mirror')}>Зеркало</button>
            {selectedZone.bends?.some(Boolean) && (
              <button className="tool" onClick={flattenSelected}>В полигон</button>
            )}
            <span className="hatch-row">
              {ALIGN_SIDES.map((item) => (
                <button
                  key={item.id}
                  className={alignPick === item.id ? 'tool active' : 'tool'}
                  onClick={() => armAlign(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <button className="tool" onClick={() => restack(true)} title="Нарисовать поверх остальных">Вперёд</button>
              <button className="tool" onClick={() => restack(false)} title="Спрятать под остальные">Назад</button>
            </span>
            <button className="tool" onClick={duplicateSelected} title="Копия, Ctrl+D">Копия</button>
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
      </div>
      {step === 'spec' && (
        <div className="side">
          <Spec
            doc={doc}
            analysis={analysis}
            selection={selection}
            onZone={(id, patch) => setDoc((current) => ({ ...current, zones: current.zones.map((zone) => (zone.id === id ? cleanZone(zone, patch) : zone)) }))}
            onSprinkler={(id, patch) => setDoc((current) => ({
              ...current,
              sprinklers: current.sprinklers.map((item) => (item.id === id ? cleanSprinkler(item, patch) : item)),
            }))}
            onSource={(patch) => setDoc((current) => (current.source ? { ...current, source: cleanSource(current.source, patch) } : current))}
            onValve={(id, patch) => setDoc((current) => ({
              ...current,
              valves: current.valves.map((item) => (item.id === id ? { ...item, name: patch.name?.trim() ? patch.name : item.name } : item)),
            }))}
            onDrip={(id, patch) => setDoc((current) => ({
              ...current,
              drips: current.drips.map((item) => (item.id === id ? cleanDrip(item, patch) : item)),
            }))}
            onSeries={(id) => setDoc((current) => ({ ...current, pipeSeries: id }))}
            onPipe={(id, role) => assignPipe(id, role)}
            onBox={(id, name) => setDoc((current) => ({
              ...current,
              boxes: (current.boxes ?? []).map((item) => (item.id === id ? { ...item, name: name.trim() ? name.slice(0, 80) : item.name } : item)),
            }))}
            onTrench={(patch) => setDoc((current) => ({ ...current, trench: cleanTrench(current.trench, patch) }))}
            onDelete={removeSelection}
          />
        </div>
      )}
      <footer className="ws-status">
        {error && <span className="error">{error}</span>}
        {planNote && <span>{planNote}</span>}
        {hover && <span>X {(hover.x / ppm).toFixed(2)} м · Y {(hover.y / ppm).toFixed(2)} м</span>}
        {draft.length > 0 && hoverLen > 0 && <span>Сторона {hoverLen.toFixed(2)} м</span>}
        {selectedZone && <span>{surfaceOf(selectedZone.kind).label}: {zoneArea.toFixed(1)} м² · периметр {zonePerim.toFixed(1)} м</span>}
        {tool === 'zone' && draft.length === 0 && <span>Полигон: кликайте по контуру. С третьей точки на конце линии нажмите OK.</span>}
        {tool === 'rect' && <span>Прямоугольник: тяните от угла. Shift — квадрат.</span>}
        {tool === 'circle' && diameterM.trim() && <span>Круг: клик ставит окружность этого диаметра, от 0,4 до 80 м.</span>}
        {tool === 'circle' && !diameterM.trim() && <span>Круг: тяните от центра. Диаметр слева ставит круг одним кликом.</span>}
        {tool === 'dim' && <span>Размер: два клика. Shift и кнопка ⊥ держат линию прямой. Концы можно перетащить.</span>}
        {anchorPick && <span>Якорь: кликните точку. Поворот, отражение и масштаб пойдут вокруг неё. Esc — отмена.</span>}
        {tool === 'brush' && <span>Кисть: круг, квадрат или треугольник. Рисуйте зажатой кнопкой. Esc — отмена.</span>}
        {boolPick === 'union' && <span>Объединение: кликните второй контур. Он впитается в выбранный.</span>}
        {boolPick === 'diff' && <span>Вычитание: кликните контур, который вырезать. Он останется на месте.</span>}
        {boolPick === 'intersect' && <span>Пересечение: кликните второй контур. Останется только общая часть.</span>}
        {boolPick === 'xor' && <span>Исключение: кликните второй контур. Общая часть исчезнет.</span>}
        {lineOp === 'slice' && <span>Разрезать: два клика через контур. Shift и кнопка ⊥ держат линию прямой. Esc — отмена.</span>}
        {lineOp === 'mirror' && <span>Зеркало: два клика по оси. Появится отражённая копия.</span>}
        {alignPick && <span>Выравнивание: кликните контур-образец. Клик по пустому месту сажает эту сторону на якорь. Esc — отмена.</span>}
        {tool === 'text' && !lineOp && <span>Текст: клик ставит подпись. Потом её можно перетащить и переписать.</span>}
        {tool === 'pipe' && pipeRole === 'main' && <span>Магистраль: кликайте от источника к клапанам. Линия жирная. Со второй точки нажмите OK.</span>}
        {tool === 'pipe' && pipeRole === 'zone' && <span>Зональная: начните с ромба клапана. Подходящие дождеватели подсвечены. Со второй точки нажмите OK.</span>}
        {draft.length === 0 && selection?.id && <span>Enter ставит ещё одну копию.</span>}
        {zoneDraft && liveFlow > 0 && <span>На линии {Math.round(liveFlow)} л/ч{draftWarn ? ', выше лимита' : ''}</span>}
        {tool === 'box' && <span>Клапанный бокс: клик ставит коробку. Следующий клапан рядом садится в свободный слот.</span>}
        {tool === 'hydrant' && <span>Гидрант: клик ставит точку. На узле трубы он попадает в спецификацию.</span>}
        {tool === 'sleeve' && <span>Гильза: два клика. Shift и кнопка ⊥ держат линию прямой. Длина попадёт в спецификацию.</span>}
        {tool === 'tree' && !lineOp && <span>Дерево: выберите крону слева и кликните на чертёж. Радиус задаётся у выбранного дерева.</span>}
        {tool === 'bush' && !lineOp && <span>Куст: выберите форму слева и кликните на чертёж. Капельницы расчёта встанут к нему.</span>}
        {step === 'irrig' && !doc.source && <span>Поставьте источник воды, затем «Рассчитать схему».</span>}
        {step === 'layout' && <span>Скачайте PDF схемы и спецификации. Слои слева — что попадёт на лист.</span>}
      </footer>
    </main>
  )
}

function cleanTrench(trench: Doc['trench'], patch: Partial<Doc['trench']>): Doc['trench'] {
  const next = { ...trench, ...patch }
  if (!(next.widthM >= 0.1) || next.widthM > 1.2) next.widthM = trench.widthM
  if (!(next.depthM >= 0.15) || next.depthM > 1.5) next.depthM = trench.depthM
  return next
}

function cleanZone(zone: Zone, patch: Partial<Zone>): Zone {
  const next = { ...zone, ...patch }
  next.name = next.name.trim() || zone.name
  if (!(next.doseMm >= 0) || next.doseMm > 40) next.doseMm = zone.doseMm
  next.soil = asSoil(next.soil)
  next.slope = asSlope(next.slope)
  next.climate = asClimate(next.climate)
  return next
}

function cleanSource(source: Source, patch: Partial<Source>): Source {
  const next = { ...source, ...patch }
  if (patch.pressureBar !== undefined && (!(next.pressureBar >= 0.2) || next.pressureBar > 16)) next.pressureBar = source.pressureBar
  const limit = next.flowLimitLph
  if (patch.flowLimitLph !== undefined && limit !== null && (!(limit > 0) || limit > 1_000_000)) {
    next.flowLimitLph = source.flowLimitLph
  }
  return next
}

function withSourcePoint(doc: Doc, point: Point): Doc {
  return {
    ...doc,
    source: {
      x: point.x,
      y: point.y,
      pressureBar: doc.source?.pressureBar ?? 3,
      flowLimitLph: doc.source?.flowLimitLph ?? null,
    },
  }
}

function cleanDrip(item: Drip, patch: Partial<Drip>): Drip {
  const next = { ...item, ...patch }
  if (!(next.spacingM >= 0.05) || next.spacingM > 2) next.spacingM = item.spacingM
  if (!(next.emitterLph >= 0.2) || next.emitterLph > 40) next.emitterLph = item.emitterLph
  return next
}

function selectionFromHit(hit: Hit): Sel {
  if (hit.kind === 'source') return { kind: 'source' }
  if (hit.kind === 'zone-point' || hit.kind === 'zone-mid' || hit.kind === 'zone-edge' || hit.kind === 'zone') return { kind: 'zone', id: hit.id }
  if (hit.kind === 'pipe' || hit.kind === 'pipe-point') return { kind: 'pipe', id: hit.id }
  if (hit.kind === 'drip' || hit.kind === 'drip-point') return { kind: 'drip', id: hit.id }
  if (hit.kind === 'sprinkler' || hit.kind === 'sprinkler-rot' || hit.kind === 'sprinkler-arc') return { kind: 'sprinkler', id: hit.id }
  if (hit.kind === 'valve') return { kind: 'valve', id: hit.id }
  if (hit.kind === 'box') return { kind: 'box', id: hit.id }
  if (hit.kind === 'hydrant') return { kind: 'hydrant', id: hit.id }
  if (hit.kind === 'sleeve' || hit.kind === 'sleeve-point') return { kind: 'sleeve', id: hit.id }
  if (hit.kind === 'note') return { kind: 'note', id: hit.id }
  if (hit.kind === 'plant' || hit.kind === 'plant-size') return { kind: 'plant', id: hit.id }
  if (hit.kind === 'fixture' || hit.kind === 'fixture-size') return { kind: 'fixture', id: hit.id }
  if (hit.kind === 'dim' || hit.kind === 'dim-point') return { kind: 'dim', id: hit.id }
  return null
}

function aimSprinklerHit(doc: Doc, hit: Hit, point: Point, step: number | null): Doc {
  if (hit.kind !== 'sprinkler-rot' && hit.kind !== 'sprinkler-arc') return doc
  const mode = hit.kind === 'sprinkler-rot' ? 'rot' : hit.index === 0 ? 'start' : 'end'
  return {
    ...doc,
    sprinklers: doc.sprinklers.map((item) => {
      if (item.id !== hit.id) return item
      return { ...item, ...aimSprinkler(item, item.rotationDeg, item.arcDeg, point, mode, step) }
    }),
  }
}

function cleanSprinkler(item: Sprinkler, patch: Partial<Sprinkler>): Sprinkler {
  const next = { ...item, ...patch }
  if (!(next.radiusM > 0) || next.radiusM > 40) next.radiusM = item.radiusM
  if (!(next.arcDeg > 0) || next.arcDeg > 360) next.arcDeg = item.arcDeg
  if (!(next.flowLph >= 0) || next.flowLph > 20_000) next.flowLph = item.flowLph
  if (!Number.isFinite(next.rotationDeg)) next.rotationDeg = item.rotationDeg
  if (next.riseCm !== 15 && next.riseCm !== 30) delete next.riseCm
  return next
}

function snapDrag(doc: Doc, hit: Hit): Doc {
  const points = doc.pipes.flatMap((pipe) => pipe.points)
  if (points.length === 0) return doc
  if (hit.kind === 'sprinkler') {
    return {
      ...doc,
      sprinklers: doc.sprinklers.map((item) => {
        if (item.id !== hit.id) return item
        const next = snapTo({ x: item.x, y: item.y }, points, SNAP_PX)
        return { ...item, x: next.x, y: next.y }
      }),
    }
  }
  if (hit.kind === 'source' && doc.source) return withSourcePoint(doc, snapTo(doc.source, points, SNAP_PX))
  if (hit.kind === 'valve') {
    return {
      ...doc,
      valves: doc.valves.map((item) => {
        if (item.id !== hit.id) return item
        const next: Valve = { ...item, ...snapTo(item, points, SNAP_PX) }
        if (next.boxId) {
          const home = (doc.boxes ?? []).find((entry) => entry.id === next.boxId)
          if (!home || dist(next, home) > 28) delete next.boxId
        }
        return next
      }),
    }
  }
  if (hit.kind === 'hydrant') {
    return {
      ...doc,
      hydrants: (doc.hydrants ?? []).map((item) => (item.id === hit.id ? { ...item, ...snapTo(item, points, SNAP_PX) } : item)),
    }
  }
  if (hit.kind === 'box') {
    const box = (doc.boxes ?? []).find((item) => item.id === hit.id)
    if (!box) return doc
    const next = snapTo(box, points, SNAP_PX)
    const dx = next.x - box.x
    const dy = next.y - box.y
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return doc
    return {
      ...doc,
      boxes: (doc.boxes ?? []).map((item) => (item.id === hit.id ? { ...item, x: next.x, y: next.y } : item)),
      valves: doc.valves.map((item) => (item.boxId === hit.id ? { ...item, x: item.x + dx, y: item.y + dy } : item)),
    }
  }
  return doc
}

function markPoint(doc: Doc, hit: Hit): Point | null {
  if (hit.kind === 'plant-size') {
    const item = (doc.plants ?? []).find((entry) => entry.id === hit.id)
    return item ? { x: item.x, y: item.y } : null
  }
  if (hit.kind === 'fixture-size') {
    const item = (doc.fixtures ?? []).find((entry) => entry.id === hit.id)
    return item ? { x: item.x, y: item.y } : null
  }
  return null
}

function resizeMark(doc: Doc, hit: Hit, point: Point, ppm: number, shift: boolean): Doc {
  if (hit.kind === 'plant-size') {
    return {
      ...doc,
      plants: (doc.plants ?? []).map((item) => (
        item.id === hit.id ? { ...item, radiusM: sizedRadius(dist(item, point) / ppm, 0.2, 8, shift) } : item
      )),
    }
  }
  if (hit.kind === 'fixture-size') {
    return {
      ...doc,
      fixtures: (doc.fixtures ?? []).map((item) => (
        item.id === hit.id ? { ...item, radiusM: sizedRadius(dist(item, point) / ppm, 0.1, 20, shift) } : item
      )),
    }
  }
  return doc
}

function sizedRadius(raw: number, min: number, max: number, shift: boolean): number {
  const clamped = Math.min(max, Math.max(min, raw))
  const places = shift ? 10 : 100
  return Math.round(clamped * places) / places
}

function moveHit(doc: Doc, hit: Hit, point: Point): Doc {
  if (hit.kind === 'sprinkler') {
    return { ...doc, sprinklers: doc.sprinklers.map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'source') return withSourcePoint(doc, point)
  if (hit.kind === 'valve') {
    return {
      ...doc,
      valves: doc.valves.map((item) => {
        if (item.id !== hit.id) return item
        const next: Valve = { ...item, x: point.x, y: point.y }
        if (next.boxId) {
          const home = (doc.boxes ?? []).find((entry) => entry.id === next.boxId)
          if (!home || dist(point, home) > 28) delete next.boxId
        }
        return next
      }),
    }
  }
  if (hit.kind === 'box') {
    const box = (doc.boxes ?? []).find((item) => item.id === hit.id)
    if (!box) return doc
    const dx = point.x - box.x
    const dy = point.y - box.y
    return {
      ...doc,
      boxes: (doc.boxes ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)),
      valves: doc.valves.map((item) => (item.boxId === hit.id ? { ...item, x: item.x + dx, y: item.y + dy } : item)),
    }
  }
  if (hit.kind === 'hydrant') {
    return { ...doc, hydrants: (doc.hydrants ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'sleeve-point') {
    return {
      ...doc,
      sleeves: (doc.sleeves ?? []).map((item) => {
        if (item.id !== hit.id) return item
        return hit.index === 0 ? { ...item, a: point } : { ...item, b: point }
      }),
    }
  }
  if (hit.kind === 'note') {
    return { ...doc, notes: (doc.notes ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'plant') {
    return { ...doc, plants: (doc.plants ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'fixture') {
    return { ...doc, fixtures: (doc.fixtures ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'dim-point') {
    return {
      ...doc,
      measures: (doc.measures ?? []).map((item) => {
        if (item.id !== hit.id) return item
        return hit.index === 0 ? { ...item, a: point } : { ...item, b: point }
      }),
    }
  }
  if (hit.kind === 'drip-point') {
    return {
      ...doc,
      drips: doc.drips.map((drip) => drip.id === hit.id ? { ...drip, points: drip.points.map((item, index) => (index === hit.index ? point : item)) } : drip),
    }
  }
  if (hit.kind === 'zone-point') {
    return {
      ...doc,
      zones: doc.zones.map((zone) => zone.id === hit.id ? { ...zone, points: zone.points.map((item, index) => (index === hit.index ? point : item)) } : zone),
    }
  }
  if (hit.kind === 'zone-mid') {
    return {
      ...doc,
      zones: doc.zones.map((zone) => {
        if (zone.id !== hit.id) return zone
        const a = zone.points[hit.index]
        const b = zone.points[(hit.index + 1) % zone.points.length]
        const straight = midpoint(a, b)
        const bends = zone.bends ? [...zone.bends] : zone.points.map(() => null)
        while (bends.length < zone.points.length) bends.push(null)
        bends[hit.index] = dist(point, straight) < 4 ? null : controlFromHandle(a, b, point)
        return { ...zone, bends }
      }),
    }
  }
  if (hit.kind === 'pipe-point') {
    return {
      ...doc,
      pipes: doc.pipes.map((pipe) => pipe.id === hit.id ? { ...pipe, points: pipe.points.map((item, index) => (index === hit.index ? point : item)) } : pipe),
    }
  }
  return doc
}

function paintZone(zone: Zone, kind: ZoneKind): Zone {
  const surface = surfaceOf(kind)
  const next: Zone = { ...zone, kind, name: surface.label, doseMm: defaultDose(kind) }
  if (!(next.hatch && HATCHES.some((item) => item.id === next.hatch && item.kind === kind))) delete next.hatch
  return next
}

function styleZone(zone: Zone, patch: { stroke?: string | null; opacity?: number | null; pen?: number | null }): Zone {
  const next: Zone = { ...zone }
  if ('stroke' in patch) {
    if (patch.stroke) next.stroke = patch.stroke
    else delete next.stroke
  }
  if ('opacity' in patch) {
    if (patch.opacity !== undefined && patch.opacity !== null && patch.opacity < 0.99) next.opacity = patch.opacity
    else delete next.opacity
  }
  if ('pen' in patch) {
    if (patch.pen) next.pen = patch.pen
    else delete next.pen
  }
  return next
}

function styleNote(note: Note, patch: { color?: string | null; bold?: boolean | null }): Note {
  const next: Note = { ...note }
  if ('color' in patch) {
    if (patch.color) next.color = patch.color
    else delete next.color
  }
  if ('bold' in patch) {
    if (patch.bold) next.bold = true
    else delete next.bold
  }
  return next
}

function withHatch(zone: Zone, hatch: HatchId): Zone {
  const next: Zone = { ...zone }
  if (hatch === surfaceOf(zone.kind).pattern) delete next.hatch
  else next.hatch = hatch
  return next
}

const pen = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function isShapeTool(tool: Tool): boolean {
  return tool === 'zone' || tool === 'rect' || tool === 'circle' || tool === 'brush'
}

function favKey(item: Fav): string {
  return `${item.kind}:${item.form}`
}

function favLabel(item: Fav): string {
  if (item.kind === 'fixture') return fixtureSpec(item.form).label
  return formsFor(item.kind).find((form) => form.id === item.form)?.label ?? item.form
}

function withSpin(item: Fixture, turn: number): Fixture {
  const norm = ((turn % 360) + 360) % 360
  const next: Fixture = { ...item }
  if (norm === 0) delete next.rotationDeg
  else next.rotationDeg = norm
  return next
}

function RailButton({ active, label, onClick, sink, children }: { active: boolean; label: string; onClick: () => void; sink?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`${active ? 'rail-btn active' : 'rail-btn'}${sink ? ' rail-shape' : ''}`} title={label} aria-label={label} onClick={onClick}>
      <span className="rail-ico">{children}</span>
      <span className="rail-cap">{label}</span>
    </button>
  )
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg className="rail-svg" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

function PlantRailIcon({ form }: { form: PlantForm }) {
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  return (
    <svg className="rail-svg" viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true">
      {glyph.fills.slice(0, 8).map((d, index) => {
        const edged = index < (glyph.inked ?? glyph.fills.length)
        return <path key={index} d={d} fill={crownFill(paint, glyph.shade?.[index] ?? 0)} stroke={edged ? paint.ink : 'none'} strokeWidth={edged ? 0.04 : 0} />
      })}
      {glyph.veins.slice(0, 6).map((d, index) => (
        <path key={`v${index}`} d={d} fill="none" stroke={paint.vein} strokeWidth={0.035} />
      ))}
    </svg>
  )
}

function PlantPicker({ kind, active, labeled, onPick }: { kind: PlantKind; active: PlantForm; labeled?: boolean; onPick: (kind: PlantKind, form: PlantForm) => void }) {
  return (
    <div className="plant-grid">
      {formsFor(kind).map((item) => (
        <button
          key={item.id}
          type="button"
          className={active === item.id ? 'plant-pick active' : 'plant-pick'}
          title={item.label}
          aria-label={item.label}
          onClick={() => onPick(kind, item.id)}
        >
          <PlantThumb form={item.id} />
          {labeled && <span className="plant-name">{item.label}</span>}
        </button>
      ))}
    </div>
  )
}

function FixturePicker({ kinds, active, onPick }: { kinds: FixtureKind[]; active: FixtureKind; onPick: (kind: FixtureKind) => void }) {
  return (
    <div className="plant-grid">
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          className={active === kind ? 'plant-pick active' : 'plant-pick'}
          title={fixtureSpec(kind).label}
          aria-label={fixtureSpec(kind).label}
          onClick={() => onPick(kind)}
        >
          <FixtureThumb kind={kind} />
          <span className="plant-name">{fixtureSpec(kind).label}</span>
        </button>
      ))}
    </div>
  )
}

function FixtureThumb({ kind }: { kind: FixtureKind }) {
  const glyph = fixtureGlyph(kind)
  return (
    <svg viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true">
      {glyph.parts.map((part, index) => (
        <path key={index} d={part.d} fill={part.fill} stroke={part.stroke} strokeWidth={0.04} />
      ))}
      {glyph.lines.map((line, index) => (
        <path key={`l${index}`} d={line.d} fill="none" stroke={line.stroke} strokeWidth={0.035} strokeLinecap="round" />
      ))}
    </svg>
  )
}

function PlantThumb({ form }: { form: PlantForm }) {
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  return (
    <svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true">
      {glyph.fills.map((d, index) => {
        const edged = index < (glyph.inked ?? glyph.fills.length)
        return <path key={index} d={d} fill={crownFill(paint, glyph.shade?.[index] ?? 0)} stroke={edged ? paint.ink : 'none'} strokeWidth={edged ? 0.04 : 0} />
      })}
      {glyph.veins.map((d, index) => (
        <path key={`v${index}`} d={d} fill="none" stroke={paint.vein} strokeWidth={0.04} />
      ))}
      {glyph.dots.map((dot, index) => (
        <circle key={`d${index}`} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.bloom ? paint.accent : paint.trunk} />
      ))}
    </svg>
  )
}

function mapZone(zone: Zone, fn: (point: Point) => Point): Zone {
  const holes = zone.holes?.map((hole) => hole.map(fn)).filter((hole) => hole.length >= 3)
  return {
    ...zone,
    points: zone.points.map(fn),
    bends: zone.bends?.map((bend) => (bend ? fn(bend) : null)),
    ...(holes && holes.length ? { holes } : {}),
  }
}

function shapeZone(zone: Zone, points: Point[], holes?: Point[][]): Zone {
  const next: Zone = { ...zone, points }
  delete next.bends
  if (holes && holes.length) next.holes = holes
  else delete next.holes
  return next
}

const HEAD_COPY: Record<NozzleKind, { title: string; hint: string }> = {
  fan: { title: 'Форсунка', hint: 'Фиксированный сектор, регулируемое сопло или полоса вдоль края.' },
  rotator: { title: 'Ротатор', hint: 'Сектор крутится на сопле. Есть угол 45–105° и полосы.' },
  rotor: { title: 'Ротор', hint: 'Номер сопла — обычный номер при 3 бар. Сектор крутится на корпусе.' },
  bubbler: { title: 'Баблер', hint: 'Заливает лунку у куста или дерева. Радиус потом меняется в свойствах.' },
}

const SHELVES: { id: NozzlePattern; label: string }[] = [
  { id: 'fixed', label: 'Фикс.' },
  { id: 'adjust', label: 'Регул.' },
  { id: 'corner', label: 'Угол' },
  { id: 'strip', label: 'Полоса' },
  { id: 'low', label: 'Низкий' },
]

function NozzleFly({
  kind,
  nozzleId,
  riseCm,
  onPick,
  onRise,
}: {
  kind: NozzleKind
  nozzleId: string
  riseCm: 10 | 15 | 30
  onPick: (id: string) => void
  onRise: (rise: 10 | 15 | 30) => void
}) {
  const list = nozzlesOf(kind)
  const copy = HEAD_COPY[kind]
  const current = list.find((item) => item.id === nozzleId) ?? list[0]
  const shelf = current.pattern ?? 'fixed'
  const modes = SHELVES.filter((mode) => list.some((item) => (item.pattern ?? 'fixed') === mode.id))
  const pool = list.filter((item) => (item.pattern ?? 'fixed') === shelf)
  const radii = uniqueRadii(pool)
  const arcs = pool.filter((item) => item.radiusM === current.radiusM).sort((a, b) => a.arcDeg - b.arcDeg)

  function chooseShelf(next: NozzlePattern) {
    if (next === shelf) return
    const nextPool = list.filter((item) => (item.pattern ?? 'fixed') === next)
    onPick(matchNozzle(nextPool, current.radiusM, current.arcDeg).id)
  }

  function chooseRadius(radius: number) {
    onPick(matchNozzle(pool.filter((item) => item.radiusM === radius), radius, current.arcDeg).id)
  }

  function chooseArc(arc: number) {
    const hit = pool.find((item) => item.radiusM === current.radiusM && item.arcDeg === arc)
    if (hit) onPick(hit.id)
  }

  return (
    <>
      <p className="tool-label">{copy.title}</p>
      <p className="pick-now">{placeName(current, riseCm)}</p>
      <p className="hint">{copy.hint}</p>
      {kind !== 'bubbler' && (
        <>
          <p className="tool-label">Высота корпуса</p>
          <div className="nozzle-grid">
            {([10, 15, 30] as const).map((cm) => (
              <button key={cm} type="button" className={riseCm === cm ? 'tool active' : 'tool'} onClick={() => onRise(cm)}>{cm} см</button>
            ))}
          </div>
        </>
      )}
      {kind === 'bubbler' ? (
        <>
          <p className="tool-label">Расход</p>
          <ChipRow items={list} nozzleId={current.id} onPick={onPick} />
        </>
      ) : (
        <>
          {modes.length > 1 && (
            <div className="nozzle-grid modes">
              {modes.map((mode) => (
                <button key={mode.id} type="button" className={shelf === mode.id ? 'tool active' : 'tool'} onClick={() => chooseShelf(mode.id)}>
                  {mode.label}
                </button>
              ))}
            </div>
          )}
          {shelf === 'strip' ? (
            <ChipRow items={pool} nozzleId={current.id} onPick={onPick} />
          ) : shelf === 'corner' ? (
            <p className="hint">Сектор от 45° до 105°.</p>
          ) : (
            <>
              <div className="nozzle-grid">
                {radii.map((radius) => (
                  <button key={radius} type="button" className={current.radiusM === radius ? 'tool active' : 'tool'} onClick={() => chooseRadius(radius)}>
                    {metres(radius)} м
                  </button>
                ))}
              </div>
              {arcs.length > 1 && (
                <div className="nozzle-grid arcs">
                  {arcs.map((item) => (
                    <button key={item.id} type="button" className={current.arcDeg === item.arcDeg ? 'tool active' : 'tool'} onClick={() => chooseArc(item.arcDeg)}>
                      {item.arcDeg}°
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

function matchNozzle(pool: Nozzle[], radius: number, arc: number): Nozzle {
  return pool.find((item) => item.radiusM === radius && item.arcDeg === arc)
    ?? pool.find((item) => item.radiusM === radius && item.arcDeg === 180)
    ?? pool.find((item) => item.arcDeg === 180)
    ?? pool[0]
}

function uniqueRadii(items: Nozzle[]): number[] {
  const out: number[] = []
  for (const item of items) if (!out.includes(item.radiusM)) out.push(item.radiusM)
  return out
}

function placeName(nozzle: Nozzle, rise: 10 | 15 | 30): string {
  if (nozzle.kind === 'bubbler') return nozzle.name
  if (nozzle.kind !== 'rotor') return `${nozzle.name} · корпус ${rise} см`
  const mark = rotorMark(nozzle.radiusM, nozzle.pattern === 'low')
  const code = mark.code.replace('.', ',')
  const shelf = Number.isInteger(mark.radiusM) ? String(mark.radiusM) : String(mark.radiusM).replace('.', ',')
  const thrown = Math.abs(nozzle.radiusM - mark.radiusM) < 0.35 ? '' : `, вылет ${metres(nozzle.radiusM).replace('.', ',')} м`
  const low = nozzle.pattern === 'low' ? ', низкий угол' : ''
  return `Сопло №${code}${low}, ${shelf} м${thrown} · ${nozzle.arcDeg}° · корпус ${rise} см`
}

function ChipRow({ items, nozzleId, onPick }: { items: Nozzle[]; nozzleId: string; onPick: (id: string) => void }) {
  return (
    <div className="nozzle-grid">
      {items.map((item) => (
        <button key={item.id} type="button" className={nozzleId === item.id ? 'tool active' : 'tool'} onClick={() => onPick(item.id)}>
          {nozzleChip(item)}
        </button>
      ))}
    </div>
  )
}

function nozzleChip(item: Nozzle): string {
  if (item.kind === 'bubbler') {
    const litres = item.flowLph / 60
    const text = Number.isInteger(litres) ? String(litres) : litres.toFixed(1)
    return item.arcDeg >= 359 ? `${text} л` : `${text} л ${item.arcDeg}°`
  }
  if (item.pattern === 'strip') {
    if (item.strip === 'side') return 'бок'
    if (item.strip === 'end') return 'торец'
    if (item.strip === 'left') return 'лево'
    return 'право'
  }
  if (item.pattern === 'adjust') return `${metres(item.radiusM)} м`
  if (item.pattern === 'corner') return '45–105°'
  return item.arcDeg >= 359 ? '360°' : `${item.arcDeg}°`
}

function metres(radiusM: number): string {
  return Number.isInteger(radiusM) ? String(radiusM) : radiusM.toFixed(1)
}

function shiftZone(zone: Zone, dx: number, dy: number): Zone {
  return mapZone(zone, (point) => ({ x: point.x + dx, y: point.y + dy }))
}

function insertZoneVertex(doc: Doc, id: string, edge: number, point: Point): Doc {
  return {
    ...doc,
    zones: doc.zones.map((zone) => {
      if (zone.id !== id) return zone
      const a = zone.points[edge]
      const b = zone.points[(edge + 1) % zone.points.length]
      const hit = closestOnSegment(point, a, b).point
      const points = [...zone.points]
      points.splice(edge + 1, 0, hit)
      const bends = zone.bends ? [...zone.bends] : zone.points.map(() => null)
      while (bends.length < zone.points.length) bends.push(null)
      bends[edge] = null
      bends.splice(edge + 1, 0, null)
      return { ...zone, points, bends }
    }),
  }
}

function deleteZoneVertex(doc: Doc, id: string, index: number): Doc {
  return {
    ...doc,
    zones: doc.zones.map((zone) => {
      if (zone.id !== id || zone.points.length <= 3) return zone
      const points = zone.points.filter((_, i) => i !== index)
      const bends = (zone.bends ? [...zone.bends] : zone.points.map(() => null)).filter((_, i) => i !== index)
      return { ...zone, points, bends }
    }),
  }
}

function measure(url: string, setSize: (size: { w: number; h: number }) => void) {
  const image = new Image()
  image.onload = () => setSize({ w: image.naturalWidth, h: image.naturalHeight })
  image.src = url
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
}
