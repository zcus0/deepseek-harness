/**
 * Persistence of plugin enable/disable toggles in the home patch layer
 * (`$DSH_HOME/cordis.patch.yml`).
 *
 * The home patch file is one of the two user layers every `dsh` surface boots
 * through (`apps/cli/src/profile-boot.ts`) and the one the live-reload watcher
 * re-reads per generation, so a toggle row written here survives restarts and
 * re-applies idempotently on every boot. Writes are comment-preserving leaf
 * edits over the parsed document (the settings-file pattern), locked and
 * atomic so the HMR watcher never parses a torn file.
 *
 * @module @deepseek-ai/dsh-host-plugin-inventory/patch-persist
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { Document, parseDocument } from 'yaml'

/** Filename of the home-level user patch layer, resolved against `$DSH_HOME`. */
export function homePatchPath(): string {
  // Mirrors apps/cli's `homePatchPath()` without importing the app: a Host
  // package must not depend on an application package.
  return `${resolveDshHome()}/cordis.patch.yml`
}

/**
 * Upsert one entry's enablement into the home patch layer.
 *
 * Enabling deletes any stored toggle for the entry when its row carries
 * nothing else (the composition default is enabled), and flips `disabled`
 * otherwise. Disabling writes or updates `- id: <id>` / `disabled: true`.
 * Sibling rows — and comments inside untouched rows — survive untouched.
 * @param entryId - the Loader-tree entry id to address.
 * @param disabled - the enablement to store.
 */
export async function setEntryDisabledInHomePatch(entryId: string, disabled: boolean): Promise<void> {
  const filename = homePatchPath()
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  await withFileLock(filename, async () => {
    let text: string | undefined
    try {
      text = await readFile(filename, 'utf8')
    } catch {
      // Absent file = empty layer; every other read failure surfaces below.
    }
    const next = upsertToggle(text, entryId, disabled)
    if (next === undefined) return
    await writeFileAtomic(filename, next, { mode: 0o600, dirMode: 0o700 })
  })
}

/**
 * Compute the patch document after one toggle, comment-preserving.
 * @param current - current document text, or `undefined` when absent.
 * @param entryId - the Loader-tree entry id to address.
 * @param disabled - the enablement to store.
 * @returns the next document text, or `undefined` when nothing changes.
 */
export function upsertToggle(current: string | undefined, entryId: string, disabled: boolean): string | undefined {
  const document = current === undefined ? new Document([]) : parseDocument(current)
  if (document.errors.length > 0) {
    throw new Error(`pluginInventory: home patch file is not parsable YAML: ${document.errors[0]?.message}`)
  }
  const root = document.toJS()
  if (root !== undefined && root !== null && !Array.isArray(root)) {
    throw new Error('pluginInventory: home patch file must be a YAML array of loader entries')
  }
  const rows = Array.isArray(root) ? root : []
  const index = rows.findIndex(row =>
    typeof row === 'object' && row !== null && !Array.isArray(row) && (row as Record<string, unknown>).id === entryId)

  if (disabled) {
    const row = index >= 0 && typeof rows[index] === 'object' && rows[index] !== null
      ? rows[index] as Record<string, unknown>
      : undefined
    if (row !== undefined) {
      if (row.disabled === true) return undefined
      document.setIn([index, 'disabled'], true)
      return document.toString()
    }
    document.add({ id: entryId, disabled: true })
    return document.toString()
  }

  // Enable: drop our own key; delete a row that carried only the toggle, so
  // the layer stays minimal and removing the override genuinely reverts.
  if (index < 0) return undefined
  const row = rows[index] as Record<string, unknown>
  if (row.disabled === undefined || row.disabled === false) return undefined
  const rest = Object.keys(row).filter(key => key !== 'id' && key !== 'disabled')
  if (rest.length === 0) {
    document.deleteIn([index])
    return document.toString()
  }
  document.deleteIn([index, 'disabled'])
  return document.toString()
}
