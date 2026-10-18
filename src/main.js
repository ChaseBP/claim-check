import {
  ArkivUnavailable, search, loadSources, loadChecks, verifyInsurer, changesIn, statusOf, headBlock, secondsLeft,
} from "../shared/arkiv-read.js"
import { EXPLORER, INSURERS, INSURER_SHORT, TRUSTED_CREATORS } from "../shared/config.js"
import { startLive } from "./live.js"
import { t, getLang, setLang } from "./i18n.js"

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const insurerName = (id) => INSURERS[id] ?? id
const locale = () => (getLang() === "hi" ? "hi-IN" : "en-IN")
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "?")
const fmtMonth = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "numeric", timeZone: "UTC" })
const vlabel = (s) => (!s ? "?" : s.label_month ? fmtMonth(s.version_date ?? `20${s.label_month.slice(-2)}-01-01`) : fmtDate(s.pdf_created))
const num = (n) => Number(n).toLocaleString(locale())
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const entityLink = (key) => `<a class="mono" href="${EXPLORER}/entity/${key}" target="_blank" rel="noopener">${short(key)}</a>`
const spinner = (text) => `<p class="loading"><span class="icon" aria-hidden="true">progress_activity</span>${esc(text)}</p>`

const state = { sources: [], latest: {}, checks: {}, head: 0, loadedAt: 0, error: null }
const META_CACHE = "claim-check-meta-v1"
const META_TTL_MS = 90 * 1000

function unavailable(err, whatKey) {
  const reason = err instanceof ArkivUnavailable ? err.message : "Unexpected error"
  return `<div class="alert bad" role="alert"><span class="icon" aria-hidden="true">cloud_off</span><div><b>${esc(t("err.title"))} (${esc(t(whatKey))}).</b> ${esc(reason)}. ${esc(t("err.body"))} <button class="link" data-retry>${esc(t("err.retry"))}</button></div></div>`
}

// List versions and leases change rarely; a 90-second session cache keeps tab
// switches and reloads from spending the keyless query budget.
function readCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem(META_CACHE) ?? "null")
    return c && Date.now() - c.at < META_TTL_MS ? c : null
  } catch {
    return null
  }
}
function writeCache() {
  try {
    const slim = (e) => ({ key: e.key, expiresAt: e.expiresAt, flags: e.flags, attrs: e.attrs, payload: e.payload })
    sessionStorage.setItem(META_CACHE, JSON.stringify({
      at: Date.now(), head: state.head,
      sources: state.sources.map((s) => ({ ...s, entity: slim(s.entity) })),
      checks: Object.fromEntries(Object.entries(state.checks).map(([k, e]) => [k, slim(e)])),
    }))
  } catch {
    // storage full or blocked: run uncached
  }
}

function applyMeta(sources, checks, head) {
  state.sources = sources
  state.latest = {}
  for (const s of sources) state.latest[s.insurer] = Math.max(state.latest[s.insurer] ?? -1, s.version)
  state.checks = checks
  state.head = head
  state.loadedAt = Date.now()
  state.error = null
}

async function refreshMeta({ force = false } = {}) {
  const cached = !force && readCache()
  if (cached) {
    applyMeta(cached.sources, cached.checks, cached.head)
  } else {
    try {
      const [{ sources }, { checks }, head] = await Promise.all([loadSources(), loadChecks(), headBlock()])
      applyMeta(sources, checks, head)
      writeCache()
    } catch (err) {
      state.error = err
    }
  }
  renderBanner()
}

function freshness(insurer) {
  const c = state.checks[insurer]
  if (!c) return { live: false }
  return { live: true, checkedAt: c.payload?.checked_at, daysLeft: Math.max(0, secondsLeft(c.expiresAt, state.head) / 86400), entity: c }
}

function renderBanner() {
  const el = $("#banner")
  if (state.error) {
    el.innerHTML = unavailable(state.error, "err.what.meta")
    $("#block-info").textContent = t("foot.unavailable")
    return
  }
  el.innerHTML = Object.keys(state.latest).map((insurer) => {
    const f = freshness(insurer)
    const versions = state.sources.filter((s) => s.insurer === insurer)
    const span = `${vlabel(versions[0])} – ${vlabel(versions.at(-1))}`
    return f.live
      ? `<div class="alert ok"><span class="icon" aria-hidden="true">verified</span><div>${t("banner.live", { i: esc(insurerName(insurer)), n: versions.length, span: esc(span), t: esc(fmtDate(f.checkedAt?.slice(0, 10))), d: f.daysLeft.toFixed(1) })}</div></div>`
      : `<div class="alert warn"><span class="icon" aria-hidden="true">schedule</span><div>${t("banner.stale", { i: esc(insurerName(insurer)), v: esc(vlabel(versions.at(-1))) })}</div></div>`
  }).join("")
  $("#block-info").textContent = t("foot.read", { b: state.head, p: short(Object.keys(TRUSTED_CREATORS)[0]) })
  renderFacts()
}

function renderFacts() {
  const insurers = Object.keys(state.latest).length
  $("#facts").innerHTML = [
    [num(state.sources.length), t("facts.versions")],
    [num(insurers), t("facts.insurers")],
    [String(state.head), t("facts.block")],
  ].map(([b, label]) => `<div><b>${esc(b)}</b><span>${esc(label)}</span></div>`).join("")
}

function versionChips(timeline) {
  const versions = state.sources.filter((s) => s.insurer === timeline.insurer)
  const byVersion = new Map(timeline.events.map((e) => [e.version, e]))
  let on = false
  return versions.map((s) => {
    const e = byVersion.get(s.version)
    if (e) on = e.kind === "listed"
    const title = `${s.doc_id}: ${on ? t("chip.on") : t("chip.off")}${e ? ` (${t(`kind.${e.kind}`)})` : ""}`
    return `<span class="${on ? "chip on" : "chip"}" title="${esc(title)}">${esc(vlabel(s))}</span>`
  }).join("")
}

function renderInsurer(tl) {
  const s = statusOf(tl, state.latest[tl.insurer])
  const f = freshness(tl.insurer)
  const src = state.sources.find((x) => x.doc_id === s.sinceDoc)
  const pill = s.state === "excluded"
    ? `<span class="pill bad"><span class="icon" aria-hidden="true">block</span>${esc(t("pill.excluded"))}</span>`
    : `<span class="pill ok"><span class="icon" aria-hidden="true">check_circle</span>${esc(t("pill.removed"))}</span>`
  const since = src?.effective_basis === "list-month"
    ? t("ins.sinceMonth", { v: esc(vlabel(src)) })
    : t("ins.sinceDate", { d: esc(fmtDate(s.effective)), v: esc(vlabel(src)) })
  const detail = s.state === "excluded" ? `${since}${f.live ? "" : t("ins.stale")}` : t("ins.dropped", { v: esc(vlabel(src)) })
  const rows = tl.events.map((e) => {
    const doc = state.sources.find((x) => x.doc_id === e.doc)
    const where = e.sr ? ` · ${t("ins.row", { r: e.sr, p: e.page })}` : ""
    const pdf = doc ? ` · <a href="${esc(doc.source_url)}" target="_blank" rel="noopener">PDF</a>` : ""
    return `<li><span class="k ${e.kind}">${esc(t(`kind.${e.kind}`))}</span> ${esc(t("ins.in", { v: vlabel(doc) }))}${where}${pdf} · ${entityLink(e.entity.key)}</li>`
  }).join("")
  return `<section class="ins st-${s.state}">
    <div class="ins-head"><h4>${esc(insurerName(tl.insurer))}</h4>${pill}</div>
    <p>${detail}</p>
    <div class="chips" aria-label="${esc(insurerName(tl.insurer))}">${versionChips(tl)}</div>
    <details><summary><span class="icon" aria-hidden="true">expand_more</span>${esc(t("ins.evidence"))}</summary><ul class="events">${rows}</ul></details>
  </section>`
}

function renderAbsent(insurer) {
  const versions = state.sources.filter((s) => s.insurer === insurer)
  return `<section class="ins absent">
    <div class="ins-head"><h4>${esc(insurerName(insurer))}</h4><span class="pill neutral"><span class="icon" aria-hidden="true">remove</span>${esc(t("pill.absent"))}</span></div>
    <p class="muted">${esc(t("ins.absent", { n: versions.length, i: insurerName(insurer), a: vlabel(versions[0]), b: vlabel(versions.at(-1)) }))}</p>
  </section>`
}

/** One card per hospital, with a row for every insurer, so policies can be compared. */
function renderHospital(group) {
  const named = [...group.timelines].sort((a, b) => b.name.length - a.name.length)[0]
  const byInsurer = new Map(group.timelines.map((tl) => [tl.insurer, tl]))
  const badPin = named.pinValid ? "" : ` <span class="tag" title="${esc(t("pin.asPrintedTitle"))}">${esc(t("pin.asPrinted"))}</span>`
  return `<article class="card">
    <div class="card-head"><div><h3>${esc(named.name)}</h3><p class="muted">${esc(named.city)}, ${esc(named.state)} · PIN ${esc(named.pin)}${badPin}</p></div></div>
    <div class="ins-list">${Object.keys(state.latest).map((i) => (byInsurer.has(i) ? renderInsurer(byInsurer.get(i)) : renderAbsent(i))).join("")}</div>
  </article>`
}

function groupByHospital(timelines) {
  const groups = new Map()
  for (const tl of timelines) {
    if (!groups.has(tl.key)) groups.set(tl.key, { key: tl.key, timelines: [] })
    groups.get(tl.key).timelines.push(tl)
  }
  const rank = (g) => Math.min(...g.timelines.map((tl) => (statusOf(tl, state.latest[tl.insurer]).state === "excluded" ? 0 : 1)))
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.timelines.length - a.timelines.length ||
    a.timelines[0].name.localeCompare(b.timelines[0].name))
}

let lastSearch = null
async function runSearch(text) {
  const out = $("#results")
  if (!text.trim()) return (out.innerHTML = "")
  out.innerHTML = spinner(t("search.loading"))
  try {
    if (!state.loadedAt) await refreshMeta()
    if (state.error) throw state.error
    const r = lastSearch?.text === text ? lastSearch.result : await search(text)
    lastSearch = { text, result: r }
    if (!r.term) return (out.innerHTML = `<p class="muted">${esc(t("search.short"))}</p>`)
    if (!r.hospitals.length) {
      const held = Object.keys(state.latest).map(insurerName).join(", ")
      out.innerHTML = `<div class="alert neutral"><span class="icon" aria-hidden="true">search_off</span><div>${t("search.none", { q: esc(text), i: esc(held) })}</div></div>`
      return
    }
    const groups = groupByHospital(r.hospitals)
    const count = groups.length === 1 ? t("search.count1", { b: r.block }) : t("search.count", { n: num(groups.length), b: r.block })
    out.innerHTML = `<p class="muted">${esc(count)}${r.truncated ? esc(t("search.more")) : ""}</p>` + groups.map(renderHospital).join("")
  } catch (err) {
    out.innerHTML = unavailable(err, "err.what.search")
  }
}

async function renderChanges() {
  const sel = $("#version-select")
  const versions = state.sources.filter((s) => s.version > 0)
  const keepVersion = sel.value
  sel.innerHTML = versions.map((s) => `<option value="${s.insurer}|${s.version}">${esc(insurerName(s.insurer))} · ${esc(vlabel(s))}</option>`).join("")
  const pick = versions.filter((s) => s.insurer === "hdfc-ergo").at(-2) ?? versions[0]
  sel.value = keepVersion || `${pick?.insurer}|${pick?.version}`
  const out = $("#changes")
  const [insurer, version] = (sel.value || "").split("|")
  if (!insurer) return (out.innerHTML = state.error ? unavailable(state.error, "err.what.changes") : "")
  out.innerHTML = spinner(t("changes.loading"))
  try {
    const { listed, delisted, block } = await changesIn(insurer, version)
    const stateSel = $("#state-filter")
    const states = [...new Set([...listed, ...delisted].map((h) => h.state))].sort()
    const keep = stateSel.value
    stateSel.innerHTML = `<option value="">${esc(t("changes.allStates"))}</option>` + states.map((s) => `<option${s === keep ? " selected" : ""}>${esc(s)}</option>`).join("")
    const f = (list) => list.filter((h) => !stateSel.value || h.state === stateSel.value).sort((a, b) => a.name.localeCompare(b.name))
    const L = f(listed), D = f(delisted)
    const prev = state.sources.find((s) => s.insurer === insurer && s.version === Number(version) - 1)
    const item = (h) => `<li><a href="#lookup/${encodeURIComponent(h.pin)}">${esc(h.name)}</a> <span class="muted">${esc(h.city)}, ${esc(h.pin)}</span></li>`
    const none = `<li class="muted">${esc(t("changes.none"))}</li>`
    out.innerHTML = `<p class="muted">${esc(t("changes.compared", { v: vlabel(prev), b: block }))}</p>
      <div class="cols"><div class="panel"><h2><span class="k listed count">+${num(L.length)}</span> ${esc(t("changes.listed"))}</h2><ul class="plain">${L.map(item).join("") || none}</ul></div>
      <div class="panel"><h2><span class="k delisted count">−${num(D.length)}</span> ${esc(t("changes.delisted"))}</h2><ul class="plain">${D.map(item).join("") || none}</ul></div></div>`
  } catch (err) {
    out.innerHTML = unavailable(err, "err.what.changes")
  }
}

function renderSources() {
  const out = $("#sources")
  if (state.error) return (out.innerHTML = unavailable(state.error, "err.what.sources"))
  const cols = t("sources.cols")
  const rows = state.sources.map((s) => {
    const e = s.entity
    const flags = e.flags ?? {}
    const days = Math.round(secondsLeft(e.expiresAt, state.head) / 86400)
    const flagText = `${flags.readonly ? t("sources.readonly") : t("sources.mutable")}${flags.permissionlessExtension ? ` · ${t("sources.anyone")}` : ""} · ${t("sources.daysLeft", { n: days })}`
    return `<tr><td class="nowrap">${esc(INSURER_SHORT[s.insurer] ?? insurerName(s.insurer))}<br><span class="muted">v${s.version}</span></td>
      <td class="nowrap">${esc(vlabel(s))}<br><span class="muted small">${esc(t("sources.pdfCreated", { d: s.pdf_created, p: s.pdf_pages }))}</span></td>
      <td class="nowrap">${num(s.hospitals)}<br><span class="muted small">${esc(t("sources.withheld", { n: s.withheld_count }))}</span></td>
      <td><a href="${esc(s.source_url)}" target="_blank" rel="noopener">PDF</a>${s.source_note ? `<br><span class="muted small">${esc(s.source_note)}</span>` : ""}</td>
      <td class="mono small">${esc(s.sha256)}</td>
      <td>${entityLink(e.key)}<br><span class="muted small">${esc(flagText)}</span></td></tr>`
  }).join("")
  const checks = Object.entries(state.checks).map(([insurer, c]) => {
    const f = freshness(insurer)
    return `<li>${esc(t("sources.lease", { i: insurerName(insurer), t: f.checkedAt, d: c.attrs.doc, n: f.daysLeft.toFixed(1) }))} · ${entityLink(c.key)}</li>`
  }).join("") || `<li>${esc(t("sources.noLease"))}</li>`
  out.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <h2>${esc(t("sources.leases"))}</h2><ul class="plain">${checks}</ul>`
}

async function runVerify() {
  const out = $("#verify-out")
  out.innerHTML = spinner(t("verify.loading"))
  try {
    const results = await Promise.all(Object.keys(state.latest).map(verifyInsurer))
    const cols = t("verify.cols")
    out.innerHTML = results.map((r) => `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
      r.rows.map((x) => `<tr><td><span class="icon k ${x.ok ? "delisted" : "listed"}" aria-label="${x.ok ? "match" : "mismatch"}">${x.ok ? "check_circle" : "error"}</span></td><td>${esc(x.doc)}</td><td class="count">${num(x.declared)}</td><td class="count">${num(x.replayed)}</td><td class="count">${num(x.events)}</td></tr>`).join("")
    }</tbody></table></div><div class="alert ${r.ok ? "ok" : "bad"}" style="margin:12px 0 20px"><span class="icon" aria-hidden="true">${r.ok ? "task_alt" : "error"}</span><div><b>${esc(r.ok ? t("verify.ok") : t("verify.bad"))}:</b> ${esc(t("verify.summary", { n: num(r.events), i: insurerName(r.insurer), b: r.block }))}</div></div>`).join("")
  } catch (err) {
    out.innerHTML = unavailable(err, "err.what.verify")
  }
}

// Static text marked with data-i18n / data-i18n-placeholder in index.html.
function translateStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)))
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)))
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === getLang() ? "true" : "false"))
}

function currentTab() {
  const [tab, arg] = (location.hash.replace(/^#/, "") || "lookup").split("/")
  return { name: ["lookup", "changes", "sources", "why"].includes(tab) ? tab : "lookup", arg }
}

function route() {
  const { name, arg } = currentTab()
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== `tab-${name}`))
  document.querySelectorAll("[data-tab]").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === name ? "page" : "false"))
  if (name === "lookup" && arg) {
    const q = decodeURIComponent(arg)
    $("#q").value = q
    runSearch(q)
  }
  if (name === "changes") renderChanges()
  if (name === "sources") renderSources()
}

function toast(text) {
  const el = document.createElement("div")
  el.className = "toast"
  el.setAttribute("role", "status")
  el.innerHTML = `<span class="icon" aria-hidden="true">bolt</span><span>${esc(text)}</span>`
  document.body.append(el)
  setTimeout(() => el.classList.add("out"), 4200)
  setTimeout(() => el.remove(), 4800)
}

let refreshTimer = null
function refreshSoon(messageKey) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    await refreshMeta({ force: true })
    toast(t(messageKey))
    if (currentTab().name === "sources") renderSources()
  }, 1500) // coalesce a burst of events into one re-read
}

$("#search-form").addEventListener("submit", (ev) => {
  ev.preventDefault()
  const q = $("#q").value.trim()
  if (location.hash === `#lookup/${encodeURIComponent(q)}`) runSearch(q)
  else location.hash = `lookup/${encodeURIComponent(q)}`
})
$("#version-select").addEventListener("change", renderChanges)
$("#state-filter").addEventListener("change", renderChanges)
$("#verify-btn").addEventListener("click", runVerify)
document.addEventListener("click", (ev) => {
  const retry = ev.target.closest("[data-retry]")
  if (retry) {
    lastSearch = null
    refreshMeta({ force: true }).then(route)
  }
  const langBtn = ev.target.closest("[data-lang]")
  if (langBtn) {
    setLang(langBtn.dataset.lang)
    translateStatic()
    renderBanner()
    route()
  }
})
window.addEventListener("hashchange", route)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - state.loadedAt > 5 * 60 * 1000) refreshMeta({ force: true })
})

setLang(getLang())
translateStatic()
refreshMeta().then(() => {
  route()
  startLive({
    leaseKeys: () => new Set(Object.values(state.checks).map((c) => c.key.toLowerCase())),
    onPublisherWrite: () => refreshSoon("toast.write"),
    onLeaseRenewed: () => refreshSoon("toast.lease"),
    onStatus: (s) => {
      const el = $("#live")
      el.dataset.state = s
      el.textContent = t(s === "live" ? "live.on" : s === "paused" ? "live.paused" : "live.off")
    },
  })
})
