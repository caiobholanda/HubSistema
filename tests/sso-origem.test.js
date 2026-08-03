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
  const ini = src.indexOf('const SSO_ORIGINS');
  const fim = src.indexOf('const HUB_SYSTEMS');
  assert.ok(ini !== -1 && fim > ini, 'bloco SSO_ORIGINS/cardUsaSso nao encontrado em HubMarquise.jsx');
  const ctx = { URL };
  vm.createContext(ctx);
  // `const` fica no escopo lexical do script, nao vira propriedade do contexto —
  // por isso o export explicito no fim.
  vm.runInContext(src.slice(ini, fim) + '\nglobalThis.__sso = { SSO_ORIGINS, originDe, cardUsaSso };', ctx);
  const api = ctx.__sso;
  assert.equal(typeof api.cardUsaSso, 'function', 'cardUsaSso nao definida');
  assert.ok(Array.isArray(api.SSO_ORIGINS), 'SSO_ORIGINS nao e um array');
  return api;
}

// Espelha handleOpen (public/HubMarquise.jsx) depois da decisao de destino.
function urlDeAbertura(cardUsaSso, system, token) {
  const destUrl = system.url;
  const theme = 'light';
  let parsedDest = null;
  try { parsedDest = new URL(destUrl); } catch { /* '#' ou url relativa */ }
  const usaSso = cardUsaSso(system);
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

test('sem token logado, sistema interno abre direto (sem sso_token)', () => {
  const { cardUsaSso } = carregarBlocoSso();
  const url = urlDeAbertura(cardUsaSso, { url: 'https://sistema-chamados-granmarquise.fly.dev' }, null);
  assert.ok(!url.includes('sso_token='), url);
  assert.ok(url.includes('theme='), url);
});
