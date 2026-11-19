/**
 * Location gates for the API sources (src/sources/base.py). Global boards
 * (company ATS) must positively name Germany / a German city, or be remote
 * without a foreign scope; DE-focused feeds use the lenient chart rule.
 */
import { cityInText, isGermanyOrRemote, pyRegex } from "@tracker/core";

const DE = /(?<![a-z])(germany|deutschland)(?![a-z])/u;
const EXTRA_DE_CITIES = [
  "aachen", "darmstadt", "münster", "muenster", "bochum", "regensburg", "erlangen",
  "jena", "halle", "magdeburg", "kiel", "lübeck", "luebeck", "rostock", "braunschweig",
  "würzburg", "wuerzburg", "heilbronn", "ingolstadt", "chemnitz", "erfurt", "saarbrücken",
  "osnabrück", "bielefeld", "paderborn", "göttingen", "oldenburg", "ludwigsburg",
  "walldorf", "garching", "unterföhring", "eschborn", "gilching", "konstanz",
];
const EXTRA_DE = new RegExp(`(?<![a-zäöüß])(${EXTRA_DE_CITIES.join("|")})(?![a-zäöüß])`, "u");
const REMOTE = pyRegex("\\b(remote|home\\s?office|work from home|wfh)\\b");
const REMOTE_SCOPE_OK = pyRegex("\\b(europe|european|emea|eu|dach|cet|worldwide|anywhere|global)\\b");
const LOCATION_FILLER = new RegExp(
  pyRegex("\\b(remote|home\\s?office|work from home|wfh|first|only|friendly|possible|job|hybrid)\\b|[^a-z]+").source, "gu",
);

export function isGermanyOrRemoteStrict(location: string): boolean {
  const text = (location || "").toLowerCase();
  if (!text.trim()) return true;
  if (DE.test(text) || cityInText(text) || EXTRA_DE.test(text)) return true;
  if (REMOTE.test(text)) {
    if (REMOTE_SCOPE_OK.test(text)) return true;
    return !text.replace(LOCATION_FILLER, "").trim(); // plain "Remote"
  }
  return false;
}

export type LocationPolicy = "strict" | "lenient" | "none";

export function locationOk(location: string, policy: LocationPolicy): boolean {
  if (policy === "none" || !location) return true;
  return policy === "strict" ? isGermanyOrRemoteStrict(location) : isGermanyOrRemote(location);
}
