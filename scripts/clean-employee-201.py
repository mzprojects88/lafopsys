"""
Cleans the Employee 201 Masterlist workbook into JSON for
scripts/import-employee-201.mjs.

Reads from  ../DATA/Employee Data.xlsx           (sibling of this repo)
Writes to   ../DATA/clean/employee-201.json + employee-201-report.md

Input and output both live outside the git repository, and the output is
personal and sensitive personal information under RA 10173 (government ID
numbers, bank accounts, birthdates) -- it must never be committed, copied
into lib/mock-data, or pasted anywhere. This script holds transformation
logic only.

One JSON object per masterlist row, with the columns mapped one for one to
the hr tables of migration 0036:
  employee  -> hr.employees          (names, position, status, dates, contact, emergency contact)
  private   -> hr.employee_private   (SSS, PhilHealth, Pag-IBIG, TIN, bank)
  pay       -> hr.compensation       (basic salary, communication allowance, pay frequency)
  documents -> hr.employee_documents (the thirteen Drive-link columns; a link = complete)

Usage: python scripts/clean-employee-201.py   (run from the repo root)
"""

import json
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT.parent / "DATA" / "Employee Data.xlsx"
OUT_DIR = REPO_ROOT.parent / "DATA" / "clean"
OUT_JSON = OUT_DIR / "employee-201.json"
OUT_REPORT = OUT_DIR / "employee-201-report.md"

SHEET = "Employee 201 Masterlist"

# Masterlist "Employment Status" -> (hr.employees.employment_type, hr.employees.status)
STATUS_MAP = {
    "regular": ("regular", "active"),
    "probationary": ("probationary", "active"),
    "contractual": ("contractual", "active"),
    "part-time": ("part_time", "active"),
    "part time": ("part_time", "active"),
    "casual": ("casual", "active"),
    "active": (None, "active"),
    "on leave": (None, "on_leave"),
    "resigned": (None, "resigned"),
    "terminated": (None, "terminated"),
}

# Document-link column -> hr.document_types.id (0036 seed)
DOCUMENT_COLUMNS = {
    "Resume": "resume",
    "Diploma & TOR": "diploma_tor",
    "Valid ID": "valid_id",
    "PRC ID": "prc_id",
    "NBI Clearance": "nbi_clearance",
    "Police Clearance": "police_clearance",
    "Birth Certificate": "birth_certificate",
    "Medical Certificate": "medical_certificate",
    "Employment Contract": "employment_contract",
    "Non-Disclosure Agreement": "nda",
    "Performance Evaluations": "performance_evaluations",
    "Disciplinary Records": "disciplinary_records",
    "Exit Clearance": "exit_clearance",
}

NULLISH = {"", "n/a", "na", "none", "-", "--", "tbd"}


def clean(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v
    s = str(v).strip()
    s = re.sub(r"\s+", " ", s)
    return None if s.lower() in NULLISH else s


def to_day(v):
    v = clean(v)
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def to_amount(v):
    v = clean(v)
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    s = re.sub(r"[^\d.\-]", "", str(v))
    try:
        return round(float(s), 2) if s else None
    except ValueError:
        return None


def header_map(row):
    out = {}
    for i, h in enumerate(row):
        if h is None:
            continue
        out[re.sub(r"\s+", " ", str(h)).strip()] = i
    return out


def main():
    wb = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    cols = header_map(rows[0])

    def cell(r, name):
        i = cols.get(name)
        return r[i] if i is not None and i < len(r) else None

    people = []
    problems = []
    for n, r in enumerate(rows[1:], start=2):
        code = clean(cell(r, "Employee ID"))
        last = clean(cell(r, "Last Name"))
        first = clean(cell(r, "First Name"))
        if not code and not last and not first:
            continue
        if not code or not last or not first:
            problems.append(f"Row {n}: missing employee id or name; skipped")
            continue

        raw_status = (clean(cell(r, "Employment Status")) or "").lower()
        emp_type, status = STATUS_MAP.get(raw_status, (None, None))
        if status is None:
            problems.append(f"Row {n} ({code}): unknown employment status '{raw_status}', defaulting to regular/active")
            emp_type, status = "regular", "active"
        hired = to_day(cell(r, "Date Hired"))
        if not hired:
            problems.append(f"Row {n} ({code}): no date hired; skipped")
            continue
        separated = to_day(cell(r, "End/Separation Date"))
        if status in ("resigned", "terminated") and not separated:
            problems.append(f"Row {n} ({code}): {status} but no separation date")
        position = clean(cell(r, "Position")) or "Staff"
        raw_position = (position or "").lower()
        if emp_type is None:
            emp_type = "part_time" if "part time" in raw_position or "part-time" in raw_position else "regular"

        pay_freq = (clean(cell(r, "Pay Frequency")) or "Semi-Monthly").lower()
        basic = to_amount(cell(r, "Basic Salary"))
        comm = to_amount(cell(r, "Communication Allowance"))
        allowances = []
        if comm:
            # Communication allowance has no de minimis limit of its own under
            # RR 11-2018; taxable unless it is for the employer's convenience.
            allowances.append({"code": "communication", "label": "Communication allowance", "amount_monthly": comm, "tax": "taxable"})

        documents = []
        for col, type_id in DOCUMENT_COLUMNS.items():
            v = clean(cell(r, col))
            if v is None:
                continue
            is_link = v.lower().startswith("http")
            documents.append({"document_type_id": type_id, "status": "complete" if is_link else "submitted", "drive_url": v if is_link else None, "notes": None if is_link else v})

        people.append(
            {
                "employee": {
                    "employee_code": code.upper(),
                    "first_name": first,
                    "middle_name": clean(cell(r, "Middle Name")),
                    "last_name": last,
                    "position": position,
                    "department": clean(cell(r, "Department")),
                    "employment_type": emp_type,
                    "status": status,
                    "hire_date": hired,
                    "separation_date": separated,
                    "birthdate": to_day(cell(r, "Birthdate")),
                    "civil_status": clean(cell(r, "Civil Status")),
                    "contact_number": clean(cell(r, "Contact No.")),
                    "email": clean(cell(r, "Email Address")),
                    "address": clean(cell(r, "Address")),
                    "emergency_contact": {
                        k: v
                        for k, v in {
                            "name": clean(cell(r, "Emergency Contact Name")),
                            "relationship": clean(cell(r, "Emergency Relationship")),
                            "phone": clean(cell(r, "Emergency Contact No.")),
                            "address": clean(cell(r, "Emergency Address")),
                        }.items()
                        if v
                    },
                    "notes": clean(cell(r, "Notes")),
                },
                "private": {
                    "sss_no": clean(cell(r, "SSS No.")),
                    "philhealth_no": clean(cell(r, "PhilHealth No.")),
                    "pagibig_no": clean(cell(r, "Pag-IBIG No.")),
                    "tin": clean(cell(r, "TIN")),
                    "bank_name": clean(cell(r, "Bank Name")),
                    "bank_account_name": clean(cell(r, "Account Name")),
                    "bank_account_no": clean(cell(r, "Account No.")),
                },
                "pay": {
                    "pay_frequency": pay_freq,
                    "basic_monthly": basic,
                    "allowances": allowances,
                    "payroll_status": clean(cell(r, "Payroll Status")),
                },
                "documents": documents,
            }
        )
        if basic is None:
            problems.append(f"Row {n} ({code}): no basic salary; compensation will not be created")
        if pay_freq != "semi-monthly":
            problems.append(f"Row {n} ({code}): pay frequency '{pay_freq}' is not semi-monthly; check before payroll")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(people, indent=2, ensure_ascii=False), encoding="utf-8")

    active = sum(1 for p in people if p["employee"]["status"] in ("active", "on_leave"))
    lines = [
        "# Employee 201 clean report",
        "",
        f"Source: `{SOURCE.name}` / `{SHEET}`",
        f"Rows: {len(people)} employees ({active} active, {len(people) - active} separated)",
        f"With basic salary: {sum(1 for p in people if p['pay']['basic_monthly'] is not None)}",
        f"Document links: {sum(len(p['documents']) for p in people)}",
        "",
        "## Problems",
        "",
    ]
    lines += [f"- {p}" for p in problems] or ["- none"]
    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(people)} employees to {OUT_JSON}")
    print(f"Report: {OUT_REPORT}")
    for p in problems:
        print(f"  ! {p}")


if __name__ == "__main__":
    main()
