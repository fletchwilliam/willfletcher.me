// Used by `wrangler deploy` (Static Assets). Redirects www -> apex, otherwise serves dist/.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.willfletcher.me") {
      url.hostname = "willfletcher.me";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
