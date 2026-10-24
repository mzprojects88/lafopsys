// LAF Programs copy sheet: fills the month tabs, "Care Cart" and "Activity Center" of LAF's COPY
// of "LAF Programs 2026" from the LAF app, every hour. It never runs in, or writes to, the original.
//
// SETUP (once, by whoever owns the copy):
//   1. In the copy: Extensions > Apps Script -- or, from a phone, open script.google.com in the
//      browser's desktop mode and make a New project. Delete what is there, paste this whole
//      file, and save.
//   2. Project Settings (gear icon) > Script Properties > Add script property:
//        Property: SHEET_EXPORT_SECRET
//        Value:    the key you were given (never paste it anywhere else)
//      Save script properties.
//   3. Back in the Editor, pick "setup" in the function list and click Run. Google asks for
//      permission: choose your account, Advanced, "Go to (project)", Allow. setup adds the hourly
//      timer and runs once.
//   4. Cell A1 of each tab carries a note with the time of the last update (hover over A1).
//
// What it writes, under the header row only:
//   - Month tabs ("OCT 2026" ...): columns A-N (week, day, date, patient, carer, BN, M-B, M-L,
//     M-D). Columns D, E and L-N are not kept in the app and stay blank; everything from column O
//     on (CAF blocks, WEEKLY formulas) is left alone and recalculates.
//   - Care Cart: columns A-M, one row per dish, as the original.
//   - Activity Center: columns A-N, counts only (participants' and volunteers' names stay blank).
// If the app does not answer, a tab is left as it was and the A1 note says why.

var EXPORT_URL = "https://lafopsys.vercel.app/api/programs/sheet-export";
// The original. This script must never write to it.
var ORIGINAL_ID = "1_kprlQd0xMnYcmjuqU6sg-VT1glC1GBktpSkdm-KMN0";
// LAF's copy: used when the script is its own project (script.google.com, e.g. set up from a phone).
var COPY_ID = "17obn9KG7TxZcgOeJF-_O4C2XJwiW9cSSWlpjpGaGZKM";
var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncCopy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncCopy").timeBased().everyHours(1).create();
  syncCopy();
}

function syncCopy() {
  var book = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(COPY_ID);
  if (book.getId() === ORIGINAL_ID) throw new Error("This is the ORIGINAL LAF Programs sheet. The script only runs in LAF's copy.");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // the previous run is still writing
  try {
    var key = PropertiesService.getScriptProperties().getProperty("SHEET_EXPORT_SECRET");
    if (!key) throw new Error("SHEET_EXPORT_SECRET is not set in Project Settings > Script Properties.");
    var year = new Date().getFullYear();
    var thisMonth = new Date().getMonth(); // 0-11
    var jobs = [];
    for (var m = 0; m <= thisMonth; m++) jobs.push({ tab: MONTHS[m] + " " + year, query: "tab=month&ym=" + year + "-" + ("0" + (m + 1)).slice(-2) });
    jobs.push({ tab: "Care Cart", query: "tab=care-cart&year=" + year });
    jobs.push({ tab: "Activity Center", query: "tab=activity&year=" + year });
    jobs.forEach(function (job) {
      var sheet = findTab(book, job.tab);
      if (!sheet) return; // a month tab not made yet on the copy
      try {
        writeTab(sheet, fetchRows(job.query, key));
      } catch (e) {
        sheet.getRange("A1").setNote("Last update FAILED " + new Date().toLocaleString() + ": " + e.message);
        throw e;
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// Tab names are matched ignoring case and spaces ("SEPT 2026", "Sept 2026", "SEPT2026").
function findTab(book, name) {
  var want = name.replace(/\s+/g, "").toUpperCase();
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().replace(/\s+/g, "").toUpperCase() === want) return sheets[i];
  return null;
}

function fetchRows(query, key) {
  var response = UrlFetchApp.fetch(EXPORT_URL + "?" + query, { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("The LAF app answered " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
  var data = JSON.parse(response.getContentText());
  if (!data.rows) throw new Error("The LAF app sent no rows; nothing was changed.");
  return data;
}

// Rows 2..n of the first `width` columns are replaced; rows below the new data are cleared in those
// columns only. Never shrinks a tab by more than half (a bad answer must not wipe it).
function writeTab(sheet, data) {
  var width = data.width;
  var lastRow = sheet.getLastRow();
  var filled = lastRow > 1 ? sheet.getRange(2, 3, lastRow - 1, 1).getValues().filter(function (r) { return r[0] !== ""; }).length : 0;
  if (data.rows.length < filled / 2) throw new Error("The LAF app sent " + data.rows.length + " rows but the tab has " + filled + " dated rows; nothing was changed.");
  if (data.rows.length > 0) {
    var values = data.rows.map(function (r) {
      var row = [];
      for (var c = 0; c < width; c++) row.push(r[c] === null || r[c] === undefined ? "" : r[c]);
      return row;
    });
    sheet.getRange(2, 1, values.length, width).setValues(values);
  }
  if (lastRow > data.rows.length + 1) sheet.getRange(data.rows.length + 2, 1, lastRow - data.rows.length - 1, width).clearContent();
  sheet.getRange("A1").setNote("Updated from the LAF app: " + new Date().toLocaleString() + " (" + data.rows.length + " rows)");
}
