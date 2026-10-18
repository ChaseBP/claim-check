// One-off repair, kept for transparency. The first publish run wrote the source
// record for hdfc-ergo-2026-03-21 with version -1, because that version added no
// change-log events and the version map was built from events. The record is
// read-only, so it cannot be patched; as its owner we delete it and re-create it
// with the correct version. Readonly on Arkiv freezes content, not existence.
// Usage: PUBLISHER_PRIVATE_KEY=0x... npx tsx scripts/repair-source-version.ts
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { i32, str, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { APP, SCHEMA_VERSION, HISTORY_DAYS } from "../shared/config.js"

const DOC = "hdfc-ergo-2026-03-21"
const MANIFEST = "arkiv/evidence/published.json"
const key = process.env.PUBLISHER_PRIVATE_KEY as `0x${string}` | undefined
if (!key) throw new Error("PUBLISHER_PRIVATE_KEY is not set")
const account = privateKeyToAccount(key)
const publicClient = createPublicClient({ chain: tiramisu, transport: http() })
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
const { summary } = JSON.parse(readFileSync("data/events.json", "utf8"))
const version = summary.find((s: { doc_id: string }) => s.doc_id === DOC).version
const { rows: _rows, ...doc } = JSON.parse(readFileSync(`data/${DOC}.json`, "utf8"))
const old = manifest.sources[DOC]

const entity = await publicClient.getEntity(old.key)
const attrs = entity.attributes as unknown as Record<string, unknown>
const current = Array.isArray(attrs) ? attrs.find((a) => a.name === "version") : attrs.version
console.log(`current version attribute on ${old.key}:`, current)

const { txHash, createdEntities } = await wallet.executeBatch({
  deletes: [{ entityKey: old.key }],
  creates: [{
    expires: ExpirationTime.fromDays(HISTORY_DAYS),
    flags: { readonly: true, permissionlessExtension: true },
    contentType: "application/json",
    payload: jsonToPayload(doc),
    attributes: {
      app: str(APP), v: i32(SCHEMA_VERSION), type: str("source"), insurer: str(doc.insurer), doc: str(DOC),
      version: i32(version), created: u64(BigInt(Math.floor(Date.parse(`${doc.pdf_created}T00:00:00Z`) / 1000))),
      hospitals: i32(doc.unique_hospitals), sha: str(doc.sha256),
    },
  }],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
manifest.sources[DOC] = { key: createdEntities[0], tx: txHash, block: Number(receipt.blockNumber),
  replaces: { key: old.key, tx: old.tx, reason: "published with version -1; deleted and re-created atomically" } }
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n")
appendFileSync("arkiv/evidence/publish-log.jsonl", JSON.stringify({ at: new Date().toISOString(), label: `repair ${DOC}`,
  deleted: old.key, created: createdEntities[0], txHash, block: Number(receipt.blockNumber) }) + "\n")
console.log(`deleted ${old.key} and created ${createdEntities[0]} (version ${version}) in ${txHash}`)
