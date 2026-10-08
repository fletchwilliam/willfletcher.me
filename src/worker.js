// Used by `wrangler deploy` (Static Assets + R2). Redirects www -> apex,
// serves /media/* and root icons from R2 (env.MEDIA), everything else from dist/ (env.ASSETS).
import { mediaRoute, serveMedia } from "./media.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.willfletcher.me") {
      url.hostname = "willfletcher.me";
      return Response.redirect(url.toString(), 301);
    }
    let path = url.pathname; try { path = decodeURIComponent(path); } catch {}
    const media = mediaRoute(path);
    if (media) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      return serveMedia(request, env, media);
    }
    return env.ASSETS.fetch(request);
  },
};
