/**
 * Python regexes in JavaScript. Python's \b counts any Unicode letter or
 * digit as a word character; JavaScript's only ASCII. Each \b becomes its
 * exact definition with Unicode word characters: a position where exactly
 * one side is a word character. Compiled with the "u" flag, "Reactä" or
 * "łódź" then behave as in the Python code the patterns were copied from.
 */
const W = "[\\p{L}\\p{N}_]";
const BOUNDARY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

export function unicodeBoundaries(pattern: string): string {
  // Only a real \b (an even number of backslashes before it is an escaped backslash)
  return pattern.replace(/(?<!\\)((?:\\\\)*)\\b/g, (_m, slashes: string) => `${slashes}${BOUNDARY}`);
}

/** re.compile(pattern, flags) with re.IGNORECASE as `ignoreCase`. */
export function pyRegex(pattern: string, ignoreCase = false): RegExp {
  return new RegExp(unicodeBoundaries(pattern), ignoreCase ? "iu" : "u");
}
