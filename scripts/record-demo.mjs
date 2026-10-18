// Records the demo video: the real app reading live Arkiv data, with captions.
// Usage: PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/record-demo.mjs <app-url> [--renew]
// --renew runs `bun scripts/check.ts` mid-recording (needs PUBLISHER_PRIVATE_KEY) so the
// freshness-lease renewal arrives over the WebSocket while the camera is rolling.
import { spawn, execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, renameSync } from "node:fs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core")
const url = process.argv[2] ?? "http://localhost:4173/"
const renew = process.argv.includes("--renew")
const out = "demo"
mkdirSync(out, { recursive: true })

const cli = execFileSync("node", ["cli/claim-check.mjs", "search", "131021"], { encoding: "utf8" })
  .split("\n").filter((l) => l.trim()).slice(0, 12).join("\n")

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 }, colorScheme: "light", deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
})
const page = await context.newPage()
const pause = (ms) => page.waitForTimeout(ms)

async function caption(text, ms = 4000) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-cap")
    if (!el) {
      el = document.createElement("div")
      el.id = "demo-cap"
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;max-width:1080px;" +
        "background:#181614;color:#f7f4ec;border-radius:12px;padding:14px 24px;font:500 20px/1.4 'Zen Kaku Gothic New',system-ui,sans-serif;" +
        "box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;border-left:4px solid #ab3830;transition:opacity .35s cubic-bezier(.2,0,0,1)"
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
  await page.evaluate(([t, b]) => {
    const el = document.createElement("div")
    el.id = "demo-card"
    el.style.cssText = "position:fixed;inset:0;z-index:98;display:grid;place-items:center;background:#f7f4ec;color:#181614;" +
      "font-family:'Zen Kaku Gothic New',system-ui,sans-serif;text-align:center;padding:40px"
    el.innerHTML = `<div><div style="width:64px;height:64px;margin:0 auto 22px;border-radius:12px;background:#ab3830;transform:rotate(-4deg)"></div>` +
      `<div style="font:400 72px/1.05 Gloock,Georgia,serif">${t}</div>` +
      `<div style="margin-top:18px;font-size:24px;color:#524d45;max-width:900px;line-height:1.45">${b}</div></div>`
    document.body.append(el)
  }, [title, body])
  await pause(ms)
  await page.evaluate(() => document.getElementById("demo-card")?.remove())
}
async function search(q) {
  await page.fill("#q", "")
  await page.type("#q", q, { delay: 70 })
  await page.click("#search-form button")
  await page.waitForSelector("#results .card", { timeout: 30000 })
  await pause(900)
}

await page.goto(`${url}#lookup`)
await page.waitForSelector("#banner .alert", { timeout: 30000 })
await card("Claim Check", "Has your health insurer excluded this hospital, and since when?<br>Every version of the insurer's list, kept on Arkiv.", 4500)
await caption("Indian insurers won't pay claims at hospitals on their exclusion lists. The lists are PDFs, replaced without notice.", 5500)

await search("131021")
await caption("One search covers two insurers. HDFC ERGO dropped Rama Hospital in March 2026; Tata AIG still excludes it.", 6500)
await page.locator("#results .card details").first().click()
await caption("Each row links to the insurer's PDF, the row and page it came from, and its Arkiv entity.", 5000)

await search("gaurav hospital")
await caption("The reverse: HDFC ERGO still excludes Gaurav Hospital; Tata AIG removed it in July 2025.", 6000)

await hideCaption()
await page.goto(`${url}#changes`)
await page.waitForSelector("#changes .cols", { timeout: 30000 })
await caption("HDFC ERGO's March 2026 list added 878 hospitals and dropped 1,815. Nobody announced it.", 5500)
await page.mouse.wheel(0, 500)
await pause(1500)

await hideCaption()
await page.goto(`${url}#sources`)
await page.waitForSelector("#sources table", { timeout: 30000 })
await caption("Every version is a read-only Arkiv entity carrying the PDF's SHA-256, extendable by anyone.", 5500)
await page.mouse.wheel(0, 260)
await caption("HDFC's link labelled 12-02-2025 now serves a file created in March 2026. We record that, not the label.", 6000)

await page.click("#verify-btn")
await caption("Replay: read every event from Arkiv at one block and check each version's declared count.", 3000)
await page.waitForSelector("#verify-out .alert", { timeout: 90000 })
await page.locator("#verify-out").scrollIntoViewIfNeeded()
await caption("All 13 versions, 7,268 events: consistent.", 4500)

await hideCaption()
await page.goto(`${url}#lookup/131021`)
await page.waitForSelector("#results .card", { timeout: 30000 })
if (renew) {
  await caption("Freshness is a 14-day lease. We re-download each insurer's PDF; if the hash matches, extendEntity renews it…", 3500)
  const child = spawn("bun", ["scripts/check.ts"], { stdio: "ignore", env: process.env })
  await page.waitForSelector(".toast", { timeout: 120000 }).catch(() => {})
  await caption("…and every open page learns about it live, over a WebSocket subscription. Lapse means 'stale', never 'safe'.", 6000)
  await new Promise((r) => child.on("exit", r))
} else {
  await caption("Freshness is a 14-day lease renewed with extendEntity after re-hashing the insurer's PDF. Lapse means 'stale'.", 6000)
}

await page.evaluate((text) => {
  const el = document.createElement("pre")
  el.id = "demo-term"
  el.textContent = "$ node cli/claim-check.mjs search 131021\n" + text
  el.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:97;width:1120px;max-height:520px;overflow:hidden;" +
    "background:#181614;color:#f2eee6;border-radius:14px;padding:26px 30px;font:15px/1.5 'IBM Plex Mono',monospace;" +
    "box-shadow:0 20px 60px rgba(0,0,0,.6);white-space:pre-wrap"
  document.body.append(el)
}, cli)
await caption("No backend: the same answer from a zero-dependency CLI, straight from Arkiv, trusting only our publisher's $creator.", 7000)
await page.evaluate(() => document.getElementById("demo-term")?.remove())

await card("Claim Check", "HDFC ERGO · Tata AIG · 13 list versions · 7,268 events on Arkiv Tiramisu<br>github.com/ChaseBP/claim-check · Best Indian Use Case", 5000)

await context.close()
await browser.close()
const webm = readdirSync(out).filter((f) => f.endsWith(".webm")).map((f) => `${out}/${f}`).at(-1)
renameSync(webm, `${out}/claim-check-demo.webm`)
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${out}/claim-check-demo.webm`, "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-crf", "20", "-movflags", "+faststart", `${out}/claim-check-demo.mp4`])
console.log(`wrote ${out}/claim-check-demo.mp4`)
