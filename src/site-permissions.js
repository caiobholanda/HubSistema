'use strict';

// Modulo de permissoes por site/sistema do Hub.
// data.site_permissions = [{ email, sistema_id, papel: 'admin'|'usuario' }]
//
// Convencoes:
// - email sempre lowercase + trim. Helpers internos normalizam.
// - sistema_id = slug do sistema (chamados, ramais, pesquisa-satisfacao).
// - papel = 'admin' OU 'usuario'. Ausencia de registro = sem permissao
//   especial (usuario comum no Hub continua acessando se tiver permissao
//   normal em data.permissions).
//
// Migracao one-shot espelha as 3 allowlists hardcoded de ramais e pesquisa
// que existiam ate este commit (Fase 1 do refactor de gerenciamento manual).

const MIGRATION_SEED = [
  // Ramais — espelho exato de DiretorioRamais/server.js ADMIN_EMAILS.
  { email: 'christian.bernard@granmarquise.com.br', sistema_id: 'ramais', papel: 'admin' },
  { email: 'ana.louise@granmarquise.com.br',        sistema_id: 'ramais', papel: 'admin' },
  { email: 'kamilly.sousa@granmarquise.com.br',     sistema_id: 'ramais', papel: 'admin' },
  { email: 'francisco.rodrigues@granmarquise.com.br', sistema_id: 'ramais', papel: 'admin' },
  { email: 'richard@granmarquise.com.br',           sistema_id: 'ramais', papel: 'admin' },
  { email: 'suporte.ti@granmarquise.com.br',        sistema_id: 'ramais', papel: 'admin' },
  { email: 'estagio.ti@granmarquise.com.br',        sistema_id: 'ramais', papel: 'admin' },
  // Pesquisa-Satisfacao — espelho de SPA_ADMIN_EMAILS.
  // Os mesmos 3 emails ja constavam em HUB_SYSTEMS.adminEmails (HubMarquise.jsx).
  { email: 'richard@granmarquise.com.br',     sistema_id: 'pesquisa-satisfacao', papel: 'admin' },
  { email: 'suporte.ti@granmarquise.com.br',  sistema_id: 'pesquisa-satisfacao', papel: 'admin' },
  { email: 'estagio.ti@granmarquise.com.br',  sistema_id: 'pesquisa-satisfacao', papel: 'admin' },
];

function _norm(email) { return String(email || '').trim().toLowerCase(); }

// Aplica a migracao uma unica vez por dataset. Idempotente: se ja foi
// aplicada (data._site_permissions_seeded), nao mexe. Tambem nao
// sobrescreve registros que o usuario tenha adicionado/removido depois.
function migrarSitePermissoes(data) {
  if (!data || typeof data !== 'object') return data;
  if (data._site_permissions_seeded) return data;
  if (!Array.isArray(data.site_permissions)) data.site_permissions = [];
  for (const entry of MIGRATION_SEED) {
    const e = _norm(entry.email);
    const s = entry.sistema_id;
    const p = entry.papel;
    const ja = data.site_permissions.some(r => _norm(r.email) === e && r.sistema_id === s);
    if (!ja) data.site_permissions.push({ email: e, sistema_id: s, papel: p });
  }
  data._site_permissions_seeded = true;
  return data;
}

// Lista os papeis registrados para um email (case-insensitive).
function listarPapeis(data, email) {
  const e = _norm(email);
  if (!e || !Array.isArray(data.site_permissions)) return [];
  return data.site_permissions.filter(r => _norm(r.email) === e);
}

// Sistemas onde este email tem papel "admin-like" (qualquer um exceto 'usuario').
// Inclui 'admin', 'master', 'spa', 'satisfacao' — todos dao cookie de admin
// no destino, embora o destino possa aplicar permissoes mais granulares
// via site_roles do JWT.
function sitesOndeEhAdmin(data, email) {
  return listarPapeis(data, email).filter(r => r.papel !== 'usuario').map(r => r.sistema_id);
}
// Retorna um mapa { sistema_id: papel } com o papel especifico em cada site.
// Usado para enriquecer o JWT (site_roles) para que sistemas como
// pesquisa-satisfacao possam diferenciar master / admin / spa / satisfacao.
function rolesDoEmail(data, email) {
  const out = {};
  for (const r of listarPapeis(data, email)) {
    out[r.sistema_id] = r.papel;
  }
  return out;
}

// Sistemas onde este email tem papel 'usuario' (acesso comum explicito).
function sitesUsuario(data, email) {
  return listarPapeis(data, email).filter(r => r.papel === 'usuario').map(r => r.sistema_id);
}

// CRUD basico. Sempre normaliza email. Retorna boolean indicando se mudou.
// Papeis aceitos:
// - 'admin'      → cookie de admin no destino (default para qualquer site)
// - 'usuario'    → acesso comum explicito
// - 'master'     → so para pesquisa-satisfacao: pode tudo
// - 'spa'        → so para pesquisa-satisfacao: ve area do Spa
// - 'satisfacao' → so para pesquisa-satisfacao: ve relatorios/historico
// Migration v2: recepcionistas com acesso spa
const MIGRATION_SEED_V2 = [
  { email: 'georgia.gomes@granmarquise.com.br', sistema_id: 'pesquisa-satisfacao', papel: 'spa' },
  { email: 'julia.santos@granmarquise.com.br',  sistema_id: 'pesquisa-satisfacao', papel: 'spa' },
];

function migrarSitePermissoesV2(data) {
  if (!data || typeof data !== 'object') return data;
  if (data._site_permissions_v2_seeded) return data;
  if (!Array.isArray(data.site_permissions)) data.site_permissions = [];
  for (const entry of MIGRATION_SEED_V2) {
    const e = _norm(entry.email);
    const s = entry.sistema_id;
    const p = entry.papel;
    const ja = data.site_permissions.some(r => _norm(r.email) === e && r.sistema_id === s);
    if (!ja) data.site_permissions.push({ email: e, sistema_id: s, papel: p });
  }
  data._site_permissions_v2_seeded = true;
  return data;
}

const PAPEIS_VALIDOS = new Set(['admin', 'usuario', 'master', 'spa', 'satisfacao', 'massoterapeuta']);
function setPapel(data, email, sistema_id, papel) {
  if (!PAPEIS_VALIDOS.has(papel)) return { ok: false, erro: 'papel invalido' };
  if (!email || !sistema_id) return { ok: false, erro: 'email e sistema_id obrigatorios' };
  const e = _norm(email);
  if (!Array.isArray(data.site_permissions)) data.site_permissions = [];
  const existente = data.site_permissions.find(r => _norm(r.email) === e && r.sistema_id === sistema_id);
  if (existente) {
    if (existente.papel === papel) return { ok: true, mudou: false };
    const anterior = existente.papel;
    existente.papel = papel;
    existente.email = e;
    return { ok: true, mudou: true, anterior };
  }
  data.site_permissions.push({ email: e, sistema_id, papel });
  return { ok: true, mudou: true, anterior: null };
}

function removerPapel(data, email, sistema_id) {
  const e = _norm(email);
  if (!Array.isArray(data.site_permissions)) return { ok: true, mudou: false };
  const before = data.site_permissions.length;
  data.site_permissions = data.site_permissions.filter(r => !(_norm(r.email) === e && r.sistema_id === sistema_id));
  return { ok: true, mudou: data.site_permissions.length !== before };
}

// Lista todas as permissoes (para painel admin).
function listarTodos(data) {
  return Array.isArray(data.site_permissions) ? data.site_permissions.slice() : [];
}

// Migration v3: copia data.permissions (fonte antiga, lida por getUserSistemas)
// para site_permissions (fonte nova, gravada por LiberacaoPanel), usando
// papel:'usuario'. Nao sobrescreve entradas ja existentes (preserva admin/spa/etc).
// Unifica a fonte de verdade sem perder liberacoes existentes.
function migrarPermissionsV3(data) {
  if (!data || typeof data !== 'object') return data;
  if (data._permissions_migrated_v3) return data;
  if (!Array.isArray(data.site_permissions)) data.site_permissions = [];
  const perms = data.permissions;
  if (perms && typeof perms === 'object') {
    for (const email of Object.keys(perms)) {
      const e = _norm(email);
      if (!e) continue;
      const sistemas = perms[email];
      if (!Array.isArray(sistemas)) continue;
      for (const sid of sistemas) {
        const ja = data.site_permissions.some(r => _norm(r.email) === e && r.sistema_id === sid);
        if (!ja) data.site_permissions.push({ email: e, sistema_id: sid, papel: 'usuario' });
      }
    }
  }
  data._permissions_migrated_v3 = true;
  return data;
}

// Migration v4: massoterapeutas do Gran Spa com papel 'massoterapeuta'
const MIGRATION_SEED_V4 = [
  { email: 'antonia.sousa@granmarquise.com.br',    sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
  { email: 'germana.silva@granmarquise.com.br',    sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
  { email: 'isadora.menezes@granmarquise.com.br',  sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
  { email: 'karoline.freitas@granmarquise.com.br', sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
  { email: 'mayara.dias@granmarquise.com.br',      sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
  { email: 'valderlania.bezerra@granmarquise.com.br', sistema_id: 'pesquisa-satisfacao', papel: 'massoterapeuta' },
];

function migrarSitePermissoesV4(data) {
  if (!data || typeof data !== 'object') return data;
  if (data._site_permissions_v4_seeded) return data;
  if (!Array.isArray(data.site_permissions)) data.site_permissions = [];
  for (const entry of MIGRATION_SEED_V4) {
    const e = _norm(entry.email);
    const s = entry.sistema_id;
    const p = entry.papel;
    const existente = data.site_permissions.find(r => _norm(r.email) === e && r.sistema_id === s);
    if (existente) {
      existente.papel = p;
    } else {
      data.site_permissions.push({ email: e, sistema_id: s, papel: p });
    }
  }
  data._site_permissions_v4_seeded = true;
  return data;
}

module.exports = {
  MIGRATION_SEED,
  MIGRATION_SEED_V2,
  MIGRATION_SEED_V4,
  PAPEIS_VALIDOS,
  migrarSitePermissoes,
  migrarSitePermissoesV2,
  migrarPermissionsV3,
  migrarSitePermissoesV4,
  listarPapeis,
  sitesOndeEhAdmin,
  sitesUsuario,
  rolesDoEmail,
  setPapel,
  removerPapel,
  listarTodos,
  _norm,
};
