const FRONTEND_ORIGIN = "https://tools.mathspp.com";
const WORKOUTS_KEY = "user:me:workouts";
const WORKOUT_LOGS_PREFIX = "user:me:workoutLogs:";

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

function serverErrorResponse(message = "Internal Server Error") {
    return jsonResponse({ error: message }, 500);
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

function assertKvBinding(env) {
    if (!env.WORKOUTS || typeof env.WORKOUTS.get !== "function" || typeof env.WORKOUTS.put !== "function") {
        throw new Error("WORKOUTS KV binding is not configured");
    }
}

function safeParseArray(raw) {
    if (!raw) {
        return [];
    }

    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("Failed to parse stored array", error);
        return [];
    }
}

async function getWorkouts(env) {
    assertKvBinding(env);
    const workouts = await env.WORKOUTS.get(WORKOUTS_KEY);
    return safeParseArray(workouts);
}

async function saveWorkouts(env, workouts) {
    assertKvBinding(env);
    await env.WORKOUTS.put(WORKOUTS_KEY, JSON.stringify(workouts));
}

async function getWorkoutLogs(env, workoutId) {
    assertKvBinding(env);
    const logs = await env.WORKOUTS.get(`${WORKOUT_LOGS_PREFIX}${workoutId}`);
    const parsed = safeParseArray(logs);
    return parsed.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
}

async function saveWorkoutLogs(env, workoutId, logs) {
    assertKvBinding(env);
    const sorted = [...logs].sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
    await env.WORKOUTS.put(`${WORKOUT_LOGS_PREFIX}${workoutId}`, JSON.stringify(sorted));
}

function normalizeExerciseBlock(block) {
    if (!block || typeof block !== "object") {
        return null;
    }

    const name = typeof block.name === "string" ? block.name.trim() : "";
    const sets = Number.isFinite(Number(block.sets)) ? Number(block.sets) : 0;
    const amrap = Boolean(block.amrap);
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
        amrap,
        repRange: amrap
            ? null
            : {
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

function normalizeSet(set, setIndex) {
    const weight = Number.isFinite(Number(set?.weight)) ? Number(set.weight) : null;
    const reps = Number.isFinite(Number(set?.reps)) ? Number(set.reps) : null;
    const rir = Number.isFinite(Number(set?.rir)) ? Number(set.rir) : null;
    const notes = typeof set?.notes === "string" ? set.notes.trim() : "";

    return {
        setIndex,
        weight,
        reps,
        rir,
        notes,
    };
}

function normalizeExerciseLog(block, payloadExercise) {
    const sets = [];
    const providedSets = Array.isArray(payloadExercise?.sets) ? payloadExercise.sets : [];

    for (let i = 0; i < block.sets; i += 1) {
        sets.push(normalizeSet(providedSets[i] || {}, i));
    }

    const progressionNotes =
        typeof payloadExercise?.progressionNotes === "string" ? payloadExercise.progressionNotes.trim() : "";

    return {
        blockId: block.id,
        blockName: block.name,
        sets,
        progressionNotes,
    };
}

function buildLogEntry(template, payload) {
    const startedAt = typeof payload?.startedAt === "string" ? payload.startedAt : null;
    const finishedAt = typeof payload?.finishedAt === "string" ? payload.finishedAt : null;
    const overallNotes = typeof payload?.overallNotes === "string" ? payload.overallNotes.trim() : "";

    const payloadExercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
    const exerciseMap = new Map(payloadExercises.map((ex) => [ex?.blockId, ex]));

    const exercises = template.exerciseBlocks.map((block) => {
        const payloadExercise = exerciseMap.get(block.id) || {};
        return normalizeExerciseLog(block, payloadExercise);
    });

    const completedAt = finishedAt || new Date().toISOString();

    return {
        id: crypto.randomUUID(),
        workoutTemplateId: template.id,
        templateName: template.name,
        startedAt: startedAt || completedAt,
        finishedAt: completedAt,
        overallNotes,
        exercises,
    };
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const pathParts = url.pathname.replace(/^\/+/, "").split("/");

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

            if (pathParts[0] === "api" && pathParts[1] === "workouts" && pathParts[2]) {
                const id = decodeURIComponent(pathParts[2]);
                const workouts = await getWorkouts(env);
                const existing = findWorkout(workouts, id);

                if (!existing) {
                    return jsonResponse({ error: "Workout not found" }, 404);
                }

                if (pathParts[3] === "logs") {
                    if (request.method === "GET" && pathParts[4] === "latest") {
                        const logs = await getWorkoutLogs(env, id);
                        const latest = logs[0] || null;
                        return jsonResponse({ log: latest });
                    }

                    if (request.method === "GET") {
                        const logs = await getWorkoutLogs(env, id);
                        return jsonResponse({ logs });
                    }

                    if (request.method === "POST") {
                        const body = await readJson(request);
                        if (body.error) {
                            return jsonResponse({ error: body.error }, 400);
                        }

                        const logEntry = buildLogEntry(existing, body);
                        const logs = await getWorkoutLogs(env, id);
                        logs.push(logEntry);
                        await saveWorkoutLogs(env, id, logs);
                        return jsonResponse(logEntry, 201);
                    }
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
        } catch (error) {
            console.error("Unhandled error in workouts worker", error);
            return serverErrorResponse(error.message);
        }
    },
};
