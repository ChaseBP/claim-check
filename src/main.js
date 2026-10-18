import {
  ArkivUnavailable, search, loadSources, loadChecks, verifyInsurer, changesIn, statusOf, headBlock, secondsLeft,
} from "../shared/arkiv-read.js"
import { EXPLORER, INSURERS, TRUSTED_CREATORS } from "../shared/config.js"

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const insurerName = (id) => INSURERS[id] ?? id
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "unknown date")
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const entityLink = (key) => `<a class="mono" href="${EXPLORER}/entity/${key}" target="_blank" rel="noopener">${short(key)}</a>`

// Shared state, refreshed on load and every 5 minutes while visible.
const state = { sources: [], latest: {}, checks: {}, head: 0, loadedAt: 0, error: null }

function unavailable(err, what) {
  const reason = err instanceof ArkivUnavailable ? err.message : "Unexpected error"
  return `<div class="alert bad" role="alert"><span class="icon" aria-hidden="true">cloud_off</span><div><b>Couldn't read Arkiv${what ? ` (${esc(what)})` : ""}.</b> ${esc(reason)}. No result is shown rather than a possibly wrong one. <button class="link" data-retry>Try again</button></div></div>`
}

async function refreshMeta() {
  try {
    const [{ sources }, { checks }, head] = await Promise.all([loadSources(), loadChecks(), headBlock()])
    state.sources = sources
    state.latest = {}
    for (const s of sources) state.latest[s.insurer] = Math.max(state.latest[s.insurer] ?? -1, s.version)
    state.checks = checks
    state.head = head
    state.loadedAt = Date.now()
    state.error = null
  } catch (err) {
    state.error = err
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
    el.innerHTML = unavailable(state.error, "list versions")
    $("#block-info").textContent = "Arkiv unavailable"
    return
  }
  el.innerHTML = Object.keys(state.latest).map((insurer) => {
    const f = freshness(insurer)
    const versions = state.sources.filter((s) => s.insurer === insurer)
    const span = `${fmtDate(versions[0]?.pdf_created)} – ${fmtDate(versions.at(-1)?.pdf_created)}`
    return f.live
      ? `<div class="alert ok"><span class="icon" aria-hidden="true">verified</span><div><b>${esc(insurerName(insurer))}</b>: ${versions.length} list versions (${span}). Live PDF re-verified ${esc(f.checkedAt?.slice(0, 10))}; freshness lease ${f.daysLeft.toFixed(1)} days left.</div></div>`
      : `<div class="alert warn"><span class="icon" aria-hidden="true">schedule</span><div><b>${esc(insurerName(insurer))}: stale.</b> No live re-verification lease, so the insurer's current list may differ from the latest version shown (${fmtDate(versions.at(-1)?.pdf_created)}).</div></div>`
  }).join("")
  $("#block-info").textContent = `Read live from Arkiv Tiramisu at block ${state.head} · publisher ${short(Object.keys(TRUSTED_CREATORS)[0])}`
}

function versionChips(timeline) {
  const versions = state.sources.filter((s) => s.insurer === timeline.insurer)
  let on = false
  const byVersion = new Map(timeline.events.map((e) => [e.version, e]))
  return versions.map((s) => {
    const e = byVersion.get(s.version)
    if (e) on = e.kind === "listed"
    const cls = on ? "chip on" : "chip"
    const title = `${s.doc_id}: ${on ? "on the list" : "not on the list"}${e ? ` (${e.kind} here)` : ""}`
    return `<span class="${cls}" title="${esc(title)}">${esc(fmtDate(s.pdf_created))}</span>`
  }).join("")
}

function renderTimeline(t) {
  const s = statusOf(t, state.latest[t.insurer])
  const f = freshness(t.insurer)
  const src = state.sources.find((x) => x.doc_id === s.sinceDoc)
  const pill = s.state === "excluded"
    ? `<span class="pill bad"><span class="icon" aria-hidden="true">block</span>Excluded by ${esc(insurerName(t.insurer))}</span>`
    : `<span class="pill ok"><span class="icon" aria-hidden="true">check_circle</span>Removed from ${esc(insurerName(t.insurer))}'s list</span>`
  const detail = s.state === "excluded"
    ? `Effective ${esc(fmtDate(s.effective))}. On every version since ${esc(fmtDate(src?.pdf_created))}.${f.live ? "" : " <b>Stale:</b> the insurer's current list has not been re-verified."}`
    : `Dropped in the version created ${esc(fmtDate(src?.pdf_created))}.`
  const rows = t.events.map((e) => {
    const doc = state.sources.find((x) => x.doc_id === e.doc)
    return `<li><span class="k ${e.kind}">${e.kind}</span> in ${esc(fmtDate(doc?.pdf_created))} list${e.sr ? ` · row ${e.sr}, page ${e.page}` : ""} · ${doc ? `<a href="${esc(doc.source_url)}" target="_blank" rel="noopener">PDF</a>` : ""} · ${entityLink(e.entity.key)}</li>`
  }).join("")
  return `<article class="card">
    <div class="card-head"><div><h3>${esc(t.name)}</h3><p class="muted">${esc(t.city)}, ${esc(t.state)} · PIN ${esc(t.pin)}${t.pinValid ? "" : " <span class='tag' title='The insurer printed a malformed PIN; shown exactly as printed'>as printed</span>"}</p></div>${pill}</div>
    <p>${detail}</p>
    <div class="chips" aria-label="List versions">${versionChips(t)}</div>
    <details><summary><span class="icon" aria-hidden="true">expand_more</span>Evidence on Arkiv</summary><ul class="events">${rows}</ul></details>
  </article>`
}

async function runSearch(text) {
  const out = $("#results")
  if (!text.trim()) return (out.innerHTML = "")
  out.innerHTML = `<p class="loading"><span class="icon" aria-hidden="true">progress_activity</span>Searching Arkiv…</p>`
  try {
    if (!state.loadedAt) await refreshMeta()
    if (state.error) throw state.error
    const r = await search(text)
    if (!r.term) return (out.innerHTML = `<p class="muted">Type at least two letters, or a PIN prefix.</p>`)
    if (!r.hospitals.length) {
      const held = Object.keys(state.latest).map(insurerName).join(", ")
      out.innerHTML = `<div class="alert neutral"><span class="icon" aria-hidden="true">search_off</span><div><b>No hospital matching “${esc(text)}”</b> on any exclusion-list version held for ${esc(held)}.
        This is not a guarantee of payment: insurers update lists, and rows whose hospital name contains a person's name (e.g. “Dr …”) are withheld. Confirm with your insurer.</div></div>`
      return
    }
    const order = { excluded: 0, removed: 1 }
    r.hospitals.sort((a, b) => order[statusOf(a, state.latest[a.insurer]).state] - order[statusOf(b, state.latest[b.insurer]).state] || a.name.localeCompare(b.name))
    out.innerHTML = `<p class="muted">${r.hospitals.length} hospital${r.hospitals.length === 1 ? "" : "s"}${r.truncated ? ` (of ${r.matched}; narrow your search)` : ""} · read at block ${r.block}</p>` + r.hospitals.map(renderTimeline).join("")
  } catch (err) {
    out.innerHTML = unavailable(err, "search")
  }
}

async function renderChanges() {
  const sel = $("#version-select")
  const versions = state.sources.filter((s) => s.version > 0)
  if (!sel.options.length) {
    sel.innerHTML = versions.map((s) => `<option value="${s.insurer}|${s.version}">${esc(insurerName(s.insurer))} · ${esc(fmtDate(s.pdf_created))}</option>`).join("")
    sel.value = `${versions.at(-2)?.insurer}|${versions.at(-2)?.version}`
  }
  const out = $("#changes")
  const [insurer, version] = (sel.value || "").split("|")
  if (!insurer) return (out.innerHTML = state.error ? unavailable(state.error) : "")
  out.innerHTML = `<p class="loading"><span class="icon" aria-hidden="true">progress_activity</span>Reading changes from Arkiv…</p>`
  try {
    const { listed, delisted, block } = await changesIn(insurer, version)
    const stateSel = $("#state-filter")
    const states = [...new Set([...listed, ...delisted].map((h) => h.state))].sort()
    const keep = stateSel.value
    stateSel.innerHTML = `<option value="">All states</option>` + states.map((s) => `<option${s === keep ? " selected" : ""}>${esc(s)}</option>`).join("")
    const f = (list) => list.filter((h) => !stateSel.value || h.state === stateSel.value).sort((a, b) => a.name.localeCompare(b.name))
    const L = f(listed), D = f(delisted)
    const prev = state.sources.find((s) => s.insurer === insurer && s.version === Number(version) - 1)
    const item = (h) => `<li><a href="#lookup/${encodeURIComponent(h.pin)}">${esc(h.name)}</a> <span class="muted">${esc(h.city)}, ${esc(h.pin)}</span></li>`
    out.innerHTML = `<p class="muted">Compared with the version created ${esc(fmtDate(prev?.pdf_created))} · read at block ${block}</p>
      <div class="cols"><div class="panel"><h2><span class="k listed count">+${L.length}</span> listed</h2><ul class="plain">${L.map(item).join("") || "<li class='muted'>None</li>"}</ul></div>
      <div class="panel"><h2><span class="k delisted count">−${D.length}</span> delisted</h2><ul class="plain">${D.map(item).join("") || "<li class='muted'>None</li>"}</ul></div></div>`
  } catch (err) {
    out.innerHTML = unavailable(err, "changes")
  }
}

function renderSources() {
  const out = $("#sources")
  if (state.error) return (out.innerHTML = unavailable(state.error, "sources"))
  const rows = state.sources.map((s) => {
    const e = s.entity
    const flags = e.flags ?? {}
    const days = Math.round(secondsLeft(e.expiresAt, state.head) / 86400)
    return `<tr><td>${esc(insurerName(s.insurer))}<br><span class="muted">v${s.version}</span></td>
      <td>${esc(fmtDate(s.pdf_created))}<br><span class="muted">${s.pdf_pages} pages</span></td>
      <td>${s.hospitals}<br><span class="muted">${s.withheld_count} withheld</span></td>
      <td><a href="${esc(s.source_url)}" target="_blank" rel="noopener">PDF</a>${s.source_note ? `<br><span class="muted small">${esc(s.source_note)}</span>` : ""}</td>
      <td class="mono small">${esc(s.sha256)}</td>
      <td>${entityLink(e.key)}<br><span class="muted small">${flags.readonly ? "read-only" : "mutable"}${flags.permissionlessExtension ? " · anyone can extend" : ""} · ~${days} days left</span></td></tr>`
  }).join("")
  const checks = Object.entries(state.checks).map(([insurer, c]) => {
    const f = freshness(insurer)
    return `<li>${esc(insurerName(insurer))}: re-verified ${esc(f.checkedAt)} against ${esc(c.attrs.doc)}, lease ${f.daysLeft.toFixed(1)} days left · ${entityLink(c.key)}</li>`
  }).join("") || "<li>No live freshness lease: every insurer is shown as stale.</li>"
  out.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Insurer</th><th>PDF created</th><th>Hospitals</th><th>Source</th><th>SHA-256 of PDF</th><th>Arkiv entity</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Freshness leases</h2><ul class="plain">${checks}</ul>`
}

async function runVerify() {
  const out = $("#verify-out")
  out.innerHTML = `<p class="loading"><span class="icon" aria-hidden="true">progress_activity</span>Reading every event from Arkiv and replaying… (about 28 pages)</p>`
  try {
    const results = await Promise.all(Object.keys(state.latest).map(verifyInsurer))
    out.innerHTML = results.map((r) => `<div class="table-wrap"><table><thead><tr><th></th><th>Version</th><th>Declared</th><th>Replayed</th><th>Events</th></tr></thead><tbody>${
      r.rows.map((x) => `<tr><td><span class="icon k ${x.ok ? "delisted" : "listed"}" aria-label="${x.ok ? "match" : "mismatch"}">${x.ok ? "check_circle" : "error"}</span></td><td>${esc(x.doc)}</td><td class="count">${x.declared}</td><td class="count">${x.replayed}</td><td class="count">${x.events}</td></tr>`).join("")
    }</tbody></table></div><div class="alert ${r.ok ? "ok" : "bad"}" style="margin-top:12px"><span class="icon" aria-hidden="true">${r.ok ? "task_alt" : "error"}</span><div><b>${r.ok ? "Consistent" : "Inconsistent"}:</b> ${r.events.toLocaleString("en-IN")} events for ${esc(insurerName(r.insurer))} replayed at block ${r.block}.</div></div>`).join("")
  } catch (err) {
    out.innerHTML = unavailable(err, "verification")
  }
}

function route() {
  const [tab, arg] = (location.hash.replace(/^#/, "") || "lookup").split("/")
  const name = ["lookup", "changes", "sources", "why"].includes(tab) ? tab : "lookup"
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
  if (ev.target.matches("[data-retry]")) {
    refreshMeta().then(route)
  }
})
window.addEventListener("hashchange", route)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - state.loadedAt > 5 * 60 * 1000) refreshMeta()
})

refreshMeta().then(route)
