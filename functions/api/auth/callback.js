// GET /api/auth/callback — Handle Google OAuth callback
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }

  const redirectUri = `${url.origin}/api/auth/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return new Response("OAuth token exchange failed", { status: 400 });
  }

  // Get user info
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userRes.json();

  if (!userInfo.id || !userInfo.email) {
    return new Response("Could not get user info", { status: 400 });
  }

  // Upsert user
  await env.DB.prepare(
    `INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture`
  ).bind(userInfo.id, userInfo.email, userInfo.name || "", userInfo.picture || "").run();

  const { results } = await env.DB.prepare(
    "SELECT id FROM users WHERE google_id = ?"
  ).bind(userInfo.id).all();

  const userId = results[0].id;

  // Create session (30 days)
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(sessionId, userId, expiresAt).run();

  // Redirect to app with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `session=${sessionId}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
