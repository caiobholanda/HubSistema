'use strict';

// Verifica que o audit log do PUT /api/admin/sistemas/:id grava EXATAMENTE
// um registro com slug correto e diff apenas dos campos que mudaram.
// Testa a logica diretamente sobre dados em memoria (sem HTTP) — espelha o
// handler em server.js (linhas 426-448).

const test = require('node:test');
const assert = require('node:assert/strict');

// Reproduz a logica do handler PUT /api/admin/sistemas/:id para teste.
// Mesma estrutura do server.js, sem o overhead de subir o Express.
function simularPutSistemaEditar(data, slug, body, by) {
  const sistemas = Array.isArray(data.sistemas) ? data.sistemas : [];
  const idx = sistemas.findIndex(s => s.id === slug);
  if (idx === -1) return { status: 404, data: { ok: false, erro: 'Sistema não encontrado' } };
  const antes = { ...sistemas[idx] };
  sistemas[idx] = {
    ...sistemas[idx],
    ...(body.nome && { nome: body.nome }),
    url:       body.url       !== undefined ? body.url       : sistemas[idx].url,
    ...(body.status && { status: body.status }),
    categoria: body.categoria !== undefined ? body.categoria : sistemas[idx].categoria,
    descricao: body.descricao !== undefined ? body.descricao : sistemas[idx].descricao,
    paraQuem:  body.paraQuem  !== undefined ? body.paraQuem  : sistemas[idx].paraQuem,
  };
  data.sistemas = sistemas;
  const diff = {};
  for (const k of ['nome', 'url', 'status', 'categoria', 'descricao', 'paraQuem']) {
    if (antes[k] !== sistemas[idx][k]) diff[k] = sistemas[idx][k];
  }
  if (!Array.isArray(data.audit_log)) data.audit_log = [];
  data.audit_log.push({
    id: 'fixed',
    at: '2026-06-12T15:00:00Z',
    by_email: by.email, by_nome: by.nome,
    action: 'editar', target_tipo: 'link',
    target_id: slug, target_nome: sistemas[idx].nome,
    campos: diff,
  });
  return { status: 200, data: { ok: true, sistema: sistemas[idx] } };
}

function setupData() {
  return {
    sistemas: [
      { id: 'chamados', nome: 'Chamados TI', url: 'https://chamados', status: 'no-ar', categoria: '', descricao: '', paraQuem: '' },
      { id: 'pesquisa-satisfacao', nome: 'Pesquisa de Satisfação', url: 'https://pesquisa', status: 'no-ar', categoria: '', descricao: '', paraQuem: '' },
    ],
    audit_log: [],
  };
}

test('PUT em pesquisa-satisfacao gera 1 audit com slug correto', () => {
  const data = setupData();
  simularPutSistemaEditar(data, 'pesquisa-satisfacao', { paraQuem: 'Equipe do Spa' }, { email: 'a@x.com', nome: 'Caio' });
  assert.equal(data.audit_log.length, 1, 'deve gerar exatamente 1 registro');
  const e = data.audit_log[0];
  assert.equal(e.target_tipo, 'link');
  assert.equal(e.target_id, 'pesquisa-satisfacao', 'slug correto');
  assert.equal(e.target_nome, 'Pesquisa de Satisfação');
  assert.deepEqual(e.campos, { paraQuem: 'Equipe do Spa' }, 'so o campo alterado');
});

test('PUT que nao muda nada ainda gera 1 audit, mas diff vazio', () => {
  const data = setupData();
  simularPutSistemaEditar(data, 'chamados', {
    nome: 'Chamados TI', url: 'https://chamados', status: 'no-ar', categoria: '', descricao: '', paraQuem: '',
  }, { email: 'a@x.com', nome: 'Caio' });
  assert.equal(data.audit_log.length, 1);
  assert.deepEqual(data.audit_log[0].campos, {}, 'diff vazio quando nada mudou');
});

test('PUT em slug inexistente retorna 404 e NAO gera audit', () => {
  const data = setupData();
  const r = simularPutSistemaEditar(data, 'fantasma', { nome: 'x' }, { email: 'a@x.com', nome: 'Caio' });
  assert.equal(r.status, 404);
  assert.equal(data.audit_log.length, 0, 'nenhum audit em rota nao encontrada');
});

test('audit registra by_email correto (rastreabilidade)', () => {
  const data = setupData();
  simularPutSistemaEditar(data, 'chamados', { nome: 'Chamados v2' }, { email: 'caio@granmarquise.com.br', nome: 'Caio' });
  assert.equal(data.audit_log[0].by_email, 'caio@granmarquise.com.br');
  assert.equal(data.audit_log[0].by_nome, 'Caio');
});
