# willfletcher.me

Will Fletcher's personal site and blog. Plain Markdown in, static HTML out.
One dependency (`marked`), no client-side JavaScript, hosted on Cloudflare Workers.

Live: https://willfletcher.me

## Layout

```
index.md              Homepage content (Markdown)
posts/*.md            Blog posts, one file per post
static/               Copied as-is into the site root (style.css, images, favicon…)
build.mjs             The build: index.md + posts/ -> dist/
src/worker.js         Tiny Worker for `wrangler deploy` (www -> apex redirect, serves dist/)
wrangler.jsonc        Cloudflare Worker config (name, custom domains, Static Assets)
scripts/bundle-worker.mjs  Fallback: packs dist/ into one self-contained Worker script
```

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

2. Build and preview:

   ```sh
   npm install
   npm run build        # writes dist/
   npx serve dist       # optional local preview
   ```

As soon as at least one post exists, the build also creates `/blog/` (list of all posts),
an RSS feed at `/feed.xml`, a "Writing" section on the homepage, and a Home/Blog nav.
With no posts, none of that appears.

## Deploy

```sh
npx wrangler login     # once
npm run deploy         # = node build.mjs && wrangler deploy
```

This deploys the Worker `willfletcher-site` with the contents of `dist/` as Static Assets,
attached to the custom domains `willfletcher.me` and `www.willfletcher.me` (www redirects to the apex).

### Fallback (no wrangler, API-only)

`node build.mjs && node scripts/bundle-worker.mjs` produces `dist-worker/worker.js`, a single
module Worker with every file embedded. Upload it as the `willfletcher-site` script
(`PUT /accounts/{account_id}/workers/scripts/willfletcher-site`, `main_module: worker.js`).
This is how the first version was deployed. It's fine for a small text site; switch back to
`npm run deploy` once there are images or lots of posts.
