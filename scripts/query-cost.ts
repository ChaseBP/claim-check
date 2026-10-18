// Measures what arkiv_query shapes cost against the keyless query budget, using the
// `ratelimit: limit=…, remaining=…, reset=…` header. Read-only, no key.
// Usage: bun scripts/query-cost.ts   -> appends to arkiv/evidence/friction-repro.jsonl
import { appendFileSync } from "node:fs"
import { RPC_URL } from "../shared/config.js"

const S = "app = str('claim-check') AND v = i32(1) AND $creator = addr(0xe33a7e038837a75f5bdd891afcfd48eae6a2b703) AND type = str('event') AND insurer = str('hdfc-ergo')"
async function query(select: Record<string, boolean>, limit: string) {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [S, { limit, select }] }) })
  const header = res.headers.get("ratelimit") ?? ""
  const body = (await res.json()) as { result?: { data: unknown[] } }
  const remaining = Number(/remaining=(\d+)/.exec(header)?.[1] ?? NaN)
  return { status: res.status, header, remaining, n: body.result?.data.length ?? 0, bytes: JSON.stringify(body).length }
}

const shapes: [string, Record<string, boolean>, string][] = [
  ["key-only, 1 row", { key: true }, "0x1"],
  ["key-only, 1 row (repeat)", { key: true }, "0x1"],
  ["attributes, 200 rows", { key: true, creator: true, attributes: true }, "0xc8"],
  ["attributes + payload, 200 rows", { key: true, creator: true, attributes: true, payload: true }, "0xc8"],
]
let prev = (await query({ key: true }, "0x1")).remaining
for (const [label, select, limit] of shapes) {
  const r = await query(select, limit)
  const cost = Number.isFinite(prev) && Number.isFinite(r.remaining) ? prev - r.remaining : null
  const line = { at: new Date().toISOString(), case: `query-cost: ${label}`, status: r.status, rows: r.n, responseBytes: r.bytes,
    ratelimit: r.header, unitsSpent: cost }
  console.log(JSON.stringify(line))
  appendFileSync("arkiv/evidence/friction-repro.jsonl", JSON.stringify(line) + "\n")
  prev = r.remaining
}
