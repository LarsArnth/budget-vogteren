// Auth middleware - protects all /api/* routes except /api/auth/*
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Allow auth endpoints through
  if (url.pathname.startsWith("/api/auth/")) {
    return next();
  }

  // Allow non-API routes (static files, HTML)
  if (!url.pathname.startsWith("/api/")) {
    return next();
  }

  // Check session cookie
  const cookie = request.headers.get("Cookie") || "";
  const sessionId = parseCookie(cookie, "session");

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Ikke logget ind" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate session
  const { results } = await env.DB.prepare(
    "SELECT s.user_id, u.email, u.name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')"
  ).bind(sessionId).all();

  if (!results || results.length === 0) {
    return new Response(JSON.stringify({ error: "Session udløbet" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      },
    });
  }

  // Attach user to context
  context.data = { user: results[0] };
  return next();
}

function parseCookie(cookieStr, name) {
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
