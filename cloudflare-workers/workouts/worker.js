const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const INDEX_KEYS = {
    exercises: "exercises:index",
    templates: "templates:index",
};

const KEY_PREFIXES = {
    exercise: "exercise:",
    template: "template:",
    session: "session:",
    sessionsByTemplate: "sessionsByTemplate:",
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(code, message, status = 400) {
    return jsonResponse({ error: { code, message } }, status);
}

function unauthorized() {
    return errorResponse("UNAUTHORIZED", "Missing or invalid bearer token.", 401);
}

function notFound(code, message) {
    return errorResponse(code, message, 404);
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (error) {
        return { __error: "Invalid JSON body" };
    }
}

function isValidDate(dateStr) {
    if (typeof dateStr !== "string") return false;
    const match = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    if (!match) return false;
    const date = new Date(`${dateStr}T00:00:00Z`);
    return !Number.isNaN(date.getTime());
}

async function getIndex(env, key) {
    const raw = await env.WORKOUTS.get(key);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

async function saveIndex(env, key, values) {
    await env.WORKOUTS.put(key, JSON.stringify(values));
}

async function getJson(env, key) {
    const raw = await env.WORKOUTS.get(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

async function putJson(env, key, value) {
    await env.WORKOUTS.put(key, JSON.stringify(value));
}

function generateSessionId(createdAt) {
    const suffix = crypto.randomUUID().split("-")[0];
    return `session_${createdAt}_${suffix}`;
}

function validateExercisePayload(payload) {
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    const display_name = typeof payload?.display_name === "string" ? payload.display_name.trim() : "";

    if (!name) return { error: "Exercise name is required." };
    if (!display_name) return { error: "Exercise display_name is required." };
    return { name, display_name };
}

function validateRecords(records) {
    if (!Array.isArray(records)) return false;
    return records.every(
        (r) =>
            r &&
            typeof r === "object" &&
            Number.isFinite(Number(r.weight)) &&
            Number.isInteger(Number(r.reps)) &&
            Number(r.reps) >= 0
    );
}

function validateExerciseBlock(block, exercisesSet) {
    if (!block || typeof block !== "object") return { error: "Invalid exercise block." };
    const exercise_name = typeof block.exercise_name === "string" ? block.exercise_name.trim() : "";
    const sets = Number.isInteger(Number(block.sets)) ? Number(block.sets) : 0;
    const min_reps = Number.isInteger(Number(block.min_reps)) ? Number(block.min_reps) : 0;
    const max_reps = Number.isInteger(Number(block.max_reps)) ? Number(block.max_reps) : 0;
    const amrap = Boolean(block.amrap);
    const notes = typeof block.notes === "string" ? block.notes : "";

    if (!exercise_name) return { error: "exercise_name is required." };
    if (exercisesSet && !exercisesSet.has(exercise_name)) {
        return { error: `Exercise '${exercise_name}' does not exist.` };
    }
    if (sets < 1) return { error: "sets must be >= 1." };
    if (!amrap && min_reps > max_reps) return { error: "min_reps must be <= max_reps." };

    return { exercise_name, sets, min_reps, max_reps, amrap, notes };
}

function validateTemplatePayload(payload, exercisesSet) {
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (!name) return { error: "Template name is required." };
    const blocks = Array.isArray(payload?.exercise_blocks) ? payload.exercise_blocks : [];
    const normalizedBlocks = [];
    for (const block of blocks) {
        const validated = validateExerciseBlock(block, exercisesSet);
        if (validated.error) return { error: validated.error };
        normalizedBlocks.push(validated);
    }
    return { name, exercise_blocks: normalizedBlocks };
}

function normalizeSessionBlock(block) {
    const exercise_name = typeof block.exercise_name === "string" ? block.exercise_name.trim() : "";
    const notes = typeof block.notes === "string" ? block.notes : "";
    const rpe_reserve = Number.isInteger(Number(block.rpe_reserve)) ? Number(block.rpe_reserve) : null;
    const setsInput = Array.isArray(block.sets) ? block.sets : [];
    const sets = setsInput.map((s) => ({
        weight: Number(s.weight),
        reps: Number(s.reps),
    }));
    if (!exercise_name) return { error: "exercise_name is required in exercise_blocks." };
    if (sets.some((s) => !Number.isFinite(s.weight) || !Number.isInteger(s.reps))) {
        return { error: "sets must include weight (number) and reps (integer)." };
    }
    return { exercise_name, sets, notes, rpe_reserve };
}

function buildParetoRecords(existing, newRecord) {
    const dominates = (a, b) => a.weight > b.weight || (a.weight < b.weight && a.reps > b.reps);
    const filtered = existing.filter((record) => !dominates(newRecord, record));
    const dominatedByExisting = filtered.some((record) => dominates(record, newRecord));
    if (!dominatedByExisting) {
        filtered.push({ weight: newRecord.weight, reps: newRecord.reps });
    }
    return filtered;
}

async function updateExerciseRecordsFromSession(env, session) {
    const updates = new Map();
    for (const block of session.exercise_blocks) {
        if (!updates.has(block.exercise_name)) {
            updates.set(block.exercise_name, []);
        }
        for (const set of block.sets) {
            updates.get(block.exercise_name).push({ weight: Number(set.weight), reps: Number(set.reps) });
        }
    }

    for (const [exerciseName, sets] of updates.entries()) {
        const exerciseKey = `${KEY_PREFIXES.exercise}${exerciseName}`;
        const exercise = await getJson(env, exerciseKey);
        if (!exercise) continue;
        let records = Array.isArray(exercise.records) ? exercise.records : [];
        for (const record of sets) {
            records = buildParetoRecords(records, record);
        }
        exercise.records = records;
        await putJson(env, exerciseKey, exercise);
    }
}

async function ensureAuth(request, env) {
    const header = request.headers.get("Authorization") || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token || token !== env.WORKOUT_API_TOKEN) {
        return false;
    }
    return true;
}

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: JSON_HEADERS });
        }

        if (!(await ensureAuth(request, env))) {
            return unauthorized();
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/+/, "");
        const segments = path.split("/");

        try {
            if (segments[0] !== "api") {
                return notFound("NOT_FOUND", "Endpoint not found.");
            }

            // Exercises
            if (segments[1] === "exercises") {
                if (segments.length === 2 && request.method === "GET") {
                    const names = await getIndex(env, INDEX_KEYS.exercises);
                    const exercises = await Promise.all(
                        names.map(async (name) => {
                            const exercise = await getJson(env, `${KEY_PREFIXES.exercise}${name}`);
                            return exercise ? { name: exercise.name, display_name: exercise.display_name } : null;
                        })
                    );
                    return jsonResponse({ exercises: exercises.filter(Boolean) });
                }

                if (segments.length === 2 && request.method === "POST") {
                    const body = await readJson(request);
                    if (body.__error) return errorResponse("BAD_REQUEST", body.__error, 400);
                    const validated = validateExercisePayload(body);
                    if (validated.error) return errorResponse("BAD_REQUEST", validated.error, 400);

                    const index = await getIndex(env, INDEX_KEYS.exercises);
                    if (index.includes(validated.name)) {
                        return errorResponse(
                            "EXERCISE_ALREADY_EXISTS",
                            `Exercise '${validated.name}' already exists.`,
                            409
                        );
                    }

                    const exercise = { ...validated, records: [] };
                    await putJson(env, `${KEY_PREFIXES.exercise}${validated.name}`, exercise);
                    index.push(validated.name);
                    await saveIndex(env, INDEX_KEYS.exercises, index);
                    return jsonResponse(exercise, 201);
                }

                if (segments.length === 4 && segments[3] === "records") {
                    const exerciseName = decodeURIComponent(segments[2]);
                    const exerciseKey = `${KEY_PREFIXES.exercise}${exerciseName}`;
                    const exercise = await getJson(env, exerciseKey);
                    if (!exercise) {
                        return notFound("EXERCISE_NOT_FOUND", `Exercise '${exerciseName}' not found.`);
                    }

                    if (request.method === "GET") {
                        return jsonResponse({ exercise: exercise.name, records: exercise.records || [] });
                    }

                    if (request.method === "PUT") {
                        const body = await readJson(request);
                        if (body.__error) return errorResponse("BAD_REQUEST", body.__error, 400);
                        if (!validateRecords(body.records)) {
                            return errorResponse("BAD_REQUEST", "records must be an array of {weight, reps}.", 400);
                        }
                        exercise.records = body.records.map((r) => ({ weight: Number(r.weight), reps: Number(r.reps) }));
                        await putJson(env, exerciseKey, exercise);
                        return jsonResponse({ exercise: exercise.name, records: exercise.records });
                    }
                }

                if (segments.length === 3 && request.method === "DELETE") {
                    const exerciseName = decodeURIComponent(segments[2]);
                    const exerciseKey = `${KEY_PREFIXES.exercise}${exerciseName}`;
                    const exercise = await getJson(env, exerciseKey);
                    if (!exercise) {
                        return notFound("EXERCISE_NOT_FOUND", `Exercise '${exerciseName}' not found.`);
                    }

                    const templateNames = await getIndex(env, INDEX_KEYS.templates);
                    const templates = await Promise.all(
                        templateNames.map((name) => getJson(env, `${KEY_PREFIXES.template}${name}`))
                    );
                    const inUse = templates.some((t) => t?.exercise_blocks?.some((b) => b.exercise_name === exerciseName));
                    if (inUse) {
                        return errorResponse("EXERCISE_IN_USE", `Exercise '${exerciseName}' is used by a template.`, 409);
                    }

                    await env.WORKOUTS.delete(exerciseKey);
                    const newExerciseIndex = (await getIndex(env, INDEX_KEYS.exercises)).filter((n) => n !== exerciseName);
                    await saveIndex(env, INDEX_KEYS.exercises, newExerciseIndex);
                    return new Response(null, { status: 204, headers: JSON_HEADERS });
                }
            }

            // Templates
            if (segments[1] === "templates") {
                if (segments.length === 2 && request.method === "GET") {
                    const templates = await getIndex(env, INDEX_KEYS.templates);
                    return jsonResponse({ templates });
                }

                if (segments.length === 2 && request.method === "POST") {
                    const body = await readJson(request);
                    if (body.__error) return errorResponse("BAD_REQUEST", body.__error, 400);
                    const exerciseNames = new Set(await getIndex(env, INDEX_KEYS.exercises));
                    const validated = validateTemplatePayload(body, exerciseNames);
                    if (validated.error) return errorResponse("BAD_REQUEST", validated.error, 400);

                    const templateIndex = await getIndex(env, INDEX_KEYS.templates);
                    if (templateIndex.includes(validated.name)) {
                        return errorResponse(
                            "TEMPLATE_ALREADY_EXISTS",
                            `Template '${validated.name}' already exists.`,
                            409
                        );
                    }

                    await putJson(env, `${KEY_PREFIXES.template}${validated.name}`, validated);
                    templateIndex.push(validated.name);
                    await saveIndex(env, INDEX_KEYS.templates, templateIndex);
                    return jsonResponse(validated, 201);
                }

                if (segments.length === 3 && request.method === "GET") {
                    const name = decodeURIComponent(segments[2]);
                    const template = await getJson(env, `${KEY_PREFIXES.template}${name}`);
                    if (!template) {
                        return notFound("TEMPLATE_NOT_FOUND", `Template '${name}' not found.`);
                    }
                    return jsonResponse(template);
                }

                if (segments.length === 3 && request.method === "DELETE") {
                    const name = decodeURIComponent(segments[2]);
                    const templateKey = `${KEY_PREFIXES.template}${name}`;
                    const template = await getJson(env, templateKey);
                    if (!template) {
                        return notFound("TEMPLATE_NOT_FOUND", `Template '${name}' not found.`);
                    }
                    await env.WORKOUTS.delete(templateKey);
                    const templateIndex = (await getIndex(env, INDEX_KEYS.templates)).filter((t) => t !== name);
                    await saveIndex(env, INDEX_KEYS.templates, templateIndex);
                    return new Response(null, { status: 204, headers: JSON_HEADERS });
                }

                if (segments.length === 4 && segments[3] === "sessions" && request.method === "GET") {
                    const name = decodeURIComponent(segments[2]);
                    const template = await getJson(env, `${KEY_PREFIXES.template}${name}`);
                    const sessionIndexKey = `${KEY_PREFIXES.sessionsByTemplate}${name}`;
                    const sessionIndex = await getIndex(env, sessionIndexKey);
                    if (!template && sessionIndex.length === 0) {
                        return notFound("TEMPLATE_NOT_FOUND", `Template '${name}' not found.`);
                    }
                    const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
                    const offsetParam = parseInt(url.searchParams.get("offset") || "0", 10);
                    const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 50, 500);
                    const offset = Number.isFinite(offsetParam) ? offsetParam : 0;
                    const slice = sessionIndex.slice(offset, offset + limit);
                    const sessions = await Promise.all(
                        slice.map(async (entry) => getJson(env, `${KEY_PREFIXES.session}${entry.id}`))
                    );
                    return jsonResponse({
                        template_name: name,
                        total: sessionIndex.length,
                        limit,
                        offset,
                        sessions: sessions.filter(Boolean),
                    });
                }
            }

            // Sessions
            if (segments[1] === "sessions") {
                if (segments.length === 2 && request.method === "POST") {
                    const body = await readJson(request);
                    if (body.__error) return errorResponse("BAD_REQUEST", body.__error, 400);
                    const templateName = typeof body.template_name === "string" ? body.template_name.trim() : "";
                    if (!templateName) return errorResponse("BAD_REQUEST", "template_name is required.", 400);
                    const template = await getJson(env, `${KEY_PREFIXES.template}${templateName}`);
                    if (!template) {
                        return notFound("TEMPLATE_NOT_FOUND", `Template '${templateName}' not found.`);
                    }

                    if (!isValidDate(body.date)) {
                        return errorResponse("INVALID_DATE", "date must be YYYY-MM-DD.", 400);
                    }

                    const exerciseBlocks = Array.isArray(body.exercise_blocks) ? body.exercise_blocks : [];
                    const normalizedBlocks = [];
                    for (const block of exerciseBlocks) {
                        const normalized = normalizeSessionBlock(block);
                        if (normalized.error) return errorResponse("BAD_REQUEST", normalized.error, 400);
                        normalizedBlocks.push(normalized);
                    }

                    const created_at = new Date().toISOString();
                    const id = generateSessionId(created_at);
                    const session = {
                        id,
                        template_name: templateName,
                        date: body.date,
                        created_at,
                        notes: typeof body.notes === "string" ? body.notes : "",
                        exercise_blocks: normalizedBlocks,
                    };

                    await putJson(env, `${KEY_PREFIXES.session}${id}`, session);
                    const sessionIndexKey = `${KEY_PREFIXES.sessionsByTemplate}${templateName}`;
                    const index = await getIndex(env, sessionIndexKey);
                    index.push({ id: session.id, date: session.date, created_at: session.created_at });
                    index.sort((a, b) => {
                        if (a.date === b.date) {
                            return b.created_at.localeCompare(a.created_at);
                        }
                        return b.date.localeCompare(a.date);
                    });
                    await saveIndex(env, sessionIndexKey, index);

                    await updateExerciseRecordsFromSession(env, session);

                    return jsonResponse(session, 201);
                }

                if (segments.length === 3 && request.method === "GET") {
                    const id = decodeURIComponent(segments[2]);
                    const session = await getJson(env, `${KEY_PREFIXES.session}${id}`);
                    if (!session) {
                        return notFound("SESSION_NOT_FOUND", `Session '${id}' not found.`);
                    }
                    return jsonResponse(session);
                }
            }

            return notFound("NOT_FOUND", "Endpoint not found.");
        } catch (error) {
            console.error("Unhandled error", error);
            return errorResponse("INTERNAL_ERROR", "Internal Server Error", 500);
        }
    },
};
