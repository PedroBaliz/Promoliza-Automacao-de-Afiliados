import axios from 'axios';
import fs from 'fs';
import { config } from '../config/env.config';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  updatedAt: string;
}

export class AuthService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.loadTokens();
  }

  /**
   * Carrega os tokens do ficheiro tokens.json ou toma como fallback as variáveis de ambiente
   */
  private loadTokens(): void {
    try {
      if (fs.existsSync(config.tokensFilePath)) {
        const fileContent = fs.readFileSync(config.tokensFilePath, 'utf8');
        const data: TokenData = JSON.parse(fileContent);
        
        if (data.accessToken && data.refreshToken) {
          this.accessToken = data.accessToken;
          this.refreshToken = data.refreshToken;
          return;
        }
      }
    } catch (error) {
      console.warn('⚠️ [Auth] Não foi possível carregar tokens.json, a usar valores do .env');
    }

    this.accessToken = config.mercadolivre.initialAccessToken;
    this.refreshToken = config.mercadolivre.initialRefreshToken;
  }

  /**
   * Salva o novo par de tokens no ficheiro tokens.json
   */
  private saveTokens(accessToken: string, refreshToken: string): void {
    const data: TokenData = {
      accessToken,
      refreshToken,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(config.tokensFilePath, JSON.stringify(data, null, 2), 'utf8');
      console.log('💾 [Auth] Novos tokens persistidos com sucesso em config/tokens.json');
    } catch (error: any) {
      console.error('❌ [Auth] Erro ao guardar ficheiro tokens.json:', error?.message);
    }
  }

  /**
   * Retorna um Access Token válido, renovando-o se necessário
   */
  async getValidToken(): Promise<string> {
    const now = Date.now();

    if (this.accessToken && this.tokenExpiresAt > now + 5 * 60 * 1000) {
      return this.accessToken;
    }

    if (!this.refreshToken) {
      throw new Error('Nenhum Refresh Token encontrado no .env nem em config/tokens.json');
    }

    console.log('🔄 [Auth] Renovando Access Token do Mercado Livre...');
    await this.refreshAccessToken();

    return this.accessToken!;
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const response = await axios.post(
        `${config.mercadolivre.baseUrl}/oauth/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: config.mercadolivre.clientId,
          client_secret: config.mercadolivre.clientSecret,
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
      this.refreshToken = refresh_token;
      this.tokenExpiresAt = Date.now() + expires_in * 1000;

      // Salva automaticamente no ficheiro de configuração
      this.saveTokens(access_token, refresh_token);
      console.log('✅ [Auth] Access Token renovado com sucesso!');
    } catch (error: any) {
      console.error('❌ [Auth] Erro ao renovar o token:', error?.response?.data || error?.message);
      throw error;
    }
  }
}