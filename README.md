# Claim Check

**Has your health insurer excluded this hospital, and since when?** Every version of the insurer's exclusion list, kept as read-only records on Arkiv.

Live app: **https://chasebp.github.io/claim-check/** · Track: Arkiv Global Tour Stop, **Best Indian Use Case** · Network: Arkiv Tiramisu · Licence: MIT

## The problem

Indian health insurers keep lists of hospitals where they will not pay. HDFC ERGO's list opens with the clause that makes it binding:

> Expenses incurred towards treatment in any hospital or by any Medical Practitioner or any other provider specifically excluded by the Insurer and disclosed in its website/notified to the Policyholders are not admissible. However, in case of Life Threatening Situations or following an Accident, expenses up to the stage of stabilization are payable but not the complete claim.

So the list decides whether a family's planned surgery is paid, and the only notice is a PDF on the insurer's website. That PDF:

- **is replaced without notice.** The URL HDFC ERGO labels `exclusion-list-12-02-2025.pdf` now serves a file created on **18 March 2026**, with entries effective up to January 2026. Nothing tells a reader the document behind the link changed.
- **keeps no history.** The December 2023 and March 2024 lists survive only because the Internet Archive happened to capture them.
- **cannot be searched by PIN, compared across versions, or compared across insurers.** Between March 2024 and March 2026, **1,815 hospitals left HDFC ERGO's exclusion list and 878 joined it**, and no page anywhere says so. Tata AIG posts a new monthly PDF; between April and December 2025 it dropped 23 hospitals and added 2.
- **differs by insurer.** 1,368 hospitals are on both insurers' current lists, but not all: Rama Hospital in Sonipat (PIN 131021) left HDFC ERGO's list in March 2026 and is still on Tata AIG's, while Gaurav Hospital in Faridabad is the reverse. The right answer depends on your policy.

**Who uses Claim Check:** a policyholder choosing a hospital for a planned admission, a relative checking a hospital a doctor referred them to, and anyone (a journalist, a consumer group, a hospital) who wants to know when a listing began or ended.

## What it does

- **Lookup** by hospital name or PIN (or PIN prefix), across insurers: each match shows, per insurer, whether it is excluded now, since when, and a chip for every list version showing when it was on the list.
- **What changed:** the hospitals each new version added and dropped, by state.
- **Sources & verify:** every version's SHA-256, PDF link, Arkiv entity and flags, plus a button that replays the entire change log from Arkiv and checks it against the hospital count each version declares.
- **Stale is a state, not a guess:** if the publisher stops re-verifying the insurer's live PDF, a 14-day lease on Arkiv expires and the app says *stale*. It never falls back to implying "unchanged" or "not excluded".

Current data on Arkiv: **HDFC ERGO** (four versions: 28 Dec 2023, 18 Mar 2024, 18 Mar 2026, 21 Mar 2026) and **Tata AIG** (nine monthly lists, April–December 2025): 13 versions, 7,268 change-log events, 4,022 distinct hospitals.

## Why Arkiv

What breaks without it: the history would sit in our database and be exactly as trustworthy as our promise not to edit it, which is the problem we are pointing at in the insurer. On Arkiv:

1. **Attribution comes from the chain, not from us.** Readers keep only entities whose `$creator` is the publisher wallet `0xE33A…b703`. Anyone can write entities tagged `claim-check`; they are ignored.
2. **Versions are read-only.** A published version or event cannot be patched. A correction is a new, visible record. (We had to make one, see below.)
3. **History can outlive us.** Version and event entities allow permissionless extension: anyone can pay to keep them queryable, no permission needed.
4. **Freshness is a lease.** `check` entities live 14 days and are renewed with `extendEntity` only after the live PDF's hash is re-verified. An expired lease is the "stale" signal.
5. **No backend.** The web app and the CLI query Arkiv directly with the same reader module (`shared/arkiv-read.js`). There is no Claim Check server to switch off.

Kept off Arkiv on purpose: the PDFs (only hashes and URLs), street addresses, rows whose hospital name contains a person's name (only their count is published), and anything about users.

Full schema, lifetimes and the exact queries: [`arkiv/schema.md`](arkiv/schema.md). What was hard: [`arkiv/friction.md`](arkiv/friction.md).

## Reproduce

Read without the website (Node 18+ or Bun, no install):

```bash
node cli/claim-check.mjs search 131021          # one PIN, both insurers
node cli/claim-check.mjs search "repose"        # by name prefix
node cli/claim-check.mjs sources                # versions, hashes, freshness lease
node cli/claim-check.mjs changes hdfc-ergo 2    # what the 18 Mar 2026 version changed
node cli/claim-check.mjs verify hdfc-ergo       # replay all events against declared counts
node cli/claim-check.mjs verify tata-aig
node cli/claim-check.mjs search 700019 --rpc <any-arkiv-endpoint>
```

Rebuild the data from the insurer PDFs:

```bash
uv venv .venv && uv pip install --python .venv/bin/python pdfplumber==0.11.4
bun run extract            # downloads PDFs to .cache/, writes data/*.json and data/events.json
```

Check a version's hash yourself: download the `source_url` in `data/<doc>.json` (or from the Sources tab) and run `sha256sum`; it must equal the `sha` attribute of that version's `source` entity.

Run the app locally: `bun install && bun run dev`. Publishing needs a funded key: `PUBLISHER_PRIVATE_KEY=0x… bun run publish:data`, then `bun run check` to renew the freshness lease.

## On-chain evidence

- Publisher (creator of every entity): `0xE33A7E038837A75F5bDD891AFCFd48eAe6a2b703` on Tiramisu.
- Every entity key with its creation transaction and block: [`arkiv/evidence/published.json`](arkiv/evidence/published.json); gas per transaction: [`arkiv/evidence/publish-log.jsonl`](arkiv/evidence/publish-log.jsonl).
- Freshness checks: [`arkiv/evidence/check-log.jsonl`](arkiv/evidence/check-log.jsonl).
- Correction made in public: the first run published the 21 Mar 2026 `source` with `version = -1`. Being read-only it could not be patched, so it was deleted and re-created in one atomic batch ([`scripts/repair-source-version.ts`](scripts/repair-source-version.ts)); both keys are in the manifest.

## Limits

We republish what insurers published and do not judge whether an exclusion is justified. Not being on a list does not guarantee payment; confirm with the insurer before admission. Matching hospitals across versions and insurers uses name and PIN, with a rule for truncated names; a renamed hospital at the same PIN appears as a new entry. Tata AIG lists carry no effective date, so for them we show the first monthly list a hospital appears on. Two insurers are covered so far. Records live on a testnet and are retained for about two years unless extended.

## Built during the challenge

All code and data were created on 18 October 2026 for the Arkiv Global Tour Stop; there is no pre-existing work, and the baseline is this repository's first commit. Libraries: `@arkiv-network/sdk` 0.8.1, viem 2.38.2, Vite 6, pdfplumber 0.11.4. Runtime: Bun 1.2.

Data: exclusion lists published by HDFC ERGO General Insurance and Tata AIG General Insurance, plus Internet Archive captures of earlier HDFC ERGO versions. Not insurance advice.
