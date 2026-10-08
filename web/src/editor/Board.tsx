import { forwardRef, type MouseEvent, type PointerEvent } from 'react'
import { dist, sectorPath } from '@shared/geom.ts'
import type { Analysis, Doc, Point } from '@shared/types.ts'

export const CLOSE_SCREEN_PX = 32

export type View = { x: number; y: number; k: number }

export type Hit =
  | { kind: 'board' }
  | { kind: 'sprinkler'; id: string }
  | { kind: 'source' }
  | { kind: 'zone'; id: string }
  | { kind: 'zone-point'; id: string; index: number }
  | { kind: 'pipe'; id: string }
  | { kind: 'pipe-point'; id: string; index: number }
  | { kind: 'valve'; id: string }
  | { kind: 'drip'; id: string }
  | { kind: 'drip-point'; id: string; index: number }
  | { kind: 'draft-close' }

const ZONE_COLOR = {
  lawn: { fill: 'rgba(63, 122, 72, 0.28)', stroke: '#24633a' },
  bed: { fill: 'rgba(184, 122, 46, 0.30)', stroke: '#8a5a16' },
  path: { fill: 'rgba(110, 102, 92, 0.28)', stroke: '#5c564e' },
}

export function readHit(target: EventTarget | null): Hit {
  const el = (target as Element | null)?.closest?.('[data-hit]')
  if (!el) return { kind: 'board' }
  const kind = el.getAttribute('data-hit')
  const id = el.getAttribute('data-id') || ''
  const index = Number(el.getAttribute('data-index'))
  if (kind === 'sprinkler') return { kind, id }
  if (kind === 'source') return { kind }
  if (kind === 'zone') return { kind, id }
  if (kind === 'pipe') return { kind, id }
  if (kind === 'valve') return { kind, id }
  if (kind === 'drip') return { kind, id }
  if (kind === 'draft-close') return { kind }
  if (kind === 'zone-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'pipe-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'drip-point' && Number.isInteger(index)) return { kind, id, index }
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
  hover: Point | null
  scalePoints: Point[]
  selectionId: string | null
  selectionKind: string | null
  onPointerDown: (event: PointerEvent<SVGSVGElement>) => void
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
  onPointerUp: (event: PointerEvent<SVGSVGElement>) => void
  onContextMenu?: (event: MouseEvent<SVGSVGElement>) => void
}>(function Board(props, ref) {
  const { doc, analysis, view, board, backgroundUrl, imageSize } = props
  const step = gridStep(doc.pxPerMeter ?? 50, view.k, Math.max(board.w, board.h))
  const xs = ticks(board.w, step)
  const ys = ticks(board.h, step)

  return (
    <svg
      ref={ref}
      className="board"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onContextMenu={props.onContextMenu}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <rect x={0} y={0} width={board.w} height={board.h} className="paper" />
        {xs.map((value) => (
          <line key={`x-${value}`} className="grid" x1={value} y1={0} x2={value} y2={board.h} pointerEvents="none" />
        ))}
        {ys.map((value) => (
          <line key={`y-${value}`} className="grid" x1={0} y1={value} x2={board.w} y2={value} pointerEvents="none" />
        ))}
        {backgroundUrl && imageSize && (
          <image href={backgroundUrl} x={0} y={0} width={imageSize.w} height={imageSize.h} />
        )}
        {doc.zones.map((zone) => {
          const color = ZONE_COLOR[zone.kind]
          const selected = props.selectionKind === 'zone' && props.selectionId === zone.id
          return (
            <polygon
              key={zone.id}
              data-hit="zone"
              data-id={zone.id}
              points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={(selected ? 3 : 1.5) / view.k}
            />
          )
        })}
        {doc.sprinklers.map((sprinkler) => {
          const radius = doc.pxPerMeter ? sprinkler.radiusM * doc.pxPerMeter : 36
          return (
            <path
              key={`${sprinkler.id}-cover`}
              d={sectorPath(sprinkler, radius, sprinkler.rotationDeg, sprinkler.arcDeg)}
              className="cover"
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
        {props.draft.length > 0 && (() => {
          const start = props.draft[0]
          const last = props.draft[props.draft.length - 1]
          const canClose = props.draft.length >= 3
          const closing = Boolean(canClose && props.hover && dist(props.hover, start) * view.k <= CLOSE_SCREEN_PX)
          const line = closing
            ? props.draft
            : [...props.draft, ...(props.hover ? [props.hover] : [])]
          const fill = canClose ? (closing ? props.draft : [...props.draft, ...(props.hover ? [props.hover] : [])]) : []
          return (
            <g className="draft-layer">
              {fill.length >= 3 && (
                <polygon
                  points={fill.map((point) => `${point.x},${point.y}`).join(' ')}
                  className={closing ? 'draft-fill closing' : 'draft-fill'}
                  pointerEvents="none"
                />
              )}
              <polyline
                points={line.map((point) => `${point.x},${point.y}`).join(' ')}
                className="draft"
                strokeWidth={2 / view.k}
                pointerEvents="none"
              />
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
              {props.draft.map((point, index) => (
                index === 0 ? null : (
                  <circle
                    key={`draft-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={4.5 / view.k}
                    className="draft-point"
                    pointerEvents="none"
                  />
                )
              ))}
              {canClose ? (
                <g data-hit="draft-close" className={closing ? 'draft-start hot' : 'draft-start'}>
                  <circle cx={start.x} cy={start.y} r={18 / view.k} className="draft-start-hit" />
                  <circle cx={start.x} cy={start.y} r={6 / view.k} className="draft-start-dot" pointerEvents="none" />
                </g>
              ) : (
                <circle cx={start.x} cy={start.y} r={5 / view.k} className="draft-point" pointerEvents="none" />
              )}
            </g>
          )
        })()}
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
          <circle
            key={sprinkler.id}
            data-hit="sprinkler"
            data-id={sprinkler.id}
            cx={sprinkler.x}
            cy={sprinkler.y}
            r={8 / view.k}
            className={props.selectionKind === 'sprinkler' && props.selectionId === sprinkler.id ? 'node selected' : 'node'}
          />
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
        {props.selectionKind === 'zone' &&
          doc.zones
            .find((zone) => zone.id === props.selectionId)
            ?.points.map((point, index) => (
              <circle
                key={`z-${index}`}
                data-hit="zone-point"
                data-id={props.selectionId || ''}
                data-index={index}
                cx={point.x}
                cy={point.y}
                r={6 / view.k}
                className="handle"
              />
            ))}
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
      </g>
    </svg>
  )
})

function diamond(point: Point, radius: number): string {
  return `${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}`
}

function ticks(length: number, step: number): number[] {
  const out: number[] = []
  for (let value = 0; value <= length; value += step) out.push(value)
  return out
}

function gridStep(base: number, k: number, length: number): number {
  let step = base
  while (step * k < 14) step *= 5
  while (length / step > 60) step *= 2
  return step
}
