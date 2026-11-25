// Relative imports with extensions: `node --test` loads this file without the @/ alias.
import { formatTime12 } from "./time12.ts";

/**
 * The emails a requestor gets about a booking at the LAF Activity Center (0172): the words live here, the database
 * only keeps the queue (booking.outbox). Pure, so the wording and the escaping can be tested. Everything typed by a
 * requestor or by staff is escaped before it enters the HTML.
 */

export type BookingEmailKind = "received" | "approved" | "declined" | "cancelled" | "moved" | "reminder" | "thanks";

export interface BookingEmailData {
  ref: string;
  requestorName: string;
  contactPerson: string;
  /** `yyyy-MM-dd`. */
  date: string;
  start: string;
  end: string;
  placeName: string;
  whereToGo: string;
  volunteersCount: number;
  replyDays: number;
  /** `yyyy-MM-dd`: the last day to give the volunteers' names. */
  namesDue: string;
  declineReason: string;
  placeInstructions: string;
  bookingInstructions: string;
  coordinatorName: string;
  coordinatorPhone: string;
  /** For a reminder: how many days until the visit, and how many volunteers have been named so far. */
  daysToGo?: number;
  namesGiven?: number;
}

const NAVY = "#082f59";
const BLUE = "#0068c9";
const SLATE = "#436077";

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** "Thursday, December 10, 2026" from `yyyy-MM-dd`, with no time zone in play. */
export function longDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** The requestor's own page for a booking. */
export const trackUrl = (siteUrl: string, ref: string): string => `${siteUrl.replace(/\/+$/, "")}/book/track?ref=${encodeURIComponent(ref)}`;

const p = (html: string) => `<p style="margin:0 0 14px;color:${SLATE};font-size:15px;line-height:1.55">${html}</p>`;
const lines = (text: string) => escapeHtml(text.trim()).replace(/\r?\n/g, "<br>");

export function bookingEmail(kind: BookingEmailKind, d: BookingEmailData, siteUrl: string): { subject: string; html: string } {
  const when = `${longDate(d.date)}, ${formatTime12(d.start)} to ${formatTime12(d.end)}`;
  let link = trackUrl(siteUrl, d.ref);
  const facts = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;font-size:15px;color:${NAVY}">
<tr><td style="padding:3px 14px 3px 0;color:${SLATE}">Request ID</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(d.ref)}</td></tr>
<tr><td style="padding:3px 14px 3px 0;color:${SLATE}">When</td><td style="padding:3px 0">${escapeHtml(when)}</td></tr>
<tr><td style="padding:3px 14px 3px 0;color:${SLATE}">Where</td><td style="padding:3px 0">${escapeHtml(d.placeName)}</td></tr>
<tr><td style="padding:3px 14px 3px 0;color:${SLATE}">Group</td><td style="padding:3px 0">${escapeHtml(d.requestorName)}, ${d.volunteersCount} volunteer${d.volunteersCount === 1 ? "" : "s"}</td></tr>
</table>`;

  let subject: string;
  let title: string;
  let body: string;
  let button = "See your booking";
  if (kind === "received") {
    subject = `We received your request (${d.ref})`;
    title = "We received your request";
    body =
      p(`Thank you for offering your time to the children. Your request is <strong>pending approval</strong>, and the slot is held for you while we review it.`) +
      facts +
      p(`We will email you within ${d.replyDays} working day${d.replyDays === 1 ? "" : "s"}. Please keep your Request ID: it opens your booking on our page, where you can see its status at any time.`);
  } else if (kind === "approved") {
    subject = `Your booking is approved (${d.ref})`;
    title = "Your booking is approved";
    button = "Give your volunteers' names";
    const coordinator = [d.coordinatorName, d.coordinatorPhone].filter(Boolean).map(escapeHtml).join(", ");
    body =
      p(`We look forward to your visit. Here is what you need for the day.`) +
      facts +
      (d.whereToGo ? p(`<strong style="color:${NAVY}">Where to go</strong><br>${lines(d.whereToGo)}`) : "") +
      (d.placeInstructions ? p(`<strong style="color:${NAVY}">Instructions</strong><br>${lines(d.placeInstructions)}`) : "") +
      (d.bookingInstructions ? p(`<strong style="color:${NAVY}">For your group</strong><br>${lines(d.bookingInstructions)}`) : "") +
      (coordinator ? p(`<strong style="color:${NAVY}">Who to coordinate with</strong><br>${coordinator}`) : "") +
      p(`<strong style="color:${NAVY}">Volunteers' names</strong><br>The hospital needs the full name of each volunteer for the gate. Please give them on your booking page by ${escapeHtml(longDate(d.namesDue))}. Each volunteer signs the logbook at the gate on the day.`);
  } else if (kind === "declined") {
    subject = `About your request (${d.ref})`;
    title = "We could not approve this request";
    body = p(`Thank you for offering your time to the children. We are sorry that we could not approve this request.`) + facts + (d.declineReason ? p(`<strong style="color:${NAVY}">Reason</strong><br>${lines(d.declineReason)}`) : "") + p(`The slot is free again. You are welcome to ask for another day on our booking page.`);
  } else if (kind === "reminder") {
    // Sent 3 days and 1 day before the visit. It asks for the names only while some are missing.
    const days = d.daysToGo ?? 1;
    const soon = days <= 1 ? "tomorrow" : `in ${days} days`;
    const missing = Math.max(d.volunteersCount - (d.namesGiven ?? 0), 0);
    const coordinator = [d.coordinatorName, d.coordinatorPhone].filter(Boolean).map(escapeHtml).join(", ");
    subject = `Your visit is ${soon} (${d.ref})`;
    title = `Your visit is ${soon}`;
    button = missing ? "Give your volunteers' names" : "See your booking";
    body =
      p(`A reminder of your visit with the children. We look forward to seeing you.`) +
      facts +
      (missing ? p(`<strong style="color:${NAVY}">Volunteers' names</strong><br>We still need ${missing} of your ${d.volunteersCount} volunteers' full names. The hospital's gate needs them: please give them on your booking page today.`) : "") +
      (d.whereToGo ? p(`<strong style="color:${NAVY}">Where to go</strong><br>${lines(d.whereToGo)}`) : "") +
      (d.placeInstructions ? p(`<strong style="color:${NAVY}">Instructions</strong><br>${lines(d.placeInstructions)}`) : "") +
      (d.bookingInstructions ? p(`<strong style="color:${NAVY}">For your group</strong><br>${lines(d.bookingInstructions)}`) : "") +
      (coordinator ? p(`<strong style="color:${NAVY}">Who to coordinate with</strong><br>${coordinator}`) : "") +
      p(`Please print the Booking Details sheet from your booking page and hand it to the guard at the gate. Each volunteer signs the logbook and shows a valid ID.`) +
      p(`If your group can no longer come, please cancel on your booking page so another group can take the slot.`);
  } else if (kind === "thanks") {
    subject = `Thank you for your visit (${d.ref})`;
    title = "Thank you for your visit";
    button = "Book another visit";
    link = `${siteUrl.replace(/\/+$/, "")}/book`;
    body = p(`Thank you for the time and care your group gave the children and their families. It made their day at the hospital lighter.`) + facts + p(`You are always welcome back. When you are ready, choose another day on our booking page.`);
  } else if (kind === "moved") {
    subject = `Your booking has a new schedule (${d.ref})`;
    title = "Your booking has a new schedule";
    body = p(`Your booking was moved. Your program flow keeps its order and lengths. The new schedule is below.`) + facts + p(`If the new schedule does not suit your group, please reply to this email or cancel on your booking page.`);
  } else {
    subject = `Your booking is cancelled (${d.ref})`;
    title = "Your booking is cancelled";
    body = p(`This booking is cancelled and the slot is free again.`) + facts + p(`You are welcome to ask for another day on our booking page.`);
  }

  const html = `<div style="background:#edf8ff;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #c7dce9;border-radius:20px;padding:28px 24px">
<p style="margin:0 0 6px;color:${BLUE};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">LAF Activity Center Booking</p>
<h1 style="margin:0 0 16px;color:${NAVY};font-size:24px;line-height:1.15">${title}</h1>
${p(`Dear ${escapeHtml(d.contactPerson || d.requestorName)},`)}
${body}
<p style="margin:22px 0 8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#ffc83d;color:${NAVY};font-weight:bold;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;text-decoration:none;padding:13px 24px;border-radius:999px">${button}</a></p>
<p style="margin:18px 0 0;color:${SLATE};font-size:13px;line-height:1.5">Little Ark Foundation · Our Children. Our Future.</p>
</div></div>`;
  return { subject, html };
}
