Below is a self-contained REST API specification for a Cloudflare Worker that uses a single KV namespace WORKOUTS to manage exercises, personal-best records, workout templates, and logged workout sessions.

⸻

1. Overview

Single-user REST API implemented as a Cloudflare Worker with a bound KV namespace:

export interface Env {
  WORKOUTS: KVNamespace;
  API_BEARER_TOKEN: string; // secret
}

All data is stored in WORKOUTS. The API is designed for one authenticated user and assumes low-to-moderate data volume (personal use).

Base URL (example):

https://workouts.example.com/api

All responses are JSON and use UTF-8.

⸻

2. Authentication

Authentication is via a single bearer token.

Request
	•	Header:
Authorization: Bearer <token>

Behavior
	•	If header missing or malformed → 401 Unauthorized
	•	If token != Env.API_BEARER_TOKEN → 401 Unauthorized

Error format (standard)

All errors follow:

{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message"
  }
}

Common codes:
	•	UNAUTHORIZED
	•	BAD_REQUEST
	•	NOT_FOUND
	•	CONFLICT
	•	INTERNAL_ERROR

⸻

3. Domain Model

3.1 Exercise

Represents a unique exercise name plus its personal-best records.

{
  "name": "bench_press",
  "display_name": "Bench Press",
  "records": [
    { "weight": 100.0, "reps": 5 },
    { "weight": 90.0,  "reps": 8 }
  ]
}

	•	name (string): unique ID (slug-like). Used as primary key.
	•	display_name (string): human-readable name.
	•	records (array): list of best sets.
	•	weight (number): weight used.
	•	reps (integer): repetitions.

Semantics for records maintenance:
	•	A new record (w, r) is considered “better” than an existing (w0, r0) if:
	•	w > w0, or
	•	w < w0 and r > r0.
	•	When automatically updating from workout sessions:
	•	Add (w, r) if it is not strictly dominated by any existing record.
	•	Remove any existing records that are strictly dominated by (w, r).
(This yields a Pareto frontier of best sets.)

Manual PUT /exercises/{name}/records overwrites the list exactly; no automatic sorting/pruning required.

⸻

3.2 Workout Template

Represents a reusable workout structure.

{
  "name": "upper_body_a",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": 4,
      "min_reps": 6,
      "max_reps": 8,
      "amrap": false,
      "notes": "Tempo 2-1-1, 2min rest"
    },
    {
      "exercise_name": "pull_up",
      "sets": 3,
      "min_reps": 5,
      "max_reps": 8,
      "amrap": true,
      "notes": "Bodyweight, full ROM"
    }
  ]
}

	•	name (string): unique template name (primary key).
	•	exercise_blocks (array, ordered):
	•	exercise_name (string): must reference an existing exercise name.
	•	sets (integer ≥ 1): planned number of sets.
	•	min_reps, max_reps (integers): rep range.
	•	amrap (boolean): “as many reps as possible” flag.
	•	notes (string): arbitrary instructions.

⸻

3.3 Workout Session (Registered Workout)

Represents one completed session based on a template.

{
  "id": "session_2025-01-20T18:45:00Z_abc123", 
  "template_name": "upper_body_a",
  "date": "2025-01-20",
  "created_at": "2025-01-20T18:45:00Z",
  "notes": "Felt strong. Slight shoulder tightness.",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": [
        { "weight": 90.0, "reps": 8 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 100.0, "reps": 4 }
      ],
      "notes": "Last set close to failure",
      "rpe_reserve": 1
    },
    {
      "exercise_name": "pull_up",
      "sets": [
        { "weight": 0.0, "reps": 10 },
        { "weight": 0.0, "reps": 8 },
        { "weight": 0.0, "reps": 7 }
      ],
      "notes": "",
      "rpe_reserve": 2
    }
  ]
}

Fields:
	•	id (string): unique session ID (e.g., ULID or generated UUID).
	•	template_name (string): reference to WorkoutTemplate.name.
	•	date (string): workout calendar date in YYYY-MM-DD.
	•	created_at (string): ISO 8601 timestamp in UTC.
	•	notes (string): optional.
	•	exercise_blocks (array, ordered):
	•	exercise_name (string).
	•	sets (array of set records):
	•	weight (number).
	•	reps (integer).
	•	notes (string).
	•	rpe_reserve (integer): number of reps in reserve after last set.

When a session is registered:
	•	For each exercise_block and each set (weight, reps):
	•	The worker evaluates whether it should be used to update the corresponding Exercise’s records using the rule in 3.1.
	•	The session is stored and indexed under its template name for later queries.

⸻

4. KV Storage Layout

All keys in the single WORKOUTS KV.

4.1 Exercises
	•	exercises:index
JSON array of exercise names (strings):

["bench_press", "pull_up", "squat"]


	•	exercise:<name>
JSON document of type Exercise (3.1).

4.2 Workout Templates
	•	templates:index
JSON array of template names:

["upper_body_a", "lower_body_a"]


	•	template:<name>
JSON document of type WorkoutTemplate (3.2).

4.3 Sessions
	•	session:<id>
JSON document of type WorkoutSession (3.3).
	•	sessionsByTemplate:<template_name>
JSON array of objects, ordered most recent first by (date, created_at):

[
  { "id": "session_2025-01-20T18:45:00Z_abc123", "date": "2025-01-20", "created_at": "2025-01-20T18:45:00Z" },
  { "id": "session_2025-01-10T18:40:00Z_def456", "date": "2025-01-10", "created_at": "2025-01-10T18:40:00Z" }
]



This index supports:
	•	“Most recent session for template X” (take first entry).
	•	“All sessions for template X” (read entire array and then each session).

For a personal app this is sufficient; pagination can be a simple offset/limit over this list.

⸻

5. Endpoints

All endpoints require authentication and return JSON.

5.1 Exercises

5.1.1 List all exercises
GET /exercises

Response 200:

{
  "exercises": [
    {
      "name": "bench_press",
      "display_name": "Bench Press"
    },
    {
      "name": "pull_up",
      "display_name": "Pull-up"
    }
  ]
}

Notes:
	•	This can be derived from exercises:index + minimal per-exercise metadata (either stored redundantly or fetched individually).

⸻

5.1.2 Create new unique exercise
POST /exercises

Request body:

{
  "name": "bench_press",
  "display_name": "Bench Press"
}

	•	name:
	•	required.
	•	must be unique; only [a-z0-9_-] recommended.
	•	display_name:
	•	required.
	•	any string.

Behavior:
	•	If an exercise with same name already exists → 409 Conflict:

{
  "error": {
    "code": "EXERCISE_ALREADY_EXISTS",
    "message": "Exercise 'bench_press' already exists."
  }
}


	•	On success:
	•	Create exercise:<name> with empty records list:

{
  "name": "bench_press",
  "display_name": "Bench Press",
  "records": []
}


	•	Append name to exercises:index.

Response 201:

{
  "name": "bench_press",
  "display_name": "Bench Press",
  "records": []
}


⸻

5.1.3 Delete exercise
DELETE /exercises/{name}

Behavior:
	•	If exercise does not exist → 404 Not Found:

{
  "error": {
    "code": "EXERCISE_NOT_FOUND",
    "message": "Exercise 'bench_press' not found."
  }
}


	•	On success:
	•	Delete exercise:<name>.
	•	Remove name from exercises:index.
	•	The spec does not require cascading updates to templates/sessions; implementer can choose to:
	•	forbid deletion if exercise is used in any template; or
	•	allow deletion leaving templates/sessions with dangling references.
A common choice: respond 409 CONFLICT if exercise is referenced in any template.

Response 204: No body.

⸻

5.1.4 Get records for an exercise
GET /exercises/{name}/records

Response 200:

{
  "exercise": "bench_press",
  "records": [
    { "weight": 100.0, "reps": 5 },
    { "weight": 90.0,  "reps": 8 }
  ]
}

	•	If exercise not found → 404 EXERCISE_NOT_FOUND.

⸻

5.1.5 Set records for an exercise
PUT /exercises/{name}/records

Request body:

{
  "records": [
    { "weight": 100.0, "reps": 5 },
    { "weight": 90.0,  "reps": 8 }
  ]
}

Behavior:
	•	Overwrites the entire records list for that exercise.
	•	Validation:
	•	records must be an array of {weight: number, reps: integer}.
	•	Optional: reject negative weights or reps.

Response 200:

{
  "exercise": "bench_press",
  "records": [
    { "weight": 100.0, "reps": 5 },
    { "weight": 90.0,  "reps": 8 }
  ]
}


⸻

5.2 Workout Templates

5.2.1 List template names
GET /templates

Returns only template names for easy querying.

Response 200:

{
  "templates": [
    "upper_body_a",
    "lower_body_a"
  ]
}


⸻

5.2.2 Create new workout template
POST /templates

Request body:

{
  "name": "upper_body_a",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": 4,
      "min_reps": 6,
      "max_reps": 8,
      "amrap": false,
      "notes": "Tempo 2-1-1"
    }
  ]
}

Validation:
	•	name required; must be unique.
	•	exercise_blocks is an ordered array; length ≥ 1 recommended but not mandatory.
	•	Each block:
	•	exercise_name must reference an existing exercise or be allowed to be “future” (recommended: enforce existence).
	•	sets ≥ 1.
	•	min_reps ≤ max_reps.
	•	amrap boolean.
	•	notes string (may be empty).

Behavior:
	•	If template:<name> exists → 409 TEMPLATE_ALREADY_EXISTS.
	•	On success:
	•	Store under template:<name>.
	•	Append name to templates:index.

Response 201:

Returns the created template:

{
  "name": "upper_body_a",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": 4,
      "min_reps": 6,
      "max_reps": 8,
      "amrap": false,
      "notes": "Tempo 2-1-1"
    }
  ]
}


⸻

5.2.3 Get workout template by name
GET /templates/{name}

Response 200:

{
  "name": "upper_body_a",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": 4,
      "min_reps": 6,
      "max_reps": 8,
      "amrap": false,
      "notes": "Tempo 2-1-1"
    }
  ]
}

	•	If not found → 404 TEMPLATE_NOT_FOUND.

⸻

5.2.4 Delete workout template by name
DELETE /templates/{name}

Behavior:
	•	If template does not exist → 404 TEMPLATE_NOT_FOUND.
	•	On success:
	•	Delete template:<name>.
	•	Remove from templates:index.
	•	Keep sessions that reference this template intact (historical integrity).
They will still be queryable by GET /templates/{name}/sessions as long as the index sessionsByTemplate:<name> exists, even if template is gone—implementer may decide whether to also delete that index.

Response 204: No body.

⸻

5.3 Sessions (Registered Workouts)

5.3.1 Register a workout session
POST /sessions

Request body:

{
  "template_name": "upper_body_a",
  "date": "2025-01-20",
  "notes": "Good session.",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": [
        { "weight": 90.0, "reps": 8 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 100.0, "reps": 4 }
      ],
      "notes": "Last set RPE 9",
      "rpe_reserve": 1
    }
  ]
}

Fields:
	•	template_name: required; must exist.
	•	date: string YYYY-MM-DD (optional; if omitted, worker can default to “today” in UTC or configured timezone).
	•	notes: optional string.
	•	exercise_blocks: ordered array matching the performed workout.
It does not have to match the template exactly, but exercise_names should exist.

Each exercise_block:
	•	exercise_name: required.
	•	sets: non-empty array of {weight, reps}.
	•	notes: string, may be empty.
	•	rpe_reserve: integer (may be required or optional; if optional, default 0 or null).

Behavior:
	1.	Validate:
	•	Template exists.
	•	Each exercise_name exists as an exercise (recommended).
	2.	Generate id and created_at.
	•	created_at: server timestamp new Date().toISOString().
	3.	Write session:<id> with full session object.
	4.	Update sessionsByTemplate:<template_name>:
	•	Insert a record {id, date, created_at} in order so that the list remains most-recent-first.
	5.	For each set in each exercise_block:
	•	Load exercise exercise:<exercise_name>.
	•	For each set (weight, reps):
	•	If (weight, reps) is a “better” record than existing ones (3.1), update records.
	•	Save modified exercise back to KV.

Response 201:

{
  "id": "session_2025-01-20T18:45:00Z_abc123",
  "template_name": "upper_body_a",
  "date": "2025-01-20",
  "created_at": "2025-01-20T18:45:00Z",
  "notes": "Good session.",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": [
        { "weight": 90.0, "reps": 8 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 100.0, "reps": 4 }
      ],
      "notes": "Last set RPE 9",
      "rpe_reserve": 1
    }
  ]
}


⸻

5.3.2 Get most recent session for a template
GET /templates/{name}/sessions/latest

Behavior:
	•	Read sessionsByTemplate:<name>.
	•	Take first element’s id.
	•	Load session:<id>.
	•	If template has no sessions → 404 NO_SESSIONS_FOR_TEMPLATE.
	•	If template does not exist but sessionsByTemplate does, behavior may be:
	•	Return sessions as long as they exist; or
	•	Treat missing template as 404 TEMPLATE_NOT_FOUND.
The simpler choice: if sessionsByTemplate key exists and has entries, return latest regardless of current template existence.

Response 200:

{
  "id": "session_2025-01-20T18:45:00Z_abc123",
  "template_name": "upper_body_a",
  "date": "2025-01-20",
  "created_at": "2025-01-20T18:45:00Z",
  "notes": "Good session.",
  "exercise_blocks": [
    {
      "exercise_name": "bench_press",
      "sets": [
        { "weight": 90.0, "reps": 8 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 95.0, "reps": 6 },
        { "weight": 100.0, "reps": 4 }
      ],
      "notes": "Last set RPE 9",
      "rpe_reserve": 1
    }
  ]
}


⸻

5.3.3 Get all sessions for a template
GET /templates/{name}/sessions

Supports simple pagination via query params:
	•	?limit=<int> (optional, default e.g. 50, max e.g. 500)
	•	?offset=<int> (optional, default 0)

Behavior:
	•	Read sessionsByTemplate:<name>.
	•	Slice using offset and limit.
	•	Fetch each session:<id>.

Response 200:

{
  "template_name": "upper_body_a",
  "total": 2,
  "limit": 50,
  "offset": 0,
  "sessions": [
    {
      "id": "session_2025-01-20T18:45:00Z_abc123",
      "template_name": "upper_body_a",
      "date": "2025-01-20",
      "created_at": "2025-01-20T18:45:00Z",
      "notes": "Good session.",
      "exercise_blocks": [ /* ... */ ]
    },
    {
      "id": "session_2025-01-10T18:40:00Z_def456",
      "template_name": "upper_body_a",
      "date": "2025-01-10",
      "created_at": "2025-01-10T18:40:00Z",
      "notes": "Ok session.",
      "exercise_blocks": [ /* ... */ ]
    }
  ]
}

	•	If no sessions: return 200 with "total": 0 and an empty "sessions": [].
	•	If template truly doesn’t exist and there is also no sessionsByTemplate key: return 404 TEMPLATE_NOT_FOUND.

⸻

5.3.4 (Optional) Get a session by ID
Not strictly required, but useful.

GET /sessions/{id}

Response 200:

{
  "id": "session_2025-01-20T18:45:00Z_abc123",
  "template_name": "upper_body_a",
  "date": "2025-01-20",
  "created_at": "2025-01-20T18:45:00Z",
  "notes": "Good session.",
  "exercise_blocks": [ /* ... */ ]
}

	•	If not found → 404 SESSION_NOT_FOUND.

⸻

6. Error Handling Summary

All non-2xx responses are JSON:

{
  "error": {
    "code": "SOME_CODE",
    "message": "Human-readable description"
  }
}

Suggested codes:
	•	Authentication/authorization:
	•	UNAUTHORIZED
	•	Validation:
	•	BAD_REQUEST
	•	INVALID_DATE
	•	INVALID_SETS
	•	Resource existence:
	•	EXERCISE_NOT_FOUND
	•	EXERCISE_ALREADY_EXISTS
	•	TEMPLATE_NOT_FOUND
	•	TEMPLATE_ALREADY_EXISTS
	•	SESSION_NOT_FOUND
	•	NO_SESSIONS_FOR_TEMPLATE
	•	Conflicts:
	•	CONFLICT
	•	EXERCISE_IN_USE (if you choose to prevent deleting referenced exercises)
	•	Internal:
	•	INTERNAL_ERROR

⸻

7. Non-functional Notes (for implementers)
	•	All KV accesses must be awaited; for batch reads (e.g. sessions for a template), use Promise.all.
	•	Write operations that update multiple keys (index + object) should be done carefully to avoid inconsistency; for this single-user scenario, “best effort” is acceptable:
	•	Update object first, then update index.
	•	When updating records from sessions, prefer to:
	•	Load exercise once per exercise per session.
	•	Use all sets for that exercise to update the record set.
	•	Save exercise once.
