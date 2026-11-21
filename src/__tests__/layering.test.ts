import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// issue #22: a camada de dados não pode depender da raiz HTTP (app.ts),
// senão volta o ciclo app -> routes -> controllers -> services -> app.
const SRC_DIR = path.resolve(__dirname, '..');
const EXCLUDED_DIRS = new Set(['generated', '__tests__']);

function listTsFiles(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) listTsFiles(path.join(dir, entry.name), files);
            continue;
        }
        if (entry.name.endsWith('.ts')) files.push(path.join(dir, entry.name));
    }
    return files;
}

function importsOf(file: string): string[] {
    const content = fs.readFileSync(file, 'utf8');
    return Array.from(content.matchAll(/from\s+['"]([^'"]+)['"]/g), (m) => m[1]);
}

describe('camadas', () => {
    it('só server.ts importa app.ts', () => {
        const offenders = listTsFiles(SRC_DIR)
            .filter((file) => path.relative(SRC_DIR, file) !== 'server.ts')
            .filter((file) => importsOf(file).some((spec) => /(^|\/)app$/.test(spec)))
            .map((file) => path.relative(SRC_DIR, file));

        expect(offenders).toEqual([]);
    });

    it('src/domain não importa nada que toque o banco', () => {
        const domainDir = path.join(SRC_DIR, 'domain');
        const offenders = listTsFiles(domainDir)
            .filter((file) => importsOf(file).some((spec) => /(^|\/)(db|app|repositories\/.*)$/.test(spec)))
            .map((file) => path.relative(SRC_DIR, file));

        expect(offenders).toEqual([]);
    });
});
