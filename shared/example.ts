import type { Doc } from './types.ts'

/** Участок 13,2 × 8,8 м. Четыре веера по 360 л/ч, магистраль от источника слева. */
export function exampleDoc(): Doc {
  return {
    version: 1,
    pxPerMeter: 50,
    pipeSeries: 'sdr11',
    zones: [
      {
        id: 'zone-lawn',
        name: 'Газон',
        kind: 'lawn',
        doseMm: 6,
        soil: 'loam',
        slope: 'flat',
        climate: 'open',
        points: [
          { x: 100, y: 80 },
          { x: 760, y: 80 },
          { x: 760, y: 520 },
          { x: 100, y: 520 },
        ],
      },
    ],
    source: { x: 40, y: 300, pressureBar: 3, flowLimitLph: null },
    valves: [],
    drips: [],
    trench: { widthM: 0.3, depthM: 0.4 },
    pipes: [
      { id: 'pipe-main', points: [{ x: 40, y: 300 }, { x: 200, y: 300 }, { x: 450, y: 300 }, { x: 700, y: 300 }] },
      { id: 'pipe-n1', points: [{ x: 200, y: 300 }, { x: 200, y: 150 }] },
      { id: 'pipe-s1', points: [{ x: 200, y: 300 }, { x: 200, y: 450 }] },
      { id: 'pipe-n2', points: [{ x: 450, y: 300 }, { x: 450, y: 150 }] },
      { id: 'pipe-s3', points: [{ x: 700, y: 300 }, { x: 700, y: 450 }] },
    ],
    sprinklers: [
      { id: 's1', nozzleId: 'fan180', x: 200, y: 150, radiusM: 4.5, arcDeg: 180, rotationDeg: 180, flowLph: 360 },
      { id: 's2', nozzleId: 'fan180', x: 450, y: 150, radiusM: 4.5, arcDeg: 180, rotationDeg: 180, flowLph: 360 },
      { id: 's3', nozzleId: 'fan180', x: 700, y: 450, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
      { id: 's4', nozzleId: 'fan180', x: 200, y: 450, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    ],
  }
}
