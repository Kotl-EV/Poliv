/** JPEG pages → PDF 1.4. JPEG is native in PDF, so Cyrillic on the drawing stays in the raster. */

export type PdfJpegPage = {
  widthPt: number
  heightPt: number
  pixelWidth: number
  pixelHeight: number
  jpeg: Uint8Array
}

export function pdfFromJpegPages(pages: PdfJpegPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('empty pdf')
  const objects: Uint8Array[] = []
  const offsets: number[] = []
  const add = (body: Uint8Array) => {
    offsets.push(objects.reduce((sum, part) => sum + part.length, 0))
    objects.push(body)
  }

  const header = enc('%PDF-1.4\n')
  const kids: number[] = []
  let nextId = 3
  const chunks: { id: number; bytes: Uint8Array }[] = []

  for (const page of pages) {
    const imgId = nextId++
    const contentId = nextId++
    const pageId = nextId++
    kids.push(pageId)
    const content = enc(`q\n${fmt(page.widthPt)} 0 0 ${fmt(page.heightPt)} 0 0 cm\n/Im${imgId} Do\nQ\n`)
    chunks.push({
      id: imgId,
      bytes: obj(
        imgId,
        enc(
          `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
        ),
        page.jpeg,
        enc('\nendstream\n'),
      ),
    })
    chunks.push({
      id: contentId,
      bytes: obj(contentId, enc(`<< /Length ${content.length} >>\nstream\n`), content, enc('endstream\n')),
    })
    chunks.push({
      id: pageId,
      bytes: obj(
        pageId,
        enc(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.widthPt)} ${fmt(page.heightPt)}] /Resources << /XObject << /Im${imgId} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\n`,
        ),
      ),
    })
  }

  chunks.sort((a, b) => a.id - b.id)
  add(obj(1, enc('<< /Type /Catalog /Pages 2 0 R >>\n')))
  add(obj(2, enc(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\n`)))
  for (const chunk of chunks) add(chunk.bytes)

  const body = concat(objects)
  const xrefAt = header.length + body.length
  const xref = ['xref', `0 ${nextId}`, '0000000000 65535 f ']
  for (const offset of offsets) xref.push(`${String(header.length + offset).padStart(10, '0')} 00000 n `)
  const tail = enc(
    `${xref.join('\n')}\ntrailer << /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  )
  return concat([header, body, tail])
}

function obj(id: number, ...parts: Uint8Array[]): Uint8Array {
  return concat([enc(`${id} 0 obj\n`), ...parts, enc('endobj\n')])
}

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}
