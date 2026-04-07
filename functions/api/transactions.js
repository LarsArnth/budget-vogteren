export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // YYYY-MM
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

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}
