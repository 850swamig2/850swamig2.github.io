const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function authorized(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return { ok: false, status: 500, error: "ADMIN_TOKEN is not configured." };
  const provided = request.headers.get("x-admin-token") || "";
  if (provided !== expected) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ ok: false, error: "D1 binding DB is not configured." }, 500);

  const auth = authorized(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const url = new URL(request.url);
  const intakeId = url.searchParams.get("intakeId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 250);

  let result;
  if (intakeId) {
    result = await env.DB.prepare(`
      SELECT id, intake_id, created_at, event_type, summary, metadata_json
      FROM interaction_log
      WHERE intake_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(intakeId, limit).all();
  } else {
    result = await env.DB.prepare(`
      SELECT id, intake_id, created_at, event_type, summary, metadata_json
      FROM interaction_log
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();
  }

  return jsonResponse({ ok: true, events: result.results || [] });
}
