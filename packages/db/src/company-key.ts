/**
 * Port of matching/evaluator.py company_key(): the cache key of
 * company_profiles. Must give the same output as the Python version
 * (test/company-key.test.ts pins examples taken from it).
 *
 * Python's \b is Unicode-aware and JavaScript's is not, so the word
 * boundaries are written as Unicode lookarounds.
 */
const LEGAL_SUFFIX =
  /(?<![\p{L}\p{N}_])(gmbh|ag|se|kg|ug|inc|ltd|llc|co|group|holding|& co)(?![\p{L}\p{N}_])\.?/gu;

export function companyKey(name: string | null | undefined): string {
  const text = (name ?? "").toLowerCase().replace(LEGAL_SUFFIX, " ");
  return text.replace(/[^a-z0-9äöüß]+/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
}
