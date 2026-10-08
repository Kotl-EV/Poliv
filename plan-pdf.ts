import { readFileSync } from 'node:fs'
import { analyze } from './shared/analyze.ts'
import { configurePdfWorker, describePlan } from './web/src/pdf/readPlan.ts'

configurePdfWorker(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href)
const file = process.argv[2]
const bytes = new Uint8Array(readFileSync(file))
const plan = await describePlan(bytes)
console.log(plan.note)
console.log('ppm', plan.doc?.pxPerMeter)
if (!plan.doc) process.exit(0)
const doc = plan.doc
const analysis = analyze(doc)
console.log('zones', analysis.zones.map((zone) => `${zone.kind} ${zone.areaM2?.toFixed(0)}м² ${zone.precipMmH?.toFixed(1) ?? '-'}`).join(' | '))
console.log('heads', doc.sprinklers.length, 'valves', doc.valves.length, 'drips', doc.drips.length)
console.log('flow', Math.round(analysis.totalFlowLph), 'sim', Math.round(analysis.connectedFlowLph), 'program', analysis.programMin?.toFixed(0))
console.log('warnings', analysis.warnings.slice(0, 8))
console.log('pipes', analysis.pipes.map((row) => `${row.name} ${row.lengthM.toFixed(0)}м`).join(', '))
