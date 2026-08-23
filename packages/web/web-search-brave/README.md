# @deepseek-ai/dsh-web-search-brave

English | [中文](README.zh.md)

A [Brave Search](https://brave.com/search/api/)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Brave's `GET /res/v1/web/search` endpoint and maps the nested `web.results[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$BRAVE_SEARCH_API_KEY` | Brave Search subscription token. Empty/absent makes the provider unavailable. |
| `baseURL` | `https://api.search.brave.com` | Endpoint base; `/res/v1/web/search` is appended. An unparseable value makes the provider unavailable. |
| `count` | `8` | Default result count when a request carries no `maxResults`. Must be a positive integer. |

```yaml
- id: web-search-brave
  name: '@deepseek-ai/dsh-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_SEARCH_API_KEY
```

## Mapping

Brave returns no generated answer, so `content` is omitted. Each entry of `web.results[]` maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `description` with inline HTML tags stripped (`<strong>bold</strong>` → `bold`; an entry left blank after stripping has no portable snippet and is dropped), `publishedAt` ← `age`. A request's `maxResults` wins over the configured `count` default and is sent as Brave's `count` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, tag-stripped snippets, and relative ages or its exact `Brave search aborted`, `Brave search request failed: <error>`, and `Brave returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **An entry whose description is blank after HTML stripping is dropped entirely** — no portable snippet to map, so fewer sources than the requested count can return.
- **Only `count` is exposed** — Brave's other search controls (country/language filters, freshness, safe-search) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **`publishedAt` carries Brave's relative `age` strings** — the seam types the field as ISO-8601, so consumers must tolerate this provider's human-readable values until the Service Definition gains a recency field.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
