import fs from 'fs';
import path from 'path';

export class DatabaseService {
  private sentProductIds: Set<string> = new Set();
  private readonly storageFilePath = path.resolve(process.cwd(), 'src', 'config', 'posted-products.json');

  constructor() {
    this.loadPersistedProducts();
  }

  private loadPersistedProducts(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) {
        return;
      }

      const raw = fs.readFileSync(this.storageFilePath, 'utf8');
      const parsed = JSON.parse(raw) as { productIds?: string[] };

      if (Array.isArray(parsed.productIds)) {
        parsed.productIds.forEach((productId) => this.sentProductIds.add(productId));
      }
    } catch (error) {
      console.warn('⚠️ [Database] Não foi possível carregar os produtos enviados persistidos:', error);
    }
  }

  private persistProducts(): void {
    try {
      const dir = path.dirname(this.storageFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFilePath, JSON.stringify({ productIds: [...this.sentProductIds] }, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ [Database] Erro ao persistir produtos enviados:', error);
    }
  }

  /**
   * Verifica se o produto já foi enviado recentemente
   */
  isProductPosted(productId: string): boolean {
    return this.sentProductIds.has(productId);
  }

  /**
   * Registra o ID do produto enviado
   */
  savePostedProduct(productId: string): void {
    this.sentProductIds.add(productId);
    this.persistProducts();
  }

  hasBeenSent(productId: string): boolean {
    return this.isProductPosted(productId);
  }

  markAsSent(productId: string): void {
    this.savePostedProduct(productId);
  }
}