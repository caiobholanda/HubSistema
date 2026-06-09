require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SSO_SECRET = process.env.SSO_SECRET || 'dev-sso-secret';
const CHAMADOS_URL = process.env.CHAMADOS_URL || 'https://sistema-chamados-granmarquise.fly.dev';

if (!process.env.SSO_SECRET) {
  console.warn('[WARN] SSO_SECRET não configurado — usando secret inseguro');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ ok: false, erro: 'Email e senha obrigatórios' });
  }

  const emailNorm = email.trim().toLowerCase();

  // Tenta login como usuário
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/usuarios/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailNorm, senha }),
    });
    if (r.ok) {
      const data = await r.json();
      const token = jwt.sign(
        { nome: data.nome, email: emailNorm, tipo: 'usuario' },
        SSO_SECRET,
        { expiresIn: '8h' }
      );
      return res.json({ ok: true, token, nome: data.nome });
    }
  } catch (_) {}

  // Tenta login como admin
  try {
    const r = await fetch(`${CHAMADOS_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailNorm, senha }),
    });
    if (r.ok) {
      const data = await r.json();
      const token = jwt.sign(
        { nome: data.nome, email: emailNorm, tipo: 'admin', is_master: data.is_master },
        SSO_SECRET,
        { expiresIn: '8h' }
      );
      return res.json({ ok: true, token, nome: data.nome });
    }
  } catch (_) {}

  return res.status(401).json({ ok: false, erro: 'Credenciais inválidas' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Hub rodando em http://localhost:${PORT}`));
