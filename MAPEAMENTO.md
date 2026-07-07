# HubSistemas — Mapeamento Arquitetural

> Gerado por 50+ agentes em 2026-07-07. Atualizar sempre que alterar o projeto.

**URL produção:** hub-granmarquise.fly.dev  
**Stack:** Node.js + Express 4 / React 18 UMD + Babel standalone (sem build)  
**Persistência:** JSON em volume Fly.io (`/app/data/hub_data.json`)

---

## Estrutura de Arquivos

```
HubSistemas/
├── server.js               # 1002 linhas — servidor completo
├── public/
│   ├── index.html          # shell HTML + window.onerror handler (sem React ErrorBoundary)
│   └── HubMarquise.jsx     # 3528 linhas — toda a UI React
├── src/
│   ├── permissions.js      # diffPermissoes, fail-closed
│   ├── site-permissions.js # PAPEIS_VALIDOS, MIGRATION_SEED, _norm()
│   ├── migrations.js       # SISTEMA_SLUG_RENAMES, idempotent
│   └── audit-filtros.js    # aplicarFiltros()
├── tests/                  # 5 arquivos, 38 test cases (node:test)
├── package.json
├── Dockerfile
└── fly.toml
```

---

## server.js (1002 linhas)

### Variáveis de ambiente
- `PORT` (padrão 3000)
- `SSO_SECRET` — dual-use: assina tokens Hub E verifica chamadas S2S de satélites
- `DATA_FILE` (padrão `/app/data/hub_data.json`)

### hub_data.json
```json
{ "sistemas": [...], "usuarios": [...], "audit": [...] }
```

### Funções utilitárias
| Função | Linhas | Detalhe |
|---|---|---|
| `_sanitizarStr(s)` | ~68 | Remove U+FFFD de string; usa `RE_FFFD = new RegExp(...)` |
| `_sanitizarAuditLog()` | ~73 | Startup migration: corrige encoding + nula target_nome inválido |
| `appendAudit(entry)` | ~107 | Cap em **5000 entradas** (FIFO) |
| `requireAdmin(req,res,next)` | 251-263 | JWT Bearer; exige `payload.tipo === 'admin'` |
| `autoAssociarTodos()` | 217-225 | Vincula usuários aos sistemas padrão |
| `notifyUser(userId, payload)` | 244-247 | SSE push para cliente específico |
| `proxyPesquisa(req, res)` | 552-565 | Proxy → pesquisa-satisfacao.fly.dev; **502** se offline |
| `proxyChamados(req, res)` | 581-594 | Proxy → sistema-chamados-granmarquise.fly.dev |

**Startup order:** `initSistemas()` → `_sanitizarAuditLog()` → `app.listen()`

### DEFAULT_SISTEMAS (linhas 229-233)
1. `pesquisa-satisfacao` → pesquisa-satisfacao.fly.dev
2. `sistema-chamados` → sistema-chamados-granmarquise.fly.dev
3. `diretorio-ramais` → diretorio-ramais-granmarquise.fly.dev

### Rotas (42 no total)

**Auth**
- `POST /api/login` → JWT `{ id, email, tipo, site_roles }`
- `GET /api/me`
- `POST /api/sso` — SSO satélite: verifica JWT, retorna `{ email, tipo, site_roles }`; caller usa `Bearer SSO_SECRET`

**Sistemas**
- `GET /api/sistemas`, `POST`, `PUT /:id`, `DELETE /:id`
- `GET /api/sistemas/:id/status` — ping HTTP

**Usuários**
- `GET /api/usuarios`, `POST`, `PUT /:id`, `DELETE /:id`
- `PUT /api/me/senha`

**Permissões por site** (linhas 867-920)
- `GET /api/site-permissions/:site`
- `POST /api/site-permissions/:site`
- `DELETE /api/site-permissions/:site/:userId`
- `PUT /api/site-permissions/:site/:userId`

**Audit**
- `GET /api/audit-log` (admin) — `?filterDate=&filterTipo=`

**SSE**
- `GET /api/events?token=JWT` — token via query param (EventSource não suporta headers)

**Proxy**
- `/api/proxy/pesquisa/*` → pesquisa-satisfacao.fly.dev (Bearer SSO_SECRET)
- `/api/proxy/chamados/*` → sistema-chamados-granmarquise.fly.dev

---

## HubMarquise.jsx (3528 linhas)

### Temas (HUB_THEMES)
```javascript
dark:  { noite: '#202C28', champanhe: '#9C5843', dourado: '#996442' }
light: { noite: '#ECE4D2' }
```

### NEXT_ALLOWED_ORIGINS
```javascript
['sistema-chamados-granmarquise.fly.dev',
 'diretorio-ramais-granmarquise.fly.dev',
 'pesquisa-satisfacao.fly.dev']
```

### sessionStorage keys
| Chave | Uso |
|---|---|
| `hub_show_admin` | toggle painel admin |
| `hub_admin_aba` | aba ativa no painel admin |
| `hub_contas_subaba` | sub-aba de contas |
| `hub_contas_status` | filtro de status |
| `hub_boot_seen` | flag: animação de boot já exibida |
| `hub_scroll` | posição de scroll salva |

### localStorage keys
| Chave | Uso |
|---|---|
| `hub_sso_token` | JWT emitido pelo Hub |
| `hub_tipo` | tipo do usuário (`admin` / `usuario`) |
| `hub_sistemas` | lista de sistemas em cache |
| `gm-theme` | tema selecionado (noite/champanhe/dourado) |

### Componentes (24)
| Componente | Detalhe |
|---|---|
| `HubBoot` | 40 linhas SVG radiais, duração 2.9s |
| `HubDecoration` | Parallax: `translateY(${window.scrollY * 0.06}px)` |
| `HubLogin` | POST /api/login |
| `HubNav` | Navegação + SSE status indicator |
| `HubSistemas` | Grid de cards com ping de status |
| `HubAdmin` | Painel admin com abas; `isMobile < 768` + `isPhone < 480` |
| `UsuariosPanel` | CRUD usuários |
| `SistemasPanel` | CRUD sistemas |
| `PermissoesPanel` | Editor de permissões por site |
| `HistoricoPanel` | Audit log; `_NOMES_ACAO_INVALIDOS` Set filtra target_nome corrompido |
| `ContasPanel` | Gestão de contas; `buscaFiltrada` para contadores corretos; `isPhone < 480` |
| `LiberacaoPanel` | Liberar acesso; autocomplete email com navegação teclado (`sugHighlight`) |
| `LinkEditModal` | Modal sticky: header+tabs com `flexShrink:0` + `background` + `overflow:hidden` |
| `SitePermissionsModal` | Modal de papéis por site |
| `PerfilModal` | Troca de senha própria |
| `NotificacaoToast` | Toast de notificações SSE |
| `ThemeSelector` | Seletor de tema com preview |
| `StatusBadge` | Badge online/offline |
| `AuditBadge` | Contagem de ações |
| `SearchBar` | Busca sistemas/usuários |
| `PaginacaoBar` | Paginação |
| `ConfirmModal` | Modal genérico de confirmação |
| `LoadingSpinner` | Spinner |
| `ErrorBanner` | Banner de erro global |
| `HubFooter` | Rodapé com versão |
| `EasterEgg` | Sequência `keydown` "GM" → `seqRef.current.slice(-2) === 'GM'` → toggle |

### SSE (linha 3447)
```javascript
new EventSource('/api/events?token=' + localStorage.getItem('hub_sso_token'))
```

### fetch() calls (18)
POST /api/login, GET /api/me, CRUD sistemas (5), CRUD usuários (4), PUT /api/me/senha, CRUD site-permissions (4), GET /api/audit-log, POST /api/sso (S2S)

---

## src/ Módulos

### permissions.js
```javascript
diffPermissoes(antes, depois, _userId)
// fail-closed: null/undefined → []
// retorna { adicionados, removidos }
```

### site-permissions.js
```javascript
PAPEIS_VALIDOS = new Set(['admin','usuario','master','spa','satisfacao'])
MIGRATION_SEED  // 10 entradas: email + site + papel
_norm(email)    // email.trim().toLowerCase()
```

### migrations.js
```javascript
SISTEMA_SLUG_RENAMES = { 'spa': 'pesquisa-satisfacao' }
// Idempotente, roda no startup via runMigrations()
```

### audit-filtros.js
```javascript
aplicarFiltros(log, { filterDate, filterTipo })
// → { logPorData, filtrado, contagemPorTipo, totalGeral, totalSemFiltro }
```

---

## Testes

5 arquivos, 38 test cases, runner `node:test`:
- `permissions.test.js` — diffPermissoes, edge cases null/undefined
- `site-permissions.test.js` — PAPEIS_VALIDOS, _norm, MIGRATION_SEED
- `migrations.test.js` — SISTEMA_SLUG_RENAMES, idempotência
- `audit-filtros.test.js` — aplicarFiltros, filtros combinados
- `server.test.js` — rotas HTTP (integração leve)

```
npm test   →   node --test tests/*.test.js
```

---

## Infra

### package.json
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "jsonwebtoken": "^9.0.0",
    "dotenv": "^16.0.0"
  },
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/*.test.js"
  }
}
```

### Dockerfile
- Base: `node:20-alpine`
- `npm ci --production`
- Porta 3000; `CMD: node server.js`

### fly.toml
- App: `hub-granmarquise` | Região: GRU
- `min_machines_running=0` (auto-stop)
- Volume: `hub_data` → `/app/data`
- RAM: 256MB

---

## Fluxo SSO

```
1. Usuário autentica → Hub emite JWT (SSO_SECRET)
   payload: { id, email, tipo, site_roles: { 'pesquisa-satisfacao': 'admin', ... } }

2. Usuário navega para satélite
   → POST hub-granmarquise.fly.dev/api/sso
   → Header: Authorization: Bearer SSO_SECRET
   → Body: { token: JWT_DO_HUB }

3. Hub verifica JWT → retorna { email, tipo, site_roles }
4. Satélite mapeia site_roles[slug] → papel local
```

---

## Lacunas de Segurança

| Problema | Detalhe |
|---|---|
| Sem rate limiting | Nenhuma rota protegida |
| Sem CORS | cors() não instalado |
| Sem helmet | Sem cabeçalhos HTTP de segurança |
| JWT em query param SSE | Visível em logs e URL history |
| SSO_SECRET dual-use | Mesmo secret para assinar tokens e verificar S2S |
| Sem validação de input | Campos sem sanitização no servidor |
| Sem React ErrorBoundary | Apenas window.onerror no index.html |

---

## Ecossistema

| Sistema | URL | Integração |
|---|---|---|
| Hub | hub-granmarquise.fly.dev | origin |
| PesquisaSPA | pesquisa-satisfacao.fly.dev | SSO + proxy |
| GestaoQualidade | gestao-qualidade-granmarquise.fly.dev | proxy via Pesquisa |
| SistemaChamados | sistema-chamados-granmarquise.fly.dev | SSO + proxy |
| DiretorioRamais | diretorio-ramais-granmarquise.fly.dev | SSO |
