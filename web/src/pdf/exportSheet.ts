import { pdfFromJpegPages } from '@shared/pdf.ts'
import { buildSheetPages, type PaperId, type SheetLayers, type SheetPage } from '@shared/sheet.ts'
import type { Analysis, Doc } from '@shared/types.ts'

export async function exportProjectSheets(opts: {
  doc: Doc
  analysis: Analysis
  title: string
  paper: PaperId
  layers: SheetLayers
  includeSpec: boolean
  underlayUrl?: string | null
  imageSize?: { w: number; h: number } | null
  format: 'pdf' | 'png'
}): Promise<void> {
  let underlay: { href: string; w: number; h: number } | null = null
  if (opts.layers.underlay && opts.underlayUrl && opts.imageSize) {
    try {
      underlay = { href: await asDataUrl(opts.underlayUrl), w: opts.imageSize.w, h: opts.imageSize.h }
    } catch {
      underlay = null
    }
  }
  const pages = buildSheetPages(opts.doc, opts.analysis, {
    title: opts.title,
    paper: opts.paper,
    layers: opts.layers,
    underlay,
    includeSpec: opts.format === 'pdf' && opts.includeSpec,
    date: today(),
  })
  const file = sanitize(opts.title) || 'poliv'
  if (opts.format === 'png') {
    const png = await rasterSvg(pages[0])
    saveBlob(png, `${file}-схема.png`)
    return
  }
  const jpegPages = []
  for (const page of pages) {
    const jpeg = new Uint8Array(await (await rasterSvg(page, 'image/jpeg')).arrayBuffer())
    jpegPages.push({
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      pixelWidth: page.widthPx,
      pixelHeight: page.heightPx,
      jpeg,
    })
  }
  const pdf = pdfFromJpegPages(jpegPages)
  const bytes = new ArrayBuffer(pdf.byteLength)
  new Uint8Array(bytes).set(pdf)
  saveBlob(new Blob([bytes], { type: 'application/pdf' }), `${file}.pdf`)
}

async function rasterSvg(page: SheetPage, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const blob = new Blob([page.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = page.widthPx
    canvas.height = page.heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, page.widthPx, page.heightPx)
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('blob'))), type, 0.92)
    })
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('svg'))
    image.src = src
  })
}

async function asDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('underlay')
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('underlay'))
    reader.readAsDataURL(blob)
  })
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 80)
}

function today(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
