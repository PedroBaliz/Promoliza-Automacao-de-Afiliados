import axios from 'axios';
import { config } from '../config/env.config';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function cleanCaption(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .slice(0, 900);
}

export class GeminiService {
  async generateCaption(sourceText: string): Promise<string> {
    if (!config.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY não foi configurada no .env');
    }

    let response;
    try {
      response = await axios.post<GeminiResponse>(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent`,
        {
          systemInstruction: {
            parts: [{ text: config.gemini.prompt }],
          },
          contents: [{ role: 'user', parts: [{ text: sourceText }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 180,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        },
        {
          params: { key: config.gemini.apiKey },
          timeout: 20_000,
          validateStatus: (status) => status >= 200 && status < 300,
        },
      );
    } catch (error: unknown) {
      if (axios.isAxiosError<GeminiResponse>(error)) {
        const apiMessage = error.response?.data?.error?.message;
        throw new Error(
          `Gemini recusou a solicitação (${error.response?.status || 'sem status'}): ` +
            (apiMessage || error.message),
        );
      }
      throw error;
    }

    const caption = cleanCaption(
      response.data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim() || '',
    );

    if (!caption) {
      throw new Error(response.data.error?.message || 'Gemini não retornou uma legenda válida.');
    }

    console.log(`[Gemini] Legenda gerada: "${caption.replace(/\s+/g, ' ').slice(0, 180)}"`);
    return caption;
  }
}
