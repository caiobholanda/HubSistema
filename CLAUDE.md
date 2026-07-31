# HubSistemas — Gran Marquise TI (Hub Portal)

## O que é este projeto

Portal interno que centraliza acesso, permissões e status de todos os sistemas de TI do
Hotel Gran Marquise (chamados, pesquisa de satisfação, diretório de ramais, etc.), com SSO
próprio entre o Hub e os sistemas satélite.

- **Stack:** Node.js + Express 4 (backend, `server.js`) servindo React 18 UMD + Babel
  standalone no frontend (sem build step)
- **Persistência:** JSON em volume Fly.io (`data/hub_data.json`) — não é banco de dados
- **Deploy:** Docker (`node:20-alpine`) → Fly.io, automático via GitHub Actions em push
  para `main`
- **Repositório:** https://github.com/Hotel-Gran-Marquise/hub-portal
- **Produção:** https://hub-granmarquise.fly.dev

## Estrutura

```
server.js              — backend Express completo: auth/JWT, CRUD sistemas/usuários,
                          permissões por site, SSO para satélites, proxy, audit log, SSE
public/
  index.html            — shell HTML (React/Babel via CDN)
  HubMarquise.jsx       — todo o frontend React (um único arquivo grande)
  ativar.html           — página standalone de ativação de conta (fora do bundle React)
src/                    — módulos de lógica pura, testados isoladamente
  permissions.js        — diffPermissoes (fail-closed: null/undefined vira [])
  site-permissions.js   — papéis válidos por site, normalização de email
  migrations.js         — migrações idempotentes de dados (ex.: renomear slug de sistema)
  audit-filtros.js      — filtros do log de auditoria
tests/                  — node:test, um arquivo por módulo de src/ + server.test.js
data/hub_data.json      — dados vivos (sistemas, usuários, audit, UHs...). Excluído do
                          contexto de build Docker, com exceção deste arquivo (.dockerignore)
Dockerfile              — node:20-alpine, roda `node server.js` diretamente (sem nginx)
fly.toml                — app hub-granmarquise, região gru, volume "hub_data" montado em
                          /app/data
nginx.conf              — NÃO é usado pelo Dockerfile atual (resquício de uma versão
                          anterior 100% estática); permanece no repo mas fora do build
.github/workflows/
  deploy.yml            — CI/CD: push em main → flyctl deploy (ignora commits que só
                          alteram data/** ou *.md, para não causar redeploy desnecessário)
MAPEAMENTO.md           — mapeamento arquitetural detalhado (rotas, componentes, lacunas
                          de segurança) gerado em sessão anterior de agentes; útil para
                          profundidade, mas pode ficar desatualizado — confira no código
                          antes de confiar cegamente
badge-demo.html         — protótipo standalone de badges de status, não linkado no app
```

## Deploy automático

Push em `main` → GitHub Actions → `flyctl deploy --remote-only`

O secret `FLY_API_TOKEN` deve estar configurado no repositório GitHub. Commits que só
tocam `data/**` ou `**/*.md` não disparam deploy (`paths-ignore` no workflow).

## Persistência e volume — cuidado ao mexer em deploy/infra

`data/hub_data.json` vive num volume Fly.io persistente montado em `/app/data`. O
Dockerfile gera um seed embutido na imagem (`/app/seed/hub_data.seed.json`, copiado do
`data/hub_data.json` versionado) para restaurar dados se o volume vier vazio por
reprovisionamento — sem nunca sobrescrever dados vivos existentes. `fly.toml` usa
`auto_stop_machines=false` e `min_machines_running=1` justamente para reduzir o churn de
deploy que causava esse reprovisionamento e zerava dados em produção. Não reverta essas
configs sem entender esse histórico.

## SSO com sistemas satélite

O Hub emite um JWT (`SSO_SECRET`) contendo `site_roles` por sistema. Satélites
(pesquisa-satisfacao, sistema-chamados, diretorio-ramais) chamam `POST /api/sso` com
`Authorization: Bearer SSO_SECRET` e o JWT do usuário para validar a sessão e obter o
papel local. Veja `MAPEAMENTO.md` § "Fluxo SSO" para o diagrama completo.

## Como adicionar um novo sistema ao hub

Edite o array de sistemas padrão (`DEFAULT_SISTEMAS` em `server.js` para o seed inicial;
gestão via UI usa as rotas `/api/sistemas`):
- `status`: `'no-ar'` | `'construcao'` | `'beta'` | `'concept'`
- `url`: URL do sistema (só funcional se `status === 'no-ar'`)

## Testes

`npm test` → `node --test tests/*.test.js`. Rode antes de qualquer mudança em `src/` ou
`server.js`.

## Pontos de atenção conhecidos

(detalhado em `MAPEAMENTO.md` § "Lacunas de Segurança") Sem rate limiting, sem CORS/helmet
configurados, JWT passado via query param no SSE (`/api/events?token=`), `SSO_SECRET`
usado tanto para assinar tokens quanto para verificar chamadas servidor-a-servidor, sem
validação de input no servidor. Redobre a atenção ao tocar em autenticação ou permissões.
