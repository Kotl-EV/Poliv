import { forwardRef, type MouseEvent, type PointerEvent } from 'react'
import type { BrushTip } from '@shared/clip.ts'
import { emitterPoints } from '@shared/drip.ts'
import { fixtureGlyph } from '@shared/fixtures.ts'
import { formOf, plantGlyph, plantPaint } from '@shared/plants.ts'
import { centroid, dist, handleFromControl, midpoint, polar, sectorPath, zonePathD, zoneShapeD } from '@shared/geom.ts'
import { DEFAULT_PPM, gridStepM, hatchOf, honeycomb, surfaceOf } from '@shared/landscape.ts'
import type { Analysis, Doc, Fixture, Measure, Note, Plant, Point, Sprinkler, Zone, ZoneKind } from '@shared/types.ts'

export const CLOSE_SCREEN_PX = 14

export type View = { x: number; y: number; k: number }

export type Hit =
  | { kind: 'board' }
  | { kind: 'sprinkler'; id: string }
  | { kind: 'sprinkler-rot'; id: string }
  | { kind: 'sprinkler-arc'; id: string; index: number }
  | { kind: 'source' }
  | { kind: 'zone'; id: string }
  | { kind: 'zone-point'; id: string; index: number }
  | { kind: 'zone-mid'; id: string; index: number }
  | { kind: 'zone-edge'; id: string; index: number }
  | { kind: 'pipe'; id: string }
  | { kind: 'pipe-point'; id: string; index: number }
  | { kind: 'valve'; id: string }
  | { kind: 'drip'; id: string }
  | { kind: 'drip-point'; id: string; index: number }
  | { kind: 'note'; id: string }
  | { kind: 'plant'; id: string }
  | { kind: 'plant-size'; id: string }
  | { kind: 'fixture'; id: string }
  | { kind: 'fixture-size'; id: string }
  | { kind: 'dim'; id: string }
  | { kind: 'dim-point'; id: string; index: number }
  | { kind: 'draft-close' }
  | { kind: 'draft-ok' }

export function readHit(target: EventTarget | null): Hit {
  const node = target instanceof Node && target.nodeType === Node.TEXT_NODE ? target.parentElement : target
  const el = (node as Element | null)?.closest?.('[data-hit]')
  if (!el) return { kind: 'board' }
  const kind = el.getAttribute('data-hit')
  const id = el.getAttribute('data-id') || ''
  const index = Number(el.getAttribute('data-index'))
  if (kind === 'sprinkler') return { kind, id }
  if (kind === 'sprinkler-rot') return { kind, id }
  if (kind === 'sprinkler-arc' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'source') return { kind }
  if (kind === 'zone') return { kind, id }
  if (kind === 'pipe') return { kind, id }
  if (kind === 'valve') return { kind, id }
  if (kind === 'drip') return { kind, id }
  if (kind === 'draft-close') return { kind }
  if (kind === 'draft-ok') return { kind }
  if (kind === 'zone-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'zone-mid' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'zone-edge' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'pipe-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'drip-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'note') return { kind, id }
  if (kind === 'plant') return { kind, id }
  if (kind === 'plant-size') return { kind, id }
  if (kind === 'fixture') return { kind, id }
  if (kind === 'fixture-size') return { kind, id }
  if (kind === 'dim') return { kind, id }
  if (kind === 'dim-point' && Number.isInteger(index)) return { kind, id, index }
  return { kind: 'board' }
}

export function worldPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement, view: View): Point {
  const rect = svg.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left - view.x) / view.k,
    y: (event.clientY - rect.top - view.y) / view.k,
  }
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

export const Board = forwardRef<SVGSVGElement, {
  doc: Doc
  analysis: Analysis
  view: View
  board: { w: number; h: number }
  backgroundUrl: string | null
  imageSize: { w: number; h: number } | null
  draft: Point[]
  draftKind: ZoneKind
  sketch: 'poly' | 'rect' | 'circle' | 'brush'
  brushWidth: number
  brushTip: BrushTip
  guide: Point[]
  snapMark: Point | null
  showOk: boolean
  hover: Point | null
  scalePoints: Point[]
  selectionId: string | null
  selectionKind: string | null
  onPointerDown: (event: PointerEvent<SVGSVGElement>) => void
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
  onPointerUp: (event: PointerEvent<SVGSVGElement>) => void
  onPointerCancel?: (event: PointerEvent<SVGSVGElement>) => void
  onFinishDraft?: () => void
  onContextMenu?: (event: MouseEvent<SVGSVGElement>) => void
}>(function Board(props, ref) {
  const { doc, analysis, view, board, backgroundUrl, imageSize } = props
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  const gridOn = doc.gridOn !== false
  const selectedZone = props.selectionKind === 'zone' ? doc.zones.find((zone) => zone.id === props.selectionId) : undefined
  const selectedSprinkler = props.selectionKind === 'sprinkler' ? doc.sprinklers.find((item) => item.id === props.selectionId) : undefined

  return (
    <svg
      ref={ref}
      className="board"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onContextMenu={props.onContextMenu}
    >
      <defs>
        <SurfacePatterns ppm={ppm} />
      </defs>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <rect x={0} y={0} width={board.w} height={board.h} className="paper" />
        {gridOn && <MillimetreGrid width={board.w} height={board.h} ppm={ppm} k={view.k} />}
        {backgroundUrl && imageSize && (
          <image href={backgroundUrl} x={0} y={0} width={imageSize.w} height={imageSize.h} opacity={0.92} />
        )}
        {doc.zones.map((zone) => {
          const surface = surfaceOf(zone.kind)
          const selected = selectedZone?.id === zone.id
          return (
            <g key={zone.id}>
              <path
                data-hit="zone"
                data-id={zone.id}
                d={zoneShapeD(zone.points, zone.bends, zone.holes)}
                fillRule="evenodd"
                fill={`url(#fill-${hatchOf(zone)})`}
                stroke={zone.stroke || surface.stroke}
                strokeWidth={(zone.pen ?? (selected ? 2.4 : 1.4)) / view.k}
                opacity={zone.opacity}
              />
              {zone.points.map((point, index) => {
                const next = zone.points[(index + 1) % zone.points.length]
                return (
                  <line
                    key={`edge-${index}`}
                    data-hit="zone-edge"
                    data-id={zone.id}
                    data-index={index}
                    x1={point.x}
                    y1={point.y}
                    x2={next.x}
                    y2={next.y}
                    stroke="transparent"
                    strokeWidth={14 / view.k}
                  />
                )
              })}
            </g>
          )
        })}
        {(doc.fixtures ?? []).map((fixture) => (
          fixture.kind === 'scalebar' ? (
            <ScaleBar
              key={fixture.id}
              fixture={fixture}
              ppm={ppm}
              k={view.k}
              selected={props.selectionKind === 'fixture' && props.selectionId === fixture.id}
            />
          ) : (
            <FixtureMark
              key={fixture.id}
              fixture={fixture}
              ppm={ppm}
              k={view.k}
              selected={props.selectionKind === 'fixture' && props.selectionId === fixture.id}
            />
          )
        ))}
        {(doc.plants ?? []).map((plant) => (
          <PlantMark
            key={plant.id}
            plant={plant}
            ppm={ppm}
            k={view.k}
            selected={props.selectionKind === 'plant' && props.selectionId === plant.id}
          />
        ))}
        {(doc.notes ?? []).map((note) => (
          <NoteMark
            key={note.id}
            note={note}
            ppm={ppm}
            selected={props.selectionKind === 'note' && props.selectionId === note.id}
          />
        ))}
        {doc.sprinklers.map((sprinkler) => {
          const radius = ppm * sprinkler.radiusM
          const selected = selectedSprinkler?.id === sprinkler.id
          return (
            <path
              key={`${sprinkler.id}-cover`}
              d={sectorPath(sprinkler, radius, sprinkler.rotationDeg, sprinkler.arcDeg)}
              className={selected ? 'cover selected' : 'cover'}
              pointerEvents="none"
            />
          )
        })}
        {analysis.segments.map((segment, index) => (
          <line
            key={`${segment.pipeId}-${index}`}
            x1={segment.a.x}
            y1={segment.a.y}
            x2={segment.b.x}
            y2={segment.b.y}
            stroke={pipeColor(segment.odMm, segment.status)}
            strokeWidth={3 / view.k}
            strokeDasharray={segment.status === 'ok' ? undefined : `${8 / view.k} ${6 / view.k}`}
            pointerEvents="none"
          />
        ))}
        {doc.pipes.map((pipe) =>
          pipe.points.slice(0, -1).map((point, index) => (
            <line
              key={`${pipe.id}-hit-${index}`}
              data-hit="pipe"
              data-id={pipe.id}
              x1={point.x}
              y1={point.y}
              x2={pipe.points[index + 1].x}
              y2={pipe.points[index + 1].y}
              stroke="transparent"
              strokeWidth={16 / view.k}
            />
          )),
        )}
        <DraftLayer
          points={props.draft}
          hover={props.hover}
          kind={props.draftKind}
          view={view}
          ppm={ppm}
          sketch={props.sketch}
          brushWidth={props.brushWidth}
          brushTip={props.brushTip}
          showOk={props.showOk}
          onFinish={props.onFinishDraft}
        />
        {doc.drips.map((drip) => (
          <polyline
            key={`${drip.id}-line`}
            points={drip.points.map((point) => `${point.x},${point.y}`).join(' ')}
            className="drip"
            strokeWidth={2 / view.k}
            strokeDasharray={`${7 / view.k} ${5 / view.k}`}
            pointerEvents="none"
          />
        ))}
        {doc.drips.flatMap((drip) =>
          emitterPoints(drip.points, drip.spacingM, ppm).map((point, index) => (
            <circle
              key={`${drip.id}-em-${index}`}
              cx={point.x}
              cy={point.y}
              r={3.2 / view.k}
              className="emitter"
              strokeWidth={0.8 / view.k}
              pointerEvents="none"
            />
          )),
        )}
        {doc.drips.map((drip) =>
          drip.points.slice(0, -1).map((point, index) => (
            <line
              key={`${drip.id}-hit-${index}`}
              data-hit="drip"
              data-id={drip.id}
              x1={point.x}
              y1={point.y}
              x2={drip.points[index + 1].x}
              y2={drip.points[index + 1].y}
              className="drip-hit"
              strokeWidth={14 / view.k}
            />
          )),
        )}
        {doc.sprinklers.map((sprinkler) => (
          <g key={sprinkler.id}>
            <circle
              data-hit="sprinkler"
              data-id={sprinkler.id}
              cx={sprinkler.x}
              cy={sprinkler.y}
              r={16 / view.k}
              fill="transparent"
              stroke="none"
            />
            <circle
              data-hit="sprinkler"
              data-id={sprinkler.id}
              cx={sprinkler.x}
              cy={sprinkler.y}
              r={9 / view.k}
              className={props.selectionKind === 'sprinkler' && props.selectionId === sprinkler.id ? 'node selected' : 'node'}
            />
          </g>
        ))}
        {doc.valves.map((valve) => (
          <polygon
            key={valve.id}
            data-hit="valve"
            data-id={valve.id}
            points={diamond(valve, 8 / view.k)}
            className={props.selectionKind === 'valve' && props.selectionId === valve.id ? 'valve selected' : 'valve'}
          />
        ))}
        {doc.source && (
          <rect
            data-hit="source"
            x={doc.source.x - 7 / view.k}
            y={doc.source.y - 7 / view.k}
            width={14 / view.k}
            height={14 / view.k}
            className={props.selectionKind === 'source' ? 'source selected' : 'source'}
          />
        )}
        {selectedZone && (
          <ZoneHandles zone={selectedZone} view={view} ppm={ppm} />
        )}
        {props.selectionKind === 'drip' &&
          doc.drips
            .find((drip) => drip.id === props.selectionId)
            ?.points.map((point, index) => (
              <circle
                key={`d-${index}`}
                data-hit="drip-point"
                data-id={props.selectionId || ''}
                data-index={index}
                cx={point.x}
                cy={point.y}
                r={6 / view.k}
                className="handle"
              />
            ))}
        {props.selectionKind === 'pipe' &&
          doc.pipes
            .find((pipe) => pipe.id === props.selectionId)
            ?.points.map((point, index) => (
              <circle
                key={`p-${index}`}
                data-hit="pipe-point"
                data-id={props.selectionId || ''}
                data-index={index}
                cx={point.x}
                cy={point.y}
                r={6 / view.k}
                className="handle"
              />
            ))}
        {props.scalePoints.map((point, index) => (
          <circle key={`scale-${index}`} cx={point.x} cy={point.y} r={5 / view.k} className="scale-point" pointerEvents="none" />
        ))}
        {props.scalePoints.length === 2 && (
          <DimLabel a={props.scalePoints[0]} b={props.scalePoints[1]} ppm={ppm} k={view.k} />
        )}
        <MeasureMarks
          measures={doc.measures ?? []}
          ppm={ppm}
          k={view.k}
          selectedId={props.selectionKind === 'dim' ? props.selectionId : null}
        />
        {props.guide[0] && props.hover && (
          <line
            x1={props.guide[0].x}
            y1={props.guide[0].y}
            x2={props.guide[1]?.x ?? props.hover.x}
            y2={props.guide[1]?.y ?? props.hover.y}
            className="guide"
            pointerEvents="none"
          />
        )}
        {doc.anchor && (
          <g className="anchor" pointerEvents="none">
            <circle cx={doc.anchor.x} cy={doc.anchor.y} r={8 / view.k} />
            <line x1={doc.anchor.x - 14 / view.k} y1={doc.anchor.y} x2={doc.anchor.x + 14 / view.k} y2={doc.anchor.y} />
            <line x1={doc.anchor.x} y1={doc.anchor.y - 14 / view.k} x2={doc.anchor.x} y2={doc.anchor.y + 14 / view.k} />
          </g>
        )}
        {props.snapMark && (
          <rect
            x={props.snapMark.x - 5 / view.k}
            y={props.snapMark.y - 5 / view.k}
            width={10 / view.k}
            height={10 / view.k}
            className="snap-cursor"
            pointerEvents="none"
          />
        )}
        {selectedSprinkler && (
          <SprinklerHandles sprinkler={selectedSprinkler} ppm={ppm} k={view.k} />
        )}
        <SelectedSize doc={doc} selectionKind={props.selectionKind} selectionId={props.selectionId} ppm={ppm} k={view.k} />
      </g>
    </svg>
  )
})

function DraftLayer({
  points,
  hover,
  kind,
  view,
  ppm,
  sketch,
  brushWidth,
  brushTip,
  showOk,
  onFinish,
}: {
  points: Point[]
  hover: Point | null
  kind: ZoneKind
  view: View
  ppm: number
  sketch: 'poly' | 'rect' | 'circle' | 'brush'
  brushWidth: number
  brushTip: BrushTip
  showOk: boolean
  onFinish?: () => void
}) {
  const start = points[0]
  const last = points[points.length - 1]
  const vertexEdit = sketch === 'poly'
  const canClose = vertexEdit && points.length >= 3
  const closing = Boolean(canClose && hover && dist(hover, start) * view.k <= CLOSE_SCREEN_PX)
  const shapeFill = sketch === 'rect' || sketch === 'circle'
  const line = sketch === 'poly'
    ? (points.length === 0 ? [] : closing ? points : [...points, ...(hover ? [hover] : [])])
    : points
  const surface = surfaceOf(kind)
  const preview = shapeFill && points.length >= 3
    ? points
    : canClose
      ? (closing ? points : [...points, ...(hover ? [hover] : [])])
      : []
  const s = 4.5 / view.k
  const okR = 22 / view.k
  const showVerts = sketch === 'poly' || sketch === 'rect'
  return (
    <g className="draft-layer">
      {preview.length >= 3 && (
        <path
          d={zonePathD(preview, null, true)}
          fill={surface.fill}
          stroke="none"
          pointerEvents="none"
        />
      )}
      {sketch === 'brush' && line.length >= 1 && (
        <polyline
          points={line.map((point) => `${point.x},${point.y}`).join(' ')}
          className="draft-brush"
          stroke={surface.stroke}
          strokeWidth={brushWidth}
          fill="none"
          strokeLinecap={brushTip === 'square' ? 'square' : 'round'}
          strokeLinejoin={brushTip === 'square' ? 'miter' : 'round'}
          pointerEvents="none"
        />
      )}
      {sketch !== 'brush' && line.length >= 2 && (
        <polyline
          points={line.map((point) => `${point.x},${point.y}`).join(' ')}
          className="draft"
          strokeWidth={2 / view.k}
          pointerEvents="none"
        />
      )}
      {canClose && (
        <line
          x1={last.x}
          y1={last.y}
          x2={start.x}
          y2={start.y}
          className="draft-close-edge"
          strokeWidth={2 / view.k}
          strokeDasharray={`${7 / view.k} ${5 / view.k}`}
          pointerEvents="none"
        />
      )}
      {sketch === 'poly' && line.slice(0, -1).map((point, index) => (
        <DimLabel key={`d-${index}`} a={point} b={line[index + 1]} ppm={ppm} k={view.k} />
      ))}
      {sketch === 'rect' && points.length === 4 && (
        <>
          <DimLabel a={points[0]} b={points[1]} ppm={ppm} k={view.k} />
          <DimLabel a={points[1]} b={points[2]} ppm={ppm} k={view.k} />
        </>
      )}
      {sketch === 'circle' && points.length >= 3 && start && last && (
        <DimLabel a={centroid(points)} b={points[0]} ppm={ppm} k={view.k} />
      )}
      {showVerts && points.map((point, index) => (
        <rect
          key={`draft-${index}`}
          data-hit={index === 0 && canClose ? 'draft-close' : undefined}
          x={point.x - s}
          y={point.y - s}
          width={s * 2}
          height={s * 2}
          className={index === 0 && closing ? 'draft-point closing' : 'draft-point'}
          pointerEvents={index === points.length - 1 && showOk ? 'none' : undefined}
        />
      ))}
      {hover && !closing && sketch === 'poly' && (
        <rect
          x={hover.x - s}
          y={hover.y - s}
          width={s * 2}
          height={s * 2}
          className="snap-cursor"
          pointerEvents="none"
        />
      )}
      {showOk && last && (
        <g
          data-hit="draft-ok"
          className="draft-ok"
          onPointerDown={(event) => {
            event.stopPropagation()
            onFinish?.()
          }}
        >
          <circle data-hit="draft-ok" cx={last.x} cy={last.y} r={okR} className="draft-ok-hit" />
          <text
            x={last.x}
            y={last.y}
            className="draft-ok-label"
            fontSize={12 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
          >
            OK
          </text>
        </g>
      )}
    </g>
  )
}

function SprinklerHandles({ sprinkler, ppm, k }: { sprinkler: Sprinkler; ppm: number; k: number }) {
  const throwR = Math.max(ppm * (sprinkler.radiusM || 4.5), 24 / k)
  const handleR = Math.min(throwR, 72 / k)
  const mid = polar(sprinkler, handleR, sprinkler.rotationDeg)
  const open = sprinkler.arcDeg < 359
  const start = polar(sprinkler, handleR, sprinkler.rotationDeg - sprinkler.arcDeg / 2)
  const end = polar(sprinkler, handleR, sprinkler.rotationDeg + sprinkler.arcDeg / 2)
  const s = 9 / k
  const rim = sectorPath(sprinkler, handleR, sprinkler.rotationDeg, sprinkler.arcDeg)
  return (
    <g className="sprinkler-handles">
      <path d={rim} className="sprinkler-widget" pointerEvents="none" />
      <line x1={sprinkler.x} y1={sprinkler.y} x2={mid.x} y2={mid.y} className="sprinkler-ray" />
      {open && (
        <>
          <rect
            data-hit="sprinkler-arc"
            data-id={sprinkler.id}
            data-index={0}
            x={start.x - s}
            y={start.y - s}
            width={s * 2}
            height={s * 2}
            className="handle arc-handle"
          />
          <rect
            data-hit="sprinkler-arc"
            data-id={sprinkler.id}
            data-index={1}
            x={end.x - s}
            y={end.y - s}
            width={s * 2}
            height={s * 2}
            className="handle arc-handle"
          />
        </>
      )}
      <circle
        data-hit="sprinkler-rot"
        data-id={sprinkler.id}
        cx={mid.x}
        cy={mid.y}
        r={11 / k}
        className="handle rot-handle"
      />
    </g>
  )
}

function ZoneHandles({ zone, view, ppm }: { zone: Zone; view: View; ppm: number }) {
  const s = 5.5 / view.k
  return (
    <g className="zone-handles">
      {zone.points.map((point, index) => {
        const next = zone.points[(index + 1) % zone.points.length]
        const bend = zone.bends?.[index] ?? null
        const mid = bend ? handleFromControl(point, next, bend) : midpoint(point, next)
        return (
          <g key={`h-${index}`}>
            <DimLabel a={point} b={next} control={bend} ppm={ppm} k={view.k} />
            <circle
              data-hit="zone-mid"
              data-id={zone.id}
              data-index={index}
              cx={mid.x}
              cy={mid.y}
              r={5 / view.k}
              className="mid-handle"
            />
            <rect
              data-hit="zone-point"
              data-id={zone.id}
              data-index={index}
              x={point.x - s}
              y={point.y - s}
              width={s * 2}
              height={s * 2}
              className="handle"
            />
          </g>
        )
      })}
    </g>
  )
}

function DimLabel({ a, b, control, ppm, k }: { a: Point; b: Point; control?: Point | null; ppm: number; k: number }) {
  const mid = control ? handleFromControl(a, b, control) : midpoint(a, b)
  const length = (control ? dist(a, control) + dist(control, b) : dist(a, b)) / ppm
  if (length < 0.25) return null
  const label = length >= 10 ? length.toFixed(1) : length.toFixed(2)
  const nx = -(b.y - a.y)
  const ny = b.x - a.x
  const nlen = Math.hypot(nx, ny) || 1
  const off = 10 / k
  const x = mid.x + (nx / nlen) * off
  const y = mid.y + (ny / nlen) * off
  return (
    <text
      x={x}
      y={y}
      className="dim"
      fontSize={11 / k}
      textAnchor="middle"
      dominantBaseline="middle"
      pointerEvents="none"
    >
      {label} м
    </text>
  )
}

function MillimetreGrid({ width, height, ppm, k }: { width: number; height: number; ppm: number; k: number }) {
  const minorM = gridStepM(k, ppm)
  const majorM = minorM >= 5 ? 10 : 5
  const minor = ticks(width, minorM * ppm)
  const major = ticks(width, majorM * ppm)
  const minorY = ticks(height, minorM * ppm)
  const majorY = ticks(height, majorM * ppm)
  return (
    <g pointerEvents="none">
      {minor.map((value) => (
        <line key={`mx-${value}`} className="grid minor" x1={value} y1={0} x2={value} y2={height} />
      ))}
      {minorY.map((value) => (
        <line key={`my-${value}`} className="grid minor" x1={0} y1={value} x2={width} y2={value} />
      ))}
      {major.map((value) => (
        <line key={`Mx-${value}`} className="grid major" x1={value} y1={0} x2={value} y2={height} />
      ))}
      {majorY.map((value) => (
        <line key={`My-${value}`} className="grid major" x1={0} y1={value} x2={width} y2={value} />
      ))}
    </g>
  )
}

function MeasureMarks({ measures, ppm, k, selectedId }: { measures: Measure[]; ppm: number; k: number; selectedId: string | null }) {
  return (
    <>
      {measures.map((measure) => {
        const selected = measure.id === selectedId
        const dx = measure.b.x - measure.a.x
        const dy = measure.b.y - measure.a.y
        const span = Math.hypot(dx, dy) || 1
        const tick = 7 / k
        const ox = (-dy / span) * tick
        const oy = (dx / span) * tick
        const s = 5.5 / k
        const ink = selected ? 'measure selected' : 'measure'
        return (
          <g key={measure.id}>
            <line data-hit="dim" data-id={measure.id} x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="transparent" strokeWidth={14 / k} />
            <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} className={ink} pointerEvents="none" />
            <line x1={measure.a.x - ox} y1={measure.a.y - oy} x2={measure.a.x + ox} y2={measure.a.y + oy} className={ink} pointerEvents="none" />
            <line x1={measure.b.x - ox} y1={measure.b.y - oy} x2={measure.b.x + ox} y2={measure.b.y + oy} className={ink} pointerEvents="none" />
            <DimLabel a={measure.a} b={measure.b} ppm={ppm} k={k} />
            {selected && (
              <>
                <rect data-hit="dim-point" data-id={measure.id} data-index={0} x={measure.a.x - s} y={measure.a.y - s} width={s * 2} height={s * 2} className="handle" />
                <rect data-hit="dim-point" data-id={measure.id} data-index={1} x={measure.b.x - s} y={measure.b.y - s} width={s * 2} height={s * 2} className="handle" />
              </>
            )}
          </g>
        )
      })}
    </>
  )
}

function SurfacePatterns({ ppm }: { ppm: number }) {
  const u = Math.max(8, ppm * 0.7)
  const honey = honeycomb(u)
  const grass = `M 0 ${u * 0.7} L ${u * 0.35} ${u * 0.15} M ${u * 0.45} ${u} L ${u} ${u * 0.35}`
  return (
    <>
      <pattern id="fill-lawn" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(88, 150, 78, 0.34)" />
        <path d={grass} stroke="#3d7a38" strokeWidth="1.2" />
      </pattern>
      <pattern id="fill-lawn-stripe" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(88, 150, 78, 0.34)" />
        <path d={grass} stroke="#3d7a38" strokeWidth="1.2" />
        <path d={`M 0 ${u * 0.33} L ${u} ${u * 0.33} M 0 ${u * 0.66} L ${u} ${u * 0.66}`} stroke="#2a6b32" strokeWidth="1.1" />
      </pattern>
      <pattern id="fill-bed" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(196, 132, 52, 0.34)" />
        <circle cx={u * 0.3} cy={u * 0.35} r={1.6} fill="#c45b5b" />
        <circle cx={u * 0.7} cy={u * 0.7} r={1.4} fill="#d4a03a" />
      </pattern>
      <pattern id="fill-bed-mulch" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(150, 104, 52, 0.45)" />
        <circle cx={u * 0.22} cy={u * 0.28} r={1.5} fill="#6a4324" />
        <circle cx={u * 0.58} cy={u * 0.22} r={1.2} fill="#7a5230" />
        <circle cx={u * 0.78} cy={u * 0.62} r={1.6} fill="#5c3a1e" />
        <circle cx={u * 0.36} cy={u * 0.72} r={1.1} fill="#6a4324" />
      </pattern>
      <pattern id="fill-shrub" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(48, 96, 54, 0.4)" />
        <circle cx={u * 0.5} cy={u * 0.5} r={u * 0.22} fill="none" stroke="#24522c" strokeWidth="1.2" />
      </pattern>
      <pattern id="fill-path" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(168, 160, 148, 0.42)" />
        <path d={`M 0 ${u / 2} L ${u / 2} 0 L ${u} ${u / 2} L ${u / 2} ${u} Z`} fill="none" stroke="#7a7368" strokeWidth="1" />
      </pattern>
      <pattern id="fill-path-diagonal" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(168, 160, 148, 0.42)" />
        <path d={`M 0 ${u} L ${u} 0 M 0 ${u / 2} L ${u / 2} 0 M ${u / 2} ${u} L ${u} ${u / 2}`} fill="none" stroke="#7a7368" strokeWidth="1" />
      </pattern>
      <pattern id="fill-path-brick" width={u * 2} height={u} patternUnits="userSpaceOnUse">
        <rect width={u * 2} height={u} fill="rgba(168, 160, 148, 0.42)" />
        <path d={`M 0 ${u / 2} L ${u * 2} ${u / 2} M ${u} 0 L ${u} ${u / 2} M ${u / 2} ${u / 2} L ${u / 2} ${u} M ${u * 1.5} ${u / 2} L ${u * 1.5} ${u}`} fill="none" stroke="#7a7368" strokeWidth="1" />
      </pattern>
      <pattern id="fill-path-honey" width={honey.w} height={honey.h} patternUnits="userSpaceOnUse">
        <rect width={honey.w} height={honey.h} fill="rgba(168, 160, 148, 0.42)" />
        <path d={honey.d} fill="none" stroke="#7a7368" strokeWidth="1" />
      </pattern>
      <pattern id="fill-concrete" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(176, 176, 172, 0.5)" />
        <path d={`M 0 ${u} L ${u} 0`} stroke="#9a9a96" strokeWidth="1" />
      </pattern>
      <pattern id="fill-water" width={u * 1.4} height={u} patternUnits="userSpaceOnUse">
        <rect width={u * 1.4} height={u} fill="rgba(72, 140, 188, 0.32)" />
        <path d={`M 0 ${u * 0.45} Q ${u * 0.35} ${u * 0.2} ${u * 0.7} ${u * 0.45} T ${u * 1.4} ${u * 0.45}`} fill="none" stroke="#3a7aa8" strokeWidth="1.3" />
      </pattern>
      <pattern id="fill-building" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(110, 100, 92, 0.5)" />
        <path d={`M 0 0 L ${u} ${u} M ${u} 0 L 0 ${u}`} stroke="#5a524c" strokeWidth="1" />
      </pattern>
    </>
  )
}

function FixtureMark({ fixture, ppm, k, selected }: { fixture: Fixture; ppm: number; k: number; selected: boolean }) {
  const radius = Math.max(fixture.radiusM * ppm, 8 / k)
  const glyph = fixtureGlyph(fixture.kind)
  return (
    <g className={selected ? 'plant selected' : 'plant'} transform={`translate(${fixture.x} ${fixture.y}) rotate(${fixture.rotationDeg || 0})`}>
      <g transform={`scale(${radius})`} pointerEvents="none">
        {glyph.parts.map((part, index) => (
          <path key={`p${index}`} d={part.d} fill={part.fill} stroke={part.stroke} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        ))}
        {glyph.lines.map((line, index) => (
          <path key={`l${index}`} d={line.d} fill="none" stroke={line.stroke} strokeWidth={1.1} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        {selected && <circle r={1.02} fill="none" stroke="#b86a09" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />}
      </g>
      <circle data-hit="fixture" data-id={fixture.id} r={Math.max(radius, 10 / k)} fill="transparent" />
    </g>
  )
}

function ScaleBar({ fixture, ppm, k, selected }: { fixture: Fixture; ppm: number; k: number; selected: boolean }) {
  const metres = Math.max(fixture.radiusM * 2, 0.2)
  const len = Math.max(metres * ppm, 16 / k)
  const half = len / 2
  const stepM = metres <= 6 ? 1 : metres <= 16 ? 2 : 5
  const ticks: number[] = []
  for (let metre = 0; metre <= metres + 0.001; metre += stepM) ticks.push(-half + (metre / metres) * len)
  const label = `${Math.round(metres * 100) / 100} м`
  const ink = selected ? '#b86a09' : '#1c2822'
  return (
    <g className={selected ? 'plant selected' : 'plant'} transform={`translate(${fixture.x} ${fixture.y}) rotate(${fixture.rotationDeg || 0})`}>
      <rect data-hit="fixture" data-id={fixture.id} x={-half} y={-14 / k} width={len} height={28 / k} fill="transparent" />
      <line x1={-half} y1={0} x2={half} y2={0} stroke={ink} strokeWidth={1.6 / k} pointerEvents="none" />
      {ticks.map((x) => (
        <line key={x} x1={x} y1={-5 / k} x2={x} y2={5 / k} stroke={ink} strokeWidth={1.3 / k} pointerEvents="none" />
      ))}
      <text x={0} y={-7 / k} textAnchor="middle" fontSize={11 / k} fill={ink} pointerEvents="none">{label}</text>
    </g>
  )
}

function PlantMark({ plant, ppm, k, selected }: { plant: Plant; ppm: number; k: number; selected: boolean }) {
  const radius = Math.max(plant.radiusM * ppm, 8 / k)
  const form = formOf(plant)
  const glyph = plantGlyph(form)
  const paint = plantPaint(form)
  const ink = selected ? '#b86a09' : paint.ink
  return (
    <g className={selected ? 'plant selected' : 'plant'} transform={`translate(${plant.x} ${plant.y})`}>
      <g transform={`scale(${radius})`} pointerEvents="none">
        {glyph.fills.map((d, index) => (
          <path key={`f${index}`} d={d} fill={paint.leaf} stroke={ink} strokeWidth={1.35} vectorEffect="non-scaling-stroke" />
        ))}
        {glyph.veins.map((d, index) => (
          <path key={`v${index}`} d={d} fill="none" stroke={paint.vein} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {glyph.dots.map((dot, index) => (
          <circle
            key={`d${index}`}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill={dot.bloom ? paint.accent : paint.trunk}
            stroke={dot.bloom ? paint.ink : '#3e2614'}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <circle data-hit="plant" data-id={plant.id} r={Math.max(radius, 10 / k)} fill="transparent" />
    </g>
  )
}

function SelectedSize({ doc, selectionKind, selectionId, ppm, k }: { doc: Doc; selectionKind: string | null; selectionId: string | null; ppm: number; k: number }) {
  if (selectionKind === 'plant' && selectionId) {
    const plant = (doc.plants ?? []).find((item) => item.id === selectionId)
    if (!plant) return null
    const radius = Math.max(plant.radiusM * ppm, 8 / k)
    return (
      <g transform={`translate(${plant.x} ${plant.y})`}>
        <SizeGrip x={radius} y={0} id={plant.id} hit="plant-size" k={k} label={sizeLabel(plant.radiusM)} />
      </g>
    )
  }
  if (selectionKind === 'fixture' && selectionId) {
    const fixture = (doc.fixtures ?? []).find((item) => item.id === selectionId)
    if (!fixture) return null
    const turn = fixture.rotationDeg || 0
    if (fixture.kind === 'scalebar') {
      const metres = Math.max(fixture.radiusM * 2, 0.2)
      const len = Math.max(metres * ppm, 16 / k)
      return (
        <g transform={`translate(${fixture.x} ${fixture.y}) rotate(${turn})`}>
          <SizeGrip x={len / 2} y={0} id={fixture.id} hit="fixture-size" k={k} />
        </g>
      )
    }
    const radius = Math.max(fixture.radiusM * ppm, 8 / k)
    return (
      <g transform={`translate(${fixture.x} ${fixture.y}) rotate(${turn})`}>
        <SizeGrip x={radius} y={0} id={fixture.id} hit="fixture-size" k={k} label={sizeLabel(fixture.radiusM * 2)} />
      </g>
    )
  }
  return null
}

function sizeLabel(metres: number): string {
  return `${Math.round(metres * 10) / 10} м`
}

function SizeGrip({ x, y, id, hit, k, label }: { x: number; y: number; id: string; hit: 'plant-size' | 'fixture-size'; k: number; label?: string }) {
  const s = 7 / k
  return (
    <g className="size-grip">
      <line x1={0} y1={0} x2={x} y2={y} stroke="#b86a09" strokeWidth={1.2 / k} pointerEvents="none" />
      {label ? (
        <text x={x} y={y - 12 / k} textAnchor="middle" fontSize={12 / k} fill="#1c2822" pointerEvents="none">{label}</text>
      ) : null}
      <rect data-hit={hit} data-id={id} x={x - s} y={y - s} width={s * 2} height={s * 2} className="handle size-handle" />
    </g>
  )
}

function NoteMark({ note, ppm, selected }: { note: Note; ppm: number; selected: boolean }) {
  const size = Math.max(note.sizeM * ppm, 8)
  const width = Math.max(size * note.text.length * 0.62, size * 2)
  return (
    <g className={selected ? 'note selected' : 'note'}>
      <rect data-hit="note" data-id={note.id} x={note.x} y={note.y - size} width={width} height={size * 1.25} fill="transparent" />
      <text
        x={note.x}
        y={note.y}
        fontSize={size}
        fontWeight={note.bold ? 700 : undefined}
        style={note.color ? { fill: note.color } : undefined}
        pointerEvents="none"
      >
        {note.text}
      </text>
    </g>
  )
}

function diamond(point: Point, radius: number): string {
  return `${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}`
}

function ticks(length: number, step: number): number[] {
  if (!(step > 0)) return []
  const out: number[] = []
  for (let value = 0; value <= length + 0.01; value += step) out.push(value)
  return out
}
