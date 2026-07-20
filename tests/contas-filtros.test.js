'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { filtrarOrdenarContas, statusEfetivo } = require('../src/contas-filtros');

const USUARIOS = [
  { id: 1, nome: 'Ana Souza', email: 'ana@gm.br', setor: 'Recepção', cargo: 'Recepcionista', ramal: '5240', matricula: '00111', ativo: 1, hub_status: 'ativo' },
  { id: 2, nome: 'Bruno Lima', email: 'bruno@gm.br', setor: 'Spa', cargo: 'Massoterapeuta', ramal: '5250', matricula: '00222', ativo: 1, hub_status: 'bloqueado' },
  { id: 3, nome: 'Carla Dias', email: 'carla@gm.br', setor: 'Spa', cargo: 'Massoterapeuta', ramal: '5260', ativo: 1, hub_status: 'ativacao_pendente' },
  { id: 4, nome: 'Diego Reis', email: 'diego@gm.br', setor: 'Recepção', cargo: 'Concierge', ramal: '5270', ativo: 0 },
  { id: 5, nome: 'Zeca Legado', email: 'zeca@gm.br', setor: 'TI', ramal: '5299', ativo: 1 }, // sem hub_status -> ativo
];

const ADMINS = [
  { id: 1, nome_completo: 'Alice Admin', email: 'alice@gm.br', usuario: 'alice', ativo: 1, is_master: true },
  { id: 2, nome_completo: 'Beto Admin', email: 'beto@gm.br', usuario: 'beto', ativo: 0, is_master: false },
];

test('statusEfetivo: fallback para ativo/desligado sem hub_status', () => {
  assert.equal(statusEfetivo(USUARIOS[4], false), 'ativo');
  assert.equal(statusEfetivo(USUARIOS[3], false), 'desligado');
  assert.equal(statusEfetivo(USUARIOS[1], false), 'bloqueado');
  assert.equal(statusEfetivo(ADMINS[0], true), 'ativo');
  assert.equal(statusEfetivo(ADMINS[1], true), 'desligado');
});

test('busca multi-palavra e AND entre tokens', () => {
  const { resultado } = filtrarOrdenarContas(USUARIOS, { isAdmin: false, busca: 'spa massoterapeuta', status: 'todos', ordem: 'nome' });
  assert.deepEqual(resultado.map(r => r.id), [2, 3]);
});

test('busca por ramal e matricula', () => {
  assert.deepEqual(filtrarOrdenarContas(USUARIOS, { isAdmin: false, busca: '5240', status: 'todos' }).resultado.map(r => r.id), [1]);
  assert.deepEqual(filtrarOrdenarContas(USUARIOS, { isAdmin: false, busca: '00222', status: 'todos' }).resultado.map(r => r.id), [2]);
});

test('flag master (admins) e flag inativo preservadas', () => {
  const adm = filtrarOrdenarContas(ADMINS, { isAdmin: true, busca: 'master', status: 'ativos' });
  assert.deepEqual(adm.resultado.map(r => r.id), [1]);
  const ina = filtrarOrdenarContas(USUARIOS, { isAdmin: false, busca: 'inativo', status: 'todos' });
  assert.deepEqual(ina.resultado.map(r => r.id), [4]);
});

test('filtro por status individual', () => {
  const { resultado } = filtrarOrdenarContas(USUARIOS, { isAdmin: false, status: 'bloqueado' });
  assert.deepEqual(resultado.map(r => r.id), [2]);
});

test('filtro por setor e cargo combinados com status', () => {
  const r1 = filtrarOrdenarContas(USUARIOS, { isAdmin: false, setor: 'Spa', status: 'todos' });
  assert.deepEqual(r1.resultado.map(r => r.id), [2, 3]);
  const r2 = filtrarOrdenarContas(USUARIOS, { isAdmin: false, setor: 'Spa', cargo: 'Massoterapeuta', status: 'ativacao_pendente' });
  assert.deepEqual(r2.resultado.map(r => r.id), [3]);
  const r3 = filtrarOrdenarContas(USUARIOS, { isAdmin: false, setor: 'Recepção', cargo: 'Massoterapeuta', status: 'todos' });
  assert.equal(r3.resultado.length, 0);
});

test('contagem calculada apos busca+setor+cargo e ANTES do status', () => {
  const { contagem, base } = filtrarOrdenarContas(USUARIOS, { isAdmin: false, setor: 'Spa', status: 'bloqueado' });
  assert.equal(base.length, 2);
  assert.deepEqual(contagem, { bloqueado: 1, ativacao_pendente: 1 });
  // sem filtros: contagem global
  const todos = filtrarOrdenarContas(USUARIOS, { isAdmin: false, status: 'ativo' });
  assert.deepEqual(todos.contagem, { ativo: 2, bloqueado: 1, ativacao_pendente: 1, desligado: 1 });
});

test('ordenacao: nome (default), setor e status com desempate por nome', () => {
  const porNome = filtrarOrdenarContas(USUARIOS, { isAdmin: false, status: 'todos', ordem: 'nome' });
  assert.deepEqual(porNome.resultado.map(r => r.nome), ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Reis', 'Zeca Legado']);
  const porSetor = filtrarOrdenarContas(USUARIOS, { isAdmin: false, status: 'todos', ordem: 'setor' });
  assert.deepEqual(porSetor.resultado.map(r => r.id), [1, 4, 2, 3, 5]); // Recepção(Ana,Diego), Spa(Bruno,Carla), TI(Zeca)
  const porStatus = filtrarOrdenarContas(USUARIOS, { isAdmin: false, status: 'todos', ordem: 'status' });
  assert.deepEqual(porStatus.resultado.map(r => r.id), [1, 5, 3, 2, 4]); // ativo(Ana,Zeca), pendente(Carla), bloqueado(Bruno), desligado(Diego)
});

test('admins: abas ativos/inativos preservadas', () => {
  const a = filtrarOrdenarContas(ADMINS, { isAdmin: true, status: 'ativos' });
  assert.deepEqual(a.resultado.map(r => r.id), [1]);
  const i = filtrarOrdenarContas(ADMINS, { isAdmin: true, status: 'inativos' });
  assert.deepEqual(i.resultado.map(r => r.id), [2]);
});

test('lista null/vazia nao explode', () => {
  const r = filtrarOrdenarContas(null, { isAdmin: false, status: 'ativo' });
  assert.deepEqual(r.resultado, []);
  assert.deepEqual(r.contagem, {});
});
