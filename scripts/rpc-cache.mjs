// Local caching JSON-RPC proxy for development and screenshot audits.
// Each distinct (method, params) is fetched from Arkiv once and replayed from
// cache afterwards, so many browser sessions cost one set of queries.
// eth_blockNumber is passed through uncached so "read at block" stays honest.
// Usage: bun scripts/rpc-cache.mjs [port]   then open the app with ?rpc=http://localhost:<port>
import { createServer } from "node:http"
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const UPSTREAM = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const PORT = Number(process.argv[2] ?? 8545)
const FILE = ".cache/rpc-cache.json"
const cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}
const PASS_THROUGH = new Set(["eth_blockNumber", "eth_chainId"])
let hits = 0
let misses = 0

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-api-key",
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end()
  let body = ""
  for await (const chunk of req) body += chunk
  let call
  try {
    call = JSON.parse(body)
  } catch {
    return res.writeHead(400, cors).end()
  }
  const key = `${call.method}:${JSON.stringify(call.params)}`
  if (!PASS_THROUGH.has(call.method) && cache[key]) {
    hits++
    res.writeHead(200, { ...cors, "content-type": "application/json", "x-cache": "hit" })
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: cache[key] }))
  }
  const upstream = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json", "user-agent": "claim-check-dev-cache" }, body })
  const text = await upstream.text()
  if (upstream.ok && !PASS_THROUGH.has(call.method)) {
    try {
      const parsed = JSON.parse(text)
      if (parsed.result !== undefined) {
        cache[key] = parsed.result
        misses++
        writeFileSync(FILE, JSON.stringify(cache))
      }
    } catch {
      // not JSON: pass it on uncached
    }
  }
  res.writeHead(upstream.status, { ...cors, "content-type": "application/json", "x-cache": "miss" })
  res.end(text)
}).listen(PORT, () => console.log(`rpc cache on http://localhost:${PORT} (${Object.keys(cache).length} cached)`))

setInterval(() => (hits || misses) && console.log(`hits ${hits} misses ${misses}`), 30000).unref()
