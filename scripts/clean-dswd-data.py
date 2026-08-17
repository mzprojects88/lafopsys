"""
Extracts DSWD Caseload Inventory fields and joins them onto the existing
patient master by name, producing an enrichment delta rather than a new
patient population.

Reads from  ../DATA/Patient Database_NCH.xlsx                 (sibling of this repo)
            ../DATA/clean/patients.json                       (already-cleaned patient master)
Writes to   ../DATA/clean/patients-dswd-delta.json + dswd-import-report.md

Both input and output live entirely outside the git repository. This script
contains only transformation logic -- no patient data -- so it is safe to commit.

Scope: the "Copy of For DSWD Caseload Inven" sheet only (147 rows, the
populated DSWD-format sheet). Patient Database_NCH.xlsx has ~13 other sheets
that are mostly redundant snapshots of the same patients at different export
points (Patients Database, Extract, 2025, NEW/OLD Patients Database, form
responses) -- those are out of scope for this pass; "Patients Database" is
already the source clean-real-data.py's patient pipeline reads from a
different workbook (LAF PROGRAMS 2026.xlsx), confirmed to be the same 177
patients.

This sheet only ENRICHES patients that already exist in patients.json --
a DSWD row with no confident name match to an existing patient is skipped
and logged, never used to mint a new patient record (name-only matching
across two independently-maintained spreadsheets isn't a reliable enough
signal to create clinical records from).

Usage: python scripts/clean-dswd-data.py   (run from the repo root, after
       clean-real-data.py has already produced DATA/clean/patients.json)
"""

import json
import re
from datetime import datetime
from pathlib import Path

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_XLSX = REPO_ROOT.parent / "DATA" / "Patient Database_NCH.xlsx"
PATIENTS_JSON = REPO_ROOT.parent / "DATA" / "clean" / "patients.json"
OUT_DIR = REPO_ROOT.parent / "DATA" / "clean"


def clean_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    return text or None


def split_name(full_name: str) -> tuple[str, str]:
    """Mirrors clean-real-data.py's split_name so both sides of the join use the same convention."""
    if "," in full_name:
        last, first = full_name.split(",", 1)
        return first.strip(), last.strip()
    parts = full_name.strip().split(" ", 1)
    if len(parts) == 2:
        return parts[1].strip(), parts[0].strip()
    return "", full_name.strip()


def normalize(text: str) -> str:
    text = re.sub(r"[^a-z\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def build_patient_index(patients: list[dict]) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Returns (exact_key -> patientId, loose_key -> [patientId, ...])."""
    exact: dict[str, str] = {}
    loose: dict[str, list[str]] = {}
    for p in patients:
        last, first = p["lastName"], p["firstName"]
        exact_key = f"{normalize(last)}|{normalize(first)}"
        exact[exact_key] = p["id"]
        first_token = normalize(first).split(" ")[0] if first else ""
        loose_key = f"{normalize(last)}|{first_token}"
        loose.setdefault(loose_key, []).append(p["id"])
    return exact, loose


def clean_dswd_sheet(ws, exact_index: dict[str, str], loose_index: dict[str, list[str]]):
    delta = []
    skipped = []
    seen_patient_ids: set[str] = set()

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    for row in rows:
        (
            _no, date_enrolled, length_of_stay, name, religion, sector_category,
            _birthday, _present_age, _age_upon_admission, _sex, _address, place_of_birth,
            illness_type, _diagnosis, _patient_status, source_of_referral, reason_for_referral,
            _parent_name, social_profile, _mobile, services_received, death_info,
        ) = (row + (None,) * 22)[:22]

        if not name:
            continue

        first_name, last_name = split_name(str(name))
        if not last_name:
            skipped.append({"name": str(name), "reason": "could not parse name"})
            continue

        exact_key = f"{normalize(last_name)}|{normalize(first_name)}"
        first_token = normalize(first_name).split(" ")[0] if first_name else ""
        loose_key = f"{normalize(last_name)}|{first_token}"

        patient_id = exact_index.get(exact_key)
        match_kind = "exact"
        if not patient_id:
            candidates = loose_index.get(loose_key, [])
            if len(candidates) == 1:
                patient_id = candidates[0]
                match_kind = "loose (first-name-token + last name)"
            elif len(candidates) > 1:
                skipped.append({"name": str(name), "reason": f"ambiguous: {len(candidates)} patients share last name + first-name token"})
                continue

        if not patient_id:
            skipped.append({"name": str(name), "reason": "no matching patient in patients.json"})
            continue

        if patient_id in seen_patient_ids:
            skipped.append({"name": str(name), "reason": f"duplicate DSWD row for already-matched patient {patient_id}"})
            continue
        seen_patient_ids.add(patient_id)

        delta.append({
            "patientId": patient_id,
            "matchKind": match_kind,
            "religion": clean_str(religion),
            "sectorCaseCategory": clean_str(sector_category),
            "placeOfBirth": clean_str(place_of_birth),
            "illnessType": clean_str(illness_type),
            "sourceOfReferralText": clean_str(source_of_referral),
            "reasonForReferral": clean_str(reason_for_referral),
            "socialProfileOfParent": clean_str(social_profile),
            "servicesReceived": clean_str(services_received),
            "deathInfo": clean_str(death_info),
            "lengthOfStay": clean_str(length_of_stay) if not isinstance(length_of_stay, (int, float)) else str(length_of_stay),
            "dateEnrolled": iso_date(date_enrolled),
        })

    return delta, skipped, len(rows)


def main():
    if not SOURCE_XLSX.exists():
        raise SystemExit(f"Source workbook not found: {SOURCE_XLSX}")
    if not PATIENTS_JSON.exists():
        raise SystemExit(f"{PATIENTS_JSON} not found -- run clean-real-data.py first.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    patients = json.loads(PATIENTS_JSON.read_text(encoding="utf-8"))
    exact_index, loose_index = build_patient_index(patients)

    wb = openpyxl.load_workbook(SOURCE_XLSX, read_only=True, data_only=True)
    ws = wb["Copy of For DSWD Caseload Inven"]
    delta, skipped, total_rows = clean_dswd_sheet(ws, exact_index, loose_index)

    with open(OUT_DIR / "patients-dswd-delta.json", "w", encoding="utf-8") as f:
        json.dump(delta, f, ensure_ascii=False, indent=2)

    exact_matches = sum(1 for d in delta if d["matchKind"] == "exact")
    loose_matches = len(delta) - exact_matches
    death_info_count = sum(1 for d in delta if d["deathInfo"])

    report_lines = [
        "# DSWD Caseload Data Cleaning Report",
        "",
        f"Source: `{SOURCE_XLSX.name}` > `Copy of For DSWD Caseload Inven`",
        f"Joined against: `{PATIENTS_JSON.name}` ({len(patients)} existing patients)",
        "",
        "## Match results",
        f"- Sheet rows scanned (including blank/empty rows below the real data): {total_rows}",
        f"- Rows with a NAME value: {len(delta) + len(skipped)}",
        f"- Matched by exact normalized name: {exact_matches}",
        f"- Matched by loose match (last name + first-name token): {loose_matches}",
        f"- Skipped (no confident match, or ambiguous, or unparseable name): {len(skipped)}",
    ]
    for s in skipped:
        report_lines.append(f"  - {s['name']!r}: {s['reason']}")
    report_lines += [
        "",
        "## Sensitive fields",
        f"- Records with `deathInfo` populated: {death_info_count} -- these should stay behind the same",
        "  clinical-detail role gate as diagnosis (see canSeeClinical in lib/rbac/roles.ts) if surfaced in the UI.",
        "",
        "## Known source gap",
        "- `RELIGION` is blank for every row in this sheet (0/146) -- it is NOT missing from the extraction,",
        "  the DSWD sheet's own Religion column is unpopulated. A separate `Religion` sheet (49 rows, a",
        "  standalone Google Form export) has real religion data but no shared key to join by -- only a",
        "  name-only join would work, and wasn't done this pass. Treat `Patient.religion` as effectively",
        "  unpopulated for now.",
        "",
        "## Not fabricated",
        "- A DSWD row with no confident name match to an existing patient is skipped, never used to create",
        "  a new Patient record -- name-only matching across two independently-maintained spreadsheets isn't",
        "  a reliable enough signal to originate clinical records from.",
        "- `lengthOfStay` is kept as raw source text (not parsed into a day count) -- the source column's",
        "  format wasn't confirmed to be consistent across all rows.",
        "",
        "## Explicitly out of scope this pass",
        "- The other ~13 sheets in Patient Database_NCH.xlsx (Religion, NEW/OLD Patients Database, Extract,",
        "  2025, form-response sheets) -- mostly redundant snapshots or intake-workflow fields (PRIORITY",
        "  STATUS, MSS STATUS, PT NAVIGATOR) that belong on Referral, not Patient -- left for a future pass.",
    ]
    (OUT_DIR / "dswd-import-report.md").write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Wrote {len(delta)} DSWD enrichment records to {OUT_DIR / 'patients-dswd-delta.json'}")
    print(f"  {exact_matches} exact + {loose_matches} loose matches, {len(skipped)} skipped")
    print(f"See {OUT_DIR / 'dswd-import-report.md'} for the full report.")


if __name__ == "__main__":
    main()
