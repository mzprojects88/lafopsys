import type { CalendarEvent } from "@/lib/types/calendar";
import realCalendarEvents from "@/lib/mock-data/real/calendar-events.json";

// Real event/booking log, synced from DATA/clean/calendar-events.json (see
// scripts/sync-real-data.mjs and scripts/clean-calendar-data.py). No mock
// fallback -- this is a new dataset with no prior seeded generator; an empty
// array (the sync script's placeholder when DATA/ isn't present) is a
// correct, honest "no data" state rather than something to fabricate around.
export const calendarEvents: CalendarEvent[] = realCalendarEvents as CalendarEvent[];
