const FRONTEND_ORIGIN = "https://tools.mathspp.com";
const WORKOUTS_KEY = "user:me:workouts";

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
    };
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders(),
        },
    });
}

function unauthorizedResponse() {
    return jsonResponse({ error: "Unauthorized" }, 401);
}

function isAuthorized(request, env) {
    const auth = request.headers.get("Authorization") || "";
    const expected = `Bearer ${env.WORKOUT_API_TOKEN}`;
    return auth === expected;
}

function handleOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (error) {
        return { error: "Invalid JSON body" };
    }
}

async function getWorkouts(env) {
    const workouts = await env.WORKOUTS.get(WORKOUTS_KEY, "json");
    return Array.isArray(workouts) ? workouts : [];
}

async function saveWorkouts(env, workouts) {
    await env.WORKOUTS.put(WORKOUTS_KEY, JSON.stringify(workouts));
}

function normalizeExerciseBlock(block) {
    if (!block || typeof block !== "object") {
        return null;
    }

    const name = typeof block.name === "string" ? block.name.trim() : "";
    const sets = Number.isFinite(Number(block.sets)) ? Number(block.sets) : 0;
    const repRange = block.repRange || {};
    const min = Number.isFinite(Number(repRange.min)) ? Number(repRange.min) : 0;
    const max = Number.isFinite(Number(repRange.max)) ? Number(repRange.max) : 0;
    const notes = typeof block.notes === "string" ? block.notes : "";

    if (!name) {
        return null;
    }

    return {
        id: block.id || crypto.randomUUID(),
        name,
        sets: sets < 0 ? 0 : Math.round(sets),
        repRange: {
            min,
            max,
        },
        notes,
    };
}

function updateTimestamps(existing) {
    const now = new Date().toISOString();
    if (!existing.createdAt) {
        existing.createdAt = now;
    }
    existing.updatedAt = now;
    return existing;
}

function findWorkout(workouts, id) {
    return workouts.find((workout) => workout.id === id);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return handleOptions();
        }

        if (!isAuthorized(request, env)) {
            return unauthorizedResponse();
        }

        if (url.pathname === "/api/workouts" && request.method === "GET") {
            const workouts = await getWorkouts(env);
            return jsonResponse(workouts);
        }

        if (url.pathname === "/api/workouts" && request.method === "POST") {
            const body = await readJson(request);
            if (body.error) {
                return jsonResponse({ error: body.error }, 400);
            }

            const name = typeof body.name === "string" ? body.name.trim() : "";
            if (!name) {
                return jsonResponse({ error: "Workout name is required" }, 400);
            }

            const exerciseBlocksInput = Array.isArray(body.exerciseBlocks)
                ? body.exerciseBlocks
                : [];
            const normalizedBlocks = exerciseBlocksInput
                .map(normalizeExerciseBlock)
                .filter(Boolean);

            if (normalizedBlocks.length === 0) {
                return jsonResponse({ error: "At least one exercise block is required" }, 400);
            }

            const workouts = await getWorkouts(env);
            const workout = updateTimestamps({
                id: body.id || crypto.randomUUID(),
                name,
                exerciseBlocks: normalizedBlocks,
                createdAt: undefined,
                updatedAt: undefined,
            });

            workouts.push(workout);
            await saveWorkouts(env, workouts);
            return jsonResponse(workout, 201);
        }

        if (url.pathname.startsWith("/api/workouts/")) {
            const id = decodeURIComponent(url.pathname.replace("/api/workouts/", ""));

            if (!id) {
                return jsonResponse({ error: "Workout id is required" }, 400);
            }

            const workouts = await getWorkouts(env);
            const existing = findWorkout(workouts, id);

            if (!existing) {
                return jsonResponse({ error: "Workout not found" }, 404);
            }

            if (request.method === "GET") {
                return jsonResponse(existing);
            }

            if (request.method === "DELETE") {
                const updated = workouts.filter((workout) => workout.id !== id);
                await saveWorkouts(env, updated);
                return jsonResponse({ success: true });
            }

            if (request.method === "PUT") {
                const body = await readJson(request);
                if (body.error) {
                    return jsonResponse({ error: body.error }, 400);
                }

                const name = typeof body.name === "string" ? body.name.trim() : existing.name;
                const exerciseBlocksInput = Array.isArray(body.exerciseBlocks)
                    ? body.exerciseBlocks
                    : existing.exerciseBlocks;
                const normalizedBlocks = exerciseBlocksInput
                    .map(normalizeExerciseBlock)
                    .filter(Boolean);

                if (normalizedBlocks.length === 0) {
                    return jsonResponse({ error: "At least one exercise block is required" }, 400);
                }

                existing.name = name;
                existing.exerciseBlocks = normalizedBlocks;
                updateTimestamps(existing);
                await saveWorkouts(env, workouts);
                return jsonResponse(existing);
            }
        }

        return jsonResponse({ error: "Not found" }, 404);
    },
};
