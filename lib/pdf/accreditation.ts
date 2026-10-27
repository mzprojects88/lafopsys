/** The DSWD line every AR prints (lafopsys 0119): "<label> <number>" from shared.app_settings, or nothing before it is set. */
export function accreditationLine(row: { dswd_label?: string | null; dswd_number?: string | null } | null | undefined): string | undefined {
  const number = row?.dswd_number?.trim();
  return number ? `${row?.dswd_label?.trim() || "DSWD Accreditation No."} ${number}` : undefined;
}
