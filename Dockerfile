FROM node:20-slim

# Instala bibliotecas necessárias para o Chromium do Puppeteer rodar em ambiente Linux
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt-get/lists/*

# Configura o Puppeteer para usar o Chromium instalado no sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Executa a compilação do TypeScript para a pasta ./dist
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]