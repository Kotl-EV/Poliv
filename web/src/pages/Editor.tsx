import { useEffect, useMemo, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { analyze } from '@shared/analyze.ts'
import { asClimate, asSlope, asSoil, defaultDose, emptyDoc, SNAP_PX } from '@shared/doc.ts'
import { exampleDoc } from '@shared/example.ts'
import { dist } from '@shared/geom.ts'
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
type Step = 'sheet' | 'zones' | 'water' | 'spec'
type Sel = { kind: 'sprinkler' | 'zone' | 'pipe' | 'source' | 'valve' | 'drip'; id?: string } | null

const STEPS: { id: Step; label: string }[] = [
  { id: 'sheet', label: 'Подложка' },
  { id: 'zones', label: 'Зоны' },
  { id: 'water', label: 'Вода' },
  { id: 'spec', label: 'Спецификация' },
]

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Выбор' },
  { id: 'pan', label: 'Рука' },
  { id: 'scale', label: 'Масштаб' },
  { id: 'zone', label: 'Зона' },
  { id: 'sprinkler', label: 'Дождеватель' },
  { id: 'pipe', label: 'Труба' },
  { id: 'valve', label: 'Клапан' },
  { id: 'drip', label: 'Капля' },
  { id: 'source', label: 'Источник' },
]

const STEP_TOOLS: Record<Step, Tool[]> = {
  sheet: ['select', 'pan', 'scale'],
  zones: ['select', 'pan', 'zone'],
  water: ['select', 'pan', 'source', 'sprinkler', 'pipe', 'valve', 'drip'],
  spec: [],
}

const STEP_DEFAULT_TOOL: Record<Step, Tool> = {
  sheet: 'scale',
  zones: 'zone',
  water: 'source',
  spec: 'select',
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function snapTo(point: Point, targets: Point[]): Point {
  let best = point
  let bestDistance = SNAP_PX
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
  let w = image?.w ?? 1200
  let h = image?.h ?? 800
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
  const [step, setStep] = useState<Step>('sheet')
  const [tool, setTool] = useState<Tool>('select')
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
  const past = useRef<Doc[]>([])
  const ready = useRef(false)
  const drag = useRef<Hit | null>(null)
  const pan = useRef<{ x: number; y: number; view: View } | null>(null)
  docRef.current = doc

  const analysis = useMemo(() => analyze(doc), [doc])
  const board = contentSize(doc, imageSize)

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
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = view
      const nextK = Math.min(8, Math.max(0.08, current.k * (event.deltaY < 0 ? 1.1 : 0.9)))
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
        const previous = past.current.pop()
        if (previous) setDoc(previous)
        return
      }
      if (event.key === 'Escape') {
        setDraft([])
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
  }

  function commit(next: Doc) {
    remember()
    setDoc(next)
  }

  function finishDraft() {
    const current = docRef.current
    if (tool === 'zone' && draft.length >= 3) {
      const zone: Zone = {
        id: uid('zone'),
        name: zoneKind === 'bed' ? 'Клумба' : zoneKind === 'path' ? 'Дорожка' : 'Газон',
        kind: zoneKind,
        doseMm: defaultDose(zoneKind),
        soil: 'loam',
        slope: 'flat',
        climate: 'open',
        points: draft,
      }
      commit({ ...current, zones: [...current.zones, zone] })
      setSelection({ kind: 'zone', id: zone.id })
      setDraft([])
    }
    if (tool === 'pipe' && draft.length >= 2) {
      const pipe = { id: uid('pipe'), points: draft }
      commit({ ...current, pipes: [...current.pipes, pipe] })
      setSelection({ kind: 'pipe', id: pipe.id })
      setDraft([])
    }
    if (tool === 'drip' && draft.length >= 2) {
      const drip: Drip = { id: uid('drip'), points: draft, spacingM: 0.3, emitterLph: 2 }
      commit({ ...current, drips: [...current.drips, drip] })
      setSelection({ kind: 'drip', id: drip.id })
      setDraft([])
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

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || event.button === 1) {
      pan.current = { x: event.clientX, y: event.clientY, view }
      return
    }
    const raw = worldPoint(event, svgRef.current, view)
    const hit = tool === 'select' ? readHit(event.target) : { kind: 'board' as const }
    if (tool === 'select' && (hit.kind === 'sprinkler' || hit.kind === 'source' || hit.kind === 'valve' || hit.kind === 'zone-point' || hit.kind === 'pipe-point' || hit.kind === 'drip-point')) {
      remember()
      drag.current = hit
      setSelection(selectionFromHit(hit))
      return
    }
    if (tool === 'select') {
      if (hit.kind === 'zone' || hit.kind === 'pipe' || hit.kind === 'sprinkler' || hit.kind === 'valve' || hit.kind === 'drip') setSelection({ kind: hit.kind, id: hit.id })
      else if (hit.kind === 'source') setSelection({ kind: 'source' })
      else setSelection(null)
      return
    }
    const point = tool === 'scale' ? raw : snapTo(raw, [...targetsOf(doc), ...draft])
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
    if ((tool === 'zone' || tool === 'pipe' || tool === 'drip') && event.detail === 2) {
      finishDraft()
      return
    }
    if (tool === 'zone' && draft.length >= 3 && dist(raw, draft[0]) <= SNAP_PX) {
      finishDraft()
      return
    }
    if (tool === 'zone' || tool === 'pipe' || tool === 'drip') setDraft((current) => [...current, point])
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
    const point = worldPoint(event, svgRef.current, view)
    setHover(point)
    const active = drag.current
    if (!active) return
    setDoc((current) => moveHit(current, active, point))
  }

  function onPointerUp() {
    const active = drag.current
    drag.current = null
    pan.current = null
    if (!active) return
    setDoc((current) => snapDrag(current, active))
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
    setPlanNote('Подложка поставлена. Задайте масштаб по известному отрезку, затем обведите зоны полива.')
    setStatus('Сохранено')
    if (!docRef.current.pxPerMeter) setTool('scale')
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
    setDraft([])
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
    setDraft([])
    setScalePoints([])
    setTool(next === 'sheet' && docRef.current.pxPerMeter ? 'pan' : STEP_DEFAULT_TOOL[next])
  }

  function runLayout() {
    const current = docRef.current
    if (!current.pxPerMeter) {
      setError('Сначала задайте масштаб на подложке')
      return
    }
    if (!current.zones.some((zone) => zone.kind === 'lawn' || zone.kind === 'bed')) {
      setError('Обведите хотя бы одну зону полива — газон или клумбу')
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
    setPlanNote(`Дождевателей: ${next.sprinklers.length}. Клапанов: ${next.valves.length}. Капельных линий: ${next.drips.length}. Схему можно поправить вручную, спецификация справа во вкладке.`)
    setStatus('Сохранено')
    setTool('select')
  }

  if (!loaded) return <div className="boot">{error || 'Загрузка проекта…'}</div>

  const stepTools = step === 'water' && doc.sprinklers.length === 0 && doc.pipes.length === 0 && doc.drips.length === 0
    ? ['select' as const, 'pan' as const, 'source' as const]
    : STEP_TOOLS[step]

  return (
    <main className={step === 'spec' ? 'editor step-spec' : 'editor'}>
      <header className="top">
        <button className="mark link" onClick={() => go('/projects')}>Полив</button>
        <input className="name" value={name} onChange={(event) => setName(event.target.value)} aria-label="Название проекта" />
        <span className="status">{status}</span>
        <span className="who">{user.name}</span>
        <button className="ghost" onClick={logout}>Выйти</button>
      </header>
      <nav className="tools">
        {STEPS.map((item) => (
          <button key={item.id} className={step === item.id ? 'tool step active' : 'tool step'} onClick={() => openStep(item.id)}>
            {item.label}
          </button>
        ))}
        {stepTools.length > 0 && <div className="tool-gap" />}
        {TOOLS.filter((item) => stepTools.includes(item.id)).map((item) => (
          <button key={item.id} className={tool === item.id ? 'tool active' : 'tool'} onClick={() => { setTool(item.id); setDraft([]) }}>
            {item.label}
          </button>
        ))}
        {(step === 'water' || step === 'spec') && (
          <select
            value={doc.pipeSeries}
            aria-label="Ряд труб"
            onChange={(event) => setDoc((current) => ({ ...current, pipeSeries: event.target.value as PipeSeriesId }))}
          >
            {SERIES.map((series) => (
              <option key={series.id} value={series.id}>{series.name}</option>
            ))}
          </select>
        )}
        {step === 'water' && (
          <button className="primary" onClick={runLayout}>Рассчитать схему</button>
        )}
        {step === 'sheet' && (
          <button className="tool" onClick={() => openStep('zones')}>Дальше: зоны</button>
        )}
        {step === 'zones' && (
          <button className="tool" onClick={() => openStep('water')}>Дальше: вода</button>
        )}
        {tool === 'zone' && (
          <select value={zoneKind} onChange={(event) => setZoneKind(event.target.value as ZoneKind)} aria-label="Тип зоны">
            <option value="lawn">Газон</option>
            <option value="bed">Клумба</option>
            <option value="path">Дорожка</option>
          </select>
        )}
        {tool === 'sprinkler' && (
          <select value={nozzleId} onChange={(event) => setNozzleId(event.target.value)} aria-label="Форсунка">
            {NOZZLES.map((nozzle) => (
              <option key={nozzle.id} value={nozzle.id}>{nozzle.name}</option>
            ))}
          </select>
        )}
        {(tool === 'zone' || tool === 'pipe' || tool === 'drip') && draft.length >= (tool === 'zone' ? 3 : 2) && (
          <button className="tool" onClick={finishDraft}>{tool === 'zone' ? 'Замкнуть' : 'Готово'}</button>
        )}
        {step !== 'spec' && <button className="tool" onClick={fit}>Вписать</button>}
        {step !== 'spec' && <button className="tool" onClick={loadExample}>Пример</button>}
        {step === 'sheet' && <label className="tool file">
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
        </label>}
        {step === 'sheet' && backgroundUrl && <button className="tool" onClick={() => clearBackground().catch((err: Error) => setError(err.message))}>Убрать подложку</button>}
      </nav>
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
          hover={tool === 'zone' || tool === 'pipe' || tool === 'drip' ? hover : null}
          scalePoints={scalePoints}
          selectionId={selection?.id ?? null}
          selectionKind={selection?.kind ?? null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
      <div className="side">
        {error && <p className="error">{error}</p>}
        {tool === 'scale' && (
          <div className="props">
            <h2>Масштаб</h2>
            <p>{scalePoints.length < 2 ? 'Отметьте две точки известного отрезка.' : `На чертеже ${Math.round(scalePx)} px.`}</p>
            <label>
              Длина, м
              <input value={scaleMeters} onChange={(event) => setScaleMeters(event.target.value)} />
            </label>
            <button className="primary" onClick={applyScale} disabled={scalePoints.length < 2}>Применить</button>
            {doc.pxPerMeter && <p>Сейчас {doc.pxPerMeter.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} px = 1 м</p>}
          </div>
        )}
        {planNote && <p className="hint">{planNote}</p>}
        <p className="hint">{stepHint(step, doc, tool)}</p>
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
  if (hit.kind === 'zone-point') return { kind: 'zone', id: hit.id }
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

function stepHint(step: Step, doc: Doc, tool: Tool): string {
  if (step === 'sheet') {
    if (!doc.pxPerMeter) return 'Загрузите чертёж (JPEG, PNG или PDF) и задайте масштаб двумя точками известного отрезка. Схема с картинки сама не читается.'
    return 'Масштаб задан. Дальше обведите зоны, которые нужно поливать.'
  }
  if (step === 'zones') return tool === 'zone'
    ? 'Обведите газон, клумбу или дорожку по контуру. Замкните у первой точки, кнопкой или Enter. Дорожка не поливается.'
    : 'Обведите области полива. Газон — веера, клумба — капля. Дорожку можно обвести, чтобы по ней не ставились дождеватели.'
  if (step === 'water') {
    if (!doc.source) return 'Поставьте точку, откуда приходит вода. Затем нажмите «Рассчитать схему» — трубы, дождеватели и клапаны появятся сами.'
    return 'Источник стоит. «Рассчитать схему» расставит дождеватели, каплю, трубы и клапаны по вашим зонам.'
  }
  return 'Длины, диаметры, потери напора и осадки по зонам. Если схема не подошла — вернитесь на «Вода» и посчитайте снова или поправьте вручную.'
}

function snapDrag(doc: Doc, hit: Hit): Doc {
  const points = doc.pipes.flatMap((pipe) => pipe.points)
  if (points.length === 0) return doc
  if (hit.kind === 'sprinkler') {
    return {
      ...doc,
      sprinklers: doc.sprinklers.map((item) => {
        if (item.id !== hit.id) return item
        const next = snapTo({ x: item.x, y: item.y }, points)
        return { ...item, x: next.x, y: next.y }
      }),
    }
  }
  if (hit.kind === 'source' && doc.source) return withSourcePoint(doc, snapTo(doc.source, points))
  if (hit.kind === 'valve') {
    return {
      ...doc,
      valves: doc.valves.map((item) => (item.id === hit.id ? { ...item, ...snapTo(item, points) } : item)),
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
  if (hit.kind === 'pipe-point') {
    return {
      ...doc,
      pipes: doc.pipes.map((pipe) => pipe.id === hit.id ? { ...pipe, points: pipe.points.map((item, index) => (index === hit.index ? point : item)) } : pipe),
    }
  }
  return doc
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
