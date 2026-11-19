/** Port of src/core/text.py strip_html: raw HTML to readable plain text. */
import { decodeHTML } from "entities";
import { pySplitLines, pyStrip } from "./py.js";

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  let text = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<(br|p|li|h[1-6]|div|tr)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeHTML(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  const lines = pySplitLines(text).map(pyStrip);
  return pyStrip(lines.filter(Boolean).join("\n"));
}
