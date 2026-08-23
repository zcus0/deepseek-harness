/** Projection of the current Cordis Loader plugin entries with enable/disable control. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { setEntryDisabledInHomePatch } from './patch-persist.ts'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote service exposing the Loader's current non-group entry state and its enablement. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Enable or disable one non-group entry in the running tree, then persist the
   * toggle as an id-targeted row in the home patch layer (`$DSH_HOME/cordis.patch.yml`)
   * so it survives restarts. The Loader applies `disabled` by disposing a live
   * entry's fiber, or starting a disabled one; the persisted row merges onto
   * the composed entry by id on every later boot.
   * @param entryId - the Loader-tree entry id from {@link list}.
   * @param enabled - the requested enablement.
   */
  @Remote('setEnabled')
  async setEnabled(entryId: PluginEntryId, enabled: boolean): Promise<void> {
    const id = String(entryId)
    const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === id)
    if (entry === undefined) {
      throw new Error(`pluginInventory: no plugin entry ${JSON.stringify(id)}`)
    }
    if (entry.options.group) {
      // `list()` excludes groups, so this id never came from this Remote; a
      // group toggle would silently flip a whole subtree.
      throw new Error(`pluginInventory: entry ${JSON.stringify(id)} is a group`)
    }
    await this.ctx.loader.update(id, { disabled: !enabled })
    // Persist after the tree accepted the change: a failed write must not
    // leave disk claiming a state the process refused to apply.
    await setEntryDisabledInHomePatch(id, !enabled)
  }
}

export default PluginInventoryGateway
