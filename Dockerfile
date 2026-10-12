# Usa uma imagem oficial e leve do Node.js
FROM node:20-alpine AS builder

# Define o diretório de trabalho no contêiner
WORKDIR /app

# Copia os ficheiros de dependências
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para build do TS)
RUN npm install

# Copia o código-fonte e o tsconfig
COPY tsconfig.json ./
COPY src ./src

# Compila o TypeScript para JavaScript (pasta dist)
RUN npm run build

# Stage de Produção
FROM node:20-alpine AS runner

WORKDIR /app

# Define ambiente de produção
ENV NODE_ENV=production

# Copia os ficheiros de dependências
COPY package*.json ./

# Instala apenas as dependências de produção
RUN npm ci --only=production

# Copia o código compilado da etapa anterior
COPY --from=builder /app/dist ./dist

# Comando para iniciar o robô em produção
CMD ["node", "-r", "dotenv/config", "dist/index.js"]