'use strict';

// Migrations idempotentes do hub_data.json. Aplicadas em readData() e
// gravadas na proxima escrita. Cada migration deve poder rodar varias
// vezes sem efeito colateral (idempotente).

// Renomeacoes de slug de sistema. Antigo -> novo.
// O slug e usado como id em data.sistemas, em data.permissions[email][]
// e em data.audit_log[target_tipo='link'].target_id.
const SISTEMA_SLUG_RENAMES = {
  // 'spa' -> 'pesquisa-satisfacao' (slug refletindo o nome do sistema).
  spa: 'pesquisa-satisfacao',
};

function migrarSlugs(data, renames = SISTEMA_SLUG_RENAMES) {
  if (!data || typeof data !== 'object') return data;
  if (!renames || Object.keys(renames).length === 0) return data;

  if (Array.isArray(data.sistemas)) {
    for (const s of data.sistemas) {
      if (s && renames[s.id]) s.id = renames[s.id];
    }
  }
  if (data.permissions && typeof data.permissions === 'object') {
    for (const email of Object.keys(data.permissions)) {
      const arr = data.permissions[email];
      if (Array.isArray(arr)) data.permissions[email] = arr.map(id => renames[id] || id);
    }
  }
  if (Array.isArray(data.audit_log)) {
    for (const e of data.audit_log) {
      if (e && e.target_tipo === 'link' && renames[e.target_id]) e.target_id = renames[e.target_id];
    }
  }
  return data;
}

// Sistemas internos do hotel que expoem GET /sso?sso_token=<jwt>. So para eles
// o Hub pode trocar a URL do card por <origem>/sso?... — em qualquer outro
// destino isso da erro (a rota nao existe) e vazaria o JWT do Hub.
// Casamos por id E por origem: o id protege contra troca de dominio via
// URL_OVERRIDES; a origem cobre cards duplicados apontando para o mesmo sistema.
const SSO_SISTEMA_IDS = ['chamados', 'ramais', 'pesquisa-satisfacao', 'gestao-de-qualidade'];
const SSO_ORIGINS = [
  'https://sistema-chamados-granmarquise.fly.dev',
  'https://diretorio-ramais-granmarquise.fly.dev',
  'https://pesquisa-satisfacao.fly.dev',
  'https://gestao-qualidade-granmarquise.fly.dev',
];

function _origem(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function ssoPadrao(sistema) {
  if (!sistema) return false;
  if (SSO_SISTEMA_IDS.includes(sistema.id)) return true;
  return SSO_ORIGINS.includes(_origem(sistema.url));
}

// Carimba `sso` nos cards que ainda nao tem o campo. Sem isso, o `antes` do PUT
// fica sem a chave e o diff de auditoria acusa uma mudanca que o admin nao fez
// (o que tambem quebrava a derivacao ativar/inativar, que exige diff de 1 campo).
// Nao toca em quem ja tem o campo — decisao explicita do admin sempre vence.
function migrarSsoSistemas(data) {
  if (!data || !Array.isArray(data.sistemas)) return data;
  for (const s of data.sistemas) {
    if (s && s.sso === undefined) s.sso = ssoPadrao(s);
  }
  return data;
}

module.exports = { migrarSlugs, SISTEMA_SLUG_RENAMES, migrarSsoSistemas, ssoPadrao, SSO_SISTEMA_IDS, SSO_ORIGINS };
