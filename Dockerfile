# =====================================================================
# Multica Telegram Bridge — Imagem Docker (multi-stage)
# =====================================================================

# ----------------------------- Stage 1: build -----------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Instala dependências (incluindo devDependencies para compilar o TypeScript).
COPY package*.json ./
RUN npm ci

# Copia o código e compila para dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies, mantendo apenas as de produção.
RUN npm prune --omit=dev

# --------------------------- Stage 2: runtime ----------------------------
FROM node:22-alpine AS runtime

# Boas práticas de segurança:
# - roda como usuário não-root (o node:alpine já traz o usuário "node");
# - usa o init "tini" para encaminhar sinais e evitar processos zumbis;
# - NODE_ENV=production desativa logs verbosos e otimiza dependências.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    BRIDGE_PORT=3333

WORKDIR /app

# Copia apenas os artefatos necessários, com dono "node".
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package*.json ./

USER node

EXPOSE 3333

# Health check do contêiner usa o endpoint HTTP /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRIDGE_PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
