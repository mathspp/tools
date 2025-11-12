// worker.js
const DEFAULT_ALLOWED_ORIGINS = [
    "https://tools.mathspp.com",
    "http://localhost:5173",
    "http://localhost:3000",
];

const S_MAX_AGE = 3600;         // 1h fresh cache
const STALE_WINDOW = 24 * 3600; // 24h serve-stale if upstream errors
const UA = "tools.mathspp.com gumroad fetcher (contact: you@example.com)";

function buildAllowedOrigins(env) {
    const allowList = (env?.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
        .split(",").map(s => s.trim()).filter(Boolean);
    return new Set(allowList);
}
function corsHeaders(origin, allowed) {
    const allow = allowed.has(origin) ? origin : "";
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
    };
}
function respondJSON(origin, allowed, data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders(origin, allowed),
            ...extra,
        },
    });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBackoff(url, init, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        const res = await fetch(url, init);
        if (res.ok) return res;

        if (res.status === 429 || res.status === 503) {
            const ra = res.headers.get("Retry-After");
            if (ra) {
                const secs = Number(ra);
                if (!Number.isNaN(secs) && secs >= 0 && secs <= 120) {
                    await sleep(secs * 1000);
                    continue;
                }
            }
            const delay = Math.min(1600, 400 * Math.pow(2, i)) + Math.floor(Math.random() * 150);
            await sleep(delay);
            continue;
        }
        return res; // don't retry other statuses
    }
    return fetch(url, init); // last shot
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin") || "";
        const allowed = buildAllowedOrigins(env);
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(origin, allowed) });
        }
        if (request.method !== "GET") {
            return respondJSON(origin, allowed, { error: "Method Not Allowed" }, 405);
        }

        const goodPath = url.pathname === "/api/gumroad-products" || url.pathname === "/api/gumroad-products/";
        if (!goodPath) {
            return respondJSON(origin, allowed, { error: "Not Found" }, 404);
        }

        const u = (url.searchParams.get("u") || "").trim();
        if (!u || !/^[a-z0-9-]+$/i.test(u)) {
            return respondJSON(origin, allowed, { error: "Invalid or missing Gumroad username." }, 400);
        }

        const profileUrl = `https://${u}.gumroad.com/`;
        const cache = caches.default;
        const dataKey = new Request(`https://gumroad-products.internal/cache?u=${encodeURIComponent(u)}`);
        const metaKey = new Request(`https://gumroad-products.internal/meta?u=${encodeURIComponent(u)}`);

        let cachedBody = null, cachedTs = 0;
        const c = await cache.match(dataKey);
        if (c) cachedBody = await c.text();
        const cm = await cache.match(metaKey);
        if (cm) try { cachedTs = (await cm.json()).ts || 0; } catch { }

        // Serve fresh cache (<= 1h)
        const age = Math.floor(Date.now() / 1000) - cachedTs;
        if (cachedBody && age <= S_MAX_AGE) {
            return new Response(cachedBody, {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": `public, max-age=${S_MAX_AGE}`,
                    "X-Cache": "HIT",
                    "X-Upstream-Status": "none",
                    ...corsHeaders(origin, allowed),
                },
            });
        }

        // Upstream fetch with backoff; try to look like a polite browser
        const upstream = await fetchWithBackoff(profileUrl, {
            redirect: "follow",
            headers: {
                "Accept": "text/html",
                "Accept-Language": "en",
                "User-Agent": UA,
                "Referer": "https://gumroad.com/",
            },
            // You can experiment with cf options if needed:
            // cf: { cacheTtl: 0, fetchAlgorithms: ["http/2"] }
        });

        if (!upstream.ok) {
            // Serve stale (<= 25h old total) instead of failing
            if (cachedBody && age <= (S_MAX_AGE + STALE_WINDOW)) {
                return new Response(cachedBody, {
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": `public, max-age=0, stale-while-revalidate=${STALE_WINDOW}`,
                        "X-Cache": "STALE",
                        "X-Upstream-Status": String(upstream.status),
                        ...corsHeaders(origin, allowed),
                    },
                });
            }
            // No cache to fall back to
            return respondJSON(origin, allowed, { error: "Upstream error", status: upstream.status }, upstream.status, {
                "X-Cache": "MISS",
                "X-Upstream-Status": String(upstream.status),
            });
        }

        const html = await upstream.text();

        // Extract hrefs → /l/<slug>
        const hrefs = [];
        const reHref = /href\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = reHref.exec(html)) !== null) hrefs.push(m[1]);

        const seen = new Set();
        const products = [];
        for (const href of hrefs) {
            let absolute;
            try { absolute = new URL(href, profileUrl).toString(); } catch { continue; }
            const mm = absolute.match(/\/l\/([A-Za-z0-9-_]+)\/?$/);
            if (!mm) continue;
            const slug = mm[1];
            if (seen.has(slug)) continue;
            seen.add(slug);
            const title = slug.replace(/[-_]+/g, " ").trim();
            products.push({ slug, url: absolute, title });
        }

        products.sort((a, b) => a.slug.localeCompare(b.slug));

        const payload = {
            username: u,
            profile_url: profileUrl,
            count: products.length,
            products,
            fetched_at: new Date().toISOString(),
        };
        const body = JSON.stringify(payload);

        // Update cache
        const now = Math.floor(Date.now() / 1000);
        const dataResp = new Response(body, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": `public, max-age=${S_MAX_AGE}`,
            },
        });
        const metaResp = new Response(JSON.stringify({ ts: now }), {
            headers: { "Content-Type": "application/json" },
        });
        ctx.waitUntil(cache.put(dataKey, dataResp.clone()));
        ctx.waitUntil(cache.put(metaKey, metaResp.clone()));

        return new Response(body, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": `public, max-age=${S_MAX_AGE}`,
                "X-Cache": cachedBody ? "MISS-REVAL" : "MISS",
                "X-Upstream-Status": "200",
                ...corsHeaders(origin, allowed),
            },
        });
    },
};
