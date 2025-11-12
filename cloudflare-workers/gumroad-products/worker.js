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

        // Try subdomain first, then path-based profile
        const profileUrlA = `https://${u}.gumroad.com/`;
        const profileUrlB = `https://gumroad.com/${encodeURIComponent(u)}`;

        async function getProfileHTML(urlStr) {
            // Stronger browser-like headers
            const res = await fetchWithBackoff(urlStr, {
                redirect: "follow",
                headers: {
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    // A very standard UA; tweak as desired
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                    "Referer": "https://gumroad.com/",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                },
            });
            return res;
        }

        // 1) Try subdomain
        let upstream = await getProfileHTML(profileUrlA);

        // 2) If still throttled, try path profile
        if (!upstream.ok && (upstream.status === 429 || upstream.status === 403)) {
            upstream = await getProfileHTML(profileUrlB);
        }

        // If still not ok, serve stale or bubble error
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

        const products = extractProducts(html);

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

function extractProducts(html) {
    // Lightweight HTML parsing without DOM: heuristic regex over links.
    // For more robustness, you could use an HTML parser lib with Workers Bundler.
    const linkRe = /<a\b[^>]*href=["']([^"']*\/l\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const tagRe = /<\/?[^>]+>/g;
    const nbspRe = /&nbsp;/g;

    const seen = new Set();
    const items = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        let title = m[2].replace(tagRe, '').replace(nbspRe, ' ').trim();
        if (!title) continue;

        // Normalize absolute vs relative
        const url = href.startsWith('http') ? href : new URL(href, 'https://example.com').href;
        const slug = url.split('/').filter(Boolean).pop();

        const key = url + '|' + title;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({ title, url, slug });
    }
    return items;
}
