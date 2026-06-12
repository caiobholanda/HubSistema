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

module.exports = { migrarSlugs, SISTEMA_SLUG_RENAMES };
