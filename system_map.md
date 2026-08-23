# system_map.md — Peta Struktur deepseek-harness

> Catatan internal (bahasa Indonesia) supaya sesi berikutnya tidak perlu eksplorasi ulang.
> Aturan resmi tetap di [AGENTS.md](AGENTS.md); file ini hanya peta + fakta deployment lokal.

## Identitas

- **dsh** (`@deepseek-ai/dsh-root`, v0.1.1-rc.2): agent harness berbasis plugin, semuanya plugin Cordis (vendored di `vendor/`).
- Monorepo pnpm, ESM saja, Node `^22.19 || >=24`, TypeScript strict, oxlint, vitest.
- `CLAUDE.md` = symlink ke `AGENTS.md` (root, `packages/`, `examples/`). Jangan edit symlink.

## Layout

| Path | Isi |
|---|---|
| `apps/cli` | Entry `dsh` (`src/bin.ts`, jalan via `node --import tsx/esm`) |
| `apps/web` | Frontend Vite (build-only; `index.html` + `src/main.ts` → import shell `@deepseek-ai/dsh-client-web`) |
| `packages/core` | Spine produk: session, system-prompt, tools, agent, agent-loop, scope |
| `packages/web` | Seam web: `web` (service `ctx.web`), `tool-web` (tool `web_search`/`web_fetch`), provider fetch `web-fetch-http`, provider search: `web-search-deepseek` (default), `web-search-exa`, `web-search-perplexity`, `web-search-firecrawl` (baru), `web-search-brave` (baru) |
| `packages/client` | Browser half (~35 plugin `ui-*`, `runtime`, `connection`, `web` shell); slot system |
| `packages/host` | Server half: `webserver` (node:http carrier, sekarang punya opsi `auth` Basic), `apiproxy`, `frontend-static`, `directory-picker*` |
| `packages/bundle/{base,headless,web-app}` | Bundle layer; row komposisi di masing-masing `cordis.patch.yml` |
| `packages/boot/app-boot` | Profil & boot glue (`profile.ts`: profil → daftar bundle) |
| `packages/{llm,shell,fs,subprocess,sandbox,session,settings,...}` | Capability seam lain (pola sama: Service Definition / Provider / Consumer) |
| `vendor/` | Cordis + schemastery vendored (rescope `@deepseek-ai/*`) |
| `python/` | Python SDK; `native/` landlock-run; `examples/` demo cordis.yml |
| `scripts/` | Gate & generator (`run-gates.ts` pusat) |
| `docs/` | architecture.md (wajib baca sebelum ubah `packages/`), subsystems/, cookbook/, postmortem/ |
| `.agents/notes/` | Agent Notes (keputusan; arsip beku) |

## Alur boot & komposisi

```
dsh web
→ profil `web` = bundle [`dsh-base`, `dsh-web-app`]   (packages/boot/app-boot/src/profile.ts)
→ tiap bundle menyumbang row dari cordis.patch.yml-nya
→ lalu patch berlapis: profil ($DSH_HOME/profiles/<nama>/cordis.patch.yml)
  → home ($DSH_HOME/cordis.patch.yml) → overlay `--patch`
```

- Row = `{ id, name (package), config, disabled? }`. Patch menimpa row by `id` (config diganti utuh!) atau insert row baru.
- Toggle plugin: `disabled: true` pada row (bukan lewat UI).
- Lihat tree aktif: `pnpm dsh --profile web --dump-config`.
- `!!js` hanya sah di bawah plugin `config` dan entry `disabled`.

## Deployment lokal (mesin ini)

- **PRODUKSI jalan dari `/opt/deepseek-harness`** (v0.1.0-rc.8, punya modifikasi lokal sendiri) — BUKAN dari repo dev ini. Dua instance:
  - `pnpm dsh web --port 4080 --no-open --trusted-host 100.111.111.6` → diakses via proxy LAN `dsh-lan-proxy/proxy.mjs` (`100.111.111.6:4080 → 127.0.0.1:4080`, rewrite Host/Origin).
  - `pnpm dsh web --no-open --trusted-host dsh.zcus.tech --trusted-host 168.110.219.31:30081` → 127.0.0.1:3080.
  - Start pakai `setsid nohup ... & disown` dari workdir masing-masing; log di `/root/.dsh/web-*.log`.
- **JANGAN boot instance dev (repo ini) dengan `$DSH_HOME=/root/.dsh`** — format `.credentials.yaml` beda (dev v-rc.2: `version: 1` + wrapper `refs:`; prod rc.8: flat tanpa version, semua nilai string, chmod 600). Timpa = produksi gagal boot. Dev: `DSH_HOME=/root/.dsh-dev pnpm dsh ...`. Backup format baru: `/root/.dsh/.credentials.yaml.v1.bak`.
- `$DSH_HOME=/root/.dsh`; profil aktif `/root/.dsh/profiles/web/` (patch user: `cordis.patch.yml` di situ, isinya session-query-sqlite + connection `allowRemotePrivilegedRpc: true` — no-op buat prod lama, aktif kalau dev yang boot).
- Fence settings remote: `PRIVILEGED_METHODS` (`packages/client/connection/src/index.ts`) default loopback-only; flag `allowRemotePrivilegedRpc: true` (dev) membukanya ke trusted-host — syarat auth layer di depan. Prod saat ini masih pakai trik rewrite Host di proxy.
- Auth proper (dev): HTTP Basic di level webserver → row `webserver` di profil patch:
  ```yaml
  - id: webserver
    config:
      host: '127.0.0.1'
      port: 3081
      auth:
        username: admin
        password: 'ganti-ini'
  ```
  (config row menimpa utuh — host/port ikut ditulis ulang).
- Modifikasi client dev memaksa settings mirror mode `'host'` untuk SEMUA koneksi (packages/client/ui-settings*); tes lama yang mengasumsikan `'memory'` untuk remote sudah ditulis ulang.
- Setelah ubah kode host/client WAJIB `pnpm run build` — scaffold/Loader memuat `lib/` + dist, bukan src.

## Seam web search (pola provider)

- Service: `ctx.web` (`packages/web/web`) — `registerSearchProvider(provider)`; seleksi via config row `web` → `searchProvider: <id>` atau env `DSH_WEB_SEARCH_PROVIDER`.
- Provider = function plugin (`name`/`inject:['web']`/`Config`/`apply`), env fallback via `launchEnvironmentOf(ctx)`:
  - `deepseek-official` — `DEEPSEEK_API_KEY` (default terpasang)
  - `exa` — `EXA_API_KEY`; `perplexity` — `PERPLEXITY_API_KEY`
  - `firecrawl` (baru) — `FIRECRAWL_API_KEY` opsional; `baseURL` bisa instance self-hosted lokal (tanpa key). Endpoint `POST {baseURL}/v1/search`.
  - `brave` (baru) — `BRAVE_SEARCH_API_KEY`. Endpoint `GET {baseURL}/res/v1/web/search`.
- Tool model-facing: `web_search`/`web_fetch` di `tool-web` (enable/disable per tool via config `{search:false}` / `{fetch:false}`).
- Aktivasi provider opt-in = insert row di patch profil + set `searchProvider`. Contoh ada di README tiap package.

## Lane tes (vitest)

| Command | Cakupan |
|---|---|
| `npx vitest run <path>` | Unit ter-target — pakai ini dulu, JANGAN langsung full suite (±10 menit) |
| `pnpm run test:gui` | `packages/client` + `packages/host` (inner loop GUI, ±10 menit) |
| `pnpm run test:snapshot` | Replay keyless ACP/headless/web |
| `pnpm run test:e2e` | API nyata, self-skip tanpa key |
| `pnpm run test:coverage` | Gate CI: 100% per-file di `packages/*/*/src` |
| `pnpm run typecheck` / `lint` | `tsc -b` dua face (host+client) / oxlint |
| `pnpm run doc-sync` | Semua gate dokumentasi |

## Keadaan modifikasi lokal (sesi 2026-08-22)

1. `packages/web/register.ts` dihapus (impor package hantu: dsh-web-firecrawl/soul/profile/login versi lama).
2. Login gate palsu (hardcode admin/password di index.html) dibuang → diganti opsi `auth` Basic server-side di `packages/host/webserver` (+tes & README id/zh).
3. Fence settings/credentials: flag baru `allowRemotePrivilegedRpc` di `@deepseek-ai/dsh-client-connection` (default false; aktif di profil patch user) — remote trusted-host dapat akses settings, kompensasi auth layer.
4. Dead code `ui-settings-general` dibersihkan; 4 tes lama (ui-theme/ui-settings*/welcome) ditulis ulang sesuai perilaku host-backed; README id/zh + pairing hash di-update.
5. `dsh-web.log` masuk `.gitignore`.
6. Package baru `web-search-firecrawl` & `web-search-brave` lengkap (src/tests/README trio, registrasi tsconfig/knip/catalog, tes hijau).
7. `apps/web/index.html`: polyfill randomUUID dipertahankan, sisanya revert upstream.

## Keadaan modifikasi lokal (sesi 2026-08-23)

1. Toggle on/off plugin end-to-end:
   - `packages/host/plugin-inventory/src/patch-persist.ts` (BARU): `setEnabled(entryId, enabled)` via Loader `insertEntry`/`removeEntry`, persist ke `$DSH_HOME/cordis.patch.yml` (insert row `disabled: true` / hapus row), atomic + file lock; `setEnabled` juga di `typertRemote`.
   - `packages/client/ui-settings-plugin-inventory`: switch per entry di `PluginInventorySettingsTab.tsx` (role="switch", pending-state lokal, revert on reject), locales `togglingTag/enable/disable`, CSS `.switch`, inject `setEnabled` di `src/client/index.ts`.
   - Fence: `pluginInventory.setEnabled` masuk `PRIVILEGED_METHODS` di `packages/client/connection/src/index.ts` (butuh `allowRemotePrivilegedRpc` untuk remote).
   - Semua tes paket terkait hijau.
2. Multi-agent terverifikasi AKTIF di profil web: preset `standard` (default, `apps/cli/config/agent-presets/standard/agent.cordis.yml` grup `delegation`) menyumbang `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent` (spawn/continuable), `tool-subagent-fork`; host-level rows di bundle web-app `disabled: true` memang sengaja (registry + backend tetap host-plane, tools dari preset). Cek via `node apps/cli/lib/bin.js --profile web --dump-config`.
3. Dev profile `$DSH_HOME=/root/.dsh-dev` (symlink node_modules @deepseek-ai/* ke repo):
   - `cordis.patch.yml`: insert `web-search-firecrawl` (baseURL `http://127.0.0.1:3002`, tanpa key) + `web-search-brave`; `web.searchProvider: firecrawl`.
   - `profiles/web/cordis.patch.yml`: webserver Basic auth (dsh/[REDACTED]) + `connection.allowRemotePrivilegedRpc` + session-search sqlite.
4. Firecrawl stack lokal `/root/firecrawl-local/`: SearXNG (`searxng-core` di network `firecrawl-local`, host port 127.0.0.1:8888, JSON format on) + Firecrawl compose (`firecrawl/`, override pakai PRE-BUILT image ghcr.io firecrawl/playwright-service/nuq-postgres, network join `firecrawl-local` supaya resolve `searxng-core`, FoundationDB dimatikan via `profiles: ["fdb"]`). API port 127.0.0.1:3002, `TEST_API_KEY=[REDACTED]`, `USE_DB_AUTHENTICATION=false`.
5. Fix infrastruktur stack Firecrawl (sesi ini, 5 bug beruntun — semua resolved, `/v1/search` LIVE):
   - **Network mismatch**: override deklarasi `backend` external bernama `firecrawl-backend`, padahal SearXNG ada di network `firecrawl-local` → ganti jadi `name: firecrawl-local` supaya `searxng-core` bisa di-resolve dari container api.
   - **Port merge conflict**: base compose sudah bind `0.0.0.0:3002` dan override tambah `127.0.0.1:3002` → compose MERGE (append) list ports, bukan replace → kedua binding bentrok ("address already in use"). Fix: pakai tag YAML `!override` di override ports supaya replace total (compose v2 mendukung tag ini).
   - **OOM (exit 137)**: api container mem_limit 2500m terlalu kecil untuk harness yang spawn ~10 proses node → naikkan ke 5G (tengah antara rekomendasi base 8G dan RAM VPS 12G).
   - **SEARXNG_ENDPOINT double-path**: base compose hardcode `http://searxng-core:8080/search`, kode v2 tambah `/search` lagi → URL jadi `/search/search` → 404 → fallback DuckDuckGo → diblok anti-bot. Fix: `SEARXNG_ENDPOINT=http://searxng-core:8080` (tanpa `/search`).
   - **Stale docker-proxy / Created container**: siklus create/start yang gagal berulang menyisakan container api berstatus `Created` (tanpa network attach) + docker-proxy lama yang tetap memegang alokasi port → "address already in use" padahal `ss` kosong. Fix: `docker rm -f firecrawl-api-1` lalu `compose up --force-recreate api`. (Catatan: `mdt-kms-api-1` sempat dihentikan karena disangka memegang 3002 — ternyata `PortBindings`-nya kosong; sudah di-start ulang, jalan normal di :33010.)
   - Verifikasi end-to-end: `curl POST http://127.0.0.1:3002/v1/search` (Bearer `[REDACTED]`) return `success:true` + results nyata dari SearXNG.

## Known pre-existing red

- `apps/web/tests/built-boot.snapshot.ts` GAGAL juga di clean HEAD b150a55 (worktree bersih + build penuh): logo svg `viewBox="26 0 156 24"` tidak render + stderr `dynamicCordisRunner/inventory unavailable`. Bukan regresi lokal — jangan disalahkan pada perubahan baru.
