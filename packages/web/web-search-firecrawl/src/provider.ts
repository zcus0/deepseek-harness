/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by the Firecrawl search API
 * (`POST /v1/search`). It maps the first non-blank of `description`, `content`, and
 * `markdown` to `snippet`, maps `publishedDate` to `publishedAt`, and drops entries
 * without a snippet. The API key is optional: self-hosted instances often need none,
 * while the cloud endpoint requires one.
 * @module @deepseek-ai/dsh-web-search-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { FirecrawlError, FirecrawlResult, FirecrawlSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl search endpoint; `/v1/search` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Default number of results requested per search when a request carries no `maxResults`. */
export const FIRECRAWL_DEFAULT_LIMIT = 8

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.1.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface FirecrawlSearchProviderOptions {
  /** Firecrawl API key. Optional: empty is usable against self-hosted instances only. */
  apiKey: string
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: string
  /** Default result count sent as Firecrawl's `limit`; omitted sends no default. */
  limit?: number
}

/**
 * Map one Firecrawl result to a normalized source, or `undefined` when it carries no
 * portable snippet (an entry with no description/content/markdown is dropped — the
 * seam has no other field to derive a snippet from, and inventing one would lie).
 *
 * @param result - one entry of Firecrawl's `data[]`.
 * @returns the normalized source, or `undefined` when the entry has no non-blank
 *   description, content, or markdown.
 */
export function mapFirecrawlResult(result: FirecrawlResult): WebSearchSource | undefined {
  const snippet = [result.description, result.content, result.markdown]
    .find((field): field is string => field != null && field.trim().length > 0)
  if (snippet === undefined) return undefined
  const title = result.title ?? ''
  const publishedAt = result.publishedDate ?? ''
  // Blank optional fields are omitted rather than emitted empty.
  return {
    url: result.url,
    ...title.length > 0 ? { title } : {},
    snippet,
    ...publishedAt.length > 0 ? { publishedAt } : {},
  }
}

/**
 * Map a Firecrawl response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapFirecrawlResult}).
 */
export function mapFirecrawlResponse(response: FirecrawlSearchResponse): WebSearchResult {
  const sources = (response.data ?? [])
    .map(mapFirecrawlResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Firecrawl returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlSearchProviderOptions) {}

  available(): boolean {
    // A key is required only for the default cloud endpoint: self-hosted/local
    // instances (any explicit non-default baseURL) commonly accept no key.
    // Cloud without a key stays unavailable here rather than failing at request time.
    return isValidBaseUrl(this.options.baseURL)
      && (this.options.apiKey.length > 0 || this.options.baseURL !== FIRECRAWL_DEFAULT_BASE_URL)
      && (this.options.limit === undefined || isPositiveInteger(this.options.limit))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const limit = request.maxResults ?? this.options.limit
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/v1/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...this.options.apiKey.length > 0 ? { 'authorization': `Bearer ${this.options.apiKey}` } : {},
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          ...limit !== undefined ? { limit } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Firecrawl API error (HTTP ${status})`
      try {
        const parsed = await response.json() as FirecrawlError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as FirecrawlSearchResponse
      return mapFirecrawlResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

// These predicates are intentionally local: exporting generic internals
// from the public web seam would add more API than these pure checks.
/* jscpd:ignore-start */
/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Firecrawl (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
/* jscpd:ignore-end */
