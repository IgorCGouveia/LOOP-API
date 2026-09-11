import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');
const REPOSITORY_FILE = path.resolve(SRC_DIR, 'repositories', 'checkinRepository.ts');
const EXCLUDED_DIRS = new Set(['generated', '__tests__']);
const FORBIDDEN_PATTERNS = [/prisma\.habitLog\b/, /prisma\.graceFill\b/, /prisma\.habitSchedule\b/];

function listTsFiles(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) {
                listTsFiles(path.join(dir, entry.name), files);
            }
            continue;
        }
        if (entry.name.endsWith('.ts')) {
            files.push(path.join(dir, entry.name));
        }
    }
    return files;
}

describe('checkinRepository é o único ponto de acesso a HabitLog/GraceFill/HabitSchedule', () => {
    it('nenhum arquivo fora do repositório usa prisma.habitLog, prisma.graceFill ou prisma.habitSchedule', () => {
        const offenders = listTsFiles(SRC_DIR)
            .filter((file) => file !== REPOSITORY_FILE)
            .filter((file) => {
                const content = fs.readFileSync(file, 'utf8');
                return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
            })
            .map((file) => path.relative(SRC_DIR, file));

        expect(offenders).toEqual([]);
    });
});
