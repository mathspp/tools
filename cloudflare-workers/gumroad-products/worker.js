export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname !== "/api/gumroad-products") {
            return new Response("Not found", { status: 404 });
        }

        // Handle preflight
        if (request.method === "OPTIONS") {
            return handleOptions(request);
        }

        const username = url.searchParams.get("u");
        if (!username) {
            return new Response("Missing 'u' query parameter", { status: 400 });
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return new Response("Invalid username", { status: 400 });
        }

        const gumroadUrl = `https://${username}.gumroad.com`;

        // Browser-like request headers
        const browserHeaders = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        };

        const upstreamResp = await fetch(gumroadUrl, { headers: browserHeaders });
        return new Response(`done ${upstreamResp.status}`, { status: 200 });

        const html = await upstreamResp.text();

        const responseHeaders = new Headers(upstreamResp.headers);
        responseHeaders.set("Content-Type", "text/html; charset=utf-8");

        applyCors(request, responseHeaders);

        return new Response(html, {
            status: upstreamResp.status,
            statusText: upstreamResp.statusText,
            headers: responseHeaders,
        });
    },
};

function applyCors(request, headers) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = new Set([
        "https://mathspp.com",
        "https://tools.mathspp.com",
    ]);

    if (origin && allowedOrigins.has(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
        headers.set("Access-Control-Allow-Credentials", "true");
    }
}

function handleOptions(request) {
    const headers = new Headers();
    applyCors(request, headers);

    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set(
        "Access-Control-Allow-Headers",
        request.headers.get("Access-Control-Request-Headers") || ""
    );

    return new Response(null, {
        status: 204,
        headers,
    });
}
