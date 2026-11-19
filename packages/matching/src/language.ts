/**
 * English-only gate for job descriptions. Port of src/core/language.py,
 * on the same Lingua engine (@prospectbase/lingua wraps the Rust crate the
 * Python package wraps), limited to the same four languages.
 *
 * A JD counts as German when more than 20 % of its sentences (by length)
 * are German, so a few German UI lines on an English Indeed page do not
 * flip it. Too-short text is not judged (fails open).
 */
import { createRequire } from "node:module";
import { PY_WS, pyLen, pyStrip } from "./py.js";
import { stripHtml } from "./text.js";

// A native addon: loaded with require so bundlers leave it alone
const require = createRequire(import.meta.url);

const MIN_LANG_CHARS = 40; // too little text to classify (failed / empty detail panels)
const MIN_CHUNK_CHARS = 12; // ignore fragments like "Berlin" or "3.8"
export const GERMAN_SHARE_THRESHOLD = 0.2;
const SENTENCE_SPLIT = new RegExp(`(?<=[.!?])[${PY_WS}]+|\\n+`);

interface Detector { detect(text: string): { language: string | null } }
let detector: Detector | null = null;

/** Built once; Lingua loads the four language models on first use. */
function getDetector(): Detector {
  if (!detector) {
    const { LanguageDetector } = require("@prospectbase/lingua") as {
      LanguageDetector: new (languages: string[]) => Detector;
    };
    detector = new LanguageDetector(["en", "de", "fr", "nl"]);
  }
  return detector;
}

/** Share of the classified text (by length) that Lingua labels German, 0..1. */
export function germanContentShare(text: string): number {
  const plain = stripHtml(text);
  if (pyLen(plain) < MIN_LANG_CHARS) return 0;
  const chunks = plain.split(SENTENCE_SPLIT).map(pyStrip).filter((c) => pyLen(c) >= MIN_CHUNK_CHARS);
  if (!chunks.length) return 0;
  const d = getDetector();
  let german = 0;
  let total = 0;
  for (const chunk of chunks) {
    const n = pyLen(chunk);
    total += n;
    if (d.detect(chunk).language === "de") german += n;
  }
  return total ? german / total : 0;
}

/** [ISO 639-1 code or null, German share]. */
export function detectJobDetailLanguage(text: string): [string | null, number] {
  const plain = stripHtml(text);
  if (pyLen(plain) < MIN_LANG_CHARS) return [null, 0];
  const share = germanContentShare(plain);
  if (share > GERMAN_SHARE_THRESHOLD) return ["de", share];
  return [getDetector().detect(plain).language, share];
}

/** [skip, lang, germanShare]: skip when the JD is confidently not English. */
export function isNonEnglishJobDetail(text: string): [boolean, string | null, number] {
  const [lang, share] = detectJobDetailLanguage(text);
  return [lang !== null && lang !== "en", lang, share];
}
