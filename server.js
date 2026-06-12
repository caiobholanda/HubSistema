require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SSO_SECRET = process.env.SSO_SECRET || 'dev-sso-secret';
const CHAMADOS_URL = process.env.CHAMADOS_URL || 'https://sistema-chamados-granmarquise.fly.dev';
const DATA_DIR = path.join(__dirname, 'data');
const HUB_DATA_FILE = path.join(DATA_DIR, 'hub_data.json');

if (!process.env.SSO_SECRET) {
  console.warn('[WARN] SSO_SECRET não configurado — usando secret inseguro');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers de persistência ────────────────────────────────────────────────

function readData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(HUB_DATA_FILE)) return { users: [], permissions: {} };
    return JSON.parse(fs.readFileSync(HUB_DATA_FILE, 'utf8'));
  } catch {
    return { users: [], permissions: {} };
  }
}

function writeData(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HUB_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Append-only audit log persistido em hub_data.json (cap 5000 entradas).
// Cada entrada: { id, at, by_email, by_nome, action, target_tipo, target_id, target_nome, campos }
function appendAudit(entry) {
  const data = readData();
  if (!Array.isArray(data.audit_log)) data.audit_log = [];
  data.audit_log.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    at: new Date().toISOString(),
    ...entry,
  });
  if (data.audit_log.length > 5000) data.audit_log = data.audit_log.slice(-5000);
  writeData(data);
}

// Sanitiza body: remove senhas e campos vazios; marca se houve troca de senha
function _campos(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  for (const k of Object.keys(body)) {
    if (k === '_self_edit') continue;
    if (k === 'senha') { if (body[k]) out._trocou_senha = true; continue; }
    if (k === 'senha_hash' || k === 'senha_plain') continue;
    if (body[k] === undefined || body[k] === null || body[k] === '') continue;
    out[k] = body[k];
  }
  return out;
}
// Diff entre o registro existente (antes) e o body recebido.
// Retorna SOMENTE os campos que mudaram, no mesmo formato de _campos
// (para o historico mostrar apenas o que foi alterado e nao todos os campos
// que o front pre-preenche). Compara normalizando bool/int (ativo=1 == true).
function _diff(antes, body) {
  if (!antes || !body || typeof body !== 'object') return _campos(body);
  const out = {};
  const norm = v => (v === true || v === 1) ? 1 : (v === false || v === 0 || v == null) ? 0 : v;
  for (const k of Object.keys(body)) {
    if (k === '_self_edit') continue;
    if (k === 'senha') { if (body[k]) out._trocou_senha = true; continue; }
    if (k === 'senha_hash' || k === 'senha_plain') continue;
    if (body[k] === undefined || body[k] === null || body[k] === '') continue;
    const a = antes[k], b = body[k];
    if (typeof a === 'boolean' || typeof b === 'boolean' || k === 'ativo' || k === 'is_master') {
      if (norm(a) === norm(b)) continue;
    } else if (typeof a === 'string' && typeof b === 'string') {
      if (a.trim().toLowerCase() === b.trim().toLowerCase()) continue;
    } else if (a === b) {
      continue;
    }
    out[k] = b;
  }
  return out;
}

async function _buscarAdminAlvo(id) {
  const r = await proxyChamados('/admins');
  if (r.status !== 200 || !r.data || !r.data.ok) return null;
  return (r.data.admins || []).find(a => Number(a.id) === Number(id)) || null;
}
async function _buscarUsuarioAlvo(id) {
  const r = await proxyChamados('/portal-usuarios');
  if (r.status !== 200 || !r.data || !r.data.ok) return null;
  return (r.data.usuarios || []).find(u => Number(u.id) === Number(id)) || null;
}

// Resolve nome do alvo para qualquer tipo de audit log
async function _resolverNomeAlvo(tipo, id) {
  try {
    if (tipo === 'admin') {
      const a = await _buscarAdminAlvo(id);
      return a && a.nome_completo || null;
    }
    if (tipo === 'usuario') {
      const r = await proxyChamados('/portal-usuarios');
      if (r.status === 200 && r.data && r.data.ok) {
        const u = (r.data.usuarios || []).find(x => Number(x.id) === Number(id));
        return u && u.nome || null;
      }
    }
    if (tipo === 'setor') {
      const r = await proxyChamados('/setores');
      if (r.status === 200 && r.data && r.data.ok) {
        const s = (r.data.setores || []).find(x => Number(x.id) === Number(id));
        return s && s.nome || null;
      }
    }
    if (tipo === 'link') {
      const sis = (readData().sistemas || DEFAULT_SISTEMAS).find(s => s.id === id);
      return sis && sis.nome || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function trackUser(email, nome, tipo, extras = {}) {
  const data = readData();
  const idx = data.users.findIndex(u => u.email === email);
  const registro = {
    email,
    nome,
    tipo,
    setor: extras.setor || '',
    ramal: extras.ramal || '',
    is_master: !!extras.is_master,
    usuario: extras.usuario || '',
    ultimo_login: new Date().toISOString(),
  };
  if (idx === -1) {
    data.users.push(registro);
  } else {
    data.users[idx] = { ...data.users[idx], ...registro };
  }
  writeData(data);
}

function getUserSistemas(email) {
  const data = readData();
  return Object.prototype.hasOwnProperty.call(data.permissions, email)
    ? data.permissions[email]
    : null; // null = acesso total
}

// Garante que usuario nao-admin tenha permissoes explicitas no primeiro login.
// Assim, links novos criados depois nao aparecem automaticamente para ele.
function snapshotPermissoesSeNaoTiver(email, tipo) {
  if (tipo === 'admin') return;
  const data = readData();
  if (!data.permissions) data.permissions = {};
  if (Object.prototype.hasOwnProperty.call(data.permissions, email)) return;
  data.permissions[email] = (data.sistemas || DEFAULT_SISTEMAS).map(s => s.id);
  writeData(data);
}

// ─── Sistemas (links do Hub) ─────────────────────────────────────────────────

const DEFAULT_SISTEMAS = [
  { id: 'chamados',  num: '01', nome: 'Chamados TI',           url: 'https://sistema-chamados-granmarquise.fly.dev', status: 'no-ar', categoria: 'Suporte · Atendimento interno', descricao: 'Para pedir ajuda da equipe de TI do hotel.',                 paraQuem: 'Todos os setores' },
  { id: 'ramais',    num: '02', nome: 'Lista de Ramais',        url: 'https://diretorio-ramais-granmarquise.fly.dev', status: 'no-ar', categoria: 'Comunicação · Interno',         descricao: 'Diretório de ramais e contatos internos do hotel.',           paraQuem: 'Todos os setores' },
  { id: 'spa',       num: '03', nome: 'Pesquisa de Satisfação', url: 'https://pesquisa-satisfacao.fly.dev',           status: 'no-ar', categoria: 'Spa · Atendimento ao hóspede',  descricao: 'Coleta de feedback dos hóspedes após os tratamentos no Spa.', paraQuem: 'Equipe do Spa' },
];

function getSistemas() {
  const data = readData();
  return data.sistemas || DEFAULT_SISTEMAS;
}

// ─── SSE (notificações em tempo real) ───────────────────────────────────────

const sseClients = new Map(); // email -> res

function notifyUser(email, sistemas) {
  const client = sseClients.get(email);
  if (client) client.write(`event: permissions\ndata: ${JSON.stringify({ sistemas })}\n\n`);
}

// ─── Middleware admin ────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, SSO_SECRET);
    if (payload.tipo !== 'admin') return res.status(403).json({ ok: false, erro: 'Acesso restrito a admins' });
    req.hubUser = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, erro: 'Token inválido' });
  }
}

app.get('/api/sistemas', (_req, res) => {
  res.json({ ok: true, sistemas: getSistemas() });
});

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ ok: false, erro: 'Email e senha obrigatórios' });
  const emailNorm = email.trim().toLowerCase();

  // Tenta login como admin primeiro
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailNorm, senha }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.precisa_trocar_senha) {
        return res.json({ ok: true, precisa_trocar_senha: true, email: emailNorm, tipo: 'admin' });
      }
      const token = jwt.sign({ nome: data.nome, email: emailNorm, tipo: 'admin', is_master: data.is_master }, SSO_SECRET, { expiresIn: '8h' });
      trackUser(emailNorm, data.nome, 'admin', {
        setor: data.setor,
        ramal: data.ramal,
        is_master: data.is_master,
        usuario: data.usuario,
      });
      return res.json({ ok: true, token, tipo: 'admin', nome: data.nome, sistemas: getUserSistemas(emailNorm) });
    }
  } catch (_) {}

  // Fallback: login como usuário
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/usuarios/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailNorm, senha }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.precisa_trocar_senha) {
        return res.json({ ok: true, precisa_trocar_senha: true, email: emailNorm, tipo: 'usuario' });
      }
      const token = jwt.sign({ nome: data.nome, email: emailNorm, tipo: 'usuario' }, SSO_SECRET, { expiresIn: '8h' });
      trackUser(emailNorm, data.nome, 'usuario', {
        setor: data.setor,
        ramal: data.ramal,
      });
      snapshotPermissoesSeNaoTiver(emailNorm, 'usuario');
      return res.json({ ok: true, token, tipo: 'usuario', nome: data.nome, sistemas: getUserSistemas(emailNorm) });
    }
  } catch (_) {}

  return res.status(401).json({ ok: false, erro: 'Credenciais inválidas' });
});

// Esqueci a senha: encaminha para o sistema-chamados, que envia o e-mail
// (mesmo endpoint serve admins e usuarios do portal).
// Troca obrigatoria de senha no primeiro login (publico, sem auth).
// O usuario ja provou a senha_atual no /login imediatamente antes.
app.post('/api/auth/trocar-primeira-senha', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  const senha_atual = (req.body && req.body.senha_atual || '').trim();
  const senha_nova = (req.body && req.body.senha_nova || '').trim();
  if (!email || !senha_atual || !senha_nova) return res.status(400).json({ ok: false, erro: 'Dados incompletos' });
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/hub/trocar-primeira-senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: JSON.stringify({ email, senha_atual, senha_nova }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, erro: data.erro || 'Não foi possível trocar a senha.' });
    return res.json({ ok: true, tipo: data.tipo });
  } catch {
    return res.status(502).json({ ok: false, erro: 'Sistema de chamados offline. Tente novamente em instantes.' });
  }
});

app.post('/api/auth/esqueci-senha', async (req, res) => {
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, erro: 'E-mail obrigatório' });
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/usuarios/esqueci-senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return res.json({ ok: true, mensagem: data.mensagem || 'E-mail enviado com sucesso.' });
    return res.status(r.status).json({ ok: false, erro: data.erro || 'Não foi possível enviar o link.' });
  } catch {
    return res.status(502).json({ ok: false, erro: 'Sistema de chamados offline. Tente novamente em instantes.' });
  }
});

// ─── Admin API ───────────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  const token = req.query.token;
  try {
    const payload = jwt.verify(token, SSO_SECRET);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.set(payload.email, res);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { sseClients.delete(payload.email); clearInterval(keepAlive); });
  } catch {
    res.status(401).end();
  }
});

app.get('/api/me/sistemas', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false });
  try {
    const payload = jwt.verify(token, SSO_SECRET);
    return res.json({ ok: true, sistemas: getUserSistemas(payload.email) });
  } catch {
    return res.status(401).json({ ok: false });
  }
});

app.get('/api/admin/data', requireAdmin, (_req, res) => {
  const data = readData();
  res.json({ ok: true, users: data.users, permissions: data.permissions });
});

app.put('/api/admin/permissions', requireAdmin, (req, res) => {
  const { email, sistemas } = req.body || {};
  if (!email || !Array.isArray(sistemas)) return res.status(400).json({ ok: false, erro: 'Dados inválidos' });
  const data = readData();
  // Diff: para cada toggle de link gera um evento granular (liberar_link/bloquear_link)
  const antes = data.permissions[email];
  const sistemasAtuaisIds = (data.sistemas || DEFAULT_SISTEMAS).map(s => s.id);
  const tinhaAntes = (antes === undefined || antes === null) ? sistemasAtuaisIds : antes;
  const setAntes = new Set(tinhaAntes);
  const setDepois = new Set(sistemas);
  const liberados = [...setDepois].filter(x => !setAntes.has(x));
  const bloqueados = [...setAntes].filter(x => !setDepois.has(x));
  const alvo = (data.users || []).find(u => u.email === email);
  const targetNome = (alvo && alvo.nome) || email;
  const sistemasMap = Object.fromEntries((data.sistemas || DEFAULT_SISTEMAS).map(s => [s.id, s.nome]));
  for (const sid of liberados) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'liberar_link', target_tipo: 'permissao',
      target_id: null, target_nome: targetNome,
      campos: { email, link: sistemasMap[sid] || sid },
    });
  }
  for (const sid of bloqueados) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'bloquear_link', target_tipo: 'permissao',
      target_id: null, target_nome: targetNome,
      campos: { email, link: sistemasMap[sid] || sid },
    });
  }
  data.permissions[email] = sistemas;
  writeData(data);
  notifyUser(email, sistemas);
  res.json({ ok: true });
});

app.get('/api/admin/all-users', requireAdmin, async (_req, res) => {
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/hub/usuarios`, {
      headers: { Authorization: `Bearer ${SSO_SECRET}` },
    });
    const data = await r.json();
    res.json(data);
  } catch {
    res.status(500).json({ ok: false, erro: 'Erro ao buscar usuários' });
  }
});

app.post('/api/admin/sistemas', requireAdmin, (req, res) => {
  const { nome, url, status, categoria, descricao, paraQuem } = req.body || {};
  if (!nome || !status) return res.status(400).json({ ok: false, erro: 'Nome e status são obrigatórios' });
  const data = readData();
  const sistemas = getSistemas();
  const id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (sistemas.find(s => s.id === id)) return res.status(409).json({ ok: false, erro: 'Já existe um sistema com esse nome' });
  const num = String(sistemas.length + 1).padStart(2, '0');
  const novo = { id, num, nome, url: url || '#', status, categoria: categoria || '', descricao: descricao || '', paraQuem: paraQuem || '' };
  data.sistemas = [...sistemas, novo];

  // Novo link aparece apenas para admins por padrão. Snapshot dos sistemas
  // atuais para todo usuario sem permissao explicita, preservando o acesso
  // que ja tinham mas excluindo o novo link.
  const sistemasAtuaisIds = sistemas.map(s => s.id);
  data.permissions = data.permissions || {};
  for (const u of (data.users || [])) {
    if (u.tipo === 'admin') continue;
    const atual = data.permissions[u.email];
    if (atual === undefined || atual === null) {
      data.permissions[u.email] = sistemasAtuaisIds;
      notifyUser(u.email, sistemasAtuaisIds);
    }
  }

  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'criar', target_tipo: 'link',
    target_id: id, target_nome: nome,
    campos: { nome, url: url || '#', status, categoria: categoria || '', paraQuem: paraQuem || '' },
  });
  res.json({ ok: true, sistema: novo });
});

app.put('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const { nome, url, status, categoria, descricao, paraQuem } = req.body || {};
  const data = readData();
  const sistemas = getSistemas();
  const idx = sistemas.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Sistema não encontrado' });
  const antes = { ...sistemas[idx] };
  sistemas[idx] = { ...sistemas[idx], ...(nome && { nome }), url: url !== undefined ? url : sistemas[idx].url, ...(status && { status }), categoria: categoria !== undefined ? categoria : sistemas[idx].categoria, descricao: descricao !== undefined ? descricao : sistemas[idx].descricao, paraQuem: paraQuem !== undefined ? paraQuem : sistemas[idx].paraQuem };
  data.sistemas = sistemas;
  writeData(data);
  // So loga campos efetivamente alterados
  const diff = {};
  for (const k of ['nome', 'url', 'status', 'categoria', 'descricao', 'paraQuem']) {
    if (antes[k] !== sistemas[idx][k]) diff[k] = sistemas[idx][k];
  }
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'editar', target_tipo: 'link',
    target_id: req.params.id, target_nome: sistemas[idx].nome,
    campos: diff,
  });
  res.json({ ok: true, sistema: sistemas[idx] });
});

app.delete('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const data = readData();
  const sistemas = getSistemas();
  const antes = sistemas.find(s => s.id === req.params.id);
  data.sistemas = sistemas.filter(s => s.id !== req.params.id);
  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'excluir', target_tipo: 'link',
    target_id: req.params.id, target_nome: antes && antes.nome || req.params.id,
    campos: {},
  });
  res.json({ ok: true });
});

// ─── Proxy de CRUD de admins/usuarios para o sistema-chamados ──────────────
// Hub valida JWT do admin do Hub; proxia com Bearer SSO_SECRET para /api/hub/*
async function proxyChamados(path, { method = 'GET', body = null } = {}) {
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/hub${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch (err) {
    console.error('[proxyChamados]', path, err.message);
    return { status: 502, data: { ok: false, erro: 'Sistema de chamados offline' } };
  }
}

// Admins (CRUD) — operacoes que alteram dados gravam audit log
app.get('/api/admin/chamados-admins', requireAdmin, async (_req, res) => {
  const r = await proxyChamados('/admins');
  res.status(r.status).json(r.data);
});
app.post('/api/admin/chamados-admins', requireAdmin, async (req, res) => {
  const r = await proxyChamados('/admins', { method: 'POST', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'criar', target_tipo: 'admin',
      target_id: r.data.id, target_nome: req.body && req.body.nome_completo,
      campos: _campos(req.body),
    });
  }
  res.status(r.status).json(r.data);
});
app.patch('/api/admin/chamados-admins/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarAdminAlvo(id);
  const ehEuMesmo = antes && req.hubUser.email && antes.email
      && antes.email.toLowerCase() === String(req.hubUser.email).toLowerCase();

  // Bloqueio CIRURGICO de self-edit:
  // - O admin pode editar nome_completo, email, ramal, senha e etiquetas da
  //   propria conta normalmente.
  // - 'ativo' e 'is_master' sao IGNORADOS silenciosamente quando ehEuMesmo
  //   (em vez de devolver 403). O front ja envia o body completo do registro,
  //   entao rejeitar derrubaria edicoes legitimas de outros campos.
  // - A unica forma de uma alteracao de 'ativo' ou 'is_master' do PROPRIO admin
  //   chegar aqui e tentativa de bypass via API: ignorar e prosseguir.
  let bodyProxy = req.body || {};
  if (ehEuMesmo) {
    const sanitized = { ...bodyProxy };
    delete sanitized.ativo;
    delete sanitized.is_master;
    // Sinaliza ao backend chamados que e auto-edicao (nao remarcar precisa_trocar_senha).
    sanitized._self_edit = true;
    bodyProxy = sanitized;
  }
  const r = await proxyChamados(`/admins/${encodeURIComponent(id)}`, { method: 'PATCH', body: bodyProxy });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    // Compara o body com o registro antes da edicao para registrar SO os campos
    // que efetivamente mudaram (sem isso, o historico mostra todos os campos
    // que o front pre-preenche, mesmo os que nao foram alterados).
    const diff = _diff(antes, bodyProxy);
    const onlyKeys = Object.keys(diff);
    let action = 'editar';
    if (onlyKeys.length === 1 && 'ativo' in diff) action = diff.ativo ? 'ativar' : 'inativar';
    else if (onlyKeys.length === 1 && 'is_master' in diff) action = diff.is_master ? 'promover_master' : 'rebaixar_master';
    else if (onlyKeys.length === 1 && '_trocou_senha' in diff) action = 'trocar_senha';
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action, target_tipo: 'admin',
      target_id: Number(id),
      target_nome: (antes && antes.nome_completo) || null,
      campos: diff,
    });
  }
  res.status(r.status).json(r.data);
});
app.delete('/api/admin/chamados-admins/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarAdminAlvo(id);
  const r = await proxyChamados(`/admins/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'excluir', target_tipo: 'admin',
      target_id: Number(id),
      target_nome: (antes && antes.nome_completo) || null,
      campos: {},
    });
  }
  res.status(r.status).json(r.data);
});

// Etiquetas e setor cache (no chamados)
app.get('/api/admin/chamados-etiquetas', requireAdmin, async (_req, res) => {
  const r = await proxyChamados('/etiquetas'); res.status(r.status).json(r.data);
});
app.get('/api/admin/chamados-setores', requireAdmin, async (_req, res) => {
  const r = await proxyChamados('/setores'); res.status(r.status).json(r.data);
});
app.post('/api/admin/chamados-setores', requireAdmin, async (req, res) => {
  const r = await proxyChamados('/setores', { method: 'POST', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'criar', target_tipo: 'setor',
      target_id: r.data.id, target_nome: r.data.nome || (req.body && req.body.nome),
      campos: { nome: r.data.nome || (req.body && req.body.nome) },
    });
  }
  res.status(r.status).json(r.data);
});
app.put('/api/admin/chamados-setores/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const nomeAntigo = await _resolverNomeAlvo('setor', id);
  const r = await proxyChamados(`/setores/${encodeURIComponent(id)}`, { method: 'PUT', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    const nomeNovo = req.body && req.body.nome;
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'editar', target_tipo: 'setor',
      target_id: Number(id), target_nome: nomeNovo || nomeAntigo,
      campos: { nome_anterior: nomeAntigo, nome: nomeNovo },
    });
  }
  res.status(r.status).json(r.data);
});
app.delete('/api/admin/chamados-setores/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const nome = await _resolverNomeAlvo('setor', id);
  const r = await proxyChamados(`/setores/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'excluir', target_tipo: 'setor',
      target_id: Number(id), target_nome: nome,
      campos: {},
    });
  }
  res.status(r.status).json(r.data);
});
app.get('/api/admin/chamados-admins/:id/etiquetas', requireAdmin, async (req, res) => {
  const r = await proxyChamados(`/admins/${encodeURIComponent(req.params.id)}/etiquetas`);
  res.status(r.status).json(r.data);
});
app.put('/api/admin/chamados-admins/:id/etiquetas', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarAdminAlvo(id);
  const r = await proxyChamados(`/admins/${encodeURIComponent(id)}/etiquetas`, { method: 'PUT', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'etiquetas', target_tipo: 'admin',
      target_id: Number(id),
      target_nome: (antes && antes.nome_completo) || null,
      campos: { slugs: Array.isArray(req.body && req.body.slugs) ? req.body.slugs : [] },
    });
  }
  res.status(r.status).json(r.data);
});

// Usuarios do portal (CRUD)
app.get('/api/admin/chamados-usuarios', requireAdmin, async (_req, res) => {
  const r = await proxyChamados('/portal-usuarios');
  res.status(r.status).json(r.data);
});
app.post('/api/admin/chamados-usuarios', requireAdmin, async (req, res) => {
  const r = await proxyChamados('/portal-usuarios', { method: 'POST', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'criar', target_tipo: 'usuario',
      target_id: r.data.id, target_nome: req.body && req.body.nome,
      campos: _campos(req.body),
    });
  }
  res.status(r.status).json(r.data);
});
app.patch('/api/admin/chamados-usuarios/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarUsuarioAlvo(id);
  const r = await proxyChamados(`/portal-usuarios/${encodeURIComponent(id)}`, { method: 'PATCH', body: req.body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    const diff = _diff(antes, req.body || {});
    const onlyKeys = Object.keys(diff);
    let action = 'editar';
    if (onlyKeys.length === 1 && 'ativo' in diff) action = diff.ativo ? 'ativar' : 'inativar';
    else if (onlyKeys.length === 1 && '_trocou_senha' in diff) action = 'trocar_senha';
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action, target_tipo: 'usuario',
      target_id: Number(id), target_nome: (antes && antes.nome) || null,
      campos: diff,
    });
  }
  res.status(r.status).json(r.data);
});
app.delete('/api/admin/chamados-usuarios/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const nome = await _resolverNomeAlvo('usuario', id);
  const r = await proxyChamados(`/portal-usuarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'excluir', target_tipo: 'usuario',
      target_id: Number(id), target_nome: nome,
      campos: {},
    });
  }
  res.status(r.status).json(r.data);
});
app.get('/api/admin/chamados-usuarios/:id/logs', requireAdmin, async (req, res) => {
  const r = await proxyChamados(`/portal-usuarios/${encodeURIComponent(req.params.id)}/logs`);
  res.status(r.status).json(r.data);
});
app.get('/api/admin/chamados-usuarios/:id/chamados', requireAdmin, async (req, res) => {
  const r = await proxyChamados(`/portal-usuarios/${encodeURIComponent(req.params.id)}/chamados`);
  res.status(r.status).json(r.data);
});

// Audit log — historico de alteracoes em admins (e futuramente usuarios) feitas pelo Hub.
app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
  const data = readData();
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 500, 5000));
  const tipo = req.query.target_tipo; // opcional: 'admin' | 'usuario'
  let log = Array.isArray(data.audit_log) ? data.audit_log : [];
  if (tipo) log = log.filter(e => e.target_tipo === tipo);
  // Mais recentes primeiro
  log = log.slice().reverse().slice(0, limit);
  res.json({ ok: true, log });
});

app.delete('/api/admin/permissions/:email', requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const data = readData();
  delete data.permissions[email];
  writeData(data);
  notifyUser(email, null);
  const alvo = (data.users || []).find(u => u.email === email);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'resetar_permissoes', target_tipo: 'permissao',
    target_id: null, target_nome: (alvo && alvo.nome) || email,
    campos: { email },
  });
  res.json({ ok: true });
});

// ─── Static fallback ─────────────────────────────────────────────────────────

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Hub rodando em http://localhost:${PORT}`));
