# willfletcher.me

Will Fletcher's personal site and blog. Plain Markdown in, static HTML out.
One dependency (`marked`), no client-side JavaScript, hosted on Cloudflare Workers + R2.

Live: https://willfletcher.me

## Layout

```
index.md                  Homepage content (Markdown)
posts/*.md                Blog posts, one file per post
media/                    Images and other files (uploaded to R2, served at /media/...)
media/site/               Site icons (favicon.ico, icon.svg, PNGs, apple-touch-icon), served at the root
static/                   Small text assets copied into the site root (style.css)
build.mjs                 The build: index.md + posts/ -> dist/
scripts/bundle-worker.mjs Packs dist/ into one Worker script (dist-worker/worker.js)
scripts/deploy.mjs        Writes the Cloudflare API snippets for a deploy (dist-worker/connector/)
scripts/make-icons.py     Regenerates the icons in media/site/ (Pillow + fontTools)
src/media.js              Serves /media/* from the R2 bucket (shared by both Worker variants)
src/worker.js             Worker for the alternative `wrangler deploy` path
wrangler.jsonc            Config for the alternative `wrangler deploy` path
```

## How it's hosted

- **Pages** (HTML, CSS) are embedded in the Cloudflare Worker `willfletcher-site`.
- **Media** (images, PDFs, etc.) live in the R2 bucket `willfletcher-site-media`.
  The same Worker serves them: `media/<path>` in this repo is R2 object `<path>`, served at
  `https://willfletcher.me/media/<path>`, with the right content type, an ETag and a 1-year cache.
- **Icons** also live in R2 (`media/site/` → `site/...`) and are served at the root paths browsers
  and Safari/iOS look for: `/favicon.ico` (16/32/48), `/icon.svg`, `/favicon-32x32.png`,
  `/favicon-16x16.png`, `/apple-touch-icon.png` (180×180, also `/apple-touch-icon-precomposed.png`).
  These are cached for a day (not a year), so a new icon shows up soon after a deploy.
  To change the icon, replace the files in `media/site/` (keep the names) and deploy.
  The mapping is `ROOT_MEDIA` in `src/media.js`.
- Custom domains: `willfletcher.me` and `www.willfletcher.me` (www redirects to the apex).

## Write a post

1. Create a Markdown file in `posts/`. The filename becomes the URL:
   `posts/my-first-post.md` → `https://willfletcher.me/blog/my-first-post/`

   ```markdown
   ---
   title: My first post
   date: 2026-10-08
   description: Optional one-line summary (used for meta description and RSS)
   ---

   Write the post here in **Markdown**.
   ```

   `title` and `date` (YYYY-MM-DD) are required. Add `draft: true` to keep a post out of the build.

2. Ask Website Bot to deploy (see below), or preview locally with `npm install && npm run build && npx serve dist`.

As soon as at least one post exists, the build also creates `/blog/` (list of all posts),
an RSS feed at `/feed.xml`, a "Writing" section on the homepage, and a Home/Blog nav.
With no posts, none of that appears.

## Add an image to a post

1. Put the image in `media/`. A folder per post keeps things tidy:
   `media/my-first-post/beach.jpg`
2. Reference it from the post with an absolute `/media/...` path:

   ```markdown
   ![Sunset at the beach](/media/my-first-post/beach.jpg)
   ```

   The text in square brackets is the alt text (shown to screen readers and if the image fails to load).
3. Deploy. The image is uploaded to R2 and appears at
   `https://willfletcher.me/media/my-first-post/beach.jpg`.

Tips:
- Keep images web-sized: about 2000px wide at most, JPEG/WebP, ideally under 1 MB.
  Deploys carry each file through the Cloudflare API in one request, so very large files may not fit.
- Media URLs are cached for a year. To change an image, save it under a **new filename**
  (e.g. `beach-2.jpg`) and update the post, rather than overwriting the old file.
- The build fails with a clear message if a post links to `/media/...` that isn't in `media/`.
- Any file type works the same way (e.g. `media/cv.pdf` → `/media/cv.pdf`).

## Deploy

### Usual way: ask Website Bot

Commit and push your changes (or just tell Website Bot what to add), then ask it to deploy.
It deploys through the Cloudflare API connector, with no wrangler login or tokens on your side:

1. `npm run bundle` builds the pages, packs them into `dist-worker/worker.js`, and writes
   ready-to-run Cloudflare API snippets into `dist-worker/connector/`:
   - `check-media.js` lists which `media/` files are new or changed compared to the R2 bucket
     (compares MD5 with the R2 ETag)
   - `media/<file>.js`, one per media file, uploads that file to R2
     (`PUT /accounts/{id}/r2/buckets/willfletcher-site-media/objects/<key>`). It checks a
     SHA-256 of the embedded file first and refuses to upload if the snippet was altered.
   - `worker.js` uploads the Worker script with the R2 binding `MEDIA`
     (`PUT /accounts/{id}/workers/scripts/willfletcher-site`). It checks a SHA-256 of the
     script first and refuses to deploy if the snippet was altered.
2. Run `check-media.js`, then the `media/` snippet for each file it lists, then `worker.js`,
   each with the connector's `execute` tool.
3. Check `https://willfletcher.me` and any new `/media/...` URLs.

Removing a file from `media/` doesn't delete it from R2; `check-media.js` reports such leftovers
as `onlyInBucket`.

### Alternative: wrangler (if you ever deploy from your own computer)

```sh
npm install
npx wrangler login                     # once
npm run deploy:wrangler                # = node build.mjs && wrangler deploy
# upload media (once per new/changed file):
npx wrangler r2 object put willfletcher-site-media/my-first-post/beach.jpg \
  --file media/my-first-post/beach.jpg --remote
```

This deploys the same Worker using `src/worker.js` with `dist/` as Workers Static Assets and the
same R2 binding (see `wrangler.jsonc`). Either path can replace the other at any time.
