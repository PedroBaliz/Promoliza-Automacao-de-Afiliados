import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  mercadolivre: {
    clientId: process.env.MLB_CLIENT_ID || '',
    clientSecret: process.env.MLB_CLIENT_SECRET || '',
    initialAccessToken: process.env.MLB_ACCESS_TOKEN || '',
    initialRefreshToken: process.env.MLB_REFRESH_TOKEN || '',
    baseUrl: 'https://api.mercadolibre.com',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  tokensFilePath: path.resolve(process.cwd(), 'src', 'config', 'tokens.json'),
};
