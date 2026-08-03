'use strict';

// Soft-delete dos tipos de ausencia: em vez de excluir (a sigla pode estar
// gravada em celulas historicas da escala do SPA), o tipo e desativado e some
// do seletor — mas continua existindo para nomear o historico.

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrarAusenciasAtivo, migrarAusenciasSpa } = require('../src/migrations');

test('migrarAusenciasAtivo carimba ativo=true so em quem nao tem o campo', () => {
  const data = { ausencias: [
    { id: '1', nome: 'Folga', sigla: 'X' },
    { id: '2', nome: 'Falta', sigla: 'F', ativo: false },
  ] };
  migrarAusenciasAtivo(data);
  assert.equal(data.ausencias[0].ativo, true);
  assert.equal(data.ausencias[1].ativo, false);
  const antes = JSON.stringify(data);
  migrarAusenciasAtivo(data);
  assert.equal(JSON.stringify(data), antes); // idempotente
});

test('migrarAusenciasSpa insere AA e corrige FE "Feriados"->"Férias"', () => {
  const data = { ausencias: [
    { id: '1', nome: 'Feriados', sigla: 'FE', ativo: true },
    { id: '2', nome: 'Folga', sigla: 'X', ativo: true },
  ] };
  migrarAusenciasSpa(data);
  const aa = data.ausencias.find(a => a.sigla === 'AA');
  assert.ok(aa, 'AA nao inserida');
  assert.equal(aa.nome, 'Abono Aniversário');
  assert.equal(aa.ativo, true);
  assert.equal(data.ausencias.find(a => a.sigla === 'FE').nome, 'Férias');
  const n = data.ausencias.length;
  migrarAusenciasSpa(data);
  assert.equal(data.ausencias.length, n); // idempotente — nao duplica AA
});

test('REGRESSAO: id da AA migrada e deterministico entre leituras', () => {
  // A migration roda em memoria a cada readData() e so persiste na proxima
  // escrita — id aleatorio fazia o PUT/desativar da AA dar 404.
  const le = () => { const d = { ausencias: [{ id: '1', nome: 'Folga', sigla: 'X', ativo: true }] }; migrarAusenciasSpa(d); return d; };
  const id1 = le().ausencias.find(a => a.sigla === 'AA').id;
  const id2 = le().ausencias.find(a => a.sigla === 'AA').id;
  assert.equal(id1, id2);
});

test('migrarAusenciasSpa respeita FE renomeado pelo admin', () => {
  const data = { ausencias: [{ id: '1', nome: 'Férias Coletivas', sigla: 'FE', ativo: true }] };
  migrarAusenciasSpa(data);
  assert.equal(data.ausencias[0].nome, 'Férias Coletivas');
});

// Espelha a regra de unicidade do PUT/POST: sigla so precisa ser unica entre
// os tipos ATIVOS (permite recriar/reativar sigla aposentada).
function siglaConflita(ausencias, siglaUp, idxProprio, ficaraAtivo) {
  if (!ficaraAtivo) return false;
  return ausencias.some((a, i) => a.sigla === siglaUp && i !== idxProprio && a.ativo !== false);
}

test('sigla de tipo desativado pode ser reutilizada; ativa nao', () => {
  const lista = [
    { sigla: 'CA', ativo: false },
    { sigla: 'AT', ativo: true },
  ];
  assert.equal(siglaConflita(lista, 'CA', -1, true), false); // recriar CA: ok
  assert.equal(siglaConflita(lista, 'AT', -1, true), true);  // duplicar AT: 409
  assert.equal(siglaConflita(lista, 'AT', -1, false), false); // criar ja inativo: ok
  assert.equal(siglaConflita(lista, 'AT', 1, true), false);  // editar o proprio AT: ok
});
