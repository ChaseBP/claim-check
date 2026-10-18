"""Turn extracted list versions into an append-only change log.

Usage: .venv/bin/python -I pipeline/events.py

For each insurer, versions are ordered by PDF creation date. The first
version yields one "listed" event per hospital; every later version yields
"listed" events for hospitals that appear and "delisted" events for hospitals
that disappear. Replaying the events up to a version must reproduce that
version's hospital set exactly; the script checks this and refuses otherwise.
Writes data/events.json.
"""

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def squash(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def same_hospital(a, b):
    """Insurers truncate long names in some versions (e.g. "VINAYAK
    MULTISPECIALITY" vs "VINAYAK MULTISPECIALITY HOSPITAL AND TRAUMA CENTRE"),
    so equal PIN plus one name being a prefix of the other counts as the same."""
    if a["pin"] != b["pin"]:
        return False
    x, y = squash(a["name"]), squash(b["name"])
    short, long_ = sorted((x, y), key=len)
    if x == y or (len(short) >= 12 and long_.startswith(short)):
        return True
    # Older lists append ", <town>" to some names ("AASTHA NURSING HOME, HISAR").
    bx, by = squash(a["name"].rsplit(",", 1)[0]), squash(b["name"].rsplit(",", 1)[0])
    return len(bx) >= 8 and bx == by


def canonical_keys(docs):
    """Give every hospital one key across all versions of an insurer's list."""
    by_pin = defaultdict(list)  # pin -> [(key, row)]
    mapping = {}
    for doc in docs:
        for row in doc["rows"]:
            match = next((k for k, r in by_pin[row["pin"]] if same_hospital(r, row)), None)
            if match is None:
                match = row["hospital_key"]
                by_pin[row["pin"]].append((match, row))
            mapping[(doc["doc_id"], row["sr"])] = match
    return mapping


def main():
    docs = [json.loads(p.read_text()) for p in sorted(DATA.glob("*.json")) if p.name != "events.json"]
    by_insurer = defaultdict(list)
    for doc in docs:
        by_insurer[doc["insurer"]].append(doc)

    events, summary = [], []
    for insurer, versions in by_insurer.items():
        versions.sort(key=lambda d: d.get("version_date") or d["pdf_created"])
        keys = canonical_keys(versions)
        current = {}  # key -> row
        for v_index, doc in enumerate(versions):
            listed = {}
            for row in doc["rows"]:
                listed.setdefault(keys[(doc["doc_id"], row["sr"])], row)  # duplicates in one list collapse
            added = [k for k in listed if k not in current]
            removed = [k for k in current if k not in listed]
            for k in added:
                r = listed[k]
                events.append({"insurer": insurer, "doc_id": doc["doc_id"], "version": v_index, "kind": "listed",
                               "hospital_key": k, "name": r["name"], "city": r["city"], "state": r["state"],
                               "pin": r["pin"], "pin_valid": r["pin_valid"], "effective_date": r["effective_date"],
                               "sr": r["sr"], "page": r["page"], "rohini": r.get("rohini")})
            for k in removed:
                r = current[k]
                events.append({"insurer": insurer, "doc_id": doc["doc_id"], "version": v_index, "kind": "delisted",
                               "hospital_key": k, "name": r["name"], "city": r["city"], "state": r["state"],
                               "pin": r["pin"], "pin_valid": r["pin_valid"], "effective_date": r["effective_date"],
                               "sr": None, "page": None})
            for k in removed:
                del current[k]
            for k in added:
                current[k] = listed[k]
            if set(current) != set(listed):
                raise SystemExit(f"replay mismatch at {doc['doc_id']}")
            summary.append({"doc_id": doc["doc_id"], "version": v_index, "unique_hospitals": len(listed),
                            "listed_events": len(added), "delisted_events": len(removed)})
            doc["unique_hospitals"] = len(listed)
            (DATA / f"{doc['doc_id']}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")

    (DATA / "events.json").write_text(json.dumps({"summary": summary, "events": events}, indent=1, ensure_ascii=False) + "\n")
    for s in summary:
        print(s)
    print("total events:", len(events))


if __name__ == "__main__":
    main()
