export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const year = url.searchParams.get("year") || new Date().getFullYear();

  const { results } = await env.DB.prepare(`
    SELECT b.id, b.amount, b.year, b.month, b.category_id,
           c.main_category, c.sub_category
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.year = ?
    ORDER BY b.month, c.main_category, c.sub_category
  `).bind(parseInt(year)).all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}
