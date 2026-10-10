import type { Analysis, Doc, Program } from './types.ts'

export type { Program }

/** 0 — понедельник … 6 — воскресенье. */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const DEFAULT_PROGRAM: Program = { days: [0, 2, 4], startHour: 6, startMin: 0 }

const DAY = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function programOf(doc: { program?: Program | null }): Program {
  return doc.program ?? DEFAULT_PROGRAM
}

export function withProgram(current: Program, patch: Partial<Program>): Program {
  const days = [...new Set((patch.days ?? current.days).filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
  let startHour = patch.startHour ?? current.startHour
  let startMin = patch.startMin ?? current.startMin
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) startHour = current.startHour
  if (!Number.isInteger(startMin) || startMin < 0 || startMin > 59) startMin = current.startMin
  return { days, startHour, startMin }
}

/** Пустое поле — нет программы. Битый объект отвергает документ. */
export function parseProgram(value: unknown): Program | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') return null
  const raw = value as { days?: unknown; startHour?: unknown; startMin?: unknown }
  if (!Array.isArray(raw.days) || raw.days.length > 7) return null
  const days: Weekday[] = []
  for (const day of raw.days) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return null
    if (!days.includes(day as Weekday)) days.push(day as Weekday)
  }
  days.sort((a, b) => a - b)
  if (typeof raw.startHour !== 'number' || !Number.isInteger(raw.startHour) || raw.startHour < 0 || raw.startHour > 23) return null
  if (typeof raw.startMin !== 'number' || !Number.isInteger(raw.startMin) || raw.startMin < 0 || raw.startMin > 59) return null
  return { days, startHour: raw.startHour, startMin: raw.startMin }
}

/** Литры и секунды ведра → лимит источника, л/ч. */
export function bucketLph(litres: number, seconds: number): number | null {
  if (!(litres > 0) || litres > 1000 || !(seconds > 0) || seconds > 3600) return null
  const flow = (litres / seconds) * 3600
  if (!(flow > 0) || flow > 1_000_000) return null
  return Math.round(flow)
}

function cyclesWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'цикл'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'цикла'
  return 'циклов'
}

/** Подпись на плане: «12 мин» или «12 мин · 2 цикла». */
export function runtimeLabel(runtimeMin: number | null, cycles: number | null): string | null {
  if (runtimeMin === null) return null
  const mins = runtimeMin.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  if (cycles !== null && cycles > 1) return `${mins} мин · ${cycles} ${cyclesWord(cycles)}`
  return `${mins} мин`
}

function slotMin(runtimeMin: number | null, cycles: number | null, soakMin: number): number | null {
  if (runtimeMin === null || cycles === null) return null
  if (cycles <= 1) return runtimeMin
  return runtimeMin + (cycles - 1) * soakMin
}

function clock(totalMin: number): string {
  const day = Math.floor(totalMin / (24 * 60))
  const mins = ((Math.round(totalMin) % (24 * 60)) + 24 * 60) % (24 * 60)
  const text = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return day > 0 ? `${text} +${day} сут` : text
}

function ru(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

export type ProgramLine = { name: string; when: string; note: string }

/** Дни, старт и очередь станций. Станции идут друг за другом, пауза цикла входит в станцию. */
export function programTable(doc: Pick<Doc, 'program'>, analysis: Pick<Analysis, 'programMin' | 'clockMin' | 'stations'>): { lines: ProgramLine[] } | null {
  if (analysis.programMin === null && analysis.stations.length === 0) return null
  const program = programOf(doc)
  const days = program.days.length ? program.days.map((day) => DAY[day]).join(', ') : 'ни одного дня'
  const start = clock(program.startHour * 60 + program.startMin)
  const lines: ProgramLine[] = [{ name: days, when: `старт ${start}`, note: '' }]
  let cursor = program.startHour * 60 + program.startMin
  if (analysis.stations.length === 0) {
    const span = analysis.clockMin ?? analysis.programMin
    lines.push({
      name: 'Вся сеть',
      when: span === null ? '—' : `${clock(cursor)}–${clock(cursor + span)}`,
      note: analysis.programMin === null ? '' : `${ru(analysis.programMin)} мин`,
    })
  } else {
    for (const station of analysis.stations) {
      const span = slotMin(station.runtimeMin, station.cycles, station.soakMin)
      const bits: string[] = []
      if (station.runtimeMin !== null) bits.push(`${ru(station.runtimeMin)} мин`)
      if (station.cycles !== null && station.cycles > 1) bits.push(`${station.cycles} ${cyclesWord(station.cycles)}, пауза ${station.soakMin} мин`)
      lines.push({
        name: station.name,
        when: span === null ? '—' : `${clock(cursor)}–${clock(cursor + span)}`,
        note: bits.join(' · '),
      })
      if (span !== null) cursor += span
    }
  }
  const total = analysis.clockMin ?? analysis.programMin
  if (total !== null) lines.push({ name: 'Вместе', when: `${ru(total)} мин`, note: '' })
  return { lines }
}
