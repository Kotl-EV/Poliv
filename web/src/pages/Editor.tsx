import { useEffect, useMemo, useRef, useState } from 'react'
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
import { DEFAULT_PPM, DEFAULT_SHEET_M, gridStepM, hatchOf, hatchesFor, HATCHES, INKS, isDripKind, isSprayKind, isWetKind, SURFACES, surfaceOf } from '@shared/landscape.ts'
import { formOf, formsFor, plantGlyph, plantPaint } from '@shared/plants.ts'
import { DEFAULT_SHEET_LAYERS, PAPERS, type PaperId, type SheetLayers } from '@shared/sheet.ts'
import { nozzleById, NOZZLES } from '@shared/nozzles.ts'
import { SERIES, type PipeSeriesId } from '@shared/pipes.ts'
import type { Doc, Drip, HatchId, Note, Plant, PlantForm, PlantKind, Point, Source, Sprinkler, Valve, Zone, ZoneKind } from '@shared/types.ts'
import { api, type User } from '../api'
import { layoutIrrigation } from '@shared/plan.ts'
import { Board, readHit, worldPoint, type Hit, type View } from '../editor/Board'
import { exportProjectSheets } from '../pdf/exportSheet'
import { configurePdfWorker, renderPlanPdf } from '../pdf/readPlan'
import { Spec } from '../editor/Spec'

configurePdfWorker(workerUrl)

type Tool = 'select' | 'scale' | 'zone' | 'rect' | 'circle' | 'brush' | 'text' | 'tree' | 'bush' | 'dim' | 'sprinkler' | 'pipe' | 'valve' | 'drip' | 'source'
type Step = 'draw' | 'irrig' | 'layout' | 'spec'
type Sel = { kind: 'sprinkler' | 'zone' | 'pipe' | 'source' | 'valve' | 'drip' | 'note' | 'plant' | 'dim'; id?: string } | null
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
  const [brushM, setBrushM] = useState(0.8)
  const [brushTip, setBrushTip] = useState<BrushTip>('round')
  const [drawHatch, setDrawHatch] = useState<HatchId | null>(null)
  const [diameterM, setDiameterM] = useState('')
  const [treeForm, setTreeForm] = useState<PlantForm>('leaf')
  const [bushForm, setBushForm] = useState<PlantForm>('ball')
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
  const pan = useRef<{ x: number; y: number; view: View; button: number; hit: Hit; moved: boolean } | null>(null)
  const click = useRef<{ hit: Hit; x: number; y: number; moved: boolean } | null>(null)
  const grab = useRef<Point | null>(null)
  const shapeStart = useRef<Point | null>(null)
  const brushing = useRef(false)
  const clipboard = useRef<Zone | null>(null)
  const lineRef = useRef<Point[]>([])
  const dimRef = useRef<Point[]>([])
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
        shapeStart.current = null
        brushing.current = false
        setDraftPoints([])
        setScalePoints([])
        setSelection(null)
      }
      if (event.key === 'Enter') finishDraft()
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
        const pipe = { id: uid('pipe'), points }
        commit({ ...current, pipes: [...current.pipes, pipe] })
        setSelection({ kind: 'pipe', id: pipe.id })
        setDraftPoints([])
        return
      }
      if (tool === 'drip' && points.length >= 2) {
        const drip: Drip = { id: uid('drip'), points, spacingM: 0.3, emitterLph: 2 }
        commit({ ...current, drips: [...current.drips, drip] })
        setSelection({ kind: 'drip', id: drip.id })
        setDraftPoints([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось замкнуть контур')
    }
  }

  function removeSelection() {
    const current = docRef.current
    if (!selection) return
    if (selection.kind === 'sprinkler') commit({ ...current, sprinklers: current.sprinklers.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'zone') commit({ ...current, zones: current.zones.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'pipe') commit({ ...current, pipes: current.pipes.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'valve') commit({ ...current, valves: current.valves.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'drip') commit({ ...current, drips: current.drips.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'note') commit({ ...current, notes: (current.notes ?? []).filter((item) => item.id !== selection.id) })
    if (selection.kind === 'plant') commit({ ...current, plants: (current.plants ?? []).filter((item) => item.id !== selection.id) })
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
    if (hit.kind === 'sprinkler-rot' || hit.kind === 'sprinkler-arc' || hit.kind === 'draft-ok' || hit.kind === 'draft-close') return hit
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
    const placingDim = tool === 'dim' && hit.kind !== 'dim' && hit.kind !== 'dim-point'
    const editHit = !placingDim && (hit.kind === 'sprinkler-rot' || hit.kind === 'sprinkler-arc' || hit.kind === 'zone-point' || hit.kind === 'zone-mid' || hit.kind === 'pipe-point' || hit.kind === 'drip-point' || hit.kind === 'sprinkler' || hit.kind === 'source' || hit.kind === 'valve' || hit.kind === 'note' || hit.kind === 'plant' || hit.kind === 'dim' || hit.kind === 'dim-point')
    if (!drafting && editHit) {
      remember()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = hit
      if (hit.kind === 'dim') grab.current = raw
      click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
      setSelection(selectionFromHit(hit))
      return
    }
    if (!drafting && !placingDim && hit.kind === 'zone-edge') {
      click.current = { hit, x: event.clientX, y: event.clientY, moved: false }
      setSelection({ kind: 'zone', id: hit.id })
      return
    }
    if (!drafting && !placingDim && hit.kind === 'zone' && selection?.kind === 'zone' && selection.id === hit.id) {
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
      const valve: Valve = { id: uid('valve'), name: `Клапан ${doc.valves.length + 1}`, x: point.x, y: point.y }
      commit({ ...doc, valves: [...doc.valves, valve] })
      setSelection({ kind: 'valve', id: valve.id })
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
      }
      commit({ ...doc, sprinklers: [...doc.sprinklers, sprinkler] })
      setSelection({ kind: 'sprinkler', id: sprinkler.id })
      return
    }
    if (tool === 'text' || tool === 'tree' || tool === 'bush') {
      placeMark(tool, point)
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
      const last = draftRef.current[draftRef.current.length - 1]
      const canFinish = tool === 'zone' ? draftRef.current.length >= 3 : draftRef.current.length >= 2
      if (canFinish && last && dist(raw, last) * view.k <= 28) {
        finishDraft()
        return
      }
      if (last && dist(point, last) * view.k < 4) return
      setHover(point)
      setDraftPoints([...draftRef.current, point])
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
    const drawing = tool === 'zone' || tool === 'pipe' || tool === 'drip' || tool === 'rect' || tool === 'circle' || tool === 'brush' || tool === 'dim'
    let point = drawing ? worldSnap(rawMove, (tool === 'zone' || tool === 'pipe' || tool === 'drip') && lineLocked(event.shiftKey)) : rawMove
    if (lineOp && lineLocked(event.shiftKey) && lineRef.current.length === 1) point = orthoFrom(lineRef.current[0], rawMove)
    else if (lineOp) point = worldSnap(rawMove, false)
    else if (tool === 'dim' && lineLocked(event.shiftKey) && dimRef.current.length === 1) point = orthoFrom(dimRef.current[0], rawMove)
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
    if (active.kind === 'dim' && grab.current) {
      const dx = rawMove.x - grab.current.x
      const dy = rawMove.y - grab.current.y
      grab.current = rawMove
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
    const vertexDrag = active.kind === 'zone-point' || active.kind === 'dim-point'
    const snapped = vertexDrag
      ? worldSnap(rawMove, false, vertexAt(docRef.current, active))
      : (doc.snapGrid === true ? worldSnap(point) : point)
    setDoc((current) => moveHit(current, active, snapped))
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (pan.current) {
      const gesture = pan.current
      pan.current = null
      drag.current = null
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
      drag.current = null
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
      drag.current = null
      click.current = null
      grab.current = null
      return
    }
    const active = drag.current
    const tap = click.current
    drag.current = null
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
    setPlanNote(`Дождевателей: ${next.sprinklers.length}. Клапанов: ${next.valves.length}. Капельных линий: ${next.drips.length}.${plantNote}`)
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

  function pickForm(kind: PlantKind, form: PlantForm) {
    if (kind === 'tree') setTreeForm(form)
    else setBushForm(form)
    const current = docRef.current
    const id = selection?.kind === 'plant' ? selection.id : ''
    const plant = (current.plants ?? []).find((item) => item.id === id)
    if (!plant || plant.kind !== kind || formOf(plant) === form) return
    commit({
      ...current,
      plants: (current.plants ?? []).map((item) => (item.id === plant.id ? { ...item, form } : item)),
    })
  }

  function placeMark(kind: 'text' | 'tree' | 'bush', point: Point) {
    const current = docRef.current
    if (kind === 'text') {
      const note: Note = { id: uid('note'), x: point.x, y: point.y, text: 'Подпись', sizeM: 0.45 }
      commit({ ...current, notes: [...(current.notes ?? []), note] })
      setSelection({ kind: 'note', id: note.id })
      return
    }
    const plantKind = kind === 'tree' ? 'tree' : 'bush'
    const plant: Plant = {
      id: uid('plant'),
      kind: plantKind,
      x: point.x,
      y: point.y,
      radiusM: plantKind === 'tree' ? 1.6 : 0.7,
      form: plantKind === 'tree' ? treeForm : bushForm,
    }
    commit({ ...current, plants: [...(current.plants ?? []), plant] })
    setSelection({ kind: 'plant', id: plant.id })
  }

  function copySelected() {
    const zone = selectedZoneOf()
    if (zone) clipboard.current = structuredClone(zone)
  }

  function duplicateSelected() {
    const zone = selectedZoneOf()
    if (!zone) return
    const copy = shiftZone({ ...structuredClone(zone), id: uid('zone') }, 28, 28)
    commit({ ...docRef.current, zones: [...docRef.current.zones, copy] })
    setSelection({ kind: 'zone', id: copy.id })
  }

  function pasteClipboard() {
    const zone = clipboard.current
    if (!zone) return
    const copy = shiftZone({ ...structuredClone(zone), id: uid('zone') }, 28, 28)
    clipboard.current = copy
    commit({ ...docRef.current, zones: [...docRef.current.zones, copy] })
    setSelection({ kind: 'zone', id: copy.id })
  }

  if (!loaded) return <div className="boot">{error || 'Загрузка проекта…'}</div>

  const selectedZone = selection?.kind === 'zone' ? doc.zones.find((item) => item.id === selection.id) : undefined
  const selectedSprinkler = selection?.kind === 'sprinkler' ? doc.sprinklers.find((item) => item.id === selection.id) : undefined
  const selectedNote = selection?.kind === 'note' ? (doc.notes ?? []).find((item) => item.id === selection.id) : undefined
  const selectedPlant = selection?.kind === 'plant' ? (doc.plants ?? []).find((item) => item.id === selection.id) : undefined
  const selectedMeasure = selection?.kind === 'dim' ? (doc.measures ?? []).find((item) => item.id === selection.id) : undefined
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
            <button className={tool === 'zone' ? 'tool active' : 'tool'} onClick={() => { setTool('zone'); setDraftPoints([]) }}>Полигон</button>
            <button className={tool === 'rect' ? 'tool active' : 'tool'} onClick={() => { setTool('rect'); setDraftPoints([]) }}>Прямоугольник</button>
            <button className={tool === 'circle' ? 'tool active' : 'tool'} onClick={() => { setTool('circle'); setDraftPoints([]) }}>Круг</button>
            <button className={tool === 'brush' ? 'tool active' : 'tool'} onClick={() => { setTool('brush'); setDraftPoints([]) }}>Кисть</button>
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
                    <button
                      key={tip}
                      className={brushTip === tip ? 'tool active' : 'tool'}
                      onClick={() => setBrushTip(tip)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="brush-sizes">
                  {[0.4, 0.8, 1.6].map((width) => (
                    <button
                      key={width}
                      className={brushM === width ? 'tool active' : 'tool'}
                      onClick={() => setBrushM(width)}
                    >
                      {width} м
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="tool-gap" />
            <p className="tool-label">Поверхность</p>
            {SURFACES.map((surface) => (
              <button
                key={surface.id}
                className={zoneKind === surface.id ? 'swatch active' : 'swatch'}
                onClick={() => {
                  setZoneKind(surface.id)
                  setDrawHatch(null)
                  if (tool !== 'rect' && tool !== 'circle' && tool !== 'brush') setTool('zone')
                }}
              >
                <i className={`chip ${surface.pattern}`} />
                {surface.label}
              </button>
            ))}
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
            <div className="tool-gap" />
            <button className={tool === 'scale' ? 'tool active' : 'tool'} onClick={() => { setTool('scale'); setScalePoints([]); setLineOp(null) }}>Линейка</button>
            <button className={tool === 'dim' ? 'tool active' : 'tool'} onClick={() => { setTool('dim'); setLineOp(null); setLine([]); setDim([]); setAnchorPick(false) }}>Размер</button>
            <button className={anchorPick ? 'tool active' : 'tool'} onClick={armAnchor}>Якорь</button>
            {doc.anchor && <button className="tool" onClick={clearAnchor}>Убрать якорь</button>}
            <button className={tool === 'text' ? 'tool active' : 'tool'} onClick={() => { setTool('text'); setLineOp(null); setLine([]) }}>Текст</button>
            <button className={tool === 'tree' ? 'tool active' : 'tool'} onClick={() => { setTool('tree'); setLineOp(null); setLine([]) }}>Дерево</button>
            <button className={tool === 'bush' ? 'tool active' : 'tool'} onClick={() => { setTool('bush'); setLineOp(null); setLine([]) }}>Куст</button>
            {(tool === 'tree' || tool === 'bush') && (
              <PlantPicker kind={tool} active={tool === 'tree' ? treeForm : bushForm} onPick={pickForm} />
            )}
            <label className="tool file">
              Подложка
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onBackground(file).catch((err: Error) => setError(err.message))
                  event.target.value = ''
                }}
              />
            </label>
            {backgroundUrl && <button className="tool" onClick={() => clearBackground().catch((err: Error) => setError(err.message))}>Убрать подложку</button>}
            <button className="tool" onClick={loadExample}>Пример</button>
          </>
        )}
        {step === 'irrig' && (
          <>
            <button className={tool === 'source' ? 'tool active' : 'tool'} onClick={() => setTool('source')}>Источник</button>
            <button className={tool === 'sprinkler' ? 'tool active' : 'tool'} onClick={() => setTool('sprinkler')}>Дождеватель</button>
            <button className={tool === 'pipe' ? 'tool active' : 'tool'} onClick={() => { setTool('pipe'); setDraftPoints([]) }}>Труба</button>
            <button className={tool === 'valve' ? 'tool active' : 'tool'} onClick={() => setTool('valve')}>Клапан</button>
            <button className={tool === 'drip' ? 'tool active' : 'tool'} onClick={() => { setTool('drip'); setDraftPoints([]) }}>Капля</button>
            {tool === 'sprinkler' && (
              <select value={nozzleId} onChange={(event) => setNozzleId(event.target.value)} aria-label="Форсунка">
                {NOZZLES.map((nozzle) => (
                  <option key={nozzle.id} value={nozzle.id}>{nozzle.name}</option>
                ))}
              </select>
            )}
            <select
              value={doc.pipeSeries}
              aria-label="Ряд труб"
              onChange={(event) => setDoc((current) => ({ ...current, pipeSeries: event.target.value as PipeSeriesId }))}
            >
              {SERIES.map((series) => (
                <option key={series.id} value={series.id}>{series.name}</option>
              ))}
            </select>
            <button className="primary" onClick={runLayout}>Рассчитать схему</button>
          </>
        )}
        {step === 'layout' && (
          <>
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
          </>
        )}
        {step === 'spec' && (
          <p className="hint">Спецификация справа. Вернитесь в «Полив», если нужно пересчитать схему.</p>
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
          guide={linePts.length ? linePts : tool === 'dim' ? dimPts : []}
          snapMark={snapMark}
          showOk={(tool === 'zone' && draft.length >= 3) || ((tool === 'pipe' || tool === 'drip') && draft.length >= 2)}
          hover={tool === 'zone' || tool === 'pipe' || tool === 'drip' || tool === 'scale' || tool === 'rect' || tool === 'circle' || tool === 'brush' || tool === 'dim' ? hover : null}
          scalePoints={scalePoints}
          selectionId={selection?.id ?? null}
          selectionKind={selection?.kind ?? null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pan.current = null
            drag.current = null
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
            <button className="tool" onClick={removeSelection}>Удалить</button>
          </div>
        )}
        {selectedMeasure && draft.length === 0 && (
          <div className="ops">
            <span>Размер {(dist(selectedMeasure.a, selectedMeasure.b) / ppm).toFixed(2)} м</span>
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
  if (hit.kind === 'note') return { kind: 'note', id: hit.id }
  if (hit.kind === 'plant') return { kind: 'plant', id: hit.id }
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
      valves: doc.valves.map((item) => (item.id === hit.id ? { ...item, ...snapTo(item, points, SNAP_PX) } : item)),
    }
  }
  return doc
}

function moveHit(doc: Doc, hit: Hit, point: Point): Doc {
  if (hit.kind === 'sprinkler') {
    return { ...doc, sprinklers: doc.sprinklers.map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'source') return withSourcePoint(doc, point)
  if (hit.kind === 'valve') {
    return { ...doc, valves: doc.valves.map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'note') {
    return { ...doc, notes: (doc.notes ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
  }
  if (hit.kind === 'plant') {
    return { ...doc, plants: (doc.plants ?? []).map((item) => (item.id === hit.id ? { ...item, x: point.x, y: point.y } : item)) }
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

function PlantPicker({ kind, active, onPick }: { kind: PlantKind; active: PlantForm; onPick: (kind: PlantKind, form: PlantForm) => void }) {
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
        </button>
      ))}
    </div>
  )
}

function PlantThumb({ form }: { form: PlantForm }) {
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  return (
    <svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true">
      {glyph.fills.map((d, index) => (
        <path key={index} d={d} fill={paint.leaf} stroke={paint.ink} strokeWidth={0.06} />
      ))}
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
