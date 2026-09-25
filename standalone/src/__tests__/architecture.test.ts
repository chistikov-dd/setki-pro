import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/**
 * Архитектурная проверка: standalone-приложение должно быть полностью автономным —
 * никаких сетевых вызовов (fetch/axios/WebSocket) и никакого Rust-серверного стека
 * (axum/reqwest) не должно быть нигде в коде.
 */

const SRC_DIR = join(__dirname, '..');
const SRC_TAURI_DIR = join(__dirname, '..', '..', 'src-tauri', 'src');

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules') continue;
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.includes(extname(entry))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('architecture: standalone app has no networking code', () => {
  it('frontend source contains no fetch()/axios/WebSocket usage', () => {
    const files = collectFiles(SRC_DIR, ['.ts', '.tsx']);
    const offenders: string[] = [];

    for (const file of files) {
      if (file.includes('__tests__') || file.includes('/test/')) continue;
      const content = readFileSync(file, 'utf-8');

      if (/\bfetch\s*\(/.test(content)) offenders.push(`${file}: fetch(`);
      if (/\baxios\b/.test(content)) offenders.push(`${file}: axios`);
      if (/\bnew\s+WebSocket\s*\(/.test(content)) offenders.push(`${file}: new WebSocket(`);
    }

    expect(offenders).toEqual([]);
  });

  it('Rust source contains no axum/reqwest/mdns-sd usage', () => {
    const files = collectFiles(SRC_TAURI_DIR, ['.rs']);
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/\baxum\b/.test(content)) offenders.push(`${file}: axum`);
      if (/\breqwest\b/.test(content)) offenders.push(`${file}: reqwest`);
      if (/\bmdns[-_]sd\b/.test(content)) offenders.push(`${file}: mdns-sd`);
    }

    expect(offenders).toEqual([]);
  });

  it('Cargo.toml does not declare networking/server dependencies', () => {
    const cargoToml = readFileSync(join(SRC_TAURI_DIR, '..', 'Cargo.toml'), 'utf-8');

    for (const dep of ['axum', 'reqwest', 'tower', 'tower-http', 'mdns-sd']) {
      expect(cargoToml).not.toMatch(new RegExp(`^${dep}\\s*=`, 'm'));
    }
  });

  it('package.json does not declare websocket/http client libraries', () => {
    const pkg = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const forbidden of ['axios', 'ws', 'socket.io-client']) {
      expect(allDeps[forbidden]).toBeUndefined();
    }
  });
});
