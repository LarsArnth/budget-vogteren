export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const uncategorized = url.searchParams.get("uncategorized");
  const mobilepay = url.searchParams.get("mobilepay");
  const limit = parseInt(url.searchParams.get("limit") || "200");

  let sql = `
    SELECT t.id, t.date, t.description, t.original_description, t.amount, t.account_name, t.category_id,
           c.main_category, c.sub_category
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
  `;
  const conditions = [];
  const params = [];

  if (month) {
    conditions.push("t.date LIKE ?");
    params.push(`${month}%`);
  }
  if (uncategorized === "true") {
    conditions.push("t.category_id IS NULL");
  }
  if (mobilepay === "true") {
    conditions.push("(t.description LIKE 'MobilePay:%' OR t.description LIKE 'mobilepay:%')");
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY t.date DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  // Fetch splits for these transactions
  if (results.length > 0) {
    const ids = results.map((r) => r.id);
    // D1 doesn't support IN with bind params easily, so batch query
    const { results: allSplits } = await env.DB.prepare(`
      SELECT ts.transaction_id, ts.category_id, ts.amount, ts.description as label,
             c.main_category, c.sub_category
      FROM transaction_splits ts
      JOIN categories c ON ts.category_id = c.id
      WHERE ts.transaction_id IN (${ids.map(() => "?").join(",")})
      ORDER BY ts.amount ASC
    `).bind(...ids).all();

    // Group splits by transaction_id
    const splitMap = new Map();
    for (const s of (allSplits || [])) {
      if (!splitMap.has(s.transaction_id)) splitMap.set(s.transaction_id, []);
      splitMap.get(s.transaction_id).push(s);
    }

    // Attach splits to transactions
    for (const t of results) {
      t.splits = splitMap.get(t.id) || [];
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}
