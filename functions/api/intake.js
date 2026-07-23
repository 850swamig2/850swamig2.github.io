const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function text(value, maxLength = 2000) {
  return (value ?? "").toString().trim().slice(0, maxLength);
}

function flag(value) {
  return value === true;
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let suffix = "";
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }

  return `KOL-${new Date().getUTCFullYear()}-${suffix}`;
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

function validatePayload(payload) {
  const errors = [];

  if (!payload.fullName) errors.push("Full name is required.");
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.push("A valid email address is required.");
  }
  if (!payload.phone) errors.push("Phone or text number is required.");
  if (!payload.contactMethod) errors.push("Preferred contact method is required.");
  if (!payload.ifaBefore) errors.push("Ifá divination history is required.");
  if (!payload.concernType) errors.push("Concern category is required.");
  if (!payload.mainConcern) errors.push("Primary concern is required.");
  if (!payload.question1) errors.push("Question 1 is required.");

  if (!payload.consentSpiritualConsultation) {
    errors.push("Spiritual consultation consent is required.");
  }
  if (!payload.consentNotMedicalLegalFinancial) {
    errors.push("Professional-care disclaimer consent is required.");
  }
  if (!payload.consentEboCorrection) {
    errors.push("Ebo or corrective-action consent is required.");
  }
  if (!payload.consentPaymentRequired) {
    errors.push("Payment requirement consent is required.");
  }

  return errors;
}

function mailgunConfiguration(env) {
  const domain = text(env.MAILGUN_DOMAIN, 255);
  const apiKey = text(env.MAILGUN_API_KEY, 1000);

  if (!domain || !apiKey) {
    throw new Error(
      "MAILGUN_DOMAIN and MAILGUN_API_KEY must be configured."
    );
  }

  const apiBase = text(
    env.MAILGUN_API_BASE_URL || "https://api.mailgun.net",
    500
  ).replace(/\/+$/, "");

  const recipient = text(
    env.INTAKE_NOTIFICATION_EMAIL || "850SwamiG2@gmail.com",
    254
  );

  const from = text(
    env.MAILGUN_FROM ||
      `Your Babalawo <postmaster@${domain}>`,
    320
  );

  const adminUrl = text(
    env.INTAKE_ADMIN_URL ||
      "https://yourbabalawo.com/admin.html",
    1000
  );

  return {
    domain,
    apiKey,
    apiBase,
    recipient,
    from,
    adminUrl
  };
}

async function sendIntakeNotification(env, notification) {
  const config = mailgunConfiguration(env);

  const subject =
    `New Your Babalawo Intake — ${notification.publicReference}`;

  const message = [
    "A new divination intake has been submitted.",
    "",
    `Applicant: ${notification.fullName}`,
    `Applicant email: ${notification.email}`,
    `Intake number: ${notification.publicReference}`,
    `Concern category: ${notification.concernType}`,
    `Preferred contact: ${notification.contactMethod}`,
    "Status: Submitted — awaiting applicant confirmation",
    `Submitted (UTC): ${notification.createdAt}`,
    "",
    `Protected review page: ${config.adminUrl}`,
    "",
    "Privacy notice: The applicant's full concern, spiritual background,",
    "and questions are not included in this email. Review those details",
    "only through the protected administration page."
  ].join("\n");

  const form = new FormData();
  form.set("from", config.from);
  form.set("to", config.recipient);
  form.set("subject", subject);
  form.set("text", message);
  form.set("h:Reply-To", notification.email);

  const authorization = btoa(`api:${config.apiKey}`);

  const response = await fetch(
    `${config.apiBase}/v3/${encodeURIComponent(config.domain)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`
      },
      body: form
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Mailgun notification failed with status ${response.status}: ` +
      responseText.slice(0, 500)
    );
  }

  return {
    recipient: config.recipient,
    providerResponse: responseText.slice(0, 500)
  };
}

async function recordNotificationEvent(
  env,
  intakeId,
  createdAt,
  eventType,
  summary,
  metadata
) {
  if (!env.DB) return;

  await env.DB.prepare(`
    INSERT INTO interaction_log (
      id,
      intake_id,
      created_at,
      event_type,
      summary,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    intakeId,
    createdAt,
    eventType,
    summary,
    JSON.stringify(metadata)
  ).run();
}

async function notifyNewIntake(env, notification) {
  try {
    const result = await sendIntakeNotification(env, notification);

    await recordNotificationEvent(
      env,
      notification.internalId,
      new Date().toISOString(),
      "intake_notification_sent",
      `New-intake email sent for ${notification.publicReference}.`,
      {
        publicReference: notification.publicReference,
        recipient: result.recipient
      }
    );
  } catch (error) {
    console.error("New-intake notification failed:", error);

    try {
      await recordNotificationEvent(
        env,
        notification.internalId,
        new Date().toISOString(),
        "intake_notification_failed",
        `New-intake email failed for ${notification.publicReference}.`,
        {
          publicReference: notification.publicReference,
          error: String(error?.message || error).slice(0, 1000)
        }
      );
    } catch (loggingError) {
      console.error(
        "Could not record notification failure:",
        loggingError
      );
    }
  }
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return {
      ok: false,
      error: "TURNSTILE_SECRET_KEY is not configured."
    };
  }

  if (!token) {
    return {
      ok: false,
      error: "Complete the Cloudflare security check."
    };
  }

  const formData = new FormData();
  formData.set("secret", env.TURNSTILE_SECRET_KEY);
  formData.set("response", token);

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) formData.set("remoteip", remoteIp);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData
    }
  );

  const result = await response.json();

  if (!result.success) {
    return {
      ok: false,
      error: "Cloudflare security verification failed."
    };
  }

  const expectedHostname = text(
    env.TURNSTILE_EXPECTED_HOSTNAME || "",
    255
  ).toLowerCase();

  if (
    expectedHostname &&
    text(result.hostname, 255).toLowerCase() !== expectedHostname
  ) {
    return {
      ok: false,
      error: "Cloudflare security verification returned an unexpected hostname."
    };
  }

  return { ok: true };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not configured." }, 500);
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ ok: false, error: "Send the intake as JSON." }, 415);
    }

    const body = await request.json();

    if (text(body.website, 250)) {
      return json({ ok: true, message: "Submission received." }, 201);
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

    const errors = validatePayload(payload);
    if (errors.length) {
      return json({ ok: false, error: errors.join(" ") }, 400);
    }

    const turnstileResult = await verifyTurnstile(
      request,
      env,
      text(body.turnstileToken, 4096)
    );

    if (!turnstileResult.ok) {
      return json({ ok: false, error: turnstileResult.error }, 400);
    }

    const internalId = crypto.randomUUID();
    const publicReference = randomReference();
    const confirmationToken = randomToken(32);
    const confirmationTokenHash = await sha256Hex(confirmationToken);

    const now = new Date();
    const createdAt = now.toISOString();
    const tokenExpiresAt = new Date(
      now.getTime() + 48 * 60 * 60 * 1000
    ).toISOString();

    const rawJson = JSON.stringify({
      ...payload,
      sourcePage: text(body.sourcePage, 1000),
      submittedAt: createdAt
    });

    const networkCountry = text(request.cf?.country || "", 20);
    const userAgent = text(request.headers.get("user-agent"), 500);

    const intakeStatement = env.DB.prepare(`
      INSERT INTO intake_submissions (
        id,
        created_at,
        updated_at,
        status,
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
        consent_payment_required,
        ip_hint,
        user_agent,
        raw_json,
        public_reference,
        confirmation_token_hash,
        token_expires_at,
        payment_status
      ) VALUES (
        ?, ?, ?, 'submitted',
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, 'unpaid'
      )
    `).bind(
      internalId,
      createdAt,
      createdAt,
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
      networkCountry,
      userAgent,
      rawJson,
      publicReference,
      confirmationTokenHash,
      tokenExpiresAt
    );

    const eventStatement = env.DB.prepare(`
      INSERT INTO interaction_log (
        id,
        intake_id,
        created_at,
        event_type,
        summary,
        metadata_json
      ) VALUES (?, ?, ?, 'intake_submitted', ?, ?)
    `).bind(
      crypto.randomUUID(),
      internalId,
      createdAt,
      `Intake ${publicReference} submitted and awaiting applicant confirmation.`,
      JSON.stringify({ publicReference, status: "submitted" })
    );

    await env.DB.batch([intakeStatement, eventStatement]);

    context.waitUntil(
      notifyNewIntake(env, {
        internalId,
        publicReference,
        fullName: payload.fullName,
        email: payload.email,
        concernType: payload.concernType,
        contactMethod: payload.contactMethod,
        createdAt
      })
    );

    const next =
      "/confirmation.html?token=" +
      encodeURIComponent(confirmationToken);

    return json(
      {
        ok: true,
        message: "Intake saved. Review and confirm the information.",
        intakeId: publicReference,
        publicReference,
        next
      },
      201
    );
  } catch (error) {
    console.error("Intake submission failed:", error);

    const message = String(error?.message || "");

    if (
      message.includes("no column named public_reference") ||
      message.includes("confirmation_token_hash")
    ) {
      return json(
        {
          ok: false,
          error:
            "The intake confirmation migration has not been applied to D1."
        },
        500
      );
    }

    return json(
      {
        ok: false,
        error: "The intake could not be saved. Please try again."
      },
      500
    );
  }
}

export function onRequestGet() {
  return json(
    { ok: false, error: "Use POST to submit an intake." },
    405,
    { Allow: "POST" }
  );
}
