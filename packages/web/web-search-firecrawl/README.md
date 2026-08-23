# @deepseek-ai/dsh-web-search-firecrawl

English | [中文](README.zh.md)

A [Firecrawl](https://firecrawl.dev)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Firecrawl's `POST /v1/search` endpoint and maps the flat `data[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$FIRECRAWL_API_KEY` | Firecrawl API key. Required for the default cloud endpoint; empty makes the provider unavailable there. Self-hosted instances need no key. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v1/search` is appended. An unparseable value makes the provider unavailable. Set this to your self-hosted instance to run without a key. |
| `limit` | `8` | Default result count when a request carries no `maxResults`. Must be a positive integer. |

### Local / self-hosted mode

Point `baseURL` at your instance (for example `http://localhost:3002`) and omit `apiKey`: any explicit non-default base URL marks a self-hosted deployment that needs no key. The default cloud URL without a key keeps the provider unavailable instead of failing at request time.

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

## Mapping

Firecrawl returns a flat `data[]` and no generated answer, so `content` is omitted. Each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← the first non-blank of `description`, `content`, and `markdown` (a result with none has no portable snippet and is dropped), `publishedAt` ← `publishedDate`. A request's `maxResults` wins over the configured `limit` default and is sent as Firecrawl's `limit` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, first snippets, and publication dates or its exact `Firecrawl search aborted`, `Firecrawl search request failed: <error>`, and `Firecrawl returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **A result with no non-blank description/content/markdown is dropped entirely** — no portable snippet to map, so fewer sources than the requested count can return.
- **Only `limit` is exposed** — Firecrawl's other search controls (scrape options, timeouts, categories) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Keyless operation requires a non-default `baseURL`** — the cloud endpoint always needs an API key; there is no anonymous cloud tier.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
