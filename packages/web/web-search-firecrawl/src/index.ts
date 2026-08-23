/**
 * `@deepseek-ai/dsh-web-search-firecrawl`: registers a Firecrawl-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
} from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlSearchProvider,
} from './provider.ts'
export type { FirecrawlSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Firecrawl API key. Falls back to `$FIRECRAWL_API_KEY`. Empty → cloud unavailable; self-hosted still usable. */
  apiKey?: string
  /** Endpoint base; `/v1/search` is appended. Defaults to the public cloud API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Defaults to 8. */
  limit?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  limit: z.number().step(1).min(1),
})

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
    limit: config.limit ?? FIRECRAWL_DEFAULT_LIMIT,
  }))
}
