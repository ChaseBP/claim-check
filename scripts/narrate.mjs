// Generates the demo voiceover: one ElevenLabs clip per line of scripts/narration.json.
// Usage: ELEVENLABS_API_KEY=... node scripts/narrate.mjs
// Clips are cached by text and voice, so editing one line regenerates only that clip.
// Writes demo/voice/manifest.json ({ id: { file, seconds } }) for scripts/record-demo.mjs.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const key = process.env.ELEVENLABS_API_KEY
if (!key) throw new Error("set ELEVENLABS_API_KEY")
const { voice, model, lines } = JSON.parse(readFileSync("scripts/narration.json", "utf8"))
const dir = "demo/voice"
mkdirSync(dir, { recursive: true })

const manifest = {}
for (const [i, line] of lines.entries()) {
  const hash = createHash("sha256").update(`${voice}|${model}|${line.say}`).digest("hex").slice(0, 10)
  const file = `${dir}/${line.id}-${hash}.mp3`
  if (!existsSync(file)) {
    // Neighbouring lines are passed as context so the intonation flows from one clip to the next.
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.say,
        model_id: model,
        previous_text: lines[i - 1]?.say,
        next_text: lines[i + 1]?.say,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
      }),
    })
    if (!res.ok) throw new Error(`${line.id}: ${res.status} ${await res.text()}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    console.log(`generated ${file}`)
  }
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }))
  manifest[line.id] = { file, seconds, caption: line.caption ?? null }
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2))
const total = Object.values(manifest).reduce((a, m) => a + m.seconds, 0)
console.log(`${lines.length} clips, ${total.toFixed(1)}s of narration`)
