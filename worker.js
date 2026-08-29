// Vettory — hosted agent door (Cloudflare Worker + static assets)
//
// Serves the website (from /site) AND the live API at /api/search.
// Reads the vetted catalog from data/catalog.json — the single source of truth.

import catalog from "./data/catalog.json";

const RUBRIC = catalog.rubric;
const DEMO_KEY = "vty_public_demo";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Defense-in-depth headers for the website (static pages).
// CSP is tuned to exactly what the site uses: inline CSS/JS, Google Fonts,
// same-origin images + API calls. Nothing external can be injected.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; " +
    "upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
};

function findCategory(need) {
  const n = (need || "").toLowerCase();
  for (const c of catalog.categories) {
    if (n && c.category.toLowerCase().includes(n)) return c;
    if (c.need_keywords.some((k) => n.includes(k))) return c;
  }
  return null;
}

function record(t) {
  const scores = {};
  RUBRIC.forEach((k, i) => (scores[k] = t.scores[i]));
  return {
    name: t.name,
    status: t.status, // verdict: trusted | caution | warning (rubric-based, NOT a human sign-off)
    verified: t.verified === true, // true only if a person has personally verified this tool
    checked: t.checked || null, // date a person last looked at it
    tagline: t.tagline,
    oneLine: t.oneLine || null,
    scores,
    best_for: t.best_for,
    watch_out: t.watch_out,
    history: t.history || null,
    source: t.source,
  };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// The catalog is normally drawn by JavaScript from /api/catalog. Anything that
// reads the raw HTML instead — an agent browsing the page, a crawler, a link
// preview — would otherwise see only "Loading the catalog…" and none of the
// verdicts. So the Worker renders the same catalog into the page server-side.
// Browsers with JavaScript replace it with the interactive version; everything
// else still gets every verdict, in text.
function catalogHTML() {
  let out = '<div class="prerender">';
  for (const c of catalog.categories) {
    for (const t of c.tools) {
      const scores = RUBRIC.map((k, i) => esc(k) + " " + t.scores[i] + "/5").join(" \u00b7 ");
      out +=
        '<article class="pre-tool">' +
        "<h3>" + esc(t.name) + " \u2014 " + esc(String(t.status).toUpperCase()) + "</h3>" +
        '<p class="pre-meta">' + esc(c.category) + " \u00b7 " +
        (t.verified ? "human-verified by a person at Vettory" : "rubric-scored; not personally verified") +
        (t.checked ? " \u00b7 last checked " + esc(t.checked) : "") + "</p>" +
        (t.oneLine ? "<p>" + esc(t.oneLine) + "</p>" : "") +
        (t.best_for ? "<p><b>Best for:</b> " + esc(t.best_for) + "</p>" : "") +
        (t.watch_out ? "<p><b>Watch out:</b> " + esc(t.watch_out) + "</p>" : "") +
        "<p><b>Rubric:</b> " + scores + "</p>" +
        (t.source ? '<p><a href="' + esc(t.source) + '" rel="noopener">Source</a></p>' : "") +
        "</article>";
    }
  }
  return out + "</div>";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...CORS },
  });
}

function presentedKey(request) {
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return bearer || url.searchParams.get("key") || "";
}

function isAuthorized(key, env) {
  const allowed = new Set([DEMO_KEY]);
  if (env && env.VETTORY_API_KEYS) {
    env.VETTORY_API_KEYS.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => allowed.add(k));
  }
  return allowed.has(key);
}

// Returns a 429 Response if the caller is over their limit, else null.
async function throttle(limiter, limitKey) {
  if (!limiter) return null; // binding absent (e.g. local dev) — don't block
  const { success } = await limiter.limit({ key: limitKey });
  if (success) return null;
  return json(
    {
      error:
        "Rate limit reached — please slow down for a moment. The public demo key allows about 30 requests/minute; your own Vettory key gets a much higher limit. Join the early-access list to get one.",
    },
    429
  );
}

async function handleSearch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const key = presentedKey(request);
  if (!isAuthorized(key, env)) {
    return json(
      {
        error:
          "Access denied. Provide a valid Vettory API key (try the public demo key `vty_public_demo`). Join the early-access list for your own key.",
      },
      401
    );
  }

  // Per-key rate limiting: the public demo is throttled per-IP; issued keys get the higher allowance.
  const isDemo = key === DEMO_KEY;
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const limited = isDemo
    ? await throttle(env.DEMO_LIMITER, "demo:" + ip)
    : await throttle(env.KEY_LIMITER, "key:" + key);
  if (limited) return limited;

  const url = new URL(request.url);
  let need = url.searchParams.get("need") || "";
  if (!need && request.method === "POST") {
    try {
      const body = await request.json();
      need = body.need || "";
    } catch (e) {
      /* ignore bad body */
    }
  }
  if (!need) return json({ error: "Ask with ?need=... — e.g. /api/search?need=send%20email" }, 400);

  const cat = findCategory(need);
  if (!cat) {
    return json({ need, match: null, message: "No vetted tools for that need yet — it's in Vettory's queue." });
  }

  const rank = { trusted: 0, caution: 1, warning: 2 };
  const tools = [...cat.tools].sort(
    (a, b) => ((rank[a.status] ?? 3) - (rank[b.status] ?? 3)) || (b.scores[0] - a.scores[0])
  );

  return json({
    need,
    category: cat.category,
    count: tools.length,
    recommended: tools[0].name,
    tools: tools.map(record),
    _note:
      "Every tool is rubric-scored and cited to its source. `status` is the rubric verdict (trusted/caution/warning), not a human sign-off; `verified: true` means a person personally checked it. Uncited or uncertain vendors are held off the catalog.",
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/catalog") {
      // Public: the catalog listing that powers the website (single source of truth).
      if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const limited = await throttle(env.DEMO_LIMITER, "cat:" + ip);
      if (limited) return limited;
      return json({ updated: catalog.updated, rubric: catalog.rubric, categories: catalog.categories });
    }
    if (url.pathname === "/api/search") return handleSearch(request, env);
    // Everything else is served from the static site (the ASSETS binding), with security headers added.
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      if ((res.headers.get("content-type") || "").includes("text/html")) {
        return new HTMLRewriter()
          .on("#rows", { element(el) { el.setInnerContent(catalogHTML(), { html: true }); } })
          .transform(out);
      }
      return out;
    }
    return new Response("Not found", { status: 404 });
  },
};
