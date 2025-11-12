// Cloudflare Worker (module syntax)
const DEFAULT_ALLOWED_ORIGINS = [
    "https://tools.mathspp.com",
    "http://localhost:5173",
    "http://localhost:3000",
];

/** Build CORS headers */
function corsHeaders(origin, allowedOrigins) {
    const allow = allowedOrigins.has(origin) ? origin : "";
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
    };
}

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
        status: init.status || 200,
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin") || "";

        // Read allowed origins from env (comma-separated) or use defaults
        const allowList = (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);
        const allowedOrigins = new Set(allowList);

        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(origin, allowedOrigins) });
        }

        if (request.method !== "GET") {
            return new Response("Method Not Allowed", { status: 405 });
        }

        if (url.pathname !== "/api/gumroad-products") {
            return new Response("Not Found", { status: 404 });
        }

        const u = (url.searchParams.get("u") || "").trim();
        if (!u || !/^[a-z0-9-]+$/i.test(u)) {
            return json({ error: "Invalid or missing Gumroad username." }, {
                status: 400,
                headers: corsHeaders(origin, allowedOrigins),
            });
        }

        const profileUrl = `https://${u}.gumroad.com/`;

        // Cache key (don’t cache by Origin)
        const cacheKey = new Request(`https://gumroad-products.internal/cache?u=${encodeURIComponent(u)}`);
        const cache = caches.default;

        const cached = await cache.match(cacheKey);
        if (cached) {
            return new Response(await cached.text(), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "public, max-age=3600",
                    ...corsHeaders(origin, allowedOrigins),
                },
            });
        }

        // Fetch the profile HTML
        const upstream = await fetch(profileUrl, {
            redirect: "follow",
            headers: {
                "Accept": "text/html",
                "Accept-Language": "en",
                "User-Agent": "tools.mathspp.com gumroad fetcher (contact: you@example.com)",
            },
        });

        if (!upstream.ok) {
            return json({ error: "Upstream error", status: upstream.status }, {
                status: upstream.status,
                headers: corsHeaders(origin, allowedOrigins),
            });
        }

        const html = await upstream.text();

        // Extract hrefs and find /l/<slug>
        const hrefs = [];
        const reHref = /href\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = reHref.exec(html)) !== null) hrefs.push(m[1]);

        const seen = new Set();
        const products = [];
        for (const href of hrefs) {
            let absolute;
            try {
                absolute = new URL(href, profileUrl).toString();
            } catch { continue; }

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

        // Cache for 1 hour
        const toCache = new Response(body, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=3600",
            },
        });
        ctx.waitUntil(cache.put(cacheKey, toCache.clone()));

        return new Response(body, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=3600",
                ...corsHeaders(origin, allowedOrigins),
            },
        });
    },
};
