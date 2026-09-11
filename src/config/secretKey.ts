// Guard puro da SECRET_KEY. Não lê `process.env` nem `exit` — recebe o valor e
// lança em caso de configuração inválida. Quem chama (`server.ts`) decide o que
// fazer com o erro. Assim o guard é testável isolado, sem tocar no boot real
// nem no ambiente de teste da suíte (que sobe o app por `buildApp()`).

// Comprimento mínimo para uma chave HS256 razoável. Limiar defensável, não
// mágico: 256 bits ~= 32 bytes; exigir 32 caracteres é o piso prático.
export const MIN_SECRET_KEY_LENGTH = 32;

// Valores de exemplo/placeholder que nunca podem chegar em produção. Lista
// deliberadamente não exaustiva (ver DECISIONS.md) — a checagem de comprimento
// é o filtro principal; esta lista pega o caso "padrão conhecido com tamanho
// suficiente pra passar no piso". Comparação após `trim()` + `toLowerCase()`.
const KNOWN_PLACEHOLDERS = new Set([
    "abcdefghijklmnopqrstuvwxyz",
    "changeme",
    "change-me",
    "secret",
    "secretkey",
    "your-secret-key",
    "your-secret-key-here",
    "your-super-secret-key-change-this-please",
]);

/**
 * Lança `Error` se a SECRET_KEY estiver ausente, curta demais ou for um valor
 * de exemplo conhecido. Retorna `void` em caso de chave válida.
 */
export function validateSecretKey(value: string | undefined): void {
    if (!value || value.trim().length === 0) {
        throw new Error("SECRET_KEY não está definida.");
    }

    if (value.length < MIN_SECRET_KEY_LENGTH) {
        throw new Error(
            `SECRET_KEY curta demais: ${value.length} caractere(s), mínimo ${MIN_SECRET_KEY_LENGTH}.`,
        );
    }

    if (KNOWN_PLACEHOLDERS.has(value.trim().toLowerCase())) {
        throw new Error(
            "SECRET_KEY está usando um valor de exemplo/placeholder conhecido.",
        );
    }
}
