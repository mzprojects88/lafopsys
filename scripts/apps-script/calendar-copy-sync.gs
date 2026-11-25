// LAF Master Calendar copy sheet: fills the yearly lists of events ("2026", "2027", ...) in LAF's
// COPY of "LAF Master Calendar" from ArkOS, every 5 minutes. ArkOS is the master calendar: events
// are added and changed there. It never runs in, or writes to, the original sheet.
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
//   5. Cell A1 of each year's tab carries a note with the time of the last update (hover over A1).
//
// What it writes: every tab whose name is a year ("2026", "2027"), under the header row only, in
// columns A to J: weekday, date, time, event, venue, off staff, staff needed, booked by, contact,
// remarks. For a new year, copy a year's tab and name it with the year: it fills by itself.
// Every row carries its own weekday and date, so the list can be filtered and sorted.
// Days already past are hidden, as in the original; to keep them shown, add the script property
// SHOW_PAST with the value yes.
// Anything typed into those columns is replaced at the next update: change events in ArkOS.
// The other tabs are not touched. If ArkOS does not answer, a tab is left as it was and its A1
// note says why.

var EXPORT_URL = "https://lafopsys.vercel.app/api/calendar/sheet-export";
// The original. This script must never write to it.
var ORIGINAL_ID = "1krxg8BjkZgd0kSHlwm3w25Nq40MMW5DIzJC6gtgj5_g";

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
    var tabs = book.getSheets().filter(function (s) { return /^20\d\d$/.test(s.getName().replace(/\s+/g, "")); });
    if (tabs.length === 0) throw new Error("No tab named with a year (2026, 2027) was found in this copy.");
    tabs.forEach(function (sheet) {
      try {
        writeList(sheet, fetchRows(sheet.getName().replace(/\s+/g, ""), key), showPast);
      } catch (e) {
        sheet.getRange("A1").setNote("Last update FAILED " + new Date().toLocaleString() + ": " + e.message);
        throw e;
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function fetchRows(year, key) {
  var response = UrlFetchApp.fetch(EXPORT_URL + "?year=" + year, { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("ArkOS answered " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
  var data = JSON.parse(response.getContentText());
  if (!data.rows) throw new Error("ArkOS sent no rows; nothing was changed.");
  return data;
}

// Rows 2..n of columns A-J are replaced; rows below the new list are cleared in those columns only.
// Never shrinks a list by more than half (a bad answer must not wipe it).
function writeList(sheet, data, showPast) {
  var width = data.width;
  var lastRow = sheet.getLastRow();
  // Column D is the event: every row of the list has one.
  var filled = lastRow > 1 ? sheet.getRange(2, 4, lastRow - 1, 1).getValues().filter(function (r) { return r[0] !== ""; }).length : 0;
  if (data.rows.length < filled / 2) throw new Error("ArkOS sent " + data.rows.length + " events but the list has " + filled + "; nothing was changed.");
  var count = data.rows.length;
  var past = 0;
  if (count > 0) {
    var values = data.rows.map(function (r) {
      var row = [];
      for (var c = 0; c < width; c++) row.push(r[c] === null || r[c] === undefined ? "" : r[c]);
      // Column B arrives as yyyy-MM-dd: written as a real date, so the sheet shows and sorts it as one.
      var parts = String(row[1]).split("-");
      if (parts.length === 3) {
        if (data.today && String(row[1]) < data.today) past++;
        row[1] = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return row;
    });
    // Columns C to J hold words: plain text, so "09171234567" keeps its 0 and "1-2" is not read as a date.
    sheet.getRange(2, 3, count, width - 2).setNumberFormat("@");
    sheet.getRange(2, 1, count, width).setValues(values);
  }
  if (lastRow > count + 1) sheet.getRange(count + 2, 1, lastRow - count - 1, width).clearContent();
  // The list is oldest first, so the days already past are the first rows.
  var rowsNow = Math.max(lastRow, count + 1);
  if (rowsNow > 1) sheet.showRows(2, rowsNow - 1);
  if (!showPast && past > 0) sheet.hideRows(2, past);
  sheet.getRange("A1").setNote("Updated from ArkOS: " + new Date().toLocaleString() + " (" + count + " events)");
}
