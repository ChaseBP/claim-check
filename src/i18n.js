// UI strings in English and Hindi. Data (hospital, insurer and place names,
// dates in source documents) is always shown exactly as the insurer published it.

const en = {
  "brand.sub": "Insurer hospital exclusions, kept on Arkiv",
  "tab.lookup": "Lookup", "tab.changes": "What changed", "tab.sources": "Sources & verify", "tab.why": "Why Arkiv",
  "lookup.eyebrow": "01 · Hospital lookup", "changes.eyebrow": "02 · Version history", "sources.eyebrow": "03 · Provenance",
  "facts.versions": "list versions", "facts.events": "change events on Arkiv", "facts.insurers": "insurers", "facts.block": "read at block",
  "lookup.h1": "Will my insurer pay at this hospital?",
  "lookup.lede": "Insurers publish lists of hospitals where they will not pay claims, cashless or reimbursement, except to stabilise an emergency. They replace the PDF without saying what changed. Search every version we hold, across insurers.",
  "lookup.placeholder": "Hospital name or PIN, e.g. “Gaurav Hospital” or 131021",
  "lookup.label": "Hospital name or PIN code", "lookup.button": "Check", "lookup.try": "Try",
  "lookup.pinPrefix": "PINs starting 1220",
  "changes.h1": "What changed between list versions",
  "changes.lede": "Each version is compared with the one before it. Hospitals that appear are listed; hospitals that disappear are delisted.",
  "changes.version": "Version", "changes.state": "State", "changes.allStates": "All states",
  "changes.compared": "Compared with the {v} version · read at block {b}", "changes.listed": "listed", "changes.delisted": "delisted",
  "changes.none": "None", "changes.loading": "Reading changes from Arkiv…",
  "sources.h1": "Sources and verification",
  "sources.lede": "Every list version is a read-only Arkiv entity carrying the SHA-256 of the insurer's PDF. Download the PDF, hash it, and compare. Then replay the change log to check that our extraction adds up.",
  "sources.verify": "Replay the change log from Arkiv",
  "sources.cols": ["Insurer", "Version", "Hospitals", "Source", "SHA-256 of PDF", "Arkiv entity"],
  "sources.pdfCreated": "PDF created {d} · {p} pages", "sources.withheld": "{n} withheld",
  "sources.readonly": "read-only", "sources.mutable": "mutable", "sources.anyone": "anyone can extend", "sources.daysLeft": "~{n} days left",
  "sources.leases": "Freshness leases",
  "sources.lease": "{i}: re-verified {t} against {d}, lease {n} days left",
  "sources.noLease": "No live freshness lease: every insurer is shown as stale.",
  "verify.loading": "Reading every event from Arkiv and replaying… (about 37 pages)",
  "verify.cols": ["", "Version", "Declared", "Replayed", "Events"],
  "verify.ok": "Consistent", "verify.bad": "Inconsistent",
  "verify.summary": "{n} events for {i} replayed at block {b}.",
  "banner.live": "<b>{i}</b>: {n} list versions ({span}). Live PDF re-verified {t}; freshness lease {d} days left.",
  "banner.stale": "<b>{i}: stale.</b> No live re-verification lease, so the insurer's current list may differ from the latest version shown ({v}).",
  "foot.read": "Read live from Arkiv Tiramisu at block {b} · publisher {p}", "foot.unavailable": "Arkiv unavailable",
  "foot.disclaimer": "Data: insurers' published exclusion lists. Not insurance advice.",
  "live.on": "Live", "live.paused": "Live updates paused", "live.off": "Live off",
  "theme.system": "Theme: follows system", "theme.light": "Theme: light", "theme.dark": "Theme: dark",
  "toast.write": "New records from the publisher arrived on Arkiv",
  "toast.lease": "Freshness lease renewed: the insurer's live PDF was re-verified",
  "err.title": "Couldn't read Arkiv", "err.body": "No result is shown rather than a possibly wrong one.", "err.retry": "Try again",
  "err.what.meta": "list versions", "err.what.search": "search", "err.what.changes": "changes", "err.what.sources": "sources", "err.what.verify": "verification",
  "search.loading": "Searching Arkiv…", "search.short": "Type at least two letters, or a PIN prefix.",
  "search.count": "{n} hospitals · read at block {b}", "search.count1": "1 hospital · read at block {b}", "search.more": " (search matched more; narrow it)",
  "search.none": "<b>No hospital matching “{q}”</b> on any exclusion-list version held for {i}. This is not a guarantee of payment: insurers update lists, and rows whose hospital name contains a person's name (e.g. “Dr …”) are withheld. Confirm with your insurer.",
  "pill.excluded": "Excluded", "pill.removed": "Removed from list", "pill.absent": "Not listed",
  "ins.sinceMonth": "On every monthly list since {v}.",
  "ins.sinceDate": "Effective {d} (insurer's date). On every version since {v}.",
  "ins.stale": " <b>Stale:</b> the insurer's current list has not been re-verified.",
  "ins.dropped": "Dropped in the {v} version.",
  "ins.absent": "Not on any of the {n} {i} list versions held ({a} – {b}), under this name and PIN.",
  "ins.evidence": "Evidence on Arkiv", "ins.in": "in the {v} list", "ins.row": "row {r}, page {p}",
  "kind.listed": "listed", "kind.delisted": "delisted",
  "chip.on": "on the list", "chip.off": "not on the list",
  "pin.asPrinted": "as printed", "pin.asPrintedTitle": "The insurer printed a malformed PIN; shown exactly as printed",
}

const hi = {
  "brand.sub": "बीमा कंपनियों की बहिष्कृत अस्पताल सूची, Arkiv पर सुरक्षित",
  "tab.lookup": "खोजें", "tab.changes": "क्या बदला", "tab.sources": "स्रोत और सत्यापन", "tab.why": "Arkiv क्यों",
  "lookup.eyebrow": "01 · अस्पताल खोज", "changes.eyebrow": "02 · संस्करण इतिहास", "sources.eyebrow": "03 · स्रोत",
  "facts.versions": "सूची संस्करण", "facts.events": "Arkiv पर बदलाव रिकॉर्ड", "facts.insurers": "बीमा कंपनियाँ", "facts.block": "ब्लॉक पर पढ़ा गया",
  "lookup.h1": "क्या मेरी बीमा कंपनी इस अस्पताल का क्लेम देगी?",
  "lookup.lede": "बीमा कंपनियाँ उन अस्पतालों की सूची प्रकाशित करती हैं जहाँ वे क्लेम नहीं देंगी, न कैशलेस न रीइम्बर्समेंट, सिवाय आपात स्थिति में मरीज़ को स्थिर करने के। वे बिना बताए यह PDF बदल देती हैं। हमारे पास मौजूद हर संस्करण में, सभी बीमा कंपनियों में खोजें।",
  "lookup.placeholder": "अस्पताल का नाम या पिन, जैसे “Gaurav Hospital” या 131021",
  "lookup.label": "अस्पताल का नाम या पिन कोड", "lookup.button": "जाँचें", "lookup.try": "उदाहरण",
  "lookup.pinPrefix": "1220 से शुरू होने वाले पिन",
  "changes.h1": "सूची के संस्करणों के बीच क्या बदला",
  "changes.lede": "हर संस्करण की तुलना उससे पहले वाले से की गई है। जो अस्पताल जुड़े वे “सूचीबद्ध”, और जो हटे वे “हटाए गए” हैं।",
  "changes.version": "संस्करण", "changes.state": "राज्य", "changes.allStates": "सभी राज्य",
  "changes.compared": "{v} संस्करण से तुलना · ब्लॉक {b} पर पढ़ा गया", "changes.listed": "सूचीबद्ध", "changes.delisted": "हटाए गए",
  "changes.none": "कोई नहीं", "changes.loading": "Arkiv से बदलाव पढ़े जा रहे हैं…",
  "sources.h1": "स्रोत और सत्यापन",
  "sources.lede": "सूची का हर संस्करण Arkiv पर एक अपरिवर्तनीय (read-only) रिकॉर्ड है, जिसमें बीमा कंपनी के PDF का SHA-256 दर्ज है। PDF डाउनलोड करें, उसका हैश निकालें और मिलाएँ। फिर बदलावों का पूरा लॉग दोबारा चलाकर जाँचें कि हमारा डेटा सही बैठता है।",
  "sources.verify": "Arkiv से बदलावों का लॉग दोबारा चलाएँ",
  "sources.cols": ["बीमा कंपनी", "संस्करण", "अस्पताल", "स्रोत", "PDF का SHA-256", "Arkiv रिकॉर्ड"],
  "sources.pdfCreated": "PDF बना {d} · {p} पृष्ठ", "sources.withheld": "{n} रोके गए",
  "sources.readonly": "अपरिवर्तनीय", "sources.mutable": "परिवर्तनीय", "sources.anyone": "कोई भी अवधि बढ़ा सकता है", "sources.daysLeft": "~{n} दिन शेष",
  "sources.leases": "ताज़गी लीज़",
  "sources.lease": "{i}: {t} को {d} से दोबारा मिलाया गया, लीज़ में {n} दिन शेष",
  "sources.noLease": "कोई सक्रिय ताज़गी लीज़ नहीं: हर बीमा कंपनी पुरानी (stale) दिखाई जा रही है।",
  "verify.loading": "Arkiv से हर बदलाव पढ़कर दोबारा चलाया जा रहा है… (लगभग 37 पेज)",
  "verify.cols": ["", "संस्करण", "घोषित", "दोबारा गिने गए", "बदलाव"],
  "verify.ok": "मेल खाता है", "verify.bad": "मेल नहीं खाता",
  "verify.summary": "{i} के {n} बदलाव ब्लॉक {b} पर दोबारा चलाए गए।",
  "banner.live": "<b>{i}</b>: सूची के {n} संस्करण ({span})। लाइव PDF {t} को दोबारा मिलाया गया; ताज़गी लीज़ में {d} दिन शेष।",
  "banner.stale": "<b>{i}: पुरानी जानकारी।</b> कोई सक्रिय ताज़गी लीज़ नहीं, इसलिए बीमा कंपनी की मौजूदा सूची यहाँ दिखे अंतिम संस्करण ({v}) से अलग हो सकती है।",
  "foot.read": "Arkiv Tiramisu से ब्लॉक {b} पर सीधे पढ़ा गया · प्रकाशक {p}", "foot.unavailable": "Arkiv उपलब्ध नहीं",
  "foot.disclaimer": "डेटा: बीमा कंपनियों की प्रकाशित बहिष्कृत सूचियाँ। यह बीमा सलाह नहीं है।",
  "live.on": "लाइव", "live.paused": "लाइव अपडेट रुके", "live.off": "लाइव बंद",
  "theme.system": "थीम: सिस्टम के अनुसार", "theme.light": "थीम: हल्की", "theme.dark": "थीम: गहरी",
  "toast.write": "प्रकाशक के नए रिकॉर्ड Arkiv पर आ गए",
  "toast.lease": "ताज़गी लीज़ नवीनीकृत: बीमा कंपनी का लाइव PDF दोबारा मिलाया गया",
  "err.title": "Arkiv से पढ़ा नहीं जा सका", "err.body": "संभावित रूप से गलत नतीजा दिखाने के बजाय कोई नतीजा नहीं दिखाया गया।", "err.retry": "फिर कोशिश करें",
  "err.what.meta": "सूची संस्करण", "err.what.search": "खोज", "err.what.changes": "बदलाव", "err.what.sources": "स्रोत", "err.what.verify": "सत्यापन",
  "search.loading": "Arkiv में खोजा जा रहा है…", "search.short": "कम से कम दो अक्षर या पिन का शुरुआती हिस्सा लिखें।",
  "search.count": "{n} अस्पताल · ब्लॉक {b} पर पढ़ा गया", "search.count1": "1 अस्पताल · ब्लॉक {b} पर पढ़ा गया", "search.more": " (और नतीजे मिले; खोज सीमित करें)",
  "search.none": "<b>“{q}” से मेल खाता कोई अस्पताल नहीं मिला</b>, {i} की किसी भी सूची में। इसका मतलब भुगतान की गारंटी नहीं है: बीमा कंपनियाँ सूची बदलती रहती हैं, और जिन अस्पतालों के नाम में किसी व्यक्ति का नाम है (जैसे “Dr …”) उन्हें रोका गया है। भर्ती से पहले अपनी बीमा कंपनी से पुष्टि करें।",
  "pill.excluded": "बहिष्कृत", "pill.removed": "सूची से हटाया गया", "pill.absent": "सूची में नहीं",
  "ins.sinceMonth": "{v} से हर मासिक सूची में।",
  "ins.sinceDate": "प्रभावी {d} (बीमा कंपनी की तारीख)। {v} से हर संस्करण में।",
  "ins.stale": " <b>पुरानी जानकारी:</b> बीमा कंपनी की मौजूदा सूची दोबारा नहीं मिलाई गई है।",
  "ins.dropped": "{v} संस्करण में हटाया गया।",
  "ins.absent": "{i} की हमारे पास मौजूद {n} सूचियों ({a} – {b}) में से किसी में इस नाम और पिन से नहीं।",
  "ins.evidence": "Arkiv पर प्रमाण", "ins.in": "{v} की सूची में", "ins.row": "पंक्ति {r}, पृष्ठ {p}",
  "kind.listed": "सूचीबद्ध", "kind.delisted": "हटाया गया",
  "chip.on": "सूची में", "chip.off": "सूची में नहीं",
  "pin.asPrinted": "जैसा छपा", "pin.asPrintedTitle": "बीमा कंपनी ने गलत पिन छापा है; जैसा छपा वैसा ही दिखाया गया है",
}

const dictionaries = { en, hi }
let lang = "en"
try {
  lang = localStorage.getItem("claim-check-lang") === "hi" ? "hi" : "en"
} catch {
  // storage unavailable: default to English
}

export const getLang = () => lang
export function setLang(next) {
  lang = next === "hi" ? "hi" : "en"
  try {
    localStorage.setItem("claim-check-lang", lang)
  } catch {
    // not persisted; the toggle still works for this visit
  }
  document.documentElement.lang = lang
}

/** Translate a key, substituting {name} placeholders. Values are inserted as given. */
export function t(key, vars = {}) {
  const value = dictionaries[lang][key] ?? en[key] ?? key
  if (Array.isArray(value)) return value
  return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`))
}
