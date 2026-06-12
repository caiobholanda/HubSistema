'use strict';

// Logica pura do diff de permissoes do PUT /api/admin/permissions.
// Extraida para teste — qualquer divergencia entre este modulo e o handler
// em server.js e bug.

// Quando um usuario nao tem entrada em data.permissions[email]:
// - antes === undefined OR null → significa "sem snapshot", e por convencao
//   o sistema considera que ele TINHA acesso a todos os sistemas atuais.
// Quando ele passa a ter uma lista explicita em `depois`, comparamos com
// essa convencao para gerar liberados/bloqueados.
function diffPermissoes(antes, depois, sistemasAtuaisIds) {
  const tinhaAntes = (antes === undefined || antes === null) ? sistemasAtuaisIds : antes;
  const setAntes = new Set(tinhaAntes);
  const setDepois = new Set(depois);
  const liberados = [...setDepois].filter(x => !setAntes.has(x));
  const bloqueados = [...setAntes].filter(x => !setDepois.has(x));
  return { liberados, bloqueados };
}

module.exports = { diffPermissoes };
