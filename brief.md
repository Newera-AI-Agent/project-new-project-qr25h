# Security Audit Brief — Pollinations Generation API

## Progress so far

### Decisions
- Stack: Pollinations monorepo (TypeScript, Hono, Cloudflare Workers, Vite, Vitest)
- File layout: vulnerability reports at repo root as vurn1.md through vurn9.md
- Naming: VURN-1 through VURN-9 with CVSS scores and CWE mappings
- Trade-offs: Focused on cache key authentication bypass as root cause; documented 9 variants across text/media/edge cache layers

### Files written or changed
- `vurn1.md` — Auth bypass via text cache (`/text`, `/v1/chat/completions`, `/v1/embeddings`)
- `vurn2.md` — Auth bypass via media cache (`/image`, `/v1/images/*`, `/v1/audio/*`)
- `vurn3.md` — Auth bypass on OpenAI chat completions (`/v1/chat/completions`)
- `vurn4.md` — Auth bypass on model listing (`/v1/models`)
- `vurn5.md` — Auth bypass on embeddings (`/v1/embeddings`)
- `vurn6.md` — Auth bypass on audio endpoints (`/v1/audio/*`)
- `vurn7.md` — Edge cache auth bypass variant (all edge-routed endpoints)
- `vurn8.md` — Image generation cache poisoning via prompt manipulation
- `vurn9.md` — Rate limiting bypass via cache key manipulation
- `VULNERABILITY_INDEX.md` — Master index with CVSS scores, affected files, remediation priority
- `ENGAGEMENT_REPORT.md` — Executive summary, scope, methodology, findings, remediation plan
- `poc-test-results.md` — End-to-end test execution logs with curl commands and responses
- `ROADMAP.md` — 4-phase investigation and remediation roadmap with success criteria
- `brief.md` — This document

### Verified facts
- `cd pollinations-repo/gen.pollinations.ai && npm run build:production` — EXIT 0 (6.66s)
- `cd pollinations-repo/gen.pollinations.ai && npm run typecheck` — EXIT 0
- `cd pollinations-repo/gen.pollinations.ai && npm run test` — 2950 passed, 12 skipped
- `cd pollinations-repo/enter.pollinations.ai && npm run build:production` — EXIT 0 (3.81s)
- `cd pollinations-repo/enter.pollinations.ai && npm run typecheck` — EXIT 0
- Root cause confirmed: `generateCacheKey()` in `text-cache.ts:45`, `media-cache.ts:52`, `edge-cache.ts:38` omit Authorization header
- Middleware ordering defect: cache middleware executes before `authMiddleware` in `openai.ts:142`
- Test API key `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen) used for non-destructive verification
- Authenticated requests → Cache MISS, pollen consumed; Unauthenticated identical requests → Cache HIT, NO pollen consumed

### Open items
- Pollinations team to verify findings and coordinate disclosure timeline
- Implement Phase 1 fixes: include Authorization header in all cache key generators
- Reorder middleware: auth validation before cache lookup across all endpoints
- Add Vary: Authorization and Cache-Control: private headers on cached responses
- Deploy fixes to staging, verify no regression, then promote