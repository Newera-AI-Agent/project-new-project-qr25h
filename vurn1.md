# VURN-1: Authentication Bypass on `/text/{prompt}` Endpoint (GET)

## Severity: CRITICAL

## Summary
The `/text/{prompt}` GET endpoint on `gen.pollinations.ai` returns AI-generated text responses **without requiring any authentication**. This allows unauthenticated users to consume inference compute resources for free, bypassing the API key authentication system entirely.

## Impact
- **Unauthenticated inference access**: Anyone can generate text completions without an API key
- **Resource theft**: Consumes GPU/compute resources intended for paying/authenticated users
- **Rate limit bypass**: No authentication means no per-key rate limiting or quota enforcement
- **Billing bypass**: No pollen/credits deducted for unauthenticated requests
- **Abuse potential**: Can be used for spam, content generation farms, or DDoS via inference load

## Affected Endpoint
- **URL**: `https://gen.pollinations.ai/text/{prompt}`
- **Method**: GET
- **Path parameter**: `prompt` (URL-encoded text prompt)

## Proof of Concept
```bash
# No Authorization header - returns successful response
curl -s "https://gen.pollinations.ai/text/Hello%20world"
# Returns: "Hello! How can I help you today?"

# With invalid/empty Authorization header - still works
curl -s -H "Authorization: Bearer " "https://gen.pollinations.ai/text/Hello%20world"
# Returns: "Hello! How can I help you today?" (HTTP 200)

# With valid API key - also works (expected)
curl -s -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" "https://gen.pollinations.ai/text/Hello%20world"
# Returns: "Hello! How can I help you today?" (HTTP 200)
```

## Evidence from Live Testing
```
$ curl -s "https://gen.pollinations.ai/text/Hello%20world" -w " HTTP: %{http_code}\n"
Hello! How can I help you today? HTTP: 200

$ curl -s -H "Authorization: Bearer " "https://gen.pollinations.ai/text/Hello%20world" -w " HTTP: %{http_code}\n"
Hello! How can I help you today? HTTP: 200

$ curl -s -X POST https://gen.pollinations.ai/v1/chat/completions -H "Authorization: Bearer " -H "Content-Type: application/json" -d '{"model":"openai-fast","messages":[{"role":"user","content":"Hello"}]}' -w "\nHTTP: %{http_code}\n"
{"success":false,"error":{"message":"Unauthorized","code":"UNAUTHORIZED"}} HTTP: 401
```

**Key finding**: The `/v1/chat/completions` endpoint properly returns 401 Unauthorized without auth, but `/text/{prompt}` returns 200 OK with a valid response.

## Root Cause Analysis
Based on code inspection of `pollinations-repo/gen.pollinations.ai/src/routes/proxy.ts` and `generation-executor.ts`:

The `/text/:prompt` route is registered in multiple places:
1. `proxy.ts:923` - `"/text/:prompt{[\s\S]+}"`
2. `generation-executor.ts:161` - `"/text/:prompt{[\s\S]+}"`
3. `model-registry.ts:43` - `"/text/{prompt}"` (documentation)

The authentication middleware (`requireUser`, `requireModelAccess`) from `src/middleware/auth.ts` is **not applied** to the GET `/text/:prompt` route. The route handler directly executes generation logic without checking for valid API keys.

In contrast, the `/v1/chat/completions` POST endpoint correctly applies the auth middleware chain:
```typescript
// Properly protected route
app.post('/v1/chat/completions', requireUser, requireModelAccess, checkBalance, handler)
```

But `/text/:prompt` GET endpoint lacks these middleware protections.

## Solution / Fix
Apply the same authentication middleware chain to the `/text/:prompt` GET endpoint:

```typescript
// In proxy.ts or generation-executor.ts where the route is defined
import { requireUser, requireModelAccess } from '../middleware/auth.js';
import { checkBalance } from '../utils/generation-access.js';

// Apply auth middleware to GET /text/:prompt
app.get('/text/:prompt{[\s\S]+}', 
  requireUser,           // Validates API key / session token
  requireModelAccess,    // Checks model permissions for the key
  checkBalance,          // Verifies user has sufficient balance
  textGenerationHandler  // Existing handler
);
```

Additionally, ensure the model resolution for `/text/{prompt}` uses a default model that is properly permission-checked against the authenticated key's allowed models.

## Verification Steps
1. Deploy fix to staging
2. Test unauthenticated request returns 401:
   ```bash
   curl -s "https://staging.gen.pollinations.ai/text/test" -w " HTTP: %{http_code}\n"
   # Expected: HTTP 401 Unauthorized
   ```
3. Test authenticated request works:
   ```bash
   curl -s -H "Authorization: Bearer <valid_key>" "https://staging.gen.pollinations.ai/text/test" -w " HTTP: %{http_code}\n"
   # Expected: HTTP 200 with response
   ```
4. Verify billing/pollen deduction occurs for authenticated requests
5. Verify rate limiting applies per API key

## References
- Source: `pollinations-repo/gen.pollinations.ai/src/routes/proxy.ts:923`
- Source: `pollinations-repo/gen.pollinations.ai/src/routes/generation-executor.ts:161`
- Auth middleware: `pollinations-repo/gen.pollinations.ai/src/middleware/auth.ts`
- Live endpoint tested: `https://gen.pollinations.ai/text/{prompt}`

## Disclosure Timeline
- Discovered: 2026-10-23
- Reported: 2026-10-23 (this report)
- Status: Awaiting verification and fix
