// Serves /media/* from the R2 bucket bound as env.MEDIA.
// URL /media/<key> -> R2 object <key> (e.g. /media/icon.png -> "icon.png").
// Shared by src/worker.js (wrangler) and the bundled Worker (scripts/bundle-worker.mjs).
export const MEDIA_PREFIX = "/media/";

const MEDIA_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", txt: "text/plain; charset=utf-8",
};
// Long cache: a file at a given /media/ URL is treated as never changing.
// To replace an image, upload it under a new filename.
const MEDIA_CACHE = "public, max-age=31536000, immutable";

// Site icons live in R2 under site/ (repo: media/site/) and are also served at the
// root paths browsers look for. Shorter cache there so a new icon shows up within a day.
export const ROOT_MEDIA = {
  "/favicon.ico": "site/favicon.ico",
  "/icon.svg": "site/icon.svg",
  "/favicon-32x32.png": "site/favicon-32x32.png",
  "/favicon-16x16.png": "site/favicon-16x16.png",
  "/apple-touch-icon.png": "site/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png": "site/apple-touch-icon.png",
};
const ROOT_CACHE = "public, max-age=86400";

// path: decoded URL path. Returns null if the path isn't a media path.
export function mediaRoute(path) {
  if (ROOT_MEDIA[path]) return { key: ROOT_MEDIA[path], cache: ROOT_CACHE };
  if (path.startsWith(MEDIA_PREFIX)) return { key: path.slice(MEDIA_PREFIX.length), cache: MEDIA_CACHE };
  return null;
}

export async function serveMedia(req, env, { key, cache }) {
  const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!key || key.endsWith("/") || !env.MEDIA) return notFound();

  const head = req.method === "HEAD";
  const obj = head
    ? await env.MEDIA.head(key)
    : await env.MEDIA.get(key, { onlyIf: req.headers, range: req.headers });
  if (!obj) return notFound();

  const h = new Headers();
  obj.writeHttpMetadata(h);
  if (!h.get("content-type")) h.set("content-type", MEDIA_TYPES[key.split(".").pop().toLowerCase()] || "application/octet-stream");
  h.set("etag", obj.httpEtag);
  h.set("cache-control", cache);
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");

  if (head) { h.set("content-length", String(obj.size)); return new Response(null, { headers: h }); }
  // Precondition failed (If-None-Match matched, etc.): R2 returns metadata without a body.
  if (!("body" in obj)) return new Response(null, { status: req.headers.has("if-none-match") ? 304 : 412, headers: h });
  if (obj.range && req.headers.has("range")) {
    const r = obj.range;
    const suffix = r.suffix !== undefined;
    const start = suffix ? Math.max(0, obj.size - r.suffix) : (r.offset ?? 0);
    const end = suffix || r.length === undefined ? obj.size - 1 : Math.min(obj.size - 1, start + r.length - 1);
    h.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    h.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { headers: h });
}
