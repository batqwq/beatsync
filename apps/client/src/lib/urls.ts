/**
 * Resolves API and WS base URLs.
 *
 * If NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL are set, uses those (explicit mode).
 * Otherwise, derives from window.location (same-origin mode, for Caddy reverse proxy).
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

    // Auto-detect backend port if running on Next.js dev server port 3000
    const targetPort = port === "3000" ? "8080" : port;
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
