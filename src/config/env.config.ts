import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const port = Number.parseInt(process.env.PORT || '3000', 10);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number.isFinite(port) && port > 0 ? port : 3000,
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    apiId: Number.parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    sourcePhone: process.env.TELEGRAM_SOURCE_PHONE || '',
    sourceSession: process.env.TELEGRAM_SOURCE_SESSION || '',
    sourceChats: (process.env.TELEGRAM_SOURCE_CHATS || '')
      .split(',')
      .map((chat) => chat.trim())
      .filter(Boolean),
  },
  whatsapp: {
    groupJid: process.env.WHATSAPP_GROUP_JID || '',
    // Número da conta (só dígitos, com DDI): conecta por código de pareamento em vez de QR.
    pairingPhone: (process.env.WHATSAPP_PAIRING_PHONE || '').replace(/\D/g, ''),
  },
  postedProductsFilePath: path.resolve(process.cwd(), '.local', 'posted-products.json'),
};
