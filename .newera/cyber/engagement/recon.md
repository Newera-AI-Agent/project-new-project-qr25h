# Engagement recon — pollinations/pollinations

- Repo under test: `https://github.com/pollinations/pollinations` (cloned to `/tmp/poll/pollinations`)
- HEAD at recon start: `8ffdc2c` ("feat: new Barbaras start on GPT-6.1 Sol, which Quest Pollen pays for (#18181)")
- Our repo (this one) holds the deliverable markdown reports (`vurn1.md`, ...).
- Authorization: user-provided testing API key (2 pollen), bug-bounty style. No PRs, no DoS, no destructive
  actions. Source review is the primary mode; live requests are low-volume and authenticated.
- Scope file: `.newera/cyber/scope.json`.

## Architecture map

- `gen.pollinations.ai` — generation gateway (text / image / audio / embeddings / realtime / mcp).
- `enter.pollinations.ai` — dashboard + API-key + billing + community endpoints + quests/rewards.
- `shared/` — registry, billing (`bucket-selection.ts`, `deduction.ts`, `balance.ts`, `rewards.ts`),
  community-endpoint URL validation.
- `media.pollinations.ai`, `pollinations.ai` — frontends.

## Areas examined so far (static)

- `shared/billing/deduction.ts` — `atomicDeductUserBalance` bucket ladder; `amount <= 0` early-return;
  `atomicReserveApiKeyBalance` / `atomicAdjustApiKeyBalance` / `atomicCreditUserBalance`.
- `shared/billing/rewards.ts` — reward ledger idempotency + `claimReward` guarded by `changes() = 1`.
- `enter.pollinations.ai/src/routes/{referral,promo-codes,quest-grants}.ts` — code redemption paths.
- `shared/registry/model-permissions.ts` — `keyAllowsModel` (null/undefined = allow all).

## Open threads

1. Community-endpoint proxy SSRF surface (`gen.pollinations.ai/src/text/communityEndpoint.ts`,
   `image/communityEndpoint.ts`, `embeddings/communityEndpoint.ts`,
   `enter.pollinations.ai/src/routes/community-endpoints/*`) — redirect handling.
2. Auth / model-permission middleware (`gen.pollinations.ai/src/middleware/auth.ts`, `model.ts`).
3. Billing: can a generation be served while the charge is skipped (cache hit, refusal, error path)?
4. Any route reachable without the expected auth/authorization guard.