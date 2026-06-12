'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrarSitePermissoes, MIGRATION_SEED,
  listarPapeis, sitesOndeEhAdmin, sitesUsuario,
  setPapel, removerPapel, listarTodos, _norm,
} = require('../src/site-permissions');

test('migracao popula 10 registros do seed em dataset vazio', () => {
  const d = {};
  migrarSitePermissoes(d);
  assert.equal(d.site_permissions.length, MIGRATION_SEED.length);
  assert.equal(d._site_permissions_seeded, true);
});

test('migracao e idempotente (rodar 2x = mesma quantidade)', () => {
  const d = {};
  migrarSitePermissoes(d);
  const n1 = d.site_permissions.length;
  migrarSitePermissoes(d);
  assert.equal(d.site_permissions.length, n1);
});

test('migracao NAO sobrescreve registro que ja existe', () => {
  const d = {
    site_permissions: [
      { email: 'richard@granmarquise.com.br', sistema_id: 'ramais', papel: 'usuario' },
    ],
  };
  migrarSitePermissoes(d);
  const r = d.site_permissions.find(x => x.email === 'richard@granmarquise.com.br' && x.sistema_id === 'ramais');
  // Permanece como 'usuario' (decisao do usuario), nao volta para 'admin' do seed.
  assert.equal(r.papel, 'usuario');
});

test('sitesOndeEhAdmin: case-insensitive + trim', () => {
  const d = {};
  migrarSitePermissoes(d);
  const sites1 = sitesOndeEhAdmin(d, 'RICHARD@GRANMARQUISE.COM.BR');
  const sites2 = sitesOndeEhAdmin(d, '   richard@granmarquise.com.br   ');
  assert.deepEqual(sites1.sort(), sites2.sort());
  assert.ok(sites1.includes('ramais'));
  assert.ok(sites1.includes('pesquisa-satisfacao'));
});

test('sitesOndeEhAdmin: usuario sem registro retorna []', () => {
  const d = {};
  migrarSitePermissoes(d);
  assert.deepEqual(sitesOndeEhAdmin(d, 'fulano@granmarquise.com.br'), []);
});

test('setPapel cria registro novo', () => {
  const d = { site_permissions: [] };
  const r = setPapel(d, 'novo@granmarquise.com.br', 'chamados', 'admin');
  assert.equal(r.ok, true);
  assert.equal(r.mudou, true);
  assert.equal(d.site_permissions.length, 1);
  assert.equal(d.site_permissions[0].email, 'novo@granmarquise.com.br');
});

test('setPapel troca papel existente e retorna anterior', () => {
  const d = { site_permissions: [{ email: 'a@x.com', sistema_id: 'ramais', papel: 'usuario' }] };
  const r = setPapel(d, 'A@X.COM', 'ramais', 'admin');
  assert.equal(r.mudou, true);
  assert.equal(r.anterior, 'usuario');
  assert.equal(d.site_permissions[0].papel, 'admin');
});

test('setPapel com mesmo papel nao muda nada (idempotente)', () => {
  const d = { site_permissions: [{ email: 'a@x.com', sistema_id: 'ramais', papel: 'admin' }] };
  const r = setPapel(d, 'a@x.com', 'ramais', 'admin');
  assert.equal(r.mudou, false);
});

test('setPapel rejeita papel invalido', () => {
  const d = { site_permissions: [] };
  const r = setPapel(d, 'a@x.com', 'ramais', 'master');
  assert.equal(r.ok, false);
});

test('removerPapel apaga apenas o sistema especifico', () => {
  const d = {
    site_permissions: [
      { email: 'a@x.com', sistema_id: 'ramais', papel: 'admin' },
      { email: 'a@x.com', sistema_id: 'pesquisa-satisfacao', papel: 'admin' },
    ],
  };
  removerPapel(d, 'a@x.com', 'ramais');
  assert.equal(d.site_permissions.length, 1);
  assert.equal(d.site_permissions[0].sistema_id, 'pesquisa-satisfacao');
});

test('_norm: lowercase + trim', () => {
  assert.equal(_norm('  Fulano@X.com  '), 'fulano@x.com');
  assert.equal(_norm(null), '');
  assert.equal(_norm(undefined), '');
});
