import fs from 'fs';
import path from 'path';
import { config } from '../config/env.config';

type StoredProducts = {
  products?: Record<string, number>;
  productIds?: string[];
};

// Um produto não é republicado no mesmo dia (calendário de Brasília); no dia seguinte, pode de novo.
const TIME_ZONE = 'America/Sao_Paulo';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia no fuso de Brasília, como "2026-11-17". */
export function dayKey(timestamp: number): string {
  return dayFormatter.format(new Date(timestamp));
}

function isSameDay(timestamp: number, now: number): boolean {
  return dayKey(timestamp) === dayKey(now);
}

export class DatabaseService {
  private sentProducts = new Map<string, number>();
  private readonly storageFilePath = config.postedProductsFilePath;

  constructor() {
    this.loadPersistedProducts();
  }

  private loadPersistedProducts(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf8')) as StoredProducts;
      const now = Date.now();

      if (parsed.products && typeof parsed.products === 'object') {
        for (const [id, timestamp] of Object.entries(parsed.products)) {
          if (typeof timestamp === 'number' && isSameDay(timestamp, now)) {
            this.sentProducts.set(id, timestamp);
          }
        }
      } else if (Array.isArray(parsed.productIds)) {
        // Legacy format had no timestamps; retain those entries for one migration window.
        for (const id of parsed.productIds) {
          if (typeof id === 'string' && id) this.sentProducts.set(id, now);
        }
        this.persistProducts();
      }
    } catch (error) {
      console.warn('[Database] Não foi possível carregar o histórico de produtos publicados:', error);
    }
  }

  private persistProducts(): void {
    try {
      const dir = path.dirname(this.storageFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const temporaryPath = `${this.storageFilePath}.tmp`;
      const products = Object.fromEntries(this.sentProducts);
      fs.writeFileSync(temporaryPath, JSON.stringify({ products }, null, 2), 'utf8');
      fs.renameSync(temporaryPath, this.storageFilePath);
    } catch (error) {
      console.error('[Database] Erro ao persistir histórico de produtos:', error);
    }
  }

  isProductPosted(productId: string): boolean {
    const timestamp = this.sentProducts.get(productId);
    if (timestamp === undefined) return false;
    if (!isSameDay(timestamp, Date.now())) {
      this.sentProducts.delete(productId);
      this.persistProducts();
      return false;
    }
    return true;
  }

  savePostedProduct(productId: string): void {
    const now = Date.now();
    // Remove os de dias anteriores para o arquivo não crescer sem limite.
    for (const [id, timestamp] of this.sentProducts) {
      if (!isSameDay(timestamp, now)) this.sentProducts.delete(id);
    }
    this.sentProducts.set(productId, now);
    this.persistProducts();
  }

  hasBeenSent(productId: string): boolean {
    return this.isProductPosted(productId);
  }

  markAsSent(productId: string): void {
    this.savePostedProduct(productId);
  }
}
