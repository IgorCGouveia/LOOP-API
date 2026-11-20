// Barreira pra teste de concorrência: segura cada chamador em arrive()
// até `parties` chamadores distintos chegarem, ou até `timeoutMs` depois
// do 1º. `key` identifica o chamador (ex.: o `tx` da transação): o mesmo
// chamador passando de novo não conta duas vezes. Depois de liberada,
// arrive() passa direto (vale uma vez só).
//
// `releasedBy` diz como foi liberada: "parties" prova que as requisições
// estavam lado a lado naquele ponto; "timeout" prova que uma ficou
// bloqueada antes de chegar (ex.: esperando uma trava do banco).
export type Barrier = {
    arrive(key?: unknown): Promise<void>;
    readonly arrived: number;
    readonly releasedBy: "parties" | "timeout" | null;
};

export function createBarrier(parties: number, timeoutMs = 1000): Barrier {
    const seen = new Set<unknown>();
    let arrived = 0;
    let releasedBy: Barrier["releasedBy"] = null;
    let timer: NodeJS.Timeout | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    function open(reason: "parties" | "timeout") {
        if (releasedBy) return;
        releasedBy = reason;
        clearTimeout(timer);
        release();
    }

    return {
        async arrive(key: unknown = Symbol()) {
            if (releasedBy) return;
            if (!seen.has(key)) {
                seen.add(key);
                arrived++;
            }
            if (arrived >= parties) {
                open("parties");
            } else if (!timer) {
                timer = setTimeout(() => open("timeout"), timeoutMs);
            }
            await gate;
        },
        get arrived() {
            return arrived;
        },
        get releasedBy() {
            return releasedBy;
        },
    };
}
