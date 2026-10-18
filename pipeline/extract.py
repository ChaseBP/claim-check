"""Extract insurer hospital-exclusion lists from their published PDFs.

Usage: .venv/bin/python -I pipeline/extract.py [--fetch]

Reads pipeline/sources.json, reads each PDF from .cache/pdfs/ (downloading it
first with --fetch), and writes data/<doc_id>.json. The script refuses to write
a document whose serial numbers are not contiguous, so a parsing gap cannot
silently turn an excluded hospital into a missing one.
"""

import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "pdfs"
OUT = ROOT / "data"

PIN_RE = re.compile(r"^\d{5,6}$")  # some insurer rows carry 5-digit typos
VALID_PIN_RE = re.compile(r"^[1-9]\d{5}$")
DATE_RE = re.compile(r"^(\d{2})[/.-](\d{2})[/.-](\d{4})$")
SERIAL_RE = re.compile(r"^\d{1,5}$")
# Hospital names that carry a person's name. They stay off-chain: the rules
# forbid real personal data, and a clinic named after a doctor identifies them.
PERSON_NAME_RE = re.compile(r"(^|[^A-Z])(DR|DOCTOR)(\.|\s|,|$)")

STATES = [
    "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR",
    "CHANDIGARH", "CHHATTISGARH", "DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "DELHI", "GOA",
    "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR", "JHARKHAND", "KARNATAKA",
    "KERALA", "LADAKH", "LAKSHADWEEP", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA",
    "MIZORAM", "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB", "RAJASTHAN", "SIKKIM", "TAMIL NADU",
    "TELANGANA", "TRIPURA", "UTTAR PRADESH", "UTTARAKHAND", "WEST BENGAL",
]
STATE_ALIASES = {
    "ORISSA": "ODISHA", "NEW DELHI": "DELHI", "NCT OF DELHI": "DELHI", "PONDICHERRY": "PUDUCHERRY",
    "CHATTISGARH": "CHHATTISGARH", "UTTARANCHAL": "UTTARAKHAND", "JAMMU & KASHMIR": "JAMMU AND KASHMIR",
    "DADRA AND NAGAR HAVELI/DAMAN AND DIU": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "DADRA AND NAGAR HAVELI": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "DAMAN AND DIU": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "ANDAMAN & NICOBAR ISLANDS": "ANDAMAN AND NICOBAR ISLANDS",
    "DAMAN & DIU": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "DADRA & NAGAR HAVELI": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "DADRA & NAGAR HAVELI AND DAMAN & DIU": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "PONDICHERRY UT": "PUDUCHERRY", "NCT DELHI": "DELHI",
}


def clean(cell):
    """Collapse a wrapped table cell into one line."""
    if cell is None:
        return ""
    text = unicodedata.normalize("NFKC", str(cell)).replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def squash(text):
    """Letters and digits only. Cells wrap mid-word in narrow columns, so
    comparisons must not depend on where the PDF happened to break a line."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def canonical_state(raw):
    key = squash(raw)
    for alias, state in STATE_ALIASES.items():
        if squash(alias) == key:
            return state
    for state in STATES:
        if squash(state) == key:
            return state
    return None


def hospital_key(name, pin):
    """Stable identity for one hospital across list versions and insurers."""
    return hashlib.sha256(f"{squash(name)}|{pin}".encode()).hexdigest()[:16]


def parse_date(text):
    """Insurer lists mix 01/01/2023, 01-01-2023 and 07-Mar-24."""
    m = DATE_RE.match(text)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        return datetime(y, mo, d, tzinfo=timezone.utc)
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(text.title(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def parse_row(raw):
    cells = [clean(c) for c in raw if c is not None]
    cells = [c for c in cells if c != ""]
    if len(cells) < 6 or not SERIAL_RE.match(cells[0]):
        return None
    date_idx = next((i for i, c in enumerate(cells) if parse_date(c)), None)
    pin_idx = next((i for i, c in enumerate(cells) if PIN_RE.match(c)), None)
    if date_idx is None or pin_idx is None or pin_idx > date_idx:
        return None
    # Layout: serial, name, address, city, state, pin, date. The address
    # column is dropped on purpose: lookup needs only name, city and PIN.
    head = cells[1:pin_idx]
    if len(head) < 4:
        return None
    name, city, state_raw = head[0], head[-2], head[-1]
    state = canonical_state(state_raw)
    if state is None:
        return None
    effective = parse_date(cells[date_idx])
    return {
        "sr": int(cells[0]),
        "name": name,
        "city": city,
        "state": state,
        "pin": cells[pin_idx],
        # Kept exactly as printed; malformed PINs are flagged, never corrected.
        "pin_valid": bool(VALID_PIN_RE.match(cells[pin_idx])),
        "effective_date": effective.strftime("%Y-%m-%d"),
    }


ROHINI_RE = re.compile(r"^(\d{13}|No Rohini)$", re.I)


def parse_tata_row(raw, month_label):
    """Tata AIG layout: Rohini ID, name, address, city, state, PIN, month."""
    cells = [clean(c) for c in raw]
    if len(cells) != 7 or not ROHINI_RE.match(cells[0]):
        return None
    rohini, name, _address, city, state_raw, pin, month = cells
    state = canonical_state(state_raw)
    if state is None or not PIN_RE.match(pin) or month.replace("’", "'") != month_label:
        return None
    return {"name": name, "city": city, "state": state, "pin": pin,
            "pin_valid": bool(VALID_PIN_RE.match(pin)),
            "rohini": rohini if rohini.isdigit() else None}


def extract(source):
    if source.get("format") == "tata":
        return extract_tata(source)
    path = CACHE / source["file"]
    pdf_bytes = path.read_bytes()
    rows, rejected = [], []
    with pdfplumber.open(path) as pdf:
        meta = pdf.metadata or {}
        pages = len(pdf.pages)
        for page_no, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                for raw in table:
                    row = parse_row(raw)
                    if row:
                        row["page"] = page_no
                        rows.append(row)
                    elif raw and raw[0] and SERIAL_RE.match(clean(raw[0])):
                        rejected.append({"page": page_no, "cells": [clean(c) for c in raw]})

    serials = sorted(r["sr"] for r in rows)
    expected = list(range(1, serials[-1] + 1)) if serials else []
    missing = sorted(set(expected) - set(serials))
    duplicates = sorted({s for s in serials if serials.count(s) > 1})
    if missing or duplicates or rejected:
        raise SystemExit(
            f"{source['doc_id']}: refusing to write. missing serials={missing[:20]} "
            f"duplicates={duplicates[:20]} unparsed rows={rejected[:5]}"
        )

    published, withheld = [], []
    for row in sorted(rows, key=lambda r: r["sr"]):
        row["hospital_key"] = hospital_key(row["name"], row["pin"])
        (withheld if PERSON_NAME_RE.search(row["name"].upper()) else published).append(row)

    pdf_created = meta.get("CreationDate", "")
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})", pdf_created)
    return {
        "doc_id": source["doc_id"],
        "insurer": source["insurer"],
        "insurer_name": source["insurer_name"],
        "source_url": source["url"],
        "source_note": source.get("note", ""),
        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
        "pdf_bytes": len(pdf_bytes),
        "pdf_pages": pages,
        "pdf_created": f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None,
        "version_date": f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None,
        "effective_basis": "insurer",
        "row_count": len(rows),
        "published_count": len(published),
        # Only the count and serial numbers of withheld rows are published.
        "withheld_count": len(withheld),
        "withheld_serials": [r["sr"] for r in withheld],
        "rows": [{k: r[k] for k in ("sr", "hospital_key", "name", "city", "state", "pin", "pin_valid", "effective_date", "page")} for r in published],
    }


def extract_tata(source):
    path = CACHE / source["file"]
    pdf_bytes = path.read_bytes()
    label = source["label_month"]
    rows, rejected = [], []
    with pdfplumber.open(path) as pdf:
        meta = pdf.metadata or {}
        pages = len(pdf.pages)
        for page_no, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                for raw in table:
                    first = clean(raw[0]) if raw and raw[0] else ""
                    if not ROHINI_RE.match(first):
                        continue  # title and header rows
                    row = parse_tata_row(raw, label)
                    if row:
                        row["sr"] = len(rows) + 1  # Tata lists carry no serial; position in the PDF instead
                        row["page"] = page_no
                        row["effective_date"] = source["label_date"]
                        rows.append(row)
                    else:
                        rejected.append({"page": page_no, "cells": [clean(c) for c in raw]})
    if rejected or not rows:
        raise SystemExit(f"{source['doc_id']}: refusing to write. unparsed data rows={rejected[:5]} rows={len(rows)}")

    published, withheld = [], []
    for row in rows:
        row["hospital_key"] = hospital_key(row["name"], row["pin"])
        (withheld if PERSON_NAME_RE.search(row["name"].upper()) else published).append(row)
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})", meta.get("CreationDate", ""))
    return {
        "doc_id": source["doc_id"], "insurer": source["insurer"], "insurer_name": source["insurer_name"],
        "source_url": source["url"], "source_note": source.get("note", ""),
        "sha256": hashlib.sha256(pdf_bytes).hexdigest(), "pdf_bytes": len(pdf_bytes), "pdf_pages": pages,
        "pdf_created": f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None,
        "version_date": source["label_date"], "label_month": label, "effective_basis": "list-month",
        "row_count": len(rows), "published_count": len(published),
        "withheld_count": len(withheld), "withheld_serials": [r["sr"] for r in withheld],
        "rows": [{k: r[k] for k in ("sr", "hospital_key", "name", "city", "state", "pin", "pin_valid", "effective_date", "page", "rohini")} for r in published],
    }


def fetch(source):
    CACHE.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(source["url"], headers={"User-Agent": "Mozilla/5.0 claim-check"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        (CACHE / source["file"]).write_bytes(resp.read())


def main():
    sources = json.loads((ROOT / "pipeline" / "sources.json").read_text())
    OUT.mkdir(exist_ok=True)
    for source in sources:
        if "--fetch" in sys.argv or not (CACHE / source["file"]).exists():
            fetch(source)
        doc = extract(source)
        doc["retrieved_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        (OUT / f"{doc['doc_id']}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
        print(f"{doc['doc_id']}: {doc['row_count']} rows, {doc['published_count']} published, "
              f"{doc['withheld_count']} withheld, sha256 {doc['sha256'][:12]}, created {doc['pdf_created']}")


if __name__ == "__main__":
    main()
