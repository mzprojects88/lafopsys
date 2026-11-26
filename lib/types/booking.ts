/**
 * LAF Activity Center Bookings (0172): requests from donors, people, companies and institutions to run
 * activities for the children, filed on the public booking page and answered by staff in ArkOS.
 * Mirrors the `booking` schema. Times are `HH:mm`, days `yyyy-MM-dd` (Manila).
 */

export type BookingStatus = "pending" | "approved" | "declined" | "cancelled" | "completed" | "no_show";

/** What a slot of a day is, as booking.slot_states() says it. */
export type SlotState = "open" | "pending" | "booked" | "closed" | "holiday" | "too_soon" | "too_far" | "past";

export type RequestorKind = "person" | "company" | "school" | "church" | "organization" | "government";

/** Where an activity of a program flow came from. Only "plan" is in the month's NCH-approved plan. */
export type ActivitySource = "plan" | "list" | "suggested";

export interface BookingSettings {
  minDaysAhead: number;
  maxDaysAhead: number;
  maxVolunteers: number;
  maxOpenRequests: number;
  namesDueDays: number;
  replyDays: number;
  /** Days after a visit the group may confirm who came from the portal (0183). */
  attendanceDays: number;
  /** How many times a group may change its own date (0184). */
  maxDateChanges: number;
  /** Booking alerts for staff (0184): who gets them, and the two switches (both off at first). */
  alertEmails: string;
  alertNewRequest: boolean;
  alertMorning: boolean;
  guidelines: string;
  prohibited: string;
  privacyNotice: string;
  /** Where the public booking page is served (no trailing slash); the links in emails use it. */
  siteUrl: string;
}

export interface BookingPlace {
  id: string;
  name: string;
  site: "NCH" | "LAF";
  whereToGo: string;
  /** Shown to a requestor only once the booking is approved. */
  instructions: string;
  coordinatorName: string;
  coordinatorPhone: string;
  open: boolean;
  sort: number;
}

export interface BookingSlot {
  id: string;
  placeId: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  start: string;
  end: string;
  active: boolean;
}

export interface BookingClosure {
  id: string;
  /** Null = every place. */
  placeId: string | null;
  dateFrom: string;
  dateTo: string;
  reason: string;
}

export interface BookingActivityType {
  id: string;
  name: string;
  active: boolean;
  sort: number;
}

/** One activity of a request's program flow. */
export interface BookingItem {
  id: string;
  requestId: string;
  position: number;
  activity: string;
  source: ActivitySource;
  purpose: string;
  who: "patients" | "carers" | "both";
  ages: string;
  gender: "all" | "girls" | "boys";
  note: string;
  start: string;
  end: string;
  materials: string;
}

export interface BookingRequest {
  id: string;
  /** The day staff must confirm a request from the booking page by (0184); null when staff filed or moved it. */
  confirmBy: string | null;
  /** The Request ID the requestor holds (LAF-AC-XXXX-XXXX). */
  ref: string;
  /** The running number staff use (LAF-ACB-2026-0001). */
  seqNo: string;
  placeId: string;
  date: string;
  start: string;
  end: string;
  status: BookingStatus;
  requestorName: string;
  requestorKind: RequestorKind;
  contactPerson: string;
  /** Empty on a request staff filed for someone without an email address. */
  email: string;
  mobile: string;
  /** How it came: the public page, or filed by staff for a phone call or a walk-in. */
  channel: "web" | "phone" | "walk_in";
  /** The group it belongs to (0181). */
  groupId: string | null;
  volunteersCount: number;
  hasMinors: boolean;
  /** An activity is not in the month's NCH-approved plan: approval needs the coordination below. */
  offPlan: boolean;
  nchContact: string;
  nchCoordinatedAt: string | null;
  nchNotes: string;
  declineReason: string;
  staffNote: string;
  instructions: string;
  attendedChildren: number | null;
  attendedVolunteers: number | null;
  attendedHours: number | null;
  createdAt: string;
  decidedAt: string | null;
}

export type PlanStatus = "draft" | "submitted" | "approved" | "returned";

/** A month's Activity Plan for a place, sent to NCH for approval. `month` is `yyyy-MM`. */
export interface BookingPlan {
  id: string;
  placeId: string;
  month: string;
  status: PlanStatus;
  submittedOn: string | null;
  approvedOn: string | null;
  approvedBy: string;
  notes: string;
}

export interface BookingPlanItem {
  id: string;
  planId: string;
  activity: string;
  purpose: string;
  participants: string;
  materials: string;
  /** The day of the activity (`yyyy-MM-dd`), always inside the plan's month. */
  onDate: string;
  /** `HH:mm`, or empty when no time was set; the duration is worked out from the two. */
  start: string;
  end: string;
  sort: number;
}

/** A member of a booking's group (0181): full name and email (a parent's or guardian's for a member under 18). */
export interface BookingVolunteer {
  id: string;
  requestId: string;
  position: number;
  name: string;
  email: string;
  under18: boolean;
  /** After the visit: false = did not come; null = not marked (counts as came). */
  came: boolean | null;
  /** The volunteer on the Volunteers page this member was credited to (production only). */
  personId: string | null;
}

/** One per contact email: the group that books visits (0181). */
export interface BookingGroup {
  id: string;
  name: string;
  kind: RequestorKind;
  contactPerson: string;
  /** Empty for a group staff filed for someone without an email address. */
  email: string;
  mobile: string;
  createdAt: string;
}

/** A member as the group's own page shows it (email masked). */
export interface PublicMember {
  name: string;
  email: string;
  under18: boolean;
}

export interface BookingEvent {
  id: string;
  requestId: string;
  at: string;
  /** The staff member, when staff did it. */
  actor: string | null;
  byRequestor: boolean;
  action: string;
  detail: string;
}

export interface SlotOfDay {
  day: string;
  start: string;
  end: string;
  state: SlotState;
}

/** What the public booking page starts with (booking.web_form). */
export interface PublicBookingForm {
  today: string;
  settings: { minDaysAhead: number; maxDaysAhead: number; maxVolunteers: number; namesDueDays: number; replyDays: number; guidelines: string; prohibited: string; privacyNotice: string };
  places: { id: string; name: string; whereToGo: string }[];
  activities: string[];
  /** The NCH-approved Activity Plans of the months that can be booked. */
  plans: { placeId: string; month: string; items: { id: string; activity: string; purpose: string; participants: string; materials: string; onDate: string; start: string | null; end: string | null }[] }[];
}

/** A slot of the public month view (booking.web_availability). */
export interface PublicSlot {
  date: string;
  start: string;
  end: string;
  state: SlotState;
}

/** A booking as its requestor sees it (booking.request_view): contacts masked, the coordinator only once approved. */
export interface PublicBooking {
  ref: string;
  status: BookingStatus;
  offPlan: boolean;
  date: string;
  start: string;
  end: string;
  place: { name: string; whereToGo: string };
  requestorName: string;
  requestorKind: RequestorKind;
  contactPerson: string;
  /** Masked; null when the request has no email address. */
  email: string | null;
  mobile: string;
  volunteersCount: number;
  hasMinors: boolean;
  requestedOn: string;
  items: { activity: string; source: ActivitySource; purpose: string; who: "patients" | "carers" | "both"; ages: string; gender: "all" | "girls" | "boys"; note: string; start: string; end: string; materials: string }[];
  names: string[];
  members: PublicMember[];
  namesDue: string;
  canEditNames: boolean;
  canCancel: boolean;
  /** While pending: the day staff confirm it by (0184); null for a booking staff filed or moved. */
  confirmBy: string | null;
  canChangeDate: boolean;
  dateChangesLeft: number;
  /** What happened, by day: the action only, never a staff name or note. */
  history: { action: string; on: string; byYou: boolean }[];
  /** Added by the server's look-up, for the open days of "Change the date". */
  placeId?: string;
  declineReason: string | null;
  approved: { instructions: string; bookingInstructions: string; coordinatorName: string; coordinatorPhone: string } | null;
  replyDays: number;
}
