// Measures what batched creates cost on Tiramisu before committing to a full publish.
// Usage: PUBLISHER_PRIVATE_KEY=0x... npx tsx scripts/probe-cost.ts 1 25 100
// Every probe entity carries app=claim-check-probe and expires after one hour.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { str, u64, i32 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http, formatEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { appendFileSync, mkdirSync } from "node:fs"

const key = process.env.PUBLISHER_PRIVATE_KEY as `0x${string}` | undefined
if (!key) throw new Error("PUBLISHER_PRIVATE_KEY is not set")
const account = privateKeyToAccount(key)
const publicClient = createPublicClient({ chain: tiramisu, transport: http() })
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0)
mkdirSync("arkiv/evidence", { recursive: true })

function probeEntity(i: number) {
  return {
    payload: jsonToPayload({
      name: "SAMPLE MULTISPECIALITY HOSPITAL AND TRAUMA CENTRE", city: "GHAZIABAD",
      state: "UTTAR PRADESH", pin: "201003", effective_date: "2023-01-01", sr: 1684, page: 87,
    }),
    contentType: "application/json" as const,
    attributes: {
      app: str("claim-check-probe"), type: str("event"), insurer: str("hdfc-ergo"),
      kind: str("listed"), hospital: str("0123456789abcdef"), pin: str("201003"),
      state: str("UTTAR PRADESH"), doc: str("hdfc-ergo-2026-03-21"), version: i32(3),
      effective: u64(1672531200n), seq: i32(i),
    },
    expires: process.env.EXPIRY_DAYS ? ExpirationTime.fromDays(Number(process.env.EXPIRY_DAYS)) : ExpirationTime.fromHours(1),
  }
}

const before = await publicClient.getBalance({ address: account.address })
console.log("balance before:", formatEther(before), "GLM")
for (const n of sizes) {
  const started = Date.now()
  try {
    const { txHash, createdEntities } = await wallet.executeBatch({
      creates: Array.from({ length: n }, (_, i) => probeEntity(i)),
    })
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
    const cost = receipt.gasUsed * receipt.effectiveGasPrice
    const line = {
      at: new Date().toISOString(), batch: n, created: createdEntities.length, txHash,
      block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed),
      gasPerEntity: Math.round(Number(receipt.gasUsed) / n),
      costGLM: formatEther(cost), costPerEntityGLM: formatEther(cost / BigInt(n)),
      ms: Date.now() - started, status: receipt.status, expiryDays: process.env.EXPIRY_DAYS ?? "1h",
    }
    console.log(line)
    appendFileSync("arkiv/evidence/probe-cost.jsonl", JSON.stringify(line) + "\n")
  } catch (err) {
    const line = { at: new Date().toISOString(), batch: n, error: String((err as Error).message).slice(0, 600), ms: Date.now() - started }
    console.log(line)
    appendFileSync("arkiv/evidence/probe-cost.jsonl", JSON.stringify(line) + "\n")
  }
}
const after = await publicClient.getBalance({ address: account.address })
console.log("balance after:", formatEther(after), "GLM; spent", formatEther(before - after))
