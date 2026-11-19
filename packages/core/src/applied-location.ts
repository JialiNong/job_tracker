/**
 * The "Where you applied" bubble name for a job location, and whether it
 * belongs on the Germany + Remote chart. Port of src/core/applied_location.py;
 * checked against Python answers in rule_cases.json.
 */
import { pyRegex } from "./pyregex.js";

const SEGMENT_RE = pyRegex("[,|/•·]|\\bor\\b", true);
const LOC_MODE_RE = /\s*[([]\s*(remote|hybrid|on[\s-]?site|hybrides?\s+arbeiten)\s*[)\]]\s*$/iu;
const NEAR_PLACE_RE = /^\s*(.+?)\s+near\s+\S+/iu;

const COUNTRY_ONLY = new Set([
  "germany", "deutschland", "de", "eu", "europe", "european union", "european union (remote)",
  "european economic area", "eea", "dach", "emea",
]);
const REGION_ONLY = new Set([
  "bavaria", "bayern", "saxony", "sachsen", "hesse", "hessen", "lower saxony", "niedersachsen",
  "baden-württemberg", "baden-wuerttemberg", "baden württemberg", "north rhine-westphalia",
  "nordrhein-westfalen", "nrw", "rhineland-palatinate", "rheinland-pfalz", "schleswig-holstein",
  "mecklenburg-vorpommern", "brandenburg", "thuringia", "thüringen", "thueringen", "saarland",
  "uk", "ireland", "united kingdom",
]);
const CITY_CANON: Record<string, string> = {
  berlin: "Berlin", "berlin-kreuzberg": "Berlin", kreuzberg: "Berlin",
  munich: "Munich", muenchen: "Munich", "münchen": "Munich",
  hamburg: "Hamburg", leipzig: "Leipzig",
  cologne: "Cologne", "köln": "Cologne", koeln: "Cologne",
  frankfurt: "Frankfurt", "frankfurt am main": "Frankfurt",
  stuttgart: "Stuttgart", dresden: "Dresden",
  nuremberg: "Nuremberg", "nürnberg": "Nuremberg", nuernberg: "Nuremberg",
  hannover: "Hannover", hanover: "Hannover", dortmund: "Dortmund", augsburg: "Augsburg",
  freiburg: "Freiburg", ravensburg: "Ravensburg", kronberg: "Kronberg",
  "böblingen": "Böblingen", boeblingen: "Böblingen", "neu-ulm": "Neu-Ulm", ulm: "Ulm",
  mannheim: "Mannheim", karlsruhe: "Karlsruhe", heidelberg: "Heidelberg", bonn: "Bonn",
  "düsseldorf": "Düsseldorf", duesseldorf: "Düsseldorf", dusseldorf: "Düsseldorf",
  essen: "Essen", bremen: "Bremen", potsdam: "Potsdam", wiesbaden: "Wiesbaden", mainz: "Mainz",
  kassel: "Kassel", wuppertal: "Wuppertal",
};
// Longer aliases first so "berlin-kreuzberg" wins over "berlin" (stable sort, like Python's)
const CITY_ALIASES_BY_LEN = Object.entries(CITY_CANON).sort((a, b) => b[0].length - a[0].length);
const GERMAN_CITY_NAMES = new Set(Object.values(CITY_CANON));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_WORD_BEHIND = "(?<![a-z0-9äöüß])";
const NOT_WORD_AHEAD = "(?![a-z0-9äöüß])";

const FOREIGN_MARKERS = [
  "netherlands", "the netherlands", "holland", "amsterdam", "rotterdam", "the hague", "den haag",
  "utrecht", "eindhoven", "geleen", "delft", "sweden", "stockholm", "gothenburg", "malmö", "malmo",
  "united kingdom", "uk", "england", "scotland", "london", "manchester", "edinburgh", "cambridge",
  "oxford", "ireland", "dublin", "cork", "france", "paris", "lyon", "spain", "madrid", "barcelona",
  "valencia", "portugal", "lisbon", "porto", "italy", "milan", "rome", "austria", "vienna", "wien",
  "graz", "switzerland", "zurich", "zürich", "geneva", "basel", "lausanne", "belgium", "brussels",
  "antwerp", "luxembourg", "denmark", "copenhagen", "norway", "oslo", "finland", "helsinki",
  "poland", "warsaw", "krakow", "kraków", "wroclaw", "wrocław", "czech republic", "czechia",
  "prague", "hungary", "budapest", "romania", "bucharest", "estonia", "tallinn", "lithuania",
  "vilnius", "latvia", "riga", "greece", "athens", "croatia", "zagreb", "united states", "usa",
  "us", "new york", "san francisco", "canada", "toronto", "india", "bangalore", "singapore",
  "dubai", "israel", "tel aviv",
];
const FOREIGN_RE = new RegExp(
  `${NOT_WORD_BEHIND}(?:${[...FOREIGN_MARKERS].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})${NOT_WORD_AHEAD}`,
);

/** Python str.capitalize(): first character upper, the rest lower. */
const capitalize = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w);

/** Title-case a free-form place, keeping hyphenated parts. */
function titlePlace(name: string): string {
  return name.trim().split("-").map((chunk) => chunk.split(" ").map(capitalize).join(" ")).join("-");
}

const isCountryOrRegion = (token: string) => COUNTRY_ONLY.has(token) || REGION_ONLY.has(token);

function cityInText(textLower: string): string | null {
  for (const [alias, canon] of CITY_ALIASES_BY_LEN) {
    if (new RegExp(`${NOT_WORD_BEHIND}${escapeRe(alias)}${NOT_WORD_AHEAD}`).test(textLower)) return canon;
  }
  return null;
}

/** Python str.strip(chars) for the characters " ,;-|". */
const stripPunct = (s: string) => s.replace(/^[ ,;\-|]+|[ ,;\-|]+$/g, "");
const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

export function normalizeAppliedLocation(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "Remote";
  const lower = text.toLowerCase().trim();
  if (["remote", "homeoffice", "home office", "fully remote", "100% remote"].includes(lower)) return "Remote";
  if (lower.startsWith("remote ") || lower.startsWith("remote-") || lower.startsWith("remote/")) return "Remote";

  const cleaned = stripPunct(text.replace(LOC_MODE_RE, "").trim());
  const cleanedLower = cleaned.toLowerCase();
  if (!cleanedLower || COUNTRY_ONLY.has(cleanedLower)) return "Remote";

  // "Greater Munich Metropolitan Area", "Frankfurt Rhine-Main…"
  const metro: [string, string][] = [
    ["munich", "Munich"], ["münchen", "Munich"], ["muenchen", "Munich"], ["frankfurt", "Frankfurt"],
    ["berlin", "Berlin"], ["hamburg", "Hamburg"], ["leipzig", "Leipzig"], ["cologne", "Cologne"],
    ["köln", "Cologne"], ["stuttgart", "Stuttgart"],
  ];
  for (const [key, canon] of metro) {
    if (cleanedLower.includes(key) && ["metropolitan", "greater", "rhine", "area"].some((w) => cleanedLower.includes(w))) {
      return canon;
    }
  }

  // "Pullach near Munich" -> Pullach
  const near = NEAR_PLACE_RE.exec(cleaned);
  if (near) {
    const specific = collapse(near[1]!);
    const specificLower = specific.toLowerCase();
    if (CITY_CANON[specificLower]) return CITY_CANON[specificLower]!;
    if (specificLower && !isCountryOrRegion(specificLower)) return titlePlace(specific);
  }

  // First known city across comma / slash / "or" segments (street + postcode lines too)
  const segments = cleaned.split(SEGMENT_RE);
  for (const seg of segments) {
    const token = collapse(seg.toLowerCase());
    if (!token || isCountryOrRegion(token)) continue;
    if (CITY_CANON[token]) return CITY_CANON[token]!;
    const hit = cityInText(token);
    if (hit) return hit;
    const prefix = CITY_ALIASES_BY_LEN.find(([alias]) => token.startsWith(`${alias} `) || token.startsWith(`${alias}-`));
    if (prefix) return prefix[1];
  }

  if (/(?<![a-z0-9])remote(?![a-z0-9])/.test(cleanedLower)) return "Remote";

  // A named place without a known-city alias is its own bubble
  for (const seg of segments) {
    const token = collapse(seg);
    if (!token || isCountryOrRegion(token.toLowerCase())) continue;
    if (/^[\p{L}\p{N}_.\-äöüÄÖÜß]+\s+\d+[a-zA-Z]?$/u.test(token)) continue; // a street line
    return titlePlace(token);
  }
  return "Remote";
}

/** Germany + Remote chart only: a German city, a posting that names Germany, or no foreign marker. */
export function isGermanyOrRemote(raw: string | null | undefined, normalized?: string): boolean {
  const name = normalized ?? normalizeAppliedLocation(raw);
  if (GERMAN_CITY_NAMES.has(name)) return true;
  const text = (raw ?? "").toLowerCase();
  if (/(?<![a-z])(germany|deutschland)(?![a-z])/.test(text)) return true;
  return !FOREIGN_RE.test(text);
}
