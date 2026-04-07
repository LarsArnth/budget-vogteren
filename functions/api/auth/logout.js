// POST /api/auth/logout — Destroy session
export async function onRequestPost(context) {
  const { env, request } = context;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
  const sessionId = match ? match[1] : null;

  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    },
  });
}
