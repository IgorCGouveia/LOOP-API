// Dado um instante exato e um timezone IANA, devolve o dia calendário
// correspondente como Date em UTC à meia-noite. Compartilhado entre
// checkinServices e habitServices — qualquer decisão de "qual dia é
// hoje" usa o mesmo mecanismo.
export function getDateOnlyInTimezone(instant: Date, timezone: string): Date {
    const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);

    return new Date(`${formatted}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}
