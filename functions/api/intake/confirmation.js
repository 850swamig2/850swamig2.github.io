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

function shape(row) {
  return {
    publicReference: row.public_reference,
    status: row.status,
    createdAt: row.created_at,

    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location || "",
    contactMethod: row.preferred_contact_method || "",

    ifaBefore: row.received_ifa_before || "",
    tehutiBefore: row.received_tehuti_before || "",
    initiationStatus: row.spiritual_or_initiation_status || "",
    house: row.godparent_elder_spiritual_house || "",

    concernType: row.primary_concern_category || "",
    mainConcern: row.primary_reason || "",
    timing: row.why_now || "",

    question1: row.question_1 || "",
    question2: row.question_2 || "",
    question3: row.question_3 || "",

    consentSpiritualConsultation:
      row.consent_spiritual_consultation === 1,
    consentNotMedicalLegalFinancial:
      row.consent_not_medical_legal_financial === 1,
    consentEboCorrection:
      row.consent_ebo_correction === 1,
    consentPaymentRequired:
      row.consent_payment_required === 1
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  try {
    const url = new URL(request.url);
    const token = text(url.searchParams.get("token"));

    if (!token) {
      return json({ ok: false, error: "Confirmation token is required." }, 400);
    }

    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();

    const row = await env.DB.prepare(`
      SELECT
        public_reference,
        status,
        created_at,
        full_name,
        email,
        phone,
        location,
        preferred_contact_method,
        received_ifa_before,
        received_tehuti_before,
        spiritual_or_initiation_status,
        godparent_elder_spiritual_house,
        primary_concern_category,
        primary_reason,
        why_now,
        question_1,
        question_2,
        question_3,
        consent_spiritual_consultation,
        consent_not_medical_legal_financial,
        consent_ebo_correction,
        consent_payment_required
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

    return json({ ok: true, intake: shape(row) });
  } catch (error) {
    console.error("Confirmation lookup failed:", error);
    return json(
      { ok: false, error: "The intake information could not be loaded." },
      500
    );
  }
}

export function onRequestPost() {
  return json(
    { ok: false, error: "Use GET to review an intake." },
    405
  );
}
