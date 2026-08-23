/**
 * Wire types for the Firecrawl search API (`POST https://api.firecrawl.dev/v1/search`).
 * Types only — no runtime code. Firecrawl returns a flat `data[]`; each entry
 * carries a URL plus optional title, description, page content or markdown,
 * and `publishedDate`.
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl/types
 */

/** Request body sent to Firecrawl's search endpoint. */
export interface FirecrawlSearchRequest {
  query: string
  /** Firecrawl's result-count control; the seam still enforces the bound on return. */
  limit?: number
}

/** One entry of Firecrawl's flat `data[]`. */
export interface FirecrawlResult {
  url: string
  title?: string | null
  description?: string | null
  /** Raw page text content returned by the API. */
  content?: string | null
  /** Page content as markdown. */
  markdown?: string | null
  publishedDate?: string | null
}

/** Firecrawl's search response envelope. */
export interface FirecrawlSearchResponse {
  success?: boolean
  error?: string
  message?: string
  data?: FirecrawlResult[]
}

/** Firecrawl's error response envelope (best-effort; fields vary by failure). */
export interface FirecrawlError {
  error?: string
  message?: string
}
