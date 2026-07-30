/**
 * Small JSON store for non-secret user choices (selected business
 * policies). Kept separate from config: these are picked in the UI at
 * runtime, not configured in .env.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { app } from 'electron'

import type { PolicyIds } from '@shared/types'

interface Prefs {
  policyIds?: PolicyIds
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

function readPrefs(): Prefs {
  const path = prefsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Prefs
  } catch {
    return {}
  }
}

function writePrefs(prefs: Prefs): void {
  const path = prefsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(prefs, null, 2), 'utf-8')
}

export function getPolicyIds(): PolicyIds {
  return readPrefs().policyIds ?? {}
}

export function setPolicyIds(policyIds: PolicyIds): void {
  writePrefs({ ...readPrefs(), policyIds })
}

export function hasCompletePolicies(ids: PolicyIds): boolean {
  return Boolean(ids.fulfillment && ids.payment && ids.return)
}
