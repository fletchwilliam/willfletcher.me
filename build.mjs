// Tiny static site builder: index.md + posts/*.md -> dist/
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { marked } from "marked";

const SITE = { title: "Will Fletcher", url: "https://willfletcher.me" };
const OUT = "dist";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Minimal front matter parser: --- key: value --- (strings only)
function parse(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return { data, body: m ? src.slice(m[0].length) : src };
}

const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function page({ title, body, description = "", nav = true }) {
  const fullTitle = title === SITE.title ? title : `${title} · ${SITE.title}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ""}<link rel="stylesheet" href="/style.css">
${hasPosts ? `<link rel="alternate" type="application/rss+xml" title="${esc(SITE.title)}" href="/feed.xml">\n` : ""}</head>
<body>
${nav ? `<nav><a href="/">Home</a>${hasPosts ? `<a href="/blog/">Blog</a>` : ""}</nav>\n` : ""}<main>
${body}
</main>
</body>
</html>
`;
}

// Collect posts
const postsDir = "posts";
const posts = (existsSync(postsDir) ? readdirSync(postsDir) : [])
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .map((f) => {
    const { data, body } = parse(readFileSync(join(postsDir, f), "utf8"));
    const slug = basename(f, ".md");
    if (!data.title) throw new Error(`${f}: missing "title" in front matter`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) throw new Error(`${f}: "date" must be YYYY-MM-DD`);
    return { slug, ...data, draft: data.draft === "true", html: marked.parse(body) };
  })
  .filter((p) => !p.draft)
  .sort((a, b) => b.date.localeCompare(a.date));
const hasPosts = posts.length > 0;

// Clean output
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync("static", OUT, { recursive: true });

const write = (path, html) => {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, "index.html"), html);
};

const postList = (list) =>
  `<ul class="posts">\n${list.map((p) => `<li><time datetime="${p.date}">${p.date}</time><a href="/blog/${p.slug}/">${esc(p.title)}</a></li>`).join("\n")}\n</ul>`;

// Homepage (index.md), plus latest posts if any
const home = parse(readFileSync("index.md", "utf8"));
let homeHtml = marked.parse(home.body);
if (hasPosts) homeHtml += `\n<h2>Writing</h2>\n${postList(posts.slice(0, 5))}${posts.length > 5 ? `\n<p><a href="/blog/">All posts →</a></p>` : ""}`;
write("", page({ title: SITE.title, body: homeHtml, nav: hasPosts }));

// Blog index (only when there are posts) and posts
if (hasPosts) {
  write("blog", page({ title: "Blog", body: `<h1>Blog</h1>\n${postList(posts)}` }));
  for (const p of posts) {
    write(`blog/${p.slug}`, page({
      title: p.title,
      description: p.description || "",
      body: `<article>\n<h1>${esc(p.title)}</h1>\n<p class="date"><time datetime="${p.date}">${fmtDate(p.date)}</time></p>\n${p.html}</article>`,
    }));
  }
  // RSS feed
  const items = posts.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE.url}/blog/${p.slug}/</link><guid>${SITE.url}/blog/${p.slug}/</guid><pubDate>${new Date(p.date + "T00:00:00Z").toUTCString()}</pubDate>${p.description ? `<description>${esc(p.description)}</description>` : ""}</item>`).join("\n");
  writeFileSync(join(OUT, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(SITE.title)}</title><link>${SITE.url}</link><description>${esc(SITE.title)}'s blog</description>\n${items}\n</channel></rss>\n`);
}

// 404 page
writeFileSync(join(OUT, "404.html"), page({ title: "Not found", body: `<h1>Not found</h1>\n<p><a href="/">Go home</a></p>` }));

console.log(`Built ${posts.length} post(s) into ${OUT}/`);
