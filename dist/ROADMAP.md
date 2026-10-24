# Pollinations Security Audit - Remediation Roadmap

**Generated:** 2026-10-24
**Engagement:** Security audit of gen.pollinations.ai API
**Scope:** 9 Critical/High vulnerabilities across authentication bypass, cache poisoning, and rate limit bypass

---

## Executive Summary

All 9 vulnerabilities share a **common root cause**: **missing Authorization header in cache key generation** combined with **middleware ordering defect** where cache lookup executes before authentication validation.

Affected files:
- `src/utils/text-cache.ts` - `generateCacheKey()`
- `src/utils/media-cache.ts` - `generateCacheKey()`
- `src/middleware/edge-cache.ts` - `generateEdgeCacheKey()`

---

## Phase 1: Immediate Mitigation (0-24 hours) - CRITICAL

### 1.1 Fix Cache Key Generation - Add Authorization Header

**Files to modify:**
- `src/utils/text-cache.ts`
- `src/utils/media-cache.ts`
- `src/middleware/edge-cache.ts`

**Change:** Include `Authorization` header (or derived user identity) in cache key hash.

```typescript
// BEFORE (vulnerable)
function generateCacheKey(request: Request): string {
  const url = new URL(request.url);
  return hash(`${url.pathname}${url.search}`);
}

// AFTER (fixed)
function generateCacheKey(request: Request): string {
  const url = new URL(request.url);
  const auth = request.headers.get('Authorization') || 'anonymous';
  return hash(`${url.pathname}${url.search}:${auth}`);
}
```

**Verification:** Deploy to staging, run poc-test-results.md test suite, confirm all 9 PoCs fail.

### 1.2 Fix Middleware Ordering - Auth Before Cache

**File:** `src/middleware/index.ts` (or wherever middleware pipeline is defined)

**Change:** Ensure authentication middleware runs BEFORE cache lookup middleware.

```typescript
// BEFORE (vulnerable)
app.use(cacheMiddleware);
app.use(authMiddleware);

// AFTER (fixed)
app.use(authMiddleware);
app.use(cacheMiddleware);
```

**Verification:** Same test suite - unauthenticated requests should return 401, not cached responses.

### 1.3 Emergency Cache Invalidation

**Action:** Invalidate all existing cache entries that may have been poisoned.

```bash
# Redis/Cloudflare cache purge
redis-cli FLUSHALL
# Or Cloudflare API purge
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -d '{"purge_everything":true}'
```

**Verification:** First request after deploy should be cache MISS for all endpoints.

---

## Phase 2: Defense in Depth (1-7 days) - HIGH

### 2.1 Add Cache Partitioning by User Identity

Implement cache namespaces per API key / user.

```typescript
// Cache key includes user identity hash
function generateCacheKey(request: Request, userId: string): string {
  const url = new URL(request.url);
  return `user:${userId}:${hash(`${url.pathname}${url.search}`)}`;
}
```

### 2.2 Implement Cache-Control Headers for Authenticated Responses

```typescript
// Never cache authenticated responses at edge
if (request.headers.has('Authorization')) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Authorization');
}
```

### 2.3 Add Request Signing for Cache-Sensitive Operations

For image generation and other billing-sensitive endpoints, require signed requests.

```typescript
// Validate request signature before cache lookup
function validateRequestSignature(request: Request): boolean {
  const signature = request.headers.get('X-Request-Signature');
  const timestamp = request.headers.get('X-Request-Timestamp');
  // Verify HMAC...
}
```

### 2.4 Implement Per-User Rate Limiting (Post-Auth)

Move rate limiting to AFTER authentication, keyed by user identity.

```typescript
// Rate limit by authenticated user, not IP
const rateLimitKey = `ratelimit:user:${userId}:${endpoint}`;
```

---

## Phase 3: Architecture Hardening (1-4 weeks) - MEDIUM

### 3.1 Implement Cache Segregation by Sensitivity

| Endpoint Type | Cache Strategy |
|---------------|----------------|
| Public models list | Public cache (no auth needed) |
| Free tier generation | User-scoped cache, short TTL |
| Paid tier generation | No cache (always fresh) |
| Embeddings | User-scoped cache |
| Audio generation | No cache |

### 3.2 Add Audit Logging for Cache Hits/Misses

Log all cache operations with user identity for anomaly detection.

```typescript
logger.info('cache_operation', {
  userId,
  endpoint,
  cacheHit: true,
  cacheKey: hash(cacheKey),
  responseSize
});
```

### 3.3 Implement Cache Poisoning Detection

Monitor for:
- Identical cache keys from different users
- Unusually high cache hit rates from unauthenticated requests
- Cache keys matching known attack patterns

### 3.4 Add Integration Tests for Auth-Cache Boundary

```typescript
// tests/security/cache-auth-boundary.test.ts
describe('Cache-Auth Boundary', () => {
  test('unauthenticated request never returns cached authenticated response', async () => {
    // ... test implementation
  });
  
  test('different users never share cache entries', async () => {
    // ... test implementation
  });
});
```

---

## Phase 4: Ongoing Security Program (Ongoing) - LOW

### 4.1 Security Regression Testing in CI

Add to `.github/workflows/security.yml`:

```yaml
- name: Security Regression Tests
  run: npm run test:security
```

### 4.2 Automated Dependency Scanning

Enable Dependabot and Snyk for supply chain security.

### 4.3 Annual Penetration Testing

Schedule third-party pen test focusing on auth-cache boundary.

### 4.4 Bug Bounty Program

Launch formal bug bounty on HackerOne/Intigriti with scope including:
- gen.pollinations.ai
- enter.pollinations.ai
- API authentication & billing

---

## Test Plan for Each Phase

| Phase | Test Command | Expected Result |
|-------|--------------|-----------------|
| 1.1 | `npm run test:security:poc` | All 9 PoCs return 401 or fresh generation |
| 1.2 | `npm run test:middleware:order` | Auth middleware runs before cache |
| 2.1 | `npm run test:cache:partition` | Different users get different cache keys |
| 2.2 | `npm run test:headers:cache-control` | Auth responses have no-store |
| 3.1 | `npm run test:cache:segregation` | Sensitivity-based cache strategy works |
| 3.4 | `npm run test:security:integration` | All auth-cache boundary tests pass |

---

## Rollback Plan

If Phase 1 changes cause regression:

1. Revert cache key changes: `git revert <commit-hash>`
2. Re-enable old middleware order
3. Monitor error rates for 15 minutes
4. Re-deploy with fix

---

## Contacts

- **Security Team:** security@pollinations.ai
- **Engineering Lead:** [TBD]
- **Incident Response:** incident@pollinations.ai

---

## Appendix: Vulnerability Mapping to Fixes

| Vulnerability | Phase 1 Fix | Phase 2 Fix | Phase 3 Fix |
|---------------|-------------|-------------|-------------|
| VURN-1: Text Cache Auth Bypass | 1.1, 1.2 | 2.1 | 3.1 |
| VURN-2: Media Cache Auth Bypass | 1.1, 1.2 | 2.1 | 3.1 |
| VURN-3: Chat Completions Bypass | 1.1, 1.2 | 2.1, 2.3 | 3.1 |
| VURN-4: Models Listing Bypass | 1.1, 1.2 | 2.1 | 3.1 |
| VURN-5: Embeddings Bypass | 1.1, 1.2 | 2.1 | 3.1 |
| VURN-6: Audio Endpoints Bypass | 1.1, 1.2 | 2.1, 2.3 | 3.1 |
| VURN-7: Edge Cache Variant | 1.1, 1.2 | 2.1, 2.2 | 3.1, 3.3 |
| VURN-8: Cache Poisoning | 1.1, 1.3 | 2.2, 2.3 | 3.3 |
| VURN-9: Rate Limit Bypass | 1.2 | 2.4 | 3.2, 3.3 |

---

*End of Roadmap*