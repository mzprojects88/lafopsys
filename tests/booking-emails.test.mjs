// lib/utils/booking-emails.ts: the emails a requestor gets about a booking (0172).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookingAlertEmail, bookingEmail, escapeHtml, longDate, portalPasswordEmail, trackUrl } from "../lib/utils/booking-emails.ts";

const data = {
  ref: "LAF-AC-ABCD-2345",
  requestorName: "Sample Volunteers Inc.",
  contactPerson: "Sample Person",
  date: "2026-12-10",
  start: "10:00",
  end: "12:00",
  placeName: "LAF Activity Center at National Children's Hospital",
  whereToGo: "National Children's Hospital, Quezon City",
  volunteersCount: 5,
  replyDays: 3,
  namesDue: "2026-12-07",
  declineReason: "",
  placeInstructions: "Use Gate 2.\nSign the logbook.",
  bookingInstructions: "",
  coordinatorName: "Sample Coordinator",
  coordinatorPhone: "0917 111 1111",
};
const site = "https://book.littlearkfoundation.org";

describe("booking emails", () => {
  it("says the day in words and the time on a 12-hour clock", () => {
    assert.equal(longDate("2026-12-10"), "Thursday, December 10, 2026");
    const { subject, html } = bookingEmail("received", data, site);
    assert.equal(subject, "We received your request (LAF-AC-ABCD-2345)");
    assert.match(html, /Thursday, December 10, 2026, 10:00 AM to 12:00 PM/);
    assert.match(html, /within 3 working days/);
    assert.match(html, /pending approval/);
  });
  it("links to the requestor's own page, whatever the site's address ends with", () => {
    assert.equal(trackUrl("https://book.littlearkfoundation.org/", "LAF-AC-ABCD-2345"), "https://book.littlearkfoundation.org/book/track?ref=LAF-AC-ABCD-2345");
    assert.match(bookingEmail("approved", data, site).html, /href="https:\/\/book\.littlearkfoundation\.org\/book\/track\?ref=LAF-AC-ABCD-2345"/);
  });
  it("an approval carries where to go, the instructions, the coordinator and when the names are due", () => {
    const { html } = bookingEmail("approved", data, site);
    for (const part of ["Where to go", "Use Gate 2.<br>Sign the logbook.", "Sample Coordinator, 0917 111 1111", "Monday, December 7, 2026", "signs the logbook"]) assert.ok(html.includes(part), part);
    assert.ok(!html.includes("For your group"), "an empty instruction is left out");
  });
  it("a refusal gives the reason; only an approval gives the instructions", () => {
    const declined = bookingEmail("declined", { ...data, declineReason: "The hospital has an event that day." }, site).html;
    assert.ok(declined.includes("The hospital has an event that day."));
    for (const kind of ["received", "declined", "cancelled", "moved", "thanks"]) {
      const html = bookingEmail(kind, data, site).html;
      assert.ok(!html.includes("Sample Coordinator") && !html.includes("Gate 2"), kind);
    }
  });
  it("a reminder says how soon, asks for names only while some are missing, and repeats what the group needs", () => {
    const three = bookingEmail("reminder", { ...data, daysToGo: 3, namesGiven: 2 }, site);
    assert.equal(three.subject, "Your visit is in 3 days (LAF-AC-ABCD-2345)");
    for (const part of ["We still need 3 of your 5 volunteers", "Use Gate 2.", "Sample Coordinator, 0917 111 1111", "Booking Details sheet", "Give your volunteers"]) assert.ok(three.html.includes(part), part);
    const tomorrow = bookingEmail("reminder", { ...data, daysToGo: 1, namesGiven: 5 }, site);
    assert.equal(tomorrow.subject, "Your visit is tomorrow (LAF-AC-ABCD-2345)");
    assert.ok(!tomorrow.html.includes("We still need") && tomorrow.html.includes("See your booking"));
  });
  it("the thank-you invites the group back to the booking page, not to the old booking", () => {
    const { subject, html } = bookingEmail("thanks", data, site);
    assert.equal(subject, "Thank you for your visit (LAF-AC-ABCD-2345)");
    assert.ok(html.includes('href="https://book.littlearkfoundation.org/book"'));
    assert.ok(html.includes("Book another visit"));
  });
  it("nothing a requestor or staff typed can enter the email as HTML", () => {
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    const evil = { ...data, requestorName: `<img src=x onerror=alert(1)>`, contactPerson: `</p><script>x</script>`, placeInstructions: `<b>bold</b>`, declineReason: `<i>no</i>`, coordinatorName: `"><svg>`, ref: `LAF"><b>` };
    for (const kind of ["received", "approved", "declined", "cancelled", "moved", "reminder", "thanks", "changed", "expired"]) {
      const { html } = bookingEmail(kind, evil, site);
      for (const tag of ["<img", "<script", "<b>bold", "<i>no", "<svg", `"><b>`]) assert.ok(!html.includes(tag), `${kind}: ${tag}`);
    }
  });
  it("0184: the confirm-by date, the group's own change of date, expiry, and no email asks for a reply", () => {
    const received = bookingEmail("received", { ...data, confirmBy: "2026-12-07" }, site).html;
    assert.ok(received.includes("We will confirm your booking by") && received.includes("Monday, December 7, 2026") && !received.includes("working days"));
    const named = bookingEmail("approved", { ...data, namesGiven: 5 }, site);
    assert.ok(named.html.includes("The hospital's gate has your volunteers' names") && named.html.includes("See your booking") && named.html.includes("change the date or to cancel"));
    const changed = bookingEmail("changed", { ...data, confirmBy: "2026-12-07" }, site);
    assert.equal(changed.subject, "We received your new date (LAF-AC-ABCD-2345)");
    assert.ok(changed.html.includes("pending approval") && changed.html.includes("Monday, December 7, 2026"));
    const expired = bookingEmail("expired", data, site);
    assert.ok(expired.html.includes("could not confirm this request in time") && expired.html.includes('href="https://book.littlearkfoundation.org/book"'));
    for (const kind of ["received", "approved", "declined", "cancelled", "moved", "reminder", "thanks", "changed", "expired"]) assert.ok(!/reply to this email/i.test(bookingEmail(kind, data, site).html), kind);
  });
  it("0184: the staff alert lists each request with its confirm-by date, escaped, and links to Bookings", () => {
    const rows = [
      { ref: "LAF-AC-ABCD-2345", group: "<b>Sample</b> Group", date: "2026-12-10", start: "10:00", end: "12:00", confirmBy: "2026-12-07" },
      { ref: "LAF-AC-ABCD-2346", group: "Staff Filed", date: "2026-12-11", start: "10:00", end: "12:00", confirmBy: "" },
    ];
    const one = bookingAlertEmail("new", rows.slice(0, 1), "https://lafopsys.vercel.app/");
    assert.equal(one.subject, "New booking request: <b>Sample</b> Group");
    assert.ok(!one.html.includes("<b>Sample") && one.html.includes("Confirm by Monday, December 7, 2026") && one.html.includes('href="https://lafopsys.vercel.app/bookings"'));
    const sum = bookingAlertEmail("summary", rows, "https://lafopsys.vercel.app");
    assert.equal(sum.subject, "2 booking requests to confirm");
    assert.ok(sum.html.includes("Filed by staff"));
  });
  it("step 4: the portal password email carries the one-time password, the sign-in link and the right words, escaped", () => {
    const d = { contactPerson: "Sample <b>Contact</b>", groupName: "Sample Group", email: "group@example.org", otp: "ABCDE-FGH23", until: "Monday, November 30, 2026 at 9:15 AM" };
    const w = portalPasswordEmail("welcome", d, "https://lafopsys.vercel.app/");
    assert.equal(w.subject, "Your Volunteers Portal sign-in");
    assert.ok(w.html.includes("ABCDE-FGH23") && w.html.includes('href="https://lafopsys.vercel.app/book/sign-in"') && w.html.includes("group@example.org") && !w.html.includes("<b>Contact"));
    const f = portalPasswordEmail("forgot", d, "https://lafopsys.vercel.app");
    assert.equal(f.subject, "Your new Volunteers Portal password");
    assert.ok(f.html.includes("current password keeps working") && f.html.includes("did not ask for this"));
  });
  it("0186: the reminder no longer says to cancel on the page; it says to write to info@", () => {
    const r = bookingEmail("reminder", { ...data, daysToGo: 1, namesGiven: 5 }, site).html;
    assert.ok(!r.includes("cancel on your booking page") && r.includes("info@littlearkfoundation.org"));
  });
});
