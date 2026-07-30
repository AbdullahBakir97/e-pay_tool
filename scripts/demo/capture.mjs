/**
 * Captures screenshots of the running app for documentation.
 *
 * Drives the real, built application over the Chrome DevTools Protocol -
 * these are genuine screenshots of the app, not mockups. Node 22's
 * built-in WebSocket is used, so there is no extra dependency.
 *
 *   node scripts/demo/capture.mjs <debugging-port> <output-dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.argv[2] ?? '9222'
const OUT_DIR = process.argv[3] ?? 'docs/images'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // The app is still starting up.
    }
    await sleep(500)
  }
  throw new Error('No debuggable page found - is the app running?')
}

class CdpSession {
  #socket
  #nextId = 1
  #pending = new Map()

  static async connect(url) {
    const session = new CdpSession()
    session.#socket = new WebSocket(url)
    session.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const resolver = session.#pending.get(message.id)
      if (!resolver) return
      session.#pending.delete(message.id)
      if (message.error) resolver.reject(new Error(message.error.message))
      else resolver.resolve(message.result)
    })
    await new Promise((resolve, reject) => {
      session.#socket.addEventListener('open', resolve, { once: true })
      session.#socket.addEventListener('error', () => reject(new Error('CDP connect failed')), {
        once: true,
      })
    })
    return session
  }

  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
    }
    return result.result.value
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
    console.log(`  captured ${path}`)
  }

  close() {
    this.#socket.close()
  }
}

/** Clicks the queue row whose SKU cell matches. */
const selectRow = (sku) => `
  (() => {
    const row = [...document.querySelectorAll('tbody tr')]
      .find((tr) => tr.cells[0].textContent === '${sku}')
    if (!row) throw new Error('row ${sku} not found')
    row.click()
    return true
  })()`

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const target = await findPageTarget()
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  // Let React render and the initial product list arrive.
  await sleep(2500)

  const count = await cdp.evaluate("document.querySelectorAll('tbody tr').length")
  console.log(`  queue shows ${count} products`)
  if (count === 0) throw new Error('demo data did not load')

  await cdp.screenshot(join(OUT_DIR, '01-queue.png'))

  // The flagship case: the AI asks instead of guessing.
  await cdp.evaluate(selectRow('EP-4A91C0DE7742'))
  await sleep(600)
  await cdp.screenshot(join(OUT_DIR, '02-ai-questions.png'))

  // A complete draft with market price research.
  await cdp.evaluate(selectRow('EP-7B22F1AA9013'))
  await sleep(600)
  await cdp.screenshot(join(OUT_DIR, '03-ready-listing.png'))

  // A failed publish showing the eBay error verbatim.
  await cdp.evaluate(selectRow('EP-2D45E7F9C831'))
  await sleep(600)
  await cdp.screenshot(join(OUT_DIR, '04-failed-item.png'))

  // A second question case: shoe size cannot be read from the photos.
  await cdp.evaluate(selectRow('EP-9E37A2C41D58'))
  await sleep(600)
  await cdp.screenshot(join(OUT_DIR, '05-size-question.png'))

  cdp.close()
  console.log('CAPTURE DONE')
}

main().catch((error) => {
  console.error('CAPTURE FAILED:', error.message)
  process.exit(1)
})
