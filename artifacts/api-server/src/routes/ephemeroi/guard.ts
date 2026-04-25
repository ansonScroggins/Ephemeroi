import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Reject server-side requests aimed at internal/private addresses so that
 * user-supplied source URLs cannot be used to probe the host network or
 * cloud metadata endpoints (basic SSRF guard).
 *
 * Resolves the hostname and refuses if any returned address falls inside a
 * private/loopback/link-local range (including IPv4-mapped IPv6).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing non-http(s) URL (${url.protocol})`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error(`Refusing to fetch private host "${host}"`);
  }
  // If the URL itself is a literal IP, validate directly without DNS.
  if (isIPv4(host) || isIPv6(host.replace(/^\[|\]$/g, ""))) {
    if (isPrivateAddress(host.replace(/^\[|\]$/g, ""))) {
      throw new Error(`Refusing to fetch private address "${host}"`);
    }
    return url;
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true });
  } catch (err) {
    throw new Error(
      `DNS lookup failed for "${host}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(
        `Refusing to fetch "${host}" — resolves to private address ${r.address}`,
      );
    }
  }
  return url;
}

function isPrivateAddress(addr: string): boolean {
  if (isIPv4(addr)) return isPrivateIPv4(addr);
  if (isIPv6(addr)) {
    const lower = addr.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
    // IPv4-mapped: ::ffff:a.b.c.d
    const v4mapped = lower.match(/^::ffff:([0-9.]+)$/);
    if (v4mapped && v4mapped[1] && isIPv4(v4mapped[1])) {
      return isPrivateIPv4(v4mapped[1]);
    }
  }
  return false;
}

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Fetch a public http(s) URL with redirects validated at each hop. This
 * prevents an attacker from registering a public URL whose 30x Location
 * points at a private/internal address — the previous one-shot guard would
 * miss that bypass when called with native fetch's `redirect: "follow"`.
 *
 * Note: there is still a residual DNS-rebinding TOCTOU window between
 * `assertPublicHttpUrl`'s lookup and the eventual TCP connect. Closing it
 * fully would require a custom https.Agent with a connect-time `lookup`
 * that re-validates; this is acceptable for v1 since the per-hop check
 * already blocks the dominant attack class (public URL → 302 → metadata).
 */
export async function safePublicFetch(
  rawUrl: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; finalUrl: string; body: string }> {
  let target = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertPublicHttpUrl(target);
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    let resp: Response;
    try {
      resp = await fetch(validated.toString(), {
        signal: ac.signal,
        redirect: "manual",
        headers: init.headers,
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) {
        throw new Error(`HTTP ${resp.status} redirect with no Location`);
      }
      // Resolve relative redirects against the current URL.
      target = new URL(loc, validated).toString();
      continue;
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    // Stream the body but cap total bytes so a malicious endpoint cannot
    // exhaust memory.
    const reader = resp.body?.getReader();
    if (!reader) {
      const text = await resp.text();
      return {
        status: resp.status,
        finalUrl: validated.toString(),
        body: text.slice(0, MAX_RESPONSE_BYTES),
      };
    }
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // ignored
        }
        break;
      }
      chunks.push(value);
    }
    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      status: resp.status,
      finalUrl: validated.toString(),
      body: merged.toString("utf-8"),
    };
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}
