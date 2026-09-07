/**
 * Mirrors `ops.calendar_events` (0032) -- the foundation's master calendar,
 * one row per event. Shaped after the Google Sheet it replaced (Date, Time,
 * Event, Venue, Officer on Duty, Staff Needed, Booked By, Contact, Remarks),
 * which is also why `time` is free text: the sheet says "12:00 NN",
 * "10:30 AM - 12:00 NN", "All day", "TBD".
 */
export interface CalendarEvent {
  id: string;
  /** `yyyy-MM-dd`, Manila. */
  date: string;
  time?: string;
  title: string;
  /** Advisory: LAF, NCH, OTHER, TEAMS, ONLINE, HOLIDAY are the values in use. */
  venue?: string;
  officerOnDuty?: string;
  /** Set once an officer is mapped to a staff account; free text until then. */
  officerStaffId?: string;
  staffNeeded?: string;
  bookedBy?: string;
  contactInfo?: string;
  remarks?: string;
  isHoliday: boolean;
  createdBy?: string;
  updatedBy?: string;
}

/** Venues the picker offers. Free text is still allowed. */
export const CALENDAR_VENUES = ["LAF", "NCH", "OTHER", "TEAMS", "ONLINE", "HOLIDAY"] as const;
