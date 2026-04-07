// GET /api/auth/me — Check if logged in, return user info
export async function onRequestGet(context) {
  const { env, request } = context;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sessionId).all();

  if (!results || results.length === 0) {
    return new Response(JSON.stringify({ user: null }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      },
    });
  }

  return new Response(JSON.stringify({ user: results[0] }), {
    headers: { "Content-Type": "application/json" },
  });
}
