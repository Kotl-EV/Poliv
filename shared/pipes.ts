/** Внутренние диаметры ПЭ по SDR. Шероховатость 0,005 мм. */

import type { PipeRole, Source } from './types.ts'

/** Толщина линии на экране, в пикселях до деления на масштаб вида. */
export function pipeWeight(role: PipeRole): number {
  return role === 'main' ? 6.4 : 3.2
}

export const V_MAX = 1.5
export const ROUGHNESS_MM = 0.005
export const MIN_SPRINKLER_BAR = 2

const RHO = 999
const MU = 1.14e-3
const G = 9.80665

export type PipeSeriesId = 'sdr9' | 'sdr11' | 'sdr136' | 'sdr17' | 'sdr176'

export type PipeSize = {
  odMm: number
  idMm: number
  name: string
}

export type PipeSeries = {
  id: PipeSeriesId
  name: string
  sizes: PipeSize[]
}

const TABLES: [PipeSeriesId, string, [number, number][]][] = [
  ['sdr9', 'ПЭ SDR 9', [[16, 12], [20, 15.4], [25, 19.4], [32, 24.8], [40, 31], [50, 38.8], [63, 48.8], [75, 58.2], [90, 69.8], [110, 85.4], [125, 97], [140, 108.6], [160, 124.2], [180, 139.8], [200, 155.2], [225, 174.6], [250, 194.2]]],
  ['sdr11', 'ПЭ SDR 11', [[20, 16], [25, 20.4], [32, 26], [40, 32.6], [50, 40.8], [63, 51.4], [75, 61.4], [90, 73.6], [110, 90], [125, 102.2], [140, 114.6], [160, 130.8], [180, 147.2], [200, 163.6], [225, 184], [250, 204.6]]],
  ['sdr136', 'ПЭ SDR 13,6', [[25, 21], [32, 27.2], [40, 34], [50, 42.6], [63, 53.6], [75, 63.8], [90, 76.6], [110, 93.8], [125, 106.6], [140, 119.4], [160, 136.4], [180, 153.4], [200, 170.6], [225, 191.8], [250, 213.2]]],
  ['sdr17', 'ПЭ SDR 17', [[32, 28], [40, 35.2], [50, 44], [63, 55.4], [75, 66], [90, 79.2], [110, 96.8], [125, 110.2], [140, 123.4], [160, 141], [180, 158.6], [200, 176.2], [225, 198.2], [250, 220.4]]],
  ['sdr176', 'ПЭ SDR 17,6', [[40, 35.4], [50, 44.2], [63, 55.8], [75, 66.4], [90, 79.8], [110, 97.4], [125, 110.8], [140, 124], [160, 141.8], [180, 159.6], [200, 177.2], [225, 199.4], [250, 221.6]]],
]

export const DEFAULT_SERIES: PipeSeriesId = 'sdr11'

export const SERIES: PipeSeries[] = TABLES.map(([id, name, rows]) => ({
  id,
  name,
  sizes: rows.map(([odMm, idMm]) => ({ odMm, idMm, name: `ПЭ ${odMm}` })),
}))

export function seriesById(id: string): PipeSeries {
  return SERIES.find((item) => item.id === id) ?? SERIES[1]
}

export function velocityMs(flowLph: number, idMm: number): number {
  if (flowLph <= 0 || idMm <= 0) return 0
  const q = flowLph / 3_600_000
  const radiusM = idMm / 1000 / 2
  const area = Math.PI * radiusM * radiusM
  return q / area
}

export function pickPipe(flowLph: number, seriesId: string): { pipe: PipeSize; velocity: number; overspeed: boolean } {
  const series = seriesById(seriesId)
  for (const pipe of series.sizes) {
    const velocity = velocityMs(flowLph, pipe.idMm)
    if (velocity <= V_MAX + 1e-6) return { pipe, velocity, overspeed: false }
  }
  const pipe = series.sizes[series.sizes.length - 1]
  return { pipe, velocity: velocityMs(flowLph, pipe.idMm), overspeed: true }
}

/** Потери напора по Дарси–Вейсбаху, вода 15 °C, шероховатость 0,005 мм. */
export function headLossM(flowLph: number, idMm: number, lengthM: number): number {
  if (flowLph <= 0 || idMm <= 0 || lengthM <= 0) return 0
  const q = flowLph / 3_600_000
  const d = idMm / 1000
  const velocity = q / (Math.PI * d * d / 4)
  const re = (RHO * velocity * d) / MU
  if (re < 1) return 0
  const friction = re < 2300
    ? 64 / re
    : 0.25 / Math.log10((ROUGHNESS_MM / 1000) / (3.7 * d) + 5.74 / re ** 0.9) ** 2
  return friction * (lengthM / d) * (velocity * velocity) / (2 * G)
}

export function barToHeadM(bar: number): number {
  return (bar * 1e5) / (RHO * G)
}

export function headMToBar(headM: number): number {
  return (headM * RHO * G) / 1e5
}

/** Остаток у головки, одна цифра после запятой: «2,9 бар». */
export function pressureLabel(bar: number): string {
  return `${bar.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} бар`
}

/** Расход станции у знака клапана: «360 л/ч». */
export function valveFlowLabel(flowLph: number): string {
  return `${Math.round(flowLph).toLocaleString('ru-RU')} л/ч`
}

/** Давление источника. Лимит ведра дописывается, когда он задан: «2,5 бар · 900 л/ч». */
export function sourceLabel(source: Pick<Source, 'pressureBar' | 'flowLimitLph'>): string {
  const pressure = `${source.pressureBar.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} бар`
  if (source.flowLimitLph === null || !(source.flowLimitLph > 0)) return pressure
  return `${pressure} · ${Math.round(source.flowLimitLph).toLocaleString('ru-RU')} л/ч`
}
