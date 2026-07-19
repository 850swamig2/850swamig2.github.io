function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 503);
  }

  if (!env.ADMIN_TOKEN) {
    return json(
      { ok: false, error: "ADMIN_TOKEN is not configured." },
      503
    );
  }

  if (bearerToken(request) !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  try {
    const result = await env.DB.prepare(`
      SELECT
        intake_id,
        created_at,
        status,
        full_name,
        email,
        phone,
        location,
        contact_method,
        ifa_before,
        tehuti_before,
        initiation_status,
        spiritual_house,
        concern_type,
        main_concern,
        why_now,
        question_1,
        question_2,
        question_3,
        source_origin,
        source_page,
        payload_json
      FROM divination_intakes
      ORDER BY id DESC
      LIMIT 100
    `).all();

    const intakes = (result.results || []).map((row) => {
      let payload = null;

      try {
        payload = JSON.parse(row.payload_json);
      } catch (_) {
        payload = null;
      }

      const { payload_json, ...summary } = row;
      return { ...summary, payload };
    });

    return json({ ok: true, intakes });
  } catch (error) {
    console.error("Protected intake listing failed:", error);

    return json(
      {
        ok: false,
        error: "The intake records could not be loaded."
      },
      500
    );
  }
}
