# Claim Check on Arkiv: schema and queries

Network: Arkiv **Tiramisu** testnet (chain ID `7738577`), RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
Publisher wallet (the only trusted `$creator`): **`0xE33A7E038837A75F5bDD891AFCFd48eAe6a2b703`**.
Every entity key and creation transaction is listed in [`evidence/published.json`](evidence/published.json), with per-transaction gas in [`evidence/publish-log.jsonl`](evidence/publish-log.jsonl).

## Design in one paragraph

Each version of an insurer's hospital-exclusion PDF becomes one read-only **`source`** entity carrying the PDF's SHA-256. The contents of the lists become an append-only change log of **`event`** entities: the first version contributes one `listed` event per hospital, and each later version contributes only the hospitals it added (`listed`) and dropped (`delisted`). A hospital's status is a replay of its events. A short-lived **`check`** entity is a freshness lease: it exists only while the publisher keeps re-verifying the insurer's live PDF.

Readers trust records by their on-chain `$creator`, never by an attribute anyone could write.

## Attributes common to every entity

| Attribute | Type | Value |
|---|---|---|
| `app` | `str` | `claim-check` |
| `v` | `i32` | schema version, `1` |
| `type` | `str` | `source`, `event` or `check` |
| `insurer` | `str` | insurer slug, e.g. `hdfc-ergo` |

## `source`: one list version

| Attribute | Type | Meaning |
|---|---|---|
| `doc` | `str` | document ID, e.g. `hdfc-ergo-2026-03-21` (named by PDF creation date) |
| `version` | `i32` | 0-based order of this version among the insurer's versions |
| `created` | `u64` | PDF creation date, Unix seconds (UTC) |
| `hospitals` | `i32` | distinct hospitals this version lists (after withholding; see below) |
| `sha` | `str` | SHA-256 of the PDF bytes, hex |

Payload (JSON): source URL and original URL, provenance note, PDF bytes/pages, raw and published row counts, count and serial numbers of withheld rows, and retrieval time. The rows themselves are not in the payload.

- **Expiration:** 730 days (`ExpirationTime.fromDays(730)`). History has to outlive the lists it records.
- **Flags:** `readonly` (a published version cannot be edited) and `permissionlessExtension` (anyone, e.g. a consumer group, can keep it queryable).

## `event`: a hospital listed or delisted in a version

| Attribute | Type | Meaning |
|---|---|---|
| `kind` | `str` | `listed` or `delisted` |
| `hospital` | `str` | stable hospital key: first 16 hex chars of SHA-256 of `squash(name) + "\|" + PIN`, unified across versions when insurers truncate names |
| `name` | `str` | squashed upper-case name (letters and digits only, max 64), for `STARTSWITH` search |
| `city` | `str` | squashed city |
| `state` | `str` | canonical state name |
| `pin` | `str` | PIN exactly as printed (5-digit insurer typos kept and flagged in the payload) |
| `doc` | `str` | the version that produced this event |
| `version` | `i32` | that version's order |
| `effective` | `u64` | the insurer's "effective from" date, Unix seconds |
| `seq` | `i32` | position in the published change log |

Payload (JSON): display name, city, state, PIN, `pin_valid`, effective date, and the source row number and page in the PDF, so any event can be checked against the insurer's document.

- **Expiration:** 730 days. **Flags:** `readonly`, `permissionlessExtension`.
- Written in atomic batches of 25 (`executeBatch`). 50 fails on Tiramisu (see [friction.md](friction.md)).

## `check`: a freshness lease

| Attribute | Type | Meaning |
|---|---|---|
| `doc` | `str` | the version whose live PDF was re-downloaded |
| `checked` | `u64` | when, Unix seconds |
| `sha` | `str` | SHA-256 observed |

- **Expiration:** **14 days.** `scripts/check.ts` re-downloads the latest PDF. On a hash match it renews the lease with `extendEntity` (another 14 days); on a mismatch or download failure it does nothing, so the lease runs out.
- **Flags:** `readonly` only. Renewal is the publisher's attestation, so third parties must not be able to extend it.
- **Product logic:** a missing or expired lease makes every reader label that insurer **stale**. Stale never becomes "not excluded".

## What stays off Arkiv, deliberately

- The PDFs (only their hash and URL), and street addresses from the lists.
- Rows whose hospital name contains a person's name (`Dr`, `Doctor`): withheld, with only their count and serial numbers published in the `source` payload.
- Anything about users: searches are never written anywhere.

## Queries the app runs

Every query starts with the same scope (`S`). Readers also drop any returned entity whose creator is not in `shared/config.js`.

```text
S = app = str('claim-check') AND v = i32(1) AND $creator = addr(0xe33a7e038837a75f5bdd891afcfd48eae6a2b703)
```

| Purpose | Query |
|---|---|
| All list versions | `S AND type = str('source')` |
| Freshness leases | `S AND type = str('check')` |
| Search by full PIN | `S AND type = str('event') AND pin = str('700019')` |
| Search by PIN prefix | `S AND type = str('event') AND pin STARTSWITH str('1220')` |
| Search by name prefix | `S AND type = str('event') AND name STARTSWITH str('REPOSE')` |
| Complete a hospital's timeline (up to 20 keys per query) | `S AND type = str('event') AND (hospital = str('<k1>') OR hospital = str('<k2>') …)` |
| What one version changed | `S AND type = str('event') AND insurer = str('hdfc-ergo') AND version = i32(2)` |
| Full replay for verification | `S AND type = str('event') AND insurer = str('hdfc-ergo')` |

Pagination: `limit` 200. Every follow-up page sends the first page's `cursor` and `atBlock` = its `blockNumber`, so a multi-page result is one consistent snapshot. Unpinned continuation fails with error −32005 once the head moves. Any RPC error raises `ArkivUnavailable` and the UI shows "couldn't read Arkiv", never an empty result.

### Reproduce one query with curl

```sh
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'Content-Type: application/json' -d \
"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"arkiv_query\",\"params\":[\"app = str('claim-check') AND v = i32(1) AND \$creator = addr(0xe33a7e038837a75f5bdd891afcfd48eae6a2b703) AND type = str('event') AND pin = str('520002')\",{\"limit\":\"0xc8\",\"select\":{\"key\":true,\"attributes\":true,\"payload\":true}}]}"
```

Expected: one `listed` event for APHILA HOSPITALS (PIN 520002) from `hdfc-ergo-2023-12-28`, row 1, page 1.
