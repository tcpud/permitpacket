/**
 * Mark Application Provided
 *
 * Called by the Tahoe Cedars permit packet flow after the packet is emailed
 * to a customer. Finds the row by APN (column A), then:
 *   - If Application Provided Date is empty, fills it and Application Version.
 *   - Adds "Packet emailed to <email> on <date>" to NOTES, unless that email
 *     is already mentioned there.
 * Nothing else on the sheet is changed. Works without an Excel table.
 *
 * Returns one of:
 *   "updated"          date and version were filled in (first request)
 *   "already_set"      row already had a date; only NOTES may have changed
 *   "not_found"        APN isn't on the sheet
 *   "duplicate"        APN appears more than once; nothing changed
 *   "no_columns"       couldn't find the column headers
 *   "sheet_not_found"  the sheetName doesn't match a tab
 */
function main(
  workbook: ExcelScript.Workbook,
  apn: string,
  providedDate: string, // yyyy-MM-dd
  appVersion: string,
  sheetName: string,
  customerEmail: string
): string {
  const sheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.getWorksheets()[0];
  if (!sheet) return "sheet_not_found";

  const used = sheet.getUsedRange();
  const values = used.getValues();
  const startRow = used.getRowIndex();
  const startCol = used.getColumnIndex();

  // Find the header row (the one with "APN" in the first column) and the
  // target columns, which may be labeled in either of the top header rows.
  const norm = (v: string | number | boolean) => String(v).trim().toLowerCase();
  let headerRow = -1;
  let dateCol = -1;
  let versionCol = -1;
  let notesCol = -1;
  for (let r = 0; r < Math.min(5, values.length); r++) {
    if (norm(values[r][0]) === "apn") headerRow = r;
    for (let c = 0; c < values[r].length; c++) {
      const h = norm(values[r][c]);
      if (h === "application provided date" && dateCol < 0) dateCol = c;
      if (h === "application version" && versionCol < 0) versionCol = c;
      if (h === "notes" && notesCol < 0) notesCol = c;
    }
  }
  if (headerRow < 0 || dateCol < 0 || versionCol < 0) return "no_columns";

  // Find the APN row.
  const target = apn.trim();
  const matches: number[] = [];
  for (let r = headerRow + 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === target) matches.push(r);
  }
  if (matches.length === 0) return "not_found";
  if (matches.length > 1) return "duplicate";
  const r = matches[0];

  const [y, m, d] = providedDate.split("-").map(Number);

  // NOTES: record who the packet went to, once per email address.
  const email = (customerEmail || "").trim();
  if (notesCol >= 0 && email) {
    const current = String(values[r][notesCol]).trim();
    if (current.toLowerCase().indexOf(email.toLowerCase()) < 0) {
      const entry = `Packet emailed to ${email} on ${m}/${d}/${y}`;
      sheet
        .getCell(startRow + r, startCol + notesCol)
        .setValue(current ? `${current}; ${entry}` : entry);
    }
  }

  if (String(values[r][dateCol]).trim() !== "") return "already_set";

  // Write the date as a real Excel date (not text) so it sorts and filters.
  const serial = Date.UTC(y, m - 1, d) / 86400000 + 25569;
  const dateCell = sheet.getCell(startRow + r, startCol + dateCol);
  dateCell.setNumberFormatLocal("m/d/yyyy");
  dateCell.setValue(serial);

  sheet.getCell(startRow + r, startCol + versionCol).setValue(appVersion);
  return "updated";
}
