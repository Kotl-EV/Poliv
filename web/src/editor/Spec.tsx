import { asClimate, asSlope, asSoil, defaultDose } from '@shared/doc.ts'
import { dist } from '@shared/geom.ts'
import { sleeveLengthM } from '@shared/join.ts'
import { SURFACES } from '@shared/landscape.ts'
import type { Analysis, Doc, Drip, PipeRole, Source, Sprinkler, Valve, Zone } from '@shared/types.ts'
import { nozzleById, nozzlesOf, type NozzleKind } from '@shared/nozzles.ts'
import { SERIES, seriesById, type PipeSeriesId } from '@shared/pipes.ts'

const KIND = Object.fromEntries(SURFACES.map((item) => [item.id, item.label])) as Record<string, string>

function cyclesWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'цикл'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'цикла'
  return 'циклов'
}

function cycleText(cycles: number | null): string {
  if (cycles === null || cycles <= 1) return ''
  return ` · ${cycles} ${cyclesWord(cycles)}`
}

function programText(analysis: Analysis): string {
  const head = analysis.stations.length > 0 ? 'Станции друг за другом' : 'Один запуск'
  const open = meters(analysis.programMin, 1)
  const pause = analysis.clockMin !== null && analysis.programMin !== null ? analysis.clockMin - analysis.programMin : 0
  if (pause > 0.05) return `${head}: ${open} мин полива, вместе с паузами ${meters(analysis.clockMin, 0)} мин.`
  return `${head}: ${open} мин.`
}

function meters(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

export function Spec({
  doc,
  analysis,
  selection,
  onZone,
  onSprinkler,
  onSource,
  onValve,
  onDrip,
  onSeries,
  onTrench,
  onPipe,
  onBox,
  onDelete,
}: {
  doc: Doc
  analysis: Analysis
  selection: { kind: string; id?: string } | null
  onZone: (id: string, patch: Partial<Zone>) => void
  onSprinkler: (id: string, patch: Partial<Sprinkler>) => void
  onSource: (patch: Partial<Source>) => void
  onValve: (id: string, patch: Partial<Valve>) => void
  onDrip: (id: string, patch: Partial<Drip>) => void
  onPipe: (id: string, role: PipeRole) => void
  onBox: (id: string, name: string) => void
  onSeries: (id: PipeSeriesId) => void
  onTrench: (patch: Partial<Doc['trench']>) => void
  onDelete: () => void
}) {
  const zone = selection?.kind === 'zone' ? doc.zones.find((item) => item.id === selection.id) : undefined
  const zoneRow = zone ? analysis.zones.find((item) => item.id === zone.id) : undefined
  const sprinkler = selection?.kind === 'sprinkler' ? doc.sprinklers.find((item) => item.id === selection.id) : undefined
  const pipe = selection?.kind === 'pipe' ? doc.pipes.find((item) => item.id === selection.id) : undefined
  const pipeSegments = pipe ? analysis.segments.filter((item) => item.pipeId === pipe.id) : []
  const valve = selection?.kind === 'valve' ? doc.valves.find((item) => item.id === selection.id) : undefined
  const box = selection?.kind === 'box' ? (doc.boxes ?? []).find((item) => item.id === selection.id) : undefined
  const hydrant = selection?.kind === 'hydrant' ? (doc.hydrants ?? []).find((item) => item.id === selection.id) : undefined
  const sleeve = selection?.kind === 'sleeve' ? (doc.sleeves ?? []).find((item) => item.id === selection.id) : undefined
  const drip = selection?.kind === 'drip' ? doc.drips.find((item) => item.id === selection.id) : undefined
  const sleeves = doc.sleeves ?? []
  const sleeveM = sleeveLengthM(sleeves, doc.pxPerMeter)
  const oneSleeveM = sleeve && doc.pxPerMeter ? dist(sleeve.a, sleeve.b) / doc.pxPerMeter : null

  return (
    <aside className="spec">
      {zone && (
        <div className="props">
          <h2>Зона</h2>
          <label>
            Название
            <input value={zone.name} onChange={(event) => onZone(zone.id, { name: event.target.value })} />
          </label>
          <label>
            Тип
            <select
              value={zone.kind}
              onChange={(event) => {
                const kind = event.target.value as Zone['kind']
                onZone(zone.id, { kind, doseMm: defaultDose(kind) })
              }}
            >
              {SURFACES.map((surface) => (
                <option key={surface.id} value={surface.id}>{surface.label}</option>
              ))}
            </select>
          </label>
          <label>
            Норма, мм
            <input type="number" min={0} max={40} step={1} value={zone.doseMm} onChange={(event) => onZone(zone.id, { doseMm: Number(event.target.value) })} />
          </label>
          <label>
            Микроклимат
            <select aria-label="Микроклимат" value={zone.climate} onChange={(event) => onZone(zone.id, { climate: asClimate(event.target.value) })}>
              <option value="shade">Тень</option>
              <option value="open">Открытый</option>
              <option value="wind">Ветер</option>
            </select>
          </label>
          {zoneRow && Math.abs(zoneRow.appliedMm - zone.doseMm) > 0.05 && <p>К поливу {meters(zoneRow.appliedMm, 1)} мм.</p>}
          <label>
            Почва
            <select aria-label="Почва" value={zone.soil} onChange={(event) => onZone(zone.id, { soil: asSoil(event.target.value) })}>
              <option value="sand">Песок</option>
              <option value="loam">Суглинок</option>
              <option value="clay">Глина</option>
            </select>
          </label>
          <label>
            Уклон
            <select aria-label="Уклон" value={zone.slope} onChange={(event) => onZone(zone.id, { slope: asSlope(event.target.value) })}>
              <option value="flat">Ровный</option>
              <option value="mild">Слабый</option>
              <option value="steep">Крутой</option>
            </select>
          </label>
          <button className="ghost" onClick={onDelete}>Удалить зону</button>
        </div>
      )}
      {sprinkler && (
        <div className="props">
          <h2>Дождеватель</h2>
          <label>
            Форсунка
            <select
              value={sprinkler.nozzleId}
              onChange={(event) => {
                const nozzle = nozzleById(event.target.value)
                onSprinkler(sprinkler.id, {
                  nozzleId: nozzle.id,
                  radiusM: nozzle.radiusM,
                  arcDeg: nozzle.arcDeg,
                  flowLph: nozzle.flowLph,
                })
              }}
            >
              {(['fan', 'rotator', 'rotor', 'bubbler'] as NozzleKind[]).map((kind) => (
                <optgroup key={kind} label={kind === 'fan' ? 'Веер' : kind === 'rotator' ? 'Ротатор' : kind === 'rotor' ? 'Ротор' : 'Баблер'}>
                  {nozzlesOf(kind).map((nozzle) => (
                    <option key={nozzle.id} value={nozzle.id}>{nozzle.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Радиус, м
            <input type="number" min={0.3} max={30} step={0.1} value={sprinkler.radiusM} onChange={(event) => onSprinkler(sprinkler.id, { radiusM: Number(event.target.value) })} />
          </label>
          <label>
            Сектор, °
            <input type="number" min={1} max={360} value={sprinkler.arcDeg} onChange={(event) => onSprinkler(sprinkler.id, { arcDeg: Number(event.target.value) })} />
          </label>
          <label>
            Поворот, °
            <input type="number" min={0} max={359} value={Math.round(sprinkler.rotationDeg)} onChange={(event) => onSprinkler(sprinkler.id, { rotationDeg: Number(event.target.value) })} />
          </label>
          <p className="hint">На схеме: круглая ручка на дуге крутит сектор, квадраты по краям меняют угол. Shift — шаг 15°.</p>
          <label>
            Расход, л/ч
            <input type="number" min={0} max={20000} value={sprinkler.flowLph} onChange={(event) => onSprinkler(sprinkler.id, { flowLph: Number(event.target.value) })} />
          </label>
          <button className="ghost" onClick={onDelete}>Удалить</button>
        </div>
      )}
      {selection?.kind === 'source' && doc.source && (
        <div className="props">
          <h2>Источник</h2>
          <label>
            Давление, бар
            <input type="number" min={0.2} max={16} step={0.1} value={doc.source.pressureBar} onChange={(event) => onSource({ pressureBar: Number(event.target.value) })} />
          </label>
          <label>
            Лимит расхода, л/ч
            <input
              type="number"
              min={1}
              step={10}
              placeholder="без лимита"
              value={doc.source.flowLimitLph ?? ''}
              onChange={(event) => onSource({ flowLimitLph: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <button className="ghost" onClick={onDelete}>Убрать источник</button>
        </div>
      )}
      {valve && (
        <div className="props">
          <h2>Клапан</h2>
          <label>
            Название
            <input value={valve.name} onChange={(event) => onValve(valve.id, { name: event.target.value })} />
          </label>
          <p>Станция за этим клапаном поливается отдельно.</p>
          <button className="ghost" onClick={onDelete}>Удалить клапан</button>
        </div>
      )}
      {box && (
        <div className="props">
          <h2>Клапанный бокс</h2>
          <label>
            Название
            <input value={box.name} aria-label="Название бокса" onChange={(event) => onBox(box.id, event.target.value)} />
          </label>
          <p>Клапаны в боксе остаются разными станциями. Зональную трубу начинайте с ромба нужного клапана.</p>
          <button className="ghost" onClick={onDelete}>Удалить бокс</button>
        </div>
      )}
      {hydrant && (
        <div className="props">
          <h2>Гидрант</h2>
          <p>На узле трубы гидрант попадает в фитинги и занимает этот конец.</p>
          <button className="ghost" onClick={onDelete}>Удалить гидрант</button>
        </div>
      )}
      {sleeve && (
        <div className="props">
          <h2>Гильза</h2>
          <p>{oneSleeveM === null ? 'Длина появится после масштаба.' : `Длина ${meters(oneSleeveM)} м.`}</p>
          <button className="ghost" onClick={onDelete}>Удалить гильзу</button>
        </div>
      )}
      {drip && (
        <div className="props">
          <h2>Капельная трубка</h2>
          <label>
            Шаг капельниц, м
            <input type="number" min={0.05} max={2} step={0.05} value={drip.spacingM} onChange={(event) => onDrip(drip.id, { spacingM: Number(event.target.value) })} />
          </label>
          <label>
            Расход капельницы, л/ч
            <input type="number" min={0.2} max={40} step={0.1} value={drip.emitterLph} onChange={(event) => onDrip(drip.id, { emitterLph: Number(event.target.value) })} />
          </label>
          <button className="ghost" onClick={onDelete}>Удалить трубку</button>
        </div>
      )}
      {pipe && (
        <div className="props">
          <h2>{pipe.role === 'zone' ? 'Зональная труба' : 'Магистраль'}</h2>
          <div className="hatch-row">
            <button className={pipe.role === 'zone' ? 'tool' : 'tool active'} onClick={() => onPipe(pipe.id, 'main')}>Магистраль</button>
            <button className={pipe.role === 'zone' ? 'tool active' : 'tool'} onClick={() => onPipe(pipe.id, 'zone')}>Зональная</button>
          </div>
          <ul className="plain">
            {pipeSegments.map((segment, index) => (
              <li key={index}>
                {segment.name ?? 'без диаметра'} · {meters(segment.flowLph, 0)} л/ч
                {segment.velocity !== null ? ` · ${segment.velocity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м/с` : ''}
                {segment.headLossM !== null ? ` · ${meters(segment.headLossM, 2)} м` : ''}
              </li>
            ))}
          </ul>
          <button className="ghost" onClick={onDelete}>Удалить трубу</button>
        </div>
      )}

      <h2>Спецификация</h2>
      <label>
        Ряд труб
        <select value={doc.pipeSeries} aria-label="Ряд труб в спецификации" onChange={(event) => onSeries(event.target.value as PipeSeriesId)}>
          {SERIES.map((series) => (
            <option key={series.id} value={series.id}>{series.name}</option>
          ))}
        </select>
      </label>
      {analysis.warnings.map((warning) => (
        <p key={warning} className="warn">{warning}</p>
      ))}
      <h3>Зоны</h3>
      <table>
        <tbody>
          {analysis.zones.length === 0 && <tr><td>Зон нет</td></tr>}
          {analysis.zones.map((zone) => (
            <tr key={zone.id}>
              <td>{zone.name}</td>
              <td>{KIND[zone.kind]}</td>
              <td>
                {meters(zone.areaM2)} м²
                {zone.precipMmH !== null ? ` · ${meters(zone.precipMmH)} мм/ч` : ''}
                {` · ${meters(zone.doseMm, 0)} мм`}
                {Math.abs(zone.appliedMm - zone.doseMm) > 0.05 ? ` · к поливу ${meters(zone.appliedMm, 1)} мм` : ''}
                {zone.runtimeMin !== null ? ` · ${meters(zone.runtimeMin, 1)} мин` : ''}
                {cycleText(zone.cycles)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Дождеватели</h3>
      <table>
        <tbody>
          {analysis.nozzles.length === 0 && <tr><td>Дождевателей нет</td></tr>}
          {analysis.nozzles.map((row) => (
            <tr key={row.nozzleId}>
              <td>{row.name}</td>
              <td>{row.count} шт.</td>
              <td>{meters(row.flowLph, 0)} л/ч</td>
            </tr>
          ))}
          <tr>
            <td>В сети</td>
            <td />
            <td>{meters(analysis.connectedFlowLph, 0)} л/ч</td>
          </tr>
          {analysis.totalFlowLph !== analysis.connectedFlowLph && (
            <tr>
              <td>Установлено</td>
              <td />
              <td>{meters(analysis.totalFlowLph, 0)} л/ч</td>
            </tr>
          )}
        </tbody>
      </table>
      <h3>Трубы</h3>
      <table>
        <tbody>
          {analysis.pipes.length === 0 && <tr><td>Диаметры появятся, когда источник стоит на трубе</td></tr>}
          {analysis.pipes.map((row) => (
            <tr key={row.odMm}>
              <td>{row.name}</td>
              <td>{meters(row.lengthM)} м</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Траншея</h3>
      <label>
        Ширина, м
        <input
          type="number"
          min={0.1}
          max={1.2}
          step={0.05}
          aria-label="Ширина траншеи"
          value={doc.trench.widthM}
          onChange={(event) => onTrench({ widthM: Number(event.target.value) })}
        />
      </label>
      <label>
        Глубина, м
        <input
          type="number"
          min={0.15}
          max={1.5}
          step={0.05}
          aria-label="Глубина траншеи"
          value={doc.trench.depthM}
          onChange={(event) => onTrench({ depthM: Number(event.target.value) })}
        />
      </label>
      <table>
        <tbody>
          <tr>
            <td>Длина</td>
            <td>{analysis.trench.lengthM === null ? '—' : `${meters(analysis.trench.lengthM)} м`}</td>
          </tr>
          <tr>
            <td>Объём</td>
            <td>{analysis.trench.volumeM3 === null ? '—' : `${meters(analysis.trench.volumeM3, 2)} м³`}</td>
          </tr>
        </tbody>
      </table>
      {analysis.tails.length > 0 && (
        <>
          <h3>Гибкие хвосты</h3>
          <table>
            <tbody>
              <tr>
                <td>Количество</td>
                <td>{analysis.tails.length} шт.</td>
              </tr>
              <tr>
                <td>Длина</td>
                <td>{meters(analysis.tails.reduce((sum, tail) => sum + tail.lengthM, 0))} м</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <h3>Клапаны</h3>
      <table>
        <tbody>
          {doc.valves.length === 0 && <tr><td>Клапанов нет, вся сеть поливается сразу</td></tr>}
          {doc.valves.map((item) => {
            const station = analysis.stations.find((row) => row.id === item.id)
            return (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  {station
                    ? `${meters(station.flowLph, 0)} л/ч${station.runtimeMin ? ` · ${meters(station.runtimeMin, 1)} мин` : ''}${cycleText(station.cycles)}`
                    : 'не на трубе'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {analysis.programMin !== null && (
        <p className="note">{programText(analysis)}</p>
      )}
      <h3>Капля</h3>
      <table>
        <tbody>
          {doc.drips.length === 0 && <tr><td>Капельной трубки нет</td></tr>}
          {doc.drips.length > 0 && (
            <>
              <tr>
                <td>Трубка</td>
                <td>{meters(analysis.drips.lengthM)} м</td>
              </tr>
              <tr>
                <td>Капельницы</td>
                <td>{analysis.drips.emitters} шт.</td>
              </tr>
              <tr>
                <td>Расход</td>
                <td>{meters(analysis.drips.flowLph, 0)} л/ч</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {sleeves.length > 0 && (
        <>
          <h3>Гильзы</h3>
          <table>
            <tbody>
              <tr>
                <td>Количество</td>
                <td>{sleeves.length} шт.</td>
              </tr>
              <tr>
                <td>Длина</td>
                <td>{sleeveM === null ? '—' : `${meters(sleeveM)} м`}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {(doc.boxes ?? []).length > 0 && <p className="note">Клапанных боксов: {(doc.boxes ?? []).length}. Клапаны внутри остаются разными станциями.</p>}
      {(doc.hydrants ?? []).length > 0 && <p className="note">Гидрантов на чертеже: {(doc.hydrants ?? []).length}. В фитингах они считаются, когда стоят на трубе.</p>}
      <h3>Фитинги</h3>
      <table>
        <tbody>
          {analysis.fittings.length === 0 && <tr><td>Фитинги появятся на узлах сети</td></tr>}
          {analysis.fittings.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.count} шт.</td>
            </tr>
          ))}
        </tbody>
      </table>
      {analysis.minResidualHeadM !== null && (
        <p className="note">
          Остаток на дальнем дождевателе {meters(analysis.minResidualHeadM, 1)} м
          {analysis.sourceHeadM !== null ? ` из ${meters(analysis.sourceHeadM, 1)} м на источнике` : ''}.
        </p>
      )}
      <p className="note">
        Диаметр берётся из ряда {seriesById(doc.pipeSeries).name}: скорость воды не выше 1,5 м/с.
        Потери напора считаются по Дарси–Вейсбаху, шероховатость 0,005 мм, вода 15 °C.
        На дождевателе нужно не меньше 2 бар. Осадки зоны — расход внутри неё, делённый на площадь.
        Клапаны пускают станции по очереди, магистраль берёт самую большую. Норма зоны делится на осадки и даёт минуты полива: станция берёт самую долгую свою зону.
        Микроклимат умножает норму: тень на 0,7, открытый участок на 1, ветер на 1,3.
        Впитывание почвы: песок 25 мм/ч, суглинок 12, глина 5. Слабый уклон оставляет три четверти, крутой — половину. Если осадки выше, полив делится на циклы с паузой 15, 30 или 45 минут.
        Траншея идёт по напорным трубам: длина умножается на ширину и глубину. Фитинги считаются по узлам: тройник, угол, крестовина, переход и заглушка.
      </p>
    </aside>
  )
}
