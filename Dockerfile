FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
# Seed embutido na imagem (fora do mount /app/data) para recuperar dados quando o
# volume do Fly vier vazio. Derivado do proprio data/hub_data.json versionado — nao
# adiciona nova copia de PII ao git.
RUN mkdir -p /app/seed && (cp data/hub_data.json /app/seed/hub_data.seed.json 2>/dev/null || echo "[build] aviso: seed source ausente, build segue sem seed")
EXPOSE 3000
CMD ["node", "server.js"]
