// Config do cookie de refresh token, compartilhada entre /login (seta),
// /refresh (lê) e /logout (limpa) — um único lugar pra manter os três em
// sincronia (mudar sameSite/path aqui não corre o risco de setCookie e
// clearCookie divergirem, o que faria o clear não bater com o cookie
// setado e o navegador nunca limpar de verdade).

export const REFRESH_COOKIE_NAME = "refreshToken";

// secure: true exige HTTPS — só desliga em dev local (http://localhost).
// Em produção (Vercel, sempre HTTPS) fica sempre true.
const isProduction = process.env.NODE_ENV === "production";

// sameSite: "none" porque loop-web e a API vivem em domínios diferentes
// (projetos separados na Vercel; vercel.app está na Public Suffix List) —
// "lax"/"strict" simplesmente não enviam o cookie em request cross-site
// iniciado por fetch/XHR, quebrando o fluxo inteiro. O trade-off (CSRF)
// fica sob responsabilidade da origem explícita do CORS (nunca "*" com
// credentials: true). Em produção o loop-web chama a API por um rewrite
// /api no próprio domínio, o que torna o cookie de primeira parte e evita o
// bloqueio de cookie de terceiros do Safari — ver doc-2/adr/0007.
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
