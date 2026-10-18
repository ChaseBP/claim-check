// Dependency-free Arkiv reader shared by the web app (src/) and the CLI (cli/).
// It speaks raw JSON-RPC so the CLI runs on plain Node 18+ with nothing installed.
//
// Correctness rules, applied identically by every reader:
//  - every query is scoped to app, schema version and the trusted creators;
//  - all pages of one query are read at the block of the first page;
//  - a failed read raises ArkivUnavailable and is never turned into "no results";
//  - a hospital's timeline is completed by hospital key, never by name alone.

import { APP, SCHEMA_VERSION, RPC_URL, TRUSTED_CREATORS, BLOCK_SECONDS } from "./config.js"
import { squash, nameIndex, pinQuery } from "./normalize.js"

export class ArkivUnavailable extends Error {
  constructor(reason, detail) {
    super(reason)
    this.name = "ArkivUnavailable"
    this.detail = detail
  }
}

const quote = (s) => `str('${String(s).replaceAll("'", "''")}')`
const creators = Object.keys(TRUSTED_CREATORS)
const scope = () => {
  const who = creators.map((a) => `$creator = addr(${a})`)
  return `app = ${quote(APP)} AND v = i32(${SCHEMA_VERSION}) AND ${who.length > 1 ? `(${who.join(" OR ")})` : who[0]}`
}

let rpcUrl = RPC_URL
let apiKey = null
export function setRpcUrl(url) {
  rpcUrl = url
}
/** Optional Arkiv access key, sent as X-Api-Key. Never ship one in the web build. */
export function setApiKey(key) {
  apiKey = key || null
}

let nextId = 1
async function rpc(method, params, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: apiKey ? { "content-type": "application/json", "x-api-key": apiKey } : { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: controller.signal,
    })
  } catch (err) {
    throw new ArkivUnavailable(err.name === "AbortError" ? "Arkiv RPC timed out" : "Arkiv RPC unreachable", String(err))
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 429) throw new ArkivUnavailable("Arkiv RPC rate limit reached", `HTTP 429 retry-after=${response.headers.get("retry-after")}`)
  if (!response.ok) throw new ArkivUnavailable(`Arkiv RPC returned HTTP ${response.status}`)
  let body
  try {
    body = await response.json()
  } catch {
    throw new ArkivUnavailable("Arkiv RPC returned a non-JSON response")
  }
  if (body.error) throw new ArkivUnavailable(`Arkiv RPC error ${body.error.code}`, body.error.message)
  return body.result
}

const hexToNumber = (h) => (typeof h === "string" && h.startsWith("0x") ? Number(BigInt(h)) : h)

function decodePayload(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return null
  const bytes = new Uint8Array((hex.length - 2) / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null // a hostile or malformed payload is ignored, not rendered
  }
}

function decodeEntity(raw) {
  const attrs = {}
  for (const a of raw.attributes ?? []) attrs[a.name] = a.type === "u64" || a.type === "i32" ? hexToNumber(a.value) : a.value
  return {
    key: raw.key,
    creator: raw.creator?.toLowerCase(),
    owner: raw.owner?.toLowerCase(),
    expiresAt: hexToNumber(raw.expiresAt),
    createdAt: hexToNumber(raw.createdAt),
    flags: raw.creationFlags,
    attrs,
    payload: raw.payload !== undefined ? decodePayload(raw.payload) : undefined,
  }
}

const SELECT = { key: true, creator: true, owner: true, expiresAt: true, createdAt: true, creationFlags: true, attributes: true, payload: true }
// Queries draw on a metered budget, so callers that only need attributes skip payloads.
const SELECT_ATTRS = { key: true, creator: true, attributes: true }

/** Every matching entity, read page by page at one block. */
export async function queryAll(expression, { maxPages = 60, select = SELECT } = {}) {
  const full = `${scope()} AND ${expression}`
  const entities = []
  let cursor
  let block
  for (let page = 0; page < maxPages; page++) {
    const options = { limit: "0xc8", select }
    if (cursor) {
      options.cursor = cursor
      options.atBlock = block
    }
    const result = await rpc("arkiv_query", [full, options])
    if (block === undefined) block = result.blockNumber
    for (const raw of result.data ?? []) {
      const e = decodeEntity(raw)
      if (TRUSTED_CREATORS[e.creator]) entities.push(e) // belt and braces: never trust the filter alone
    }
    cursor = result.cursor
    if (!cursor) return { entities, block: hexToNumber(block), query: full }
  }
  throw new ArkivUnavailable(`Query exceeded ${maxPages} pages; refusing to show a partial result`, full)
}

export async function headBlock() {
  return hexToNumber(await rpc("eth_blockNumber", []))
}

/** All list versions (source documents), ordered per insurer. */
export async function loadSources() {
  const { entities, block } = await queryAll(`type = ${quote("source")}`)
  const sources = entities
    .filter((e) => e.payload && e.payload.doc_id === e.attrs.doc)
    .map((e) => ({ ...e.payload, version: e.attrs.version, hospitals: e.attrs.hospitals, entity: e }))
    .sort((a, b) => a.insurer.localeCompare(b.insurer) || a.version - b.version)
  return { sources, block }
}

/**
 * Live freshness leases. A lease expires 14 days after the last re-verification
 * of the insurer's PDF, so its absence means "stale", never "unchanged".
 */
export async function loadChecks() {
  const { entities, block } = await queryAll(`type = ${quote("check")}`)
  const latest = {}
  for (const e of entities) {
    const prev = latest[e.attrs.insurer]
    if (!prev || e.attrs.checked > prev.attrs.checked) latest[e.attrs.insurer] = e
  }
  return { checks: latest, block }
}

async function eventsForHospitals(keys) {
  const out = []
  for (let i = 0; i < keys.length; i += 20) {
    const ors = keys.slice(i, i + 20).map((k) => `hospital = ${quote(k)}`).join(" OR ")
    const { entities } = await queryAll(`type = ${quote("event")} AND (${ors})`)
    out.push(...entities)
  }
  return out
}

/**
 * Search by PIN (prefix) or hospital name (prefix of the squashed name), then
 * fetch every event of each matched hospital so no timeline is partial.
 */
export async function search(text, { limitHospitals = 60 } = {}) {
  const pin = pinQuery(text)
  const term = pin ?? nameIndex(text)
  if (!term || term.length < 2) return { hospitals: [], term: "" }
  const expression = pin
    ? pin.length === 6 ? `type = ${quote("event")} AND pin = ${quote(pin)}` : `type = ${quote("event")} AND pin STARTSWITH ${quote(pin)}`
    : `type = ${quote("event")} AND name STARTSWITH ${quote(term)}`
  const { entities, block } = await queryAll(expression, { select: SELECT_ATTRS })
  const keys = [...new Set(entities.map((e) => e.attrs.hospital))]
  const truncated = keys.length > limitHospitals
  const events = await eventsForHospitals(keys.slice(0, limitHospitals))
  return { hospitals: groupTimelines(events), term, block, truncated, matched: keys.length }
}

export async function hospital(key) {
  return groupTimelines(await eventsForHospitals([key]))[0] ?? null
}

/** Group events into one timeline per (insurer, hospital), ordered by list version. */
export function groupTimelines(events) {
  const groups = new Map()
  for (const e of events) {
    const id = `${e.attrs.insurer}:${e.attrs.hospital}`
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(e)
  }
  return [...groups.values()].map((list) => {
    list.sort((a, b) => a.attrs.version - b.attrs.version || a.attrs.seq - b.attrs.seq)
    const first = list.find((e) => e.attrs.kind === "listed") ?? list[0]
    return {
      insurer: first.attrs.insurer,
      key: first.attrs.hospital,
      name: first.payload?.name ?? first.attrs.name,
      city: first.payload?.city ?? "",
      state: first.attrs.state,
      pin: first.attrs.pin,
      pinValid: first.payload?.pin_valid !== false,
      events: list.map((e) => ({ kind: e.attrs.kind, version: e.attrs.version, doc: e.attrs.doc,
        effective: e.payload?.effective_date, sr: e.payload?.sr, page: e.payload?.page, name: e.payload?.name, entity: e })),
    }
  })
}

/**
 * Status of one timeline against the latest list version of its insurer.
 * "excluded"  - on the latest list;
 * "removed"   - was listed, then dropped in a later version;
 * A stale or missing freshness lease is reported separately by the caller.
 */
export function statusOf(timeline, latestVersion) {
  const last = timeline.events.at(-1)
  if (last.kind === "delisted") return { state: "removed", sinceDoc: last.doc, sinceVersion: last.version }
  const listedAt = [...timeline.events].reverse().find((e) => e.kind === "listed")
  return { state: "excluded", effective: listedAt.effective, sinceDoc: listedAt.doc, sinceVersion: listedAt.version, latestVersion }
}

/**
 * Replay the whole change log of an insurer and compare, version by version,
 * the replayed hospital count with the count the source record declares.
 */
export async function verifyInsurer(insurer) {
  const [{ sources }, { entities, block }] = await Promise.all([
    loadSources(),
    queryAll(`type = ${quote("event")} AND insurer = ${quote(insurer)}`, { maxPages: 80, select: SELECT_ATTRS }),
  ])
  const versions = sources.filter((s) => s.insurer === insurer)
  const byVersion = new Map()
  for (const e of entities) {
    if (!byVersion.has(e.attrs.version)) byVersion.set(e.attrs.version, [])
    byVersion.get(e.attrs.version).push(e)
  }
  const current = new Set()
  const rows = []
  for (const s of versions) {
    for (const e of byVersion.get(s.version) ?? []) {
      if (e.attrs.kind === "listed") current.add(e.attrs.hospital)
      else current.delete(e.attrs.hospital)
    }
    rows.push({ doc: s.doc_id, version: s.version, created: s.pdf_created, declared: s.hospitals,
      replayed: current.size, ok: current.size === s.hospitals, events: (byVersion.get(s.version) ?? []).length })
  }
  return { insurer, block, events: entities.length, rows, ok: rows.length > 0 && rows.every((r) => r.ok) }
}

/** Events that a given list version added or removed. */
export async function changesIn(insurer, version) {
  const { entities, block } = await queryAll(
    `type = ${quote("event")} AND insurer = ${quote(insurer)} AND version = i32(${Number(version)})`, { maxPages: 80 })
  const map = (e) => ({ name: e.payload?.name ?? e.attrs.name, city: e.payload?.city, state: e.attrs.state,
    pin: e.attrs.pin, key: e.attrs.hospital, effective: e.payload?.effective_date })
  return {
    block,
    listed: entities.filter((e) => e.attrs.kind === "listed").map(map),
    delisted: entities.filter((e) => e.attrs.kind === "delisted").map(map),
  }
}

/** Seconds until an entity expires, from its expiry block and the current head. */
export const secondsLeft = (expiresAt, head) => (expiresAt - head) * BLOCK_SECONDS

export { squash }
