// Shared address normalization, used by the Worker and the build script.
// "123 Elm Street" and "123 elm st." both become "elm st".

const SUFFIXES = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  way: "way",
  boulevard: "blvd", blvd: "blvd",
  circle: "cir", cir: "cir",
  trail: "trl", trl: "trl",
  highway: "hwy", hwy: "hwy",
};

export function normalizeNumber(n) {
  return String(n || "").trim().replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// Returns { full, base }: full keeps the suffix, base drops it so
// "Sample" still matches "Sample St" when that is unambiguous.
export function normalizeStreet(s) {
  const words = String(s || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length && SUFFIXES[words[words.length - 1]]) {
    words[words.length - 1] = SUFFIXES[words[words.length - 1]];
    return { full: words.join(" "), base: words.slice(0, -1).join(" ") };
  }
  return { full: words.join(" "), base: words.join(" ") };
}
