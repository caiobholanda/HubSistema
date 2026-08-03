'use strict';

// REGRESSAO: o Hub so pode mandar o usuario para <origem>/sso?sso_token=<jwt>
// quando o destino realmente implementa essa rota (os satelites internos).
// Antes, handleOpen reescrevia TODA url de card para /sso?sso_token=..., e todo
// link novo cadastrado no admin (site externo, sem /sso) abria com erro — alem
// de vazar o JWT do Hub para uma origem de terceiro.
//
// Em vez de espelhar a logica, este teste extrai o bloco real de
// public/HubMarquise.jsx e o executa: se alguem mexer em SSO_ORIGINS ou em
// cardUsaSso, o teste acompanha (ou quebra) de verdade.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JSX = path.join(__dirname, '..', 'public', 'HubMarquise.jsx');

function carregarBlocoSso() {
  const src = fs.readFileSync(JSX, 'utf8');
  const ini = src.indexOf('const SSO_SISTEMA_IDS');
  const fim = src.indexOf('const HUB_SYSTEMS');
  assert.ok(ini !== -1 && fim > ini, 'bloco SSO/cardUsaSso nao encontrado em HubMarquise.jsx');
  const ctx = { URL };
  vm.createContext(ctx);
  // `const` fica no escopo lexical do script, nao vira propriedade do contexto —
  // por isso o export explicito no fim.
  vm.runInContext(src.slice(ini, fim) + '\nglobalThis.__sso = { SSO_ORIGINS, SSO_SISTEMA_IDS, originDe, ssoPadrao, cardUsaSso };', ctx);
  const api = ctx.__sso;
  assert.equal(typeof api.cardUsaSso, 'function', 'cardUsaSso nao definida');
  assert.ok(Array.isArray(api.SSO_ORIGINS), 'SSO_ORIGINS nao e um array');
  return api;
}

// Espelha handleOpen (public/HubMarquise.jsx) depois da decisao de destino.
// `destino` simula adminUrl/terapeutaUrl/mobileAdminUrl quando informado.
function urlDeAbertura(cardUsaSso, system, token, destino) {
  const destUrl = destino || system.url;
  const theme = 'light';
  let parsedDest = null;
  try { parsedDest = new URL(destUrl); } catch { /* '#' ou url relativa */ }
  const usaSso = cardUsaSso({ ...system, url: destUrl });
  if (token && parsedDest && usaSso) {
    const destPath = (parsedDest.pathname + parsedDest.search) || '/';
    const nextParam = destPath !== '/' ? `&next=${encodeURIComponent(destPath)}` : '';
    return `${parsedDest.origin}/sso?sso_token=${encodeURIComponent(token)}${nextParam}&theme=${theme}`;
  }
  if (usaSso) {
    const sep = destUrl.includes('?') ? '&' : '?';
    return `${destUrl}${sep}theme=${theme}`;
  }
  return destUrl;
}

const TOKEN = 'jwt-de-teste';

test('sistemas internos continuam abrindo via /sso (nao pode regredir)', () => {
  const { SSO_ORIGINS, cardUsaSso } = carregarBlocoSso();
  for (const origem of SSO_ORIGINS) {
    const url = urlDeAbertura(cardUsaSso, { url: origem }, TOKEN);
    assert.ok(url.startsWith(`${origem}/sso?sso_token=`), `${origem} deveria usar SSO, virou ${url}`);
  }
});

test('as 4 origens internas do hotel estao na lista', () => {
  const { SSO_ORIGINS } = carregarBlocoSso();
  for (const o of [
    'https://sistema-chamados-granmarquise.fly.dev',
    'https://diretorio-ramais-granmarquise.fly.dev',
    'https://pesquisa-satisfacao.fly.dev',
    'https://gestao-qualidade-granmarquise.fly.dev',
  ]) assert.ok(SSO_ORIGINS.includes(o), `${o} faltando em SSO_ORIGINS`);
});

test('card interno com caminho preserva o destino em ?next=', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const url = urlDeAbertura(cardUsaSso, { url: 'https://pesquisa-satisfacao.fly.dev/terapeuta' }, TOKEN);
  assert.ok(url.includes('next=%2Fterapeuta'), url);
});

test('REGRESSAO: link novo externo abre a URL crua, sem token nem theme', () => {
  const { cardUsaSso } = carregarBlocoSso();
  for (const u of [
    'https://www.google.com',
    'https://intranet.exemplo.com.br/portal?a=1',
    'https://algum-erp.com.br/login',
  ]) {
    assert.equal(urlDeAbertura(cardUsaSso, { url: u }, TOKEN), u, `URL de ${u} foi alterada`);
  }
});

test('o JWT do Hub nunca vai para uma origem de fora', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const url = urlDeAbertura(cardUsaSso, { url: 'https://site-de-terceiro.com/app' }, TOKEN);
  assert.ok(!url.includes(TOKEN), url);
});

test('flag sso explicita vence a lista de origens (nos dois sentidos)', () => {
  const { cardUsaSso } = carregarBlocoSso();
  assert.equal(cardUsaSso({ url: 'https://pesquisa-satisfacao.fly.dev', sso: false }), false);
  assert.equal(cardUsaSso({ url: 'https://novo-interno.fly.dev', sso: true }), true);
});

test('url invalida ou placeholder nao vira /sso', () => {
  const { cardUsaSso } = carregarBlocoSso();
  assert.equal(urlDeAbertura(cardUsaSso, { url: '#' }, TOKEN), '#');
  assert.equal(cardUsaSso({ url: undefined }), false);
  assert.equal(cardUsaSso(null), false);
});

test('sistema interno mantem SSO mesmo se a URL mudar de dominio (URL_OVERRIDES)', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const card = { id: 'chamados', url: 'https://chamados.granmarquise.com.br' };
  assert.equal(cardUsaSso(card), true);
  assert.ok(urlDeAbertura(cardUsaSso, card, TOKEN).includes('/sso?sso_token='));
});

test('destino alternativo (adminUrl/terapeutaUrl) tambem decide certo', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const card = { id: 'pesquisa-satisfacao', url: 'https://pesquisa-satisfacao.fly.dev' };
  const url = urlDeAbertura(cardUsaSso, card, TOKEN, 'https://pesquisa-satisfacao.fly.dev/admin');
  assert.ok(url.includes('next=%2Fadmin'), url);
  // Card externo com destino externo continua cru.
  const ext = { id: 'portal-x', url: 'https://portal-x.com' };
  assert.equal(urlDeAbertura(cardUsaSso, ext, TOKEN, 'https://portal-x.com/painel'), 'https://portal-x.com/painel');
});

test('backend e frontend concordam sobre quais sistemas usam SSO', () => {
  const front = carregarBlocoSso();
  const back = require('../src/migrations');
  // Copia para este realm: arrays vindos do vm tem outro Array.prototype.
  assert.deepEqual([...front.SSO_SISTEMA_IDS], back.SSO_SISTEMA_IDS);
  assert.deepEqual([...front.SSO_ORIGINS], back.SSO_ORIGINS);
});

test('migrarSsoSistemas carimba cards antigos e nao mexe em decisao explicita', () => {
  const { migrarSsoSistemas } = require('../src/migrations');
  const data = {
    sistemas: [
      { id: 'chamados', url: 'https://sistema-chamados-granmarquise.fly.dev' },
      { id: 'temp', url: 'https://pesquisa-satisfacao.fly.dev/terapeuta' },
      { id: 'cardapio', url: 'https://cardapio-externo.com' },
      { id: 'manual-off', url: 'https://pesquisa-satisfacao.fly.dev', sso: false },
    ],
  };
  migrarSsoSistemas(data);
  assert.deepEqual(data.sistemas.map(s => s.sso), [true, true, false, false]);
  // Idempotente.
  const antes = JSON.stringify(data);
  migrarSsoSistemas(data);
  assert.equal(JSON.stringify(data), antes);
});

test('REGRESSAO: editar so o status de card legado nao polui o diff com sso', () => {
  const { migrarSsoSistemas } = require('../src/migrations');
  // `antes` sai de readData(), que ja aplica a migration — por isso o campo
  // existe antes da edicao e o diff fica com uma chave so (deriva ativar/inativar).
  const data = { sistemas: [{ id: 'chamados', url: 'https://sistema-chamados-granmarquise.fly.dev', status: 'no-ar' }] };
  migrarSsoSistemas(data);
  const antes = { ...data.sistemas[0] };
  const body = { status: 'inativo', sso: true }; // o form manda o sso derivado junto
  const depois = { ...antes, status: body.status, ...(body.sso !== undefined ? { sso: !!body.sso } : {}) };
  const diff = {};
  for (const k of ['nome', 'url', 'status', 'categoria', 'descricao', 'acessoPadrao', 'sso']) {
    if (antes[k] !== depois[k]) diff[k] = depois[k];
  }
  assert.deepEqual(Object.keys(diff), ['status']);
});

test('sem token logado, sistema interno abre direto (sem sso_token)', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const url = urlDeAbertura(cardUsaSso, { url: 'https://sistema-chamados-granmarquise.fly.dev' }, null);
  assert.ok(!url.includes('sso_token='), url);
  assert.ok(url.includes('theme='), url);
});
