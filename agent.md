# agent.md — Panduan Kerja Agent (deepseek-harness)

> Bahasa Indonesia, ringkas. **AGENTS.md tetap otoritatif** — file ini ringkasan operasional
> plus konteks deployment lokal pemilik repo. Peta struktur: [system_map.md](system_map.md).

## Aturan main

1. Baca `docs/architecture.md` sebelum menyentuh `packages/`. Semuanya plugin Cordis — perilaku baru masuk extension point, bukan ubah loop.
2. Ikuti pola package yang ada dulu (template terdekat), jangan karang gaya sendiri.
3. Registrasi = effect (`ctx.effect()`/`ctx.on()`); waterfall listener wajib `next()`.
4. Yang kelihatan model harus ada di session log (`SessionEventMap`).
5. Tanpa tunable hardcoded — jadikan field `Config` tervalidasi; misconfig gagal keras saat load.
6. Perilaku/config berubah → README package (+ pasangan zh) dan JSDoc ikut di commit yang sama.
7. Tes menggambarkan perilaku, bukan "benar/salah"; coverage CI mensyaratkan 100% per-file — kode baru wajib ketutup tes.

## Command per jenis perubahan

| Ubah apa | Jalankan |
|---|---|
| Package tertentu | `npx vitest run <path-package>` |
| Client/host GUI | `npx vitest run packages/client packages/host` |
| Tipe/semua | `pnpm run typecheck && pnpm run lint` |
| index.html / dist web | `DSH_SNAPSHOT=replay pnpm run test:web` |
| Docs | `pnpm run doc-sync` |
| Catalog generated | regen pakai `pnpm run gen-*`, cek `verify-*` |

- Jangan jalankan suite penuh kalau tidak perlu (lama). Mulai dari yang ter-target.
- Setelah edit README id/zh: `pnpm run verify-translation-pairing --write <file>`.

## Plugin: enable/disable & konfigurasi

- Semua lewat row YAML (bukan UI): patch profil di `/root/.dsh/profiles/web/cordis.patch.yml`.
- Matikan: `- id: <row>\n  disabled: true`. Nyalakan lagi: hapus baris itu.
- Lihat row aktif + id: `pnpm dsh --profile web --dump-config`.
- Config row menimpa UTUH config row target — tulis ulang field lama (host/port dll) jika patch row `webserver`.

## Web search provider (firecrawl/brave/exa/perplexity)

Aktivasi opt-in via patch profil, contoh firecrawl lokal:

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    baseURL: 'http://127.0.0.1:3002'   # instance self-hosted; kosongkan key
    # apiKey: 'fc-...'                 # atau cloud + FIRECRAWL_API_KEY
- id: web
  config:
    searchProvider: firecrawl          # ganti dari default deepseek-official
```

Brave sama polanya (`web-search-brave`, env `BRAVE_SEARCH_API_KEY`). Tool `web_search` otomatis memakai provider terpilih.

## Jebakan yang sudah pernah kejadian

- **PRODUKSI = `/opt/deepseek-harness`** (rc.8), bukan repo dev ini. Restart servis dari sana, command aslinya ada di `system_map.md`.
- **Jangan boot dev dengan `$DSH_HOME=/root/.dsh`** — format `.credentials.yaml` prod (flat, rc.8) vs dev (`version: 1` + `refs:`) saling merusak; timpaan bikin produksi gagal boot. Dev pakai `DSH_HOME=/root/.dsh-dev`.
- Impor package yang tidak ada (`register.ts` lama) — selalu cek nama workspace di `pnpm-workspace.yaml`/`packages/<group>/`.
- Auth client-side (localStorage) bukan auth; gateway-nya di host (`webserver.config.auth`).
- Nested `.required()` di schemastery divalidasi walau parent absen — resolve manual di init.
- Akses via IP non-HTTPS butuh polyfill `crypto.randomUUID` (sudah ada di `apps/web/index.html`, jangan dihapus).
- Fence `PRIVILEGED_METHODS` (settings/credentials RPC) loopback-only by design; buka untuk remote hanya via `allowRemotePrivilegedRpc: true` + auth layer nyata di depan.
- Setelah ubah kode host/client: `pnpm run build` dulu sebelum tes web/e2e atau restart server — Loader & scaffold memuat artefak `lib/` + `dist`, bukan src.
- Proses background: start pakai `setsid nohup ... & disown`; `nohup` doang masih ikut kebun proses shell tool dan bisa mati saat timeout.
