/**
 * Persistent secret storage for the eBay refresh token.
 *
 * Uses Electron's safeStorage, which is backed by the OS credential
 * store (DPAPI on Windows, Keychain on macOS). The token is written to
 * disk only in encrypted form, and never in plain text.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { app, safeStorage } from 'electron'

function secretPath(name: string): string {
  return join(app.getPath('userData'), 'secrets', `${name}.bin`)
}

export function storeSecret(name: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Die sichere Speicherung des Systems ist nicht verfügbar; ' +
        'die eBay-Anmeldung kann nicht gespeichert werden.',
    )
  }
  const path = secretPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, safeStorage.encryptString(value), { mode: 0o600 })
}

export function loadSecret(name: string): string | null {
  const path = secretPath(name)
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    // A token encrypted under a different OS user or machine is useless;
    // treat it as absent so the app re-prompts for consent.
    return null
  }
}

export function deleteSecret(name: string): void {
  rmSync(secretPath(name), { force: true })
}
