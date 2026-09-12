// Config do cookie de refresh token, compartilhada entre /login (seta),
// /refresh (lê) e /logout (limpa) — um único lugar pra manter os três em
// sincronia (mudar sameSite/path aqui não corre o risco de setCookie e
// clearCookie divergirem, o que faria o clear não bater com o cookie
// setado e o navegador nunca limpar de verdade).

export const REFRESH_COOKIE_NAME = "refreshToken";

// secure: true exige HTTPS — só desliga em dev local (http://localhost).
// Em produção (Render, sempre HTTPS) fica sempre true.
const isProduction = process.env.NODE_ENV === "production";

// sameSite: "none" porque loop-web e a API vivem em domínios diferentes
// (ex.: loop-web em algum host, API em loop-api-wz74.onrender.com) —
// "lax"/"strict" simplesmente não enviam o cookie em request cross-site
// iniciado por fetch/XHR, quebrando o fluxo inteiro. O trade-off (CSRF)
// fica sob responsabilidade da origem explícita do CORS (nunca "*" com
// credentials: true) — ver DECISIONS.md.
// "none" exige secure: true (regra do próprio spec de cookie) — por isso
// cai pra "lax" em dev (sem HTTPS local, "none" seria rejeitado pelo
// navegador de qualquer forma).
export function refreshCookieOptions() {
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
        path: "/",
    };
}
