// GET /api/auth/login — Redirect to Google OAuth
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302
  );
}
