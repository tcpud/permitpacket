// Builds src/parcels.json from data/parcels.csv.
// Usage: node scripts/build-parcels.mjs [path/to/parcels.csv]
//
// CSV columns (header row required): APN, StreetNumber, StreetName, MapFile
// Each parcel gets a random download ID. IDs are kept for APNs that were
// already in parcels.json, so rebuilding doesn't break links mid-session.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { normalizeNumber, normalizeStreet } from "../src/normalize.js";

const csvPath = process.argv[2] || "data/parcels.csv";
const outPath = "src/parcels.json";

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q && c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = !q;
      else if (c === "," && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((s) => s.trim()));
  }
  return rows;
}

const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
const col = (name) => {
  const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`Missing column "${name}" in ${csvPath}`);
  return i;
};
const iApn = col("APN"), iNum = col("StreetNumber"), iName = col("StreetName"), iMap = col("MapFile");

const oldIds = {};
if (existsSync(outPath)) {
  for (const p of JSON.parse(readFileSync(outPath, "utf8"))) oldIds[p.apn] = p.id;
}

const seen = new Set();
const parcels = rows.map((r, n) => {
  const apn = r[iApn];
  if (!apn || !r[iNum] || !r[iName] || !r[iMap]) throw new Error(`Row ${n + 2} is missing a value`);
  if (seen.has(apn)) throw new Error(`Duplicate APN ${apn} on row ${n + 2}`);
  seen.add(apn);
  const street = normalizeStreet(r[iName]);
  return {
    id: oldIds[apn] || randomBytes(9).toString("base64url"),
    apn,
    address: `${r[iNum]} ${r[iName]}`,
    number: normalizeNumber(r[iNum]),
    street: street.full,
    streetBase: street.base,
    mapFile: r[iMap],
  };
});

writeFileSync(outPath, JSON.stringify(parcels, null, 2) + "\n");
console.log(`Wrote ${parcels.length} parcels to ${outPath}`);
