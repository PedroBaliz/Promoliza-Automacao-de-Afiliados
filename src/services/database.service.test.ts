import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// env.config resolve o arquivo de histórico a partir do cwd no momento do import: troca para
// um diretório temporário para não tocar no .local/.env reais do projeto.
const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promoliza-db-'));
const storageFile = path.join(tempDir, '.local', 'posted-products.json');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let DatabaseService: typeof import('./database.service').DatabaseService;
let dayKey: typeof import('./database.service').dayKey;

before(async () => {
  process.chdir(tempDir);
  ({ DatabaseService, dayKey } = await import('./database.service'));
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(tempDir, '.local'), { recursive: true, force: true });
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

function writeStorage(content: unknown) {
  fs.mkdirSync(path.dirname(storageFile), { recursive: true });
  fs.writeFileSync(storageFile, typeof content === 'string' ? content : JSON.stringify(content));
}

function readStorage(): any {
  return JSON.parse(fs.readFileSync(storageFile, 'utf8'));
}

describe('DatabaseService', () => {
  test('usa o arquivo dentro do diretório temporário', () => {
    // Garantia de isolamento: o teste não pode escrever no .local do projeto.
    const db = new DatabaseService();
    db.markAsSent('ml:MLB1');
    assert.ok(fs.existsSync(storageFile));
  });

  test('sem arquivo começa vazio', () => {
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('ml:MLB1'), false);
    assert.equal(db.isProductPosted('ml:MLB1'), false);
  });

  test('markAsSent persiste e outra instância enxerga', () => {
    new DatabaseService().markAsSent('ml:MLB123');
    assert.equal(typeof readStorage().products['ml:MLB123'], 'number');
    assert.equal(new DatabaseService().hasBeenSent('ml:MLB123'), true);
    assert.equal(fs.existsSync(`${storageFile}.tmp`), false);
  });

  test('na carga, só valem os produtos enviados hoje (horário de Brasília)', (t) => {
    const now = Date.UTC(2026, 10, 17, 15, 0); // 17/11 12:00 em Brasília
    t.mock.method(Date, 'now', () => now);
    writeStorage({
      products: {
        ontem: now - 13 * HOUR, // 16/11 23:00 em Brasília
        hoje: now - 11 * HOUR, // 17/11 01:00 em Brasília
        mes_passado: now - 30 * DAY,
      },
    });
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('ontem'), false);
    assert.equal(db.hasBeenSent('mes_passado'), false);
    assert.equal(db.hasBeenSent('hoje'), true);
  });

  test('bloqueia até 23:59 do mesmo dia e libera a partir de 00:00 do dia seguinte', (t) => {
    const sentAt = Date.UTC(2026, 10, 18, 2, 50); // 17/11 23:50 em Brasília
    const now = t.mock.method(Date, 'now', () => sentAt);
    const db = new DatabaseService();
    db.markAsSent('produto');

    now.mock.mockImplementation(() => Date.UTC(2026, 10, 18, 2, 59)); // 17/11 23:59
    assert.equal(db.hasBeenSent('produto'), true);

    now.mock.mockImplementation(() => Date.UTC(2026, 10, 18, 3, 1)); // 18/11 00:01
    assert.equal(db.hasBeenSent('produto'), false);
    assert.equal('produto' in readStorage().products, false);
  });

  test('ao salvar, remove do arquivo os produtos de dias anteriores', (t) => {
    const day1 = Date.UTC(2026, 10, 17, 15, 0);
    const now = t.mock.method(Date, 'now', () => day1);
    const db = new DatabaseService();
    db.markAsSent('ontem');
    now.mock.mockImplementation(() => day1 + DAY);
    db.markAsSent('hoje');
    assert.deepEqual(Object.keys(readStorage().products), ['hoje']);
  });

  test('dayKey usa o fuso de Brasília', () => {
    assert.equal(dayKey(Date.UTC(2026, 10, 18, 2, 59)), '2026-11-17');
    assert.equal(dayKey(Date.UTC(2026, 10, 18, 3, 0)), '2026-11-18');
  });

  test('timestamps inválidos são ignorados', () => {
    writeStorage({ products: { a: 'ontem', b: null, c: Date.now() } });
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('a'), false);
    assert.equal(db.hasBeenSent('b'), false);
    assert.equal(db.hasBeenSent('c'), true);
  });

  test('formato legado (productIds) é migrado para products com timestamp', () => {
    writeStorage({ productIds: ['MLB1', 'MLB2', '', 5] });
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('MLB1'), true);
    assert.equal(db.hasBeenSent('MLB2'), true);
    const stored = readStorage();
    assert.deepEqual(Object.keys(stored.products).sort(), ['MLB1', 'MLB2']);
    assert.equal(stored.productIds, undefined);
  });

  test('JSON corrompido não derruba o serviço', () => {
    writeStorage('{ isso não é json');
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('x'), false);
    db.markAsSent('x');
    assert.equal(new DatabaseService().hasBeenSent('x'), true);
  });
});
