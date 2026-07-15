const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function authorized(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return { ok: false, status: 500, error: "ADMIN_TOKEN is not configured." };
  const provided = request.headers.get("x-admin-token") || "";
  if (provided !== expected) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true };
}

function clean(value, max = 10000) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return jsonResponse({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  const auth = authorized(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 250);

  const result = await env.DB.prepare(`
    SELECT
      id, created_at, updated_at, status,
      full_name, email, phone, location, preferred_contact_method,
      received_ifa_before, received_tehuti_before, spiritual_or_initiation_status,
      primary_concern_category, primary_reason, why_now,
      question_1, question_2, question_3,
      odu, orisha, tehuti_neter, ire_ibi, ebo_summary, follow_up_needed, notes
    FROM intake_submissions
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return jsonResponse({ ok: true, submissions: result.results || [] });
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!env.DB) {
    return jsonResponse({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  const auth = authorized(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  let data;
  try {
    data = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const id = clean(data.id, 80);
  if (!id) return jsonResponse({ ok: false, error: "Missing intake id." }, 400);

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE intake_submissions
      SET
        updated_at = ?,
        status = ?,
        odu = ?,
        orisha = ?,
        tehuti_neter = ?,
        ire_ibi = ?,
        ebo_summary = ?,
        follow_up_needed = ?,
        notes = ?
      WHERE id = ?
    `).bind(
      now,
      clean(data.status, 80) || "new_intake",
      clean(data.odu, 500),
      clean(data.orisha, 500),
      clean(data.tehutiNeter, 500),
      clean(data.ireIbi, 500),
      clean(data.eboSummary, 5000),
      clean(data.followUpNeeded, 1000),
      clean(data.notes, 10000),
      id
    ),
    env.DB.prepare(`
      INSERT INTO interaction_log (id, intake_id, created_at, event_type, summary, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      eventId,
      id,
      now,
      "admin_update",
      "Admin updated reading/client record",
      JSON.stringify({
        status: clean(data.status, 80),
        odu: clean(data.odu, 500),
        orisha: clean(data.orisha, 500),
        tehutiNeter: clean(data.tehutiNeter, 500),
        ireIbi: clean(data.ireIbi, 500)
      })
    )
  ]);

  return jsonResponse({ ok: true, id, updatedAt: now });
}
