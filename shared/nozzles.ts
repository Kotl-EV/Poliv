export type Nozzle = {
  id: string
  name: string
  radiusM: number
  arcDeg: number
  flowLph: number
}

/** Свои типы форсунок. Чужие каталоги производителей сюда не копируются. */
export const NOZZLES: Nozzle[] = [
  { id: 'fan90', name: 'Веер 90°', radiusM: 4.5, arcDeg: 90, flowLph: 180 },
  { id: 'fan180', name: 'Веер 180°', radiusM: 4.5, arcDeg: 180, flowLph: 360 },
  { id: 'fan360', name: 'Веер 360°', radiusM: 4.5, arcDeg: 360, flowLph: 720 },
  { id: 'rotor', name: 'Ротор', radiusM: 10, arcDeg: 180, flowLph: 840 },
]

export function nozzleById(id: string): Nozzle {
  return NOZZLES.find((item) => item.id === id) ?? NOZZLES[1]
}
