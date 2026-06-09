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

function trackUser(email, nome, tipo) {
  const data = readData();
  const idx = data.users.findIndex(u => u.email === email);
  if (idx === -1) {
    data.users.push({ email, nome, tipo });
  } else {
    data.users[idx] = { email, nome, tipo };
  }
  writeData(data);
}

function getUserSistemas(email) {
  const data = readData();
  return Object.prototype.hasOwnProperty.call(data.permissions, email)
    ? data.permissions[email]
    : null; // null = acesso total
}

// ─── Sistemas (links do Hub) ─────────────────────────────────────────────────

const DEFAULT_SISTEMAS = [
  { id: 'chamados',  num: '01', nome: 'Chamados TI',           url: 'https://sistema-chamados-granmarquise.fly.dev', status: 'no-ar',     categoria: 'Suporte · Atendimento interno',    descricao: 'Para pedir ajuda da equipe de TI do hotel.',                        paraQuem: 'Todos os setores' },
  { id: 'ramais',    num: '02', nome: 'Lista de Ramais',        url: 'https://diretorio-ramais-granmarquise.fly.dev', status: 'no-ar',     categoria: 'Comunicação · Interno',            descricao: 'Diretório de ramais e contatos internos do hotel.',                  paraQuem: 'Todos os setores' },
  { id: 'spa',       num: '03', nome: 'Pesquisa de Satisfação', url: 'https://pesquisa-satisfacao.fly.dev',           status: 'no-ar',     categoria: 'Spa · Atendimento ao hóspede',     descricao: 'Coleta de feedback dos hóspedes após os tratamentos no Spa.',        paraQuem: 'Equipe do Spa' },
  { id: 'cardapio',  num: '04', nome: 'Cardápio Digital',       url: '#',                                             status: 'construcao', categoria: 'Restaurantes · F&B',              descricao: 'Cardápio dos restaurantes acessado por QR Code na mesa.',           paraQuem: 'Mangostin e Mucuripe Grill' },
  { id: 'ocupacao',  num: '05', nome: 'Painel de Ocupação',     url: '#',                                             status: 'beta',      categoria: 'Operação · Hospedagem',            descricao: 'Mapa visual dos 222 apartamentos do dia.',                          paraQuem: 'Recepção e Governança' },
  { id: 'predial',   num: '06', nome: 'Manutenção Predial',     url: '#',                                             status: 'concept',   categoria: 'Operação · Manutenção',            descricao: 'Ordens de serviço para conserto e manutenção.',                     paraQuem: 'Engenharia e Governança' },
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
      const token = jwt.sign({ nome: data.nome, email: emailNorm, tipo: 'admin', is_master: data.is_master }, SSO_SECRET, { expiresIn: '8h' });
      trackUser(emailNorm, data.nome, 'admin');
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
      const token = jwt.sign({ nome: data.nome, email: emailNorm, tipo: 'usuario' }, SSO_SECRET, { expiresIn: '8h' });
      trackUser(emailNorm, data.nome, 'usuario');
      return res.json({ ok: true, token, tipo: 'usuario', nome: data.nome, sistemas: getUserSistemas(emailNorm) });
    }
  } catch (_) {}

  return res.status(401).json({ ok: false, erro: 'Credenciais inválidas' });
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
  writeData(data);
  res.json({ ok: true, sistema: novo });
});

app.put('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const { nome, url, status, categoria, descricao, paraQuem } = req.body || {};
  const data = readData();
  const sistemas = getSistemas();
  const idx = sistemas.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, erro: 'Sistema não encontrado' });
  sistemas[idx] = { ...sistemas[idx], ...(nome && { nome }), url: url !== undefined ? url : sistemas[idx].url, ...(status && { status }), categoria: categoria !== undefined ? categoria : sistemas[idx].categoria, descricao: descricao !== undefined ? descricao : sistemas[idx].descricao, paraQuem: paraQuem !== undefined ? paraQuem : sistemas[idx].paraQuem };
  data.sistemas = sistemas;
  writeData(data);
  res.json({ ok: true, sistema: sistemas[idx] });
});

app.delete('/api/admin/sistemas/:id', requireAdmin, (req, res) => {
  const data = readData();
  const sistemas = getSistemas();
  data.sistemas = sistemas.filter(s => s.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

app.delete('/api/admin/permissions/:email', requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const data = readData();
  delete data.permissions[email];
  writeData(data);
  notifyUser(email, null);
  res.json({ ok: true });
});

// ─── Static fallback ─────────────────────────────────────────────────────────

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Hub rodando em http://localhost:${PORT}`));
