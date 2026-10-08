import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const pdf = readFileSync('C:/Users/Kotl/Downloads/Telegram Desktop/для  автополива.pdf')
const lib = readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.mjs')
const worker = readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
const html = `<!doctype html><body style="margin:0"><canvas id="c"></canvas><pre id="err"></pre>
<script type="module">
import * as pdfjs from '/pdf.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'
try {
  const data = new Uint8Array(await (await fetch('/sheet.pdf')).arrayBuffer())
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const pg = await doc.getPage(1)
  const base = pg.getViewport({ scale: 1 })
  const scale = Math.min(1.5, 1200 / Math.max(base.width, base.height))
  const vp = pg.getViewport({ scale })
  const canvas = document.getElementById('c')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pg.render({ canvasContext: ctx, viewport: vp }).promise
  document.body.dataset.done = '1'
} catch (err) {
  document.getElementById('err').textContent = String(err && err.stack || err)
  document.body.dataset.done = 'err'
}
</script>`
const server = createServer((req, res) => {
  if (req.url.startsWith('/sheet')) {
    res.setHeader('content-type', 'application/pdf')
    res.end(pdf)
    return
  }
  if (req.url.startsWith('/pdf.worker')) {
    res.setHeader('content-type', 'text/javascript')
    res.end(worker)
    return
  }
  if (req.url.startsWith('/pdf.mjs')) {
    res.setHeader('content-type', 'text/javascript')
    res.end(lib)
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(html)
})
await new Promise((resolve) => server.listen(8791, '127.0.0.1', resolve))
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-first-run'],
})
const page = await browser.newPage()
page.on('console', (msg) => console.log('console', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('pageerror', String(err)))
await page.setViewport({ width: 1300, height: 950 })
await page.goto('http://127.0.0.1:8791/', { waitUntil: 'networkidle0', timeout: 60000 })
await page.waitForSelector('body[data-done]', { timeout: 60000 })
const state = await page.$eval('body', (el) => el.dataset.done + '\n' + (document.getElementById('err')?.textContent || ''))
console.log(state)
await page.screenshot({ path: 'C:/Users/Kotl/AppData/Local/Temp/avtopoliv.png' })
await browser.close()
server.close()
