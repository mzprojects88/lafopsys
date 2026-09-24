/**
 * LAF copy sheet: keeps the "Patients Database" tab of LAF's COPY of the
 * Patients Database in step with the LAF app, every 5 minutes.
 * (Master Plan step 3. It never runs in, or writes to, the original sheet.)
 *
 * SETUP (once, by whoever owns the copy):
 *   1. In the copy: Extensions > Apps Script -- or, from a phone, open
 *      script.google.com in the browser's desktop mode and make a New
 *      project. Delete what is there, paste this whole file, and save.
 *   2. Project Settings (gear icon) > Script Properties > Add script property:
 *        Property: SHEET_EXPORT_SECRET
 *        Value:    the key you were given (never paste it anywhere else)
 *      Save script properties.
 *   3. Back in the Editor, pick "setup" in the function list and click Run.
 *      Google asks for permission: choose your account, Advanced, "Go to
 *      (project)", Allow. setup adds the 5-minute timer and runs once.
 *   4. Look at the Patients Database tab: cell A1 carries a note with the
 *      time of the last update (hover over A1 to read it).
 *
 * What it writes: every column of the tab except AUA and PA (their formulas
 * keep calculating), plus LFCN and LAST UPDATED after CODE. Rows are in CN
 * order; children with no CN yet come last. If the app does not answer, it
 * changes nothing and says why in the A1 note.
 */

var EXPORT_URL = "https://lafopsys.vercel.app/api/patients/sheet-export";
var TAB = "Patients Database";
/** The original. This script must never write to it. */
var ORIGINAL_ID = "16IllEPWoz0oEF0polLIH3BrPQNkNYdcg04RHpyh072s";
/** LAF's copy: used when the script is its own project (script.google.com, e.g. set up from a phone). */
var COPY_ID = "1dNMIw-oOx_tlkJnk5Gmv6GNXPl732pCid8kPl-fpmIM";
var DATE_COLUMNS = ["DE", "BD"];
var TEXT_COLUMNS = ["CP", "LFCN"];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncCopy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncCopy").timeBased().everyMinutes(5).create();
  syncCopy();
}

function syncCopy() {
  // Inside the copy (Extensions > Apps Script) it is the active sheet; as its own project, the copy by id.
  var book = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(COPY_ID);
  if (book.getId() === ORIGINAL_ID) throw new Error("This is the ORIGINAL Patients Database. The script only runs in LAF's copy.");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // the previous run is still writing
  var sheet = book.getSheetByName(TAB);
  if (!sheet) throw new Error('No tab named "' + TAB + '" in this sheet.');
  try {
    var key = PropertiesService.getScriptProperties().getProperty("SHEET_EXPORT_SECRET");
    if (!key) throw new Error("SHEET_EXPORT_SECRET is not set in Project Settings > Script Properties.");
    var response = UrlFetchApp.fetch(EXPORT_URL, { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error("The LAF app answered " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
    var data = JSON.parse(response.getContentText());
    var rows = data.rows;
    if (!rows || rows.length === 0) throw new Error("The LAF app sent no rows; nothing was changed.");

    // Guard against wiping the tab on a bad answer: never shrink it by more than half.
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
      return String(h).trim().toUpperCase();
    });
    var cnCol = header.indexOf("CN") + 1;
    if (cnCol === 0) throw new Error("The tab has no CN column in row 1.");
    var lastRow = sheet.getLastRow();
    var filled = lastRow > 1 ? sheet.getRange(2, cnCol, lastRow - 1, 1).getValues().filter(function (r) { return r[0] !== ""; }).length : 0;
    if (rows.length < filled / 2) throw new Error("The LAF app sent " + rows.length + " rows but the tab has " + filled + "; nothing was changed.");

    data.header.forEach(function (name, i) {
      if (data.skip.indexOf(name) >= 0) return; // AUA, PA: the copy's own formulas
      var col = header.indexOf(name) + 1;
      if (col === 0) {
        // LFCN and LAST UPDATED: added once, after the last heading.
        col = header.length + 1;
        header.push(name);
        sheet.getRange(1, col).setValue(name);
      }
      var values = rows.map(function (r) {
        var v = r[i];
        if (v === null || v === undefined) return [""];
        if (DATE_COLUMNS.indexOf(name) >= 0) return [toDate(v)];
        return [v];
      });
      var range = sheet.getRange(2, col, rows.length, 1);
      if (TEXT_COLUMNS.indexOf(name) >= 0) range.setNumberFormat("@"); // keep phones' leading 0
      range.setValues(values);
      if (lastRow > rows.length + 1) sheet.getRange(rows.length + 2, col, lastRow - rows.length - 1, 1).clearContent();
    });

    sheet.getRange("A1").setNote("Updated from the LAF app: " + new Date().toLocaleString() + " (" + rows.length + " children)");
  } catch (e) {
    sheet.getRange("A1").setNote("Last update FAILED " + new Date().toLocaleString() + ": " + e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** "6/27/2024" or "6/27/24" -> a real date, so the age formulas keep working; anything else stays as typed. */
function toDate(v) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(v));
  if (!m) return v;
  var year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(year, Number(m[1]) - 1, Number(m[2]));
}
