/**
 * The supervisor's today board (DTR plan phase 3): where each person on
 * today's roster stands against their shift. Late counts after the grace
 * period in Settings, as on the timesheets (lib/utils/attendance.ts).
 * Pure and relative-import only, so tests/today-board.test.mjs runs it.
 */
import { clockOutDueAt, instantOn } from "./dtr-prompts.ts";

export type BoardStatus =
  /** Not in yet, and the shift (plus grace) has not started. */
  | "due"
  /** Not in, and the shift started more than the grace period ago. */
  | "missing"
  /** Clocked in. */
  | "in"
  /** Still clocked in after the shift ended. */
  | "overdue"
  /** Clocked in and out. */
  | "out";

export function boardStatus(input: {
  day: string;
  shift: { start: string; end: string };
  clockIn: string | null;
  clockOut: string | null;
  graceMinutes: number;
  now: Date;
}): { status: BoardStatus; lateMinutes: number } {
  const { day, shift, clockIn, clockOut, graceMinutes, now } = input;
  const start = instantOn(day, shift.start).getTime();
  if (!clockIn) {
    return { status: now.getTime() > start + graceMinutes * 60_000 ? "missing" : "due", lateMinutes: 0 };
  }
  const late = Math.max(0, Math.round((instantOn(day, clockIn).getTime() - start) / 60_000));
  const lateMinutes = late > graceMinutes ? late : 0;
  if (clockOut) return { status: "out", lateMinutes };
  const end = clockOutDueAt(day, clockIn, shift).getTime();
  return { status: now.getTime() > end ? "overdue" : "in", lateMinutes };
}
