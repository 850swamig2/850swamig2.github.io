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

function text(value, maxLength = 2000) {
  return (value ?? "").toString().trim().slice(0, maxLength);
}

function flag(value) {
  return value === true;
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

function validate(payload) {
  if (!payload.fullName) return "Full name is required.";
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "A valid email address is required.";
  }
  if (!payload.phone) return "Phone or text number is required.";
  if (!payload.contactMethod) return "Preferred contact method is required.";
  if (!payload.ifaBefore) return "Ifá divination history is required.";
  if (!payload.concernType) return "Concern category is required.";
  if (!payload.mainConcern) return "Primary concern is required.";
  if (!payload.question1) return "Question 1 is required.";

  if (
    !payload.consentSpiritualConsultation ||
    !payload.consentNotMedicalLegalFinancial ||
    !payload.consentEboCorrection ||
    !payload.consentPaymentRequired
  ) {
    return "All four agreements are required.";
  }

  return "";
}

async function findEditableRecord(env, tokenHash, now) {
  return env.DB.prepare(`
    SELECT *
    FROM intake_submissions
    WHERE confirmation_token_hash = ?
      AND token_expires_at > ?
      AND status = 'submitted'
    LIMIT 1
  `).bind(tokenHash, now).first();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  try {
    const url = new URL(request.url);
    const token = text(url.searchParams.get("token"), 4096);

    if (!token) {
      return json({ ok: false, error: "Correction token is required." }, 400);
    }

    const tokenHash = await sha256Hex(token);
    const row = await findEditableRecord(
      env,
      tokenHash,
      new Date().toISOString()
    );

    if (!row) {
      return json(
        {
          ok: false,
          error:
            "This correction link is invalid, expired, or the intake is already confirmed."
        },
        404
      );
    }

    return json({ ok: true, intake: shape(row) });
  } catch (error) {
    console.error("Edit lookup failed:", error);
    return json(
      { ok: false, error: "The intake could not be loaded for correction." },
      500
    );
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  try {
    const body = await request.json();
    const token = text(body.token, 4096);

    if (!token) {
      return json({ ok: false, error: "Correction token is required." }, 400);
    }

    const payload = {
      fullName: text(body.fullName, 120),
      email: text(body.email, 254).toLowerCase(),
      phone: text(body.phone, 40),
      location: text(body.location, 180),
      contactMethod: text(body.contactMethod, 60),

      ifaBefore: text(body.ifaBefore, 60),
      tehutiBefore: text(body.tehutiBefore, 60),
      initiationStatus: text(body.initiationStatus, 120),
      house: text(body.house, 1500),

      concernType: text(body.concernType, 180),
      mainConcern: text(body.mainConcern, 3000),
      timing: text(body.timing, 2000),

      question1: text(body.question1, 1500),
      question2: text(body.question2, 1500),
      question3: text(body.question3, 1500),

      consentSpiritualConsultation: flag(body.consentSpiritualConsultation),
      consentNotMedicalLegalFinancial: flag(body.consentNotMedicalLegalFinancial),
      consentEboCorrection: flag(body.consentEboCorrection),
      consentPaymentRequired: flag(body.consentPaymentRequired)
    };

    const validationError = validate(payload);
    if (validationError) {
      return json({ ok: false, error: validationError }, 400);
    }

    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();
    const row = await findEditableRecord(env, tokenHash, now);

    if (!row) {
      return json(
        {
          ok: false,
          error:
            "This correction link is invalid, expired, or the intake is already confirmed."
        },
        404
      );
    }

    const rawJson = JSON.stringify({
      ...payload,
      correctedAt: now
    });

    const updateStatement = env.DB.prepare(`
      UPDATE intake_submissions
      SET
        updated_at = ?,
        full_name = ?,
        email = ?,
        phone = ?,
        location = ?,
        preferred_contact_method = ?,
        received_ifa_before = ?,
        received_tehuti_before = ?,
        spiritual_or_initiation_status = ?,
        godparent_elder_spiritual_house = ?,
        primary_concern_category = ?,
        primary_reason = ?,
        why_now = ?,
        question_1 = ?,
        question_2 = ?,
        question_3 = ?,
        consent_spiritual_consultation = ?,
        consent_not_medical_legal_financial = ?,
        consent_ebo_correction = ?,
        consent_payment_required = ?,
        raw_json = ?
      WHERE id = ?
        AND status = 'submitted'
    `).bind(
      now,
      payload.fullName,
      payload.email,
      payload.phone,
      payload.location,
      payload.contactMethod,
      payload.ifaBefore,
      payload.tehutiBefore,
      payload.initiationStatus,
      payload.house,
      payload.concernType,
      payload.mainConcern,
      payload.timing,
      payload.question1,
      payload.question2,
      payload.question3,
      payload.consentSpiritualConsultation ? 1 : 0,
      payload.consentNotMedicalLegalFinancial ? 1 : 0,
      payload.consentEboCorrection ? 1 : 0,
      payload.consentPaymentRequired ? 1 : 0,
      rawJson,
      row.id
    );

    const eventStatement = env.DB.prepare(`
      INSERT INTO interaction_log (
        id,
        intake_id,
        created_at,
        event_type,
        summary,
        metadata_json
      ) VALUES (?, ?, ?, 'intake_corrected', ?, ?)
    `).bind(
      crypto.randomUUID(),
      row.id,
      now,
      `Applicant corrected intake ${row.public_reference}.`,
      JSON.stringify({
        publicReference: row.public_reference,
        status: "submitted"
      })
    );

    await env.DB.batch([updateStatement, eventStatement]);

    return json({
      ok: true,
      message: "Corrections saved.",
      publicReference: row.public_reference
    });
  } catch (error) {
    console.error("Intake correction failed:", error);
    return json(
      { ok: false, error: "The corrections could not be saved." },
      500
    );
  }
}
