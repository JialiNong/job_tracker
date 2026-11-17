/* Pure HTML helpers shared by every page: escape text for innerHTML and
   keep untrusted links on http(s). No DOM access, no side effects. */

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Job links come from scrapers, third-party APIs, and agents: only let
    http(s) or same-site paths reach an href, so a stored `javascript:` link
    cannot run in this page. Returns the fallback for anything else. */
export function safeUrl(raw, fallback = '#') {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : fallback;
  } catch (_) {
    return fallback;
  }
}
