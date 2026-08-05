import { format, formatDistanceToNow, parseISO } from "date-fns";

export function formatDate(iso: string, pattern = "MMM d, yyyy") {
  return format(parseISO(iso), pattern);
}

export function formatRelative(iso: string) {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

export function daysUntil(iso: string, from = new Date("2026-08-04T00:00:00Z")) {
  const target = parseISO(iso);
  return Math.round((target.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
