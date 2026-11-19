/**
 * Tracker country for a job. Port of src/core/country.py: the stored
 * `country` field first, then the first pattern matching the free-text
 * location, then Germany (the scrapers search Germany).
 */
import { pyRegex } from "./pyregex.js";

export const REMOTE = "remote";
export const OTHER = "other";
export const DEFAULT_COUNTRY = "germany";

// (key, label, pattern) checked in order; copied from country.py.
const RAW: [string, string, string][] = [
  ["germany", "Germany",
    "germany|deutschland|\\bberlin\\b|munich|m[uü]nchen|hamburg|frankfurt"
    + "|cologne|k[oö]ln|stuttgart|d[uü]sseldorf|leipzig|dresden|hannover|hanover"
    + "|nuremberg|n[uü]rnberg|\\bbonn\\b|karlsruhe|mannheim|heidelberg|freiburg"
    + "|m[uü]nster|aachen|bremen|potsdam|erlangen|darmstadt|wiesbaden|mainz"
    + "|augsburg|regensburg|dortmund|\\bessen\\b|bochum|duisburg|bielefeld|\\bkiel\\b|rostock"],
  ["netherlands", "Netherlands",
    "netherlands|nederland|holland|amsterdam|rotterdam|utrecht"
    + "|eindhoven|the hague|den haag|delft|leiden|groningen|geleen"
    + "|haarlem|amstelveen|hoofddorp|almere|tilburg|breda|nijmegen"
    + "|arnhem|maastricht|zwolle|enschede"],
  ["austria", "Austria", "austria|österreich|osterreich|\\bvienna\\b|\\bwien\\b|\\bgraz\\b|salzburg|innsbruck"],
  ["switzerland", "Switzerland",
    "switzerland|schweiz|suisse|z[uü]rich|geneva|gen[eè]ve|\\bbasel\\b|\\bbern\\b|lausanne|\\bzug\\b|lugano"],
  ["france", "France", "france|\\bparis\\b|\\blyon\\b|toulouse|marseille|bordeaux|\\blille\\b|nantes"],
  ["belgium", "Belgium", "belgium|belgi[eë]|belgique|brussels|bruxelles|brussel|antwerp|antwerpen|\\bghent\\b|\\bgent\\b|leuven"],
  ["luxembourg", "Luxembourg", "luxembourg|luxemburg"],
  ["spain", "Spain", "spain|españa|espana|madrid|barcelona|valencia|m[aá]laga|seville|sevilla|bilbao"],
  ["portugal", "Portugal", "portugal|lisbon|lisboa|\\bporto\\b|braga"],
  ["italy", "Italy", "italy|italia|\\bmilan\\b|milano|\\brome\\b|\\broma\\b|turin|torino|bologna"],
  ["uk", "United Kingdom",
    "united kingdom|\\bu\\.?k\\.?\\b|great britain|england|scotland|wales|london"
    + "|manchester|edinburgh|glasgow|bristol|cambridge|oxford|leeds|birmingham"],
  ["ireland", "Ireland", "ireland|dublin|\\bcork\\b|galway"],
  ["denmark", "Denmark", "denmark|danmark|copenhagen|københavn|kobenhavn|aarhus"],
  ["sweden", "Sweden", "sweden|sverige|stockholm|gothenburg|göteborg|goteborg|malmö|malmo|\\blund\\b|uppsala"],
  ["norway", "Norway", "norway|norge|\\boslo\\b|bergen|trondheim|stavanger"],
  ["finland", "Finland", "finland|suomi|helsinki|espoo|tampere|\\boulu\\b|turku|vantaa"],
  ["iceland", "Iceland", "iceland|reykjav[ií]k"],
  ["estonia", "Estonia", "estonia|eesti|tallinn|tartu"],
  ["latvia", "Latvia", "latvia|\\briga\\b"],
  ["lithuania", "Lithuania", "lithuania|vilnius|kaunas"],
  ["poland", "Poland", "poland|polska|warsaw|warszawa|krak[oó]w|cracow|wroc[lł]aw|gda[nń]sk|pozna[nń]|\\b[lł][oó]d[zź]\\b"],
  ["czechia", "Czechia", "czech|česko|prague|praha|\\bbrno\\b"],
  ["slovakia", "Slovakia", "slovakia|bratislava"],
  ["hungary", "Hungary", "hungary|budapest"],
  ["romania", "Romania", "romania|bucharest|bucure[sș]ti|cluj"],
  ["bulgaria", "Bulgaria", "bulgaria|sofia"],
  ["greece", "Greece", "greece|athens|thessaloniki"],
  ["croatia", "Croatia", "croatia|zagreb"],
  ["slovenia", "Slovenia", "slovenia|ljubljana"],
  ["serbia", "Serbia", "serbia|belgrade|novi sad"],
  ["malta", "Malta", "malta|valletta"],
  ["cyprus", "Cyprus", "cyprus|limassol|nicosia"],
  [OTHER, "Outside Europe",
    "united states|\\busa?\\b|canada|toronto|vancouver|new york|san francisco"
    + "|india|bangalore|singapore|australia|sydney|brazil|mexico|israel|tel aviv"
    + "|dubai|\\buae\\b|japan|tokyo|china|hong kong|south africa|argentina|turkey|istanbul"],
  [REMOTE, "Remote",
    "^\\s*(fully\\s+)?(remote|worldwide|global|anywhere|european union"
    + "|european economic area|emea|europe|eu)\\b"],
];

export const COUNTRIES = RAW.map(([key, label, pattern]) => ({ key, label, re: pyRegex(pattern, true) }));
export const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.key, c.label]));

export function countryFromLocation(location: unknown): string | null {
  const text = String(location ?? "");
  if (!text.trim()) return null;
  return COUNTRIES.find((c) => c.re.test(text))?.key ?? null;
}

/** Stored field first, then location, then Germany. */
export function jobCountry(location: unknown, stored?: unknown): string {
  const key = String(stored ?? "").trim().toLowerCase();
  if (key in COUNTRY_LABELS) return key;
  return countryFromLocation(location) ?? DEFAULT_COUNTRY;
}

const EUROPE_EXCEPT_GERMANY = Object.keys(COUNTRY_LABELS).filter(
  (k) => k !== DEFAULT_COUNTRY && k !== REMOTE && k !== OTHER,
);
const FILTER_GROUPS: Record<string, string[]> = {
  germany: [DEFAULT_COUNTRY],
  europe: EUROPE_EXCEPT_GERMANY,
  remote: [REMOTE],
};

/** Countries a Tracker filter value covers; null = no filter ("all" / unknown). */
export function countryFilterKeys(group: string | null | undefined): string[] | null {
  if (!group) return null;
  if (group in FILTER_GROUPS) return FILTER_GROUPS[group]!;
  if (group in COUNTRY_LABELS) return [group];
  return null;
}
