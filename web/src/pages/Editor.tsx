import { useEffect, useMemo, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { analyze } from '@shared/analyze.ts'
import { asClimate, asSlope, asSoil, defaultDose, emptyDoc, SNAP_PX } from '@shared/doc.ts'
import { exampleDoc } from '@shared/example.ts'
import {
  closestOnSegment,
  controlFromHandle,
  dist,
  midpoint,
  nearestScreen,
  orthoFrom,
  polygonAreaPx,
  ringLength,
  rotateAround,
  snapToGrid,
  withinScreen,
} from '@shared/geom.ts'
import { DEFAULT_PPM, DEFAULT_SHEET_M, gridStepM, isWetKind, SURFACES, surfaceOf } from '@shared/landscape.ts'
import { nozzleById, NOZZLES } from '@shared/nozzles.ts'
import { SERIES, type PipeSeriesId } from '@shared/pipes.ts'
import type { Doc, Drip, Point, Source, Sprinkler, Valve, Zone, ZoneKind } from '@shared/types.ts'
import { api, type User } from '../api'
import { layoutIrrigation } from '@shared/plan.ts'
import { Board, readHit, worldPoint, type Hit, type View } from '../editor/Board'
import { configurePdfWorker, renderPlanPdf } from '../pdf/readPlan'
import { Spec } from '../editor/Spec'

configurePdfWorker(workerUrl)

type Tool = 'select' | 'pan' | 'scale' | 'zone' | 'sprinkler' | 'pipe' | 'valve' | 'drip' | 'source'
type Step = 'draw' | 'irrig' | 'layout' | 'spec'
type Sel = { kind: 'sprinkler' | 'zone' | 'pipe' | 'source' | 'valve' | 'drip'; id?: string } | null

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
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
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
  return points
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
  const [selection, setSelection] = useState<Sel>(null)
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 1 })
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState('Загрузка…')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [planNote, setPlanNote] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const docRef = useRef(doc)
  const draftRef = useRef<Point[]>([])
  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const ready = useRef(false)
  const drag = useRef<Hit | null>(null)
  const pan = useRef<{ x: number; y: number; view: View } | null>(null)
  const click = useRef<{ hit: Hit; x: number; y: number; moved: boolean } | null>(null)
  const grab = useRef<Point | null>(null)
  const didFit = useRef(false)
  docRef.current = doc
  draftRef.current = draft

  const analysis = useMemo(() => analyze(doc), [doc])
  const board = contentSize(doc, imageSize)
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM

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
      if (event.key === 'Escape') {
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

  function nearDraftStart(point: Point): boolean {
    const points = draftRef.current
    if (points.length < 3) return false
    return withinScreen(points[0], point, view.k, 14)
  }

  function finishDraft() {
    const current = docRef.current
    const points = draftRef.current
    if (tool === 'zone' && points.length >= 3) {
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
      }
      commit({ ...current, zones: [...current.zones, zone] })
      setSelection({ kind: 'zone', id: zone.id })
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
  }

  function removeSelection() {
    const current = docRef.current
    if (!selection) return
    if (selection.kind === 'sprinkler') commit({ ...current, sprinklers: current.sprinklers.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'zone') commit({ ...current, zones: current.zones.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'pipe') commit({ ...current, pipes: current.pipes.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'valve') commit({ ...current, valves: current.valves.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'drip') commit({ ...current, drips: current.drips.filter((item) => item.id !== selection.id) })
    if (selection.kind === 'source') commit({ ...current, source: null })
    setSelection(null)
  }

  function worldSnap(raw: Point, shift = false): Point {
    const current = docRef.current
    const last = draftRef.current[draftRef.current.length - 1]
    const start = draftRef.current[0]
    let point = raw
    if (current.snapGrid !== false) {
      point = snapToGrid(point, gridStepM(view.k, ppm) * ppm)
    }
    if (shift && last) point = orthoFrom(last, point)
    if (tool === 'zone' && start && draftRef.current.length >= 3 && withinScreen(start, raw, view.k, 14)) {
      return start
    }
    const verts = [
      ...targetsOf(current),
      ...draftRef.current.slice(0, Math.max(0, draftRef.current.length - 1)),
    ]
    return nearestScreen(point, verts, view.k, 8) ?? point
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    if (event.button === 2) {
      event.preventDefault()
      if (tool === 'zone' || tool === 'pipe' || tool === 'drip') finishDraft()
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || event.button === 1) {
      pan.current = { x: event.clientX, y: event.clientY, view }
      return
    }
    const raw = worldPoint(event, svgRef.current, view)
    const hit = readHit(event.target)
    click.current = { hit, x: event.clientX, y: event.clientY, moved: false }

    if (tool === 'select') {
      if (hit.kind === 'zone-point' || hit.kind === 'zone-mid' || hit.kind === 'pipe-point' || hit.kind === 'drip-point' || hit.kind === 'sprinkler' || hit.kind === 'source' || hit.kind === 'valve') {
        remember()
        drag.current = hit
        setSelection(selectionFromHit(hit))
        return
      }
      if (hit.kind === 'zone') {
        remember()
        drag.current = hit
        grab.current = raw
        setSelection({ kind: 'zone', id: hit.id })
        return
      }
      if (hit.kind === 'zone-edge') {
        setSelection({ kind: 'zone', id: hit.id })
        return
      }
      if (hit.kind === 'pipe' || hit.kind === 'sprinkler' || hit.kind === 'valve' || hit.kind === 'drip') setSelection({ kind: hit.kind, id: hit.id })
      else if (hit.kind === 'source') setSelection({ kind: 'source' })
      else setSelection(null)
      return
    }

    const point = tool === 'scale' ? raw : worldSnap(raw, event.shiftKey)
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
    if (tool === 'scale') {
      setScalePoints((current) => (current.length >= 2 ? [point] : [...current, point]))
      return
    }
    if (tool === 'zone' || tool === 'pipe' || tool === 'drip') {
      if (event.detail >= 2) {
        finishDraft()
        return
      }
      if (hit.kind === 'draft-close' || (tool === 'zone' && nearDraftStart(raw))) {
        finishDraft()
        return
      }
      const last = draftRef.current[draftRef.current.length - 1]
      if (last && dist(point, last) * view.k < 4) return
      setHover(point)
      setDraftPoints([...draftRef.current, point])
    }
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    if (pan.current) {
      setView({
        ...pan.current.view,
        x: pan.current.view.x + event.clientX - pan.current.x,
        y: pan.current.view.y + event.clientY - pan.current.y,
      })
      return
    }
    const rawMove = worldPoint(event, svgRef.current, view)
    const drawing = tool === 'zone' || tool === 'pipe' || tool === 'drip'
    const point = drawing ? worldSnap(rawMove, event.shiftKey) : rawMove
    setHover(point)
    if (click.current && (Math.abs(event.clientX - click.current.x) > 3 || Math.abs(event.clientY - click.current.y) > 3)) {
      click.current.moved = true
    }
    const active = drag.current
    if (!active) return
    if ((active.kind === 'zone') && grab.current) {
      const dx = point.x - grab.current.x
      const dy = point.y - grab.current.y
      grab.current = point
      setDoc((current) => ({
        ...current,
        zones: current.zones.map((zone) => (zone.id === active.id ? shiftZone(zone, dx, dy) : zone)),
      }))
      return
    }
    const snapped = doc.snapGrid !== false ? worldSnap(point) : point
    setDoc((current) => moveHit(current, active, snapped))
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const active = drag.current
    const tap = click.current
    drag.current = null
    pan.current = null
    click.current = null
    grab.current = null
    if (active && tap?.moved) {
      setDoc((current) => snapDrag(current, active))
    }
    if (!tap || tap.moved || tool !== 'select') return
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
    setDraftPoints([])
    setScalePoints([])
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
      setError('Не удалось развести сеть. Проверьте масштаб и контуры зон.')
      setStatus('Сохранено')
      return
    }
    commit(next)
    setPlanNote(`Дождевателей: ${next.sprinklers.length}. Клапанов: ${next.valves.length}. Капельных линий: ${next.drips.length}.`)
    setStatus('Сохранено')
    setTool('select')
  }

  function rotateSelected(deg: number) {
    if (selection?.kind !== 'zone' || !selection.id) return
    const zone = doc.zones.find((item) => item.id === selection.id)
    if (!zone) return
    const origin = {
      x: zone.points.reduce((sum, point) => sum + point.x, 0) / zone.points.length,
      y: zone.points.reduce((sum, point) => sum + point.y, 0) / zone.points.length,
    }
    commit({
      ...doc,
      zones: doc.zones.map((item) => item.id === zone.id ? {
        ...item,
        points: item.points.map((point) => rotateAround(point, origin, deg)),
        bends: item.bends?.map((bend) => (bend ? rotateAround(bend, origin, deg) : null)),
      } : item),
    })
  }

  if (!loaded) return <div className="boot">{error || 'Загрузка проекта…'}</div>

  const selectedZone = selection?.kind === 'zone' ? doc.zones.find((item) => item.id === selection.id) : undefined
  const hoverLen = draft.length > 0 && hover ? dist(draft[draft.length - 1], hover) / ppm : 0
  const zoneArea = selectedZone ? polygonAreaPx(selectedZone.points) / (ppm * ppm) : 0
  const zonePerim = selectedZone ? ringLength(selectedZone.points, selectedZone.bends) / ppm : 0

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
        <button className={doc.snapGrid !== false ? 'icon on' : 'icon'} title="Привязка к сетке" onClick={() => setDoc((current) => ({ ...current, snapGrid: current.snapGrid === false }))}>▦</button>
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
            <button className={tool === 'select' ? 'tool active' : 'tool'} onClick={() => { setTool('select'); setDraftPoints([]) }}>Выбор</button>
            <button className={tool === 'pan' ? 'tool active' : 'tool'} onClick={() => setTool('pan')}>Рука</button>
            <button className={tool === 'zone' ? 'tool active' : 'tool'} onClick={() => { setTool('zone'); setDraftPoints([]) }}>Полигон</button>
            <div className="tool-gap" />
            <p className="tool-label">Поверхность</p>
            {SURFACES.map((surface) => (
              <button
                key={surface.id}
                className={zoneKind === surface.id ? 'swatch active' : 'swatch'}
                onClick={() => { setZoneKind(surface.id); setTool('zone') }}
              >
                <i className={`chip ${surface.pattern}`} />
                {surface.label}
              </button>
            ))}
            <div className="tool-gap" />
            <button className={tool === 'scale' ? 'tool active' : 'tool'} onClick={() => { setTool('scale'); setScalePoints([]) }}>Линейка</button>
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
            <button className={tool === 'select' ? 'tool active' : 'tool'} onClick={() => setTool('select')}>Выбор</button>
            <button className={tool === 'pan' ? 'tool active' : 'tool'} onClick={() => setTool('pan')}>Рука</button>
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
          <p className="hint">Листы печати: рамка, слои и экспорт. Пока смотрите чертёж здесь, печать следующим заходом.</p>
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
          hover={tool === 'zone' || tool === 'pipe' || tool === 'drip' || tool === 'scale' ? hover : null}
          scalePoints={scalePoints}
          selectionId={selection?.id ?? null}
          selectionKind={selection?.kind ?? null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(event) => {
            event.preventDefault()
            if (tool === 'zone' || tool === 'pipe' || tool === 'drip') finishDraft()
          }}
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
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
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
        {selectedZone && draft.length === 0 && (
          <div className="ops">
            {SURFACES.map((surface) => (
              <button
                key={surface.id}
                className={selectedZone.kind === surface.id ? 'swatch active' : 'swatch'}
                onClick={() => setDoc((current) => ({
                  ...current,
                  zones: current.zones.map((zone) => zone.id === selectedZone.id ? { ...zone, kind: surface.id, name: surface.label, doseMm: defaultDose(surface.id) } : zone),
                }))}
              >
                {surface.label}
              </button>
            ))}
            <button className="tool" onClick={() => rotateSelected(90)}>↻ 90°</button>
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
        {tool === 'zone' && draft.length === 0 && <span>Полигон: точки идут по сетке. С третьей точки на конце линии появляется OK.</span>}
        {step === 'irrig' && !doc.source && <span>Поставьте источник воды, затем «Рассчитать схему».</span>}
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
  if (hit.kind === 'pipe-point') return { kind: 'pipe', id: hit.id }
  if (hit.kind === 'drip-point') return { kind: 'drip', id: hit.id }
  if (hit.kind === 'sprinkler' || hit.kind === 'valve') return { kind: hit.kind, id: hit.id }
  return null
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

function shiftZone(zone: Zone, dx: number, dy: number): Zone {
  const move = (point: Point) => ({ x: point.x + dx, y: point.y + dy })
  return {
    ...zone,
    points: zone.points.map(move),
    bends: zone.bends?.map((bend) => (bend ? move(bend) : null)),
  }
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
