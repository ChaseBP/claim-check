// Read-only reproductions behind arkiv/friction.md. No key, no writes.
// Usage: bun scripts/friction-repro.ts   (also runs under Node with tsx)
// Appends one JSON line per case to arkiv/evidence/friction-repro.jsonl.
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, gte, startsWith } from "@arkiv-network/sdk/query"
import { u64 } from "@arkiv-network/sdk/attr"
import { http } from "viem"
import { appendFileSync } from "node:fs"
import { RPC_URL } from "../shared/config.js"

const OUT = "arkiv/evidence/friction-repro.jsonl"
const runtime = typeof (globalThis as { Bun?: { version: string } }).Bun !== "undefined"
  ? `bun ${(globalThis as { Bun?: { version: string } }).Bun!.version}` : `node ${process.version}`
const log = (c: string, expected: string, actual: unknown, pass: boolean) => {
  const line = { at: new Date().toISOString(), runtime, sdk: "0.8.1", case: c, expected, actual, pass }
  console.log(JSON.stringify(line))
  appendFileSync(OUT, JSON.stringify(line) + "\n")
}
const S = "app = str('claim-check') AND v = i32(1) AND $creator = addr(0xe33a7e038837a75f5bdd891afcfd48eae6a2b703) AND type = str('event')"
async function raw(query: string, options: Record<string, unknown>) {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [query, options] }) })
  return res.json() as Promise<{ result?: { data: unknown[]; cursor?: string; blockNumber: string }; error?: { code: number; message: string } }>
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 1. Cursor continuation after the head moves, with and without atBlock.
const first = await raw(S, { limit: "0x5", select: { key: true } })
await wait(4500) // > 2 blocks
const unpinned = await raw(S, { limit: "0x5", select: { key: true }, cursor: first.result?.cursor })
const pinned = await raw(S, { limit: "0x5", select: { key: true }, cursor: first.result?.cursor, atBlock: first.result?.blockNumber })
log("cursor-unpinned", "second page returns the next 5 entities",
  unpinned.error ?? { n: unpinned.result?.data.length }, !unpinned.error)
log("cursor-pinned-atBlock", "second page returns the next 5 entities",
  pinned.error ?? { n: pinned.result?.data.length }, !pinned.error)

// 2. The SDK's own pagination across a moving head.
const client = createPublicClient({ chain: tiramisu, transport: http() })
try {
  const page = await client.select({ key: true }).where(eq("app", "claim-check"), eq("type", "event")).limit(5).fetch()
  await wait(4500)
  const next = await page.next()
  log("sdk-next-after-head-moves", "page.next() returns the following page", { n: next.entities.length }, true)
} catch (err) {
  log("sdk-next-after-head-moves", "page.next() returns the following page", String((err as Error).message).slice(0, 400), false)
}

// 3. Range over a u64 attribute: bare number versus typed literal.
const bare = await raw(`${S} AND effective >= 1700000000`, { limit: "0xc8", select: { key: true } })
const typed = await raw(`${S} AND effective >= u64(1700000000)`, { limit: "0xc8", select: { key: true } })
log("u64-range-bare-number", "same results as the typed u64 literal, or a type error",
  { bare: bare.error ?? bare.result?.data.length, typed: typed.error ?? typed.result?.data.length },
  (bare.result?.data.length ?? -1) === (typed.result?.data.length ?? -2))
const sdkTyped = await client.select({ key: true }).where(eq("app", "claim-check"), eq("type", "event"), gte("effective", u64(1700000000n))).limit(200).fetch()
log("u64-range-sdk-typed", "SDK with u64() matches the raw typed query", { sdk: sdkTyped.entities.length, raw: typed.result?.data.length },
  sdkTyped.entities.length === typed.result?.data.length)

// 4. STARTSWITH on str attributes used for search.
const byName = await client.select({ key: true }).where(eq("app", "claim-check"), eq("type", "event"), startsWith("name", "APHILA")).limit(10).fetch()
const byPin = await raw(`${S} AND pin STARTSWITH str('5200')`, { limit: "0xc8", select: { key: true } })
log("startswith-name", "events whose squashed name starts with APHILA", { n: byName.entities.length }, byName.entities.length > 0)
log("startswith-pin-prefix", "events whose PIN starts with 5200", { n: byPin.error ?? byPin.result?.data.length }, (byPin.result?.data.length ?? 0) > 0)

// 5. Browser access: CORS preflight from a GitHub Pages origin.
const pre = await fetch(RPC_URL, { method: "OPTIONS", headers: { origin: "https://chasebp.github.io",
  "access-control-request-method": "POST", "access-control-request-headers": "content-type" } })
log("cors-preflight", "access-control-allow-origin permits the page origin",
  { status: pre.status, allowOrigin: pre.headers.get("access-control-allow-origin"), allowHeaders: pre.headers.get("access-control-allow-headers") },
  !!pre.headers.get("access-control-allow-origin"))
