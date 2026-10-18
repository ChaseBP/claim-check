import { setRpcUrl, loadSources, loadChecks, headBlock } from "../shared/arkiv-read.js"
import { TRUSTED_CREATORS } from "../shared/config.js"
import { startLive } from "./live.js"
import { t, getLang, setLang } from "./i18n.js"
import { LOGO_SVG } from "./logo.js"
import * as pages from "./pages.js"

const $ = (sel) => document.querySelector(sel)
const esc = pages.esc

// Any Arkiv endpoint can be used instead of the default: ?rpc=<url>. The site has
// no backend of its own, so this is also how a reader avoids depending on us.
const rpcOverride = new URLSearchParams(location.search).get("rpc")
if (rpcOverride && /^https?:\/\//.test(rpcOverride)) setRpcUrl(rpcOverride)

// ---------------------------------------------------------------- metadata

const state = { sources: [], latest: {}, checks: {}, head: 0, loadedAt: 0, error: null }
const META_CACHE = "claim-check-meta-v2"
const META_TTL_MS = 90 * 1000

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
  if (cached) applyMeta(cached.sources, cached.checks, cached.head)
  else {
    try {
      const [{ sources }, { checks }, head] = await Promise.all([loadSources(), loadChecks(), headBlock()])
      applyMeta(sources, checks, head)
      writeCache()
    } catch (err) {
      state.error = err
    }
  }
  renderStatus()
}

function renderStatus() {
  const info = $("#block-info")
  if (state.error) info.textContent = t("foot.unavailable")
  else info.textContent = t("foot.read", { b: state.head, p: `${Object.keys(TRUSTED_CREATORS)[0].slice(0, 8)}…` })
}

// ---------------------------------------------------------------- router

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "")
  const [pathAndQuery, anchor] = raw.split("#")
  const [path, query = ""] = pathAndQuery.split("?")
  const parts = path.split("/").filter(Boolean)
  return { parts, params: new URLSearchParams(query), anchor }
}

let routesSeen = 0
async function route() {
  routesSeen++
  const { parts, params, anchor } = parseHash()
  const [page = "", arg] = parts
  if (!state.loadedAt && !state.error) await refreshMeta()
  let view
  switch (page) {
    case "": view = pages.home(state); break
    case "lookup": view = pages.lookup(state, params); break
    case "hospital": view = pages.hospitalPage(state, decodeURIComponent(arg ?? "")); break
    case "insurers": view = pages.insurersPage(state); break
    case "changes": view = pages.changesPage(state, params); break
    case "verify": view = pages.verifyPage(state); break
    case "developers": view = pages.developersPage(state); break
    case "about": view = pages.aboutPage(state, arg); break
    default: view = pages.home(state)
  }
  const app = $("#app")
  app.innerHTML = (state.error && page === "" ? `<div class="wrap">${pages.unavailable(state.error)}</div>` : "") + view.html
  app.dataset.page = page || "home"
  document.querySelectorAll("[data-nav]").forEach((a) => a.setAttribute("aria-current", a.dataset.nav === page ? "page" : "false"))
  document.title = page ? `${t(`nav.${page === "hospital" ? "lookup" : page}`)} · Claim Check` : t("title.home")
  closeMenu()
  window.scrollTo(0, 0)
  animateIn(app)
  await view.after?.()
  if (anchor) document.getElementById(anchor)?.scrollIntoView()
}

// Sections fade up as they enter the viewport; children of a group stagger by 60ms.
// Under prefers-reduced-motion everything is shown at once.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
const revealer = "IntersectionObserver" in window && !reduced
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.classList.add("in")
      revealer.unobserve(e.target)
    }), { rootMargin: "0px 0px -10% 0px" })
  : null
function animateIn(root) {
  // Page headers render at once; only content below them fades in.
  const targets = root.querySelectorAll(".section .wrap > *, .page .wrap > :not(.eyebrow, .h1, .lede, .back), .facts3 > div, .cov, .faq details, .doc-links > a, .dev-facts > .panel, .lease")
  targets.forEach((el, i) => {
    if (!revealer) return
    el.setAttribute("data-reveal", "")
    const siblings = [...el.parentElement.children].filter((c) => c.hasAttribute("data-reveal"))
    el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 6) * 60}ms`
    revealer.observe(el)
  })
  root.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count)))
}
function countUp(el, target) {
  if (reduced || !Number.isFinite(target) || target < 10) return
  const start = performance.now()
  const fmt = (n) => Math.round(n).toLocaleString(getLang() === "hi" ? "hi-IN" : "en-IN")
  const tick = (now) => {
    const p = Math.min(1, (now - start) / 900)
    el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)))
    if (p < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ---------------------------------------------------------------- chrome

const THEMES = ["system", "light", "dark"]
const THEME_ICON = { system: "contrast", light: "light_mode", dark: "dark_mode" }
function savedTheme() {
  try {
    const v = localStorage.getItem("claim-check-theme")
    return THEMES.includes(v) ? v : "system"
  } catch {
    return "system"
  }
}
function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  try {
    if (theme === "system") localStorage.removeItem("claim-check-theme")
    else localStorage.setItem("claim-check-theme", theme)
  } catch {
    // not persisted; works for this visit
  }
  const btn = $("#theme-btn")
  btn.querySelector(".icon").textContent = THEME_ICON[theme]
  btn.setAttribute("aria-label", t(`theme.${theme}`))
  btn.title = t(`theme.${theme}`)
  btn.dataset.theme = theme
}

function translateStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)))
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === getLang() ? "true" : "false"))
  applyTheme($("#theme-btn").dataset.theme ?? savedTheme())
}

function closeMenu({ focusButton = false } = {}) {
  if (!document.body.classList.contains("menu-open")) return
  document.body.classList.remove("menu-open")
  $("#menu-btn")?.setAttribute("aria-expanded", "false")
  if (focusButton) $("#menu-btn")?.focus()
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
    const { parts } = parseHash()
    if (["verify", "insurers"].includes(parts[0] ?? "")) route()
  }, 1500)
}

// ---------------------------------------------------------------- events

document.addEventListener("submit", (ev) => {
  if (!ev.target.matches("[data-search]")) return
  ev.preventDefault()
  const q = ev.target.querySelector("input").value.trim()
  const target = `#/lookup?q=${encodeURIComponent(q)}`
  if (location.hash === target) route()
  else location.hash = target
})

document.addEventListener("click", async (ev) => {
  const copy = ev.target.closest("[data-copy]")
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy)
      copy.classList.add("done")
      setTimeout(() => copy.classList.remove("done"), 1400)
    } catch {
      // clipboard blocked: the text stays selectable
    }
  }
  const tab = ev.target.closest("[data-tabs] [data-tab]")
  if (tab) {
    const box = tab.closest("[data-tabs]")
    box.querySelectorAll("[data-tab]").forEach((b) => { b.setAttribute("aria-selected", String(b === tab)); b.tabIndex = b === tab ? 0 : -1 })
    box.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab))
  }
  if (ev.target.closest("[data-retry]")) {
    await refreshMeta({ force: true })
    route()
  }
  const langBtn = ev.target.closest("[data-lang]")
  if (langBtn) {
    setLang(langBtn.dataset.lang)
    translateStatic()
    renderStatus()
    route()
  }
  if (ev.target.closest("#theme-btn")) {
    const current = $("#theme-btn").dataset.theme ?? savedTheme()
    applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length])
  }
  if (ev.target.closest("#menu-btn")) {
    const open = document.body.classList.toggle("menu-open")
    $("#menu-btn").setAttribute("aria-expanded", String(open))
    if (open) document.querySelector(".nav a")?.focus()
  }
  // "Back" returns to the previous page when there is one in this visit, else goes to Lookup.
  if (ev.target.closest("[data-back]") && routesSeen > 1) {
    ev.preventDefault()
    history.back()
  }
  // A tap on the dimmed page behind the open menu closes it.
  if (ev.target === document.body && document.body.classList.contains("menu-open")) closeMenu({ focusButton: true })
  // The skip link moves focus to the content without touching the hash router.
  if (ev.target.closest(".skip")) {
    ev.preventDefault()
    $("#app").focus()
  }
})

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeMenu({ focusButton: true })
  // Arrow keys move between tabs in a tablist, as the WAI-ARIA tabs pattern expects.
  const tab = ev.target.closest?.('[role="tab"]')
  if (tab && (ev.key === "ArrowRight" || ev.key === "ArrowLeft")) {
    const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
    const next = tabs[(tabs.indexOf(tab) + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
    next.focus()
    next.click()
    ev.preventDefault()
  }
})

// While the menu is open, focus stays in the header.
document.addEventListener("focusin", (ev) => {
  if (document.body.classList.contains("menu-open") && !ev.target.closest(".top")) document.querySelector(".nav a")?.focus()
})

window.addEventListener("hashchange", route)
window.addEventListener("scroll", () => {
  const h = document.documentElement.scrollHeight - innerHeight
  $("#progress").style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`
}, { passive: true })
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - state.loadedAt > 5 * 60 * 1000) refreshMeta({ force: true })
})

// ---------------------------------------------------------------- start

document.querySelectorAll("#logo-slot, [data-logo]").forEach((el) => (el.innerHTML = LOGO_SVG))
setLang(getLang())
translateStatic()
route().then(() => {
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
