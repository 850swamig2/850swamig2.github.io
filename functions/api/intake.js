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

function clean(value, max = 5000) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function required(data, field) {
  return clean(data[field]).length > 0;
}

function boolValue(value) {
  return value === true || value === "true" || value === "on" || value === "yes" || value === "Yes";
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return {
      ok: false,
      status: 500,
      error: "TURNSTILE_SECRET_KEY is not configured in Cloudflare Pages."
    };
  }

  if (!token) {
    return {
      ok: false,
      status: 400,
      error: "Missing Cloudflare Turnstile token."
    };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  const idempotencyKey = crypto.randomUUID();
  formData.append("idempotency_key", idempotencyKey);

  let result;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    result = await response.json();
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: "Could not contact Cloudflare Turnstile Siteverify.",
      detail: error && error.message ? error.message : String(error)
    };
  }

  if (!result.success) {
    return {
      ok: false,
      status: 403,
      error: "Cloudflare Turnstile verification failed.",
      codes: result["error-codes"] || []
    };
  }

  return { ok: true, result };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured in Cloudflare Pages."
    }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const errors = [];
  ["fullName", "email", "phone", "contactMethod", "ifaBefore", "concernType", "mainConcern", "question1"].forEach((field) => {
    if (!required(data, field)) errors.push(field + " is required");
  });

  if (!boolValue(data.consentSpiritualConsultation)) errors.push("Spiritual consultation consent is required");
  if (!boolValue(data.consentNotMedicalLegalFinancial)) errors.push("Medical/legal/financial disclaimer consent is required");
  if (!boolValue(data.consentEboCorrection)) errors.push("Ebo/correction consent is required");
  if (!boolValue(data.consentPaymentRequired)) errors.push("Payment consent is required");

  if (errors.length) {
    return jsonResponse({ ok: false, errors }, 400);
  }

  const turnstileToken = clean(data.turnstileToken, 5000);
  const turnstile = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstile.ok) {
    return jsonResponse({
      ok: false,
      error: turnstile.error,
      codes: turnstile.codes || [],
      detail: turnstile.detail || ""
    }, turnstile.status || 403);
  }

  const id = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();

  const fullName = clean(data.fullName, 300);
  const email = clean(data.email, 320).toLowerCase();
  const phone = clean(data.phone, 100);

  const ipHint = clean(request.headers.get("CF-Connecting-IP") || "", 80);
  const userAgent = clean(request.headers.get("User-Agent") || "", 600);

  const storedData = { ...data };
  delete storedData.turnstileToken;
  const rawJson = JSON.stringify(storedData).slice(0, 60000);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO intake_submissions (
          id, created_at, updated_at, status,
          full_name, email, phone, location, preferred_contact_method,
          received_ifa_before, received_tehuti_before, spiritual_or_initiation_status,
          godparent_elder_spiritual_house,
          primary_concern_category, primary_reason, why_now,
          question_1, question_2, question_3,
          consent_spiritual_consultation,
          consent_not_medical_legal_financial,
          consent_ebo_correction,
          consent_payment_required,
          ip_hint, user_agent, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, now, now, "new_intake",
        fullName, email, phone, clean(data.location, 300), clean(data.contactMethod, 100),
        clean(data.ifaBefore, 100), clean(data.tehutiBefore, 100), clean(data.initiationStatus, 150),
        clean(data.house, 5000),
        clean(data.concernType, 200), clean(data.mainConcern, 10000), clean(data.timing, 10000),
        clean(data.question1, 10000), clean(data.question2, 10000), clean(data.question3, 10000),
        boolValue(data.consentSpiritualConsultation) ? 1 : 0,
        boolValue(data.consentNotMedicalLegalFinancial) ? 1 : 0,
        boolValue(data.consentEboCorrection) ? 1 : 0,
        boolValue(data.consentPaymentRequired) ? 1 : 0,
        ipHint, userAgent, rawJson
      ),
      env.DB.prepare(`
        INSERT INTO interaction_log (id, intake_id, created_at, event_type, summary, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        eventId,
        id,
        now,
        "intake_submitted",
        `New Koleoso intake submitted by ${fullName}`,
        JSON.stringify({
          email,
          phone,
          concernType: clean(data.concernType, 200),
          turnstileVerified: true
        })
      )
    ]);

    return jsonResponse({
      ok: true,
      intakeId: id,
      next: "/thank-you.html?intake=" + encodeURIComponent(id)
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: "Database insert failed.",
      detail: error && error.message ? error.message : String(error)
    }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}
