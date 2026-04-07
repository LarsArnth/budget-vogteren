
export async function onRequestGet(context) {
  const { env } = context;
  
  // Hent de seneste 50 posteringer
  const { results } = await env.DB.prepare(`
    SELECT * FROM transactions 
    ORDER BY date DESC 
    LIMIT 50
  `).all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" }
  });
}
