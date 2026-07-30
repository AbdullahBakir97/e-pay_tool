/**
 * Build smoke test.
 *
 * Unit tests cover the main-process logic, but they cannot catch a
 * broken bundle wiring: a preload emitted under a different extension
 * than the main process expects, or a renderer that throws on boot. Both
 * produce an app that starts and then does nothing, which is exactly the
 * failure a test suite should not miss.
 *
 * Loads the real built output and asserts the bridge and the UI are live.
 *
 *   npm run build && npm run smoke
 */

const { existsSync } = require('node:fs')
const { join } = require('node:path')

const { app, BrowserWindow } = require('electron')

const OUT = join(__dirname, '..', 'out')
const PRELOAD = join(OUT, 'preload', 'index.mjs')
const RENDERER = join(OUT, 'renderer', 'index.html')
const MAIN = join(OUT, 'main', 'index.js')

const failures = []
const checks = []

function check(name, condition, detail = '') {
  if (condition) {
    checks.push(`  ok   ${name}`)
  } else {
    failures.push(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

async function main() {
  check('main bundle exists', existsSync(MAIN), MAIN)
  check('preload bundle exists', existsSync(PRELOAD), PRELOAD)
  check('renderer bundle exists', existsSync(RENDERER), RENDERER)

  if (failures.length > 0) return

  // The built main process must reference the preload file that actually
  // exists - the extension differs between CJS and ESM output.
  const mainSource = require('node:fs').readFileSync(MAIN, 'utf-8')
  check(
    'main references the emitted preload filename',
    mainSource.includes('preload/index.mjs'),
    'main/index.js does not point at preload/index.mjs',
  )

  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })

  const rendererErrors = []
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) rendererErrors.push(message)
  })

  await window.loadFile(RENDERER)

  const bridge = await window.webContents.executeJavaScript(
    `({
      hasBridge: typeof window.epay === 'object' && window.epay !== null,
      methods: window.epay ? Object.keys(window.epay).length : 0,
      hasScanInput: !!document.querySelector('#scan'),
      rendered: !!document.querySelector('.app'),
    })`,
  )

  check('preload exposes the epay bridge', bridge.hasBridge)
  check('bridge exposes every IPC method', bridge.methods >= 17, `found ${bridge.methods}`)
  check('React rendered the app shell', bridge.rendered)
  check('scan input is present and focusable', bridge.hasScanInput)
  check('renderer booted without errors', rendererErrors.length === 0, rendererErrors.join(' | '))
}

app.whenReady()
  .then(main)
  .catch((error) => failures.push(`  FAIL unexpected error - ${error.message}`))
  .finally(() => {
    for (const line of checks) console.log(line)
    for (const line of failures) console.log(line)
    console.log(failures.length === 0 ? '\nSMOKE TEST PASSED' : '\nSMOKE TEST FAILED')
    app.exit(failures.length === 0 ? 0 : 1)
  })
