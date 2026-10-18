// Page renderers. Each returns HTML for #app and may run an async `after` step that
// fills in live Arkiv data. Every live number on the site comes from Arkiv reads.
import {
  ArkivUnavailable, search, hospitalTimelines, verifyInsurer, changesIn, statusOf, secondsLeft,
} from "../shared/arkiv-read.js"
import { EXPLORER, INSURERS, INSURER_SHORT, TRUSTED_CREATORS, APP, RPC_URL } from "../shared/config.js"
import { t, getLang } from "./i18n.js"

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const $ = (sel) => document.querySelector(sel)
const insurerName = (id) => INSURERS[id] ?? id
const shortName = (id) => INSURER_SHORT[id] ?? insurerName(id)
const locale = () => (getLang() === "hi" ? "hi-IN" : "en-IN")
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "?")
const fmtMonth = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "numeric", timeZone: "UTC" })
export const vlabel = (s) => (!s ? "?" : s.label_month ? fmtMonth(s.version_date ?? `20${s.label_month.slice(-2)}-01-01`) : fmtDate(s.pdf_created))
export const num = (n) => Number(n).toLocaleString(locale())
const short = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`
const entityLink = (key) => `<a class="mono" href="${EXPLORER}/entity/${key}" target="_blank" rel="noopener">${short(key)}</a>`
const spinner = (text) => `<p class="loading"><span class="icon" aria-hidden="true">progress_activity</span>${esc(text)}</p>`
const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`
const copyBtn = (text) => `<button type="button" class="copy" data-copy="${esc(text)}" aria-label="Copy">${icon("content_copy")}</button>`

export function unavailable(err, whatKey = "err.what.meta") {
  const reason = err instanceof ArkivUnavailable ? err.message : "Unexpected error"
  return `<div class="alert bad" role="alert">${icon("cloud_off")}<div><b>${esc(t("err.title"))} (${esc(t(whatKey))}).</b> ${esc(reason)}. ${esc(t("err.body"))} <button class="link" data-retry>${esc(t("err.retry"))}</button></div></div>`
}

const section = (eyebrow, title, body = "", extra = "") =>
  `<section class="section ${extra}"><div class="wrap"><p class="eyebrow">${esc(eyebrow)}</p><h2 class="h2">${title}</h2>${body}</div></section>`

// ---------------------------------------------------------------- shared bits

export function freshness(state, insurer) {
  const c = state.checks[insurer]
  if (!c) return { live: false }
  return { live: true, checkedAt: c.payload?.checked_at, daysLeft: Math.max(0, secondsLeft(c.expiresAt, state.head) / 86400), entity: c }
}

function versionsOf(state, insurer) {
  return state.sources.filter((s) => s.insurer === insurer)
}

function versionChips(state, timeline) {
  const byVersion = new Map(timeline.events.map((e) => [e.version, e]))
  let on = false
  return versionsOf(state, timeline.insurer).map((s) => {
    const e = byVersion.get(s.version)
    if (e) on = e.kind === "listed"
    const title = `${s.doc_id}: ${on ? t("chip.on") : t("chip.off")}${e ? ` (${t(`kind.${e.kind}`)})` : ""}`
    return `<span class="${on ? "chip on" : "chip"}" title="${esc(title)}">${esc(vlabel(s))}</span>`
  }).join("")
}

function renderInsurer(state, tl) {
  const s = statusOf(tl, state.latest[tl.insurer])
  const f = freshness(state, tl.insurer)
  const src = state.sources.find((x) => x.doc_id === s.sinceDoc)
  const pill = s.state === "excluded"
    ? `<span class="pill bad">${icon("block")}${esc(t("pill.excluded"))}</span>`
    : `<span class="pill ok">${icon("check_circle")}${esc(t("pill.removed"))}</span>`
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
    <div class="chips">${versionChips(state, tl)}</div>
    <details><summary>${icon("expand_more")}${esc(t("ins.evidence"))}</summary><ul class="events">${rows}</ul></details>
  </section>`
}

function renderAbsent(state, insurer) {
  const versions = versionsOf(state, insurer)
  return `<section class="ins absent">
    <div class="ins-head"><h4>${esc(insurerName(insurer))}</h4><span class="pill neutral">${icon("remove")}${esc(t("pill.absent"))}</span></div>
    <p class="muted">${esc(t("ins.absent", { n: versions.length, i: insurerName(insurer), a: vlabel(versions[0]), b: vlabel(versions.at(-1)) }))}</p>
  </section>`
}

export function renderHospital(state, group, { link = true } = {}) {
  const named = [...group.timelines].sort((a, b) => b.name.length - a.name.length)[0]
  const byInsurer = new Map(group.timelines.map((tl) => [tl.insurer, tl]))
  const badPin = named.pinValid ? "" : ` <span class="tag" title="${esc(t("pin.asPrintedTitle"))}">${esc(t("pin.asPrinted"))}</span>`
  const title = link ? `<a href="#/hospital/${esc(group.key)}">${esc(named.name)}</a>` : esc(named.name)
  return `<article class="card">
    <div class="card-head"><div><h3>${title}</h3><p class="meta">${esc(named.city)}, ${esc(named.state)} · PIN ${esc(named.pin)}${badPin}</p></div>
    ${link ? `<a class="card-link" href="#/hospital/${esc(group.key)}" aria-label="Open hospital page">${icon("arrow_outward")}</a>` : ""}</div>
    <div class="ins-list">${Object.keys(state.latest).map((i) => (byInsurer.has(i) ? renderInsurer(state, byInsurer.get(i)) : renderAbsent(state, i))).join("")}</div>
  </article>`
}

function groupByHospital(state, timelines) {
  const groups = new Map()
  for (const tl of timelines) {
    if (!groups.has(tl.key)) groups.set(tl.key, { key: tl.key, timelines: [] })
    groups.get(tl.key).timelines.push(tl)
  }
  const rank = (g) => Math.min(...g.timelines.map((tl) => (statusOf(tl, state.latest[tl.insurer]).state === "excluded" ? 0 : 1)))
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.timelines.length - a.timelines.length ||
    a.timelines[0].name.localeCompare(b.timelines[0].name))
}

const searchForm = (q = "", { big = false } = {}) => `
  <form class="search ${big ? "search-big" : ""}" role="search" data-search>
    ${icon("search")}
    <label for="q" class="sr-only">${esc(t("lookup.label"))}</label>
    <input id="q" name="q" autocomplete="off" value="${esc(q)}" placeholder="${esc(t("lookup.placeholder"))}" />
    <button type="submit">${esc(t("lookup.button"))}</button>
  </form>
  <p class="hint"><span>${esc(t("lookup.try"))}</span>
    <a href="#/lookup?q=131021">131021</a><a href="#/lookup?q=gaurav%20hospital">Gaurav Hospital</a><a href="#/lookup?q=repose">Repose</a><a href="#/lookup?q=1220">${esc(t("lookup.pinPrefix"))}</a></p>`

function bars(versions, { height = 46 } = {}) {
  if (!versions.length) return ""
  const max = Math.max(...versions.map((v) => v.hospitals))
  const w = 100 / versions.length
  return `<svg class="bars" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-label="Hospitals per list version">${versions.map((v, i) => {
    const h = Math.max(2, (v.hospitals / max) * (height - 4))
    return `<rect x="${i * w + w * 0.18}" y="${height - h}" width="${w * 0.64}" height="${h}" rx="0.6"><title>${esc(vlabel(v))}: ${num(v.hospitals)}</title></rect>`
  }).join("")}</svg>`
}

// ---------------------------------------------------------------- home

export function home(state) {
  const latest = (i) => versionsOf(state, i).at(-1)
  const hdfc = versionsOf(state, "hdfc-ergo")
  const insurers = Object.keys(state.latest)
  const onLists = insurers.reduce((sum, i) => sum + (latest(i)?.hospitals ?? 0), 0)
  const steps = [
    ["01", t("how.1.t"), t("how.1.d")],
    ["02", t("how.2.t"), t("how.2.d")],
    ["03", t("how.3.t"), t("how.3.d")],
    ["04", t("how.4.t"), t("how.4.d")],
    ["05", t("how.5.t"), t("how.5.d")],
  ]
  const html = `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${esc(t("hero.eyebrow"))}</p>
      <h1 class="display">${esc(t("hero.h1"))}</h1>
      <p class="lede">${esc(t("hero.lede"))}</p>
      ${searchForm("", { big: true })}
      <dl class="stats">
        <div><dt>${esc(t("stat.versions"))}</dt><dd data-count="${state.sources.length}">${num(state.sources.length)}</dd></div>
        <div><dt>${esc(t("stat.insurers"))}</dt><dd data-count="${insurers.length}">${num(insurers.length)}</dd></div>
        <div><dt>${esc(t("stat.onlists"))}</dt><dd data-count="${onLists}">${num(onLists)}</dd></div>
        <div><dt>${esc(t("stat.block"))}</dt><dd>${state.head}</dd></div>
      </dl>
    </div>
    <div class="hero-art" aria-hidden="true">${heroArt(state)}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <p class="eyebrow">${esc(t("problem.eyebrow"))}</p>
    <h2 class="h2">${esc(t("problem.h2"))}</h2>
    <p class="lede">${esc(t("problem.lede"))}</p>
    <div class="facts3">
      <div><b>1,815</b><p>${esc(t("problem.f1"))}</p></div>
      <div><b>1,368</b><p>${esc(t("problem.f2"))}</p></div>
      <div><b class="mono-b">12-02-2025</b><p>${esc(t("problem.f3"))}</p></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <p class="eyebrow">${esc(t("how.eyebrow"))}</p>
    <h2 class="h2">${esc(t("how.h2"))}</h2>
    <div class="stepper" data-stepper>
      <ol class="steps">${steps.map(([n, title, d], i) => `<li><button type="button" data-step="${i}" aria-pressed="${i === 0}"><span class="n">${n}</span><span><b>${esc(title)}</b><span>${esc(d)}</span></span></button></li>`).join("")}</ol>
      <div class="step-panel panel" id="step-panel" aria-live="polite"></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><div><p class="eyebrow">${esc(t("recent.eyebrow"))}</p><h2 class="h2">${esc(t("recent.h2"))}</h2></div>
    <a class="btn-ghost" href="#/changes">${esc(t("recent.all"))} ${icon("arrow_forward")}</a></div>
    <div id="recent">${spinner(t("changes.loading"))}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <p class="eyebrow">${esc(t("flow.eyebrow"))}</p>
    <h2 class="h2">${esc(t("flow.h2"))}</h2>
    <p class="lede">${esc(t("flow.lede"))}</p>
    <div class="flow panel">
      <div class="node"><span>${icon("description")}</span><b>${esc(t("flow.pdf"))}</b><small>${esc(t("flow.pdf.s"))}</small></div>
      <i class="edge"></i>
      <div class="node"><span>${icon("fingerprint")}</span><b>SHA-256</b><small>${esc(t("flow.hash.s"))}</small></div>
      <i class="edge"></i>
      <div class="node accent"><span>${icon("inventory_2")}</span><b>source</b><small>${esc(t("flow.source.s"))}</small></div>
      <i class="edge"></i>
      <div class="node accent"><span>${icon("history")}</span><b>event ×${num(7268)}</b><small>${esc(t("flow.events.s"))}</small></div>
      <i class="edge"></i>
      <div class="node"><span>${icon("devices")}</span><b>${esc(t("flow.readers"))}</b><small>${esc(t("flow.readers.s"))}</small></div>
    </div>
    <p class="caption mono">${esc(t("flow.caption", { p: short(Object.keys(TRUSTED_CREATORS)[0]) }))}</p>
  </div></section>

  <section class="section"><div class="wrap split">
    <div>
      <p class="eyebrow">${esc(t("cli.eyebrow"))}</p>
      <h2 class="h2">${esc(t("cli.h2"))}</h2>
      <p class="lede">${esc(t("cli.lede"))}</p>
      <ul class="ticks">
        <li>${icon("check")}${esc(t("cli.p1"))}</li>
        <li>${icon("check")}${esc(t("cli.p2"))}</li>
        <li>${icon("check")}${esc(t("cli.p3"))}</li>
      </ul>
      <a class="btn" href="#/developers">${esc(t("cli.cta"))}</a>
    </div>
    ${codeTabs()}
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><div><p class="eyebrow">${esc(t("cov.eyebrow"))}</p><h2 class="h2">${esc(t("cov.h2"))}</h2></div>
    <a class="btn-ghost" href="#/insurers">${esc(t("cov.all"))} ${icon("arrow_forward")}</a></div>
    <div class="cov-grid">${insurers.map((i) => coverageCard(state, i)).join("")}</div>
  </div></section>

  <section class="section"><div class="wrap split faq-wrap">
    <div><p class="eyebrow">${esc(t("faq.eyebrow"))}</p><h2 class="h2">${esc(t("faq.h2"))}</h2><p class="lede">${esc(t("faq.lede"))}</p></div>
    <div class="faq">${[1, 2, 3, 4, 5, 6].map((n) => `<details><summary>${esc(t(`faq.q${n}`))}${icon("add")}</summary><p>${t(`faq.a${n}`)}</p></details>`).join("")}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="cta">
      <h2 class="h2">${esc(t("cta.h2"))}</h2>
      <p class="lede">${esc(t("cta.lede"))}</p>
      <div class="cta-actions"><a class="btn" href="#/lookup">${icon("search")}${esc(t("cta.primary"))}</a><a class="btn btn-secondary" href="#/about/method">${esc(t("cta.secondary"))}</a></div>
    </div>
  </div></section>`

  const after = async () => {
    stepperInit(state)
    try {
      const tata = "tata-aig"
      const tv = versionsOf(state, tata).filter((v) => v.version > 0).slice(-4)
      const rows = []
      for (const v of tv.reverse()) {
        const c = await changesIn(tata, v.version)
        for (const h of c.delisted) rows.push({ v, insurer: tata, h, kind: "delisted" })
        for (const h of c.listed) rows.push({ v, insurer: tata, h, kind: "listed" })
        if (rows.length >= 9) break
      }
      const hv = hdfc.find((v) => v.version === 2)
      const hdfcRow = hv ? `<tr class="summary-row"><td>${esc(vlabel(hv))}</td><td>HDFC ERGO</td><td colspan="3">${esc(t("recent.hdfc", { a: num(878), d: num(1815) }))}</td><td><a href="#/changes?i=hdfc-ergo&v=2">${esc(t("recent.view"))}</a></td></tr>` : ""
      $("#recent").innerHTML = `<div class="table-wrap"><table><thead><tr><th>${esc(t("recent.c.when"))}</th><th>${esc(t("recent.c.ins"))}</th><th>${esc(t("recent.c.hosp"))}</th><th>PIN</th><th>${esc(t("recent.c.change"))}</th><th>${esc(t("recent.c.rec"))}</th></tr></thead><tbody>${
        rows.slice(0, 8).map((r) => `<tr><td class="nowrap">${esc(vlabel(r.v))}</td><td class="nowrap">${esc(shortName(r.insurer))}</td><td><a href="#/hospital/${esc(r.h.key)}">${esc(r.h.name)}</a><span class="muted"> · ${esc(r.h.city)}</span></td><td class="mono">${esc(r.h.pin)}</td><td><span class="pill ${r.kind === "listed" ? "bad" : "ok"}">${esc(t(r.kind === "listed" ? "recent.added" : "recent.dropped"))}</span></td><td class="mono">${esc(r.v.doc_id)}</td></tr>`).join("")
      }${hdfcRow}</tbody></table></div>`
    } catch (err) {
      $("#recent").innerHTML = unavailable(err, "err.what.changes")
    }
  }
  return { html, after }
}

function heroArt(state) {
  // A stack of list versions on rice paper; struck rows are exclusions, the seal is the publisher.
  const v = versionsOf(state, "hdfc-ergo").length || 4
  const sheets = Array.from({ length: Math.min(v, 4) }, (_, i) => i)
  return `<svg viewBox="0 0 420 380" class="art">
    ${sheets.map((i) => `<g transform="translate(${36 + i * 22} ${30 + i * 26}) rotate(${-4 + i * 2.5} 150 140)">
      <rect width="300" height="230" rx="6" class="sheet" />
      ${Array.from({ length: 8 }, (_, r) => `<rect x="24" y="${34 + r * 22}" width="${150 + ((r * 37 + i * 17) % 90)}" height="6" rx="3" class="${(r + i) % 4 === 1 ? "row-x" : (r + i) % 5 === 3 ? "row-ok" : "row"}" />`).join("")}
      <text x="24" y="22" class="sheet-t">v${i}</text>
    </g>`).join("")}
    <g transform="translate(300 270) rotate(-8)"><rect x="-38" y="-38" width="76" height="76" rx="10" class="seal"/><path d="M-16 1 l10 10 l22 -24" class="seal-mark"/></g>
  </svg>`
}

function coverageCard(state, insurer) {
  const versions = versionsOf(state, insurer)
  const f = freshness(state, insurer)
  return `<a class="cov panel" href="#/insurers#${esc(insurer)}">
    <div class="cov-top"><b>${esc(insurerName(insurer))}</b><span class="pill ${f.live ? "ok" : "warn"}">${icon(f.live ? "verified" : "schedule")}${esc(f.live ? t("cov.fresh", { d: f.daysLeft.toFixed(0) }) : t("cov.stale"))}</span></div>
    ${bars(versions)}
    <div class="cov-meta"><span><b>${versions.length}</b> ${esc(t("cov.versions"))}</span><span><b>${num(versions.at(-1)?.hospitals ?? 0)}</b> ${esc(t("cov.now"))}</span><span class="muted">${esc(vlabel(versions[0]))} – ${esc(vlabel(versions.at(-1)))}</span></div>
  </a>`
}

function codeTabs() {
  const tabs = [
    ["bun", "git clone https://github.com/ChaseBP/claim-check\ncd claim-check\nbun cli/claim-check.mjs search 131021\nbun cli/claim-check.mjs verify hdfc-ergo"],
    ["node", "git clone https://github.com/ChaseBP/claim-check\ncd claim-check\nnode cli/claim-check.mjs search 131021\nnode cli/claim-check.mjs verify tata-aig"],
    ["curl", `curl -s ${RPC_URL} \\\n  -H 'Content-Type: application/json' -d \\\n  "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"arkiv_query\\",\\"params\\":[\\"app = str('${APP}') AND type = str('event') AND pin = str('131021')\\",{\\"limit\\":\\"0xc8\\",\\"select\\":{\\"attributes\\":true,\\"payload\\":true}}]}"`],
  ]
  return `<div class="code panel" data-tabs>
    <div class="code-tabs" role="tablist">${tabs.map(([n], i) => `<button type="button" role="tab" data-tab="${n}" aria-selected="${i === 0}">${n}</button>`).join("")}</div>
    ${tabs.map(([n, code], i) => `<div class="code-body" data-pane="${n}" ${i ? "hidden" : ""}><pre><code>${esc(code).split("\n").map((l) => `<span class="prompt">$</span> ${l}`).join("\n")}</code></pre>${copyBtn(code)}</div>`).join("")}
  </div>`
}

function stepperInit(state) {
  const panel = $("#step-panel")
  if (!panel) return
  const hdfc = versionsOf(state, "hdfc-ergo")
  const latest = hdfc.at(-1)
  const lease = state.checks["hdfc-ergo"]
  const f = freshness(state, "hdfc-ergo")
  const row = (k, v, cls = "") => `<div class="kv"><span>${esc(k)}</span><span class="${cls}">${v}</span></div>`
  const panels = [
    () => `<div class="panel-head"><span><i class="dot"></i>${esc(t("how.p.insurer"))}</span><span>1 / 5</span></div>
      ${row(t("how.k.doc"), esc(latest?.doc_id ?? "?"), "mono")}${row(t("how.k.url"), esc(new URL(latest?.source_url ?? "https://x").host), "mono")}
      ${row(t("how.k.pages"), num(latest?.pdf_pages ?? 0))}${row(t("how.k.created"), esc(latest?.pdf_created ?? "?"), "mono")}
      <p class="panel-note">${esc(t("how.n1"))}</p>`,
    () => `<div class="panel-head"><span><i class="dot"></i>${esc(t("how.p.extract"))}</span><span>2 / 5</span></div>
      ${row(t("how.k.rows"), num(latest?.row_count ?? 0))}${row(t("how.k.published"), num(latest?.published_count ?? 0))}
      ${row(t("how.k.withheld"), num(latest?.withheld_count ?? 0))}${row(t("how.k.serials"), esc(t("how.v.contig")), "ok-t")}
      <p class="panel-note">${esc(t("how.n2"))}</p>`,
    () => `<div class="panel-head"><span><i class="dot"></i>Arkiv · source</span><span>3 / 5</span></div>
      ${row(t("how.k.entity"), latest ? entityLink(latest.entity.key) : "?")}${row("sha256", esc(latest ? short(latest.sha256) : "?"), "mono")}
      ${row(t("how.k.flags"), esc(`${latest?.entity.flags?.readonly ? "readonly" : ""} · permissionlessExtension`), "mono")}
      ${row(t("how.k.creator"), esc(short(Object.keys(TRUSTED_CREATORS)[0])), "mono")}
      <p class="panel-note">${esc(t("how.n3"))}</p>`,
    () => `<div class="panel-head"><span><i class="dot"></i>Arkiv · check</span><span>4 / 5</span></div>
      ${row(t("how.k.lease"), lease ? entityLink(lease.key) : esc(t("cov.stale")))}${row(t("how.k.checked"), esc(f.checkedAt ?? "—"), "mono")}
      ${row(t("how.k.left"), f.live ? `${f.daysLeft.toFixed(1)} ${esc(t("how.v.days"))}` : esc(t("cov.stale")), f.live ? "ok-t" : "warn-t")}
      ${row(t("how.k.renew"), "extendEntity", "mono")}
      <p class="panel-note">${esc(t("how.n4"))}</p>`,
    () => `<div class="panel-head"><span><i class="dot"></i>${esc(t("how.p.read"))}</span><span>5 / 5</span></div>
      ${row(t("how.k.block"), String(state.head), "mono")}${row(t("how.k.endpoint"), esc(new URL(RPC_URL).host), "mono")}
      ${row(t("how.k.cli"), "node cli/claim-check.mjs search 131021", "mono")}${row(t("how.k.backend"), esc(t("how.v.none")), "ok-t")}
      <p class="panel-note">${esc(t("how.n5"))}</p>`,
  ]
  const show = (i) => {
    panel.innerHTML = panels[i]()
    document.querySelectorAll("[data-step]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.step) === i)))
  }
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.step))))
  show(0)
}

// ---------------------------------------------------------------- lookup

let lastSearch = null
export function lookup(state, params) {
  const q = params.get("q") ?? ""
  const html = `<section class="page"><div class="wrap">
    <p class="eyebrow">${esc(t("lookup.eyebrow"))}</p>
    <h1 class="h1">${esc(t("lookup.h1"))}</h1>
    <p class="lede">${esc(t("lookup.lede"))}</p>
    ${searchForm(q)}
    <div id="results" aria-live="polite"></div>
  </div></section>`
  const after = async () => {
    const out = $("#results")
    if (!q.trim()) return
    out.innerHTML = spinner(t("search.loading"))
    try {
      if (state.error) throw state.error
      const r = lastSearch?.q === q ? lastSearch.r : await search(q)
      lastSearch = { q, r }
      if (!r.term) return (out.innerHTML = `<p class="muted">${esc(t("search.short"))}</p>`)
      if (!r.hospitals.length) {
        const held = Object.keys(state.latest).map(insurerName).join(", ")
        out.innerHTML = `<div class="alert neutral">${icon("search_off")}<div>${t("search.none", { q: esc(q), i: esc(held) })}</div></div>`
        return
      }
      const groups = groupByHospital(state, r.hospitals)
      const count = groups.length === 1 ? t("search.count1", { b: r.block }) : t("search.count", { n: num(groups.length), b: r.block })
      out.innerHTML = `<p class="result-count">${esc(count)}${r.truncated ? esc(t("search.more")) : ""}</p>` + groups.map((g) => renderHospital(state, g)).join("")
    } catch (err) {
      out.innerHTML = unavailable(err, "err.what.search")
    }
  }
  return { html, after }
}

// ---------------------------------------------------------------- hospital

export function hospitalPage(state, key) {
  const html = `<section class="page"><div class="wrap">
    <a class="back" href="javascript:history.back()">${icon("arrow_back")}${esc(t("hosp.back"))}</a>
    <div id="hosp">${spinner(t("search.loading"))}</div>
  </div></section>`
  const after = async () => {
    const out = $("#hosp")
    try {
      if (state.error) throw state.error
      const timelines = await hospitalTimelines(key)
      if (!timelines.length) return (out.innerHTML = `<div class="alert neutral">${icon("search_off")}<div>${esc(t("hosp.none"))}</div></div>`)
      const group = { key, timelines }
      const named = [...timelines].sort((a, b) => b.name.length - a.name.length)[0]
      const url = location.href
      out.innerHTML = `<p class="eyebrow">${esc(t("hosp.eyebrow"))}</p><h1 class="h1">${esc(named.name)}</h1>
        <p class="lede">${esc(named.city)}, ${esc(named.state)} · PIN ${esc(named.pin)}</p>
        <div class="share"><span class="mono">${esc(t("hosp.key"))} ${esc(key)}</span>${copyBtn(url)}<span class="muted small">${esc(t("hosp.share"))}</span></div>
        ${renderHospital(state, group, { link: false })}
        <p class="caption">${esc(t("hosp.note"))}</p>`
      document.title = `${named.name} · Claim Check`
    } catch (err) {
      out.innerHTML = unavailable(err, "err.what.search")
    }
  }
  return { html, after }
}

// ---------------------------------------------------------------- insurers

export function insurersPage(state) {
  const insurers = Object.keys(state.latest)
  const html = `<section class="page"><div class="wrap">
    <p class="eyebrow">${esc(t("ins.eyebrow"))}</p>
    <h1 class="h1">${esc(t("ins.h1"))}</h1>
    <p class="lede">${esc(t("ins.lede"))}</p>
    ${state.error ? unavailable(state.error) : insurers.map((i) => insurerBlock(state, i)).join("")}
  </div></section>`
  return { html }
}

function insurerBlock(state, insurer) {
  const versions = versionsOf(state, insurer)
  const f = freshness(state, insurer)
  return `<section class="ins-block" id="${esc(insurer)}">
    <div class="section-head"><div><h2 class="h2">${esc(insurerName(insurer))}</h2>
      <p class="muted">${esc(t("ins.summary", { n: versions.length, a: vlabel(versions[0]), b: vlabel(versions.at(-1)) }))}</p></div>
      <span class="pill ${f.live ? "ok" : "warn"}">${icon(f.live ? "verified" : "schedule")}${esc(f.live ? t("cov.fresh", { d: f.daysLeft.toFixed(1) }) : t("cov.stale"))}</span></div>
    <div class="panel chart-panel">${bars(versions, { height: 60 })}<div class="chart-labels">${versions.map((v) => `<span>${esc(vlabel(v))}</span>`).join("")}</div></div>
    <div class="table-wrap"><table><thead><tr><th>${esc(t("ins.c.version"))}</th><th>${esc(t("ins.c.hosp"))}</th><th>${esc(t("ins.c.delta"))}</th><th>${esc(t("ins.c.pdf"))}</th><th>${esc(t("ins.c.entity"))}</th><th></th></tr></thead><tbody>${
      versions.map((v, i) => {
        const d = i ? v.hospitals - versions[i - 1].hospitals : null
        return `<tr><td class="nowrap"><b>${esc(vlabel(v))}</b><br><span class="muted small">v${v.version}</span></td><td>${num(v.hospitals)}</td>
          <td class="mono ${d > 0 ? "bad-t" : d < 0 ? "ok-t" : ""}">${d === null ? "—" : d > 0 ? `+${num(d)}` : d === 0 ? "0" : `−${num(-d)}`}</td>
          <td><a href="${esc(v.source_url)}" target="_blank" rel="noopener">PDF</a> <span class="muted small">${esc(v.pdf_created)}</span></td>
          <td>${entityLink(v.entity.key)}</td>
          <td>${i ? `<a href="#/changes?i=${esc(insurer)}&v=${v.version}">${esc(t("recent.view"))}</a>` : ""}</td></tr>`
      }).join("")}</tbody></table></div>
  </section>`
}

// ---------------------------------------------------------------- changes

export function changesPage(state, params) {
  const versions = state.sources.filter((s) => s.version > 0)
  const pick = versions.find((s) => s.insurer === params.get("i") && String(s.version) === params.get("v")) ??
    versions.filter((s) => s.insurer === "hdfc-ergo").at(-2) ?? versions[0]
  const html = `<section class="page"><div class="wrap">
    <p class="eyebrow">${esc(t("changes.eyebrow"))}</p>
    <h1 class="h1">${esc(t("changes.h1"))}</h1>
    <p class="lede">${esc(t("changes.lede"))}</p>
    <div class="row">
      <label for="version-select">${esc(t("changes.version"))}</label>
      <select id="version-select">${versions.map((s) => `<option value="${s.insurer}|${s.version}" ${s === pick ? "selected" : ""}>${esc(shortName(s.insurer))} · ${esc(vlabel(s))}</option>`).join("")}</select>
      <label for="state-filter">${esc(t("changes.state"))}</label>
      <select id="state-filter"><option value="">${esc(t("changes.allStates"))}</option></select>
    </div>
    <div id="changes"></div>
  </div></section>`
  const after = async () => {
    const render = async () => {
      const out = $("#changes")
      const [insurer, version] = $("#version-select").value.split("|")
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
        const item = (h) => `<li><a href="#/hospital/${esc(h.key)}">${esc(h.name)}</a> <span class="muted">${esc(h.city)}, ${esc(h.pin)}</span></li>`
        const none = `<li class="muted">${esc(t("changes.none"))}</li>`
        out.innerHTML = `<p class="result-count">${esc(t("changes.compared", { v: vlabel(prev), b: block }))}</p>
          <div class="cols"><div class="panel list-panel"><h3><span class="k listed count">+${num(L.length)}</span> ${esc(t("changes.listed"))}</h3><ul class="plain">${L.map(item).join("") || none}</ul></div>
          <div class="panel list-panel"><h3><span class="k delisted count">−${num(D.length)}</span> ${esc(t("changes.delisted"))}</h3><ul class="plain">${D.map(item).join("") || none}</ul></div></div>`
      } catch (err) {
        out.innerHTML = unavailable(err, "err.what.changes")
      }
    }
    $("#version-select").addEventListener("change", () => { $("#state-filter").value = ""; render() })
    $("#state-filter").addEventListener("change", render)
    if (versions.length) render()
  }
  return { html, after }
}

// ---------------------------------------------------------------- verify

export function verifyPage(state) {
  const cols = t("sources.cols")
  const rows = state.sources.map((s) => {
    const e = s.entity
    const flags = e.flags ?? {}
    const days = Math.round(secondsLeft(e.expiresAt, state.head) / 86400)
    const flagText = `${flags.readonly ? t("sources.readonly") : t("sources.mutable")}${flags.permissionlessExtension ? ` · ${t("sources.anyone")}` : ""} · ${t("sources.daysLeft", { n: days })}`
    return `<tr><td class="nowrap"><b>${esc(shortName(s.insurer))}</b><br><span class="muted">v${s.version}</span></td>
      <td class="nowrap">${esc(vlabel(s))}<br><span class="muted small">${esc(t("sources.pdfCreated", { d: s.pdf_created, p: s.pdf_pages }))}</span></td>
      <td class="nowrap">${num(s.hospitals)}<br><span class="muted small">${esc(t("sources.withheld", { n: s.withheld_count }))}</span></td>
      <td><a href="${esc(s.source_url)}" target="_blank" rel="noopener">PDF</a>${s.source_note ? `<br><span class="muted small">${esc(s.source_note)}</span>` : ""}</td>
      <td class="mono small hash">${esc(s.sha256)}</td>
      <td>${entityLink(e.key)}<br><span class="muted small">${esc(flagText)}</span></td></tr>`
  }).join("")
  const leases = Object.entries(state.checks).map(([insurer, c]) => {
    const f = freshness(state, insurer)
    return `<div class="lease panel"><b>${esc(insurerName(insurer))}</b><span class="pill ok">${icon("verified")}${f.daysLeft.toFixed(1)} ${esc(t("how.v.days"))}</span>
      <p class="muted small">${esc(t("sources.lease", { i: shortName(insurer), t: f.checkedAt, d: c.attrs.doc, n: f.daysLeft.toFixed(1) }))}</p>${entityLink(c.key)}</div>`
  }).join("") || `<p>${esc(t("sources.noLease"))}</p>`
  const html = `<section class="page"><div class="wrap">
    <p class="eyebrow">${esc(t("sources.eyebrow"))}</p>
    <h1 class="h1">${esc(t("sources.h1"))}</h1>
    <p class="lede">${esc(t("sources.lede"))}</p>
    ${state.error ? unavailable(state.error, "err.what.sources") : `
    <h2 class="h3">${esc(t("sources.leases"))}</h2><div class="lease-grid">${leases}</div>
    <div class="verify-box panel">
      <div><h2 class="h3">${esc(t("verify.h"))}</h2><p class="muted">${esc(t("verify.d"))}</p></div>
      <button id="verify-btn" type="button">${icon("published_with_changes")}${esc(t("sources.verify"))}</button>
    </div>
    <div id="verify-out" aria-live="polite"></div>
    <h2 class="h3">${esc(t("verify.versions"))}</h2>
    <div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`}
  </div></section>`
  const after = async () => {
    $("#verify-btn")?.addEventListener("click", async () => {
      const out = $("#verify-out")
      out.innerHTML = spinner(t("verify.loading"))
      try {
        const results = await Promise.all(Object.keys(state.latest).map(verifyInsurer))
        const vc = t("verify.cols")
        out.innerHTML = results.map((r) => `<div class="table-wrap"><table><thead><tr>${vc.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
          r.rows.map((x) => `<tr><td>${icon(x.ok ? "check_circle" : "error")}</td><td class="mono">${esc(x.doc)}</td><td>${num(x.declared)}</td><td>${num(x.replayed)}</td><td>${num(x.events)}</td></tr>`).join("")
        }</tbody></table></div><div class="alert ${r.ok ? "ok" : "bad"}">${icon(r.ok ? "task_alt" : "error")}<div><b>${esc(r.ok ? t("verify.ok") : t("verify.bad"))}:</b> ${esc(t("verify.summary", { n: num(r.events), i: insurerName(r.insurer), b: r.block }))}</div></div>`).join("")
      } catch (err) {
        out.innerHTML = unavailable(err, "err.what.verify")
      }
    })
  }
  return { html, after }
}

// ---------------------------------------------------------------- developers

export function developersPage() {
  const creator = Object.keys(TRUSTED_CREATORS)[0]
  const scope = `app = str('${APP}') AND v = i32(1) AND $creator = addr(${creator})`
  const queries = [
    [t("dev.q1"), `${scope} AND type = str('source')`],
    [t("dev.q2"), `${scope} AND type = str('event') AND pin = str('131021')`],
    [t("dev.q3"), `${scope} AND type = str('event') AND name STARTSWITH str('REPOSE')`],
    [t("dev.q4"), `${scope} AND type = str('event') AND insurer = str('hdfc-ergo') AND version = i32(2)`],
    [t("dev.q5"), `${scope} AND type = str('check')`],
  ]
  const entities = [
    ["source", t("dev.e.source"), "730 days", "readonly, permissionlessExtension", "insurer, doc, version (i32), created (u64), hospitals (i32), sha"],
    ["event", t("dev.e.event"), "730 days", "readonly, permissionlessExtension", "insurer, kind, hospital, name, city, state, pin, doc, version (i32), effective (u64), seq (i32)"],
    ["check", t("dev.e.check"), "14 days, renewed by extendEntity", "readonly", "insurer, doc, checked (u64), sha"],
  ]
  const html = `<section class="page"><div class="wrap">
    <p class="eyebrow">${esc(t("dev.eyebrow"))}</p>
    <h1 class="h1">${esc(t("dev.h1"))}</h1>
    <p class="lede">${esc(t("dev.lede"))}</p>
    <div class="dev-facts">
      <div class="panel"><span class="label">${esc(t("dev.network"))}</span><b>Arkiv Tiramisu</b><span class="mono small">chain 7738577</span></div>
      <div class="panel"><span class="label">${esc(t("dev.publisher"))}</span><b class="mono">${esc(short(creator))}</b><a class="small" href="${EXPLORER}/address/${creator}" target="_blank" rel="noopener">${esc(t("dev.explorer"))}</a></div>
      <div class="panel"><span class="label">${esc(t("dev.endpoint"))}</span><b class="mono small">${esc(new URL(RPC_URL).host)}</b><span class="small muted">${esc(t("dev.any"))}</span></div>
    </div>
    <h2 class="h3">${esc(t("dev.entities"))}</h2>
    <div class="table-wrap"><table><thead><tr><th>type</th><th>${esc(t("dev.c.what"))}</th><th>${esc(t("dev.c.life"))}</th><th>${esc(t("dev.c.flags"))}</th><th>${esc(t("dev.c.attrs"))}</th></tr></thead><tbody>${
      entities.map(([ty, what, life, flags, attrs]) => `<tr><td class="mono"><b>${ty}</b></td><td>${esc(what)}</td><td class="nowrap">${esc(life)}</td><td class="mono small">${esc(flags)}</td><td class="mono small">${esc(attrs)}</td></tr>`).join("")}</tbody></table></div>
    <h2 class="h3">${esc(t("dev.queries"))}</h2>
    <div class="query-list">${queries.map(([label, q]) => `<div class="query panel"><span class="label">${esc(label)}</span><code>${esc(q)}</code>${copyBtn(q)}</div>`).join("")}</div>
    <p class="caption">${esc(t("dev.paging"))}</p>
    <h2 class="h3">${esc(t("dev.cli"))}</h2>
    ${codeTabs()}
    <div class="doc-links">
      <a class="panel" href="https://github.com/ChaseBP/claim-check/blob/main/arkiv/schema.md">${icon("schema")}<b>schema.md</b><span>${esc(t("dev.schema"))}</span></a>
      <a class="panel" href="https://github.com/ChaseBP/claim-check/blob/main/arkiv/friction.md">${icon("bug_report")}<b>friction.md</b><span>${esc(t("dev.friction"))}</span></a>
      <a class="panel" href="https://github.com/ChaseBP/claim-check/blob/main/arkiv/evidence/published.json">${icon("receipt_long")}<b>published.json</b><span>${esc(t("dev.manifest"))}</span></a>
    </div>
  </div></section>`
  return { html }
}

// ---------------------------------------------------------------- about

export function aboutPage(state, sub) {
  const html = `<section class="page"><div class="wrap prose-page">
    <p class="eyebrow">${esc(t("about.eyebrow"))}</p>
    <h1 class="h1">${esc(t("about.h1"))}</h1>
    <p class="lede">${esc(t("about.lede"))}</p>
    <div class="prose">${t("about.body")}</div>
    <h2 class="h2" id="method">${esc(t("about.method.h"))}</h2>
    <div class="prose">${t("about.method")}</div>
    <h2 class="h2" id="limits">${esc(t("about.limits.h"))}</h2>
    <div class="prose">${t("about.limits")}</div>
  </div></section>`
  const after = () => {
    if (sub) document.getElementById(sub)?.scrollIntoView({ behavior: "instant" })
  }
  return { html, after }
}
