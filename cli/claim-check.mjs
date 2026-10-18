#!/usr/bin/env node
// claim-check CLI: reads insurer hospital-exclusion history straight from Arkiv.
// No install, no API of ours: plain Node 18+ and the shared reader in ../shared.
//
//   node cli/claim-check.mjs search "shri ram"     hospitals whose name starts with this
//   node cli/claim-check.mjs search 7000           hospitals in PINs starting 7000
//   node cli/claim-check.mjs sources               every list version, with hashes
//   node cli/claim-check.mjs changes hdfc-ergo 2   what list version 2 added and removed
//   node cli/claim-check.mjs verify hdfc-ergo      replay the change log against declared counts
//   --rpc <url>                                    any Arkiv endpoint (default: Tiramisu)

import {
  ArkivUnavailable, setRpcUrl, search, loadSources, loadChecks, verifyInsurer, changesIn, statusOf, headBlock, secondsLeft,
} from "../shared/arkiv-read.js"
import { EXPLORER } from "../shared/config.js"

const args = process.argv.slice(2)
const rpcAt = args.indexOf("--rpc")
if (rpcAt !== -1) {
  setRpcUrl(args[rpcAt + 1])
  args.splice(rpcAt, 2)
}
const [command, ...rest] = args

async function freshness() {
  const [{ checks }, head] = await Promise.all([loadChecks(), headBlock()])
  const out = {}
  for (const [insurer, e] of Object.entries(checks)) {
    out[insurer] = { checkedAt: e.payload?.checked_at, daysLeft: Math.max(0, secondsLeft(e.expiresAt, head) / 86400) }
  }
  return out
}

async function main() {
  switch (command) {
    case "search": {
      const text = rest.join(" ")
      const [{ sources }, fresh, result] = await Promise.all([loadSources(), freshness(), search(text)])
      const latest = {}
      for (const s of sources) latest[s.insurer] = Math.max(latest[s.insurer] ?? -1, s.version)
      if (!result.hospitals.length) {
        console.log(`No hospital matching "${text}" on any exclusion list version held for: ${Object.keys(latest).join(", ")}.`)
        console.log("Hospital names containing a person's name (e.g. 'Dr') are withheld; check the insurer's PDF for those.")
        return
      }
      for (const t of result.hospitals) {
        const s = statusOf(t, latest[t.insurer])
        const f = fresh[t.insurer]
        const stale = !f ? "  [STALE: no live re-verification of this insurer's list]" : ""
        const label = s.state === "excluded" ? `EXCLUDED by ${t.insurer} (effective ${s.effective})` : `REMOVED from ${t.insurer}'s list in ${s.sinceDoc}`
        console.log(`${t.name} | ${t.city}, ${t.state} ${t.pin}${t.pinValid ? "" : " (PIN as printed by insurer)"}`)
        console.log(`  ${label}${stale}`)
        for (const e of t.events) console.log(`    ${e.kind.padEnd(8)} ${e.doc}${e.sr ? `  row ${e.sr}, page ${e.page}` : ""}  ${EXPLORER}/entity/${e.entity.key}`)
      }
      if (result.truncated) console.log(`(${result.matched} hospitals matched; showing the first ${result.hospitals.length}. Narrow the search.)`)
      console.log(`read at block ${result.block}`)
      return
    }
    case "sources": {
      const [{ sources, block }, fresh] = await Promise.all([loadSources(), freshness()])
      for (const s of sources) {
        console.log(`${s.doc_id}  v${s.version}  created ${s.pdf_created}  ${s.hospitals} hospitals  sha256 ${s.sha256}`)
        console.log(`  ${s.source_url}`)
      }
      for (const [insurer, f] of Object.entries(fresh)) console.log(`freshness ${insurer}: re-verified ${f.checkedAt}, lease ${f.daysLeft.toFixed(1)} days left`)
      console.log(`read at block ${block}`)
      return
    }
    case "changes": {
      const [insurer, version] = rest
      const { listed, delisted, block } = await changesIn(insurer, version)
      console.log(`${insurer} version ${version}: +${listed.length} listed, -${delisted.length} delisted (block ${block})`)
      for (const h of listed.slice(0, 40)) console.log(`  + ${h.name} | ${h.city} ${h.pin}`)
      for (const h of delisted.slice(0, 40)) console.log(`  - ${h.name} | ${h.city} ${h.pin}`)
      return
    }
    case "verify": {
      const result = await verifyInsurer(rest[0] ?? "hdfc-ergo")
      for (const r of result.rows) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.doc}  declared ${r.declared}  replayed ${r.replayed}  (${r.events} events)`)
      console.log(`${result.events} events replayed at block ${result.block}: ${result.ok ? "consistent" : "INCONSISTENT"}`)
      process.exitCode = result.ok ? 0 : 1
      return
    }
    default:
      console.log("usage: claim-check <search TEXT|PIN | sources | changes INSURER VERSION | verify INSURER> [--rpc URL]")
  }
}

main().catch((err) => {
  if (err instanceof ArkivUnavailable) {
    console.error(`Unavailable: ${err.message}. No result is shown rather than a possibly wrong one.`)
    if (err.detail) console.error(`  ${err.detail}`)
    process.exitCode = 2
  } else throw err
})
