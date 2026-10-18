// Publishes extracted exclusion-list versions and their change log to Arkiv.
// Usage: PUBLISHER_PRIVATE_KEY=0x... npm run publish:data
//
// Resumable: progress is recorded in arkiv/evidence/published.json after every
// transaction, and items already recorded there are never written twice.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { i32, str, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { APP, SCHEMA_VERSION, HISTORY_DAYS, CHECK_LEASE_DAYS, TRUSTED_CREATORS } from "../shared/config.js"
import { nameIndex, cityIndex } from "../shared/normalize.js"

const BATCH = 25 // 50 fails on Tiramisu with "Execution error without revert data" (see friction.md)
const MANIFEST = "arkiv/evidence/published.json"
const LOG = "arkiv/evidence/publish-log.jsonl"

const key = process.env.PUBLISHER_PRIVATE_KEY as `0x${string}` | undefined
if (!key) throw new Error("PUBLISHER_PRIVATE_KEY is not set")
const account = privateKeyToAccount(key)
if (TRUSTED_CREATORS[account.address.toLowerCase() as keyof typeof TRUSTED_CREATORS] !== "publisher") {
  throw new Error(`${account.address} is not the configured publisher in shared/config.js`)
}
const publicClient = createPublicClient({ chain: tiramisu, transport: http() })
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })

type Doc = {
  doc_id: string; insurer: string; insurer_name: string; source_url: string; source_note: string
  sha256: string; pdf_bytes: number; pdf_pages: number; pdf_created: string; row_count: number
  published_count: number; withheld_count: number; withheld_serials: number[]; unique_hospitals: number
  retrieved_at: string
}
type Event = {
  insurer: string; doc_id: string; version: number; kind: "listed" | "delisted"; hospital_key: string
  name: string; city: string; state: string; pin: string; pin_valid: boolean; effective_date: string
  sr: number | null; page: number | null
}

const docs: Doc[] = readdirSync("data")
  .filter((f) => f.endsWith(".json") && f !== "events.json")
  .map((f) => JSON.parse(readFileSync(`data/${f}`, "utf8")))
const { events, summary } = JSON.parse(readFileSync("data/events.json", "utf8")) as {
  events: Event[]; summary: { doc_id: string; version: number }[]
}
// Versions come from the replay summary, which covers versions that added no events.
const versionOf = new Map<string, number>(summary.map((s) => [s.doc_id, s.version]))
for (const d of docs) if (!versionOf.has(d.doc_id)) throw new Error(`no version for ${d.doc_id}`)

mkdirSync("arkiv/evidence", { recursive: true })
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { publisher: account.address, network: "tiramisu", chain_id: tiramisu.id, sources: {}, events: {}, checks: {} }
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n")

const epoch = (isoDate: string) => BigInt(Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000))
const history = { expires: ExpirationTime.fromDays(HISTORY_DAYS), flags: { readonly: true, permissionlessExtension: true } }

function sourceEntity(doc: Doc) {
  // Metadata only: the rows themselves are published as change-log events.
  const { rows: _rows, ...meta } = doc as Doc & { rows?: unknown }
  return {
    ...history,
    contentType: "application/json" as const,
    payload: jsonToPayload(meta),
    attributes: {
      app: str(APP), v: i32(SCHEMA_VERSION), type: str("source"), insurer: str(doc.insurer),
      doc: str(doc.doc_id), version: i32(versionOf.get(doc.doc_id) ?? -1),
      created: u64(epoch(doc.pdf_created)), hospitals: i32(doc.unique_hospitals), sha: str(doc.sha256),
    },
  }
}

function eventEntity(e: Event, seq: number) {
  return {
    ...history,
    contentType: "application/json" as const,
    payload: jsonToPayload(e),
    attributes: {
      app: str(APP), v: i32(SCHEMA_VERSION), type: str("event"), insurer: str(e.insurer),
      kind: str(e.kind), hospital: str(e.hospital_key), name: str(nameIndex(e.name)),
      city: str(cityIndex(e.city)), state: str(e.state), pin: str(e.pin), doc: str(e.doc_id),
      version: i32(e.version), effective: u64(epoch(e.effective_date)), seq: i32(seq),
    },
  }
}

async function send(label: string, creates: ReturnType<typeof eventEntity>[]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    try {
      const { txHash, createdEntities } = await wallet.executeBatch({ creates })
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
      if (receipt.status !== "success") throw new Error(`receipt status ${receipt.status}`)
      appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), label, n: creates.length, txHash,
        block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed), ms: Date.now() - started }) + "\n")
      return { txHash, createdEntities, block: Number(receipt.blockNumber) }
    } catch (err) {
      const message = String((err as Error).message).slice(0, 300)
      appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), label, attempt, error: message }) + "\n")
      console.warn(`${label}: attempt ${attempt} failed: ${message}`)
      if (attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 4000 * attempt))
    }
  }
  throw new Error("unreachable")
}

// 1. One source record per PDF version.
const pendingDocs = docs.filter((d) => !manifest.sources[d.doc_id])
if (pendingDocs.length) {
  const { txHash, createdEntities, block } = await send("sources", pendingDocs.map(sourceEntity))
  pendingDocs.forEach((d, i) => (manifest.sources[d.doc_id] = { key: createdEntities[i], tx: txHash, block }))
  save()
  console.log(`sources: ${pendingDocs.length} written in ${txHash}`)
}

// 2. The change log, in insurer order, 25 events per transaction.
const pending = events.map((e, seq) => ({ e, seq })).filter(({ seq }) => !manifest.events[seq])
for (let i = 0; i < pending.length; i += BATCH) {
  const chunk = pending.slice(i, i + BATCH)
  const { txHash, createdEntities, block } = await send(`events ${chunk[0].seq}-${chunk.at(-1)!.seq}`,
    chunk.map(({ e, seq }) => eventEntity(e, seq)))
  chunk.forEach(({ seq }, j) => (manifest.events[seq] = { key: createdEntities[j], tx: txHash, block }))
  save()
  console.log(`events ${chunk[0].seq}-${chunk.at(-1)!.seq} -> block ${block} (${i + chunk.length}/${pending.length})`)
}

// 3. A freshness lease per insurer for the latest version, written once here;
//    scripts/check.ts renews it after re-verifying the live PDF.
for (const insurer of new Set(docs.map((d) => d.insurer))) {
  if (manifest.checks[insurer]) continue
  const latest = docs.filter((d) => d.insurer === insurer).sort((a, b) => a.pdf_created.localeCompare(b.pdf_created)).at(-1)!
  const checked = BigInt(Math.floor(Date.parse(latest.retrieved_at) / 1000))
  const { txHash, createdEntities, block } = await send(`check ${insurer}`, [{
    expires: ExpirationTime.fromDays(CHECK_LEASE_DAYS),
    flags: { readonly: true },
    contentType: "application/json" as const,
    payload: jsonToPayload({ insurer, doc_id: latest.doc_id, url: latest.source_url, sha256: latest.sha256,
      checked_at: latest.retrieved_at, result: "match" }),
    attributes: { app: str(APP), v: i32(SCHEMA_VERSION), type: str("check"), insurer: str(insurer),
      doc: str(latest.doc_id), checked: u64(checked), sha: str(latest.sha256) },
  } as unknown as ReturnType<typeof eventEntity>])
  manifest.checks[insurer] = { key: createdEntities[0], tx: txHash, block, doc_id: latest.doc_id }
  save()
  console.log(`check lease for ${insurer}: ${createdEntities[0]}`)
}
console.log("done")
