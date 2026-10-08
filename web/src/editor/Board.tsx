import { forwardRef, type MouseEvent, type PointerEvent } from 'react'
import { dist, handleFromControl, midpoint, sectorPath, zonePathD } from '@shared/geom.ts'
import { DEFAULT_PPM, surfaceOf } from '@shared/landscape.ts'
import type { Analysis, Doc, Point, Zone, ZoneKind } from '@shared/types.ts'

export const CLOSE_SCREEN_PX = 32

export type View = { x: number; y: number; k: number }

export type Hit =
  | { kind: 'board' }
  | { kind: 'sprinkler'; id: string }
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
  | { kind: 'draft-close' }

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
  if (kind === 'zone-mid' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'zone-edge' && Number.isInteger(index)) return { kind, id, index }
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
  draftKind: ZoneKind
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
  const ppm = doc.pxPerMeter && doc.pxPerMeter > 0 ? doc.pxPerMeter : DEFAULT_PPM
  const gridOn = doc.gridOn !== false
  const selectedZone = props.selectionKind === 'zone' ? doc.zones.find((zone) => zone.id === props.selectionId) : undefined

  return (
    <svg
      ref={ref}
      className="board"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
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
                d={zonePathD(zone.points, zone.bends, true)}
                fill={`url(#fill-${surface.pattern})`}
                stroke={surface.stroke}
                strokeWidth={(selected ? 2.4 : 1.4) / view.k}
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
        {doc.sprinklers.map((sprinkler) => {
          const radius = ppm * sprinkler.radiusM
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
        <DraftLayer
          points={props.draft}
          hover={props.hover}
          kind={props.draftKind}
          view={view}
          ppm={ppm}
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
}: {
  points: Point[]
  hover: Point | null
  kind: ZoneKind
  view: View
  ppm: number
}) {
  if (points.length === 0) return null
  const start = points[0]
  const last = points[points.length - 1]
  const canClose = points.length >= 3
  const closing = Boolean(canClose && hover && dist(hover, start) * view.k <= CLOSE_SCREEN_PX)
  const line = closing ? points : [...points, ...(hover ? [hover] : [])]
  const surface = surfaceOf(kind)
  const preview = canClose ? (closing ? points : [...points, ...(hover ? [hover] : [])]) : []
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
      {line.slice(0, -1).map((point, index) => (
        <DimLabel key={`d-${index}`} a={point} b={line[index + 1]} ppm={ppm} k={view.k} />
      ))}
      {points.map((point, index) => (
        index === 0 ? null : (
          <rect
            key={`draft-${index}`}
            x={point.x - 4.5 / view.k}
            y={point.y - 4.5 / view.k}
            width={9 / view.k}
            height={9 / view.k}
            className="draft-point"
            pointerEvents="none"
          />
        )
      ))}
      {canClose ? (
        <g data-hit="draft-close" className={closing ? 'draft-start hot' : 'draft-start'}>
          <circle cx={start.x} cy={start.y} r={18 / view.k} className="draft-start-hit" />
          <rect
            x={start.x - 5 / view.k}
            y={start.y - 5 / view.k}
            width={10 / view.k}
            height={10 / view.k}
            className="draft-start-dot"
            pointerEvents="none"
          />
        </g>
      ) : (
        <rect
          x={start.x - 5 / view.k}
          y={start.y - 5 / view.k}
          width={10 / view.k}
          height={10 / view.k}
          className="draft-point"
          pointerEvents="none"
        />
      )}
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
  if (length < 0.15) return null
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
  const minorM = ppm * k >= 12 ? 1 : ppm * k >= 5 ? 5 : 10
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

function SurfacePatterns({ ppm }: { ppm: number }) {
  const u = Math.max(8, ppm * 0.7)
  return (
    <>
      <pattern id="fill-lawn" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(88, 150, 78, 0.34)" />
        <path d={`M 0 ${u * 0.7} L ${u * 0.35} ${u * 0.15} M ${u * 0.45} ${u} L ${u} ${u * 0.35}`} stroke="#3d7a38" strokeWidth="1.2" />
      </pattern>
      <pattern id="fill-bed" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(196, 132, 52, 0.34)" />
        <circle cx={u * 0.3} cy={u * 0.35} r={1.6} fill="#c45b5b" />
        <circle cx={u * 0.7} cy={u * 0.7} r={1.4} fill="#d4a03a" />
      </pattern>
      <pattern id="fill-shrub" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(48, 96, 54, 0.4)" />
        <circle cx={u * 0.5} cy={u * 0.5} r={u * 0.22} fill="none" stroke="#24522c" strokeWidth="1.2" />
      </pattern>
      <pattern id="fill-path" width={u} height={u} patternUnits="userSpaceOnUse">
        <rect width={u} height={u} fill="rgba(168, 160, 148, 0.42)" />
        <path d={`M 0 ${u / 2} L ${u / 2} 0 L ${u} ${u / 2} L ${u / 2} ${u} Z`} fill="none" stroke="#7a7368" strokeWidth="1" />
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

function diamond(point: Point, radius: number): string {
  return `${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}`
}

function ticks(length: number, step: number): number[] {
  if (!(step > 0)) return []
  const out: number[] = []
  for (let value = 0; value <= length + 0.01; value += step) out.push(value)
  return out
}
