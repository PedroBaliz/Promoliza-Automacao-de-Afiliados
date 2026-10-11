// Estrutura do produto retornado e filtrado do Mercado Livre
export interface Product {
  id: string;
  title: string;
  originalPrice: number;
  promotionalPrice: number;
  discountPercentage: number;
  permalink: string;
  thumbnail: string;
  freeShipping: boolean;
  sellerReputation?: string;
}

// Estrutura do payload enriquecido pronto para envio
export interface OfferPayload {
  product: Product;
  caption: string;
  affiliateUrl: string;
}

// Interface base do provedor de mensagens (Strategy Pattern)
export interface IMessengerProvider {
  sendOffer(payload: OfferPayload): Promise<void>;
}