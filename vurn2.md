# VURN-2: Authentication Bypass on `/v1/responses` Endpoint (POST)

## Severity: CRITICAL

## Summary
The `/v1/responses` POST endpoint on `gen.pollinations.ai` accepts requests and returns AI-generated responses **without requiring any authentication**. This is a second authentication bypass affecting a different API endpoint (OpenAI Responses API compatible), allowing unauthenticated users to consume inference resources.

## Impact
- **Unauthenticated inference access**: Anyone can generate responses without an API key
- **Resource theft**: Consumes GPU/compute resources intended for paying/authenticated users
- **Rate limit bypass**: No authentication means no per-key rate limiting or quota enforcement
- **Billing bypass**: No pollen/credits deducted for unauthenticated requests
- **API compatibility abuse**: Mimics OpenAI Responses API format, making it easy to integrate into unauthorized applications

## Affected Endpoint
- **URL**: `https://gen.pollinations.ai/v1/responses`
- **Method**: POST
- **Body**: JSON with `model`, `input`, and optional parameters

## Proof of Concept
```bash
# No Authorization header - returns successful response
curl -s -X POST https://gen.pollinations.ai/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"openai-fast","input":"Hello world"}'
# Returns: Valid response object with generated text (HTTP 200)

# With invalid/empty Authorization header - still works
curl -s -X POST https://gen.pollinations.ai/v1/responses \
  -H "Authorization: Bearer " \
  -H "Content-Type: application/json" \
  -d '{"model":"openai-fast","input":"Hello world"}'
# Returns: Valid response object (HTTP 200)

# With valid API key - also works (expected)
curl -s -X POST https://gen.pollinations.ai/v1/responses \
  -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai-fast","input":"Hello world"}'
# Returns: Valid response object (HTTP 200)
```

## Evidence from Live Testing
```
$ curl -s -X POST https://gen.pollinations.ai/v1/responses -H "Content-Type: application/json" -d '{"model":"openai-fast","input":"Hello world"}' -w "\nHTTP: %{http_code}\n"
{"id":"resp_...","object":"response","created":...,"model":"openai-fast","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you today?"}]}],"usage":{"input_tokens":2,"output_tokens":9,"total_tokens":11}} HTTP: 200

$ curl -s -X POST https://gen.pollinations.ai/v1/responses -H "Authorization: Bearer " -H "Content-Type: application/json" -d '{"model":"openai-fast","input":"Hello world"}' -w "\nHTTP: %{http_code}\n"
{"id":"resp_...","object":"response","created":...,"model":"openai-fast","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you today?"}]}],"usage":{"input_tokens":2,"output_tokens":9,"total_tokens":11}} HTTP: 200

$ curl -s -X POST https://gen.pollinations.ai/v1/chat/completions -H "Authorization: Bearer " -H "Content-Type: application/json" -d '{"model":"openai-fast","messages":[{"role":"user","content":"Hello"}]}' -w "\nHTTP: %{http_code}\n"
{"success":false,"error":{"message":"Unauthorized","code":"UNAUTHORIZED"}} HTTP: 401
```

**Key finding**: The `/v1/chat/completions` endpoint properly returns 401 Unauthorized without auth, but `/v1/responses` returns 200 OK with a valid response object.

## Root Cause Analysis
Based on code inspection and endpoint behavior:

The `/v1/responses` endpoint appears to be an OpenAI Responses API compatibility layer. Like the `/text/{prompt}` endpoint, it lacks the authentication middleware chain (`requireUser`, `requireModelAccess`, `checkBalance`) that protects `/v1/chat/completions`.

The route is likely defined in `proxy.ts` or `generation-executor.ts` without the auth middleware applied. The handler directly processes the request and forwards to the model inference pipeline without validating the API key.

## Solution / Fix
Apply the same authentication middleware chain to the `/v1/responses` POST endpoint:

```typescript
// In proxy.ts or generation-executor.ts where the route is defined
import { requireUser, requireModelAccess } from '../middleware/auth.js';
import { checkBalance } from '../utils/generation-access.js';

// Apply auth middleware to POST /v1/responses
app.post('/v1/responses',
  requireUser,           // Validates API key / session token
  requireModelAccess,    // Checks model permissions for the key
  checkBalance,          // Verifies user has sufficient balance
  responsesHandler       // Existing handler
);
```

Additionally:
1. Ensure the `model` parameter from the request body is validated against the authenticated key's allowed models
2. Apply the same model permission logic used in `/v1/chat/completions` (via `keyAllowsModel` from `@shared/registry/model-permissions`)
3. Ensure billing/pollen deduction occurs via the `checkBalance` middleware

## Verification Steps
1. Deploy fix to staging
2. Test unauthenticated request returns 401:
   ```bash
   curl -s -X POST https://staging.gen.pollinations.ai/v1/responses \
     -H "Content-Type: application/json" \
     -d '{"model":"openai-fast","input":"test"}' \
     -w " HTTP: %{http_code}\n"
   # Expected: HTTP 401 Unauthorized
   ```
3. Test authenticated request works:
   ```bash
   curl -s -X POST https://staging.gen.pollinations.ai/v1/responses \
     -H "Authorization: Bearer <valid_key>" \
     -H "Content-Type: application/json" \
     -d '{"model":"openai-fast","input":"test"}' \
     -w " HTTP: %{http_code}\n"
   # Expected: HTTP 200 with response
   ```
4. Verify billing/pollen deduction occurs for authenticated requests
5. Verify rate limiting applies per API key
6. Verify model access control: keys restricted to certain models cannot access others via /v1/responses

## References
- Likely source: `pollinations-repo/gen.pollinations.ai/src/routes/proxy.ts` (search for `/v1/responses`)
- Likely source: `pollinations-repo/gen.pollinations.ai/src/routes/generation-executor.ts`
- Auth middleware: `pollinations-repo/gen.pollinations.ai/src/middleware/auth.ts`
- Model permissions: `pollinations-repo/shared/registry/model-permissions.ts`
- Live endpoint tested: `https://gen.pollinations.ai/v1/responses`

## Disclosure Timeline
- Discovered: 2026-10-23
- Reported: 2026-10-23 (this report)
- Status: Awaiting verification and fix
