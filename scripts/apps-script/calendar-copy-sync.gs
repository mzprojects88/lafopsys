// LAF Master Calendar copy sheet: fills LAF's COPY of "LAF Master Calendar" from ArkOS, every 5
// minutes. ArkOS is the master calendar: events are added and changed there. It never runs in,
// or writes to, the original sheet.
//
// SETUP (once, by whoever owns the copy):
//   1. Make the copy: open the original Master Calendar, File > Make a copy. Keep the header rows.
//   2. In the copy: Extensions > Apps Script. Delete what is there, paste this whole file, save.
//   3. Project Settings (gear icon) > Script Properties > Add script property:
//        Property: CALENDAR_SYNC_SECRET
//        Value:    the calendar key you were given (never paste it anywhere else)
//      Save script properties.
//   4. Back in the Editor, pick "setup" in the function list and click Run. Google asks for
//      permission: choose your account, Advanced, "Go to (project)", Allow. setup adds the
//      5-minute timer and runs once.
//   5. Cell A1 of each tab it fills carries a note with the time of the last update (hover over A1).
//   6. Share the copy with LAF staff accounts only, as viewers. It holds the names and numbers of
//      people who booked events, and children's names and birthdays: not "anyone with the link".
//
// What it writes, under each tab's header row only:
//   - Every tab whose name is a year ("2026", "2027"): columns A to J, the yearly list (weekday,
//     date, time, event, venue, off staff, staff needed, booked by, contact, remarks). For a new
//     year, copy a year's tab and name it with the year: it fills by itself.
//   - "Spiritual Care" and "LAF Activity Center": columns A to G (weekday, date, time, activity,
//     venue, staff needed, remarks).
//   - "Care Cart": columns A to I (weekday, date, time, activity, menu, venue / area, staff needed,
//     name of volunteers, remarks).
//   - "Birthday Celebrants": columns A to D (name, birthday, age today, notes), from the patients
//     ArkOS holds as ongoing.
// Every event row carries its own weekday and date, so a list can be filtered and sorted. Days
// already past are hidden, as in the original; to keep them shown, add the script property
// SHOW_PAST with the value yes.
// Anything typed into those columns is replaced at the next update: change events in ArkOS.
// The other tabs are not touched. If ArkOS does not answer, a tab is left as it was and its A1
// note says why.

var EXPORT_URL = "https://lafopsys.vercel.app/api/calendar/sheet-export";
// The original. This script must never write to it.
var ORIGINAL_ID = "1krxg8BjkZgd0kSHlwm3w25Nq40MMW5DIzJC6gtgj5_g";
// Tab name (capitals and spaces ignored) -> what to ask ArkOS for.
var PROGRAM_TABS = { SPIRITUALCARE: "tab=spiritual-care", CARECART: "tab=care-cart", LAFACTIVITYCENTER: "tab=activity-center", BIRTHDAYCELEBRANTS: "tab=birthdays" };

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncCopy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncCopy").timeBased().everyMinutes(5).create();
  syncCopy();
}

function syncCopy() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error("Open this script from the copy: Extensions > Apps Script.");
  if (book.getId() === ORIGINAL_ID) throw new Error("This is the ORIGINAL Master Calendar. The script only runs in LAF's copy.");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // the previous run is still writing
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty("CALENDAR_SYNC_SECRET");
    if (!key) throw new Error("CALENDAR_SYNC_SECRET is not set in Project Settings > Script Properties.");
    var showPast = String(props.getProperty("SHOW_PAST") || "").toLowerCase() === "yes";
    var jobs = [];
    book.getSheets().forEach(function (sheet) {
      var name = sheet.getName().replace(/\s+/g, "").toUpperCase();
      if (/^20\d\d$/.test(name)) jobs.push({ sheet: sheet, query: "year=" + name });
      else if (PROGRAM_TABS[name]) jobs.push({ sheet: sheet, query: PROGRAM_TABS[name] });
    });
    if (jobs.length === 0) throw new Error("No tab named with a year (2026, 2027) or a program was found in this copy.");
    var failed = null;
    jobs.forEach(function (job) {
      try {
        writeList(job.sheet, fetchRows(job.query, key), showPast);
      } catch (e) {
        // One tab that fails must not stop the others.
        job.sheet.getRange("A1").setNote("Last update FAILED " + new Date().toLocaleString() + ": " + e.message);
        failed = failed || e;
      }
    });
    if (failed) throw failed;
  } finally {
    lock.releaseLock();
  }
}

function fetchRows(query, key) {
  var response = UrlFetchApp.fetch(EXPORT_URL + "?" + query, { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("ArkOS answered " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
  var data = JSON.parse(response.getContentText());
  if (!data.rows) throw new Error("ArkOS sent no rows; nothing was changed.");
  return data;
}

// Rows 2..n of the tab's first `width` columns are replaced; rows below the new list are cleared in
// those columns only. Never shrinks a list by more than half (a bad answer must not wipe it).
function writeList(sheet, data, showPast) {
  var width = data.width;
  var lastRow = sheet.getLastRow();
  // The column every row of this tab fills (the event, or the name).
  var filled = lastRow > 1 ? sheet.getRange(2, data.keyColumn, lastRow - 1, 1).getValues().filter(function (r) { return r[0] !== ""; }).length : 0;
  if (data.rows.length < filled / 2) throw new Error("ArkOS sent " + data.rows.length + " rows but the tab has " + filled + "; nothing was changed.");
  var count = data.rows.length;
  var past = 0;
  if (count > 0) {
    var values = data.rows.map(function (r) {
      var row = [];
      for (var c = 0; c < width; c++) row.push(r[c] === null || r[c] === undefined ? "" : r[c]);
      // Column B arrives as yyyy-MM-dd: written as a real date, so the sheet shows and sorts it as one.
      var parts = String(row[1]).split("-");
      if (parts.length === 3) {
        if (data.hidePast && data.today && String(row[1]) < data.today) past++;
        row[1] = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return row;
    });
    // Columns that hold words are plain text, so "09171234567" keeps its 0 and "1-2" is not read as a date.
    if (data.plainFrom > 0 && width >= data.plainFrom) sheet.getRange(2, data.plainFrom, count, width - data.plainFrom + 1).setNumberFormat("@");
    sheet.getRange(2, 1, count, width).setValues(values);
  }
  if (lastRow > count + 1) sheet.getRange(count + 2, 1, lastRow - count - 1, width).clearContent();
  // A list of events is oldest first, so the days already past are its first rows.
  var rowsNow = Math.max(lastRow, count + 1);
  if (rowsNow > 1) sheet.showRows(2, rowsNow - 1);
  if (data.hidePast && !showPast && past > 0) sheet.hideRows(2, past);
  sheet.getRange("A1").setNote("Updated from ArkOS: " + new Date().toLocaleString() + " (" + count + " rows)");
}
