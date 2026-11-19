/**
 * The parts of Python's urllib.parse that job ids depend on.
 *
 * Non-LinkedIn/Indeed job ids are sha1(canonical URL), and posting keys are
 * built from the parsed query, so the TypeScript port has to split, decode
 * and encode URLs exactly like Python does. The WHATWG URL class cannot be
 * used here: it rewrites paths (percent-encoding, "..", default ports) and
 * would produce different ids for the same posting.
 */

export interface SplitUrl {
  scheme: string;
  netloc: string;
  path: string;
  params: string;
  query: string;
  fragment: string;
}

const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+\-.]*$/;

/** urllib.parse.urlparse (with the default allow_fragments=True). */
export function urlparse(url: string): SplitUrl {
  // Python 3.12: lstrip C0 controls / space, drop tabs and newlines anywhere
  let rest = url.replace(/^[\u0000-\u0020]+/, "").replace(/[\t\r\n]/g, "");
  let scheme = "";
  const colon = rest.indexOf(":");
  if (colon > 0 && SCHEME_CHARS.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }
  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    netloc = end === -1 ? rest.slice(2) : rest.slice(2, 2 + end);
    rest = end === -1 ? "" : rest.slice(2 + end);
  }
  let fragment = "";
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  let query = "";
  const q = rest.indexOf("?");
  if (q !== -1) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }
  // _splitparams: ";params" on the last path segment only
  let path = rest;
  let params = "";
  const lastSlash = path.lastIndexOf("/");
  const semi = lastSlash === -1 ? path.indexOf(";") : path.indexOf(";", lastSlash);
  if (semi !== -1) {
    params = path.slice(semi + 1);
    path = path.slice(0, semi);
  }
  return { scheme, netloc, path, params, query, fragment };
}

/** ParseResult.hostname: no userinfo, no port, lower-cased; None -> "". */
export function hostnameOf(netloc: string): string {
  let host = netloc.slice(netloc.lastIndexOf("@") + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host.slice(1) : host.slice(1, end);
  } else {
    const colon = host.indexOf(":");
    if (colon !== -1) host = host.slice(0, colon);
  }
  return host.toLowerCase();
}

const USES_NETLOC = new Set([
  "", "ftp", "http", "gopher", "nntp", "telnet", "imap", "wais", "file", "mms", "https", "shttp",
  "snews", "prospero", "rtsp", "rtsps", "rtspu", "rsync", "svn", "svn+ssh", "sftp", "nfs", "git",
  "git+ssh", "ws", "wss", "itms-services",
]);

/** urllib.parse.urlunparse (Python 3.12 urlunsplit rules) */
export function urlunparse(p: SplitUrl): string {
  let url = p.params ? `${p.path};${p.params}` : p.path;
  if (p.netloc) {
    if (url && !url.startsWith("/")) url = `/${url}`;
    url = `//${p.netloc}${url}`;
  } else if (url.startsWith("//")) {
    url = `//${url}`;
  } else if (p.scheme && USES_NETLOC.has(p.scheme) && (!url || url.startsWith("/"))) {
    url = `//${url}`;
  }
  if (p.scheme) url = `${p.scheme}:${url}`;
  if (p.query) url = `${url}?${p.query}`;
  if (p.fragment) url = `${url}#${p.fragment}`;
  return url;
}

/** urllib.parse.unquote (UTF-8, errors="replace"). */
export function unquote(text: string): string {
  if (!text.includes("%")) return text;
  return text.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Uint8Array.from(run.match(/%[0-9A-Fa-f]{2}/g)!.map((h) => Number.parseInt(h.slice(1), 16)));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  });
}

/** urllib.parse.parse_qsl(query, keep_blank_values=False) */
export function parseQsl(query: string): [string, string][] {
  const out: [string, string][] = [];
  if (!query) return out;
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue; // no "=" and blanks not kept
    const value = part.slice(eq + 1);
    if (!value.length) continue;
    const decode = (s: string) => unquote(s.replace(/\+/g, " "));
    out.push([decode(part.slice(0, eq)), decode(value)]);
  }
  return out;
}

const SAFE = /[A-Za-z0-9_.\-~]/;

/** urllib.parse.quote_plus (safe="") */
export function quotePlus(text: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    const ch = String.fromCharCode(byte);
    if (byte < 0x80 && SAFE.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** urllib.parse.urlencode(list of pairs) */
export function urlencode(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join("&");
}

/** urllib.parse.urljoin for the redirect cases we meet (absolute or root-relative Location). */
export function urljoin(base: string, location: string): string {
  if (/^[A-Za-z][A-Za-z0-9+\-.]*:/.test(location)) return location;
  const b = urlparse(base);
  if (location.startsWith("//")) return `${b.scheme}:${location}`;
  if (location.startsWith("/")) return `${b.scheme}://${b.netloc}${location}`;
  const dir = b.path.slice(0, b.path.lastIndexOf("/") + 1);
  return `${b.scheme}://${b.netloc}${dir}${location}`;
}
