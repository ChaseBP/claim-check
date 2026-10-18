// Index forms of free text, shared by the publisher and every reader so that a
// search typed into the web app or the CLI matches exactly what was written.

/** Letters and digits only, upper case. "Shri Ram Hospital, Hisar" -> "SHRIRAMHOSPITALHISAR". */
export function squash(text) {
  return String(text ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Name index used with STARTSWITH. Capped well under Arkiv's string attribute limit. */
export function nameIndex(name) {
  return squash(name).slice(0, 64)
}

export function cityIndex(city) {
  return squash(city).slice(0, 48)
}

/** A 6-digit PIN or a prefix of one, else null. */
export function pinQuery(text) {
  const digits = String(text ?? "").replace(/\s/g, "")
  return /^\d{2,6}$/.test(digits) ? digits : null
}
