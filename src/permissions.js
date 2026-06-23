'use strict';

// Logica pura do diff de permissoes do PUT /api/admin/permissions.
// Extraida para teste — qualquer divergencia entre este modulo e o handler
// em server.js e bug.

// Sob a regra fail-closed, ausencia de entrada (undefined/null/valor nao-array)
// significa que o usuario NAO tinha acesso a nada. O `sistemasAtuaisIds` ficou
// no parametro so para nao quebrar call-sites antigos.
function diffPermissoes(antes, depois, _sistemasAtuaisIds) {
  const setAntes = new Set(Array.isArray(antes) ? antes : []);
  const setDepois = new Set(Array.isArray(depois) ? depois : []);
  const liberados = [...setDepois].filter(x => !setAntes.has(x));
  const bloqueados = [...setAntes].filter(x => !setDepois.has(x));
  return { liberados, bloqueados };
}

module.exports = { diffPermissoes };
