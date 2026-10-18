// Records the demo video: the real app reading live Arkiv data, with captions.
// Usage: PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/record-demo.mjs <app-url> [--renew]
// e.g. http://localhost:4173/?rpc=http://localhost:8545 to read through scripts/rpc-cache.mjs.
// --renew runs `bun scripts/check.ts` mid-recording (needs PUBLISHER_PRIVATE_KEY) so the
// freshness-lease renewal arrives over the WebSocket while the camera is rolling.
import { spawn, execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, renameSync } from "node:fs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core")
const url = process.argv[2] ?? "http://localhost:4173/"
const renew = process.argv.includes("--renew")
const out = "demo"
mkdirSync(out, { recursive: true })

// An app URL with ?rpc=<endpoint> sends the CLI to the same endpoint.
const rpc = new URL(url).searchParams.get("rpc")
const cli = execFileSync("node", ["cli/claim-check.mjs", "search", "131021", ...(rpc ? ["--rpc", rpc] : [])], { encoding: "utf8" })
  .split("\n").filter((l) => l.trim()).slice(0, 12).join("\n")

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 }, colorScheme: "light", deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
})
const page = await context.newPage()
const pause = (ms) => page.waitForTimeout(ms)

// Logo mark used on the title cards (same shape as src/logo.js, fixed colours).
const MARK = `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0e2230"/>` +
  `<g transform="translate(6 2) skewX(-14)"><rect x="18" y="12" width="30" height="38" rx="5" fill="#5cc4b0"/>` +
  `<rect x="14" y="16" width="30" height="38" rx="5" fill="#0f8a7c" stroke="#0e2230" stroke-width="1.6"/>` +
  `<rect x="10" y="20" width="30" height="38" rx="5" fill="#dcefe9" stroke="#0e2230" stroke-width="1.6"/>` +
  `<path d="M16 32h18M16 39h18M16 46h11" stroke="#0e2230" stroke-width="3" stroke-linecap="round"/></g></svg>`

async function caption(text, ms = 4000) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-cap")
    if (!el) {
      el = document.createElement("div")
      el.id = "demo-cap"
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;max-width:1080px;" +
        "background:#0e2230;color:#eef4f2;border-radius:10px;padding:14px 24px;font:500 20px/1.4 'Zen Kaku Gothic New',system-ui,sans-serif;" +
        "box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;border-left:4px solid #4fd1bd;transition:opacity .35s cubic-bezier(.22,1,.36,1)"
      document.body.append(el)
    }
    el.style.opacity = "0"
    setTimeout(() => { el.textContent = t; el.style.opacity = "1" }, 180)
  }, text)
  await pause(ms)
}
async function hideCaption() {
  await page.evaluate(() => document.getElementById("demo-cap")?.remove())
}
async function card(title, body, ms) {
  await page.evaluate(([t, b, mark]) => {
    const el = document.createElement("div")
    el.id = "demo-card"
    el.style.cssText = "position:fixed;inset:0;z-index:98;display:grid;place-items:center;background:#f5f6f2;color:#15202b;" +
      "font-family:'Zen Kaku Gothic New',system-ui,sans-serif;text-align:center;padding:40px"
    el.innerHTML = `<div><div style="display:grid;place-items:center;margin-bottom:22px">${mark}</div>` +
      `<div style="font:400 72px/1.05 Gloock,Georgia,serif">${t}</div>` +
      `<div style="margin-top:18px;font-size:24px;color:#4a5560;max-width:900px;line-height:1.45">${b}</div></div>`
    document.body.append(el)
  }, [title, body, MARK])
  await pause(ms)
  await page.evaluate(() => document.getElementById("demo-card")?.remove())
}
async function go(hash, selector) {
  await hideCaption()
  await page.goto(`${url}${hash}`)
  await page.waitForSelector(selector, { timeout: 60000 })
  await pause(800)
}
async function search(q) {
  await page.fill("#q", "")
  await page.type("#q", q, { delay: 70 })
  await page.press("#q", "Enter")
  await page.waitForSelector("#results .card", { timeout: 30000 })
  await pause(900)
}
async function scrollTo(selector) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }))
  await pause(1200)
}

await page.goto(`${url}#/`)
await page.waitForSelector("#hero-card .card", { timeout: 60000 })
await card("Claim Check", "Has your health insurer excluded this hospital, and since when?<br>Every version of the insurer's list, kept on Arkiv.", 4500)
await caption("Indian insurers won't pay claims at hospitals on their exclusion lists. The lists are PDFs, replaced without notice.", 5500)
await caption("The hero is a real record, read live from Arkiv: HDFC ERGO dropped Rama Hospital in March 2026; Tata AIG still excludes it.", 6500)
await caption("Each insurer row names its source: the PDF version, row and page, and the read-only Arkiv record.", 5000)

await scrollTo(".facts3")
await caption("HDFC ERGO's lists dropped 1,815 hospitals between 2024 and 2026, and nobody announced it.", 5000)

await go("#/lookup", "#q")
await search("gaurav hospital")
await caption("The reverse case: HDFC ERGO still excludes Gaurav Hospital; Tata AIG removed it in July 2025.", 6000)

await go("#/changes", "#changes .change-grid, #changes table, #changes li")
await caption("Every version is compared with the one before it. HDFC ERGO's March 2026 list: +878, −1,815.", 5500)
await scrollTo(".state-panel")
await caption("Broken down by state, and filterable by hospital, city or PIN.", 4000)

await go("#/insurers", ".ins-block")
await caption("Each version is its own Arkiv record carrying the PDF's SHA-256. HDFC's link labelled 12-02-2025 serves a file made in March 2026.", 6500)

await go("#/verify", "#verify-btn")
await page.click("#verify-btn")
await caption("Replay: read every event from Arkiv at one block and check each version's declared count.", 3000)
await page.waitForSelector("#verify-out .alert", { timeout: 120000 })
await page.locator("#verify-out").scrollIntoViewIfNeeded()
await caption("All 13 versions, 7,268 events: consistent.", 4500)

await scrollTo(".lease")
if (renew) {
  await caption("Freshness is a 14-day lease. We re-download each insurer's PDF; if the hash matches, extendEntity renews it…", 3500)
  const child = spawn("bun", ["scripts/check.ts"], { stdio: "ignore", env: process.env })
  await page.waitForSelector(".toast", { timeout: 120000 }).catch(() => {})
  await caption("…and every open page learns about it live, over a WebSocket subscription. Lapse means 'stale', never 'safe'.", 6000)
  await new Promise((r) => child.on("exit", r))
} else {
  await caption("Freshness is a 14-day lease renewed with extendEntity after re-hashing the insurer's PDF. Lapse means 'stale'.", 6000)
}

await go("#/developers", ".code-tabs, pre")
await page.evaluate((text) => {
  const el = document.createElement("pre")
  el.id = "demo-term"
  el.textContent = "$ node cli/claim-check.mjs search 131021\n" + text
  el.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:97;width:1120px;max-height:520px;overflow:hidden;" +
    "background:#0c1318;color:#e8eef0;border-radius:12px;padding:26px 30px;font:15px/1.5 'IBM Plex Mono',monospace;" +
    "box-shadow:0 20px 60px rgba(0,0,0,.6);white-space:pre-wrap;border:1px solid #27343c"
  document.body.append(el)
}, cli)
await caption("No backend: the same answer from a zero-dependency CLI, straight from Arkiv, trusting only our publisher's $creator.", 7000)
await page.evaluate(() => document.getElementById("demo-term")?.remove())
await hideCaption()

await card("Claim Check", "HDFC ERGO · Tata AIG · 13 list versions · 7,268 events on Arkiv<br>github.com/ChaseBP/claim-check", 5000)

await context.close()
await browser.close()
const webm = readdirSync(out).filter((f) => f.endsWith(".webm")).map((f) => `${out}/${f}`).at(-1)
renameSync(webm, `${out}/claim-check-demo.webm`)
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${out}/claim-check-demo.webm`, "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-crf", "20", "-movflags", "+faststart", `${out}/claim-check-demo.mp4`])
console.log(`wrote ${out}/claim-check-demo.mp4`)
