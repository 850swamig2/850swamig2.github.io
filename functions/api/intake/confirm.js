const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: HEADERS
  });
}

function text(value, maxLength = 4096) {
  return (value ?? "").toString().trim().slice(0, maxLength);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  try {
    const body = await request.json();
    const token = text(body.token);

    if (!token || body.accuracyConfirmed !== true) {
      return json(
        {
          ok: false,
          error: "Review the intake and confirm that it is accurate."
        },
        400
      );
    }

    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();

    const row = await env.DB.prepare(`
      SELECT id, public_reference
      FROM intake_submissions
      WHERE confirmation_token_hash = ?
        AND token_expires_at > ?
        AND status = 'submitted'
      LIMIT 1
    `).bind(tokenHash, now).first();

    if (!row) {
      return json(
        {
          ok: false,
          error:
            "This confirmation link is invalid, expired, or has already been used."
        },
        404
      );
    }

    const updateStatement = env.DB.prepare(`
      UPDATE intake_submissions
      SET
        status = 'confirmed',
        confirmed_at = ?,
        updated_at = ?,
        confirmation_token_hash = NULL,
        token_expires_at = NULL
      WHERE id = ?
        AND status = 'submitted'
    `).bind(now, now, row.id);

    const eventStatement = env.DB.prepare(`
      INSERT INTO interaction_log (
        id,
        intake_id,
        created_at,
        event_type,
        summary,
        metadata_json
      ) VALUES (?, ?, ?, 'intake_confirmed', ?, ?)
    `).bind(
      crypto.randomUUID(),
      row.id,
      now,
      `Applicant confirmed intake ${row.public_reference}.`,
      JSON.stringify({
        publicReference: row.public_reference,
        status: "confirmed"
      })
    );

    await env.DB.batch([updateStatement, eventStatement]);

    return json({
      ok: true,
      message: "Intake confirmed.",
      publicReference: row.public_reference,
      paymentUrl:
        "/payment.html?intake=" +
        encodeURIComponent(row.public_reference)
    });
  } catch (error) {
    console.error("Intake confirmation failed:", error);
    return json(
      { ok: false, error: "The intake could not be confirmed." },
      500
    );
  }
}

export function onRequestGet() {
  return json(
    { ok: false, error: "Use POST to confirm an intake." },
    405
  );
}
