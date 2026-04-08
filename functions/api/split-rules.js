// GET: List all split rules
// DELETE: Remove a split rule group by pattern
export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare(`
    SELECT sr.id, sr.pattern, sr.category_id, sr.percentage, sr.label,
           c.main_category, c.sub_category
    FROM split_rules sr
    JOIN categories c ON sr.category_id = c.id
    ORDER BY sr.pattern, sr.percentage DESC
  `).all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { pattern } = await request.json();
  if (!pattern) {
    return new Response(JSON.stringify({ error: "pattern required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await env.DB.prepare("DELETE FROM split_rules WHERE pattern = ?").bind(pattern).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
