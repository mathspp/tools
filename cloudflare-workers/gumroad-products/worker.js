export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Only handle /api/gumroad-products
        if (url.pathname !== "/api/gumroad-products") {
            return new Response("Not found", { status: 404 });
        }

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return handleOptions(request);
        }

        const username = url.searchParams.get("u");
        if (!username) {
            return new Response("Missing 'u' query parameter", { status: 400 });
        }

        // (Optional) Very basic sanity-check for username
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return new Response("Invalid username", { status: 400 });
        }

        const gumroadUrl = `https://${username}.gumroad.com`;

        // Fetch the Gumroad page
        const upstreamResp = await fetch(gumroadUrl);
        return new Response("done", { status: 200 });

        // Get raw HTML
        const html = await upstreamResp.text();

        // Build response with CORS headers
        const responseHeaders = new Headers(upstreamResp.headers);
        responseHeaders.set("Content-Type", "text/html; charset=utf-8");

        // Apply CORS policy
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

    // If no allowed origin, just send generic response
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
