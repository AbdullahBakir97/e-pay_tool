/**
 * Command-line connection check.
 *
 *   npm run doctor
 *
 * Runs the same checks as the in-app dialog and prints them. Useful while
 * setting up eBay keys, because it is far faster than clicking through
 * the UI and works over SSH.
 *
 * Runs under Electron rather than plain Node: the stored eBay token lives
 * in the OS credential store, which is reachable only through Electron's
 * safeStorage.
 */

import { app, shell } from 'electron'

import { loadConfig } from '@main/config'
import { EbayAuth } from '@main/ebay/auth'
import { EbayClient } from '@main/ebay/client'
import { formatReport, runDiagnostics } from '@main/ebay/diagnostics'
import { getPolicyIds } from '@main/prefs'
import { loadSecret, storeSecret } from '@main/secrets'

async function main(): Promise<number> {
  const config = loadConfig(app.getAppPath())
  const auth = new EbayAuth(
    config,
    { store: storeSecret, load: loadSecret },
    { open: (url: string) => shell.openExternal(url) },
  )
  const client = new EbayClient(config, auth)

  console.log(`\nePay Tool – Verbindungsprüfung (${config.ebayEnv}, ${config.ebayMarketplace})\n`)

  const results = await runDiagnostics({
    config,
    auth,
    client,
    policyIds: getPolicyIds(),
  })

  console.log(formatReport(results))

  const count = (status: string): number =>
    results.filter((result) => result.status === status).length

  const failed = count('fail')
  console.log(
    `\n${count('ok')} in Ordnung, ${count('warn')} Hinweis(e), ` +
      `${failed} Fehler, ${count('skipped')} übersprungen.\n`,
  )
  return failed > 0 ? 1 : 0
}

app
  .whenReady()
  .then(main)
  .catch((error: unknown) => {
    console.error('Die Prüfung konnte nicht ausgeführt werden:', error)
    return 1
  })
  .then((code) => app.exit(code ?? 1))
