export async function onRequestGet(context) {
  const { env } = context;

  const { results } = await env.DB.prepare(
    "SELECT id, main_category, sub_category FROM categories ORDER BY main_category, sub_category"
  ).all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}
