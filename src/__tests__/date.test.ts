import { describe, it, expect } from "vitest";
import { addDays, getDateOnlyInTimezone } from "../utils/date";

// "Que dia é hoje para este usuário" decide streak, grace token e o
// início de cada versão de schedule. Erro aqui corrompe dado gravado.
const utc = (iso: string) => new Date(iso);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("getDateOnlyInTimezone", () => {
    it("devolve o dia local à meia-noite UTC", () => {
        expect(getDateOnlyInTimezone(utc("2026-11-20T15:00:00.000Z"), "America/Sao_Paulo")).toEqual(day("2026-11-20"));
    });

    it("23:30 em São Paulo ainda é o dia anterior, mesmo já sendo o dia seguinte em UTC", () => {
        // 2026-11-21T02:30Z = 2026-11-20 23:30 em São Paulo (UTC-3)
        expect(getDateOnlyInTimezone(utc("2026-11-21T02:30:00.000Z"), "America/Sao_Paulo")).toEqual(day("2026-11-20"));
        expect(getDateOnlyInTimezone(utc("2026-11-21T02:30:00.000Z"), "UTC")).toEqual(day("2026-11-21"));
    });

    it("a leste de UTC o dia vira antes (Tóquio, UTC+9)", () => {
        expect(getDateOnlyInTimezone(utc("2026-11-20T15:30:00.000Z"), "Asia/Tokyo")).toEqual(day("2026-11-21"));
    });

    it("meia-noite exata pertence ao dia novo", () => {
        expect(getDateOnlyInTimezone(utc("2026-11-21T03:00:00.000Z"), "America/Sao_Paulo")).toEqual(day("2026-11-21"));
        expect(getDateOnlyInTimezone(utc("2026-11-21T02:59:59.999Z"), "America/Sao_Paulo")).toEqual(day("2026-11-20"));
    });

    describe("horário de verão (America/Los_Angeles)", () => {
        it("início do horário de verão (2026-03-08): 23:30 local continua no dia 8", () => {
            // depois das 2h a cidade está em UTC-7; 23:30 PDT = 06:30Z do dia 9
            expect(getDateOnlyInTimezone(utc("2026-03-09T06:30:00.000Z"), "America/Los_Angeles")).toEqual(day("2026-03-08"));
        });

        it("fim do horário de verão (2026-11-01): a hora repetida não muda o dia", () => {
            // 01:30 acontece duas vezes; as duas são dia 1
            expect(getDateOnlyInTimezone(utc("2026-11-01T08:30:00.000Z"), "America/Los_Angeles")).toEqual(day("2026-11-01"));
            expect(getDateOnlyInTimezone(utc("2026-11-01T09:30:00.000Z"), "America/Los_Angeles")).toEqual(day("2026-11-01"));
            // 23:30 PST = 07:30Z do dia 2
            expect(getDateOnlyInTimezone(utc("2026-11-02T07:30:00.000Z"), "America/Los_Angeles")).toEqual(day("2026-11-01"));
        });
    });

    it("fuso com meia hora (Asia/Kolkata, UTC+5:30)", () => {
        expect(getDateOnlyInTimezone(utc("2026-11-20T18:29:00.000Z"), "Asia/Kolkata")).toEqual(day("2026-11-20"));
        expect(getDateOnlyInTimezone(utc("2026-11-20T18:30:00.000Z"), "Asia/Kolkata")).toEqual(day("2026-11-21"));
    });

    it("timezone inválido lança (o cadastro já barra, mas o erro não pode virar data errada)", () => {
        expect(() => getDateOnlyInTimezone(utc("2026-11-20T15:00:00.000Z"), "Marte/Olympus")).toThrow(RangeError);
    });
});

describe("addDays", () => {
    it.each([
        ["dentro do mês", "2026-11-20", 1, "2026-11-21"],
        ["virada de mês", "2026-11-30", 1, "2026-12-01"],
        ["virada de ano", "2026-12-31", 1, "2027-01-01"],
        ["29 de fevereiro em ano bissexto", "2028-02-28", 1, "2028-02-29"],
        ["sem 29 de fevereiro em ano comum", "2027-02-28", 1, "2027-03-01"],
        ["dias negativos", "2026-03-01", -1, "2026-02-28"],
        ["zero dias", "2026-11-20", 0, "2026-11-20"],
    ])("%s", (_caso, from, days, expected) => {
        expect(addDays(day(from), days)).toEqual(day(expected));
    });

    it("não altera a data recebida", () => {
        const original = day("2026-11-20");
        addDays(original, 5);
        expect(original).toEqual(day("2026-11-20"));
    });

    it("ignora horário de verão: soma dias de calendário em UTC", () => {
        // 2026-03-08 é o dia da mudança nos EUA; em UTC continua sendo +24h
        expect(addDays(day("2026-03-07"), 2)).toEqual(day("2026-03-09"));
    });
});
