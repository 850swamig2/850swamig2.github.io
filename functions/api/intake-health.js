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

export async function onRequestGet(context) {
  if (!context.env.DB) {
    return json(
      {
        ok: false,
        database: "not-bound",
        error: "D1 binding DB is not configured."
      },
      503
    );
  }

  try {
    await context.env.DB.prepare(
      "SELECT intake_id FROM divination_intakes LIMIT 1"
    ).first();

    return json({
      ok: true,
      database: "connected",
      table: "divination_intakes"
    });
  } catch (error) {
    console.error("D1 health check failed:", error);

    return json(
      {
        ok: false,
        database: "connected",
        table: "missing-or-unavailable",
        error: "Run database/CREATE_DIVINATION_INTAKES_TABLE.sql."
      },
      500
    );
  }
}
