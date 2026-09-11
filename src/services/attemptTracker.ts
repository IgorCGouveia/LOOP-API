// Layer de conta do rate limit do /login: delay progressivo por email, não
// deny (hard-deny vira DoS direcionado). Store em Map na mão — instância
// única por enquanto; trocar por Redis sem tocar no handler se precisar.

export type AttemptTrackerOptions = {
    /** tentativas sem penalidade antes do delay começar */
    freeAttempts?: number;
    /** ms de delay por tentativa excedente; a última entrada é o teto */
    delaysMs?: number[];
    /** janela deslizante: passado isso sem falha, o contador zera */
    windowMs?: number;
    /** respostas em delay simultâneas por identificador; além disso, 429 */
    maxConcurrent?: number;
    /** teto duro de entradas no Map (backstop pro sweep) */
    maxEntries?: number;
    /** intervalo do sweep de entradas expiradas */
    sweepIntervalMs?: number;
    /** injetável pra teste */
    now?: () => number;
};

type Entry = {
    count: number;
    lastFailureAt: number;
    inFlight: number;
};

const DEFAULTS = {
    freeAttempts: 3,
    delaysMs: [1000, 2000, 5000],
    windowMs: 15 * 60 * 1000,
    maxConcurrent: 3,
    maxEntries: 50_000,
    sweepIntervalMs: 60_000,
};

function normalize(identifier: string): string {
    return identifier.trim().toLowerCase();
}

export class AttemptTracker {
    private readonly entries = new Map<string, Entry>();
    private readonly opts: Required<Omit<AttemptTrackerOptions, 'now'>>;
    private readonly now: () => number;
    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(options: AttemptTrackerOptions = {}) {
        this.opts = {
            freeAttempts: options.freeAttempts ?? DEFAULTS.freeAttempts,
            delaysMs: options.delaysMs ?? DEFAULTS.delaysMs,
            windowMs: options.windowMs ?? DEFAULTS.windowMs,
            maxConcurrent: options.maxConcurrent ?? DEFAULTS.maxConcurrent,
            maxEntries: options.maxEntries ?? DEFAULTS.maxEntries,
            sweepIntervalMs: options.sweepIntervalMs ?? DEFAULTS.sweepIntervalMs,
        };
        this.now = options.now ?? Date.now;
    }

    /** inicia o sweep periódico. Idempotente. */
    start(): void {
        if (this.sweepTimer) return;
        this.sweepTimer = setInterval(() => this.sweep(), this.opts.sweepIntervalMs);
    }

    /** para o sweep e libera o processo (chamado no teardown dos testes). */
    stop(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
    }

    /** zera todo o estado (chamado no afterEach de testes que batem em /login). */
    reset(): void {
        this.entries.clear();
    }

    /** Delay em ms pra essa resposta (aplica em sucesso e falha, simétrico). */
    getDelay(identifier: string): number {
        const entry = this.entries.get(normalize(identifier));
        const expired = !entry || this.now() - entry.lastFailureAt >= this.opts.windowMs;
        const priorFailures = expired ? 0 : entry!.count;

        // getDelay roda ANTES da tentativa acontecer, então quem importa é o
        // número da tentativa que está prestes a ser feita (falhas + 1), não
        // só as falhas já registradas — senão a 1ª tentativa depois de
        // esgotar o free sai sem delay por engano.
        const excess = priorFailures + 1 - this.opts.freeAttempts;
        if (excess <= 0) return 0;

        const idx = Math.min(excess - 1, this.opts.delaysMs.length - 1);
        return this.opts.delaysMs[idx];
    }

    /** Reserva um slot de resposta-em-delay. `false` = já tem maxConcurrent penduradas. */
    acquireSlot(identifier: string): boolean {
        const key = normalize(identifier);
        const entry = this.entries.get(key);
        const inFlight = entry?.inFlight ?? 0;
        if (inFlight >= this.opts.maxConcurrent) return false;

        if (entry) {
            entry.inFlight = inFlight + 1;
        } else {
            // guarda defensiva, não deveria acontecer (getDelay teria dado 0)
            this.entries.set(key, { count: 0, lastFailureAt: this.now(), inFlight: 1 });
        }
        return true;
    }

    releaseSlot(identifier: string): void {
        const entry = this.entries.get(normalize(identifier));
        if (entry && entry.inFlight > 0) entry.inFlight -= 1;
    }

    /** Registra falha de login. Incrementa igual exista a conta ou não. */
    recordFailure(identifier: string): void {
        const key = normalize(identifier);
        const now = this.now();
        const existing = this.entries.get(key);

        // delete + set joga a chave pro fim da ordem do Map = LRU de graça
        if (existing) {
            this.entries.delete(key);
            const expired = now - existing.lastFailureAt >= this.opts.windowMs;
            this.entries.set(key, {
                count: expired ? 1 : existing.count + 1,
                lastFailureAt: now,
                inFlight: existing.inFlight,
            });
        } else {
            this.entries.set(key, { count: 1, lastFailureAt: now, inFlight: 0 });
        }

        this.evictIfNeeded();
    }

    /** login bem-sucedido zera o contador daquele identificador. */
    recordSuccess(identifier: string): void {
        this.entries.delete(normalize(identifier));
    }

    /** remove entradas fora da janela e sem resposta pendurada. */
    sweep(): void {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.inFlight === 0 && now - entry.lastFailureAt > this.opts.windowMs) {
                this.entries.delete(key);
            }
        }
    }

    get size(): number {
        return this.entries.size;
    }

    // backstop pro sweep: corta em lote pra 90% do teto, mais antigos primeiro
    private evictIfNeeded(): void {
        if (this.entries.size <= this.opts.maxEntries) return;

        const target = Math.floor(this.opts.maxEntries * 0.9);
        for (const [key, entry] of this.entries) {
            if (this.entries.size <= target) break;
            if (entry.inFlight > 0) continue; // não despeja quem tem resposta pendurada
            this.entries.delete(key);
        }
    }
}

// Singleton usado pelo handler de /login (ver src/__tests__/setup.ts pro
// stop() no teardown dos testes).
export const attemptTracker = new AttemptTracker();
attemptTracker.start();
