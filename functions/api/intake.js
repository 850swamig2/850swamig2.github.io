const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

const MAX_BODY_BYTES = 30_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function oneLine(value, maxLength = 500) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function longText(value, maxLength = 3000) {
  return typeof value === "string"
    ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength)
    : "";
}

function required(value, label, maxLength, multiline = false) {
  const cleaned = multiline
    ? longText(value, maxLength)
    : oneLine(value, maxLength);

  if (!cleaned) {
    throw new Error(`REQUIRED:${label}`);
  }

  return cleaned;
}

function allowedTurnstileHostnames(request, env) {
  const configured = oneLine(env.TURNSTILE_ALLOWED_HOSTNAMES, 1000);

  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  return new Set([new URL(request.url).hostname.toLowerCase()]);
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SECRET_KEY is not configured.");
    return {
      ok: false,
      status: 503,
      error: "Security verification is not configured on the server."
    };
  }

  if (!token) {
    return {
      ok: false,
      status: 403,
      error: "Complete the Cloudflare security check."
    };
  }

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  form.append("idempotency_key", crypto.randomUUID());

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) {
    form.append("remoteip", remoteIp);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      console.warn(
        "Turnstile rejected divination intake:",
        result?.["error-codes"] || []
      );

      return {
        ok: false,
        status: 403,
        error: "Security verification failed. Refresh the form and try again."
      };
    }

    const hostname = oneLine(result.hostname, 255).toLowerCase();
    const allowed = allowedTurnstileHostnames(request, env);

    if (!allowed.has(hostname)) {
      console.warn("Turnstile hostname mismatch:", {
        received: hostname,
        allowed: Array.from(allowed)
      });

      return {
        ok: false,
        status: 403,
        error: "Security verification was issued for an unauthorized hostname."
      };
    }

    return { ok: true, hostname };
  } catch (error) {
    console.error("Turnstile Siteverify request failed:", error);

    return {
      ok: false,
      status: 503,
      error: "Security verification is temporarily unavailable."
    };
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json(
      { ok: false, error: "D1 binding DB is not configured." },
      503
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "The intake is too large." }, 413);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return json(
      { ok: false, error: "Unsupported submission format." },
      415
    );
  }

  try {
    const payload = await request.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ ok: false, error: "Invalid intake data." }, 400);
    }

    // Honeypot: acknowledge obvious automated submissions without storing them.
    if (oneLine(payload.website, 200)) {
      return json({ ok: true, intakeId: "received" }, 201);
    }

    const fullName = required(payload.fullName, "Full name", 120);
    const email = required(payload.email, "Email", 254).toLowerCase();
    const phone = required(payload.phone, "Phone or text number", 40);
    const location = oneLine(payload.location, 180);
    const contactMethod = required(
      payload.contactMethod,
      "Preferred contact method",
      40
    );

    const ifaBefore = required(
      payload.ifaBefore,
      "Previous Ifá divination answer",
      20
    );
    const tehutiBefore = oneLine(payload.tehutiBefore, 20);
    const initiationStatus = oneLine(payload.initiationStatus, 100);
    const spiritualHouse = longText(payload.house, 1500);

    const concernType = required(
      payload.concernType,
      "Primary concern category",
      120
    );
    const mainConcern = required(
      payload.mainConcern,
      "Primary reason",
      3000,
      true
    );
    const whyNow = longText(payload.timing, 2000);

    const question1 = required(
      payload.question1,
      "Question 1",
      1500,
      true
    );
    const question2 = longText(payload.question2, 1500);
    const question3 = longText(payload.question3, 1500);

    const consentSpiritual =
      payload.consentSpiritualConsultation === true;
    const consentDisclaimer =
      payload.consentNotMedicalLegalFinancial === true;
    const consentEbo = payload.consentEboCorrection === true;
    const consentPayment = payload.consentPaymentRequired === true;

    if (!EMAIL_PATTERN.test(email)) {
      return json({ ok: false, error: "Enter a valid email address." }, 400);
    }

    if (
      !consentSpiritual ||
      !consentDisclaimer ||
      !consentEbo ||
      !consentPayment
    ) {
      return json(
        { ok: false, error: "All consent statements must be accepted." },
        400
      );
    }

    const turnstile = await verifyTurnstile(
      request,
      env,
      oneLine(payload.turnstileToken, 2048)
    );

    if (!turnstile.ok) {
      return json(
        { ok: false, error: turnstile.error },
        turnstile.status
      );
    }

    const intakeId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const requestUrl = new URL(request.url);
    const sourceOrigin = requestUrl.origin;
    const sourcePage = oneLine(payload.sourcePage, 500);

    const payloadJson = JSON.stringify({
      form_version: "KOLEOSO-INTAKE-CLOUDFLARE-2026-07",
      intake_id: intakeId,
      created_at: createdAt,
      source: {
        origin: sourceOrigin,
        page: sourcePage,
        turnstile_hostname: turnstile.hostname,
        network_country: oneLine(request.cf?.country || "", 8)
      },
      client: {
        full_name: fullName,
        email,
        phone,
        location,
        preferred_contact_method: contactMethod
      },
      spiritual_background: {
        received_ifa_divination_before: ifaBefore,
        received_tehuti_divination_before: tehutiBefore,
        initiation_status: initiationStatus,
        godparent_elder_or_spiritual_house: spiritualHouse
      },
      divination_request: {
        concern_category: concernType,
        primary_reason: mainConcern,
        why_now: whyNow,
        questions: [question1, question2, question3].filter(Boolean)
      },
      consent: {
        spiritual_consultation: true,
        not_medical_legal_financial_or_mental_health: true,
        ebo_or_correction_may_be_recommended: true,
        payment_required_before_confirmation: true
      }
    });

    const result = await env.DB.prepare(`
      INSERT INTO divination_intakes (
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
        consent_spiritual,
        consent_disclaimer,
        consent_ebo,
        consent_payment,
        source_origin,
        source_page,
        payload_json
      ) VALUES (
        ?, ?, 'New', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        1, 1, 1, 1, ?, ?, ?
      )
    `).bind(
      intakeId,
      createdAt,
      fullName,
      email,
      phone,
      location,
      contactMethod,
      ifaBefore,
      tehutiBefore,
      initiationStatus,
      spiritualHouse,
      concernType,
      mainConcern,
      whyNow,
      question1,
      question2,
      question3,
      sourceOrigin,
      sourcePage,
      payloadJson
    ).run();

    if (!result.success) {
      throw new Error("D1_INSERT_FAILED");
    }

    return json(
      {
        ok: true,
        message: "Divination intake received and saved.",
        intakeId
      },
      201
    );
  } catch (error) {
    if (
      typeof error?.message === "string" &&
      error.message.startsWith("REQUIRED:")
    ) {
      return json(
        {
          ok: false,
          error: `${error.message.slice("REQUIRED:".length)} is required.`
        },
        400
      );
    }

    if (error instanceof SyntaxError) {
      return json(
        { ok: false, error: "The submitted JSON is invalid." },
        400
      );
    }

    console.error("Divination intake submission failed:", error);

    return json(
      {
        ok: false,
        error:
          "The intake could not be saved. Confirm the DB binding and divination_intakes table."
      },
      500
    );
  }
}

export function onRequestGet() {
  return json(
    { ok: false, error: "Use POST to submit a divination intake." },
    405,
    { Allow: "POST" }
  );
}
