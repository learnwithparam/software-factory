import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await page.goto(pathToFileURL(resolve('../workbook.html')).href, { waitUntil: 'networkidle' })
for (const id of process.argv.slice(2)) {
  const fig = page.locator(`figure.diagram[data-diagram="${id}"]`)
  if (!(await fig.count())) { console.log('missing', id); continue }
  await fig.scrollIntoViewIfNeeded()
  await fig.screenshot({ path: `/tmp/dg-${id}.png` })
  console.log('rendered', id)
}
await browser.close()
