"""
Pulls the "Key Monthly Drivers" paragraphs out of the CEO's summary sheet so
they can be seeded into ops.finance_month_notes and edited in the app from
then on.

Reads from  ../DATA/2026 LAF Donation Tracker.xlsx, sheet INCOME AND EXPENSES TRACKING
            (column A = month name, column F = the paragraph; data from row 5)
Writes to   ../DATA/clean/finance-month-notes.json  as [{ "month": "2026-01", "drivers": "..." }]

Only months with a written paragraph are emitted. The sheet's year is taken
from its title block ("(2026)"); if that ever changes, YEAR below does too.

Usage: python scripts/clean-finance-month-notes.py   (run from the repo root)
"""

import json
from pathlib import Path

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_XLSX = REPO_ROOT.parent / "DATA" / "2026 LAF Donation Tracker.xlsx"
OUT_DIR = REPO_ROOT.parent / "DATA" / "clean"
SHEET = "INCOME AND EXPENSES TRACKING"
YEAR = 2026

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def main():
    if not SOURCE_XLSX.exists():
        raise SystemExit(f"Source workbook not found: {SOURCE_XLSX}")
    wb = openpyxl.load_workbook(SOURCE_XLSX, read_only=True, data_only=True)
    ws = wb[SHEET]

    notes = []
    for row in ws.iter_rows(min_row=5, values_only=True):
        month_cell = row[0] if len(row) > 0 else None
        drivers = row[5] if len(row) > 5 else None
        if not month_cell:
            continue
        month_num = MONTHS.get(str(month_cell).strip().lower())
        if not month_num:
            continue  # TOTAL row, cash-in-bank row, etc.
        text = " ".join(str(drivers).split()) if drivers else ""
        if not text:
            continue
        notes.append({"month": f"{YEAR}-{month_num:02d}", "drivers": text})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "finance-month-notes.json", "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(notes)} month notes to {OUT_DIR / 'finance-month-notes.json'}: "
          + ", ".join(n["month"] for n in notes))


if __name__ == "__main__":
    main()
