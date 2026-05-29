# HubSistemas — Gran Marquise TI

## O que é este projeto

Página hub com links e status de todos os sistemas internos desenvolvidos para o Hotel Gran Marquise.

- **Stack:** React (Babel standalone, sem build step) + nginx
- **Deploy:** Fly.io via GitHub Actions
- **Repositório:** https://github.com/caiobholanda/HubSistema

## Estrutura

```
public/
  index.html        — wrapper HTML com CDN do React/Babel
  HubMarquise.jsx   — componente React principal (todos os componentes)
nginx.conf          — config nginx para servir os arquivos estáticos
Dockerfile          — nginx:alpine copiando public/
fly.toml            — config do app Fly.io
.github/workflows/
  deploy.yml        — CI/CD: push em main → flyctl deploy
```

## Deploy automático

Push em `main` → GitHub Actions → `flyctl deploy --remote-only`

O secret `FLY_API_TOKEN` deve estar configurado no repositório GitHub.

## Como adicionar um novo sistema

Edite o array `HUB_SYSTEMS` em `public/HubMarquise.jsx`:
- `status`: `'no-ar'` | `'construcao'` | `'beta'` | `'concept'`
- `url`: URL do sistema (só funcional se `status === 'no-ar'`)
