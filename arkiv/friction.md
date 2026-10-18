# Building Claim Check on Arkiv: friction report

Versions: `@arkiv-network/sdk` **0.8.1**, `viem` **2.38.2**, Bun **1.2.23** and Node **24.21.0**, Arkiv **Tiramisu** (chain `7738577`), 18 October 2026, blocks ~725,400–726,500.
Every item below has a script that reproduces it and a saved result. Read-only cases need no key: `bun scripts/friction-repro.ts` → [`evidence/friction-repro.jsonl`](evidence/friction-repro.jsonl). Write cases: `bun scripts/probe-cost.ts …` → [`evidence/probe-cost.jsonl`](evidence/probe-cost.jsonl).

Items marked **Issue** cost us time or would mislead a user; items marked **Worked** are paths we tested that behaved as documented, reported with the same rigour.

---

## 1. Issue: a batch of 50 creates fails with an opaque error

- **Expected:** `executeBatch({ creates })` with 50 entities either lands, or fails with a message naming the limit (gas cap, batch size), ideally before sending.
- **Actual:** `Transaction failed: Execution error without revert data`. 25 creates succeed (3,448,600 gas, 137,944 per entity); 50 and 70 fail with that message; 100 fails the same way.
- **Steps:** `PUBLISHER_PRIVATE_KEY=0x… bun scripts/probe-cost.ts 25 50 70 100`. Each probe entity has 11 attributes and a ~180-byte JSON payload and expires after one hour.
- **Impact:** we had to bisect a safe batch size by spending gas. Our 5,561-event publish runs at 25 per transaction (223 transactions instead of about 56).
- **What would fix it:** document the per-transaction gas or operation cap. Have `executeBatch` estimate gas and reject (or split) an oversized batch client-side with the actual limit in the message.

## 2. Issue: `page.next()` in the SDK fails as soon as the chain head moves, with a misleading message

- **Expected:** `const page = await client.select(...).where(...).limit(5).fetch(); await page.next()` returns the following page, as in the README's pagination example.
- **Actual:** after ~4.5 s (two blocks), `page.next()` throws `Query rejected (cursor, -32005): Request exceeds defined limit..`. The node's own message for the same code is accurate: `cursor belongs to a different query, block or select — start a new page-through`, but the SDK replaces it with "Request exceeds defined limit".
- **Raw RPC, same data:** continuing with only `cursor` fails with −32005; continuing with `cursor` **plus `atBlock` set to the first page's `blockNumber`** returns the next page (cases `cursor-unpinned` / `cursor-pinned-atBlock`).
- **Steps:** `bun scripts/friction-repro.ts` (case `sdk-next-after-head-moves`).
- **Impact:** any result longer than one page breaks on a 2-second-block chain unless the first page and the next request land in the same block. We wrote our own pagination in `shared/arkiv-read.js` that pins `atBlock`.
- **What would fix it:** in the query builder, carry the first response's `blockNumber` into every continuation request as `atBlock`. Surface the node's −32005 message verbatim.

## 3. Issue: a bare number in a range over a `u64` attribute silently matches nothing

- **Expected:** `effective >= 1700000000` against a `u64` attribute returns the same entities as `effective >= u64(1700000000)`, or fails with a type error.
- **Actual:** bare: **0** results, no error. Typed: **85**. The SDK's `gte("effective", u64(1700000000n))` also returns 85.
- **Steps:** `bun scripts/friction-repro.ts` (case `u64-range-bare-number`).
- **Impact:** an empty result that looks like a real answer. In our domain that would read as "no hospital excluded since 2023", the dangerous direction. We always write typed literals.
- **What would fix it:** reject a comparison whose literal type differs from the attribute's stored type, or coerce integer literals to the attribute's type.

## 4. Observation: create cost does not depend on lifetime

- **Expected:** storing an entity for 400 days costs more than storing it for one hour.
- **Actual:** identical gas, **137,944 per entity**, for `fromHours(1)` and `fromDays(400)` with the same attributes and payload (batches of 1 and 25).
- **Steps:** `bun scripts/probe-cost.ts 1 25` and `EXPIRY_DAYS=400 bun scripts/probe-cost.ts 1 25`.
- **Impact:** helpful for a history-keeping app, but it is unclear whether long lifetimes are charged elsewhere or later. We chose a two-year lifetime partly because the cost was the same.
- **What would fix it:** a short "what a create costs" section in the docs (size, attributes, lifetime).

## 5. Worked: oversized payloads are rejected before sending, with a precise message

- **What we did:** by mistake we passed a whole 514 KB extracted document as one entity's payload.
- **Actual:** the SDK threw before signing: `514379 bytes exceeds the 131072-byte payload limit. Store the bulk elsewhere and keep a reference to it on the entity.` No gas spent. It also told us what to do, which is what we did: rows became separate events.
- **Evidence:** the first three lines of [`evidence/publish-log.jsonl`](evidence/publish-log.jsonl).

## 6. Worked: an invalid `select` field names the valid ones

- **What we did:** asked for `createdAtBlock` in a raw `arkiv_query` selection.
- **Actual:** error −32602 listing every valid field (`key, owner, creator, createdAt, updatedAt, expiresAt, creationFlags, contentType, payload, attributeSchema, attributes`). Fixed in one edit. The raw JSON-RPC selection fields are not listed on the query docs page we used; the error was our documentation.

## 7. Worked: `STARTSWITH` on `str` attributes powers search

- Name search (`name STARTSWITH str('APHILA')`, on a squashed upper-case name attribute) and PIN-prefix search (`pin STARTSWITH str('5200')`) both return the expected events, through the SDK's `startsWith()` and through raw RPC.
- **Steps:** `bun scripts/friction-repro.ts` (cases `startswith-name`, `startswith-pin-prefix`).
- Note for others: matching is on raw bytes, so normalise case and punctuation into a dedicated index attribute, as `shared/normalize.js` does for both writer and readers.

## 8. Worked: browsers can query Tiramisu directly

- **CORS preflight** from `https://chasebp.github.io`: HTTP 204, `access-control-allow-origin: *`, allowed headers `Content-Type, Authorization, X-Api-Key` (case `cors-preflight`).
- The web app therefore runs as static files with no proxy. We hit no rate limit during development; the keyless budget is not documented, so the app reports a 429 as "unavailable" rather than retrying silently.

## 9. Worked: the SDK runs unchanged on Bun

- Every script in this repository (publisher, probes, freshness check, reproductions) runs with `bun <file>.ts`; the SDK's `bun` export condition loads its TypeScript sources directly.

## 10. Worked: an owner can delete a read-only entity, atomically with its replacement

- **What we did:** our first run published one `source` entity with `version = -1`, a bug in our script. Read-only meant we could not patch it.
- **Actual:** `executeBatch({ deletes: [old], creates: [fixed] })` removed it and created the corrected entity in one transaction (`0xd6eea364…7ce64`). This matches the documentation ("readonly" freezes content, not existence), and it is why our README never claims records are undeletable.
- **Steps:** [`scripts/repair-source-version.ts`](../scripts/repair-source-version.ts); both keys are recorded in [`evidence/published.json`](evidence/published.json) under `replaces`.

## 11. Issue (small): `getEntity()` and raw `arkiv_query` shape attributes differently

- **Expected:** one attribute shape across the SDK and the JSON-RPC.
- **Actual:** raw `arkiv_query` returns `attributes` as an array of `{ name, type, value }` with numbers hex-encoded; `publicClient.getEntity()` returns a keyed object (`attributes.version = { type: "i32", value: -1 }`). Our repair script assumed an array and crashed with `entity.attributes.find is not a function` before sending anything.
- **What would fix it:** one sentence in the SDK docs showing the `getEntity` return shape next to the raw RPC shape.

## 12. Issue: `arkiv_query` has its own keyless budget, undocumented, with a 25-minute lockout

- **Expected:** a documented keyless budget for queries, so a public read-only app can stay inside it.
- **Actual:** after about an hour of development from one IP (~300 write transactions, four full replays that each read all 7,268 events, repeated UI test loads), `arkiv_query` returned **HTTP 429 with `retry-after: 1492`**, and a later 429 carried `ratelimit: limit=10000, remaining=0, reset=1243`. In the same minute, `eth_blockNumber` from the same IP returned 200. After the reset, successful `arkiv_query` responses carry only `ratelimit: limit=600, remaining=…, reset=60`, a per-minute request limit where every query shape we tried cost about one request (1 row, 200 rows with attributes, 200 rows with payloads; script `scripts/query-cost.ts`). So the 10,000-unit budget that locked us out is invisible until it is exhausted, and what it counts is not documented. Twenty minutes after that reset we were locked out again (`limit=10000, remaining=0, reset=2422`), having run only the cost probe, one UI test, eight page loads and part of one demo recording, with no full replay. That points at a budget metered on data returned rather than on requests, but it is our inference; nothing in the responses says what a unit is.
- **Steps:** run `bun cli/claim-check.mjs verify hdfc-ergo` repeatedly from one IP; then compare `curl -D -` on `eth_blockNumber` and on any `arkiv_query`; then `bun scripts/query-cost.ts` after the reset. Saved results: cases `query-budget-vs-rpc-limit`, `query-budget-429-headers` and `query-cost: …` in [`evidence/friction-repro.jsonl`](evidence/friction-repro.jsonl).
- **What we did:** the reader turns a 429 into an explicit "Couldn't read Arkiv: rate limit reached, no result shown" state rather than an empty answer, and never retries in a loop. Queries now select only the attributes they use (`attributes: { kind: true, hospital: true, version: true }` for a replay instead of all fields), list metadata is cached for 90 seconds per session, and the CLI accepts an access key (`ARKIV_API_KEY`, sent as `X-Api-Key`) for heavier use.
- **What would fix it:** document the keyless query budget (what a unit is, the window, the per-query cost) and expose its remaining balance on successful responses, as the per-minute limit already is.
