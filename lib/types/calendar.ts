/** No existing type covered general venue/visit scheduling (Trip is transport-specific) --
 *  added for the real Master Calendar data. See scripts/clean-calendar-data.py. */
export interface CalendarEvent {
  id: string;
  date: string;
  time?: string;
  title: string;
  venue?: string;
  officerOnDuty?: string;
  staffNeeded?: string;
  bookedBy?: string;
  contactInfo?: string;
  remarks?: string;
}
