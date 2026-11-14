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
const DAY = 24 * 60 * 60 * 1000;
let DatabaseService: typeof import('./database.service').DatabaseService;

before(async () => {
  process.chdir(tempDir);
  ({ DatabaseService } = await import('./database.service'));
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

  test('entradas com mais de 30 dias são descartadas na carga', () => {
    writeStorage({ products: { velho: Date.now() - 31 * DAY, novo: Date.now() - 1 * DAY } });
    const db = new DatabaseService();
    assert.equal(db.hasBeenSent('velho'), false);
    assert.equal(db.hasBeenSent('novo'), true);
  });

  test('entrada que expira durante a execução deixa de contar e é removida do arquivo', (t) => {
    const start = Date.now();
    const now = t.mock.method(Date, 'now', () => start);
    const db = new DatabaseService();
    db.markAsSent('expira');
    now.mock.mockImplementation(() => start + 30 * DAY);
    assert.equal(db.hasBeenSent('expira'), false);
    assert.equal('expira' in readStorage().products, false);
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
