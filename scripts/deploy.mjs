// Prepares an API-only deploy (no wrangler, no local Cloudflare credentials).
//   npm run bundle   (= node build.mjs && node scripts/bundle-worker.mjs && node scripts/deploy.mjs)
//
// Writes ready-to-run snippets for the Cloudflare API connector's `execute` tool into
// dist-worker/connector/. Run them in this order:
//   1. check-media.js     -> lists which media/ files are missing or changed in R2
//   2. media/<file>.js    -> one per file reported by step 1 (uploads it to R2)
//   3. worker.js          -> uploads dist-worker/worker.js as the Worker, with the R2 binding
// Each snippet is a self-contained `async () => {...}` that uses `cloudflare.request` and `accountId`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { createHash } from "node:crypto";

const WORKER = "willfletcher-site";
const BUCKET = "willfletcher-site-media";
const COMPAT_DATE = "2026-10-01";
const MEDIA_DIR = "media";
const OUT = "dist-worker/connector";
const WARN_BYTES = 1024 * 1024; // snippets carry files inline, so keep media web-sized

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".txt": "text/plain; charset=utf-8" };

const files = [];
(function walk(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).sort()) {
    if (f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const buf = readFileSync(p);
      files.push({ key: relative(MEDIA_DIR, p).split("\\").join("/"), path: p, buf, size: buf.length, md5: createHash("md5").update(buf).digest("hex"), type: TYPES[extname(p).toLowerCase()] || "application/octet-stream" });
    }
  }
})(MEDIA_DIR);

// Root icon paths (/favicon.ico etc.) are served from R2; make sure their files exist.
const rootSrc = readFileSync("src/media.js", "utf8").match(/ROOT_MEDIA = (\{[\s\S]*?\});/)[1];
for (const key of new Set(Object.values(JSON.parse(rootSrc.replace(/,\s*\}/, "}"))))) {
  if (!files.some((f) => f.key === key)) { console.error(`Missing ${MEDIA_DIR}/${key} (needed for a root icon path, see ROOT_MEDIA in src/media.js)`); process.exit(1); }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "media"), { recursive: true });

// 1. Compare local media/ with the bucket (R2 ETag = MD5 for single-part uploads).
const manifest = files.map(({ key, md5, size }) => ({ key, md5, size }));
writeFileSync(join(OUT, "check-media.js"), `async () => {
  const local = ${JSON.stringify(manifest)};
  const remote = {};
  let cursor;
  do {
    const r = await cloudflare.request({ method: "GET", path: \`/accounts/\${accountId}/r2/buckets/${BUCKET}/objects\`, query: { per_page: 1000, cursor } });
    if (!r.success) return { error: r.errors, status: r.status };
    for (const o of r.result) remote[o.key] = o.etag;
    cursor = r.result_info && r.result_info.is_truncated ? r.result_info.cursor : undefined;
  } while (cursor);
  const upload = local.filter((f) => remote[f.key] !== f.md5).map((f) => f.key);
  const onlyInBucket = Object.keys(remote).filter((k) => !local.some((f) => f.key === k));
  return { upload, upToDate: local.length - upload.length, onlyInBucket };
}
`);

// 2. One upload snippet per media file.
const snippetName = (key) => key.replace(/[^A-Za-z0-9._-]/g, "__") + ".js";
for (const f of files) {
  const encKey = f.key.split("/").map(encodeURIComponent).join("/");
  writeFileSync(join(OUT, "media", snippetName(f.key)), `async () => {
  const b64 = "${f.buf.toString("base64")}";
  const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (sha !== "${createHash("sha256").update(f.buf).digest("hex")}") return { key: ${JSON.stringify(f.key)}, ok: false, error: "snippet does not match media file (sha256 " + sha + "); not uploaded" };
  const r = await cloudflare.request({ method: "PUT", path: \`/accounts/\${accountId}/r2/buckets/${BUCKET}/objects/${encKey}\`, body, contentType: ${JSON.stringify(f.type)}, rawBody: true });
  return { key: ${JSON.stringify(f.key)}, ok: r.success && r.result && r.result.etag === ${JSON.stringify(f.md5)}, status: r.status, etag: r.result && r.result.etag, errors: r.errors };
}
`);
}

// 3. Worker script upload (keeps custom domains; bindings are set from this metadata).
const code = readFileSync("dist-worker/worker.js", "utf8");
const metadata = { main_module: "worker.js", compatibility_date: COMPAT_DATE, bindings: [{ type: "r2_bucket", name: "MEDIA", bucket_name: BUCKET }] };
writeFileSync(join(OUT, "worker.js"), `async () => {
  // Script is base64-encoded so the snippet can be pasted verbatim without escaping issues.
  const code = new TextDecoder().decode(Uint8Array.from(atob("${Buffer.from(code, "utf8").toString("base64")}"), (c) => c.charCodeAt(0)));
  // Guard against a mangled paste: refuse to deploy unless the script matches the build.
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (sha !== "${createHash("sha256").update(code, "utf8").digest("hex")}") return { error: "worker.js snippet does not match the build (sha256 " + sha + "); not deployed" };
  const metadata = ${JSON.stringify(metadata)};
  const b = "----wf" + Date.now();
  const body = [
    "--" + b, 'Content-Disposition: form-data; name="metadata"', "Content-Type: application/json", "", JSON.stringify(metadata),
    "--" + b, 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"', "Content-Type: application/javascript+module", "", code,
    "--" + b + "--", "",
  ].join("\\r\\n");
  const r = await cloudflare.request({ method: "PUT", path: \`/accounts/\${accountId}/workers/scripts/${WORKER}\`, body, contentType: "multipart/form-data; boundary=" + b, rawBody: true });
  return { success: r.success, status: r.status, errors: r.errors, etag: r.result && r.result.etag, modified_on: r.result && r.result.modified_on };
}
`);

console.log(`Connector snippets in ${OUT}/:`);
console.log(`  1. check-media.js  (${files.length} media file(s) in ${MEDIA_DIR}/)`);
for (const f of files) console.log(`  2. media/${snippetName(f.key)}  -> /media/${f.key} (${(f.size / 1024).toFixed(1)} KB)${f.size > WARN_BYTES ? "  WARNING: over 1 MB, resize/compress it first" : ""}`);
console.log(`  3. worker.js  (${(code.length / 1024).toFixed(1)} KB script, R2 binding MEDIA -> ${BUCKET})`);
