'use strict';

// Testes da migracao de slugs do hub_data.json (src/migrations.js).
// Cobre:
// - Renomeacao em data.sistemas
// - Renomeacao em data.permissions[email][]
// - Renomeacao em data.audit_log[target_tipo='link'].target_id
// - Idempotencia (rodar 2x nao corrompe)
// - Dados ja migrados nao sao alterados
//
// Roda com: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrarSlugs } = require('../src/migrations');

test('migra slug em data.sistemas', () => {
  const data = {
    sistemas: [
      { id: 'chamados', nome: 'Chamados TI' },
      { id: 'spa', nome: 'Pesquisa de Satisfação' },
    ],
  };
  migrarSlugs(data);
  assert.equal(data.sistemas[1].id, 'pesquisa-satisfacao');
  assert.equal(data.sistemas[0].id, 'chamados'); // intocado
});

test('migra slug em data.permissions', () => {
  const data = {
    permissions: {
      'a@ex.com': ['chamados', 'spa', 'ramais'],
      'b@ex.com': ['spa'],
    },
  };
  migrarSlugs(data);
  assert.deepEqual(data.permissions['a@ex.com'], ['chamados', 'pesquisa-satisfacao', 'ramais']);
  assert.deepEqual(data.permissions['b@ex.com'], ['pesquisa-satisfacao']);
});

test('migra target_id em data.audit_log apenas para target_tipo=link', () => {
  const data = {
    audit_log: [
      { target_tipo: 'link',     target_id: 'spa',  target_nome: 'Pesquisa de Satisfação' },
      { target_tipo: 'permissao', target_id: 'spa',  target_nome: 'qualquer' }, // NAO deve mudar
      { target_tipo: 'link',     target_id: 'chamados' },
    ],
  };
  migrarSlugs(data);
  assert.equal(data.audit_log[0].target_id, 'pesquisa-satisfacao');
  assert.equal(data.audit_log[1].target_id, 'spa', 'target_id em permissao nao deve ser migrado');
  assert.equal(data.audit_log[2].target_id, 'chamados');
});

test('idempotente: rodar 2x produz o mesmo resultado', () => {
  const data = {
    sistemas: [{ id: 'spa', nome: 'Pesquisa de Satisfação' }],
    permissions: { 'a@ex.com': ['spa', 'chamados'] },
    audit_log: [{ target_tipo: 'link', target_id: 'spa' }],
  };
  migrarSlugs(data);
  const snapshot = JSON.stringify(data);
  migrarSlugs(data);
  assert.equal(JSON.stringify(data), snapshot, 'segunda execucao nao deve alterar nada');
});

test('renames customizadas funcionam', () => {
  const data = { sistemas: [{ id: 'velho' }], permissions: { 'a@ex.com': ['velho'] } };
  migrarSlugs(data, { velho: 'novo' });
  assert.equal(data.sistemas[0].id, 'novo');
  assert.deepEqual(data.permissions['a@ex.com'], ['novo']);
});

test('dados sem campos esperados nao quebra', () => {
  migrarSlugs({});
  migrarSlugs({ sistemas: null });
  migrarSlugs({ permissions: null });
  migrarSlugs({ audit_log: null });
  migrarSlugs(null);
  migrarSlugs(undefined);
  // Sucesso = sem throw.
  assert.ok(true);
});
