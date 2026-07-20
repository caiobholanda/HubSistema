require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SSO_SECRET = process.env.SSO_SECRET || 'dev-sso-secret';
const CHAMADOS_URL = process.env.CHAMADOS_URL || 'https://sistema-chamados-granmarquise.fly.dev';
const PESQUISA_URL = process.env.PESQUISA_URL || 'https://pesquisa-satisfacao.fly.dev';
const HUB_URL = process.env.HUB_URL || 'https://hub-granmarquise.fly.dev';
const DATA_DIR = path.join(__dirname, 'data');
const HUB_DATA_FILE = path.join(DATA_DIR, 'hub_data.json');

if (!process.env.SSO_SECRET) {
  console.warn('[WARN] SSO_SECRET não configurado — usando secret inseguro');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers de persistência ────────────────────────────────────────────────

const { migrarSlugs } = require('./src/migrations');
const sitePerm = require('./src/site-permissions');

const HUB_DATA_TMP = HUB_DATA_FILE + '.tmp';

function _parseDataFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  migrarSlugs(data);
  sitePerm.migrarSitePermissoes(data);
  sitePerm.migrarSitePermissoesV2(data);
  sitePerm.migrarPermissionsV3(data);
  sitePerm.migrarSitePermissoesV4(data);
  return data;
}

function readData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(HUB_DATA_FILE)) return _parseDataFile(HUB_DATA_FILE);
    // Arquivo principal ausente: tenta recuperar do .tmp (escrita interrompida)
    if (fs.existsSync(HUB_DATA_TMP)) return _parseDataFile(HUB_DATA_TMP);
    return { users: [], permissions: {} };
  } catch {
    // Arquivo principal corrompido: tenta .tmp como fallback
    try {
      if (fs.existsSync(HUB_DATA_TMP)) return _parseDataFile(HUB_DATA_TMP);
    } catch {}
    return { users: [], permissions: {} };
  }
}

function writeData(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Escrita atomica: grava no .tmp e depois renomeia sobre o arquivo principal.
  // Impede que um SIGTERM durante a escrita corrompa hub_data.json.
  fs.writeFileSync(HUB_DATA_TMP, JSON.stringify(data, null, 2), 'utf8');
  // No Windows, renameSync falha com EPERM se o destino ja existe; usa
  // copyFileSync+unlink como fallback (nao atomico, mas funciona em dev local).
  try {
    fs.renameSync(HUB_DATA_TMP, HUB_DATA_FILE);
  } catch {
    fs.copyFileSync(HUB_DATA_TMP, HUB_DATA_FILE);
    try { fs.unlinkSync(HUB_DATA_TMP); } catch {}
  }
}

function _sanitizarStr(s) {
  if (typeof s !== 'string') return s;
  // U+FFFD: replacement character gerado por bytes Latin-1 mal-decodificados
  return s.replace(/�/g, '');
}

function _sanitizarAuditLog() {
  try {
    const data = readData();
    if (!Array.isArray(data.audit_log)) return;
    let dirty = false;
    const NOMES_ACAO_INVALIDOS = new Set(['desativado', 'ativado', 'excluído', 'excluido', 'criado', 'editado', 'promovido', 'rebaixado']);
    const STR_KEYS = ['by_nome', 'target_nome', 'by_email'];
    for (const e of data.audit_log) {
      if (typeof e.target_nome === 'string' && NOMES_ACAO_INVALIDOS.has(e.target_nome.toLowerCase())) {
        e.target_nome = null;
        dirty = true;
      }
      for (const k of STR_KEYS) {
        if (typeof e[k] === 'string' && e[k].indexOf('�') !== -1) {
          e[k] = _sanitizarStr(e[k]);
          dirty = true;
        }
      }
      if (e.campos && typeof e.campos === 'object') {
        for (const k of Object.keys(e.campos)) {
          if (typeof e.campos[k] === 'string' && e.campos[k].indexOf('�') !== -1) {
            e.campos[k] = _sanitizarStr(e.campos[k]);
            dirty = true;
          }
        }
      }
    }
    if (dirty) {
      writeData(data);
      console.log('[init] audit_log sanitizado — U+FFFD removidos');
    }
  } catch (err) {
    console.error('[init] falha ao sanitizar audit_log:', err.message);
  }
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

// ─── Helpers de ativação de usuários ────────────────────────────────────────

function _gerarSenhaForte() {
  const b = crypto.randomBytes(16);
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%&';
  const all = upper + lower + digits + special;
  let s = upper[b[0] % 26] + lower[b[1] % 26] + digits[b[2] % 10] + special[b[3] % 6];
  for (let i = 4; i < 14; i++) s += all[b[i] % all.length];
  const arr = s.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = b[i % 16] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function _gerarLinkAtivacao(chamadosId, email, nome) {
  const data = readData();
  if (!Array.isArray(data.activation_tokens)) data.activation_tokens = [];
  // Sanitiza entradas corrompidas (null/nao-objeto) — ja derrubou o processo em producao
  data.activation_tokens = data.activation_tokens.filter(t => t && typeof t === 'object');
  data.activation_tokens.forEach(t => { if (t.email === email) t.used = true; });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  data.activation_tokens.push({ chamadosId, email, nome, token, expiresAt, used: false, createdAt: new Date().toISOString() });
  writeData(data);
  return `${HUB_URL}/ativar?t=${token}`;
}

function _registrarHubUsuario(email, nome, chamadosId, status) {
  const data = readData();
  if (!Array.isArray(data.users)) data.users = [];
  const idx = data.users.findIndex(u => u.email === email);
  if (idx === -1) {
    data.users.push({ email, nome, chamados_id: chamadosId, hub_status: status, login_failures: 0 });
  } else {
    data.users[idx].hub_status = status;
    if (chamadosId) data.users[idx].chamados_id = chamadosId;
    if (nome) data.users[idx].nome = nome;
  }
  writeData(data);
}

function _hubStatusDoEmail(email) {
  try {
    const data = readData();
    const u = (data.users || []).find(u => u.email === email);
    return u || null;
  } catch { return null; }
}

// Regra unica de acesso a link (compartilhada com o front em HubMarquise.jsx):
// - admins (tipo='admin' ou is_master) veem todos os sistemas;
// - demais usuarios sem entrada explicita, com valor nao-array ou array vazio
//   NAO veem nenhum link (fail-closed). Apenas o array com o id concede acesso.
function temAcessoAoSistema(permissions, email, systemId, ehAdmin) {
  if (ehAdmin) return true;
  const p = permissions && permissions[email];
  return Array.isArray(p) && p.includes(systemId);
}

function getUserSistemas(email, tipo, isMaster) {
  const data = readData();
  const sistemas = data.sistemas || DEFAULT_SISTEMAS;
  const sistemasAtuaisIds = sistemas.map(s => s.id);
  const ehAdmin = tipo === 'admin' || !!isMaster;
  if (ehAdmin) return sistemasAtuaisIds;
  const padraoIds = sistemas.filter(s => s.acessoPadrao).map(s => s.id);
  const p = data.permissions[email];
  const explicitos = Array.isArray(p) ? p.filter(id => sistemasAtuaisIds.includes(id)) : [];
  // Fonte nova: site_permissions gravada por LiberacaoPanel
  const e = sitePerm._norm(email);
  const viaSitePerm = (data.site_permissions || [])
    .filter(r => sitePerm._norm(r.email) === e && sistemasAtuaisIds.includes(r.sistema_id))
    .map(r => r.sistema_id);
  return [...new Set([...explicitos, ...viaSitePerm, ...padraoIds])];
}

// Garante que usuario nao-admin tenha entrada explicita no primeiro login.
// Como agora o default e fail-closed, novos usuarios entram com array vazio
// — admin precisa liberar links manualmente.
function snapshotPermissoesSeNaoTiver(email, tipo) {
  if (tipo === 'admin') return;
  const data = readData();
  if (!data.permissions) data.permissions = {};
  if (Object.prototype.hasOwnProperty.call(data.permissions, email)) return;
  const padraoIds = (data.sistemas || DEFAULT_SISTEMAS).filter(s => s.acessoPadrao).map(s => s.id);
  data.permissions[email] = padraoIds;
  writeData(data);
}

function autoAssociarTodos(data, sistemaId) {
  if (!data.permissions) return;
  for (const email of Object.keys(data.permissions)) {
    const p = data.permissions[email];
    if (Array.isArray(p) && !p.includes(sistemaId)) {
      data.permissions[email] = [...p, sistemaId];
    }
  }
}

// ─── Sistemas (links do Hub) ─────────────────────────────────────────────────

const DEFAULT_SISTEMAS = [
  { id: 'chamados',  num: '01', nome: 'Chamados TI',           url: 'https://sistema-chamados-granmarquise.fly.dev', status: 'no-ar', categoria: 'Suporte · Atendimento interno', descricao: 'Para pedir ajuda da equipe de TI do hotel.' },
  { id: 'ramais',    num: '02', nome: 'Lista de Ramais',        url: 'https://diretorio-ramais-granmarquise.fly.dev', status: 'no-ar', categoria: 'Comunicação · Interno',         descricao: 'Diretório de ramais e contatos internos do hotel.' },
  { id: 'pesquisa-satisfacao', num: '03', nome: 'Pesquisa de Satisfação', url: 'https://pesquisa-satisfacao.fly.dev', status: 'no-ar', categoria: 'Spa · Atendimento ao hóspede', descricao: 'Gestão de atendimentos, escalas de profissionais, anamnese digital e auditoria de satisfação do Gran Spa.' },
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

  // Verifica bloqueio por hub_status antes de consultar chamados
  const hubReg = _hubStatusDoEmail(emailNorm);
  if (hubReg && hubReg.hub_status === 'bloqueado') {
    return res.status(403).json({ ok: false, erro: 'Conta bloqueada após múltiplas tentativas. Fale com o TI.' });
  }
  if (hubReg && hubReg.hub_status === 'ativacao_pendente') {
    return res.status(403).json({ ok: false, erro: 'Conta aguardando ativação. Verifique o link enviado pelo TI.' });
  }

  // Usa endpoint server-to-server (Bearer SSO_SECRET) que resolve admin vs
  // usuario num unico passo, SEM rate limit por IP. Antes este handler fazia
  // 2 requests (admin + usuario) — como o Hub e um unico IP, saturava o rate
  // limit do chamados rapidamente e travava login para todos.
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/hub/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: JSON.stringify({ email: emailNorm, senha }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      // Rastreia falhas de login por usuário (apenas para tipo 'usuario')
      try {
        const hubData = readData();
        if (!Array.isArray(hubData.users)) hubData.users = [];
        const idx = hubData.users.findIndex(u => u.email === emailNorm);
        if (idx !== -1 && hubData.users[idx].hub_status !== 'bloqueado') {
          const falhas = (hubData.users[idx].login_failures || 0) + 1;
          hubData.users[idx].login_failures = falhas;
          if (falhas >= 5) {
            hubData.users[idx].hub_status = 'bloqueado';
            console.log(`[auth] conta bloqueada após ${falhas} falhas: ${emailNorm}`);
            writeData(hubData);
            return res.status(403).json({ ok: false, erro: 'Conta bloqueada após múltiplas tentativas. Fale com o TI.' });
          }
          writeData(hubData);
        }
      } catch {}
      return res.status(r.status || 401).json({ ok: false, erro: data.erro || 'Credenciais inválidas' });
    }
    if (data.precisa_trocar_senha) {
      return res.json({ ok: true, precisa_trocar_senha: true, email: emailNorm, tipo: data.tipo });
    }
    const payload = { nome: data.nome, email: emailNorm, tipo: data.tipo };
    if (data.tipo === 'admin') payload.is_master = !!data.is_master;
    // Fase 1 do gerenciamento manual de cookies: anexa lista de sistemas onde
    // este email tem papel 'admin' no banco do Hub. Sistemas satelites podem
    // ler isso do JWT em vez de manter suas proprias allowlists hardcoded.
    try {
      const dados = readData();
      payload.sites_admin = sitePerm.sitesOndeEhAdmin(dados, emailNorm);
      // site_roles: papel granular por site (ex: { 'pesquisa-satisfacao': 'spa' }).
      // Usado pela pesquisa-satisfacao para aplicar visibilidade fina alem do
      // simples admin/usuario do sites_admin.
      payload.site_roles = sitePerm.rolesDoEmail(dados, emailNorm);
    } catch { payload.sites_admin = []; payload.site_roles = {}; }
    const token = jwt.sign(payload, SSO_SECRET, { expiresIn: '8h' });
    trackUser(emailNorm, data.nome, data.tipo, {
      setor: data.setor,
      ramal: data.ramal,
      is_master: data.is_master,
      usuario: data.usuario,
    });
    // Reset de falhas de login em acesso bem-sucedido
    try {
      const hubData = readData();
      const idx = (hubData.users || []).findIndex(u => u.email === emailNorm);
      if (idx !== -1 && (hubData.users[idx].login_failures || 0) > 0) {
        hubData.users[idx].login_failures = 0;
        if (hubData.users[idx].hub_status === 'bloqueado') hubData.users[idx].hub_status = 'ativo';
        writeData(hubData);
      }
    } catch {}
    if (data.tipo === 'usuario') snapshotPermissoesSeNaoTiver(emailNorm, 'usuario');
    return res.json({ ok: true, token, tipo: data.tipo, nome: data.nome, sistemas: getUserSistemas(emailNorm, data.tipo, data.is_master) });
  } catch (err) {
    console.error('[auth/login proxy]', err);
    return res.status(502).json({ ok: false, erro: 'Serviço de autenticação indisponível.' });
  }
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

// Registra evento na jornada do usuario (login_hub, logout_hub,
// abrir_<sistemaId>, logout_<sistema>). Aceita JWT de admin ou usuario.
// Repassa para o backend de chamados que persiste em logs_admins/logs_usuarios.
app.post('/api/hub-log', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
    let payload;
    try { payload = jwt.verify(token, SSO_SECRET); } catch { return res.status(401).json({ ok: false, erro: 'Token inválido' }); }
    const email = (payload.email || '').trim().toLowerCase();
    const evento = (req.body && req.body.evento || '').trim().slice(0, 80);
    const detalhes = req.body && req.body.detalhes ? String(req.body.detalhes).slice(0, 240) : null;
    if (!email || !evento) return res.status(400).json({ ok: false, erro: 'evento obrigatorio' });
    const ip = (req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    // Fire-and-forget: nao bloqueia resposta. Falha do log nao quebra o fluxo.
    fetch(`${CHAMADOS_URL}/api/hub/log-evento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: JSON.stringify({ email, evento, ip, detalhes }),
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('[hub-log]', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno' });
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
    return res.json({ ok: true, sistemas: getUserSistemas(payload.email, payload.tipo, payload.is_master) });
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
  // Diff: para cada toggle de link gera um evento granular (liberar_link/bloquear_link).
  // Sob fail-closed, ausencia de entrada = nenhum acesso, entao antes vira [].
  const antes = data.permissions[email];
  const setAntes = new Set(Array.isArray(antes) ? antes : []);
  const setDepois = new Set(sistemas);
  const liberados = [...setDepois].filter(x => !setAntes.has(x));
  const bloqueados = [...setAntes].filter(x => !setDepois.has(x));
  const alvo = (data.users || []).find(u => u.email === email);
  const targetNome = (alvo && alvo.nome) || email;
  const sistemasMap = Object.fromEntries((data.sistemas || DEFAULT_SISTEMAS).map(s => [s.id, s.nome]));

  // CRITICO: grava a mudanca de permissao ANTES dos appendAudit.
  // appendAudit faz readData()+writeData() interno; se rodasse depois,
  // o writeData final SOBRESCREVERIA os audits acabados de gravar
  // (bug que zerava o historico de liberar/bloquear link).
  data.permissions[email] = sistemas;
  writeData(data);
  notifyUser(email, sistemas);

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
  const { nome, url, status, categoria, descricao, acessoPadrao } = req.body || {};
  if (!nome || !status) return res.status(400).json({ ok: false, erro: 'Nome e status são obrigatórios' });
  const data = readData();
  if (!Array.isArray(data.sistemas)) data.sistemas = JSON.parse(JSON.stringify(DEFAULT_SISTEMAS));
  const sistemas = data.sistemas;
  const id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (sistemas.find(s => s.id === id)) return res.status(409).json({ ok: false, erro: 'Já existe um sistema com esse nome' });
  const num = String(sistemas.length + 1).padStart(2, '0');
  const novo = { id, num, nome, url: url || '#', status, categoria: categoria || '', descricao: descricao || '', acessoPadrao: !!acessoPadrao };
  data.sistemas = [...sistemas, novo];
  data.permissions = data.permissions || {};
  if (acessoPadrao) autoAssociarTodos(data, id);
  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'criar', target_tipo: 'link',
    target_id: id, target_nome: nome,
    campos: { nome, url: url || '#', status, categoria: categoria || '', acessoPadrao: !!acessoPadrao },
  });
  res.json({ ok: true, sistema: novo });
});

app.put('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const { nome, url, status, categoria, descricao, acessoPadrao } = req.body || {};
  const data = readData();
  if (!Array.isArray(data.sistemas)) data.sistemas = JSON.parse(JSON.stringify(DEFAULT_SISTEMAS));
  const sistemas = data.sistemas;
  const idx = sistemas.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Sistema não encontrado' });
  const antes = { ...sistemas[idx] };
  sistemas[idx] = { ...sistemas[idx], ...(nome && { nome }), url: url !== undefined ? url : sistemas[idx].url, ...(status && { status }), categoria: categoria !== undefined ? categoria : sistemas[idx].categoria, descricao: descricao !== undefined ? descricao : sistemas[idx].descricao, acessoPadrao: acessoPadrao !== undefined ? !!acessoPadrao : !!sistemas[idx].acessoPadrao };
  data.sistemas = sistemas;
  if (acessoPadrao && !antes.acessoPadrao) autoAssociarTodos(data, req.params.id);
  writeData(data);
  // So loga campos efetivamente alterados
  const diff = {};
  for (const k of ['nome', 'url', 'status', 'categoria', 'descricao', 'acessoPadrao']) {
    if (antes[k] !== sistemas[idx][k]) diff[k] = sistemas[idx][k];
  }
  // Quando o unico campo alterado e' o status, deriva 'ativar' ou 'inativar'
  // para alinhar com a mesma convencao usada nos endpoints de admins/usuarios.
  // 'no-ar' = ativo; qualquer outro status (construcao/beta/concept) = inativo.
  const keys = Object.keys(diff);
  let action = 'editar';
  if (keys.length === 1 && keys[0] === 'status') {
    action = diff.status === 'no-ar' ? 'ativar' : 'inativar';
  }
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action, target_tipo: 'link',
    target_id: req.params.id, target_nome: sistemas[idx].nome,
    campos: diff,
  });
  res.json({ ok: true, sistema: sistemas[idx] });
});

app.delete('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const data = readData();
  if (!Array.isArray(data.sistemas)) data.sistemas = JSON.parse(JSON.stringify(DEFAULT_SISTEMAS));
  const sistemas = data.sistemas;
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

// ─── Proxy pesquisa-satisfacao (massoterapeutas) ────────────────────────────
async function proxyPesquisa(path, { method = 'GET', body = null } = {}) {
  try {
    const r = await fetch(`${PESQUISA_URL}/api/hub${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch (err) {
    console.error('[proxyPesquisa]', path, err.message);
    return { status: 502, data: { ok: false, erro: 'Pesquisa offline' } };
  }
}

app.get('/api/admin/massagistas', requireAdmin, async (_req, res) => {
  const r = await proxyPesquisa('/massagistas');
  res.status(r.status).json(r.data);
});
app.patch('/api/admin/massagistas/:id/ativo', requireAdmin, async (req, res) => {
  const r = await proxyPesquisa(`/massagistas/${encodeURIComponent(req.params.id)}/ativo`, {
    method: 'PATCH',
    body: req.body,
  });
  res.status(r.status).json(r.data);
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
  if (r.status === 200 && r.data && Array.isArray(r.data.usuarios)) {
    try {
      const hubData = readData();
      const hubUsers = hubData.users || [];
      r.data.usuarios = r.data.usuarios.map(u => {
        const hU = hubUsers.find(h => h.email === u.email);
        if (hU) {
          if (hU.hub_status) u.hub_status = hU.hub_status;
          u.login_failures = hU.login_failures || 0;
        }
        return u;
      });
    } catch {}
  }
  res.status(r.status).json(r.data);
});
app.post('/api/admin/chamados-usuarios', requireAdmin, async (req, res) => {
  const senhaTemp = _gerarSenhaForte();
  const body = { ...req.body, senha: senhaTemp };
  const r = await proxyChamados('/portal-usuarios', { method: 'POST', body });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'criar', target_tipo: 'usuario',
      target_id: r.data.id, target_nome: req.body && req.body.nome,
      campos: _campos(req.body),
    });
    const email = (req.body.email || '').trim().toLowerCase();
    const nome = (req.body.nome || '').trim();
    _registrarHubUsuario(email, nome, r.data.id, 'ativacao_pendente');
    const activation_url = _gerarLinkAtivacao(r.data.id, email, nome);
    return res.status(r.status).json({ ...r.data, activation_url, nome });
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
    if ('ativo' in diff) {
      const email = ((antes && antes.email) || '').trim().toLowerCase();
      if (email) {
        const hd = readData();
        if (!Array.isArray(hd.users)) hd.users = [];
        const idx = hd.users.findIndex(u => u.email === email);
        if (idx !== -1) {
          if (!diff.ativo && hd.users[idx].hub_status === 'ativo') {
            hd.users[idx].hub_status = 'desligado';
            writeData(hd);
          } else if (diff.ativo && hd.users[idx].hub_status === 'desligado') {
            hd.users[idx].hub_status = 'ativo';
            writeData(hd);
          }
        }
      }
    }
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
app.post('/api/admin/chamados-admins/:id/reset-link', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarAdminAlvo(id);
  const r = await proxyChamados(`/admins/${encodeURIComponent(id)}/reset-link`, { method: 'POST' });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'reset_link', target_tipo: 'admin',
      target_id: Number(id),
      target_nome: (antes && antes.nome_completo) || null,
      campos: { link_24h_enviado: true },
    });
  }
  res.status(r.status).json(r.data);
});
app.post('/api/admin/chamados-usuarios/:id/reset-link', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarUsuarioAlvo(id);
  const r = await proxyChamados(`/portal-usuarios/${encodeURIComponent(id)}/reset-link`, { method: 'POST' });
  if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) {
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'reset_link', target_tipo: 'usuario',
      target_id: Number(id),
      target_nome: (antes && antes.nome) || null,
      campos: { link_24h_enviado: true },
    });
  }
  res.status(r.status).json(r.data);
});
// Gera (ou regenera) link de ativação Hub-nativo para um usuário
app.post('/api/admin/chamados-usuarios/:id/gerar-link', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarUsuarioAlvo(id);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  const email = (antes.email || '').trim().toLowerCase();
  const nome = antes.nome || '';
  const activation_url = _gerarLinkAtivacao(Number(id), email, nome);
  _registrarHubUsuario(email, nome, Number(id), 'ativacao_pendente');
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'gerar_link_ativacao', target_tipo: 'usuario',
    target_id: Number(id), target_nome: nome,
    campos: { link_48h_gerado: true },
  });
  res.json({ ok: true, activation_url, nome });
});

// Desbloqueia usuário bloqueado por falhas de login
app.post('/api/admin/chamados-usuarios/:id/desbloquear', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const antes = await _buscarUsuarioAlvo(id);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  const email = (antes.email || '').trim().toLowerCase();
  const hubData = readData();
  if (!Array.isArray(hubData.users)) hubData.users = [];
  const idx = hubData.users.findIndex(u => u.email === email);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Registro de status não encontrado' });
  hubData.users[idx].hub_status = 'ativo';
  hubData.users[idx].login_failures = 0;
  writeData(hubData);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'desbloquear', target_tipo: 'usuario',
    target_id: Number(id), target_nome: antes.nome || null,
    campos: { hub_status: 'ativo' },
  });
  res.json({ ok: true });
});

app.get('/api/admin/chamados-admins/:id/logs', requireAdmin, async (req, res) => {
  const r = await proxyChamados(`/admins/${encodeURIComponent(req.params.id)}/logs`);
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
  if (!data.permissions) data.permissions = {};
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

// ─── Site permissions (Fase 1 do gerenciamento manual de cookies) ────────────

// Lista todas as permissoes por site (admin/usuario). Usado pelo painel
// de Links → popup → LIBERACAO no front. Ordenado por sistema_id, depois email.
app.get('/api/admin/site-permissions', requireAdmin, (_req, res) => {
  const dados = readData();
  const all = sitePerm.listarTodos(dados);
  all.sort((a, b) => (a.sistema_id + a.email).localeCompare(b.sistema_id + b.email));
  res.json({ ok: true, items: all });
});

// Define/troca o papel de um email num sistema (cria se nao existir).
app.post('/api/admin/site-permissions', requireAdmin, (req, res) => {
  const { email, sistema_id, papel } = req.body || {};
  if (!email || !sistema_id) return res.status(400).json({ ok: false, erro: 'email e sistema_id obrigatorios' });
  // papeis granulares so fazem sentido em pesquisa-satisfacao;
  // demais sites aceitam apenas admin/usuario.
  const granulares = ['master', 'spa', 'satisfacao', 'massoterapeuta'];
  if (!sitePerm.PAPEIS_VALIDOS.has(papel)) return res.status(400).json({ ok: false, erro: 'papel invalido' });
  if (granulares.includes(papel) && sistema_id !== 'pesquisa-satisfacao') {
    return res.status(400).json({ ok: false, erro: `papel '${papel}' so e' valido em pesquisa-satisfacao` });
  }
  const dados = readData();
  const r = sitePerm.setPapel(dados, email, sistema_id, papel);
  if (!r.ok) return res.status(400).json({ ok: false, erro: r.erro });
  writeData(dados);
  if (r.mudou) {
    // Notifica o usuario via SSE para refletir o novo acesso sem reload
    const emailNorm = sitePerm._norm(email);
    const tu = (dados.users || []).find(u => sitePerm._norm(u.email) === emailNorm) || {};
    notifyUser(emailNorm, getUserSistemas(emailNorm, tu.tipo || 'usuario', !!tu.is_master));
    const sistemasMap = Object.fromEntries((dados.sistemas || DEFAULT_SISTEMAS).map(s => [s.id, s.nome]));
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: papel === 'usuario' ? 'site_usuario_liberar' : 'site_admin_liberar',
      target_tipo: 'permissao', target_id: null,
      target_nome: emailNorm,
      campos: { email: emailNorm, link: sistemasMap[sistema_id] || sistema_id, papel, papel_anterior: r.anterior || null },
    });
  }
  res.json({ ok: true });
});

// Remove o papel de um email num sistema. Idempotente: 200 mesmo se nao existia.
app.delete('/api/admin/site-permissions', requireAdmin, (req, res) => {
  const email = req.query.email || (req.body && req.body.email);
  const sistema_id = req.query.sistema_id || (req.body && req.body.sistema_id);
  if (!email || !sistema_id) return res.status(400).json({ ok: false, erro: 'email e sistema_id obrigatorios' });
  const dados = readData();
  const r = sitePerm.removerPapel(dados, email, sistema_id);
  writeData(dados);
  if (r.mudou) {
    // Notifica o usuario via SSE para remover o painel sem reload
    const emailNorm = sitePerm._norm(email);
    const tu = (dados.users || []).find(u => sitePerm._norm(u.email) === emailNorm) || {};
    notifyUser(emailNorm, getUserSistemas(emailNorm, tu.tipo || 'usuario', !!tu.is_master));
    const sistemasMap = Object.fromEntries((dados.sistemas || DEFAULT_SISTEMAS).map(s => [s.id, s.nome]));
    appendAudit({
      by_email: req.hubUser.email, by_nome: req.hubUser.nome,
      action: 'site_acesso_remover', target_tipo: 'permissao', target_id: null,
      target_nome: emailNorm,
      campos: { email: emailNorm, link: sistemasMap[sistema_id] || sistema_id },
    });
  }
  res.json({ ok: true });
});

// Server-to-server: sistema satelite consulta o Hub para saber papeis de
// um email. Usado por ramais/pesquisa no /sso quando o JWT nao traz
// sites_admin (cliente antigo ou falha). Bearer SSO_SECRET.
// Lista dos emails com papel='admin' num sistema. Usado pelos sistemas
// sateligtes (ex: pesquisa-satisfacao) para mostrar a lista oficial de
// administradores que vem do Hub. Bearer SSO_SECRET.
// Item: { email, nome, ativo, ultimo_login, tipo }
// 'ativo' = email ja logou no Hub alguma vez (existe em data.users).
app.get('/api/hub/site-admins', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== SSO_SECRET) return res.status(403).json({ ok: false, erro: 'Acesso negado' });
  const sistema_id = (req.query.sistema_id || '').toString();
  if (!sistema_id) return res.status(400).json({ ok: false, erro: 'sistema_id obrigatorio' });
  const dados = readData();
  // Retorna TODO registro com papel != 'usuario' (admin, master, spa, satisfacao).
  // 'usuario' e' implicito (quem tem acesso ao link mas nao tem cookie admin) e
  // nao precisa ficar na lista. Bug anterior: filtrar so 'admin' fazia master/
  // spa/satisfacao sumirem da resposta apos troca de papel.
  const adminEmails = (dados.site_permissions || [])
    .filter(r => r.sistema_id === sistema_id && r.papel && r.papel !== 'usuario')
    .map(r => String(r.email || '').toLowerCase())
    .filter(Boolean);
  const usersMap = Object.fromEntries(
    (dados.users || []).map(u => [String(u.email || '').toLowerCase(), u])
  );
  // mapa { email -> papel } para enriquecer cada item com o role granular
  const papeisMap = Object.fromEntries(
    (dados.site_permissions || [])
      .filter(r => r.sistema_id === sistema_id)
      .map(r => [String(r.email || '').toLowerCase(), r.papel])
  );
  const items = adminEmails.map(email => {
    const u = usersMap[email];
    return {
      email,
      nome: u && u.nome ? u.nome : null,
      ativo: !!u,
      ultimo_login: u && u.ultimo_login ? u.ultimo_login : null,
      tipo: u && u.tipo ? u.tipo : null, // 'admin'|'usuario' do Hub
      is_master: u ? !!u.is_master : false,
      papel: papeisMap[email] || 'admin', // master|admin|spa|satisfacao|usuario
    };
  });
  res.json({ ok: true, items });
});

app.get('/api/hub/site-roles', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== SSO_SECRET) return res.status(403).json({ ok: false, erro: 'Acesso negado' });
  const email = (req.query.email || '').toString();
  if (!email) return res.status(400).json({ ok: false, erro: 'email obrigatorio' });
  const dados = readData();
  res.json({
    ok: true,
    sites_admin: sitePerm.sitesOndeEhAdmin(dados, email),
    sites_usuario: sitePerm.sitesUsuario(dados, email),
  });
});

// ─── Feriados (CRUD) ─────────────────────────────────────────────────────────

const FERIADOS_TIPOS = new Set(['nacional', 'estadual', 'municipal', 'interno']);

app.get('/api/admin/feriados', requireAdmin, (req, res) => {
  const data = readData();
  let feriados = Array.isArray(data.feriados) ? data.feriados : [];
  const ano = req.query.ano ? parseInt(req.query.ano, 10) : null;
  if (ano) feriados = feriados.filter(f => f.data && f.data.startsWith(String(ano)));
  feriados = feriados.slice().sort((a, b) => a.data.localeCompare(b.data));
  res.json({ ok: true, feriados });
});

app.post('/api/admin/feriados', requireAdmin, (req, res) => {
  const { data: dataFeriado, nome, tipo } = req.body || {};
  if (!dataFeriado || !nome) return res.status(400).json({ ok: false, erro: 'data e nome obrigatórios' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFeriado)) return res.status(400).json({ ok: false, erro: 'data inválida (YYYY-MM-DD)' });
  if (tipo && !FERIADOS_TIPOS.has(tipo)) return res.status(400).json({ ok: false, erro: 'tipo inválido' });
  const data = readData();
  if (!Array.isArray(data.feriados)) data.feriados = [];
  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const feriado = { id, data: dataFeriado, nome: nome.trim(), tipo: tipo || 'nacional' };
  data.feriados.push(feriado);
  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'criar', target_tipo: 'feriado',
    target_id: id, target_nome: nome.trim(),
    campos: { data: dataFeriado, tipo: tipo || 'nacional' },
  });
  res.json({ ok: true, feriado });
});

app.put('/api/admin/feriados/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { data: dataFeriado, nome, tipo } = req.body || {};
  if (!dataFeriado || !nome) return res.status(400).json({ ok: false, erro: 'data e nome obrigatórios' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFeriado)) return res.status(400).json({ ok: false, erro: 'data inválida (YYYY-MM-DD)' });
  if (tipo && !FERIADOS_TIPOS.has(tipo)) return res.status(400).json({ ok: false, erro: 'tipo inválido' });
  const data = readData();
  if (!Array.isArray(data.feriados)) return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
  const idx = data.feriados.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
  data.feriados[idx] = { ...data.feriados[idx], data: dataFeriado, nome: nome.trim(), tipo: tipo || data.feriados[idx].tipo || 'nacional' };
  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'editar', target_tipo: 'feriado',
    target_id: id, target_nome: nome.trim(),
    campos: { data: dataFeriado, tipo: tipo || 'nacional' },
  });
  res.json({ ok: true, feriado: data.feriados[idx] });
});

app.delete('/api/admin/feriados/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  if (!Array.isArray(data.feriados)) return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
  const idx = data.feriados.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
  const [removed] = data.feriados.splice(idx, 1);
  writeData(data);
  appendAudit({
    by_email: req.hubUser.email, by_nome: req.hubUser.nome,
    action: 'excluir', target_tipo: 'feriado',
    target_id: id, target_nome: removed.nome,
    campos: {},
  });
  res.json({ ok: true });
});

// ─── Tipos de Ausência (CRUD) ────────────────────────────────────────────────

app.get('/api/admin/ausencias', requireAdmin, (req, res) => {
  const data = readData();
  const ausencias = Array.isArray(data.ausencias) ? data.ausencias : [];
  res.json({ ok: true, ausencias: ausencias.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')) });
});

app.post('/api/admin/ausencias', requireAdmin, (req, res) => {
  const { nome, sigla } = req.body || {};
  if (!nome || !sigla) return res.status(400).json({ ok: false, erro: 'nome e sigla obrigatórios' });
  if (!/^[A-Za-zÀ-ÿ0-9]{1,4}$/.test(sigla.trim())) return res.status(400).json({ ok: false, erro: 'sigla inválida (1–4 caracteres alfanuméricos)' });
  const data = readData();
  if (!Array.isArray(data.ausencias)) data.ausencias = [];
  const siglaUp = sigla.trim().toUpperCase();
  if (data.ausencias.some(a => a.sigla === siglaUp)) return res.status(409).json({ ok: false, erro: 'Já existe um tipo com esta sigla' });
  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const ausencia = { id, nome: nome.trim(), sigla: siglaUp };
  data.ausencias.push(ausencia);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'criar', target_tipo: 'ausencia', target_id: id, target_nome: nome.trim(), campos: { sigla: siglaUp } });
  res.json({ ok: true, ausencia });
});

app.put('/api/admin/ausencias/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { nome, sigla } = req.body || {};
  if (!nome || !sigla) return res.status(400).json({ ok: false, erro: 'nome e sigla obrigatórios' });
  if (!/^[A-Za-zÀ-ÿ0-9]{1,4}$/.test(sigla.trim())) return res.status(400).json({ ok: false, erro: 'sigla inválida (1–4 caracteres alfanuméricos)' });
  const data = readData();
  if (!Array.isArray(data.ausencias)) return res.status(404).json({ ok: false, erro: 'Tipo não encontrado' });
  const idx = data.ausencias.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Tipo não encontrado' });
  const siglaUp = sigla.trim().toUpperCase();
  if (data.ausencias.some((a, i) => a.sigla === siglaUp && i !== idx)) return res.status(409).json({ ok: false, erro: 'Já existe um tipo com esta sigla' });
  data.ausencias[idx] = { ...data.ausencias[idx], nome: nome.trim(), sigla: siglaUp };
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'editar', target_tipo: 'ausencia', target_id: id, target_nome: nome.trim(), campos: { sigla: siglaUp } });
  res.json({ ok: true, ausencia: data.ausencias[idx] });
});

app.delete('/api/admin/ausencias/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  if (!Array.isArray(data.ausencias)) return res.status(404).json({ ok: false, erro: 'Tipo não encontrado' });
  const idx = data.ausencias.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Tipo não encontrado' });
  const [removed] = data.ausencias.splice(idx, 1);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'excluir', target_tipo: 'ausencia', target_id: id, target_nome: removed.nome, campos: {} });
  res.json({ ok: true });
});


// ─── Categorias de UH (CRUD) ─────────────────────────────────────────────────

app.get('/api/admin/categorias-uh', requireAdmin, (req, res) => {
  const data = readData();
  const cats = Array.isArray(data.categorias_uh) ? data.categorias_uh : [];
  res.json({ ok: true, categorias: cats.slice().sort((a, b) => (a.sigla || '').localeCompare(b.sigla || '')) });
});

app.post('/api/admin/categorias-uh', requireAdmin, (req, res) => {
  const { sigla, nome, cor } = req.body || {};
  if (!sigla || !nome) return res.status(400).json({ ok: false, erro: 'sigla e nome obrigatórios' });
  const data = readData();
  if (!Array.isArray(data.categorias_uh)) data.categorias_uh = [];
  const siglaUp = sigla.trim().toUpperCase();
  if (data.categorias_uh.some(c => c.sigla === siglaUp)) return res.status(409).json({ ok: false, erro: 'Sigla já existe' });
  const cat = { id: siglaUp, sigla: siglaUp, nome: nome.trim(), cor: (cor || '#666666').trim() };
  data.categorias_uh.push(cat);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'criar', target_tipo: 'categoria_uh', target_id: siglaUp, target_nome: nome.trim(), campos: { sigla: siglaUp, cor: cat.cor } });
  res.json({ ok: true, categoria: cat });
});

app.put('/api/admin/categorias-uh/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { nome, cor } = req.body || {};
  if (!nome) return res.status(400).json({ ok: false, erro: 'nome obrigatório' });
  const data = readData();
  if (!Array.isArray(data.categorias_uh)) return res.status(404).json({ ok: false, erro: 'Não encontrado' });
  const idx = data.categorias_uh.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Não encontrado' });
  const before = { ...data.categorias_uh[idx] };
  data.categorias_uh[idx] = { ...data.categorias_uh[idx], nome: nome.trim(), cor: cor ? cor.trim() : data.categorias_uh[idx].cor };
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'editar', target_tipo: 'categoria_uh', target_id: id, target_nome: nome.trim(), campos: _diff(before, data.categorias_uh[idx]) });
  res.json({ ok: true, categoria: data.categorias_uh[idx] });
});

app.delete('/api/admin/categorias-uh/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  if (!Array.isArray(data.categorias_uh)) return res.status(404).json({ ok: false, erro: 'Não encontrado' });
  const idx = data.categorias_uh.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Não encontrado' });
  const [removed] = data.categorias_uh.splice(idx, 1);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'excluir', target_tipo: 'categoria_uh', target_id: id, target_nome: removed.nome, campos: {} });
  res.json({ ok: true });
});


// ─── UHs — Unidades Habitacionais (CRUD) ─────────────────────────────────────

app.get('/api/admin/uhs', requireAdmin, (req, res) => {
  const data = readData();
  const uhs = Array.isArray(data.uhs) ? data.uhs : [];
  res.json({ ok: true, uhs });
});

app.post('/api/admin/uhs', requireAdmin, (req, res) => {
  const { numero, categoria_id, leito, banheiro, gran_class, vista, varanda, adaptado, obs } = req.body || {};
  if (!numero) return res.status(400).json({ ok: false, erro: 'número obrigatório' });
  const data = readData();
  if (!Array.isArray(data.uhs)) data.uhs = [];
  const num = numero.trim();
  if (data.uhs.some(u => u.id === num)) return res.status(409).json({ ok: false, erro: 'UH já existe' });
  const uh = { id: num, numero: num, categoria_id: categoria_id || '', leito: leito || '', banheiro: banheiro || '', gran_class: !!gran_class, vista: vista || '', varanda: !!varanda, adaptado: !!adaptado, obs: (obs || '').trim() };
  data.uhs.push(uh);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'criar', target_tipo: 'uh', target_id: num, target_nome: num, campos: uh });
  res.json({ ok: true, uh });
});

app.put('/api/admin/uhs/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const data = readData();
  if (!Array.isArray(data.uhs)) return res.status(404).json({ ok: false, erro: 'UH não encontrada' });
  const idx = data.uhs.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'UH não encontrada' });
  const before = { ...data.uhs[idx] };
  const fields = ['categoria_id', 'leito', 'banheiro', 'vista', 'obs'];
  const bools  = ['gran_class', 'varanda', 'adaptado'];
  const upd = { ...before };
  fields.forEach(f => { if (body[f] !== undefined) upd[f] = (body[f] || '').toString().trim(); });
  bools.forEach(f => { if (body[f] !== undefined) upd[f] = !!body[f]; });
  data.uhs[idx] = upd;
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'editar', target_tipo: 'uh', target_id: id, target_nome: id, campos: _diff(before, upd) });
  res.json({ ok: true, uh: upd });
});

app.delete('/api/admin/uhs/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const data = readData();
  if (!Array.isArray(data.uhs)) return res.status(404).json({ ok: false, erro: 'UH não encontrada' });
  const idx = data.uhs.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'UH não encontrada' });
  data.uhs.splice(idx, 1);
  writeData(data);
  appendAudit({ by_email: req.hubUser.email, by_nome: req.hubUser.nome, action: 'excluir', target_tipo: 'uh', target_id: id, target_nome: id, campos: {} });
  res.json({ ok: true });
});


// Página de ativação de conta — servida antes do catch-all SPA.
app.get('/ativar', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'ativar.html')));

// ─── Static fallback ─────────────────────────────────────────────────────────

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Garante que hub_data.json sempre tem a chave 'sistemas' antes de servir.
// Impede que um login apos arquivo corrompido/ausente salve sem sistemas.
(function initSistemas() {
  try {
    const data = readData();
    if (!Array.isArray(data.sistemas)) {
      data.sistemas = JSON.parse(JSON.stringify(DEFAULT_SISTEMAS));
      writeData(data);
      console.log('[init] sistemas inicializados com DEFAULT_SISTEMAS');
    }
  } catch (e) {
    console.error('[init] falha ao inicializar sistemas:', e.message);
  }
}());

_sanitizarAuditLog();

(function _patchSpaDescricao() {
  try {
    const data = readData();
    if (!Array.isArray(data.sistemas)) return;
    const spa = data.sistemas.find(s => s.id === 'pesquisa-satisfacao');
    if (!spa) return;
    if (spa.descricao === 'Gestão de atendimentos, escalas de profissionais, anamnese digital e auditoria de satisfação do Gran Spa.') return;
    spa.descricao = 'Gestão de atendimentos, escalas de profissionais, anamnese digital e auditoria de satisfação do Gran Spa.';
    writeData(data);
    console.log('[init] descricao pesquisa-satisfacao atualizada');
  } catch (e) {
    console.error('[init] falha ao patchear descricao spa:', e.message);
  }
}());

(function initFeriados() {
  try {
    const data = readData();
    if (Array.isArray(data.feriados) && data.feriados.length > 0) return;
    const SEED = [
      // 2026 — fixos
      { data: '2026-01-01', nome: 'Ano Novo', tipo: 'nacional' },
      { data: '2026-02-16', nome: 'Segunda-feira de Carnaval', tipo: 'municipal' },
      { data: '2026-02-17', nome: 'Terça-feira de Carnaval', tipo: 'municipal' },
      { data: '2026-03-19', nome: 'São José', tipo: 'estadual' },
      { data: '2026-03-25', nome: 'Data Magna do Ceará', tipo: 'estadual' },
      { data: '2026-04-03', nome: 'Sexta-feira Santa', tipo: 'nacional' },
      { data: '2026-04-13', nome: 'Aniversário 300 anos de Fortaleza', tipo: 'municipal' },
      { data: '2026-04-21', nome: 'Tiradentes', tipo: 'nacional' },
      { data: '2026-05-01', nome: 'Dia do Trabalho', tipo: 'nacional' },
      { data: '2026-06-04', nome: 'Corpus Christi', tipo: 'municipal' },
      { data: '2026-08-15', nome: 'Nossa Senhora da Assunção', tipo: 'municipal' },
      { data: '2026-09-07', nome: 'Independência do Brasil', tipo: 'nacional' },
      { data: '2026-10-12', nome: 'Nossa Senhora Aparecida', tipo: 'nacional' },
      { data: '2026-11-02', nome: 'Finados', tipo: 'nacional' },
      { data: '2026-11-15', nome: 'Proclamação da República', tipo: 'nacional' },
      { data: '2026-11-20', nome: 'Consciência Negra', tipo: 'nacional' },
      { data: '2026-12-25', nome: 'Natal', tipo: 'nacional' },
      // 2027 — fixos + móveis
      { data: '2027-01-01', nome: 'Ano Novo', tipo: 'nacional' },
      { data: '2027-02-08', nome: 'Segunda-feira de Carnaval', tipo: 'municipal' },
      { data: '2027-02-09', nome: 'Terça-feira de Carnaval', tipo: 'municipal' },
      { data: '2027-03-19', nome: 'São José', tipo: 'estadual' },
      { data: '2027-03-25', nome: 'Data Magna do Ceará', tipo: 'estadual' },
      { data: '2027-03-26', nome: 'Sexta-feira Santa', tipo: 'nacional' },
      { data: '2027-04-21', nome: 'Tiradentes', tipo: 'nacional' },
      { data: '2027-05-01', nome: 'Dia do Trabalho', tipo: 'nacional' },
      { data: '2027-05-27', nome: 'Corpus Christi', tipo: 'municipal' },
      { data: '2027-08-15', nome: 'Nossa Senhora da Assunção', tipo: 'municipal' },
      { data: '2027-09-07', nome: 'Independência do Brasil', tipo: 'nacional' },
      { data: '2027-10-12', nome: 'Nossa Senhora Aparecida', tipo: 'nacional' },
      { data: '2027-11-02', nome: 'Finados', tipo: 'nacional' },
      { data: '2027-11-15', nome: 'Proclamação da República', tipo: 'nacional' },
      { data: '2027-11-20', nome: 'Consciência Negra', tipo: 'nacional' },
      { data: '2027-12-25', nome: 'Natal', tipo: 'nacional' },
    ];
    data.feriados = SEED.map((f, i) => ({
      id: (Date.now() + i) + '_' + Math.random().toString(36).slice(2, 8),
      ...f,
    }));
    writeData(data);
    console.log('[init] feriados inicializados com seed 2026-2027');
  } catch (e) {
    console.error('[init] falha ao inicializar feriados:', e.message);
  }
}());

(function initAusencias() {
  try {
    const data = readData();
    if (Array.isArray(data.ausencias) && data.ausencias.length > 0) return;
    const SEED = [
      { nome: 'Feriados', sigla: 'FE' },
      { nome: 'Atestado Médico', sigla: 'AT' },
      { nome: 'Compensação Hora', sigla: 'CH' },
      { nome: 'Comp. Feriado', sigla: 'CF' },
      { nome: 'Folga', sigla: 'X' },
      { nome: 'Falta', sigla: 'F' },
      { nome: 'Licença Casamento', sigla: 'LC' },
      { nome: 'Licença Sindical', sigla: 'LS' },
    ];
    data.ausencias = SEED.map((a, i) => ({
      id: (Date.now() + i) + '_' + Math.random().toString(36).slice(2, 8),
      ...a,
    }));
    writeData(data);
    console.log('[init] ausencias inicializadas com seed');
  } catch (e) {
    console.error('[init] falha ao inicializar ausencias:', e.message);
  }
}());

(function initCategoriasUH() {
  try {
    const data = readData();
    if (Array.isArray(data.categorias_uh) && data.categorias_uh.length > 0) return;
    const SEED = [
      { sigla: 'EXE',  nome: 'Suite Executiva',           cor: '#4A7C59' },
      { sigla: 'GJR',  nome: 'Gran Junior',                cor: '#2E86AB' },
      { sigla: 'GLXD', nome: 'Gran Luxo Double',           cor: '#7B2D8B' },
      { sigla: 'GSPD', nome: 'Gran Superior Double',       cor: '#1A6B3C' },
      { sigla: 'GSPT', nome: 'Gran Superior Twin',         cor: '#16A085' },
      { sigla: 'GSTD', nome: 'Gran Studio',                cor: '#C0392B' },
      { sigla: 'GSTR', nome: 'Gran Superior Triplo',       cor: '#D35400' },
      { sigla: 'GSDA', nome: 'Gran Sup. DBL Adaptado',     cor: '#1565C0' },
      { sigla: 'GSTT', nome: 'Gran Studio Twin',           cor: '#E74C3C' },
      { sigla: 'JR',   nome: 'Junior',                     cor: '#5BA4CF' },
      { sigla: 'JRT',  nome: 'Junior Twin',                cor: '#3D7AB5' },
      { sigla: 'LXD',  nome: 'Luxo Double',                cor: '#9B59B6' },
      { sigla: 'LXT',  nome: 'Luxo Twin',                  cor: '#BB77D0' },
      { sigla: 'MAR',  nome: 'Suite Marquise',             cor: '#8B6914' },
      { sigla: 'PRE',  nome: 'Suite Presidencial',         cor: '#D4AF37' },
      { sigla: 'SPD',  nome: 'Superior Double',            cor: '#27AE60' },
      { sigla: 'SPDA', nome: 'Sup. Double Adaptado',       cor: '#2980B9' },
      { sigla: 'SPT',  nome: 'Superior Twin',              cor: '#1ABC9C' },
      { sigla: 'SPTA', nome: 'Sup. Twin Adaptado',         cor: '#3498DB' },
      { sigla: 'STDF', nome: 'Studio Familia',             cor: '#E67E22' },
      { sigla: 'STR',  nome: 'Superior Triplo',            cor: '#CA6F1E' },
      { sigla: 'STT',  nome: 'Studio Twin',                cor: '#FF8C42' },
    ];
    data.categorias_uh = SEED.map(c => ({ id: c.sigla, ...c }));
    writeData(data);
    console.log('[init] categorias_uh inicializadas com seed');
  } catch (e) {
    console.error('[init] falha ao inicializar categorias_uh:', e.message);
  }
}());

(function initUHs() {
  try {
    const data = readData();
    if (Array.isArray(data.uhs) && data.uhs.length > 0) return;
    // Compact seed: [numero, cat, leito, ban, gc, varanda, adaptado, obs]
    const RAW = [
      // Andar 18 — GC completo (14 UHs)
      ['1801','GSTT','TWIN','BA',1,0,0,''],
      ['1802/03/04/05','PRE','KING','HIDRO',1,0,0,'Suite Presidencial'],
      ['1806','GSPD','KING','BX',1,0,0,''],['1807','GSPD','KING','BX',1,0,0,''],
      ['1808','GSPD','KING','BX',1,0,0,''],['1809','GSPD','KING','BX',1,0,0,''],
      ['1810','GSPD','KING','BX',1,0,0,''],['1811','GSPD','KING','BX',1,0,0,''],
      ['1812','GSPD','KING','BX',1,0,0,''],['1813','GSPD','KING','BX',1,0,0,''],
      ['1814','GSPD','KING','BX',1,0,0,''],['1815','GSPD','KING','BX',1,0,0,''],
      ['1816','GSPD','KING','BX',1,0,0,''],['1817','GSTR','TPL','BX',1,0,0,''],
      // Andar 17 — GC completo (15 UHs)
      ['1701','GSTD','KING','BA',1,0,0,''],['1702','GLXD','KING','BA',1,0,0,''],
      ['1703/04/05','MAR','KING','HIDRO',1,0,0,'Suite Marquise'],
      ['1706','GSPD','KING','BX',1,0,0,''],['1707','GSPD','KING','BX',1,0,0,''],
      ['1708','GSPD','KING','BX',1,0,0,''],['1709','GSPT','TWIN','BX',1,0,0,''],
      ['1710','GSPD','KING','BX',1,0,0,''],['1711','GSPT','TWIN','BX',1,0,0,''],
      ['1712','GSPD','KING','BX',1,0,0,''],['1713','GSPD','KING','BX',1,0,0,''],
      ['1714','GSPD','KING','BX',1,0,0,''],['1715','GSPT','TWIN','BX',1,0,0,''],
      ['1716','GSPD','KING','BX',1,0,0,''],['1717','GSTR','TPL','BX',1,0,0,''],
      // Andar 16 — GC completo (16 UHs)
      ['1601','GSTD','KING','BA',1,0,0,''],['1602/03','EXE','KING','BA',1,0,0,''],
      ['1604','GLXD','KING','BA',1,0,0,''],['1605','GJR','KING','BA',1,0,0,''],
      ['1606','GSPD','KING','BA',1,0,0,''],['1607','GSPD','KING','BA',1,0,0,''],
      ['1608','GSDA','KING','BX',1,0,1,'Adaptado necessidades especiais'],
      ['1609','GSPD','KING','BX',1,0,0,''],['1610','GSPD','KING','BA',1,0,0,''],
      ['1611','GSPD','KING','BA',1,0,0,''],['1612','GSPD','KING','BA',1,0,0,''],
      ['1613','GSPD','KING','BX',1,0,0,''],['1614','GSPD','KING','BA',1,0,0,''],
      ['1615','GSPD','KING','BA',1,0,0,''],['1616','GSPD','KING','BX',1,0,0,''],
      ['1617','GSTR','TPL','BA',1,0,0,''],
      // Andar 15 — GC parcial 01-05 (16 UHs)
      ['1501','GSTD','KING','BA',1,0,0,''],['1502/03','EXE','KING','BA',1,0,0,''],
      ['1504','GLXD','KING','BA',1,0,0,''],['1505','GJR','KING','BA',1,0,0,''],
      ['1506','SPT','TWIN','BX',0,0,0,''],['1507','SPD','KING','BA',0,0,0,''],
      ['1508','SPTA','KING','BX',0,0,1,'Adaptado necessidades especiais'],
      ['1509','SPT','TWIN','BX',0,0,0,''],['1510','SPD','KING','BA',0,0,0,''],
      ['1511','SPD','KING','BX',0,0,0,''],['1512','SPD','KING','BA',0,0,0,''],
      ['1513','SPD','KING','BX',0,0,0,''],['1514','SPD','KING','BA',0,0,0,''],
      ['1515','SPD','KING','BX',0,0,0,''],['1516','SPD','KING','BX',0,0,0,''],
      ['1517','STR','TPL','BA',0,0,0,''],
      // Andar 14 — GC parcial 01-05 (16 UHs)
      ['1401','GSTD','KING','BA',1,0,0,''],['1402/03','EXE','KING','BA',1,0,0,''],
      ['1404','GLXD','KING','BA',1,0,0,''],['1405','GJR','KING','BA',1,0,0,''],
      ['1406','SPT','TWIN','BX',0,0,0,''],['1407','SPD','KING','BA',0,0,0,''],
      ['1408','SPDA','TWIN','BX',0,0,1,'Adaptado necessidades especiais'],
      ['1409','SPT','TWIN','BX',0,0,0,''],['1410','SPD','KING','BA',0,0,0,''],
      ['1411','SPD','KING','BX',0,0,0,''],['1412','SPD','KING','BA',0,0,0,''],
      ['1413','SPD','KING','BX',0,0,0,''],['1414','SPD','KING','BA',0,0,0,''],
      ['1415','SPD','KING','BX',0,0,0,''],['1416','SPD','KING','BX',0,0,0,''],
      ['1417','STR','TPL','BA',0,0,0,''],
      // Andar 13 (17 UHs)
      ['1301','STDF','QUEEN','BA',0,0,0,''],['1302','LXT','TWIN','BA',0,0,0,''],
      ['1303','LXD','KING','BA',0,0,0,''],['1304','LXD','KING','BX',0,0,0,''],
      ['1305','JR','KING','BA',0,0,0,''],['1306','SPT','TWIN','BX',0,0,0,''],
      ['1307','SPD','KING','BA',0,0,0,''],['1308','SPD','KING','BX',0,0,0,''],
      ['1309','SPT','TWIN','BX',0,0,0,''],['1310','SPD','KING','BA',0,0,0,''],
      ['1311','SPT','TWIN','BX',0,0,0,''],['1312','SPD','KING','BA',0,0,0,''],
      ['1313','SPT','TWIN','BX',0,0,0,''],['1314','SPD','KING','BA',0,0,0,''],
      ['1315','SPT','TWIN','BX',0,0,0,''],['1316','SPD','KING','BX',0,0,0,''],
      ['1317','STR','TPL','BA',0,0,0,''],
      // Andar 12 (17 UHs)
      ['1201','STDF','QUEEN','BA',0,0,0,''],['1202','LXT','TWIN','BX',0,0,0,''],
      ['1203','LXD','KING','BX',0,0,0,''],['1204','LXD','KING','BX',0,0,0,''],
      ['1205','JR','KING','BA',0,0,0,''],['1206','SPD','KING','BX',0,0,0,''],
      ['1207','SPD','KING','BX',0,0,0,''],['1208','SPD','KING','BX',0,0,0,''],
      ['1209','SPD','KING','BX',0,0,0,''],['1210','SPD','KING','BX',0,0,0,''],
      ['1211','SPD','KING','BX',0,0,0,''],['1212','SPD','KING','BX',0,0,0,''],
      ['1213','SPD','KING','BX',0,0,0,''],['1214','SPD','KING','BX',0,0,0,''],
      ['1215','SPD','KING','BX',0,0,0,''],['1216','SPD','KING','BX',0,0,0,''],
      ['1217','STR','TPL','BX',0,0,0,''],
      // Andar 11 — 100% TWIN (17 UHs)
      ['1101','STT','TWIN','BA',0,0,0,''],['1102','LXT','TWIN','BX',0,0,0,''],
      ['1103','LXT','TWIN','BX',0,0,0,''],['1104','LXT','TWIN','BX',0,0,0,''],
      ['1105','JRT','TWIN','BA',0,0,0,''],['1106','SPT','TWIN','BX',0,0,0,''],
      ['1107','SPT','TWIN','BX',0,0,0,''],['1108','SPT','TWIN','BX',0,0,0,''],
      ['1109','SPT','TWIN','BX',0,0,0,''],['1110','SPT','TWIN','BX',0,0,0,''],
      ['1111','SPT','TWIN','BX',0,0,0,''],['1112','SPT','TWIN','BX',0,0,0,''],
      ['1113','SPT','TWIN','BX',0,0,0,''],['1114','SPT','TWIN','BX',0,0,0,''],
      ['1115','SPT','TWIN','BX',0,0,0,''],['1116','SPT','TWIN','BX',0,0,0,''],
      ['1117','STR','TPL','BX',0,0,0,''],
      // Andar 10 (17 UHs)
      ['1001','STDF','QUEEN','BX',0,0,0,''],['1002','LXT','TWIN','BX',0,0,0,''],
      ['1003','LXD','KING','BX',0,0,0,''],['1004','LXD','KING','BX',0,0,0,''],
      ['1005','JR','KING','BX',0,0,0,''],['1006','SPT','TWIN','BX',0,0,0,''],
      ['1007','SPD','KING','BX',0,0,0,''],['1008','SPD','KING','BX',0,0,0,''],
      ['1009','SPT','TWIN','BX',0,0,0,''],['1010','SPD','KING','BX',0,0,0,''],
      ['1011','SPT','TWIN','BX',0,0,0,''],['1012','SPD','KING','BX',0,0,0,''],
      ['1013','SPT','TWIN','BX',0,0,0,''],['1014','SPD','KING','BX',0,0,0,''],
      ['1015','SPT','TWIN','BX',0,0,0,''],['1016','SPD','KING','BX',0,0,0,''],
      ['1017','STR','TPL','BX',0,0,0,''],
      // Andar 9 (17 UHs)
      ['901','STDF','QUEEN','BX',0,0,0,''],['902','LXD','KING','BX',0,0,0,''],
      ['903','LXD','KING','BX',0,1,0,'Varanda'],['904','LXD','KING','BX',0,0,0,''],
      ['905','JR','KING','BX',0,0,0,''],['906','SPD','KING','BX',0,0,0,''],
      ['907','SPD','KING','BX',0,0,0,''],['908','SPD','KING','BX',0,0,0,''],
      ['909','SPD','KING','BX',0,0,0,''],['910','SPD','KING','BX',0,0,0,''],
      ['911','SPD','KING','BX',0,0,0,''],['912','SPD','KING','BX',0,0,0,''],
      ['913','SPD','KING','BX',0,0,0,''],['914','SPD','KING','BX',0,0,0,''],
      ['915','SPD','KING','BX',0,0,0,''],['916','SPD','KING','BX',0,0,0,''],
      ['917','STR','TPL','BX',0,0,0,''],
      // Andar 8 (17 UHs)
      ['801','STDF','QUEEN','BA',0,0,0,''],['802','LXD','KING','BX',0,0,0,''],
      ['803','LXD','KING','BX',0,0,0,''],['804','LXD','KING','BX',0,0,0,''],
      ['805','JR','KING','BA',0,0,0,''],['806','SPT','TWIN','BX',0,0,0,''],
      ['807','SPD','KING','BX',0,0,0,''],['808','SPD','KING','BX',0,0,0,''],
      ['809','SPT','TWIN','BX',0,0,0,''],['810','SPD','KING','BX',0,0,0,''],
      ['811','SPT','TWIN','BX',0,0,0,''],['812','SPD','KING','BX',0,0,0,''],
      ['813','SPT','TWIN','BX',0,0,0,''],['814','SPD','KING','BX',0,0,0,''],
      ['815','SPT','TWIN','BX',0,0,0,''],['816','SPD','KING','BX',0,0,0,''],
      ['817','STR','TPL','BX',0,0,0,''],
      // Andar 7 (17 UHs — varandas 01-05)
      ['701','STDF','QUEEN','BX',0,1,0,'Varanda'],['702','LXD','KING','BX',0,0,0,''],
      ['703','LXD','KING','BX',0,1,0,'Varanda'],['704','LXD','KING','BX',0,0,0,''],
      ['705','JR','KING','BA',0,1,0,'Varanda'],['706','SPT','TWIN','BX',0,0,0,''],
      ['707','SPD','KING','BX',0,0,0,''],['708','SPD','KING','BX',0,0,0,''],
      ['709','SPT','TWIN','BX',0,0,0,''],['710','SPD','KING','BX',0,0,0,''],
      ['711','SPT','TWIN','BX',0,0,0,''],['712','SPD','KING','BX',0,0,0,''],
      ['713','SPT','TWIN','BX',0,0,0,''],['714','SPD','KING','BX',0,0,0,''],
      ['715','SPT','TWIN','BX',0,0,0,''],['716','SPD','KING','BX',0,0,0,''],
      ['717','STR','TPL','BX',0,0,0,''],
      // Andar 6 (17 UHs — varandas 01-05)
      ['601','STDF','QUEEN','BA',0,1,0,'Varanda'],['602','LXD','KING','BX',0,0,0,''],
      ['603','LXD','KING','BX',0,0,0,''],['604','LXD','KING','BX',0,0,0,''],
      ['605','JR','KING','BX',0,1,0,'Varanda'],['606','SPT','TWIN','BX',0,0,0,''],
      ['607','SPD','KING','BX',0,0,0,''],['608','SPD','KING','BX',0,0,0,''],
      ['609','SPT','TWIN','BX',0,0,0,''],['610','SPD','KING','BX',0,0,0,''],
      ['611','SPT','TWIN','BX',0,0,0,''],['612','SPD','KING','BX',0,0,0,''],
      ['613','SPT','TWIN','BX',0,0,0,''],['614','SPD','KING','BX',0,0,0,''],
      ['615','SPT','TWIN','BX',0,0,0,''],['616','SPD','KING','BX',0,0,0,''],
      ['617','STR','TPL','BX',0,0,0,''],
      // Andar 5 (17 UHs — varandas 01-05)
      ['501','STDF','QUEEN','BA',0,1,0,'Varanda'],['502','LXD','KING','BX',0,1,0,'Varanda'],
      ['503','LXD','KING','BX',0,1,0,'Varanda'],['504','LXD','KING','BX',0,1,0,'Varanda'],
      ['505','JR','KING','BA',0,1,0,'Varanda'],['506','SPT','TWIN','BX',0,0,0,''],
      ['507','SPD','KING','BX',0,0,0,''],['508','SPD','KING','BX',0,0,0,''],
      ['509','SPT','TWIN','BX',0,0,0,''],['510','SPD','KING','BX',0,0,0,''],
      ['511','SPT','TWIN','BX',0,0,0,''],['512','SPD','KING','BX',0,0,0,''],
      ['513','SPT','TWIN','BX',0,0,0,''],['514','SPD','KING','BX',0,0,0,''],
      ['515','SPT','TWIN','BX',0,0,0,''],['516','SPD','KING','BX',0,0,0,''],
      ['517','STR','TPL','BX',0,0,0,''],
    ];
    data.uhs = RAW.map(([numero, categoria_id, leito, banheiro, gc, varanda, adaptado, obs]) => ({
      id: numero,
      numero,
      categoria_id,
      leito,
      banheiro,
      gran_class: !!gc,
      vista: '',
      varanda: !!varanda,
      adaptado: !!adaptado,
      obs,
    }));
    writeData(data);
    console.log(`[init] ${data.uhs.length} UHs inicializadas com seed`);
  } catch (e) {
    console.error('[init] falha ao inicializar uhs:', e.message);
  }
}());


(function migrarVistaUHs() {
  try {
    const data = readData();
    if (!Array.isArray(data.uhs)) return;
    let changed = 0;
    data.uhs.forEach(u => {
      const slot = parseInt(u.numero.split('/')[0].slice(-2), 10);
      const vista = slot >= 1 && slot <= 5 ? 'frente-mar' : 'lateral';
      if (u.vista !== vista) { u.vista = vista; changed++; }
    });
    if (changed > 0) { writeData(data); console.log(`[migrar] vista preenchida em ${changed} UHs`); }
  } catch (e) {
    console.error('[migrar] falha ao migrar vista:', e.message);
  }
}());

// ─── Ativação de conta Hub-nativo ────────────────────────────────────────────
// GET /ativar é servido via express.static → public/ativar.html (antes do catch-all).
app.post('/api/ativar', async (req, res) => {
  const { token, senha } = req.body || {};
  if (!token || !senha) return res.status(400).json({ ok: false, erro: 'Dados incompletos' });
  const senhaForte = s => s && s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);
  if (!senhaForte(senha)) return res.status(400).json({ ok: false, erro: 'Senha fraca. Use ao menos 8 caracteres com maiúscula, minúscula, número e especial.' });

  const data = readData();
  if (!Array.isArray(data.activation_tokens)) return res.status(404).json({ ok: false, erro: 'Token inválido ou expirado.' });
  const tIdx = data.activation_tokens.findIndex(t => t && t.token === token && !t.used);
  if (tIdx === -1) return res.status(404).json({ ok: false, erro: 'Link inválido ou já utilizado.' });
  const tRec = data.activation_tokens[tIdx];
  if (new Date(tRec.expiresAt) < new Date()) return res.status(410).json({ ok: false, erro: 'Link expirado. Solicite um novo link ao TI.' });

  try {
    const r = await fetch(`${CHAMADOS_URL}/api/hub/portal-usuarios/${encodeURIComponent(tRec.chamadosId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SSO_SECRET}` },
      body: JSON.stringify({ senha, _self_edit: true }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return res.status(400).json({ ok: false, erro: d.erro || 'Erro ao definir senha.' });

    data.activation_tokens[tIdx].used = true;
    const uIdx = (data.users || []).findIndex(u => u.email === tRec.email);
    if (uIdx !== -1) {
      data.users[uIdx].hub_status = 'ativo';
      data.users[uIdx].login_failures = 0;
    }
    writeData(data);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[ativar]', err);
    return res.status(502).json({ ok: false, erro: 'Serviço indisponível. Tente novamente.' });
  }
});

app.listen(PORT, () => console.log(`Hub rodando em http://localhost:${PORT}`));
