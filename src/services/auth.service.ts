import axios from 'axios';

export class AuthService {
  private accessToken: string | null = process.env.MLB_ACCESS_TOKEN || null;
  private refreshToken: string | null = process.env.MLB_REFRESH_TOKEN || null;
  private tokenExpiresAt: number = 0; // Timestamp em milissegundos

  /**
   * Retorna um Access Token válido. Se estiver expirado (ou próximo de expirar),
   * realiza a renovação automática via Refresh Token.
   */
  async getValidToken(): Promise<string> {
    const now = Date.now();

    // Se o token existe e ainda faltam mais de 5 minutos para expirar, reutiliza
    if (this.accessToken && this.tokenExpiresAt > now + 5 * 60 * 1000) {
      return this.accessToken;
    }

    // Se não há refresh token disponível nas variáveis de ambiente
    if (!this.refreshToken) {
      throw new Error('MLB_REFRESH_TOKEN não está definido no arquivo .env');
    }

    console.log('🔄 [Auth] Renovando Access Token do Mercado Livre...');
    await this.refreshAccessToken();

    return this.accessToken!;
  }

  /**
   * Realiza a chamada OAuth2 para o endpoint de token do Mercado Livre
   */
  private async refreshAccessToken(): Promise<void> {
    try {
      const response = await axios.post(
        'https://api.mercadolibre.com/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.MLB_CLIENT_ID || '',
          client_secret: process.env.MLB_CLIENT_SECRET || '',
          refresh_token: this.refreshToken!,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      this.accessToken = access_token;
      // O Mercado Livre envia um novo refresh_token em cada rotação
      this.refreshToken = refresh_token; 
      // expires_in vem em segundos (geralmente 21600s = 6h)
      this.tokenExpiresAt = Date.now() + expires_in * 1000;

      console.log('✅ [Auth] Access Token renovado com sucesso!');
      console.log(`🔑 Novo Refresh Token gerado: ${refresh_token}`);
      console.log('⚠️ Atualize a variável MLB_REFRESH_TOKEN no seu .env se reiniciar o contêiner.');
    } catch (error: any) {
      console.error('❌ [Auth] Erro ao renovar o token de acesso:', error?.response?.data || error?.message);
      throw error;
    }
  }
}