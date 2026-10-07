# SYSTEM_MAP — DeepSeek Harness (DSH) v0.1.0-rc.8

> Lokasi: `/opt/deepseek-harness/`
> Repo: `deepseek-ai/deepseek-harness` (bukan QoderAI/better-harness)
> Dibuat: 2026-08-21

## Project Summary

- **Tujuan**: AI coding agent harness — web GUI untuk DeepSeek agent dengan session management, tool execution, subagent delegation, skill system, dan workspace management.
- **Tech stack**: Node.js 22+ TypeScript monorepo (226 packages). Backend: Cordis DI framework (vendored) + node:http. Frontend: Vite 6 + React 19 SPA. Storage: SQLite + JSONL. Build: pnpm 11.7.
- **Arsitektur**: Plugin-based. Semua capability = Service Definition (seam) → Provider (implementation) → Tool Consumer (model-facing). Cordis Loader mount plugins dari `cordis.yml`.
- **API Protocol**: JSON-RPC over HTTP POST + WebSocket. BUKAN REST. Methods: `session.list`, `settings.describe`, `llm.providers`, dll.
- **Run command**: `pnpm dsh web --no-open --trusted-host <host:port>`

## Architecture — Request Flow

```
Browser → http://host:3080/
  → webserver (node:http, packages/host/webserver)
    → static HTML (packages/host/frontend-static → apps/web/dist)
    → /api/* → client-connection (packages/client/connection)
      → api-request-trust: Host header check (loopback + trustedHosts)
      → toFetchHandler (packages/host/apiproxy)
        → RPC parse: type/rpcId/method + payload
        → PRIVILEGED_METHODS check (settings/credentials/llm.discoverModels)
          → loopback-only (trustedHosts TIDAK bypass privileged)
        → dispatch per method → ApiProxy service
          → session.*, workspace.*, skill.*, agentPreset.*, goal.*,
            settings.*, credentials.*, llm.*, host.*, subagent.*
    → /api/events.mux → WebSocket upgrade
      → WebSocketDownlinks (packages/client/connection/websocket-downlink)
      → settings mirror (client butuh ini untuk UI)
```

## Core Logic Flow

### 1. Boot Sequence
```
apps/cli/src/bin.ts → parseDshArgs()
  → runProfile() (apps/cli/src/profile-boot.ts)
    → loadLayeredEnv('dsh') — .env files
    → boot() (packages/boot/app-boot/src/index.ts)
      → resolveDshHome() → ~/.dsh
      → Cordis Loader → load cordis.yml tree
        → mount all plugins (host + client)
        → webserver: listen 127.0.0.1:3080
        → client-connection: register /api routes + WebSocket
        → frontend-static: serve apps/web/dist
```

### 2. RPC Request Flow
```
POST /api/<method>
  → bridge() — read body, validate JSON
  → assertTrustedAuthority() — Host header vs loopback+trustedHosts
  → toFetchHandler() — parse RPC envelope
  → PRIVILEGED_METHODS.has(method) && !isLoopback → 403 forbidden
  → dispatch to method handler via RpcMethodMap
  → return ServerResponse (200 + {ok: true/false, value/error})
```

### 3. WebSocket / Settings Mirror
```
GET /api/events.mux (Upgrade: websocket)
  → WebSocketDownlinks — accept upgrade
  → MuxFrame stream → client receives settings snapshot
  → Client store (ui-settings-models/src/client/store.ts):
    → mirrored = snapshot from WebSocket
    → if (mirrored.error) → throw "settings are unavailable in this browser"
```

### 4. Agent Loop (Core)
```
session.prompt → AgentFactory.createAgent()
  → ReactLoopAgent (packages/core/agent-loop/src/agent.ts)
    → system-prompt assembly (packages/core/system-prompt)
    → LLM call (packages/llm/llm → llm-deepseek adapter)
    → tool execution (packages/core/tools)
      → pre/guard/around/post pipeline
      → tool-specific: bash, fs, web, subagent, etc.
    → session event append (packages/core/session)
    → loop until stop condition
```

## Clean Tree

```
/opt/deepseek-harness/
├── apps/
│   ├── cli/                    # CLI entry (dsh command)
│   │   └── src/bin.ts          # parseDshArgs → runProfile/runPlugin
│   └── web/                    # Vite React 19 SPA frontend
│       ├── src/                # App entry, modules, components
│       └── dist/               # Built static assets
│
├── packages/                   # 226 packages in groups
│   ├── AGENTS.md               # Package conventions
│   ├── core/                   # Product API spine
│   │   ├── agent/              # Agent registry, factory, initiator scope
│   │   ├── agent-loop/         # ReactLoopAgent — concrete agent driving
│   │   ├── session/            # Event-sourced session, append-only log
│   │   ├── tools/              # Tool registry + execution pipeline (1946 lines!)
│   │   ├── system-prompt/      # Ordered system sections registry
│   │   └── scope/              # Scoped-context primitive (ScopeKey, routing)
│   │
│   ├── host/                   # Web-GUI host half
│   │   ├── webserver/          # node:http server, route registries
│   │   ├── apiproxy/           # RPC fetch handler, method dispatch
│   │   ├── frontend-static/    # Serve apps/web/dist
│   │   ├── directory-picker*/  # Native/browse directory selection
│   │   └── plugin-inventory/   # Plugin discovery
│   │
│   ├── client/                 # Web-GUI browser half (40+ packages)
│   │   ├── connection/         # ★ Host HTTP bridge + WebSocket + trust fence
│   │   │   └── src/index.ts    # PRIVILEGED_METHODS, isTrustedApiRequest
│   │   ├── web/                # Vite entry, AppWebEntry, static modules
│   │   ├── runtime/            # Browser runtime (empty host-side)
│   │   ├── ui-*/               # UI plugins (sidebar, conversation, settings, etc.)
│   │   ├── modules/            # Client module system
│   │   └── locale/             # i18n
│   │
│   ├── llm/                    # LLM capability family
│   │   ├── llm/                # Service Definition: adapter registry + streaming
│   │   ├── llm-deepseek/       # DeepSeek provider adapter
│   │   ├── llm-retry/          # Retry policy
│   │   └── token-meter/        # Token counting
│   │
│   ├── session/                # Durable session data plane
│   │   ├── session-persistence/        # Service Definition (JSONL/SQLite)
│   │   ├── session-persistence-sqlite/ # SQLite backend
│   │   ├── session-projection/         # Derived views
│   │   ├── session-query/              # Search, FTS, lineage
│   │   └── session-title*/             # Auto-title generation
│   │
│   ├── shell/                  # Bash capability
│   │   ├── shell/              # Service Definition
│   │   ├── bash-local/         # Local bash executor
│   │   └── tool-bash*/         # Model-facing bash tools
│   │
│   ├── fs/                     # Filesystem capability
│   │   ├── fs/                 # Service Definition
│   │   ├── fs-local/           # Local filesystem provider
│   │   ├── tool-fs*/           # Model-facing file tools
│   │   └── tool-str-replace-editor/  # str_replace_editor tool
│   │
│   ├── subagent/               # Subagent capability
│   │   ├── subagent/           # Service Definition (multi-provider registry)
│   │   ├── subagent-acp/       # ACP provider
│   │   ├── subagent-claude-code/ # Claude Code provider
│   │   └── tool-subagent*/     # Model-facing delegation tool
│   │
│   ├── settings/               # User-settings seam
│   │   ├── settings/           # Service Definition (namespace registry)
│   │   └── settings-file/      # File-backed provider
│   │
│   ├── credentials/            # Credential-reference seam
│   │   ├── credentials/        # Service Definition (ref → value)
│   │   └── credentials-local/  # Env-over-.env provider
│   │
│   ├── preset/                 # Agent presets
│   │   └── agent-presets/      # cordis.yml composition, standing mount
│   │
│   ├── skill/                  # Skill capability
│   │   ├── skill/              # Provider registry
│   │   └── skill-filesystem/   # Local filesystem provider
│   │
│   ├── boot/                   # App boot glue
│   │   └── app-boot/           # ★ Loader, profiles, config (829 lines)
│   │
│   ├── api/                    # Remote BFF + Typert RPC gateway
│   ├── interaction/            # Human-collaboration (approval, commands, questions)
│   ├── workflow/               # Workflow engine + ralph tool
│   ├── web/                    # Web search/fetch capability
│   ├── terminal/               # Persistent PTY sessions
│   ├── lsp/                    # LSP capability
│   ├── sandbox/                # Process confinement (bwrap/Landlock/Seatbelt)
│   ├── storage/                # Non-session storage hub
│   ├── compaction/             # Context compaction
│   ├── context/                # Model-visible request context
│   ├── goal/                   # Same-session goal persistence
│   ├── schedule/               # Session-local scheduled follow-ups
│   ├── plan/                   # Plan mode collaboration state
│   ├── guard/                  # Loop-hygiene guards
│   ├── bundle/                 # Installable profile patch layers
│   ├── extensions/             # Runtime self-modification (Cordis)
│   ├── hooks/                  # Claude Code / Codex hook bridges
│   ├── workspace/              # Workspace entity registry
│   ├── sdk/                    # Out-of-process JSON-RPC SDK
│   ├── acp/                    # Agent Client Protocol server
│   ├── attachment/             # Durable attachment storage
│   ├── spill/                  # Tool-result spill storage
│   ├── todo/                   # todo_write tool
│   ├── jobs/                   # Background job runtime
│   ├── feedback/               # Human feedback
│   ├── identity/               # Anonymous user id
│   ├── e2b/                    # E2B sandbox providers (POC)
│   ├── experimental/           # Private prototypes (Agent Teams)
│   ├── typert/                 # Type graph generation + RPC
│   ├── test-support/           # Test infrastructure
│   └── util/                   # Zero-dep utilities
│
├── vendor/                     # Vendored Cordis framework
│   ├── cordis/                 # Core DI: Context, Service, Fiber, Events
│   ├── loader/                 # Plugin loader (Entry, EntryGroup, EntryTree)
│   ├── schemastery/            # Schema validation (like zod)
│   ├── cosmokit/               # Utility helpers
│   ├── include/                # YAML config include + patch
│   ├── group/                  # Entry group
│   ├── hmr/                    # Hot module replacement
│   ├── timer/                  # Timer service
│   └── logger-console/         # Console logger
│
├── native/landlock-run/        # Linux Landlock sandbox (Rust)
├── python/                     # Python SDK
├── scripts/                    # Build, verify, release scripts
├── docs/                       # Documentation
├── examples/                   # Demo bundles (ACP, headless, JSON-RPC)
└── website/                    # VitePress doc site
```

## Module Map — Critical Files

| File | Fungsi | Peran |
|------|--------|-------|
| `apps/cli/src/bin.ts` | Entry point, arg parsing | Dispatch ke profile/plugin/dump-config |
| `packages/boot/app-boot/src/index.ts` | Boot glue (829 lines) | Loader, profiles, config resolution |
| `packages/host/webserver/src/index.ts` | HTTP server | Route registries, upgrade handling |
| `packages/host/apiproxy/src/fetch/handler.ts` | RPC handler (320 lines) | Parse RPC envelope, dispatch methods |
| `packages/client/connection/src/index.ts` | ★ Client connection (196 lines) | Trust fence, PRIVILEGED_METHODS, WebSocket |
| `packages/core/agent-loop/src/index.ts` | Agent loop (713 lines) | ReactLoopAgent creation, lifecycle |
| `packages/core/tools/src/index.ts` | Tool registry (1946 lines!) | Tool pipeline, execution, SDK rendering |
| `packages/core/session/src/index.ts` | Session service (1157 lines) | Event-sourced session, message history |
| `packages/core/system-prompt/src/index.ts` | System prompt registry | Ordered sections, dynamic context |
| `packages/core/scope/src/index.ts` | Scoped context | ScopeKey, routing events |
| `packages/llm/llm/src/index.ts` | LLM service | Adapter registry, streaming |
| `packages/settings/settings/src/index.ts` | Settings seam | Namespace registry, schema validation |
| `packages/credentials/credentials/src/index.ts` | Credentials seam | Ref → value resolution |
| `packages/client/connection/src/api-request-trust.ts` | Trust fence | isTrustedApiRequest, assertTrustedAuthority |
| `packages/client/connection/src/websocket-downlink.ts` | WebSocket | Accept/reject upgrade, MuxFrame stream |

## RPC Methods (via /api/*)

| Method | Privileged? | Deskripsi |
|--------|-------------|-----------|
| `session.list` | No | List sessions |
| `session.create` | No | Create session |
| `session.prompt` | No | Send prompt to agent |
| `session.history` | No | Get session history |
| `session.search` | No | Search sessions |
| `session.models` | No | List models for session |
| `session.selectModel` | No | Select model |
| `session.rename` | No | Rename session |
| `session.fork` | No | Fork session |
| `session.cancel` | No | Cancel running agent |
| `workspace.list` | No | List workspaces |
| `workspace.create` | No | Create workspace |
| `agentPreset.list` | No | List agent presets |
| `skill.list` | No | List skills (needs sessionId) |
| `goal.list` | No | List goals |
| `host.describe` | No | Host info |
| `host.listDirectory` | No | List directory |
| `llm.providers` | No | List LLM providers |
| `llm.models` | No | List LLM models |
| `subagent.list` | No | List subagents (needs parentSessionId) |
| **`settings.describe`** | **Yes** | **★ Settings mirror — loopback only** |
| **`settings.update`** | **Yes** | Update settings |
| **`settings.replace`** | **Yes** | Replace settings |
| **`settings.mutate`** | **Yes** | Mutate settings |
| **`settings.openDocument`** | **Yes** | Open settings file |
| **`credentials.describe`** | **Yes** | Describe credentials (needs refs[]) |
| **`credentials.set`** | **Yes** | Set credential |
| **`credentials.unset`** | **Yes** | Unset credential |
| **`llm.discoverModels`** | **Yes** | Discover models (carries credential) |

## Data & Config

| Path | Isi |
|------|-----|
| `~/.dsh/` | DSH home — settings, credentials, profiles |
| `~/.dsh/settings.json` | User settings (per-namespace sections) |
| `~/.dsh/credentials/` | Credential storage |
| `~/.dsh/profiles/` | Profile compositions |
| `/opt/deepseek-harness/apps/cli/config/agent-presets/` | Built-in presets (standard, code, minimal, cordis) |
| `packages/host/apiproxy/src/api/rpc-map.ts` | RPC method → handler mapping |

## Deployment Status (UPDATED 2026-08-21)

| Component | Status | Detail |
|-----------|--------|--------|
| DSH process | ✅ Running | `pnpm dsh web --no-open --trusted-host dsh.zcus.tech --trusted-host 168.110.219.31:30081` |
| socat forward | ✅ Running | 0.0.0.0:30081 → 127.0.0.1:3080 (direct access) |
| Direct IP access | ✅ Working | http://168.110.219.31:30081 |
| WebSocket (direct) | ✅ Working | 101 Switching Protocols |
| Cloudflare (dsh.zcus.tech) | ✅ 200 | Fixed: DNS CNAME → tunnel + ingress rule |
| WebSocket (Cloudflare) | ✅ Working | 101 via HTTP/1.1 upgrade |
| Cloudflared service | ✅ Running | systemd, token-based remote-managed tunnel |

### Fix Applied: Cloudflare 502 (RESOLVED)
1. Added tunnel ingress via API: `PUT /accounts/<id>/cfd_tunnel/5e599a8f-d18c-4d86-bfe8-39920e3c0af4/configurations` → dsh.zcus.tech → http://localhost:3080
2. Updated DNS record (was A → IP, now CNAME → `5e599a8f-d18c-4d86-bfe8-39920e3c0af4.cfargotunnel.com`, proxied)
3. Restarted cloudflared.service

### Cloudflare API Auth
- Global API key: `/etc/cloudflare.ini` (X-Auth-Email + X-Auth-Key headers, NOT Bearer!)
- Email: zcusgt@gmail.com
- Tunnel token (Bearer, tunnel ops only): in `/etc/systemd/system/cloudflared.service`
- Account ID: a9ea36349c8d1253ceda6d8f247c3289
- Tunnel ID (VPS 6): 5e599a8f-d18c-4d86-bfe8-39920e3c0af4
- Zone zcus.tech: 8422630d773ad9a417ec35e189a036d5

## Known Issues & Fixes Applied

### ⚠️ CRITICAL: credentials file format (crash-loop incident 2026-08-22)
`/root/.dsh/.credentials.yaml` MUST be flat mapping, NO nesting:
```yaml
REF_NAME: value          # correct — flat key: string value
```
WRONG formats that crash DSH at boot (systemd restart loop):
```yaml
version: 1               # ← 'version' key + numeric value = TypeError at boot
refs:                    # ← nested map = TypeError at boot
  KEY: value
```
Symptom: `journalctl -u dsh` shows `the value for "version" in .credentials.yaml must be a string`, restart counter climbing. Fix: rewrite file as flat mapping (keep all keys), `systemctl daemon-reload && systemctl restart dsh`. Broken copies kept at `/root/.dsh/.credentials.yaml.broken-*`.

### Client-side "settings are unavailable in this browser" (RESOLVED 2026-08-21)
Root cause: browser via Cloudflare hostname → `isLoopback=false` → settings mirror runs in `'memory'` mode → skips all settings.describe reads, even though server allows trusted hosts.
Fix: `packages/client/connection/src/client/index.ts` — `isLoopback` now also true for `dsh.zcus.tech` / `*.zcus.tech`. Rebuilt with `npm run build` (root). Plugin bundles served with `cache-control: no-cache`, so hard refresh (Ctrl+Shift+F5) loads new code.

### Fix Applied: PRIVILEGED_METHODS trust fence
- **File**: `packages/client/connection/src/index.ts`
- **Change**: `isTrustedApiRequest(request, [])` → `isTrustedApiRequest(request, trustedHosts)`
- **Effect**: Trusted hosts can now access non-privileged APIs. Privileged methods tetap loopback-only.

### Remaining: Cloudflare 502
- **Root cause**: Cloudflare tunnel (token-based, PID 565649) tidak dikonfigurasi untuk route dsh.zcus.tech
- **Solusi**: Tambah ingress rule di Cloudflare dashboard, atau buat tunnel lokal baru
- **Workaround**: Akses via http://168.110.219.31:30081

### Architecture Notes
- `settings.describe` = PRIVILEGED → loopback-only by design (DNS-rebinding fence, not auth)
- `trustedHosts` = DNS-rebinding fence ONLY, bukan authentication
- Client butuh WebSocket `/api/events.mux` untuk settings mirror → tanpa ini, UI error "settings are unavailable in this browser"
- Cloudflare HTTP/2 tidak support WebSocket Upgrade → perlu HTTP/1.1 atau bypass

## Vendor Framework (Cordis)

| Package | Fungsi |
|---------|--------|
| `vendor/cordis` | Core DI: Context, Service, Fiber, Events, Plugin |
| `vendor/loader` | Plugin loader: Entry, EntryGroup, EntryTree, config interpolation |
| `vendor/schemastery` | Schema validation (zod-like, custom) |
| `vendor/cosmokit` | Utility: array, types, string, time helpers |
| `vendor/include` | YAML config include + `!!js` expression support |
| `vendor/hmr` | Hot module replacement via chokidar |
| `vendor/timer` | Timer service: timeout, interval, throttle, debounce |
| `vendor/logger-console` | Console logger with util.inspect formatting |

## Key Patterns

1. **Service Definition → Provider → Consumer**: Setiap capability punya 3 layer. Definition = abstract interface. Provider = concrete implementation. Consumer = model-facing tool.
2. **Scope-based routing**: `@deepseek-ai/dsh-scope` — ScopeKey tags registrations, events route by scope chain.
3. **Cordis plugin model**: `name` + `inject` + `Config` + `apply(ctx)`. Function plugins named-export, service plugins default-export.
4. **Event-sourced sessions**: All session state = append-only event log. Projections derive from events.
5. **RPC over HTTP**: NOT REST. POST `/api/<method>` with `{type:"client-request", rpcId, method, payload}`. Response: `{type:"server-response", rpcId, result:{ok, value/error}}`.
