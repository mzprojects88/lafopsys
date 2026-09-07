/**
 * CSV building and downloading, shared by the DTR export and the payroll
 * export. Lifted out of the DTR page unchanged when payroll grew a real
 * export -- two spreadsheets that quote differently is exactly the sort of
 * thing nobody notices until a staff member's name contains a comma.
 */

/** Every field is quoted, so a comma, a newline or an accent in a name can
 * never shift a column. Embedded quotes are doubled, per RFC 4180. */
const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function csvLines(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n");
}

export function downloadCsv(content: string, filename: string) {
  // A BOM, so Excel on Windows opens it as UTF-8 rather than mangling
  // anything outside ASCII in a staff member's name.
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
