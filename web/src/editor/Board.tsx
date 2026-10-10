import { forwardRef, type MouseEvent, type PointerEvent } from 'react'
import { stationInk, stationNo } from '@shared/analyze.ts'
import type { BrushTip } from '@shared/clip.ts'
import { emitterPoints } from '@shared/drip.ts'
import { fixtureGlyph } from '@shared/fixtures.ts'
import { crownFill, formOf, plantGlyph, plantPaint } from '@shared/plants.ts'
import { centroid, coverPath, dist, handleFromControl, midpoint, noteLeader, pointInZone, polar, sectorPath, stripHandlePoint, zonePathD, zoneShapeD } from '@shared/geom.ts'
import { headCaption, nozzleById } from '@shared/nozzles.ts'
import { runtimeLabel } from '@shared/program.ts'
import { DEFAULT_PPM, gridStepM, hatchOf, hatchTile, HATCHES, precipWash, surfaceOf, type HatchNode } from '@shared/landscape.ts'
import { pipeWeight, pressureLabel, sourceLabel, valveFlowLabel } from '@shared/pipes.ts'
import { dripFlowTags, dripTags, fittingShape, flowArrows, funnyPoints, lossTags, pipeTags, sleeveTags, speedTags, type FlowArrow } from '@shared/pipeview.ts'
import type { Analysis, Doc, FittingMark, Fixture, Measure, Note, Plant, Point, Sprinkler, Zone, ZoneKind } from '@shared/types.ts'

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
  | { kind: 'box'; id: string }
  | { kind: 'hydrant'; id: string }
  | { kind: 'sleeve'; id: string }
  | { kind: 'sleeve-point'; id: string; index: number }
  | { kind: 'drip'; id: string }
  | { kind: 'drip-point'; id: string; index: number }
  | { kind: 'note'; id: string }
  | { kind: 'note-leader'; id: string }
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
  if (kind === 'box') return { kind, id }
  if (kind === 'hydrant') return { kind, id }
  if (kind === 'sleeve') return { kind, id }
  if (kind === 'sleeve-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'drip') return { kind, id }
  if (kind === 'draft-close') return { kind }
  if (kind === 'draft-ok') return { kind }
  if (kind === 'zone-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'zone-mid' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'zone-edge' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'pipe-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'drip-point' && Number.isInteger(index)) return { kind, id, index }
  if (kind === 'note') return { kind, id }
  if (kind === 'note-leader') return { kind, id }
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

function segmentInk(analysis: Analysis, segment: Analysis['segments'][number]): string {
  if (segment.role === 'zone' && segment.status === 'ok' && segment.stationId) return stationInk(analysis.stations, segment.stationId)
  return pipeColor(segment.odMm, segment.status)
}

function precipAt(doc: Doc, analysis: Analysis, point: Point): number | null {
  const zone = doc.zones.find((item) => pointInZone(point, item.points, item.holes))
  if (!zone) return null
  return analysis.zones.find((item) => item.id === zone.id)?.precipMmH ?? null
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
  draftLine: 'poly' | 'main' | 'zone' | 'drip'
  draftWarn: boolean
  joinIds: string[]
  hover: Point | null
  scalePoints: Point[]
  selectionId: string | null
  selectionKind: string | null
  precip?: boolean
  headInfo?: boolean
  /** Имена зон. Пусто значит выключены. Выбранная зона подписана и без слоя. */
  names?: boolean
  /** Площадь зоны. Пусто значит выключена. Без масштаба подписи нет. */
  area?: boolean
  /** Радиусы. Пусто значит включены. */
  cover?: boolean
  runtime?: boolean
  alongPreview?: { x: number; y: number; rotationDeg: number; radiusM: number; arcDeg: number; nozzleId: string }[]
  placePreview?: { x: number; y: number; rotationDeg: number; radiusM: number; arcDeg: number; nozzleId: string } | null
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
          const row = analysis.zones.find((item) => item.id === zone.id)
          const wash = props.precip ? precipWash(row?.precipMmH ?? null) : null
          const middle = centroid(zone.points)
          const captions: { text: string; size: number }[] = []
          if ((props.names || selected) && zone.name) captions.push({ text: zone.name, size: 13 })
          if (props.area && row?.areaM2 != null) {
            captions.push({
              text: `${row.areaM2.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²`,
              size: 13,
            })
          }
          if (props.precip && row) {
            captions.push({
              text: row.precipMmH === null ? 'нет осадков' : `${row.precipMmH.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мм/ч`,
              size: 13,
            })
          }
          const run = props.runtime && row ? runtimeLabel(row.runtimeMin, row.cycles) : null
          if (run) captions.push({ text: run, size: 12 })
          return (
            <g key={zone.id}>
              <path
                data-hit="zone"
                data-id={zone.id}
                d={zoneShapeD(zone.points, zone.bends, zone.holes)}
                fillRule="evenodd"
                fill={wash ?? `url(#fill-${hatchOf(zone)})`}
                stroke={zone.stroke || surface.stroke}
                strokeWidth={(zone.pen ?? (selected ? 2.4 : 1.4)) / view.k}
                opacity={zone.opacity}
              />
              {captions.map((caption, index) => (
                <text
                  key={`${zone.id}-cap-${index}`}
                  x={middle.x}
                  y={middle.y + index * (16 / view.k)}
                  fontSize={caption.size / view.k}
                  textAnchor="middle"
                  fill="#1c2822"
                  fontWeight={700}
                  stroke="#f7f3ea"
                  strokeWidth={3 / view.k}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {caption.text}
                </text>
              ))}
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
            k={view.k}
            selected={props.selectionKind === 'note' && props.selectionId === note.id}
          />
        ))}
        {props.cover !== false && doc.sprinklers.map((sprinkler) => {
          const selected = selectedSprinkler?.id === sprinkler.id
          const wash = props.precip ? precipWash(precipAt(doc, analysis, sprinkler)) : undefined
          return (
            <path
              key={`${sprinkler.id}-cover`}
              d={coverPath(sprinkler, ppm, nozzleById(sprinkler.nozzleId))}
              className={selected ? 'cover selected' : 'cover'}
              style={wash ? { fill: wash } : undefined}
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
            stroke={segmentInk(analysis, segment)}
            strokeWidth={pipeWeight(segment.role) / view.k}
            strokeLinecap="round"
            pointerEvents="none"
          />
        ))}
        {flowArrows(analysis.segments, doc.pxPerMeter, view.k).map((arrow, index) => (
          <FlowArrowView key={`flow-${index}`} arrow={arrow} k={view.k} />
        ))}
        {analysis.tails.map((tail, index) => (
          <polyline
            key={`tail-${index}`}
            points={funnyPoints(tail.a, tail.b).map((point) => `${point.x},${point.y}`).join(' ')}
            className="funny"
            strokeWidth={2.2 / view.k}
            pointerEvents="none"
          />
        ))}
        {analysis.fittingMarks.map((mark, index) => (
          <FittingMarkView key={`fit-${index}`} mark={mark} k={view.k} />
        ))}
        {pipeTags(analysis.segments, doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`tag-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {tag.text}
          </text>
        ))}
        {speedTags(analysis.segments, doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`speed-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            style={tag.hot ? { fill: '#8d2b1f' } : undefined}
            pointerEvents="none"
          >
            {tag.text}
          </text>
        ))}
        {lossTags(analysis.segments, doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`loss-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {tag.text}
          </text>
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
          ink={props.draftLine}
          warn={props.draftWarn}
          onFinish={props.onFinishDraft}
        />
        {doc.drips.map((drip) => {
          const mark = analysis.marks.find((item) => item.kind === 'drip' && item.id === drip.id)
          const stroke = mark ? stationInk(analysis.stations, mark.stationId) : '#6b3fa0'
          return (
            <polyline
              key={`${drip.id}-line`}
              points={drip.points.map((point) => `${point.x},${point.y}`).join(' ')}
              className="drip"
              style={{ stroke }}
              strokeWidth={2 / view.k}
              strokeDasharray={drip.bare ? undefined : `${7 / view.k} ${5 / view.k}`}
              pointerEvents="none"
            />
          )
        })}
        {doc.drips.filter((drip) => !drip.bare).flatMap((drip) =>
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
        {dripTags(doc.drips, doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`drip-tag-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {tag.text}
          </text>
        ))}
        {dripFlowTags(doc.drips, doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`drip-flow-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {tag.text}
          </text>
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
        {doc.sprinklers.map((sprinkler) => {
          const selected = props.selectionKind === 'sprinkler' && props.selectionId === sprinkler.id
          const mark = analysis.marks.find((item) => item.kind === 'sprinkler' && item.id === sprinkler.id)
          const ink = mark ? stationInk(analysis.stations, mark.stationId) : ''
          const no = mark ? stationNo(analysis.stations, mark.stationId) : 0
          const pressure = analysis.pressureMarks.find((item) => item.id === sprinkler.id)
          return (
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
                className={`node${sprinkler.nozzleId.startsWith('bub') ? ' bubbler' : ''}${selected ? ' selected' : ''}`}
                style={ink && !selected ? { stroke: ink } : undefined}
              />
              {no > 0 && (
                <text
                  x={sprinkler.x}
                  y={sprinkler.y - 12 / view.k}
                  fontSize={11 / view.k}
                  textAnchor="middle"
                  fill={ink}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {no}
                </text>
              )}
              {pressure && (
                <text
                  x={sprinkler.x + 14 / view.k}
                  y={sprinkler.y}
                  className="pipe-tag"
                  fontSize={11 / view.k}
                  textAnchor="start"
                  dominantBaseline="middle"
                  stroke="#f7f3ea"
                  strokeWidth={3 / view.k}
                  paintOrder="stroke"
                  style={pressure.low ? { fill: '#8d2b1f' } : undefined}
                  pointerEvents="none"
                >
                  {pressureLabel(pressure.bar)}
                </text>
              )}
              {(props.headInfo || selected) && (
                <text
                  x={sprinkler.x}
                  y={sprinkler.y + 22 / view.k}
                  fontSize={11 / view.k}
                  textAnchor="middle"
                  fill="#1c2822"
                  stroke="#f7f3ea"
                  strokeWidth={3 / view.k}
                  paintOrder="stroke"
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {headCaption(sprinkler)}
                </text>
              )}
            </g>
          )
        })}
        {(doc.sleeves ?? []).map((sleeve) => (
          <g key={sleeve.id}>
            <line
              x1={sleeve.a.x}
              y1={sleeve.a.y}
              x2={sleeve.b.x}
              y2={sleeve.b.y}
              stroke="#5c564e"
              strokeWidth={8 / view.k}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <line
              x1={sleeve.a.x}
              y1={sleeve.a.y}
              x2={sleeve.b.x}
              y2={sleeve.b.y}
              stroke="#f4efe4"
              strokeWidth={2.6 / view.k}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <line
              data-hit="sleeve"
              data-id={sleeve.id}
              x1={sleeve.a.x}
              y1={sleeve.a.y}
              x2={sleeve.b.x}
              y2={sleeve.b.y}
              stroke="transparent"
              strokeWidth={16 / view.k}
            />
          </g>
        ))}
        {sleeveTags(doc.sleeves ?? [], doc.pxPerMeter, view.k).map((tag, index) => (
          <text
            key={`sleeve-tag-${index}`}
            x={tag.x}
            y={tag.y}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${tag.rotate} ${tag.x} ${tag.y})`}
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {tag.text}
          </text>
        ))}
        {(doc.boxes ?? []).map((box) => (
          <rect
            key={box.id}
            data-hit="box"
            data-id={box.id}
            x={box.x - 22 / view.k}
            y={box.y - 14 / view.k}
            width={44 / view.k}
            height={28 / view.k}
            rx={3 / view.k}
            className={props.selectionKind === 'box' && props.selectionId === box.id ? 'box selected' : 'box'}
          />
        ))}
        {(doc.hydrants ?? []).map((hydrant) => (
          <g key={hydrant.id} data-hit="hydrant" data-id={hydrant.id}>
            <circle
              data-hit="hydrant"
              data-id={hydrant.id}
              cx={hydrant.x}
              cy={hydrant.y}
              r={7 / view.k}
              className={props.selectionKind === 'hydrant' && props.selectionId === hydrant.id ? 'hydrant selected' : 'hydrant'}
            />
            <path
              d={`M ${hydrant.x} ${hydrant.y - 3 / view.k} V ${hydrant.y + 3 / view.k} M ${hydrant.x - 3 / view.k} ${hydrant.y - 1 / view.k} H ${hydrant.x + 3 / view.k}`}
              fill="none"
              stroke="#f4efe4"
              strokeWidth={1.4 / view.k}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </g>
        ))}
        {doc.valves.map((valve) => {
          const selected = props.selectionKind === 'valve' && props.selectionId === valve.id
          const no = stationNo(analysis.stations, valve.id)
          const ink = no > 0 ? stationInk(analysis.stations, valve.id) : ''
          const station = analysis.stations.find((row) => row.id === valve.id)
          const run = props.runtime && station ? runtimeLabel(station.runtimeMin, station.cycles) : null
          const flow = station && station.flowLph > 0 ? valveFlowLabel(station.flowLph) : null
          return (
            <g key={valve.id}>
              <polygon
                data-hit="valve"
                data-id={valve.id}
                points={diamond(valve, 8 / view.k)}
                className={selected ? 'valve selected' : 'valve'}
                style={ink && !selected ? { stroke: ink } : undefined}
              />
              {no > 0 && (
                <text
                  x={valve.x}
                  y={valve.y - 14 / view.k}
                  fontSize={11 / view.k}
                  textAnchor="middle"
                  fill={ink}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {no}
                </text>
              )}
              {run && (
                <text
                  x={valve.x}
                  y={valve.y + 16 / view.k}
                  fontSize={11 / view.k}
                  textAnchor="middle"
                  fill="#1c2822"
                  fontWeight={700}
                  stroke="#f7f3ea"
                  strokeWidth={3 / view.k}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {run}
                </text>
              )}
              {flow && (
                <text
                  x={valve.x + 14 / view.k}
                  y={valve.y}
                  className="pipe-tag"
                  fontSize={11 / view.k}
                  textAnchor="start"
                  dominantBaseline="middle"
                  stroke="#f7f3ea"
                  strokeWidth={3 / view.k}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {flow}
                </text>
              )}
            </g>
          )
        })}
        {props.joinIds.map((id) => {
          const head = doc.sprinklers.find((item) => item.id === id)
          if (!head) return null
          return (
            <circle
              key={`join-${id}`}
              cx={head.x}
              cy={head.y}
              r={18 / view.k}
              className="join-head"
              strokeWidth={2 / view.k}
              pointerEvents="none"
            />
          )
        })}
        {props.selectionKind === 'sleeve' && (doc.sleeves ?? []).find((item) => item.id === props.selectionId) && (
          <>
            {(['a', 'b'] as const).map((end, index) => {
              const sleeve = (doc.sleeves ?? []).find((item) => item.id === props.selectionId)
              if (!sleeve) return null
              const point = sleeve[end]
              return (
                <circle
                  key={end}
                  data-hit="sleeve-point"
                  data-id={props.selectionId || ''}
                  data-index={index}
                  cx={point.x}
                  cy={point.y}
                  r={6 / view.k}
                  className="handle"
                />
              )
            })}
          </>
        )}
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
        {doc.source && (
          <text
            x={doc.source.x}
            y={doc.source.y - 16 / view.k}
            className="pipe-tag"
            fontSize={11 / view.k}
            textAnchor="middle"
            dominantBaseline="middle"
            stroke="#f7f3ea"
            strokeWidth={3 / view.k}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {sourceLabel(doc.source)}
          </text>
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
        {(props.alongPreview ?? []).map((head, index) => (
          <g key={`along-${index}`} pointerEvents="none" opacity={0.55}>
            <path d={coverPath(head, ppm, nozzleById(head.nozzleId))} className="cover" />
            <circle cx={head.x} cy={head.y} r={9 / view.k} className={`node${head.nozzleId.startsWith('bub') ? ' bubbler' : ''}`} />
          </g>
        ))}
        {props.placePreview && (
          <g pointerEvents="none" opacity={0.55}>
            <path d={coverPath(props.placePreview, ppm, nozzleById(props.placePreview.nozzleId))} className="cover" />
            <circle cx={props.placePreview.x} cy={props.placePreview.y} r={9 / view.k} className={`node${props.placePreview.nozzleId.startsWith('bub') ? ' bubbler' : ''}`} />
          </g>
        )}
        {selectedSprinkler && (
          <SprinklerHandles sprinkler={selectedSprinkler} ppm={ppm} k={view.k} />
        )}
        <SelectedSize doc={doc} selectionKind={props.selectionKind} selectionId={props.selectionId} ppm={ppm} k={view.k} />
      </g>
      {props.precip && (
        <g fontSize="12" fontFamily="Segoe UI, PT Sans, Arial, sans-serif">
          <rect x="12" y="12" width="228" height="86" rx="6" fill="#f7f3ea" stroke="#1c2822" />
          <text x="24" y="32" fontWeight={700}>Осадки</text>
          <rect x="24" y="42" width="14" height="10" fill="rgba(86,146,196,0.48)" stroke="#1c2822" />
          <text x="44" y="52">Мало, до 8</text>
          <rect x="24" y="58" width="14" height="10" fill="rgba(78,156,82,0.46)" stroke="#1c2822" />
          <text x="44" y="68">Норма, 8–22</text>
          <rect x="148" y="58" width="14" height="10" fill="rgba(196,84,62,0.46)" stroke="#1c2822" />
          <text x="168" y="68">Много</text>
        </g>
      )}
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
  ink,
  warn,
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
  ink: 'poly' | 'main' | 'zone' | 'drip'
  warn: boolean
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
          stroke={warn && ink === 'zone' ? '#c4a035' : ink === 'zone' ? '#2f6f97' : ink === 'drip' ? '#6b3fa0' : '#1c2822'}
          strokeWidth={(ink === 'main' ? pipeWeight('main') : ink === 'zone' ? pipeWeight('zone') : 2) / view.k}
          strokeDasharray={ink === 'drip' ? `${7 / view.k} ${5 / view.k}` : undefined}
          strokeLinecap="round"
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
  const nozzle = nozzleById(sprinkler.nozzleId)
  if (nozzle.pattern === 'strip' && nozzle.widthM && nozzle.strip) {
    const side = nozzle.strip === 'left' ? 'left' : nozzle.strip === 'right' ? 'right' : 'center'
    const forward = Math.max(ppm * (sprinkler.radiusM || 1.5), 24 / k)
    const mid = stripHandlePoint(sprinkler, sprinkler.rotationDeg, forward, nozzle.widthM * ppm, side)
    return (
      <g className="sprinkler-handles">
        <line x1={sprinkler.x} y1={sprinkler.y} x2={mid.x} y2={mid.y} className="sprinkler-ray" />
        <circle data-hit="sprinkler-rot" data-id={sprinkler.id} cx={mid.x} cy={mid.y} r={11 / k} className="handle rot-handle" />
      </g>
    )
  }
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
  return (
    <>
      {HATCHES.map((item) => {
        const tile = hatchTile(item.id, ppm)
        return (
          <pattern key={item.id} id={`fill-${item.id}`} width={tile.w} height={tile.h} patternUnits="userSpaceOnUse">
            {tile.nodes.map((node, index) => (
              <HatchMark key={index} node={node} />
            ))}
          </pattern>
        )
      })}
    </>
  )
}

function HatchMark({ node }: { node: HatchNode }) {
  if (node.kind === 'fill') return <rect x={node.x} y={node.y} width={node.w} height={node.h} fill={node.fill} />
  if (node.kind === 'dot') return <circle cx={node.cx} cy={node.cy} r={node.r} fill={node.fill} />
  if (node.kind === 'chip') {
    return (
      <ellipse
        cx={node.cx}
        cy={node.cy}
        rx={node.rx}
        ry={node.ry}
        fill={node.fill}
        transform={`rotate(${node.turn} ${node.cx} ${node.cy})`}
      />
    )
  }
  return (
    <path
      d={node.d}
      fill="none"
      stroke={node.stroke}
      strokeWidth={node.width ?? 1}
      strokeLinecap={node.cap ?? 'butt'}
    />
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
  const inked = glyph.inked ?? glyph.fills.length
  return (
    <g className={selected ? 'plant selected' : 'plant'} transform={`translate(${plant.x} ${plant.y}) rotate(${plant.rotationDeg || 0})`}>
      <g transform={`scale(${radius})`} pointerEvents="none">
        {glyph.fills.map((d, index) => (
          <path
            key={`f${index}`}
            d={d}
            fill={crownFill(paint, glyph.shade?.[index] ?? 0)}
            stroke={index < inked ? ink : 'none'}
            strokeWidth={index < inked ? 1.35 : 0}
            vectorEffect="non-scaling-stroke"
          />
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
      <g transform={`translate(${plant.x} ${plant.y}) rotate(${plant.rotationDeg || 0})`}>
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

function FlowArrowView({ arrow, k }: { arrow: FlowArrow; k: number }) {
  const scale = Math.max(k, 0.05)
  const r = 5 / scale
  return (
    <polygon
      points={`0,${-r} ${r * 0.72},${r * 0.55} ${-r * 0.72},${r * 0.55}`}
      transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.rotationDeg})`}
      fill="#1f4d6e"
      stroke="#14364c"
      strokeWidth={0.8 / scale}
      pointerEvents="none"
    />
  )
}

function FittingMarkView({ mark, k }: { mark: FittingMark; k: number }) {
  const shape = fittingShape(mark.kind, k)
  const ink = '#243028'
  const width = 1.6 / Math.max(k, 0.05)
  return (
    <g transform={`translate(${mark.x} ${mark.y}) rotate(${mark.rotationDeg})`} pointerEvents="none">
      {shape.lines.map((line, index) => (
        <line
          key={index}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={ink}
          strokeWidth={width}
          strokeLinecap="round"
        />
      ))}
      {shape.dot !== null && <circle cx={0} cy={0} r={shape.dot} fill="#f7f3ea" stroke={ink} strokeWidth={width} />}
      {shape.poly && <polygon points={shape.poly.map((point) => `${point.x},${point.y}`).join(' ')} fill={ink} />}
    </g>
  )
}

function NoteMark({ note, ppm, k, selected }: { note: Note; ppm: number; k: number; selected: boolean }) {
  const size = Math.max(note.sizeM * ppm, 8)
  const width = Math.max(size * note.text.length * 0.62, size * 2)
  const mark = note.leader ? noteLeader(note, note.leader, k) : null
  const ink = note.color || (selected ? '#8d2b1f' : '#1c2822')
  const s = 6 / k
  return (
    <g className={selected ? 'note selected' : 'note'}>
      {mark && (
        <>
          <line
            x1={mark.shaft[0].x}
            y1={mark.shaft[0].y}
            x2={mark.shaft[1].x}
            y2={mark.shaft[1].y}
            stroke={ink}
            strokeWidth={1.2 / k}
            strokeLinecap="round"
            pointerEvents="none"
          />
          <polygon points={mark.head.map((point) => `${point.x},${point.y}`).join(' ')} fill={ink} pointerEvents="none" />
        </>
      )}
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
      {selected && note.leader && (
        <rect
          data-hit="note-leader"
          data-id={note.id}
          x={note.leader.x - s}
          y={note.leader.y - s}
          width={s * 2}
          height={s * 2}
          className="handle"
        />
      )}
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
