'use strict';

// Cobre o diff de permissoes do PUT /api/admin/permissions.
// Tambem inclui um teste de REGRESSAO do bug em que appendAudit interno
// (que faz readData+writeData) era sobrescrito pelo writeData final do
// handler — o teste simula essa interacao e exige que os audits persistam.

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffPermissoes } = require('../src/permissions');

test('libera 1 sistema: liberados=[novo], bloqueados=[]', () => {
  const r = diffPermissoes(['chamados'], ['chamados', 'ramais'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.liberados, ['ramais']);
  assert.deepEqual(r.bloqueados, []);
});

test('bloqueia 1 sistema: liberados=[], bloqueados=[removido]', () => {
  const r = diffPermissoes(['chamados', 'ramais'], ['chamados'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.liberados, []);
  assert.deepEqual(r.bloqueados, ['ramais']);
});

test('antes=undefined (sem snapshot): bloqueia tudo que faltar do default', () => {
  const r = diffPermissoes(undefined, ['chamados'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.liberados, []);
  assert.deepEqual(r.bloqueados.sort(), ['pesquisa-satisfacao', 'ramais']);
});

test('antes=null: trata igual a undefined (sem snapshot)', () => {
  const r = diffPermissoes(null, ['chamados', 'ramais'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.bloqueados, ['pesquisa-satisfacao']);
});

test('antes vazio []: tudo de depois e novo', () => {
  const r = diffPermissoes([], ['chamados', 'ramais'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.liberados.sort(), ['chamados', 'ramais']);
  assert.deepEqual(r.bloqueados, []);
});

test('mesmo conjunto: nada muda', () => {
  const r = diffPermissoes(['chamados', 'ramais'], ['ramais', 'chamados'], ['chamados', 'ramais', 'pesquisa-satisfacao']);
  assert.deepEqual(r.liberados, []);
  assert.deepEqual(r.bloqueados, []);
});

// REGRESSAO: o bug em que o handler chamava writeData(data) DEPOIS dos
// appendAudit. Como appendAudit ler+escreve o JSON, ele gravava o evento
// no disco, mas o writeData posterior do handler (com a versao em memoria
// que NAO tinha os eventos) SOBRESCREVIA o disco — apagando os audits.
// Simulamos o fluxo correto: aplicar mudanca + writeData ANTES dos audits.
test('REGRESSAO: audits sobrevivem quando handler aplica mudanca antes do appendAudit', () => {
  // "Disco": objeto unico mutavel.
  const disco = { permissions: { 'a@x.com': ['chamados'] }, audit_log: [] };
  const readData = () => JSON.parse(JSON.stringify(disco)); // deep copy
  const writeData = (d) => { disco.permissions = d.permissions; disco.audit_log = d.audit_log; };
  const appendAudit = (entry) => {
    const d = readData();
    if (!Array.isArray(d.audit_log)) d.audit_log = [];
    d.audit_log.push({ id: 'x', at: '2026-06-12', ...entry });
    writeData(d);
  };

  // Simula o handler PUT /api/admin/permissions (versao CORRIGIDA):
  const email = 'a@x.com';
  const novos = ['chamados', 'ramais'];
  const data = readData();
  const { liberados, bloqueados } = diffPermissoes(data.permissions[email], novos, ['chamados', 'ramais', 'pesquisa-satisfacao']);

  // ORDEM CORRETA: grava permissoes primeiro.
  data.permissions[email] = novos;
  writeData(data);

  // Agora gera os audits.
  for (const sid of liberados) appendAudit({ action: 'liberar_link', target_nome: 'a@x.com', campos: { email, link: sid } });
  for (const sid of bloqueados) appendAudit({ action: 'bloquear_link', target_nome: 'a@x.com', campos: { email, link: sid } });

  // Assert: tanto a permissao quanto os audits sobreviveram no "disco".
  assert.deepEqual(disco.permissions[email], ['chamados', 'ramais']);
  assert.equal(disco.audit_log.length, 1);
  assert.equal(disco.audit_log[0].action, 'liberar_link');
  assert.equal(disco.audit_log[0].campos.link, 'ramais');
});

test('REGRESSAO inversa: ordem ERRADA (writeData depois de appendAudit) apaga audits', () => {
  // Mesmo setup, mas simula o bug original — confirma que a ORDEM importa.
  const disco = { permissions: { 'a@x.com': ['chamados'] }, audit_log: [] };
  const readData = () => JSON.parse(JSON.stringify(disco));
  const writeData = (d) => { disco.permissions = d.permissions; disco.audit_log = d.audit_log; };
  const appendAudit = (entry) => {
    const d = readData();
    if (!Array.isArray(d.audit_log)) d.audit_log = [];
    d.audit_log.push({ id: 'x', at: '2026-06-12', ...entry });
    writeData(d);
  };
  const email = 'a@x.com';
  const novos = ['chamados', 'ramais'];
  const data = readData();
  const { liberados } = diffPermissoes(data.permissions[email], novos, ['chamados', 'ramais', 'pesquisa-satisfacao']);
  // ORDEM ERRADA: gera audit primeiro, depois writeData.
  for (const sid of liberados) appendAudit({ action: 'liberar_link', campos: { email, link: sid } });
  data.permissions[email] = novos;
  writeData(data);
  // Bug confirmado: o writeData final sobrescreveu o disco, apagando o audit.
  assert.equal(disco.audit_log.length, 0, 'ordem errada apaga audits — por isso o handler foi reordenado');
});
