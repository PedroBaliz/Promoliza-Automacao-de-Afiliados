export class DatabaseService {
  private sentProductIds: Set<string> = new Set();

  /**
   * Verifica se o produto já foi enviado recentemente
   */
  hasBeenSent(productId: string): boolean {
    return this.sentProductIds.has(productId);
  }

  /**
   * Registra o ID do produto enviado
   */
  markAsSent(productId: string): void {
    this.sentProductIds.add(productId);
  }
}