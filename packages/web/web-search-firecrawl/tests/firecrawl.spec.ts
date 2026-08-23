import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FirecrawlSearchProvider, FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-firecrawl'
import * as firecrawlPlugin from '@deepseek-ai/dsh-web-search-firecrawl'
import { mapFirecrawlResponse, mapFirecrawlResult } from '../src/provider.ts'

const options = { apiKey: 'fc-key', baseURL: 'https://api.firecrawl.test', limit: 8 }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapFirecrawlResult({
      url: 'https://a.test',
      title: 'A',
      description: 'first paragraph',
      publishedDate: '2026-01-01',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'first paragraph', publishedAt: '2026-01-01' })
  })

  it('falls back to content and then markdown for the snippet', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', content: 'raw text' })).toEqual({ url: 'https://a.test', snippet: 'raw text' })
    expect(mapFirecrawlResult({ url: 'https://a.test', markdown: '# md' })).toEqual({ url: 'https://a.test', snippet: '# md' })
    expect(mapFirecrawlResult({ url: 'https://a.test', description: '', markdown: '# md' })).toEqual({ url: 'https://a.test', snippet: '# md' })
  })

  it('drops a result with no usable snippet', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test' })).toBeUndefined()
    expect(mapFirecrawlResult({ url: 'https://a.test', description: null, content: null, markdown: null })).toBeUndefined()
    expect(mapFirecrawlResult({ url: 'https://a.test', description: '   ', content: '', markdown: ' \n ' })).toBeUndefined()
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', title: null, publishedDate: null, description: 'hi' }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
    expect(mapFirecrawlResult({ url: 'https://a.test', title: '', publishedDate: '', content: 'hi' }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapFirecrawlResponse({
      success: true,
      data: [
        { url: 'https://a.test', description: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', markdown: 'three' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing data array', () => {
    expect(mapFirecrawlResponse({}).sources).toEqual([])
  })

})

describe('FirecrawlSearchProvider availability', () => {
  it('is unavailable on the cloud endpoint without a key', () => {
    expect(new FirecrawlSearchProvider({ ...options, apiKey: '', baseURL: FIRECRAWL_DEFAULT_BASE_URL }).available()).toBe(false)
  })

  it('is available locally without a key (self-hosted instance)', () => {
    expect(new FirecrawlSearchProvider({ ...options, apiKey: '', baseURL: 'https://firecrawl.lan.test' }).available()).toBe(true)
  })

  it('is available with a key', () => {
    expect(new FirecrawlSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new FirecrawlSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when limit is not a positive integer', () => {
    expect(new FirecrawlSearchProvider({ ...options, limit: 0 }).available()).toBe(false)
    expect(new FirecrawlSearchProvider({ ...options, limit: 1.5 }).available()).toBe(false)
  })
})

describe('FirecrawlSearchProvider request mapping', () => {
  it('sends query, limit and bearer auth to /v1/search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ url: 'https://a.test', description: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await new FirecrawlSearchProvider(options).search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v1/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer fc-key')
    expect((init.headers as Record<string, string>)['user-agent']).toBe('deepseek-harness/0.1.1')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'hello', limit: 5 })
  })

  it('omits the authorization header for a keyless self-hosted instance', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, apiKey: '' }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('falls back to the configured limit when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, limit: 7 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 7 })
  })

  it('lets a request maxResults win over the configured limit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, limit: 7 }).search({ query: 'q', maxResults: 2 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 2 })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new FirecrawlSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('FirecrawlSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, { status: 401 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('extracts detail from a message field when error is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'quota exceeded' }, { status: 429 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'quota exceeded' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Firecrawl API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: {} }, { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-firecrawl plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'fc-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in firecrawlPlugin).toBe(false)
  })

  it('threads limit config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'fc-key', limit: 9 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 9 })
    await fiber.dispose()
  })

  it('searches a keyless self-hosted instance through the plugin', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ url: 'https://a.test', description: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { baseURL: 'https://firecrawl.lan.test' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://a.test', snippet: 'hi' }] })
    await fiber.dispose()
  })

  it('falls back to $FIRECRAWL_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.firecrawl.dev/v1/search')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('is unavailable on the cloud endpoint when neither config nor env supplies a key', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      await ctx.plugin(firecrawlPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })
})
