"""
Cleans the real event/booking log into normalized JSON shaped to match the
new lib/types/calendar.ts's CalendarEvent.

Reads from  ../DATA/LAF Master Calendar 2026.xlsx   (sibling of this repo)
Writes to   ../DATA/clean/calendar-events.json + calendar-report.md

Both input and output live entirely outside the git repository. This script
contains only transformation logic -- no scheduling data -- so it is safe to
commit.

Scope: the "2026" sheet only (a normalized event log: Date, Time, Event,
Venue, Officer on Duty, Staff Needed, Booked By, Contact, Remarks -- header
row 1, a blank spacer row 2, data from row 3). The other 6 sheets are NOT
imported:
  - "March/April/May 2026": visual calendar grids (day-number cells with
    embedded, sometimes multi-line event text per cell) -- a fundamentally
    different, position-based layout that would need a bespoke grid parser
    for comparatively low value (this is the lowest-priority dataset in the
    integration plan; not worth building a second parser for).
  - "Sheet9", "Sheet7", "For Posting Needs ": small ad hoc scratch sheets
    (a couple of rows each), not real scheduling data.

The sheet only writes a date on the FIRST event of each day -- subsequent
same-day events leave the date cell blank. Forward-filled from the prior
row's date rather than treated as a missing/skipped value.

Usage: python scripts/clean-calendar-data.py   (run from the repo root)
"""

import json
from datetime import datetime, time
from pathlib import Path

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_XLSX = REPO_ROOT.parent / "DATA" / "LAF Master Calendar 2026.xlsx"
OUT_DIR = REPO_ROOT.parent / "DATA" / "clean"

COL_DATE = 1
COL_TIME = 2
COL_EVENT = 3
COL_VENUE = 4
COL_OFFICER = 5
COL_STAFF_NEEDED = 6
COL_BOOKED_BY = 7
COL_CONTACT = 8
COL_REMARKS = 9


def clean_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clean_time(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    return clean_str(value)


def iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    return text or None


def main():
    if not SOURCE_XLSX.exists():
        raise SystemExit(f"Source workbook not found: {SOURCE_XLSX}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(SOURCE_XLSX, read_only=True, data_only=True)
    ws = wb["2026"]

    events = []
    forward_filled = 0
    skipped_no_title = 0
    last_date: str | None = None

    for raw in ws.iter_rows(min_row=3, values_only=True):
        row = (raw + (None,) * 10)[:10]
        date = iso_date(row[COL_DATE])
        if date:
            last_date = date
        elif row[COL_EVENT] is not None:
            forward_filled += 1

        title = clean_str(row[COL_EVENT])
        if not title:
            continue
        if last_date is None:
            skipped_no_title += 1  # no date established yet (shouldn't happen, but don't fabricate one)
            continue

        events.append({
            "date": last_date,
            "time": clean_time(row[COL_TIME]),
            "title": title,
            "venue": clean_str(row[COL_VENUE]),
            "officerOnDuty": clean_str(row[COL_OFFICER]),
            "staffNeeded": clean_str(row[COL_STAFF_NEEDED]),
            "bookedBy": clean_str(row[COL_BOOKED_BY]),
            "contactInfo": clean_str(row[COL_CONTACT]),
            "remarks": clean_str(row[COL_REMARKS]),
        })

    for i, e in enumerate(events, start=1):
        e["id"] = f"event-real-{i}"

    with open(OUT_DIR / "calendar-events.json", "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)

    report_lines = [
        "# Calendar Cleaning Report",
        "",
        f"Source: `{SOURCE_XLSX.name}` > `2026` sheet only",
        "",
        "## Results",
        f"- CalendarEvent records written: {len(events)}",
        f"- Rows whose date was forward-filled from an earlier row (same-day, date cell left blank): {forward_filled}",
        f"- Rows skipped for having no date established yet: {skipped_no_title}",
        f"- Date range: {events[0]['date'] if events else 'n/a'} to {events[-1]['date'] if events else 'n/a'}",
        "",
        "## Not fabricated / explicitly out of scope this pass",
        "- The `March 2026` / `April 2026` / `May 2026` sheets (visual calendar grids, event text embedded",
        "  per day-cell rather than one-row-per-event) were NOT parsed -- a fundamentally different,",
        "  position-based layout. Lowest-priority dataset in the integration plan; not worth a second,",
        "  bespoke grid parser for what the sheet-name research already flagged as comparatively low value.",
        "- `Sheet9`, `Sheet7`, `For Posting Needs ` -- small ad hoc scratch sheets (a couple of rows each),",
        "  not real scheduling data.",
        "- No UI page was built to browse these events -- lib/types/calendar.ts and this pipeline exist so",
        "  the data is available if/when a scheduling module is built; that's a feature request, not part",
        "  of data integration.",
    ]
    (OUT_DIR / "calendar-report.md").write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Wrote {len(events)} calendar events to {OUT_DIR / 'calendar-events.json'}")
    print(f"  {forward_filled} dates forward-filled, {skipped_no_title} skipped (no date yet)")
    print(f"See {OUT_DIR / 'calendar-report.md'} for the full report.")


if __name__ == "__main__":
    main()
