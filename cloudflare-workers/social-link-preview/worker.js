const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
            return jsonResponse({
                ok: false,
                error: "Missing required 'url' query parameter.",
            }, 400);
        }

        let response;
        try {
            response = await fetch(targetUrl, {
                redirect: "follow",
                headers: {
                    "User-Agent": "social-link-preview-fetcher/1.0 (+https://tools.mathspp.com/)",
                },
            });
        } catch (error) {
            return jsonResponse({
                ok: false,
                error: "Unable to reach the requested URL.",
            }, 502);
        }

        if (!response.ok) {
            return jsonResponse({
                ok: false,
                error: `The origin responded with ${response.status} ${response.statusText}.`,
            }, response.status);
        }

        const finalUrl = response.url || targetUrl;
        const html = await response.text();
        const context = await extractMetadata(html, targetUrl, finalUrl);
        const reports = buildReports(context);

        return jsonResponse({
            ok: true,
            requestedUrl: targetUrl,
            finalUrl,
            context,
            reports,
        });
    },
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...CORS_HEADERS,
        },
    });
}

async function extractMetadata(html, requestedUrl, finalUrl) {
    const meta = {};
    const rawLinks = {};
    const titleChunks = [];
    let description = "";
    let charset = "";
    let viewport = "";
    let htmlLang = "";
    let baseHref = "";

    const rewriter = new HTMLRewriter()
        .on("html", {
            element(element) {
                const lang = element.getAttribute("lang");
                if (lang) {
                    htmlLang = lang.trim();
                }
            },
        })
        .on("head > title", {
            text(textChunk) {
                titleChunks.push(textChunk.text);
            },
        })
        .on("meta", {
            element(element) {
                const key = element.getAttribute("property") || element.getAttribute("name");
                const content = element.getAttribute("content") || "";
                if (key) {
                    meta[key.toLowerCase()] = content.trim();
                }

                const charsetAttr = element.getAttribute("charset");
                if (charsetAttr) {
                    charset = charsetAttr.trim();
                }

                const nameAttr = element.getAttribute("name");
                if (nameAttr && nameAttr.toLowerCase() === "description" && !description) {
                    description = content.trim();
                }
                if (nameAttr && nameAttr.toLowerCase() === "viewport" && !viewport) {
                    viewport = content.trim();
                }
            },
        })
        .on("meta[charset]", {
            element(element) {
                const value = element.getAttribute("charset");
                if (value) {
                    charset = value.trim();
                }
            },
        })
        .on("link[rel]", {
            element(element) {
                const rel = (element.getAttribute("rel") || "").toLowerCase();
                if (!rel) return;
                const href = element.getAttribute("href") || "";
                if (!rawLinks[rel]) {
                    rawLinks[rel] = [];
                }
                rawLinks[rel].push(href);
            },
        })
        .on("base[href]", {
            element(element) {
                const href = element.getAttribute("href");
                if (href) {
                    baseHref = href.trim();
                }
            },
        });

    const rewritten = rewriter.transform(new Response(html));
    // Consume the body to allow the HTMLRewriter callbacks to run.
    await rewritten.arrayBuffer();

    const title = titleChunks.join("").trim();
    const baseUrl = resolveUrl(baseHref || "", requestedUrl) || finalUrl || requestedUrl;
    const links = {};

    for (const [rel, hrefs] of Object.entries(rawLinks)) {
        links[rel] = hrefs.map((href) => resolveUrl(href, baseUrl));
    }

    const canonical = (links["canonical"] && links["canonical"][0]) || "";

    return {
        meta,
        links,
        title,
        description: description || meta["description"] || "",
        charset,
        viewport: viewport || meta["viewport"] || "",
        canonical,
        htmlLang,
        baseUrl,
        finalUrl: finalUrl || requestedUrl,
        hostname: safeHostname(finalUrl || requestedUrl),
    };
}

function buildReports(context) {
    const generalGuidelines = [
        {
            id: "html-lang",
            label: "Document declares an HTML lang attribute",
            check: (ctx) => Boolean(ctx.htmlLang),
            detail: (ctx) => (ctx.htmlLang ? `Found: ${ctx.htmlLang}` : "Missing"),
        },
        {
            id: "title",
            label: "Document includes a <title> element",
            check: (ctx) => Boolean(ctx.title),
            detail: (ctx) => (ctx.title ? `“${truncate(ctx.title, 80)}”` : "Missing"),
        },
        {
            id: "title-length",
            label: "Title length is between 20 and 70 characters",
            check: (ctx) => ctx.title && ctx.title.length >= 20 && ctx.title.length <= 70,
            detail: (ctx) => (ctx.title ? `${ctx.title.length} characters` : "—"),
        },
        {
            id: "description",
            label: "Meta description present (50-160 characters)",
            check: (ctx) => ctx.description && ctx.description.length >= 50 && ctx.description.length <= 160,
            detail: (ctx) => (ctx.description ? `${ctx.description.length} chars: “${truncate(ctx.description, 100)}”` : "Missing"),
        },
        {
            id: "charset",
            label: "Character set declared with <meta charset>",
            check: (ctx) => Boolean(ctx.charset),
            detail: (ctx) => (ctx.charset ? `charset=${ctx.charset}` : "Missing"),
        },
        {
            id: "viewport",
            label: "Responsive viewport meta tag present",
            check: (ctx) => ctx.viewport && /width\s*=\s*device-width/i.test(ctx.viewport),
            detail: (ctx) => (ctx.viewport ? truncate(ctx.viewport, 80) : "Missing"),
        },
        {
            id: "canonical",
            label: "Canonical URL provided via <link rel=\"canonical\">",
            check: (ctx) => Boolean(ctx.canonical),
            detail: (ctx) => (ctx.canonical ? ctx.canonical : "Missing"),
        },
    ];

    const platformSpecs = [
        {
            name: "LinkedIn",
            slug: "linkedin",
            summary: "LinkedIn uses Open Graph tags. Title, description, image, canonical URL, and site name should be supplied.",
            guidelines: [
                presenceGuideline("og:title", "og:title provided"),
                presenceGuideline("og:description", "og:description provided (90-200 characters)", (ctx) => {
                    const value = ctx.meta["og:description"];
                    if (!value) return false;
                    return value.length >= 90 && value.length <= 200;
                }, (ctx) => {
                    const value = ctx.meta["og:description"];
                    return value ? `${value.length} chars: “${truncate(value, 100)}”` : "Missing";
                }),
                presenceGuideline("og:image", "og:image URL provided"),
                presenceGuideline("og:url", "og:url points to the canonical page"),
                presenceGuideline("og:site_name", "og:site_name provided"),
            ],
            preview: (ctx) => ({
                title: ctx.meta["og:title"] || ctx.title,
                description: ctx.meta["og:description"] || ctx.description,
                image: resolveUrl(ctx.meta["og:image"], ctx.baseUrl),
                url: ctx.meta["og:url"] || ctx.canonical || ctx.finalUrl,
                siteName: ctx.meta["og:site_name"] || ctx.hostname,
            }),
        },
        {
            name: "X (Twitter)",
            slug: "x",
            summary: "X requires Twitter Card tags in addition to Open Graph for the best preview.",
            guidelines: [
                {
                    id: "twitter:card",
                    label: "twitter:card present (summary or summary_large_image)",
                    check: (ctx) => {
                        const value = ctx.meta["twitter:card"];
                        return value === "summary" || value === "summary_large_image";
                    },
                    detail: (ctx) => {
                        const value = ctx.meta["twitter:card"];
                        return value ? `twitter:card=${value}` : "Missing";
                    },
                },
                presenceGuideline("twitter:title", "twitter:title provided"),
                presenceGuideline("twitter:description", "twitter:description provided (50-200 characters)", (ctx) => {
                    const value = ctx.meta["twitter:description"];
                    if (!value) return false;
                    return value.length >= 50 && value.length <= 200;
                }, (ctx) => {
                    const value = ctx.meta["twitter:description"];
                    return value ? `${value.length} chars: “${truncate(value, 100)}”` : "Missing";
                }),
                presenceGuideline("twitter:image", "twitter:image URL provided"),
                {
                    id: "twitter:site",
                    label: "twitter:site or twitter:creator handle provided",
                    check: (ctx) => Boolean(ctx.meta["twitter:site"] || ctx.meta["twitter:creator"]),
                    detail: (ctx) => {
                        const site = ctx.meta["twitter:site"];
                        const creator = ctx.meta["twitter:creator"];
                        if (site) return `twitter:site=${site}`;
                        if (creator) return `twitter:creator=${creator}`;
                        return "Missing";
                    },
                },
                presenceGuideline("twitter:image:alt", "twitter:image:alt text provided"),
            ],
            preview: (ctx) => ({
                title: ctx.meta["twitter:title"] || ctx.meta["og:title"] || ctx.title,
                description: ctx.meta["twitter:description"] || ctx.meta["og:description"] || ctx.description,
                image: resolveUrl(ctx.meta["twitter:image"] || ctx.meta["og:image"], ctx.baseUrl),
                url: ctx.meta["og:url"] || ctx.canonical || ctx.finalUrl,
                siteName: ctx.meta["twitter:site"] || ctx.hostname,
                cardType: ctx.meta["twitter:card"],
            }),
        },
        {
            name: "Facebook",
            slug: "facebook",
            summary: "Facebook shares rely on Open Graph metadata and benefit from image dimensions of at least 1200×630.",
            guidelines: [
                presenceGuideline("og:title", "og:title provided"),
                presenceGuideline("og:description", "og:description provided"),
                presenceGuideline("og:image", "og:image URL provided"),
                presenceGuideline("og:image:width", "og:image:width declared"),
                presenceGuideline("og:image:height", "og:image:height declared"),
                presenceGuideline("og:type", "og:type specified (usually website or article)"),
                presenceGuideline("og:url", "og:url provided"),
            ],
            preview: (ctx) => ({
                title: ctx.meta["og:title"] || ctx.title,
                description: ctx.meta["og:description"] || ctx.description,
                image: resolveUrl(ctx.meta["og:image"], ctx.baseUrl),
                url: ctx.meta["og:url"] || ctx.canonical || ctx.finalUrl,
                siteName: ctx.meta["og:site_name"] || ctx.hostname,
            }),
        },
        {
            name: "Mastodon",
            slug: "mastodon",
            summary: "Mastodon consumes Open Graph tags and prefers alt text for images.",
            guidelines: [
                presenceGuideline("og:title", "og:title provided"),
                presenceGuideline("og:description", "og:description provided"),
                presenceGuideline("og:image", "og:image URL provided"),
                presenceGuideline("og:image:alt", "og:image:alt text provided"),
                presenceGuideline("og:url", "og:url provided"),
            ],
            preview: (ctx) => ({
                title: ctx.meta["og:title"] || ctx.title,
                description: ctx.meta["og:description"] || ctx.description,
                image: resolveUrl(ctx.meta["og:image"], ctx.baseUrl),
                url: ctx.meta["og:url"] || ctx.canonical || ctx.finalUrl,
                siteName: ctx.meta["og:site_name"] || ctx.hostname,
            }),
        },
        {
            name: "Bluesky",
            slug: "bluesky",
            summary: "Bluesky currently mirrors Open Graph behaviour, prioritising title, description, and image.",
            guidelines: [
                presenceGuideline("og:title", "og:title provided"),
                presenceGuideline("og:description", "og:description provided"),
                presenceGuideline("og:image", "og:image URL provided"),
                presenceGuideline("og:url", "og:url provided"),
            ],
            preview: (ctx) => ({
                title: ctx.meta["og:title"] || ctx.title,
                description: ctx.meta["og:description"] || ctx.description,
                image: resolveUrl(ctx.meta["og:image"], ctx.baseUrl),
                url: ctx.meta["og:url"] || ctx.canonical || ctx.finalUrl,
                siteName: ctx.meta["og:site_name"] || ctx.hostname,
            }),
        },
    ];

    return {
        general: evaluateGuidelines(generalGuidelines, context),
        platforms: platformSpecs.map((platform) => ({
            name: platform.name,
            slug: platform.slug,
            summary: platform.summary,
            results: evaluateGuidelines(platform.guidelines, context),
            preview: platform.preview(context),
        })),
    };
}

function evaluateGuidelines(guidelines, context) {
    return guidelines.map((guideline) => {
        const pass = Boolean(guideline.check(context));
        const detail = typeof guideline.detail === "function" ? guideline.detail(context, pass) : (guideline.detail || "");
        return {
            id: guideline.id,
            label: guideline.label,
            pass,
            detail,
        };
    });
}

function presenceGuideline(key, label, customCheck, customDetail) {
    return {
        id: key,
        label,
        check: (ctx) => {
            if (typeof customCheck === "function") {
                return customCheck(ctx);
            }
            return Boolean(ctx.meta[key]);
        },
        detail: (ctx) => {
            if (typeof customDetail === "function") {
                return customDetail(ctx);
            }
            const value = ctx.meta[key];
            return value ? truncate(value, 100) : "Missing";
        },
    };
}

function truncate(value, maxLength = 120) {
    if (!value) return "";
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function resolveUrl(value, base) {
    if (!value) return "";
    try {
        if (base) {
            return new URL(value, base).toString();
        }
        return new URL(value).toString();
    } catch (error) {
        if (base) {
            try {
                return new URL(value, base).toString();
            } catch (_error) {
                return value;
            }
        }
        return value;
    }
}

function safeHostname(value) {
    try {
        return new URL(value).hostname;
    } catch (error) {
        return "";
    }
}
