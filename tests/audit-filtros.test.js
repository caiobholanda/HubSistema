'use strict';

// Cobre a regra: badges das abas (Admins, Usuarios, Setores, Links, Permissoes)
// respeitam o filtro de data — bug confirmado em HistoricoPanel quando
// contagemPorTipo usava (log || []) em vez do log filtrado por data.

const test = require('node:test');
const assert = require('node:assert/strict');
const { aplicarFiltros, tipoLogico } = require('../src/audit-filtros');

function ev(at, target_tipo, target_id = 'x', action = 'editar') {
  return { at, target_tipo, target_id, target_nome: 'X', action, campos: {} };
}

const LOG = [
  ev('2026-06-12T10:00:00Z', 'admin'),
  ev('2026-06-12T11:00:00Z', 'admin'),
  ev('2026-06-12T12:00:00Z', 'link'),
  ev('2026-06-11T10:00:00Z', 'link'),
  ev('2026-06-11T11:00:00Z', 'usuario'),
  ev('2026-06-10T10:00:00Z', 'setor'),
];

test('sem filtros: contagem reflete o total', () => {
  const { contagemPorTipo, totalGeral } = aplicarFiltros(LOG);
  assert.equal(totalGeral, 6);
  assert.deepEqual(contagemPorTipo, { admin: 2, link: 2, usuario: 1, setor: 1 });
});

test('filtro de data limita contadores das abas (BUG do prompt)', () => {
  const { contagemPorTipo, totalGeral, filtrado } = aplicarFiltros(LOG, { filterDate: '2026-06-12' });
  assert.equal(totalGeral, 3);
  // Contagens DEVEM refletir apenas o dia filtrado: 2 admins + 1 link, 0 usuario/setor.
  assert.deepEqual(contagemPorTipo, { admin: 2, link: 1 });
  assert.equal(filtrado.length, 3);
});

test('filtro de data + filtro de tipo: lista respeita ambos, contagens so a data', () => {
  const { filtrado, contagemPorTipo } = aplicarFiltros(LOG, { filterDate: '2026-06-12', filterTipo: 'link' });
  assert.equal(filtrado.length, 1);
  assert.equal(filtrado[0].target_tipo, 'link');
  // Os badges ainda devem mostrar quantos por tipo HA no dia (independente do tipo selecionado).
  assert.deepEqual(contagemPorTipo, { admin: 2, link: 1 });
});

test('filtro de data sem registros: contagens zeradas, lista vazia', () => {
  const { filtrado, contagemPorTipo, totalGeral } = aplicarFiltros(LOG, { filterDate: '2026-01-01' });
  assert.equal(totalGeral, 0);
  assert.deepEqual(contagemPorTipo, {});
  assert.equal(filtrado.length, 0);
});

test('liberar_link/bloquear_link/resetar_permissoes contam como tipo logico LINK', () => {
  assert.equal(tipoLogico(ev('2026-06-12', 'permissao', 'x', 'liberar_link')), 'link');
  assert.equal(tipoLogico(ev('2026-06-12', 'permissao', 'x', 'bloquear_link')), 'link');
  assert.equal(tipoLogico(ev('2026-06-12', 'permissao', 'x', 'resetar_permissoes')), 'link');
  // Outros target_tipo='permissao' (hipoteticos) continuam como permissao
  assert.equal(tipoLogico(ev('2026-06-12', 'permissao', 'x', 'qualquer_outra')), 'permissao');
});

test('aba Links agrega eventos sobre links + permissoes de link', () => {
  const LOG2 = [
    ev('2026-06-12T10:00:00Z', 'link',      'chamados', 'editar'),
    ev('2026-06-12T11:00:00Z', 'permissao', 'x',        'liberar_link'),
    ev('2026-06-12T12:00:00Z', 'permissao', 'x',        'bloquear_link'),
    ev('2026-06-12T13:00:00Z', 'permissao', 'x',        'resetar_permissoes'),
    ev('2026-06-12T14:00:00Z', 'admin',     'a',        'editar'),
  ];
  const r = aplicarFiltros(LOG2, { filterTipo: 'link' });
  // 1 evento de edicao de link + 3 de permissao de link = 4 no contador e na lista.
  assert.equal(r.contagemPorTipo.link, 4);
  assert.equal(r.filtrado.length, 4);
  // Nao expoe categoria 'permissao' nos contadores quando todas viraram link.
  assert.equal(r.contagemPorTipo.permissao || 0, 0);
});

test('log vazio nao quebra', () => {
  const r = aplicarFiltros([]);
  assert.equal(r.totalGeral, 0);
  assert.deepEqual(r.contagemPorTipo, {});
  assert.equal(r.filtrado.length, 0);
});
