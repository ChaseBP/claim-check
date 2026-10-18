// Re-verifies each insurer's live exclusion-list PDF and renews the freshness lease.
// Usage: PUBLISHER_PRIVATE_KEY=0x... npm run check
//
// For every insurer, the latest published version's URL is downloaded and hashed.
//  - Same hash: the live `check` lease is extended by CHECK_LEASE_DAYS (extendEntity),
//    or a new lease is created if the old one has already expired.
//  - Different hash or download failure: nothing is renewed. The lease runs out and
//    every reader shows the insurer as stale until the new version is extracted and published.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { i32, str, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHash } from "node:crypto"
import { appendFileSync } from "node:fs"
import { APP, SCHEMA_VERSION, CHECK_LEASE_DAYS } from "../shared/config.js"
import { loadSources, loadChecks } from "../shared/arkiv-read.js"

const key = process.env.PUBLISHER_PRIVATE_KEY as `0x${string}` | undefined
if (!key) throw new Error("PUBLISHER_PRIVATE_KEY is not set")
const account = privateKeyToAccount(key)
const publicClient = createPublicClient({ chain: tiramisu, transport: http() })
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })
const LOG = "arkiv/evidence/check-log.jsonl"

const [{ sources }, { checks }] = await Promise.all([loadSources(), loadChecks()])
const latest = new Map<string, (typeof sources)[number]>()
for (const s of sources) if (!latest.has(s.insurer) || s.version > latest.get(s.insurer)!.version) latest.set(s.insurer, s)

for (const [insurer, doc] of latest) {
  const checkedAt = new Date()
  let observed: string | null = null
  let failure: string | null = null
  try {
    const res = await fetch(doc.source_url, { headers: { "user-agent": "Mozilla/5.0 claim-check" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    observed = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex")
  } catch (err) {
    failure = String((err as Error).message)
  }
  const match = observed === doc.sha256
  const live = checks[insurer]
  let action = "none"
  let txHash: string | undefined
  if (match && live) {
    ;({ txHash } = await wallet.extendEntity({ entityKey: live.key, expires: ExpirationTime.fromDays(CHECK_LEASE_DAYS) }))
    action = `extended ${live.key}`
  } else if (match) {
    const r = await wallet.createEntity({
      expires: ExpirationTime.fromDays(CHECK_LEASE_DAYS),
      flags: { readonly: true },
      contentType: "application/json",
      payload: jsonToPayload({ insurer, doc_id: doc.doc_id, url: doc.source_url, sha256: observed,
        checked_at: checkedAt.toISOString(), result: "match" }),
      attributes: { app: str(APP), v: i32(SCHEMA_VERSION), type: str("check"), insurer: str(insurer),
        doc: str(doc.doc_id), checked: u64(BigInt(Math.floor(checkedAt.getTime() / 1000))), sha: str(observed!) },
    })
    txHash = r.txHash
    action = `created ${r.entityKey}`
  }
  if (txHash) await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
  const line = { at: checkedAt.toISOString(), insurer, doc: doc.doc_id, url: doc.source_url, expected: doc.sha256,
    observed, failure, match, action, txHash }
  appendFileSync(LOG, JSON.stringify(line) + "\n")
  console.log(match ? `${insurer}: unchanged, ${action}` : `${insurer}: NOT renewed (${failure ?? `hash changed to ${observed}`}); readers will show stale`)
}
