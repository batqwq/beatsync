/**
 * Resolves API and WS base URLs.
 *
 * Priority:
 * 1. If NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL are set, uses those (explicit mode).
 * 2. Otherwise, derives from window.location (same-origin / LAN mode).
 *
 * In LAN mode the client port (typically 3000 from Next.js) is mapped to the
 * Bun server port (8080). This means you never need to hardcode an IP — every
 * device simply uses whatever address it used to open the page.
 */

let cached: { apiUrl: string; wsUrl: string } | null = null;

function resolve(): { apiUrl: string; wsUrl: string } {
  if (cached) return cached;

  const envApi = process.env.NEXT_PUBLIC_API_URL;
  const envWs = process.env.NEXT_PUBLIC_WS_URL;

  if (envApi && envWs) {
    cached = { apiUrl: envApi, wsUrl: envWs };
  } else if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    const isSecure = protocol === "https:";

    // Map Next.js ports (3000 dev / start) to Bun server port (8080)
    const SERVER_PORT = "8080";
    const targetPort = port === "3000" || port === "" ? SERVER_PORT : port;
    const targetHost = targetPort ? `${hostname}:${targetPort}` : hostname;

    cached = {
      apiUrl: `${protocol}//${targetHost}`,
      wsUrl: `${isSecure ? "wss" : "ws"}://${targetHost}/ws`,
    };
  } else {
    // SSR fallback — don't cache empty strings so client can resolve properly after hydration
    return { apiUrl: "", wsUrl: "" };
  }

  return cached;
}

export function getApiUrl(): string {
  return resolve().apiUrl;
}

export function getWsUrl(): string {
  return resolve().wsUrl;
}
