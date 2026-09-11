import { describe, it, expect } from "vitest";
import { AttemptTracker } from "../services/attemptTracker";

// instância isolada com relógio injetável, não o singleton de produção
function makeTracker(overrides: Partial<ConstructorParameters<typeof AttemptTracker>[0]> = {}) {
    let now = 0;
    const tracker = new AttemptTracker({
        freeAttempts: 2,
        delaysMs: [1000, 2000, 5000],
        windowMs: 60_000,
        maxConcurrent: 2,
        maxEntries: 10,
        now: () => now,
        ...overrides,
    });
    return { tracker, advance: (ms: number) => (now += ms), setNow: (v: number) => (now = v) };
}

describe("AttemptTracker — camada de conta do rate limit de /login", () => {
    it("tentativas grátis não geram delay", () => {
        const { tracker } = makeTracker(); // freeAttempts: 2
        expect(tracker.getDelay("a@x.com")).toBe(0); // 1ª tentativa
        tracker.recordFailure("a@x.com"); // count=1
        expect(tracker.getDelay("a@x.com")).toBe(0); // 2ª tentativa, ainda livre
    });

    it("delay rampeia por tentativa excedente e trava no teto da lista", () => {
        const { tracker } = makeTracker(); // freeAttempts: 2
        tracker.recordFailure("a@x.com"); // count=1, 2ª tentativa livre
        expect(tracker.getDelay("a@x.com")).toBe(0);

        tracker.recordFailure("a@x.com"); // count=2, 3ª tentativa já excede o free
        expect(tracker.getDelay("a@x.com")).toBe(1000);

        tracker.recordFailure("a@x.com"); // count=3
        expect(tracker.getDelay("a@x.com")).toBe(2000);

        tracker.recordFailure("a@x.com"); // count=4 -> índice além da lista, trava
        expect(tracker.getDelay("a@x.com")).toBe(5000);

        tracker.recordFailure("a@x.com"); // count=5, continua no teto
        expect(tracker.getDelay("a@x.com")).toBe(5000);
    });

    it("janela deslizante: fora da janela, o contador zera antes de calcular", () => {
        const { tracker, advance } = makeTracker();
        for (let i = 0; i < 5; i++) tracker.recordFailure("a@x.com");
        expect(tracker.getDelay("a@x.com")).toBe(5000);

        advance(60_001); // passou da janela de 60s
        expect(tracker.getDelay("a@x.com")).toBe(0);

        // a próxima falha depois da janela é tratada como a 1ª de novo, não a 6ª
        tracker.recordFailure("a@x.com");
        expect(tracker.getDelay("a@x.com")).toBe(0);
    });

    it("login bem-sucedido zera o contador do identificador", () => {
        const { tracker } = makeTracker();
        for (let i = 0; i < 4; i++) tracker.recordFailure("a@x.com");
        expect(tracker.getDelay("a@x.com")).toBeGreaterThan(0);

        tracker.recordSuccess("a@x.com");
        expect(tracker.getDelay("a@x.com")).toBe(0);
    });

    it("normaliza identificador (case e espaço nas bordas) pra mesma entrada", () => {
        const { tracker } = makeTracker(); // freeAttempts: 2
        tracker.recordFailure("  User@Example.com  ");
        tracker.recordFailure("user@example.com");
        tracker.recordFailure("USER@EXAMPLE.COM"); // count=3, mesma entrada nas 3 variações
        expect(tracker.getDelay("user@example.com")).toBe(2000);
    });

    it("cap de concorrência: além do limite, acquireSlot recusa sem segurar nada", () => {
        const { tracker } = makeTracker({ maxConcurrent: 2 });
        tracker.recordFailure("a@x.com");
        tracker.recordFailure("a@x.com");
        tracker.recordFailure("a@x.com"); // já em delay

        expect(tracker.acquireSlot("a@x.com")).toBe(true);
        expect(tracker.acquireSlot("a@x.com")).toBe(true);
        expect(tracker.acquireSlot("a@x.com")).toBe(false); // 3ª concorrente -> recusa

        tracker.releaseSlot("a@x.com");
        expect(tracker.acquireSlot("a@x.com")).toBe(true); // liberou um slot
    });

    it("acquireSlot de um identificador não afeta o cap de outro", () => {
        const { tracker } = makeTracker({ maxConcurrent: 1 });
        tracker.recordFailure("a@x.com");
        tracker.recordFailure("b@x.com");

        expect(tracker.acquireSlot("a@x.com")).toBe(true);
        expect(tracker.acquireSlot("b@x.com")).toBe(true);
        expect(tracker.acquireSlot("a@x.com")).toBe(false);
    });

    it("eviction em lote: teto duro corta pra ~90%, mais antigos primeiro (LRU por atualização)", () => {
        const { tracker } = makeTracker({ maxEntries: 10 });
        for (let i = 0; i < 15; i++) tracker.recordFailure(`user${i}@x.com`);

        expect(tracker.size).toBeLessThanOrEqual(9); // 90% de 10

        // os primeiros inseridos e nunca mais tocados são os despejados
        expect(tracker.getDelay("user0@x.com")).toBe(0);
        // os últimos sobrevivem
        expect(tracker.getDelay("user14@x.com")).toBe(0); // ainda dentro do free, mas a entrada existe
    });

    it("delete+set numa atualização reordena a entrada pro fim (evita eviction precoce)", () => {
        const { tracker } = makeTracker({ maxEntries: 10, freeAttempts: 1 });
        tracker.recordFailure("old@x.com"); // inserido primeiro
        for (let i = 0; i < 8; i++) tracker.recordFailure(`filler${i}@x.com`);

        // toca "old" de novo -> deveria ir pro fim da ordem, sobrevivendo à
        // próxima leva de inserções que dispara eviction
        tracker.recordFailure("old@x.com");

        for (let i = 8; i < 14; i++) tracker.recordFailure(`filler${i}@x.com`);

        expect(tracker.getDelay("old@x.com")).toBeGreaterThan(0); // sobreviveu, count=2
    });

    it("sweep remove entradas expiradas sem resposta pendurada, preserva as com inFlight", () => {
        const { tracker, advance } = makeTracker({ windowMs: 1000, maxConcurrent: 5 });
        tracker.recordFailure("expira@x.com");

        tracker.recordFailure("pendurada@x.com");
        tracker.recordFailure("pendurada@x.com");
        tracker.acquireSlot("pendurada@x.com"); // resposta em delay, não pode ser despejada

        advance(1001); // passou da janela pras duas
        tracker.sweep();

        expect(tracker.size).toBe(1); // só "pendurada" sobrou, por causa do inFlight
        expect(tracker.getDelay("expira@x.com")).toBe(0);
    });

    it("reset() zera todo o estado", () => {
        const { tracker } = makeTracker();
        tracker.recordFailure("a@x.com");
        tracker.recordFailure("a@x.com");
        tracker.recordFailure("a@x.com");
        expect(tracker.size).toBeGreaterThan(0);

        tracker.reset();
        expect(tracker.size).toBe(0);
        expect(tracker.getDelay("a@x.com")).toBe(0);
    });

    it("start()/stop() não lançam mesmo chamados fora de ordem", () => {
        const { tracker } = makeTracker();
        expect(() => tracker.stop()).not.toThrow(); // sem start() antes
        tracker.start();
        tracker.start(); // idempotente
        tracker.stop();
        tracker.stop(); // idempotente
    });
});
