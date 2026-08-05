import type { Shift, Staff, TimeEntry, TimeEntryFlag, TimesheetApproval, Volunteer } from "@/lib/types/staff";
import { makeRng } from "@/lib/utils/seeded-random";

const rng = makeRng(101);

export const staff: Staff[] = [
  { id: "stf-1", firstName: "Butch", lastName: "Bustamante", role: "admin", position: "Executive Director", active: true, hireDate: "2018-02-01" },
  { id: "stf-2", firstName: "Ana", lastName: "Del Mundo", role: "admin", position: "Operations Manager", active: true, hireDate: "2019-06-15" },
  { id: "stf-3", firstName: "Queen Izell", lastName: "Spencer", role: "social_worker", position: "Resident Social Worker", active: true, hireDate: "2021-01-10" },
  { id: "stf-4", firstName: "Cathlyn", lastName: "Paglinawan", role: "social_worker", position: "Resident Social Worker", active: true, hireDate: "2022-03-20" },
  { id: "stf-5", firstName: "Margielyn", lastName: "Formento", role: "house_staff", position: "House Coordinator", active: true, hireDate: "2020-08-05" },
  { id: "stf-6", firstName: "Jonalie", lastName: "Mapesos", role: "house_staff", position: "House Support", active: true, hireDate: "2021-11-12" },
  { id: "stf-7", firstName: "Christopher", lastName: "Fajardo", role: "driver", position: "Driver", active: true, hireDate: "2019-09-01" },
  { id: "stf-8", firstName: "Desiree", lastName: "Loquinario", role: "finance", position: "Finance Officer", active: true, hireDate: "2020-01-15" },
  { id: "stf-9", firstName: "Marivic", lastName: "Fortes-Bartolome", role: "finance", position: "CFO (USA)", active: true, hireDate: "2017-05-01" },
  { id: "stf-10", firstName: "Leah", lastName: "Uy-Vitalicio", role: "finance", position: "CPA, Board Finance", active: true, hireDate: "2018-04-01" },
  { id: "stf-11", firstName: "Rosemarie", lastName: "Dayupay", role: "finance", position: "Treasurer", active: true, hireDate: "2017-05-01" },
  { id: "stf-12", firstName: "Grace", lastName: "Villanueva", role: "house_staff", position: "House Support (Weekends)", active: true, hireDate: "2023-02-14" },
];

const flagWeights: TimeEntryFlag[] = [
  "on_time", "on_time", "on_time", "on_time", "on_time", "on_time", "late", "early_out", "missed_punch",
];

export const shifts: Shift[] = [];
export const timeEntries: TimeEntry[] = [];
export const timesheetApprovals: TimesheetApproval[] = [];

const clockStaff = staff.filter((s) => ["house_staff", "driver", "social_worker"].includes(s.role));

for (let day = 13; day >= 0; day--) {
  const date = rng.daysFromNow(-day);
  for (const person of clockStaff) {
    if (rng.bool(0.88)) {
      const label = rng.pick(["AM", "PM", "24hr"] as const);
      shifts.push({
        id: `shift-${person.id}-${date}`,
        staffId: person.id,
        date,
        startTime: label === "PM" ? "14:00" : "06:00",
        endTime: label === "PM" ? "22:00" : label === "24hr" ? "06:00+1" : "14:00",
        label,
      });

      const flag = rng.pick(flagWeights);
      const entry: TimeEntry = {
        id: `time-${person.id}-${date}`,
        staffId: person.id,
        date,
        clockIn: flag === "missed_punch" ? undefined : flag === "late" ? "06:22" : "06:02",
        clockOut: flag === "missed_punch" ? undefined : flag === "early_out" ? "13:10" : "14:05",
        breakMinutes: rng.int(30, 60),
        flag,
        overtimeMinutes: rng.bool(0.2) ? rng.int(15, 90) : 0,
        gpsStamped: rng.bool(0.7),
      };
      timeEntries.push(entry);

      if (flag !== "on_time") {
        timesheetApprovals.push({
          id: `appr-${entry.id}`,
          timeEntryId: entry.id,
          staffId: person.id,
          status: rng.pick(["pending", "pending", "approved", "flagged"] as const),
          adjustmentReason: flag === "missed_punch" ? "Punch device offline at house" : undefined,
        });
      }
    }
  }
}

export const volunteers: Volunteer[] = [
  { id: "vol-1", firstName: "Rica", lastName: "Domingo", focusArea: "Care Cart", totalHours: 142, lastSessionDate: rng.daysFromNow(-2), certificatesIssued: 2 },
  { id: "vol-2", firstName: "Miguel", lastName: "Santos", focusArea: "Activity Center", totalHours: 96, lastSessionDate: rng.daysFromNow(-5), certificatesIssued: 1 },
  { id: "vol-3", firstName: "Joy", lastName: "Cabrera", focusArea: "Transport", totalHours: 58, lastSessionDate: rng.daysFromNow(-1), certificatesIssued: 1 },
  { id: "vol-4", firstName: "Ella", lastName: "Ramos", focusArea: "Events", totalHours: 210, lastSessionDate: rng.daysFromNow(-9), certificatesIssued: 3 },
  { id: "vol-5", firstName: "Noel", lastName: "Bautista", focusArea: "Care Cart", totalHours: 34, lastSessionDate: rng.daysFromNow(-14), certificatesIssued: 0 },
];
