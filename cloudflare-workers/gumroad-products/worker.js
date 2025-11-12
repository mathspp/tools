// worker.js (simplified, no explicit caching)

const DEFAULT_ALLOWED_ORIGINS = [
    "https://tools.mathspp.com",
    "http://localhost:5173",
    "http://localhost:3000",
];

function buildAllowedOrigins(env) {
    const allowList = (env?.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return new Set(allowList);
}

function corsHeaders(origin, allowed) {
    const allow = allowed.has(origin) ? origin : "";
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
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

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Simple backoff for 429/503; not related to caching.
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
    async fetch(request, env) {
        const origin = request.headers.get("Origin") || "";
        const allowed = buildAllowedOrigins(env);
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(origin, allowed) });
        }
        if (request.method !== "GET") {
            return respondJSON(origin, allowed, { error: "Method Not Allowed" }, 405);
        }

        const goodPath =
            url.pathname === "/api/gumroad-products" ||
            url.pathname === "/api/gumroad-products/";
        if (!goodPath) {
            return respondJSON(origin, allowed, { error: "Not Found" }, 404);
        }

        const u = (url.searchParams.get("u") || "").trim();
        if (!u || !/^[a-z0-9-]+$/i.test(u)) {
            return respondJSON(origin, allowed, { error: "Invalid or missing Gumroad username." }, 400);
        }

        // Try subdomain profile, then path-based profile as fallback
        const profileUrlA = `https://${u}.gumroad.com/`;
        const profileUrlB = `https://gumroad.com/${encodeURIComponent(u)}`;

        async function getProfileHTML(urlStr) {
            return fetchWithBackoff(urlStr, {
                redirect: "follow",
                headers: {
                    Accept:
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                    Referer: "https://gumroad.com/",
                },
            });
        }

        let upstream = await getProfileHTML(profileUrlA);
        if (!upstream.ok && (upstream.status === 429 || upstream.status === 403)) {
            upstream = await getProfileHTML(profileUrlB);
        }
        if (!upstream.ok) {
            return respondJSON(
                origin,
                allowed,
                { error: "Upstream error", status: upstream.status },
                upstream.status
            );
        }

        const html = await upstream.text();
        const products = extractProducts(html);

        const payload = {
            username: u,
            profile_url: `https://${u}.gumroad.com/`,
            count: products.length,
            products,
            fetched_at: new Date().toISOString(),
        };

        return respondJSON(origin, allowed, payload, 200);
    },
};

function extractProducts(html) {
    // Lightweight HTML parsing without DOM: heuristic regex over links.
    const linkRe = /<a\b[^>]*href=["']([^"']*\/l\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const tagRe = /<\/?[^>]+>/g;
    const nbspRe = /&nbsp;/g;

    const seen = new Set();
    const items = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        let title = m[2].replace(tagRe, "").replace(nbspRe, " ").trim();
        if (!title) continue;

        // Normalize absolute vs relative
        const url = href.startsWith("http")
            ? href
            : new URL(href, "https://example.com").href;
        const slug = url.split("/").filter(Boolean).pop();

        const key = url + "|" + title;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({ title, url, slug });
    }
    return items;
}
