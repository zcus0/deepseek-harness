/**
 * Wire types for the Brave Search API (`GET https://api.search.brave.com/res/v1/web/search`).
 * Types only — no runtime code. Brave nests hits under `web.results[]`; each
 * entry carries a URL, optional title, an HTML-flavored `description`, and an
 * optional relative `age`.
 *
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One entry of Brave's `web.results[]`. */
export interface BraveResult {
  url: string
  title?: string | null
  /** Snippet text that may carry inline HTML tags (e.g. `<strong>`). */
  description?: string | null
  /** Relative publication/crawl age (e.g. `2 hours ago`). */
  age?: string | null
}

/** Brave's search response envelope. */
export interface BraveSearchResponse {
  web?: {
    results?: BraveResult[]
  }
}

/** Brave's error response envelope (best-effort; fields vary by failure). */
export interface BraveError {
  error?: string
  message?: string
}
