const { useState, useEffect, useRef, useMemo } = React;

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn, { passive: true });
    return () => window.removeEventListener('resize', fn);
  }, []);
  return w;
}

const HUB_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const HUB_THEMES = {
  dark: {
    noite: '#202C28',
    noiteAlt: '#293630',
    champanhe: '#9C5843',
    dourado: '#996442',
    linkAbrir: '#996442',
    marfim: '#ECE4D2',
    areia: '#C8B89A',
    areiaDim: '#8A7B6A',
    jangada: '#2A5A6B',
    jangadaGlow: '#3E8497',
    panelHover: 'rgba(255,255,255,0.012)',
    previewBg: 'rgba(255,255,255,0.015)',
    headerBg: 'rgba(32, 44, 40, 0.82)',
    grainOpacity: 0.025,
    grainBlend: 'overlay',
  },
  light: {
    noite: '#ECE4D2',
    noiteAlt: '#E3DACC',
    champanhe: '#9C5843',
    dourado: '#7A4334',
    linkAbrir: '#996442',
    marfim: '#202C28',
    areia: '#996442',
    areiaDim: '#7A6B5A',
    jangada: '#175F4F',
    jangadaGlow: '#15705A',
    panelHover: 'rgba(32,44,40,0.03)',
    previewBg: 'rgba(32,44,40,0.035)',
    headerBg: 'rgba(236, 228, 210, 0.82)',
    grainOpacity: 0.05,
    grainBlend: 'multiply',
  },
};

const HUB_PALETTE = { ...HUB_THEMES.dark };
function applyHubTheme(name) {
  Object.assign(HUB_PALETTE, HUB_THEMES[name] || HUB_THEMES.dark);
}

// Ciclo de vida do usuario no Hub — cores fixas (nao mudam com o tema).
const HUB_STATUS_BADGE = {
  precadastro:       { label: 'Pré-cadastro',      color: '#D4AC0D' },
  ativacao_pendente: { label: 'Ativação pendente', color: '#E88B2A' },
  ativo:             { label: 'Ativo',              color: '#62A852' },
  bloqueado:         { label: 'Bloqueado',          color: '#5BA3CC' },
  desligado:         { label: 'Desligado',          color: '#607D8B' },
};
// Nao confundir com o StatusBadge dos sistemas (no-ar/beta/etc) mais abaixo.
function HubStatusBadge({ status, style }) {
  const info = HUB_STATUS_BADGE[status];
  if (!info) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: info.color, padding: '3px 10px 3px 8px', border: `1px solid ${info.color}44`, background: `${info.color}12`, ...style }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
      {info.label}
    </span>
  );
}

// ─── Auth utils ──────────────────────────────────────────────────────────────
// Decodifica JWT (parte central, base64url) com defesas para token malformado.
// Retorna {} em qualquer falha — nunca lanca.
function parseJwt(token) {
  try {
    if (!token || typeof token !== 'string') return {};
    const parts = token.split('.');
    if (parts.length < 2) return {};
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64 + padding)) || {};
  } catch { return {}; }
}
// Limpa tudo de auth + estado persistido e devolve o usuario para a tela de login.
function clearHubAuth() {
  try {
    localStorage.removeItem('hub_sso_token');
    localStorage.removeItem('hub_sistemas');
    localStorage.removeItem('hub_tipo');
    sessionStorage.removeItem('hub_show_admin');
    sessionStorage.removeItem('hub_admin_aba');
    sessionStorage.removeItem('hub_contas_subaba');
    sessionStorage.removeItem('hub_contas_status');
  } catch {}
}
// Event bus simples para auto-refresh do HistoricoPanel apos mutacoes.
// Toda funcao de mutacao bem-sucedida (saveNew, saveEdit, deleteLink,
// toggleSystem, resetPermissions, adicionar, trocarPapel, remover, etc.)
// chama notifyHubMutation(). O HistoricoPanel escuta 'hub:mutation' e
// recarrega o audit-log automaticamente — sem polling e sem prop drilling.
// Importante: o registro do audit fica APENAS no backend (appendAudit).
// Este helper so dispara o refresh do log, nao loga nada por si so.
function notifyHubMutation() {
  try { window.dispatchEvent(new Event('hub:mutation')); } catch {}
}

// Registra um evento na jornada do usuario (login/logout/click em sistema).
// Fire-and-forget: nao espera resposta, nao quebra o fluxo se falhar.
function logHubEvento(evento, detalhes) {
  try {
    const token = localStorage.getItem('hub_sso_token');
    if (!token) return;
    fetch('/api/hub-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ evento, detalhes }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
// Wrapper de fetch que sempre injeta o Bearer e, em 401/403, faz auto-logout
// (limpa sessao + recarrega) para evitar estado "meio autenticado".
async function hubFetch(url, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  const token = localStorage.getItem('hub_sso_token');
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { ...o, headers });
  if (r.status === 401 || r.status === 403) {
    clearHubAuth();
    // Forca volta para o login. Reload e o jeito mais simples de reiniciar
    // os estados sem precisar bubbling complexo.
    if (typeof window !== 'undefined') window.location.replace('/');
  }
  return r;
}

// ─── SSO: quais destinos aceitam o handshake do Hub ──────────────────────────
// Os satelites internos expoem GET /sso?sso_token=<jwt> e trocam o token por
// sessao propria. Um link novo cadastrado no admin (site externo, ERP, planilha,
// sistema de terceiro) nao tem essa rota: redirecionar para <origem>/sso?sso_token=
// resulta em erro/404 no destino e ainda entregaria o JWT do Hub a terceiros.
// Por isso o token so viaja para origens desta lista ou para cards em que o
// admin marcou explicitamente "login integrado" (campo `sso`).
// Espelha src/migrations.js (SSO_SISTEMA_IDS / SSO_ORIGINS). O backend ja manda
// `sso` explicito em /api/sistemas; isto aqui e' a rede de seguranca para dados
// antigos em cache e para o formulario do admin sugerir o valor certo.
const SSO_SISTEMA_IDS = ['chamados', 'ramais', 'pesquisa-satisfacao', 'gestao-de-qualidade'];
const SSO_ORIGINS = [
  'https://sistema-chamados-granmarquise.fly.dev',
  'https://diretorio-ramais-granmarquise.fly.dev',
  'https://pesquisa-satisfacao.fly.dev',
  'https://gestao-qualidade-granmarquise.fly.dev',
];

function originDe(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

// Valor sugerido quando o card ainda nao tem decisao gravada. Casa por id
// (sobrevive a troca de dominio via URL_OVERRIDES) e por origem.
function ssoPadrao(system) {
  if (!system) return false;
  if (SSO_SISTEMA_IDS.includes(system.id)) return true;
  return SSO_ORIGINS.includes(originDe(system.url));
}

// Regra unica de decisao: flag explicita do card vence; sem flag, cai no padrao
// — assim os cards antigos (que nao tem o campo) continuam abrindo via /sso
// exatamente como antes.
function cardUsaSso(system) {
  if (!system) return false;
  if (system.sso !== undefined) return !!system.sso;
  return ssoPadrao(system);
}

const HUB_SYSTEMS = [
{
  id: 'chamados',
  num: '01',
  categoria: 'Suporte · Atendimento interno',
  nome: 'Chamados TI',
  descricao: 'Para pedir ajuda da equipe de TI do hotel — Você abre o chamado, anexa fotos se quiser, e acompanha o atendimento.',
  detalhe: 'Em uso por todos os setores do hotel.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://sistema-chamados-granmarquise.fly.dev',
  mobileAdminUrl: 'https://sistema-chamados-granmarquise.fly.dev/mobile',
  repo: 'Hotel-Gran-Marquise/hub-helpdesk',
  stack: ['Anexar fotos e prints', 'Acompanhar atendimento', 'Histórico de chamados', 'Acesso pelo navegador'],
  preview: 'tickets'
},
{
  id: 'ramais',
  num: '02',
  categoria: 'Comunicação · Interno',
  nome: 'Lista de Ramais',
  descricao: 'Diretório de ramais e contatos internos do hotel — consulte o ramal de qualquer setor ou colaborador sem precisar ligar para a recepção.',
  detalhe: 'Acesso pelo navegador.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://diretorio-ramais-granmarquise.fly.dev',
  repo: 'Hotel-Gran-Marquise/hub-contatos',
  stack: ['Busca por nome ou setor', 'Ramais e contatos'],
  preview: 'directory'
},
{
  id: 'pesquisa-satisfacao',
  num: '03',
  categoria: 'Spa · Atendimento ao hóspede',
  nome: 'Pesquisa de Satisfação',
  descricao: 'Gestão de atendimentos, escalas de profissionais, anamnese digital e auditoria de satisfação do Gran Spa.',
  detalhe: 'Acesso restrito à equipe do Spa e TI.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://pesquisa-satisfacao.fly.dev',
  adminUrl: 'https://pesquisa-satisfacao.fly.dev/admin',
  terapeutaUrl: 'https://pesquisa-satisfacao.fly.dev/terapeuta',
  adminEmails: ['estagio.ti@granmarquise.com.br', 'suporte.ti@granmarquise.com.br', 'richard@granmarquise.com.br'],
  repo: 'Hotel-Gran-Marquise/hub-spa',
  stack: ['Avaliação pós-tratamento', 'Painel de relatórios', 'Gestão de massoterapeutas'],
  preview: 'tickets'
}];


// ─── Boot ─────────────────────────────────────────────────────────────────────

function HubBoot({ onDone }) {
  const [phase, setPhase] = useState('show');
  const [anim, setAnim] = useState(0);
  const winW = useWindowWidth();
  const isMobile = winW < 520;

  useEffect(() => {
    const start = performance.now();
    const SPEED = 1.5;
    let raf;
    const tick = (now) => {
      const elapsed = (now - start) / 1000 * SPEED;
      setAnim(elapsed);
      if (elapsed < 2.5) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t1 = setTimeout(() => setPhase('fade'), 2300);
    const t2 = setTimeout(() => onDone(), 2900);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  const t = anim;
  const N = 40, R = isMobile ? 72 : 130, RI = isMobile ? 27 : 48, K = 2.3;
  const stepA = (Math.PI * 2) / N;
  const eco = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
  const fp = (start, dur) => eco((t - start) / (dur || 0.7));

  const rot = -26 + 26 * eco(t / 2.3);
  const sc = 0.9 + 0.1 * eco(t / 2.3);

  const lines = [];
  for (let i = 0; i < N; i++) {
    const a = i * stepA - Math.PI / 2;
    for (const s of [-1, 1]) {
      const a2 = a + s * K * stepA;
      const delay = 0.08 + (i / N) * 1.0 + (s === 1 ? 0.05 : 0);
      const p = eco((t - delay) / 0.85);
      lines.push(
        <line key={i + '_' + s}
          x1={Math.cos(a) * RI} y1={Math.sin(a) * RI}
          x2={Math.cos(a2) * R} y2={Math.sin(a2) * R}
          pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p}
          stroke={HUB_PALETTE.champanhe} strokeWidth="1.8" strokeLinecap="round"
          opacity={p > 0 ? 1 : 0}
        />
      );
    }
  }

  const pHotel = fp(1.25, 0.8);
  const pGran  = fp(1.5,  0.8);
  const pMar   = fp(1.7,  0.85);
  const lsP    = eco((t - 1.25) / 0.9);
  const ink    = HUB_PALETTE.marfim;
  const dim    = (p) => ({ opacity: p, transform: `translateY(${(1 - p) * 14}px)` });
  const fSz    = isMobile ? 24 : 40;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: HUB_PALETTE.noite,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: phase === 'fade' ? 0 : 1,
      transition: `opacity 600ms ${HUB_EASE}`,
      pointerEvents: phase === 'fade' ? 'none' : 'auto',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: isMobile ? 16 : 32 }}>
        <svg width={R * 2 + 10} height={R * 2 + 10}
          viewBox={`${-R - 5} ${-R - 5} ${R * 2 + 10} ${R * 2 + 10}`}
          style={{ display: 'block', transform: `rotate(${rot}deg) scale(${sc})`, flexShrink: 0 }}>
          {lines}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start' }}>
          <div style={{ fontFamily: "'Helvetica Neue',Arial,sans-serif", fontSize: isMobile ? 10 : 12, fontWeight: 400, letterSpacing: (0.58 - 0.16 * lsP) + 'em', color: ink, lineHeight: 1, marginBottom: 4, ...dim(pHotel) }}>HOTEL</div>
          <div style={{ fontFamily: "'Helvetica Neue',Arial,sans-serif", fontSize: fSz, fontWeight: 300, letterSpacing: '0.055em', color: ink, lineHeight: 1.1, ...dim(pGran) }}>GRAN</div>
          <div style={{ fontFamily: "'Helvetica Neue',Arial,sans-serif", fontSize: fSz, fontWeight: 300, letterSpacing: '0.055em', color: ink, lineHeight: 1.1, ...dim(pMar) }}>MARQUISE</div>
        </div>
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function HubLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [visible, setVisible] = useState(false);
  // Troca obrigatoria de senha no primeiro login. Quando definido:
  // { email, senha_atual, tipo } — substitui o form de login pela tela de troca.
  const [trocaForcada, setTrocaForcada] = useState(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false);
  const [trocaLoading, setTrocaLoading] = useState(false);
  const [trocaErro, setTrocaErro] = useState('');
  // Esqueci senha (painel inline) — replica o comportamento da tela antiga do sistema-chamados
  const [view, setView] = useState('login');
  const [viewVisible, setViewVisible] = useState(true);
  const [esqEmail, setEsqEmail] = useState('');
  const [esqLoading, setEsqLoading] = useState(false);
  // { tipo: 'ok'|'erro', titulo, texto }
  const [esqMsg, setEsqMsg] = useState(null);
  const [esqEnviado, setEsqEnviado] = useState(false);
  const [esqShakeKey, setEsqShakeKey] = useState(0);
  const emailRef = useRef(null);
  const esqEmailRef = useRef(null);

  function _esqErro(titulo, texto) {
    setEsqMsg({ tipo: 'erro', titulo, texto });
    setEsqShakeKey(k => k + 1);
  }

  async function handleEsqueci(e) {
    if (e && e.preventDefault) e.preventDefault();
    const e_ = (esqEmail || '').trim().toLowerCase();
    if (!e_) { _esqErro('Campo obrigatório', 'Informe o e-mail cadastrado.'); return; }
    setEsqLoading(true); setEsqMsg(null);
    try {
      const r = await fetch('/api/auth/esqueci-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e_ }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok || r.status === 404) {
        setEsqMsg({ tipo: 'ok', texto: 'Se existir uma conta vinculada ao e-mail informado, enviaremos um link para redefinição de senha.' });
        setEsqEnviado(true);
      } else {
        _esqErro('Algo deu errado', d.erro || 'Tente novamente em instantes.');
      }
    } catch { _esqErro('Sem conexão', 'Verifique sua conexão com a internet e tente novamente.'); }
    setEsqLoading(false);
  }

  function resetEsqueci() {
    setEsqEnviado(false);
    setEsqMsg(null);
  }

  function switchView(targetView) {
    setViewVisible(false);
    setTimeout(() => {
      if (targetView === 'recovery') {
        setEsqEmail(email || '');
        setEsqMsg(null);
        setEsqEnviado(false);
      }
      setView(targetView);
      setViewVisible(true);
      setTimeout(() => {
        if (targetView === 'recovery') { if (esqEmailRef.current) esqEmailRef.current.focus(); }
        else { if (emailRef.current) emailRef.current.focus(); }
      }, 50);
    }, 150);
  }

  // Injeta keyframes do shake uma unica vez (evita duplicar StyleSheet)
  useEffect(() => {
    if (document.getElementById('hub-esq-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'hub-esq-keyframes';
    s.textContent = `
      @keyframes hubShake { 0%,100% { transform: translateX(0); } 16% { transform: translateX(-7px); } 33% { transform: translateX(7px); } 50% { transform: translateX(-4px); } 66% { transform: translateX(4px); } 83% { transform: translateX(-2px); } }
      @keyframes hubSlideIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active { -webkit-box-shadow: 0 0 0 1000px #202C28 inset !important; -webkit-text-fill-color: #ECE4D2 !important; caret-color: #ECE4D2; transition: background-color 5000s ease-in-out 0s; }
    `;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(true);
      setTimeout(() => emailRef.current && emailRef.current.focus(), 300);
    }, 60);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErro('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const data = await r.json();
      if (data.ok) {
        if (data.precisa_trocar_senha) {
          setTrocaForcada({ email: data.email || email.trim().toLowerCase(), senha_atual: senha, tipo: data.tipo });
          setNovaSenha(''); setConfirmarSenha(''); setTrocaErro('');
        } else {
          localStorage.setItem('hub_sso_token', data.token);
          localStorage.setItem('hub_tipo', data.tipo || 'usuario');
          onLogin(data.nome, data.sistemas, data.tipo || 'usuario');
        }
      } else {
        setErro(data.erro || 'Credenciais inválidas');
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function validarSenhaForte(s) {
    return s && s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);
  }

  async function handleTrocarSenha(e) {
    e.preventDefault();
    setTrocaErro('');
    if (!validarSenhaForte(novaSenha)) {
      setTrocaErro('Senha fraca. Use ao menos 8 caracteres com maiúscula, minúscula, número e caractere especial.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setTrocaErro('A confirmação não confere com a nova senha.');
      return;
    }
    setTrocaLoading(true);
    try {
      const r1 = await fetch('/api/auth/trocar-primeira-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trocaForcada.email, senha_atual: trocaForcada.senha_atual, senha_nova: novaSenha }),
      });
      const d1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !d1.ok) {
        setTrocaErro(d1.erro || 'Não foi possível trocar a senha.');
        setTrocaLoading(false);
        return;
      }
      // Limpa a senha temporaria do state — nao deve ficar em memoria depois daqui.
      const emailFinal = trocaForcada.email;
      setTrocaForcada(prev => prev ? { ...prev, senha_atual: '' } : prev);

      // Login automatico com a senha nova.
      const r2 = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailFinal, senha: novaSenha }),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (r2.ok && d2.ok && d2.token) {
        localStorage.setItem('hub_sso_token', d2.token);
        localStorage.setItem('hub_tipo', d2.tipo || 'usuario');
        setTrocaForcada(null);
        setNovaSenha(''); setConfirmarSenha(''); setSenha('');
        onLogin(d2.nome, d2.sistemas, d2.tipo || 'usuario');
      } else if (r2.ok && d2.ok && d2.precisa_trocar_senha) {
        // Backend nao limpou a flag — diagnostico claro para nao ficar em loop silencioso.
        setTrocaErro('A senha foi salva, mas o servidor ainda exige troca. Contate o suporte.');
      } else {
        setTrocaErro((d2 && d2.erro) || 'Senha salva, mas o login automático falhou. Tente entrar manualmente.');
        setTrocaForcada(null);
        setSenha(''); setNovaSenha(''); setConfirmarSenha('');
      }
    } catch {
      setTrocaErro('Erro de conexão. Tente novamente.');
    } finally {
      setTrocaLoading(false);
    }
  }

  const inputBase = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${HUB_PALETTE.areiaDim}44`,
    borderRadius: 0,
    color: HUB_PALETTE.marfim,
    fontFamily: 'Inter, sans-serif',
    fontSize: 16,
    padding: '15px 16px',
    outline: 'none',
    transition: `border-color 300ms ${HUB_EASE}`,
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: `radial-gradient(ellipse 90% 55% at 12% 8%, ${HUB_PALETTE.champanhe}13 0%, transparent 65%), radial-gradient(ellipse 65% 75% at 88% 92%, ${HUB_PALETTE.jangada}0c 0%, transparent 65%), ${HUB_PALETTE.noite}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: visible ? 1 : 0,
      transition: `opacity 700ms ${HUB_EASE}`,
    }}>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 1, height: '60%', background: `linear-gradient(180deg, transparent 0%, ${HUB_PALETTE.champanhe}55 40%, transparent 100%)`, pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: trocaForcada ? 520 : 400, padding: '0 24px' }}>
        <div style={{ opacity: trocaForcada ? 1 : (viewVisible ? 1 : 0), transition: 'opacity 150ms ease-in-out' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: trocaForcada ? 36 : 16 }}>
          <img
            src="https://letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png"
            alt="Gran Marquise"
            style={{ height: trocaForcada ? 56 : 54, width: 'auto', filter: HUB_PALETTE.noite === HUB_THEMES.dark.noite ? 'brightness(0) invert(1)' : 'none', opacity: 0.9, marginBottom: trocaForcada ? 24 : 10 }}
          />
          <h1 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: trocaForcada ? 300 : 600, fontStyle: trocaForcada ? 'italic' : 'normal', fontSize: trocaForcada ? 44 : 36, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: 0, lineHeight: 1 }}>{trocaForcada ? 'Defina sua nova senha.' : view === 'recovery' ? 'Redefinir senha' : 'Entrar'}</h1>
          {!trocaForcada && view === 'login' && (
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: '0.18em', color: HUB_PALETTE.areia, marginTop: 24 }}>Plataforma Corporativa</div>
          )}
          {!trocaForcada && view === 'recovery' && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: HUB_PALETTE.areia, marginTop: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span>Digite seu e-mail corporativo.</span>
              <span>Enviaremos um link para redefinir sua senha.</span>
            </div>
          )}
          {trocaForcada && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: HUB_PALETTE.areia, marginTop: 18, textAlign: 'center', lineHeight: 1.6 }}>
              É o seu primeiro acesso. Por segurança, troque a senha temporária<br />que você recebeu antes de continuar.
            </div>
          )}
        </div>

        {trocaForcada ? (() => {
          const inputTroca = { ...inputBase, fontSize: 16, padding: '17px 18px' };
          const labelTroca = { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 10 };
          return (
          <form onSubmit={handleTrocarSenha} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={labelTroca}>E-mail</div>
              <input type="email" value={trocaForcada.email} disabled readOnly
                style={{ ...inputTroca, opacity: 0.65, cursor: 'not-allowed' }} />
            </div>
            <div>
              <div style={labelTroca}>Nova senha</div>
              <div style={{ position: 'relative' }}>
                <input type={mostrarNovaSenha ? 'text' : 'password'} value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="••••••••" required disabled={trocaLoading} autoFocus
                  style={{ ...inputTroca, paddingRight: 56 }}
                  onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
                  onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
                <button type="button" onClick={() => setMostrarNovaSenha(v => !v)} style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  {mostrarNovaSenha
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              <SenhaChecklist senha={novaSenha} />
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: HUB_PALETTE.areiaDim, marginTop: 10, lineHeight: 1.55 }}>
                <span style={{ opacity: 0.85 }}>Quer manter a senha que já usa? Basta digitá-la nos dois campos.</span>
              </div>
            </div>
            <div>
              <div style={labelTroca}>Confirmar nova senha</div>
              <input type={mostrarNovaSenha ? 'text' : 'password'} value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)} placeholder="••••••••" required disabled={trocaLoading}
                style={inputTroca}
                onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
                onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
            </div>
            {trocaErro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#E07A5F', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}><span>—</span> {trocaErro}</div>}
            <button type="submit" disabled={trocaLoading}
              style={{ marginTop: 10, width: '100%', padding: '19px', background: 'transparent', border: `1px solid ${HUB_PALETTE.champanhe}`, color: trocaLoading ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, letterSpacing: '0.3em', textTransform: 'uppercase', cursor: trocaLoading ? 'not-allowed' : 'pointer', transition: `background 300ms ${HUB_EASE}` }}
              onMouseEnter={e => { if (!trocaLoading) e.target.style.background = 'rgba(156,88,67,0.1)'; }}
              onMouseLeave={e => { e.target.style.background = 'transparent'; }}>
              {trocaLoading ? 'Salvando...' : 'Salvar e entrar'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <button type="button" onClick={() => { setTrocaForcada(null); setSenha(''); setNovaSenha(''); setConfirmarSenha(''); setTrocaErro(''); }}
                style={{ background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: '8px 4px' }}>
                Cancelar e voltar
              </button>
            </div>
          </form>
          );
        })() : view === 'login' ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#A09080', marginBottom: 8 }}>E-mail</div>
            <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@granmarquise.com.br" required disabled={loading}
              style={inputBase}
              onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
              onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
          </div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#A09080', marginBottom: 8 }}>Senha</div>
            <div style={{ position: 'relative' }}>
              <input type={mostrarSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" required disabled={loading}
                style={{ ...inputBase, paddingRight: 52 }}
                onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
                onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
              <button type="button" onClick={() => setMostrarSenha(v => !v)} style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {mostrarSenha
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
          {erro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#E07A5F', paddingTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}><span>—</span> {erro}</div>}
          <button type="submit" disabled={loading}
            style={{ marginTop: 10, width: '100%', padding: '15px', background: HUB_PALETTE.marfim, border: 'none', borderRadius: 0, color: HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', cursor: loading ? 'wait' : 'pointer', transition: `background 200ms ${HUB_EASE}`, opacity: loading ? 0.7 : 1 }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#DDD5C2' : '#283631'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = HUB_PALETTE.marfim; }}
            onMouseDown={e => { if (!loading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#CFC7B5' : '#1B2522'; }}
            onMouseUp={e => { if (!loading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#DDD5C2' : '#283631'; }}>
            {loading ? 'Verificando...' : 'Entrar'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <button type="button" onClick={() => switchView('recovery')}
              style={{ background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: '6px 4px' }}>
              Esqueci minha senha
            </button>
          </div>
        </form>
        ) : (
        <form onSubmit={handleEsqueci} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!esqEnviado ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#A09080', marginBottom: 8 }}>E-MAIL</div>
                <input ref={esqEmailRef} type="email" value={esqEmail} onChange={e => setEsqEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleEsqueci(e); }}
                  placeholder="seu@granmarquise.com.br" required disabled={esqLoading}
                  style={{ ...inputBase, ...(esqMsg && esqMsg.tipo === 'erro' ? { borderColor: '#E07A5F', boxShadow: '0 0 0 3px rgba(224,122,95,0.13)' } : null) }}
                  onFocus={e => { e.target.style.borderColor = HUB_PALETTE.champanhe + '88'; }}
                  onBlur={e => { if (!(esqMsg && esqMsg.tipo === 'erro')) e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'; }} />
                {esqMsg && esqMsg.tipo === 'erro' && (
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#E07A5F', paddingTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}><span>—</span> {esqMsg.texto}</div>
                )}
              </div>
              <button type="submit" disabled={esqLoading}
                style={{ width: '100%', padding: '15px', background: HUB_PALETTE.marfim, border: 'none', borderRadius: 0, color: HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', cursor: esqLoading ? 'wait' : 'pointer', transition: `background 200ms ${HUB_EASE}`, opacity: esqLoading ? 0.7 : 1 }}
                onMouseEnter={e => { if (!esqLoading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#DDD5C2' : '#283631'; }}
                onMouseLeave={e => { if (!esqLoading) e.currentTarget.style.background = HUB_PALETTE.marfim; }}
                onMouseDown={e => { if (!esqLoading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#CFC7B5' : '#1B2522'; }}
                onMouseUp={e => { if (!esqLoading) e.currentTarget.style.background = HUB_PALETTE.marfim === '#ECE4D2' ? '#DDD5C2' : '#283631'; }}>
                {esqLoading ? 'Enviando…' : 'Enviar link de redefinição'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button type="button" onClick={() => switchView('login')}
                  style={{ background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: '6px 4px' }}>
                  ← Voltar ao login
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7cb342" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, textAlign: 'center', lineHeight: 1.7 }}>
                {esqMsg ? esqMsg.texto : 'Link enviado. Verifique sua caixa de entrada.'}
              </div>
              <button type="button" onClick={() => switchView('login')}
                style={{ background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: '6px 4px' }}>
                ← Voltar ao login
              </button>
              <button type="button" onClick={() => handleEsqueci(null)} disabled={esqLoading}
                style={{ background: 'none', border: 'none', cursor: esqLoading ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.areiaDim, textDecoration: 'underline', textUnderlineOffset: 3, padding: 0, opacity: esqLoading ? 0.7 : 1 }}>
                {esqLoading ? 'Enviando…' : 'Não recebeu o e-mail? Reenviar'}
              </button>
            </div>
          )}
        </form>
        )}
        </div>

        <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: `${HUB_PALETTE.areiaDim}22` }} />
          <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 13, color: HUB_PALETTE.areiaDim }}>Quem é bem atendido, atende bem.</span>
          <div style={{ flex: 1, height: 1, background: `${HUB_PALETTE.areiaDim}22` }} />
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS = { 'no-ar': 'Ativo', 'construcao': 'Em desenvolvimento', 'beta': 'Em testes', 'concept': 'Em planejamento', 'inativo': 'Inativo' };
const STATUS_CORES = { 'no-ar': '#4CAF87', 'construcao': '#E0A85F', 'beta': '#5FA8E0', 'concept': '#9E9E9E', 'inativo': '#9E9E9E' };

// ─── Admin Panel helpers ──────────────────────────────────────────────────────

function LinkForm({ form, setForm, onSave, onCancel, linkErro, linkSaving, setoresLista }) {
  const isMobile = useWindowWidth() < 768;
  const [setorFiltro, setSetorFiltro] = useState('');
  // Enquanto o admin nao mexer no checkbox de SSO, ele acompanha a URL digitada:
  // colou a URL de um sistema interno, ja vem marcado; trocou para um site de
  // fora, desmarca sozinho. Depois de um clique manual, a escolha dele manda.
  const [ssoManual, setSsoManual] = useState(false);
  function mudarUrl(v) {
    setForm(p => ({ ...p, url: v, ...(ssoManual ? {} : { sso: ssoPadrao({ id: p.id, url: v }) }) }));
  }
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: HUB_PALETTE.noiteAlt,
    border: `1px solid ${HUB_PALETTE.areiaDim}44`,
    color: HUB_PALETTE.marfim,
    fontFamily: 'Inter, sans-serif', fontSize: 13,
    padding: '8px 12px', outline: 'none', marginBottom: 8,
  };
  const labelStyle = { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6 };
  const optStyle = { background: HUB_PALETTE.noiteAlt, color: HUB_PALETTE.marfim };
  return (
    <div style={{ background: `${HUB_PALETTE.areiaDim}08`, border: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: 24, marginBottom: 2 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 2 }}>
        <div>
          <div style={labelStyle}>Nome *</div>
          <input value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} placeholder="Ex: Cardápio Digital" style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Status *</div>
          <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
            {[['no-ar', 'Ativo'], ['inativo', 'Inativo']].map(([v, l]) => <option key={v} value={v} style={optStyle}>{l}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={labelStyle}>URL</div>
          <input value={form.url} onChange={e => mudarUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
        </div>
        {/* Login integrado (SSO) — desligado por padrao em link novo. So os
            sistemas internos do hotel tem a rota /sso; marcar isso em um site
            que nao tem faz o link abrir com erro. */}
        <div style={{ gridColumn: '1 / -1', marginBottom: 4 }}>
          <div
            onClick={() => { setSsoManual(true); setForm(p => ({ ...p, sso: !p.sso })); }}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', padding: '12px 16px', border: `1px solid ${form.sso ? '#996442' : HUB_PALETTE.areiaDim + '33'}`, background: form.sso ? '#99644210' : 'transparent', userSelect: 'none' }}>
            <span style={{ flexShrink: 0, width: 16, height: 16, marginTop: 1, border: `1.5px solid ${form.sso ? '#996442' : HUB_PALETTE.areiaDim + '88'}`, background: form.sso ? '#996442' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {form.sso && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="#ECE4D2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: form.sso ? '#996442' : HUB_PALETTE.areiaDim, marginBottom: 3 }}>Login integrado (SSO)</span>
              <span style={{ display: 'block', fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areia, lineHeight: 1.45 }}>Só para sistemas internos do hotel que aceitam o login do Hub. Para qualquer site externo deixe desmarcado — o link abre direto, sem token na URL.</span>
            </span>
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={labelStyle}>Categoria</div>
          <input value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))} placeholder="Ex: Operação · Hospedagem" style={inputStyle} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={labelStyle}>Descrição</div>
          <textarea value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))} placeholder="Breve descrição do sistema" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        {/* Acesso por Setor */}
        {!form.acessoPadrao && Array.isArray(setoresLista) && setoresLista.length > 0 && (
          <div style={{ gridColumn: '1 / -1', marginBottom: 4 }}>
            <div style={{ border: `1px solid ${HUB_PALETTE.areiaDim}33`, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 }}>Acesso por Setor</div>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areia, marginBottom: 12, lineHeight: 1.45 }}>Todos os colaboradores dos setores selecionados recebem acesso automaticamente.</div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.6 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="search"
                  placeholder="Filtrar setores..."
                  value={setorFiltro}
                  onChange={e => setSetorFiltro(e.target.value)}
                  autoComplete="new-password"
                  style={{ width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.noiteAlt, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '7px 10px 7px 28px', outline: 'none' }}
                />
                {setorFiltro && (
                  <button onClick={() => setSetorFiltro('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: HUB_PALETTE.areiaDim, padding: 2, lineHeight: 1, fontSize: 14 }}>×</button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {setoresLista.filter(s => !setorFiltro.trim() || s.nome.toLowerCase().includes(setorFiltro.trim().toLowerCase())).map(s => {
                  const sel = (form.setoresAcesso || []).includes(s.nome);
                  return (
                    <div key={s.id}
                      onClick={() => setForm(p => { const cur = p.setoresAcesso || []; return { ...p, setoresAcesso: sel ? cur.filter(x => x !== s.nome) : [...cur, s.nome] }; })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', border: `1px solid ${sel ? HUB_PALETTE.champanhe + '66' : HUB_PALETTE.areiaDim + '33'}`, background: sel ? HUB_PALETTE.champanhe + '12' : 'transparent', cursor: 'pointer', userSelect: 'none', transition: 'all 120ms' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sel ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim + '55', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: sel ? HUB_PALETTE.marfim : HUB_PALETTE.areiaDim }}>{s.nome}</span>
                    </div>
                  );
                })}
              </div>
              {(form.setoresAcesso || []).length > 0 && (
                <div style={{ marginTop: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.champanhe, letterSpacing: '0.15em' }}>
                  {(form.setoresAcesso || []).length} setor{(form.setoresAcesso || []).length !== 1 ? 'es' : ''} selecionado{(form.setoresAcesso || []).length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        )}
        {/* Acesso Padrão — dentro do grid para herdar gridColumn */}
        <div style={{ gridColumn: '1 / -1', marginBottom: 4 }}>
          <div
            onClick={() => setForm(p => ({ ...p, acessoPadrao: !p.acessoPadrao }))}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', padding: '12px 16px', border: `1px solid ${form.acessoPadrao ? '#996442' : HUB_PALETTE.areiaDim + '33'}`, background: form.acessoPadrao ? '#99644210' : 'transparent', userSelect: 'none' }}>
            <span style={{ flexShrink: 0, width: 16, height: 16, marginTop: 1, border: `1.5px solid ${form.acessoPadrao ? '#996442' : HUB_PALETTE.areiaDim + '88'}`, background: form.acessoPadrao ? '#996442' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {form.acessoPadrao && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="#ECE4D2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: form.acessoPadrao ? '#996442' : HUB_PALETTE.areiaDim, marginBottom: 3 }}>Acesso Padrão</span>
              <span style={{ display: 'block', fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areia, lineHeight: 1.45 }}>Disponibilizar este aplicativo automaticamente para todos os colaboradores. Ao ativar, todos os usuários serão associados automaticamente.</span>
            </span>
          </div>
        </div>
      </div>
      {linkErro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#E07A5F', marginBottom: 12 }}>{linkErro}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onSave} disabled={linkSaving} style={{ background: '#996442', border: '1px solid #996442', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 12, letterSpacing: 'normal', textTransform: 'none', padding: '12px 22px', cursor: linkSaving ? 'wait' : 'pointer' }}>
          {linkSaving ? 'Salvando...' : 'Salvar'}
        </button>
        <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '12px 22px', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Modal de edicao de Link (substitui a edicao inline) ─────────────────────
// 2 abas: "Edicao" (campos do link) e "Liberacao" (permissoes do banco).
// Fecha so no botao X / Cancelar / overlay overlay click — nao no Esc.

function LinkEditModal({ sys, form, setForm, onSave, onCancel, linkErro, linkSaving, isMobile, users, setoresLista }) {
  const [aba, setAba] = useState('edicao'); // 'edicao' | 'liberacao'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'hidden' }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 720, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '18px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: HUB_PALETTE.noite }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe }}>Editar link</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 22, color: HUB_PALETTE.marfim, marginTop: 4 }}>{sys.nome}</div>
          </div>
          <button onClick={onCancel} aria-label="Fechar" style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 14, padding: '6px 12px', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: '0 24px', background: HUB_PALETTE.noite }}>
          {[{ id: 'edicao', label: 'Informações' }, { id: 'liberacao', label: 'Liberação' }].map(t => (
            <button key={t.id} onClick={() => setAba(t.id)}
              style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${aba === t.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: aba === t.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '12px 18px 10px', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {aba === 'edicao' && (
            <div style={{ padding: isMobile ? '12px' : '4px 24px 8px' }}>
              <LinkForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} linkErro={linkErro} linkSaving={linkSaving} setoresLista={setoresLista} />
            </div>
          )}
          {aba === 'liberacao' && (
            <LiberacaoPanel sistemaId={sys.id} sistemaNome={sys.nome} isMobile={isMobile} users={users} acessoPadrao={!!sys.acessoPadrao} setoresAcesso={form.setoresAcesso || []} />
          )}
        </div>
      </div>
    </div>
  );
}

function LinkCreateModal({ form, setForm, onSave, onCancel, linkErro, linkSaving, isMobile, setoresLista }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 185, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'hidden' }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 680, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '18px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: HUB_PALETTE.noite }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe }}>Novo link</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 22, color: HUB_PALETTE.marfim, marginTop: 4 }}>Adicionar sistema ao Hub.</div>
          </div>
          <button onClick={onCancel} aria-label="Fechar" style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 14, padding: '6px 12px', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ padding: isMobile ? '12px' : '4px 24px 8px' }}>
            <LinkForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} linkErro={linkErro} linkSaving={linkSaving} setoresLista={setoresLista} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Aba LIBERACAO: gerencia papeis (admin/usuario) por email para um sistema.
// Le e escreve no banco do Hub via /api/admin/site-permissions.
// LiberacaoPanel: gerencia APENAS quem tem cookie de admin no sistema.
// Acesso comum (usuario) e' implicito — quem ve o link no Hub recebe
// cookie de usuario automaticamente ao fazer SSO. Por isso nao ha lista
// de "usuarios" aqui.
function LiberacaoPanel({ sistemaId, sistemaNome, isMobile, users, acessoPadrao, setoresAcesso }) {
  const [items, setItems] = useState(null); // null=loading, []=vazio
  const [novoEmail, setNovoEmail] = useState('');
  const [novoPapel, setNovoPapel] = useState('admin');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemover, setConfirmRemover] = useState(null); // null | { email }
  const [sugAberto, setSugAberto] = useState(false);
  const [sugHighlight, setSugHighlight] = useState(0);
  // pesquisa-satisfacao tem 4 papeis granulares; demais sistemas so 'admin'.
  const ehPesquisa = sistemaId === 'pesquisa-satisfacao';
  const PAPEIS_LABEL = { master: 'Master (tudo)', admin: 'Admin (só ver)', spa: 'Spa', satisfacao: 'Satisfação' };
  // Lista de usuarios sempre fresca (recarregada ao montar e a cada
  // adicao/remocao). Garante que conta recem-criada apareca em tempo real.
  const [usersFresh, setUsersFresh] = useState(users || []);
  // Ref do input para posicionar a dropbox por cima do modal (position fixed).
  const inputWrapRef = useRef(null);
  const [popRect, setPopRect] = useState(null);
  async function recarregarUsuarios() {
    try {
      const r = await hubFetch('/api/admin/all-users');
      const d = await r.json().catch(() => ({}));
      if (d && d.ok !== false && Array.isArray(d.users)) setUsersFresh(d.users);
    } catch {}
  }
  useEffect(() => { recarregarUsuarios(); }, []);
  // Atualiza posicao do dropdown quando abre / quando rola a tela.
  useEffect(() => {
    if (!sugAberto) { setPopRect(null); return; }
    function atualizar() {
      const el = inputWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopRect({ top: r.bottom + 2, left: r.left, width: r.width });
    }
    atualizar();
    window.addEventListener('scroll', atualizar, true);
    window.addEventListener('resize', atualizar);
    return () => {
      window.removeEventListener('scroll', atualizar, true);
      window.removeEventListener('resize', atualizar);
    };
  }, [sugAberto]);

  async function carregar() {
    try {
      const r = await hubFetch('/api/admin/site-permissions');
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setItems([]); return; }
      setItems((d.items || []).filter(x => x.sistema_id === sistemaId));
    } catch { setItems([]); }
  }
  useEffect(() => { carregar(); }, [sistemaId]);

  async function adicionar() {
    setErro('');
    const e = (novoEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setErro('E-mail inválido.'); return; }
    const papel = ehPesquisa ? novoPapel : 'admin';
    setBusy(true);
    try {
      const r = await hubFetch('/api/admin/site-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, sistema_id: sistemaId, papel }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || 'Erro ao salvar'); return; }
      setNovoEmail('');
      notifyHubMutation();
      await Promise.all([carregar(), recarregarUsuarios()]);
    } finally { setBusy(false); }
  }
  // Promove/rebaixa o papel de um email ja na lista (so pesquisa).
  async function trocarPapel(email, papel) {
    setBusy(true);
    try {
      await hubFetch('/api/admin/site-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, sistema_id: sistemaId, papel }),
      });
      notifyHubMutation();
      await Promise.all([carregar(), recarregarUsuarios()]);
    } finally { setBusy(false); }
  }
  function remover(email) {
    setConfirmRemover({ email });
  }
  async function executarRemover() {
    if (!confirmRemover) return;
    const { email } = confirmRemover;
    setConfirmRemover(null);
    setBusy(true);
    try {
      await hubFetch(`/api/admin/site-permissions?email=${encodeURIComponent(email)}&sistema_id=${encodeURIComponent(sistemaId)}`, { method: 'DELETE' });
      notifyHubMutation();
      await Promise.all([carregar(), recarregarUsuarios()]);
    } finally { setBusy(false); }
  }

  // Lista mostra qualquer registro de permissao explicita (admin, master,
  // spa, satisfacao). Filtra apenas 'usuario' (acesso comum) que e' implicito.
  // Sem isso, trocar de 'admin' para 'master' fazia o item sumir da lista.
  const admins = (items || []).filter(x => x.papel !== 'usuario');

  const subTitulo = { fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 };
  const lista = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 };
  const item = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: `1px solid ${HUB_PALETTE.areiaDim}22`, fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim };
  const btn = { background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11, letterSpacing: '0.02em', textTransform: 'none', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer' };


  return (
    <div style={{ padding: isMobile ? '12px' : '18px 24px 24px' }}>
      {Array.isArray(setoresAcesso) && setoresAcesso.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', border: `1px solid ${HUB_PALETTE.champanhe}33`, background: `${HUB_PALETTE.champanhe}08`, marginBottom: 18 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.champanhe} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 5 }}>Acesso por Setor</div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areia, margin: 0, lineHeight: 1.55 }}>
              Todos os colaboradores dos setores <strong style={{ color: HUB_PALETTE.marfim }}>{setoresAcesso.join(', ')}</strong> têm acesso automático a este app.
            </p>
          </div>
        </div>
      )}
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, lineHeight: 1.55, margin: '0 0 18px' }}>
        Quem aparece abaixo recebe <strong>cookie de admin</strong> no <em>{sistemaNome}</em> no próximo login.
        Quem tem acesso ao link no Hub mas não está aqui recebe cookie de usuário comum automaticamente.
        Mudanças valem no <strong>próximo login</strong> da conta afetada.
      </p>

      {/* Adicionar — autocomplete com sugestoes de emails cadastrados no Hub.
          Dropdown renderizada em position:fixed para nao ser cortada pelo modal.
          Ordem: admins do Hub primeiro, depois alfabetica. Emails ja admins do
          site atual nao aparecem (filtra para evitar duplicacao). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div ref={inputWrapRef} style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <input type="email" value={novoEmail}
            onChange={e => { setNovoEmail(e.target.value); setSugAberto(true); setSugHighlight(0); }}
            onFocus={() => setSugAberto(true)}
            onBlur={() => setTimeout(() => setSugAberto(false), 180)}
            aria-label="E-mail do usuário a liberar acesso"
            aria-autocomplete="list"
            aria-expanded={sugAberto}
            onKeyDown={e => {
              if (!sugAberto) return;
              const adminsSet = new Set((items || []).filter(x => x.papel && x.papel !== 'usuario').map(x => (x.email || '').toLowerCase()));
              const q = (novoEmail || '').trim().toLowerCase();
              const cands = (usersFresh || [])
                .filter(u => u && u.email && !adminsSet.has(u.email.toLowerCase()))
                .filter(u => !q || u.email.toLowerCase().includes(q) || (u.nome || '').toLowerCase().includes(q))
                .sort((a, b) => {
                  const da = (a.tipo === 'admin' || a.is_master) ? 0 : 1;
                  const db = (b.tipo === 'admin' || b.is_master) ? 0 : 1;
                  return da !== db ? da - db : (a.nome || a.email || '').localeCompare(b.nome || b.email || '', 'pt-BR', { sensitivity: 'base' });
                }).slice(0, 30);
              if (e.key === 'ArrowDown') { e.preventDefault(); setSugHighlight(h => Math.min(h + 1, cands.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSugHighlight(h => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter' && cands[sugHighlight]) { e.preventDefault(); setNovoEmail(cands[sugHighlight].email); setSugAberto(false); }
              else if (e.key === 'Escape') { setSugAberto(false); }
            }}
            placeholder="Digite para buscar um e-mail cadastrado…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: `1px solid ${HUB_PALETTE.champanhe}`, color: HUB_PALETTE.marfim, padding: '10px 14px', fontFamily: 'Inter, sans-serif', fontSize: 13 }} />
          {sugAberto && popRect && (() => {
            const q = (novoEmail || '').trim().toLowerCase();
            const adminsSet = new Set((items || []).filter(x => x.papel && x.papel !== 'usuario').map(x => (x.email || '').toLowerCase()));
            const candidatos = (usersFresh || [])
              .filter(u => u && u.email)
              // 3) ja selecionado nao aparece
              .filter(u => !adminsSet.has(u.email.toLowerCase()))
              .filter(u => !q || u.email.toLowerCase().includes(q) || (u.nome || '').toLowerCase().includes(q))
              .sort((a, b) => {
                // 2) admins do Hub primeiro, depois ordem alfabetica
                const ehAdminA = (a.tipo === 'admin' || a.is_master) ? 0 : 1;
                const ehAdminB = (b.tipo === 'admin' || b.is_master) ? 0 : 1;
                if (ehAdminA !== ehAdminB) return ehAdminA - ehAdminB;
                return (a.nome || a.email || '').localeCompare(b.nome || b.email || '', 'pt-BR', { sensitivity: 'base' });
              })
              .slice(0, 30);
            if (!candidatos.length) return null;
            return (
              <div style={{ position: 'fixed', top: popRect.top, left: popRect.left, width: popRect.width, background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}77`, zIndex: 9999, maxHeight: 280, overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
                {candidatos.map((u, ci) => {
                  const ehAdmin = u.tipo === 'admin' || u.is_master;
                  return (
                    <div key={u.email}
                      onMouseDown={e => { e.preventDefault(); setNovoEmail(u.email); setSugAberto(false); }}
                      onMouseEnter={() => setSugHighlight(ci)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}1a`, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.marfim, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', background: ci === sugHighlight ? HUB_PALETTE.areiaDim + '22' : 'transparent', transition: 'background 120ms' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {u.email}
                        {ehAdmin && <span style={{ marginLeft: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, border: `1px solid ${HUB_PALETTE.champanhe}55`, padding: '1px 6px' }}>admin TI</span>}
                      </span>
                      {u.nome && <span style={{ color: HUB_PALETTE.areiaDim, fontSize: 11.5, whiteSpace: 'nowrap' }}>{u.nome}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        {ehPesquisa && (
          <select value={novoPapel} onChange={e => setNovoPapel(e.target.value)} disabled={busy}
            aria-label="Papel do usuário no sistema"
            style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.champanhe}`, padding: '10px 12px', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 13 }}
            title="Papel: master vê e edita tudo · admin só vê · spa edita Spa · satisfação edita Relatórios · massoterapeuta acessa ficha de anamnese">
            <option value="master"          style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Master</option>
            <option value="admin"           style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Admin (só ver)</option>
            <option value="spa"             style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Spa</option>
            <option value="satisfacao"      style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Satisfação</option>
            <option value="massoterapeuta"  style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Massoterapeuta</option>
          </select>
        )}
        <button onClick={adicionar} disabled={busy} style={{ background: HUB_PALETTE.champanhe + '22', border: `1px solid ${HUB_PALETTE.champanhe}55`, color: HUB_PALETTE.champanhe, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 13, letterSpacing: '0.02em', textTransform: 'none', padding: '10px 18px', cursor: busy ? 'wait' : 'pointer' }}>
          + Adicionar
        </button>
      </div>
      {erro && <div style={{ color: '#E07A5F', fontFamily: 'Inter, sans-serif', fontSize: 13, marginBottom: 14 }}>{erro}</div>}

      {confirmRemover && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 420, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#9C5843', marginBottom: 6 }}>Confirmar remoção</div>
            <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 10px', lineHeight: 1.25 }}>
              Remover acesso de {sistemaNome}?
            </h3>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 4px', lineHeight: 1.5 }}>
              <strong style={{ color: HUB_PALETTE.marfim }}>{confirmRemover.email}</strong>
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 24px', lineHeight: 1.5 }}>
              Perderá o acesso de admin no próximo login. Esta ação pode ser desfeita adicionando o e-mail novamente.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmRemover(null)}
                style={{ background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '10px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={executarRemover}
                style={{ background: '#9C5843', border: '1px solid #9C5843', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 13, letterSpacing: 'normal', textTransform: 'none', padding: '10px 22px', cursor: 'pointer' }}>
                Remover acesso
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div style={subTitulo}>Acessos ({admins.length})</div>
      <div style={lista}>
        {items === null && <div style={{ ...item, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Carregando…</div>}
        {items !== null && admins.length === 0 && <div style={{ ...item, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhum admin definido. Adicione contas acima.</div>}
        {items !== null && admins.length > 0 && (() => {
          const PAPEL_ORDEM = ['master', 'spa', 'satisfacao', 'admin', 'massoterapeuta'];
          const PAPEL_LABEL = { master: 'Master', spa: 'Spa', satisfacao: 'Satisfação', admin: 'Admin', massoterapeuta: 'Massoterapeuta' };
          const grupos = PAPEL_ORDEM
            .map(papel => ({
              papel,
              label: PAPEL_LABEL[papel],
              items: admins.filter(x => (x.papel || 'admin') === papel).sort((a, b) => a.email.localeCompare(b.email)),
            }))
            .filter(g => g.items.length > 0);
          return grupos.map((grupo, gi) => (
            <React.Fragment key={grupo.papel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: gi === 0 ? '4px 0 6px' : '18px 0 6px' }}>
                <div style={{ flex: 1, height: '1px', background: `${HUB_PALETTE.champanhe}28` }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5, letterSpacing: '0.32em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, whiteSpace: 'nowrap' }}>
                  {grupo.label}&nbsp;·&nbsp;{grupo.items.length}
                </span>
                <div style={{ flex: 1, height: '1px', background: `${HUB_PALETTE.champanhe}28` }} />
              </div>
              {grupo.items.map(x => (
                <div key={'a-' + x.email} style={item}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.email}</span>
                  {ehPesquisa ? (
                    <select value={x.papel || 'admin'} onChange={e => trocarPapel(x.email, e.target.value)} disabled={busy}
                      style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.champanhe}`, padding: '4px 8px', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12 }}
                      title="Mudar papel">
                      <option value="master"         style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Master</option>
                      <option value="admin"          style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Admin</option>
                      <option value="spa"            style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Spa</option>
                      <option value="satisfacao"     style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Satisfação</option>
                      <option value="massoterapeuta" style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Massoterapeuta</option>
                    </select>
                  ) : null}
                  <button onClick={() => remover(x.email)} disabled={busy} style={{ ...btn, color: '#E07A5F', borderColor: '#E07A5F44' }} title="Remover acesso de admin">× Remover</button>
                </div>
              ))}
            </React.Fragment>
          ));
        })()}
      </div>

    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

function HubAdmin({ onClose, hubSystems, setHubSystems }) {
  const isMobile = useWindowWidth() < 768;
  const isPhone = useWindowWidth() < 480;
  const [aba, _setAba] = useState(() => {
    try {
      const v = sessionStorage.getItem('hub_admin_aba');
      return ['contas', 'setores', 'links', 'historico', 'feriados', 'ausencias', 'aptos', 'cortesias', 'urnas'].includes(v) ? v : 'contas';
    } catch { return 'contas'; }
  });
  const setAba = (v) => { try { sessionStorage.setItem('hub_admin_aba', v); } catch {} _setAba(v); };
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [saving, setSaving] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null); // null | { email, systemId, nome, sistemaNome }

  // Links tab state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  // Snapshot do link no momento do startEdit; usado para detectar 'nada mudou'.
  const [editOriginal, setEditOriginal] = useState({});
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState({ nome: '', url: '', status: 'no-ar', categoria: '', descricao: '', acessoPadrao: false, setoresAcesso: [], sso: false });
  const [setoresLista, setSetoresLista] = useState([]);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkErro, setLinkErro] = useState('');
  const [expandedLink, setExpandedLink] = useState(null);
  const [filtroSemAcesso, setFiltroSemAcesso] = useState('');
  const [filtroLinks, setFiltroLinks] = useState('ativos');
  const [sitePermissions, setSitePermissions] = useState([]);
  // Toast simples para feedback de Links (sucesso/erro). Auto-some em 2.6s.
  const [linkToast, setLinkToast] = useState(null); // { msg, err: boolean }
  function notifyLink(msg, err) { setLinkToast({ msg, err: !!err }); setTimeout(() => setLinkToast(null), 2600); }

  const noArSystems = hubSystems.filter(s => s.status === 'no-ar');

  useEffect(() => {
    const token = localStorage.getItem('hub_sso_token');
    Promise.all([
      fetch('/api/admin/all-users', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/admin/data', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/admin/chamados-setores', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
      fetch('/api/admin/site-permissions', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => []),
    ]).then(([allUsers, hubData, setoresData, spData]) => {
      setUsers(allUsers.users || []);
      setPermissions(hubData.permissions || {});
      if (setoresData && setoresData.ok) setSetoresLista(setoresData.setores || []);
      setSitePermissions(Array.isArray(spData) ? spData : (spData && Array.isArray(spData.items)) ? spData.items : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Mesma regra do back-end (server.js#temAcessoAoSistema). Admin/master
  // sempre veem todos; demais precisam do id explicito no array.
  function isAllowed(email, systemId) {
    const u = users.find(x => x.email === email);
    if (u && (u.tipo === 'admin' || u.is_master)) return true;
    const p = permissions[email];
    return Array.isArray(p) && p.includes(systemId);
  }

  async function toggleSystem(email, systemId) {
    const current = permissions[email];
    let nova;
    if (!Array.isArray(current)) {
      // Usuario sem entrada explicita: criar lista contendo apenas o id liberado.
      nova = [systemId];
    } else if (current.includes(systemId)) {
      nova = current.filter(id => id !== systemId);
    } else {
      nova = [...current, systemId];
    }
    // Snapshot do estado anterior para reverter em caso de falha do servidor.
    const anterior = permissions[email];
    setPermissions(prev => ({ ...prev, [email]: nova }));
    setSaving(email + systemId);
    try {
      const r = await hubFetch('/api/admin/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, sistemas: nova }),
      });
      if (!r.ok) throw new Error('falha');
      notifyHubMutation();
    } catch {
      // Reverte exatamente para o que estava antes (inclusive undefined).
      setPermissions(prev => {
        const n = { ...prev };
        if (anterior === undefined) delete n[email]; else n[email] = anterior;
        return n;
      });
      alert('Não foi possível salvar a permissão. Tente novamente.');
    } finally {
      setSaving(null);
    }
  }

  async function resetPermissions(email) {
    const anterior = permissions[email];
    setPermissions(prev => { const n = { ...prev }; delete n[email]; return n; });
    try {
      const r = await hubFetch(`/api/admin/permissions/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('falha');
      notifyHubMutation();
    } catch {
      setPermissions(prev => ({ ...prev, [email]: anterior }));
      alert('Não foi possível resetar as permissões. Tente novamente.');
    }
  }

  function startEdit(sys) {
    setEditingId(sys.id);
    // sso: cards antigos nao tem o campo — deriva do padrao (origem interna)
    // para que abrir e salvar a edicao nao desligue o SSO sem querer.
    // id vai junto so para o formulario derivar o SSO por sistema conhecido;
    // o PUT ignora esse campo (o id vem da rota).
    const initial = { id: sys.id, nome: sys.nome, url: sys.url, status: sys.status, categoria: sys.categoria || '', descricao: sys.descricao || '', acessoPadrao: !!sys.acessoPadrao, setoresAcesso: sys.setoresAcesso || [], sso: cardUsaSso(sys) };
    setEditForm(initial);
    setEditOriginal(initial);
    setLinkErro('');
  }

  async function saveEdit() {
    if (!editForm.nome || !editForm.status) { setLinkErro('Nome e status são obrigatórios'); return; }
    // Bloqueia salvar se nada mudou em relacao ao snapshot do startEdit.
    const camposLink = ['nome', 'url', 'status', 'categoria', 'descricao', 'acessoPadrao', 'sso'];
    const algumMudou = camposLink.some(k => (editOriginal[k] ?? '') !== (editForm[k] ?? ''))
      || JSON.stringify(editOriginal.setoresAcesso || []) !== JSON.stringify(editForm.setoresAcesso || []);
    if (!algumMudou) {
      const msg = 'Faça alguma alteração antes de salvar.';
      setLinkErro(msg);
      notifyLink(msg, true);
      return;
    }
    setLinkSaving(true);
    try {
      const r = await hubFetch(`/api/admin/sistemas/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        const msg = d.erro || `Erro ao salvar (${r.status})`;
        setLinkErro(msg);
        notifyLink(msg, true);
        return;
      }
      setHubSystems(prev => prev.map(s => s.id === editingId ? { ...s, ...d.sistema } : s));
      setEditingId(null);
      notifyHubMutation();
      notifyLink('Link atualizado.');
    } catch {
      const msg = 'Erro de conexão';
      setLinkErro(msg);
      notifyLink(msg, true);
    } finally {
      setLinkSaving(false);
    }
  }

  async function deleteLink(id) {
    if (!confirm('Apagar este link definitivamente?')) return;
    const anteriores = hubSystems;
    setHubSystems(prev => prev.filter(s => s.id !== id));
    if (expandedLink === id) setExpandedLink(null);
    try {
      const r = await hubFetch(`/api/admin/sistemas/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('falha');
      notifyHubMutation();
    } catch {
      setHubSystems(anteriores);
      alert('Não foi possível apagar o link. Tente novamente.');
    }
  }

  async function saveNew() {
    if (!newForm.nome || !newForm.status) { setLinkErro('Nome e status são obrigatórios'); return; }
    setLinkSaving(true);
    try {
      const r = await hubFetch('/api/admin/sistemas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        const msg = d.erro || `Erro ao salvar (${r.status})`;
        setLinkErro(msg);
        notifyLink(msg, true);
        return;
      }
      setHubSystems(prev => [...prev, d.sistema]);
      setAddingNew(false);
      setNewForm({ nome: '', url: '', status: 'no-ar', categoria: '', descricao: '', acessoPadrao: false, setoresAcesso: [], sso: false });
      notifyHubMutation();
      notifyLink('Link criado.');
    } catch {
      const msg = 'Erro de conexão';
      setLinkErro(msg);
      notifyLink(msg, true);
    } finally {
      setLinkSaving(false);
    }
  }

  const ABAS = [
    { id: 'contas', label: 'Usuários' },
    { id: 'setores', label: 'Setores' },
    { id: 'links', label: 'Links' },
    { id: 'feriados', label: 'Feriados' },
    { id: 'ausencias', label: 'Ausências' },
    { id: 'aptos', label: 'UHs' },
    { id: 'cortesias', label: 'Cortesias' },
    { id: 'urnas', label: 'Urnas' },
    { id: 'historico', label: 'Histórico' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, background: HUB_PALETTE.noite, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: HUB_PALETTE.headerBg, backdropFilter: 'blur(10px)', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, flexShrink: 0 }}>
        <div style={{ padding: isMobile ? '14px 18px' : '20px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.champanhe} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 500, fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areia }}>Administração • Hub</span>
          </div>
          <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', padding: '8px 16px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '88'; }}
            onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Fechar
          </button>
        </div>
        {/* Tabs */}
        <div className="hub-tabs-scroll" style={{ display: 'flex', padding: isMobile ? '0 18px' : '0 48px', gap: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {ABAS.map(a => (
            <button key={a.id} onClick={() => { setAba(a.id); setEditingId(null); setAddingNew(false); setLinkErro(''); }}
              style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${aba === a.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: aba === a.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: isMobile ? 9 : 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: isMobile ? '12px 13px 10px' : '12px 20px 10px', cursor: 'pointer', transition: `color 200ms, border-color 200ms`, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: isPhone ? '16px 12px 80px' : isMobile ? '24px 18px 80px' : '48px 48px 80px', width: '100%' }}>

        {/* ── Aba Links ── */}
        {aba === 'links' && (<>
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Gerenciar Links
            </div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'flex-end', justifyContent: 'space-between', gap: isMobile ? 16 : 32 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Links do Hub.</h2>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
                  Edite os sistemas existentes ou adicione novos links ao Hub.
                </p>
              </div>
              <button onClick={() => { setAddingNew(true); setEditingId(null); setLinkErro(''); }}
                style={{ flexShrink: 0, marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#996442', border: '1px solid #996442', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 12, letterSpacing: 'normal', textTransform: 'none', padding: '10px 20px', cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar novo link
              </button>
            </div>
          </div>

          {/* Filtro Ativos / Inativos */}
          {(() => {
            const nAtivos = hubSystems.filter(s => s.status === 'no-ar').length;
            const nInativos = hubSystems.filter(s => s.status !== 'no-ar').length;
            const tabs = [{ id: 'ativos', label: 'Ativos', count: nAtivos }, { id: 'inativos', label: 'Inativos', count: nInativos }];
            return (
              <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
                {tabs.map(t => {
                  const active = filtroLinks === t.id;
                  return (
                    <button key={t.id} onClick={() => { setFiltroLinks(t.id); setExpandedLink(null); setFiltroSemAcesso(''); }}
                      style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? HUB_PALETTE.champanhe : 'transparent'}`, color: active ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', padding: '10px 20px 8px', cursor: 'pointer', transition: 'color 200ms, border-color 200ms', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {t.label}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, background: active ? `${HUB_PALETTE.champanhe}20` : `${HUB_PALETTE.areiaDim}15`, color: active ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, padding: '1px 6px', borderRadius: 2, transition: 'background 200ms, color 200ms' }}>{t.count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {hubSystems.filter(sys => filtroLinks === 'ativos' ? sys.status === 'no-ar' : sys.status !== 'no-ar').map(sys => {
              const isLinkOpen = expandedLink === sys.id;
              // Mesma regra do back-end: admin/master sempre tem acesso; demais
              // precisam do id no array (undefined/null/vazio = sem acesso).
              const _ns = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
              const setoresNorm = new Set((sys.setoresAcesso || []).map(_ns).filter(Boolean));
              const comAcessoExplicito = users.filter(u => {
                if (u.tipo === 'admin' || u.is_master) return true;
                const p = permissions[u.email];
                return Array.isArray(p) && p.includes(sys.id);
              });
              const comAcessoViaSetor = !sys.acessoPadrao && setoresNorm.size > 0
                ? users.filter(u => {
                    if (u.tipo === 'admin' || u.is_master) return false;
                    const p = permissions[u.email];
                    if (Array.isArray(p) && p.includes(sys.id)) return false;
                    return !!_ns(u.setor) && setoresNorm.has(_ns(u.setor));
                  })
                : [];
              const emailsExplicito = new Set(comAcessoExplicito.map(u => String(u.email).toLowerCase()));
              const emailsViaSetor = new Set(comAcessoViaSetor.map(u => String(u.email).toLowerCase()));
              const sitePermEmailsParaSys = new Set(
                sitePermissions.filter(r => r.sistema_id === sys.id).map(r => String(r.email).toLowerCase())
              );
              const comAcessoViaSitePerm = users.filter(u => {
                if (u.tipo === 'admin' || u.is_master) return false;
                const email = String(u.email).toLowerCase();
                if (emailsExplicito.has(email) || emailsViaSetor.has(email)) return false;
                return sitePermEmailsParaSys.has(email);
              });
              const comAcesso = [...comAcessoExplicito, ...comAcessoViaSetor, ...comAcessoViaSitePerm];
              const semAcesso = sys.acessoPadrao ? [] : users.filter(u => {
                if (u.tipo === 'admin' || u.is_master) return false;
                const email = String(u.email).toLowerCase();
                const p = permissions[u.email];
                const temExplicito = Array.isArray(p) && p.includes(sys.id);
                const temSetor = setoresNorm.size > 0 && !!_ns(u.setor) && setoresNorm.has(_ns(u.setor));
                const temSitePerm = sitePermEmailsParaSys.has(email);
                return !temExplicito && !temSetor && !temSitePerm;
              });
              return (
                <div key={sys.id} style={{ borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
                  {/* Fase 3: edicao agora abre modal (renderizado uma vez no fim do componente). */}
                  {(
                    <div
                      onClick={() => { if (editingId) return; setExpandedLink(isLinkOpen ? null : sys.id); setFiltroSemAcesso(''); }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0', gap: 16, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: HUB_PALETTE.areiaDim, flexShrink: 0 }}>{sys.num}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 17, color: HUB_PALETTE.marfim, lineHeight: 1.2 }}>{sys.nome}</div>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: HUB_PALETTE.areiaDim, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 140 : 300 }}>{sys.url}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: STATUS_CORES[sys.status] || HUB_PALETTE.areiaDim, padding: '3px 8px', border: `1px solid ${(STATUS_CORES[sys.status] || HUB_PALETTE.areiaDim) + '44'}` }}>
                          {STATUS_LABELS[sys.status] || sys.status}
                        </span>
                        <button onClick={e => { e.stopPropagation(); startEdit(sys); setExpandedLink(null); }}
                          style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '6px 14px', cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '66'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '33'; }}>
                          Editar
                        </button>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ transform: isLinkOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: `transform 300ms ${HUB_EASE}`, flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
                      </div>
                    </div>
                  )}

                  {/* Expanded: usuários com e sem acesso */}
                  {isLinkOpen && !editingId && (
                    <div style={{ paddingBottom: 28, paddingLeft: 36 }}>
                      {/* Com acesso */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, display: 'inline-block' }} />
                          Com acesso ({comAcesso.length})
                        </div>
                        {sys.acessoPadrao ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#996442', background: '#99644210', border: '1px solid #99644233', padding: '6px 14px' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#996442" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                            Acesso Padrão — todos os colaboradores
                          </div>
                        ) : comAcesso.length === 0 ? (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhum usuário com acesso.</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {comAcessoExplicito.map(u => (
                              <span key={u.email}
                                onClick={() => setConfirmToggle({ email: u.email, systemId: sys.id, nome: u.nome, sistemaNome: sys.nome })}
                                title="Clique para remover acesso"
                                style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, background: `${HUB_PALETTE.areiaDim}10`, border: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: '4px 12px', cursor: 'pointer', userSelect: 'none' }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#9C5843'; e.currentTarget.style.borderColor = '#9C5843'; e.currentTarget.style.color = '#ECE4D2'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = `${HUB_PALETTE.areiaDim}10`; e.currentTarget.style.borderColor = `${HUB_PALETTE.areiaDim}22`; e.currentTarget.style.color = HUB_PALETTE.areia; }}>
                                {u.nome.split(' ')[0]}{u.setor ? <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>{u.setor}</span> : null}
                              </span>
                            ))}
                            {comAcessoViaSetor.map(u => (
                              <span key={u.email}
                                title={`Acesso automático via setor ${u.setor} — configure em Acesso por Setor`}
                                style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, background: `${HUB_PALETTE.champanhe}08`, border: `1px solid ${HUB_PALETTE.champanhe}22`, padding: '4px 12px', cursor: 'default', userSelect: 'none', opacity: 0.75 }}>
                                {u.nome.split(' ')[0]}{u.setor ? <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>{u.setor}</span> : null}
                              </span>
                            ))}
                            {comAcessoViaSitePerm.map(u => (
                              <span key={u.email}
                                title="Acesso via papel no sistema — gerencie em Liberações"
                                style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#8FA88A', background: '#8FA88A0D', border: '1px solid #8FA88A33', padding: '4px 12px', cursor: 'default', userSelect: 'none', opacity: 0.8 }}>
                                {u.nome.split(' ')[0]}{u.setor ? <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>{u.setor}</span> : null}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Sem acesso */}
                      <div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUB_PALETTE.areiaDim + '66', display: 'inline-block' }} />
                          Sem acesso ({semAcesso.length})
                        </div>
                        {semAcesso.length === 0 ? (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Todos têm acesso a este link.</span>
                        ) : (
                          <>
                            <div style={{ position: 'relative', marginBottom: 12 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                              </svg>
                              <input
                                type="text"
                                placeholder="Filtrar por nome ou setor..."
                                value={filtroSemAcesso}
                                onChange={e => setFiltroSemAcesso(e.target.value)}
                                autoComplete="off" name="sem-acesso-busca" spellCheck={false}
                                style={{ width: '100%', boxSizing: 'border-box', background: `${HUB_PALETTE.areiaDim}10`, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '7px 12px 7px 30px', outline: 'none' }}
                              />
                            </div>
                            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: `1px solid ${HUB_PALETTE.areiaDim}18`, scrollbarWidth: 'thin', scrollbarColor: `${HUB_PALETTE.areiaDim}44 transparent` }}>
                              {semAcesso
                                .filter(u => u.nome.toLowerCase().includes(filtroSemAcesso.toLowerCase()) || (u.setor && u.setor.toLowerCase().includes(filtroSemAcesso.toLowerCase())))
                                .sort((a, b) => {
                                  const sa = (a.setor || '￿').toLowerCase();
                                  const sb = (b.setor || '￿').toLowerCase();
                                  if (sa !== sb) return sa.localeCompare(sb, 'pt');
                                  return (a.nome || '').toLowerCase().localeCompare((b.nome || '').toLowerCase(), 'pt');
                                })
                                .map(u => (
                                <div key={u.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 10px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}10` }}>
                                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim }}>{u.nome}{u.setor ? <span style={{ fontSize: 11, marginLeft: 6 }}>{u.setor}</span> : null}</span>
                                  <button
                                    onClick={() => toggleSystem(u.email, sys.id)}
                                    disabled={!!saving}
                                    style={{ background: `${HUB_PALETTE.champanhe}12`, border: `1px solid ${HUB_PALETTE.champanhe}44`, color: HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '5px 14px', cursor: saving ? 'wait' : 'pointer', flexShrink: 0 }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '88'}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '44'}>
                                    Liberar
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </>)}

        {/* ── Aba Contas ── */}
        {aba === 'contas' && <ContasPanel isMobile={isMobile} />}

        {/* ── Aba Setores ── */}
        {aba === 'setores' && <SetoresPanel isMobile={isMobile} />}

        {/* ── Aba Feriados ── */}
        {aba === 'feriados' && <FeriadosPanel isMobile={isMobile} />}

        {/* ── Aba Ausências ── */}
        {aba === 'ausencias' && <AusenciasPanel isMobile={isMobile} />}

        {/* ── Aba UHs ── */}
        {aba === 'aptos' && <UHsPanel isMobile={isMobile} />}

        {/* ── Aba Cortesias ── */}
        {aba === 'cortesias' && <CortesiasPanel isMobile={isMobile} />}

        {/* ── Aba Urnas ── */}
        {aba === 'urnas' && <UrnasPanel isMobile={isMobile} />}

        {/* ── Aba Historico ── */}
        {aba === 'historico' && <HistoricoPanel isMobile={isMobile} />}

      </div>
      {linkToast && (
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: linkToast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: linkToast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
          {linkToast.msg}
        </div>
      )}
      {confirmToggle && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 420, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#9C5843', marginBottom: 6 }}>Confirmar remoção</div>
            <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 10px', lineHeight: 1.25 }}>
              Remover acesso de {confirmToggle.sistemaNome}?
            </h3>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 4px', lineHeight: 1.5 }}>
              <strong style={{ color: HUB_PALETTE.marfim }}>{confirmToggle.nome}</strong>
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 24px', lineHeight: 1.5 }}>
              O usuário perderá acesso a este sistema. Pode ser revertido clicando em "Liberar" na lista abaixo.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmToggle(null)}
                style={{ background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '10px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={() => { const { email, systemId } = confirmToggle; setConfirmToggle(null); toggleSystem(email, systemId); }}
                style={{ background: '#9C5843', border: '1px solid #9C5843', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 13, letterSpacing: 'normal', textTransform: 'none', padding: '10px 22px', cursor: 'pointer' }}>
                Remover acesso
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Fase 3: modal de edicao de link (substitui edicao inline). */}
      {editingId && (() => {
        const sys = hubSystems.find(s => s.id === editingId);
        if (!sys) return null;
        return (
          <LinkEditModal sys={sys} form={editForm} setForm={setEditForm} onSave={saveEdit}
            onCancel={() => { setEditingId(null); setLinkErro(''); }}
            linkErro={linkErro} linkSaving={linkSaving} isMobile={isMobile} users={users} setoresLista={setoresLista} />
        );
      })()}
      {addingNew && (
        <LinkCreateModal form={newForm} setForm={setNewForm} onSave={saveNew}
          onCancel={() => { setAddingNew(false); setLinkErro(''); }}
          linkErro={linkErro} linkSaving={linkSaving} isMobile={isMobile} setoresLista={setoresLista} />
      )}
    </div>
  );
}

// ─── Urnas ───────────────────────────────────────────────────────────────────
const PESQUISAS_URNAS = [
  { id: 'geral',           label: 'Geral da Qualidade',   cor: '#6366F1' },
  { id: 'geral-granclass', label: 'Geral Gran Class',     cor: '#8B5CF6' },
  { id: 'pdvs',            label: 'PDVs',                 cor: '#F59E0B' },
  { id: 'pdvs-granclass',  label: 'PDVs Gran Class',      cor: '#D97706' },
  { id: 'spa',             label: 'Gran SPA',             cor: '#10B981' },
  { id: 'eventos-sociais', label: 'Eventos Sociais',      cor: '#3B82F6' },
  { id: 'eventos-corp',    label: 'Eventos Corporativos', cor: '#0EA5E9' },
];

function UrnasPanel({ isMobile }) {
  const [urnas, setUrnas] = useState(null);
  const [modal, setModal] = useState(null); // null | { modo: 'novo'|'editar', urna? }
  const [form, setForm] = useState({ nome: '', pesquisas: [] });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  function tok() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, err) { setToast({ msg, err: !!err }); setTimeout(() => setToast(null), 2800); }

  async function carregar() {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch('/api/admin/urnas', { headers: { Authorization: `Bearer ${tok()}` }, signal: ctrl.signal });
      clearTimeout(tid);
      const d = await r.json();
      setUrnas(d.urnas || []);
    } catch { clearTimeout(tid); setUrnas([]); }
  }

  useEffect(() => { carregar(); }, []);

  function abrirNovo() {
    setForm({ nome: '', pesquisas: [] });
    setModal({ modo: 'novo' });
  }

  function abrirEditar(urna) {
    setForm({ nome: urna.nome, pesquisas: [...(urna.pesquisas || [])] });
    setModal({ modo: 'editar', urna });
  }

  function togglePesquisa(id) {
    setForm(f => ({
      ...f,
      pesquisas: f.pesquisas.includes(id) ? f.pesquisas.filter(p => p !== id) : [...f.pesquisas, id],
    }));
  }

  async function salvar() {
    if (!form.nome.trim()) { notify('Nome obrigatório.', true); return; }
    setSaving(true);
    try {
      const isEdit = modal.modo === 'editar';
      const url = isEdit ? `/api/admin/urnas/${modal.urna.id}` : '/api/admin/urnas';
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ nome: form.nome.trim(), pesquisas: form.pesquisas }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erro || `Erro ${r.status}`);
      setModal(null);
      await carregar();
      notify(isEdit ? 'Urna atualizada.' : 'Urna criada.');
    } catch (e) { notify(e.message || 'Erro de conexão.', true); }
    setSaving(false);
  }

  async function excluir(urna) {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/urnas/${urna.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok()}` } });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erro || `Erro ${r.status}`);
      setConfirmDel(null);
      await carregar();
      notify('Urna removida.');
    } catch (e) { notify(e.message || 'Erro de conexão.', true); }
    setSaving(false);
  }

  const pesquisaMap = Object.fromEntries(PESQUISAS_URNAS.map(p => [p.id, p]));

  const U = {
    mono: 'JetBrains Mono, monospace',
    sans: 'Inter, sans-serif',
    text: HUB_PALETTE.marfim,
    muted: HUB_PALETTE.areiaDim,
    accent: HUB_PALETTE.champanhe,
    surface: HUB_PALETTE.noiteAlt,
    border: 'rgba(138,123,106,0.18)',
    borderStrong: 'rgba(138,123,106,0.35)',
    modalBg: '#18211e',
    inputBg: '#111a17',
    // cores fixas para interior do modal (fundo sempre escuro)
    mText: '#ECE4D2',
    mMuted: '#8A7B6A',
  };

  const btnPrimary = {
    background: U.accent, color: U.text, border: 'none', borderRadius: 3,
    padding: '8px 18px', fontFamily: U.mono, fontSize: 10, letterSpacing: '0.22em',
    textTransform: 'uppercase', cursor: 'pointer', fontWeight: 700,
  };
  const btnSecondary = {
    background: 'transparent', color: U.muted, border: `1px solid ${U.borderStrong}`,
    borderRadius: 3, padding: '7px 16px', fontFamily: U.mono, fontSize: 10,
    letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer',
  };
  const inputStyle = {
    width: '100%', background: U.inputBg, border: `1px solid ${U.border}`,
    borderRadius: 3, padding: '10px 12px', color: U.text, fontFamily: U.sans,
    fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };
  const fieldLabel = {
    display: 'block', fontFamily: U.mono, fontSize: 9, letterSpacing: '0.3em',
    textTransform: 'uppercase', color: U.muted, marginBottom: 8,
  };

  if (urnas === null) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: U.muted, fontFamily: U.mono, fontSize: 11, letterSpacing: '0.2em' }}>
      CARREGANDO…
    </div>
  );

  const IcoPencil = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
  const IcoTrash = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.err ? '#7a2020' : '#1a4a35', color: U.text, padding: '11px 18px', borderRadius: 4, fontFamily: U.mono, fontSize: 11, letterSpacing: '0.12em', boxShadow: '0 4px 24px rgba(0,0,0,.5)', border: `1px solid ${toast.err ? '#b04040' : '#2e7a55'}` }}>
          {toast.msg}
        </div>
      )}

      {/* Cabeçalho */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 16, height: 1, background: U.accent, display: 'block' }} />
          <span style={{ fontFamily: U.mono, fontSize: 9, letterSpacing: '0.4em', textTransform: 'uppercase', color: U.accent }}>Coleta de pesquisas</span>
        </div>
        <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 30 : 38, letterSpacing: '-0.02em', color: U.text, margin: '0 0 20px', lineHeight: 1.05 }}>
          Urnas.
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button style={btnPrimary} onClick={abrirNovo}>+ Nova urna</button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontFamily: U.mono, fontSize: 22, color: U.text, lineHeight: 1 }}>{urnas.length}</span>
            <span style={{ fontFamily: U.mono, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: U.muted }}>{urnas.length === 1 ? 'urna' : 'urnas'}</span>
          </div>
        </div>
      </div>

      {/* Separador */}
      <div style={{ height: 1, background: U.border, marginBottom: 4 }} />

      {/* Lista */}
      {urnas.length === 0 ? (
        <div style={{ padding: '56px 0', textAlign: 'center', color: U.muted, fontFamily: U.mono, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', opacity: 0.6 }}>
          Nenhuma urna cadastrada
        </div>
      ) : (
        <div>
          {urnas.map((u, i) => {
            const primeiraPesquisa = pesquisaMap[u.pesquisas?.[0]];
            const cor = primeiraPesquisa?.cor || U.accent;
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, padding: '15px 0 15px 16px', borderBottom: `1px solid ${U.border}`, position: 'relative', transition: 'background 120ms' }}>
                {/* Acento lateral colorido */}
                <span style={{ position: 'absolute', left: 0, top: '18%', bottom: '18%', width: 2, borderRadius: 2, background: cor }} />

                {/* Conteúdo */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: U.sans, fontWeight: 600, fontSize: 14, color: U.text, marginBottom: 8, lineHeight: 1.2 }}>
                    {u.nome}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(u.pesquisas || []).length === 0 ? (
                      <span style={{ fontFamily: U.mono, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: U.muted, opacity: 0.5 }}>sem pesquisa</span>
                    ) : (u.pesquisas || []).map(pid => {
                      const p = pesquisaMap[pid];
                      if (!p) return null;
                      return (
                        <span key={pid} style={{ background: p.cor, color: '#fff', fontFamily: U.mono, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 2, whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {p.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Ações */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => abrirEditar(u)} title="Editar" style={{ background: 'transparent', border: `1px solid ${U.border}`, borderRadius: 3, color: U.muted, cursor: 'pointer', padding: '6px 9px', lineHeight: 0, transition: 'border-color 120ms, color 120ms' }}
                    onMouseEnter={e => { e.currentTarget.style.color = U.text; e.currentTarget.style.borderColor = U.borderStrong; }}
                    onMouseLeave={e => { e.currentTarget.style.color = U.muted; e.currentTarget.style.borderColor = U.border; }}>
                    <IcoPencil />
                  </button>
                  <button onClick={() => setConfirmDel(u)} title="Excluir" style={{ background: 'transparent', border: '1px solid rgba(180,60,60,0.25)', borderRadius: 3, color: 'rgba(220,80,80,0.65)', cursor: 'pointer', padding: '6px 9px', lineHeight: 0, transition: 'border-color 120ms, color 120ms' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#e05555'; e.currentTarget.style.borderColor = 'rgba(220,80,80,0.55)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'rgba(220,80,80,0.65)'; e.currentTarget.style.borderColor = 'rgba(180,60,60,0.25)'; }}>
                    <IcoTrash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal criar/editar */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 8000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ background: U.modalBg, border: `1px solid ${U.borderStrong}`, borderRadius: 8, padding: 28, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Header modal */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <div style={{ fontFamily: U.mono, fontSize: 9, letterSpacing: '0.38em', textTransform: 'uppercase', color: U.accent, marginBottom: 4 }}>
                  {modal.modo === 'novo' ? 'Nova urna' : 'Editar urna'}
                </div>
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 22, color: U.mText, lineHeight: 1 }}>
                  {modal.modo === 'novo' ? 'Criar ponto de coleta' : form.nome || 'Editar'}
                </div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'transparent', border: 'none', color: U.mMuted, cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Campo nome */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ ...fieldLabel, color: U.mMuted }}>Nome da urna</label>
              <input style={{ ...inputStyle, color: U.mText }} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Recepção, Lobby Bar, Piscina…" onKeyDown={e => e.key === 'Enter' && salvar()} autoFocus />
            </div>

            {/* Pesquisas */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ ...fieldLabel, color: U.mMuted, marginBottom: 14 }}>Pesquisas vinculadas</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PESQUISAS_URNAS.map(p => {
                  const checked = form.pesquisas.includes(p.id);
                  return (
                    <label key={p.id} onClick={() => togglePesquisa(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '9px 12px', borderRadius: 4, border: `1px solid ${checked ? p.cor + 'aa' : 'rgba(138,123,106,0.22)'}`, background: checked ? p.cor + '22' : 'transparent', transition: 'all 130ms' }}>
                      <span style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${checked ? p.cor : U.mMuted}`, background: checked ? p.cor : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 130ms' }}>
                        {checked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="1.5 6 4.5 9 10.5 3"/></svg>}
                      </span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.cor, flexShrink: 0 }} />
                      <span style={{ fontFamily: U.sans, fontSize: 13, color: U.mText, flex: 1 }}>{p.label}</span>
                      {checked && <span style={{ background: p.cor, color: '#fff', fontFamily: U.mono, fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 2 }}>selecionada</span>}
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ height: 1, background: 'rgba(138,123,106,0.22)', marginBottom: 20 }} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={{ ...btnSecondary, color: U.mMuted, borderColor: 'rgba(138,123,106,0.4)' }} onClick={() => setModal(null)}>Cancelar</button>
              <button style={{ ...btnPrimary, color: U.mText, opacity: saving ? 0.55 : 1 }} onClick={salvar} disabled={saving}>
                {saving ? 'Salvando…' : modal.modo === 'novo' ? 'Criar urna' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar exclusão */}
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 8000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <div style={{ background: U.modalBg, border: '1px solid rgba(180,60,60,0.35)', borderRadius: 8, padding: 28, width: '100%', maxWidth: 360 }}>
            <div style={{ fontFamily: U.mono, fontSize: 9, letterSpacing: '0.38em', textTransform: 'uppercase', color: '#e05555', marginBottom: 12 }}>Confirmação</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 20, color: U.mText, marginBottom: 10, lineHeight: 1.2 }}>Excluir urna?</div>
            <div style={{ fontFamily: U.sans, fontSize: 13, color: U.mMuted, marginBottom: 26, lineHeight: 1.6 }}>
              <strong style={{ color: U.mText }}>{confirmDel.nome}</strong> será removida permanentemente. Esta ação não pode ser desfeita.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={{ ...btnSecondary, color: U.mMuted, borderColor: 'rgba(138,123,106,0.4)' }} onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button style={{ ...btnPrimary, color: U.mText, background: '#8b2020', opacity: saving ? 0.55 : 1 }} onClick={() => excluir(confirmDel)} disabled={saving}>
                {saving ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Historico (audit log de Administracao Hub) ─────────────────────────────
const _NOMES_ACAO_INVALIDOS = new Set(['desativado', 'ativado', 'excluído', 'excluido', 'criado', 'editado', 'promovido', 'rebaixado']);
function HistoricoPanel({ isMobile }) {
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos'); // todos | admin | usuario | setor | link | permissao

  async function carregar() {
    setLoading(true);
    try {
      const r = await hubFetch('/api/admin/audit-log?limit=1000');
      const d = await r.json().catch(() => ({}));
      setLog(r.ok && d.ok ? (d.log || []) : []);
    } catch { setLog([]); }
    finally { setLoading(false); }
  }
  // 1) Mount: carrega imediato.
  // 2) Listener 'hub:mutation': recarrega quando QUALQUER mutacao acontece
  //    no painel (link, permissao, usuario, setor). Sem isso o usuario tinha
  //    que clicar 'ATUALIZAR' para ver o evento que ele mesmo acabou de gerar.
  useEffect(() => {
    carregar();
    const onMut = () => { carregar(); };
    window.addEventListener('hub:mutation', onMut);
    return () => window.removeEventListener('hub:mutation', onMut);
  }, []);

  function localDateStr(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtHora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDateHeader(iso) {
    const d = new Date(iso);
    const hoje = new Date(); const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, hoje)) return 'Hoje · ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (sameDay(d, ontem)) return 'Ontem · ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }

  const ACTION_LABEL = {
    criar: 'Criado', editar: 'Editado',
    ativar: 'Ativado', inativar: 'Inativado',
    promover_master: 'Promovido a master', rebaixar_master: 'Rebaixado de master',
    trocar_senha: 'Senha alterada', etiquetas: 'Etiquetas atualizadas',
    excluir: 'Excluído',
    liberar_link: 'Liberou link', bloquear_link: 'Bloqueou link',
    resetar_permissoes: 'Permissões resetadas',
    site_admin_liberar: 'Admin de site', site_usuario_liberar: 'Usuário de site',
    site_acesso_remover: 'Acesso removido',
  };
  const ACTION_COR = {
    criar: '#3E8497', editar: HUB_PALETTE.champanhe,
    ativar: '#7cb342', inativar: '#9E6B43',
    promover_master: HUB_PALETTE.champanhe, rebaixar_master: '#9E6B43',
    trocar_senha: '#A1814E', etiquetas: HUB_PALETTE.champanhe,
    excluir: '#E07A5F',
    liberar_link: '#7cb342', bloquear_link: '#9E6B43',
    resetar_permissoes: '#3E8497',
    site_admin_liberar: HUB_PALETTE.champanhe,
    site_usuario_liberar: '#7cb342',
    site_acesso_remover: '#E07A5F',
  };
  const TARGET_LABEL = {
    admin: 'Admin', usuario: 'Usuário', setor: 'Setor', link: 'Link', permissao: 'Permissão',
  };
  const FIELD_LABEL = {
    nome_completo: 'Nome', nome: 'Nome', email: 'E-mail', ramal: 'Ramal', setor: 'Setor',
    is_master: 'Master', ativo: 'Ativo', _trocou_senha: 'Senha',
    slugs: 'Etiquetas',
    url: 'URL', status: 'Status', categoria: 'Categoria', descricao: 'Descrição',
    paraQuem: 'Para quem',
    nome_anterior: 'Nome antigo',
    link: 'Link',
  };
  function fmtVal(k, v) {
    if (k === 'is_master' || k === 'ativo' || k === '_trocou_senha') return v ? 'Sim' : 'Não';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    return String(v ?? '—');
  }

  // Gera frase em linguagem natural para o evento. Ex.: em vez de
  // [EDITADO] [ADMIN] Caio Holanda + linha NOME X EMAIL Y RAMAL Z SENHA Sim,
  // exibimos "Senha do admin Caio Holanda foi alterada".
  function descreverEvento(e) {
    const tipoCap = TARGET_LABEL[e.target_tipo] || e.target_tipo;
    const tipoMin = (tipoCap || '').toLowerCase();
    const nomeRaw = typeof e.target_nome === 'string' && _NOMES_ACAO_INVALIDOS.has(e.target_nome.toLowerCase()) ? null : e.target_nome;
    const alvo = nomeRaw || `#${e.target_id || ''}`;
    const c = e.campos || {};
    const keys = Object.keys(c);

    switch (e.action) {
      case 'criar':       return `${tipoCap} ${alvo} foi criado`;
      case 'excluir':     return `${tipoCap} ${alvo} foi excluído`;
      case 'ativar':      return `${tipoCap} ${alvo} foi ativado`;
      case 'inativar':    return `${tipoCap} ${alvo} foi desativado`;
      case 'promover_master': return `${tipoCap} ${alvo} foi promovido a master`;
      case 'rebaixar_master': return `${tipoCap} ${alvo} foi rebaixado de master`;
      case 'trocar_senha': return `Senha do ${tipoMin} ${alvo} foi alterada`;
      case 'etiquetas': {
        const n = Array.isArray(c.slugs) ? c.slugs.length : 0;
        return `Etiquetas do ${tipoMin} ${alvo} foram atualizadas (${n} ${n === 1 ? 'etiqueta' : 'etiquetas'})`;
      }
      case 'liberar_link':   return `${alvo || c.email} recebeu acesso a "${c.link || 'link'}"`;
      case 'bloquear_link':  return `${alvo || c.email} perdeu acesso a "${c.link || 'link'}"`;
      case 'resetar_permissoes': return `Permissões de ${alvo || c.email} foram resetadas`;
      // Eventos da aba Liberacao (popup de Link). Refletem mudancas no
      // banco site_permissions — quem recebe cookie de admin no proximo login.
      case 'site_admin_liberar':
        return c.papel_anterior === 'usuario'
          ? `${alvo || c.email} foi promovido a admin em "${c.link || 'sistema'}"`
          : `${alvo || c.email} recebeu permissão de admin em "${c.link || 'sistema'}"`;
      case 'site_usuario_liberar':
        return c.papel_anterior === 'admin'
          ? `${alvo || c.email} foi rebaixado a usuário em "${c.link || 'sistema'}"`
          : `${alvo || c.email} recebeu acesso comum em "${c.link || 'sistema'}"`;
      case 'site_acesso_remover':
        return `${alvo || c.email} perdeu permissão em "${c.link || 'sistema'}"`;
      case 'editar': {
        // Setor renomeado tem campos especiais
        if (e.target_tipo === 'setor' && c.nome_anterior && c.nome) {
          return `Setor "${c.nome_anterior}" foi renomeado para "${c.nome}"`;
        }
        // Lista de campos efetivamente alterados (excluindo metadados)
        const fields = keys.filter(k => k in FIELD_LABEL);
        if (fields.length === 0) return `${tipoCap} ${alvo} foi editado`;
        if (fields.length === 1) {
          const k = fields[0];
          if (k === '_trocou_senha') return `Senha do ${tipoMin} ${alvo} foi alterada`;
          if (k === 'is_master')     return c.is_master ? `${tipoCap} ${alvo} foi promovido a master` : `${tipoCap} ${alvo} foi rebaixado de master`;
          if (k === 'ativo')         return c.ativo ? `${tipoCap} ${alvo} foi ativado` : `${tipoCap} ${alvo} foi desativado`;
          if (k === 'slugs')         return `Etiquetas do ${tipoMin} ${alvo} foram atualizadas`;
          return `${FIELD_LABEL[k]} do ${tipoMin} ${alvo} foi alterado`;
        }
        // 2+ campos: lista com "e" antes do último
        const nomes = fields.map(k => k === '_trocou_senha' ? 'senha' : (FIELD_LABEL[k] || k).toLowerCase());
        const ultimo = nomes.pop();
        const lista = nomes.length ? `${nomes.join(', ')} e ${ultimo}` : ultimo;
        return `${tipoCap} ${alvo}: ${lista} alterados`;
      }
      default:
        return `${tipoCap} ${alvo}: ${e.action}`;
    }
  }

  // Tipo "logico" do evento: agrupa permissoes de link na aba "Links" porque
  // conceitualmente sao acoes sobre links (liberar/bloquear acesso, reset).
  function tipoLogico(e) {
    if (!e) return '';
    if (e.target_tipo === 'permissao'
      && (e.action === 'liberar_link' || e.action === 'bloquear_link' || e.action === 'resetar_permissoes'
        || e.action === 'site_admin_liberar' || e.action === 'site_usuario_liberar' || e.action === 'site_acesso_remover')) {
      return 'link';
    }
    return e.target_tipo;
  }
  // Fonte unica de verdade para filtros:
  // 1) logPorData aplica APENAS o filtro de data — usado para os contadores
  //    dos chips por tipo.
  // 2) filtrado adiciona o filtro de tipo (logico) — usado para renderizar a lista.
  const logPorData = (log || []).filter(e => !filterDate || localDateStr(e.at) === filterDate);
  const filtrado = logPorData.filter(e => filterTipo === 'todos' || tipoLogico(e) === filterTipo);

  const contagemPorTipo = logPorData.reduce((acc, e) => {
    const t = tipoLogico(e);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const totalGeral = logPorData.length;
  const totalSemFiltro = (log || []).length;

  // Agrupa por dia mantendo ordem (log ja vem reverse: mais recente primeiro)
  const grupos = (() => {
    if (!log) return null;
    const g = []; let atualKey = null; let atualLista = null;
    for (const e of filtrado) {
      const k = localDateStr(e.at);
      if (k !== atualKey) { atualKey = k; atualLista = []; g.push({ key: k, label: fmtDateHeader(e.at), itens: atualLista }); }
      atualLista.push(e);
    }
    return g;
  })();

  const cs = {
    input: { background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '10px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Histórico
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Alterações no painel.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Toda mudança em admins, usuários, setores, links e permissões fica registrada — quem fez e quando.
        {filterDate || filterTipo !== 'todos'
          ? ` Mostrando ${filtrado.length} de ${totalSemFiltro} eventos.`
          : ` ${totalSemFiltro} eventos no total.`}
      </p>
    </div>

    {/* Filtros por tipo (chips) — a aba 'Links' inclui acoes sobre links E
        acoes sobre permissoes de link (liberar/bloquear acesso, resetar). */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {[
        { id: 'todos', label: 'Todos', total: totalGeral },
        { id: 'admin', label: 'Admins', total: contagemPorTipo.admin || 0 },
        { id: 'usuario', label: 'Usuários', total: contagemPorTipo.usuario || 0 },
        { id: 'setor', label: 'Setores', total: contagemPorTipo.setor || 0 },
        { id: 'link', label: 'Links', total: contagemPorTipo.link || 0 },
      ].map(t => {
        const on = filterTipo === t.id;
        return (
          <button key={t.id} onClick={() => setFilterTipo(t.id)}
            style={{ background: on ? HUB_PALETTE.champanhe + '22' : 'transparent', border: `1px solid ${on ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim + '55'}`, color: on ? HUB_PALETTE.champanhe : HUB_PALETTE.areia, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: on ? 600 : 400, padding: '6px 12px', borderRadius: 999, cursor: 'pointer' }}>
            {t.label} <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: on ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, marginLeft: 4 }}>{t.total}</span>
          </button>
        );
      })}
    </div>

    {/* Toolbar */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22`, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, marginBottom: 0, flexWrap: 'wrap' }}>
      <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
        style={{ ...cs.input, padding: '8px 12px', width: 170, fontSize: 13 }} title="Filtrar por dia" />
      {filterDate && (
        <button onClick={() => setFilterDate('')} style={{ ...cs.btnGhost, padding: '8px 14px', fontSize: 10 }}>× Limpar</button>
      )}
      <button onClick={carregar} disabled={loading} style={{ ...cs.btnGhost, padding: '8px 14px', fontSize: 10, marginLeft: 'auto' }}>
        {loading ? '…' : '↻ Atualizar'}
      </button>
    </div>

    {/* Conteudo */}
    {log === null ? (
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', padding: '40px 0' }}>Carregando...</div>
    ) : filtrado.length === 0 && !filterDate ? (
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>Nenhum registro ainda.</div>
    ) : filtrado.length === 0 ? (
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>Nenhum registro neste dia.</div>
    ) : (
      <div>
        {grupos.map((gr, gi) => (
          <div key={gr.key} style={{ marginTop: gi === 0 ? 0 : 24 }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '12px 0', background: `linear-gradient(${HUB_PALETTE.noite}, ${HUB_PALETTE.noite} 80%, ${HUB_PALETTE.noite}00)`, borderBottom: `1px solid ${HUB_PALETTE.champanhe}44`, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic' }}>
              <span style={{ fontSize: 17, fontWeight: 500, color: HUB_PALETTE.marfim, textTransform: 'capitalize' }}>{gr.label}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontStyle: 'normal', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>
                {gr.itens.length} {gr.itens.length === 1 ? 'registro' : 'registros'}
              </span>
            </div>
            {gr.itens.map(e => {
              const cor = ACTION_COR[e.action] || HUB_PALETTE.areiaDim;
              const frase = descreverEvento(e);
              // Mostra detalhes (chave -> novo valor) apenas para "editar" com >=2 campos
              // ou quando o campo carrega informacao util (novo nome, novo email).
              // Acao com 1 campo ja esta toda na frase — esconder detalhes evita duplicar.
              const detalhesUteis = (() => {
                if (!e.campos) return [];
                const keys = Object.keys(e.campos).filter(k => k in FIELD_LABEL);
                if (e.action !== 'editar') return [];
                if (keys.length < 2) return [];
                return keys.filter(k => k !== '_trocou_senha' && k !== 'ativo' && k !== 'is_master' && k !== 'slugs');
              })();
              return (
                <div key={e.id} style={{ padding: '14px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.marfim, fontWeight: 500, flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                      {frase}
                    </span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.areia, whiteSpace: 'nowrap' }}>
                      por <strong style={{ color: HUB_PALETTE.champanhe, fontWeight: 600 }}>{e.by_nome || e.by_email}</strong>
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areiaDim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtHora(e.at)}</span>
                  </div>
                  {detalhesUteis.length > 0 && (
                    <div style={{ marginTop: 6, paddingLeft: 18, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                      {detalhesUteis.map(k => (
                        <span key={k} style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', marginRight: 5 }}>{FIELD_LABEL[k]}</span>
                          <span style={{ color: HUB_PALETTE.areia }}>{fmtVal(k, e.campos[k])}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    )}
  </>);
}

// ─── Massoterapeutas (ativar/inativar via S2S pesquisa-satisfacao) ──────────
function MassoterapeutasPanel({ isMobile }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [toggling, setToggling] = useState(null);
  const [toast, setToast] = useState(null);

  function notify(msg, isErr) {
    setToast({ msg, isErr: !!isErr });
    setTimeout(() => setToast(null), 2600);
  }

  async function load() {
    setErro('');
    try {
      const r = await hubFetch('/api/admin/massagistas');
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro || 'Erro ao carregar');
      setLista(d.items || []);
    } catch (e) {
      setErro(e.message || 'Erro de conexão');
      setLista([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleAtivo(m) {
    setToggling(m.id);
    try {
      const r = await hubFetch(`/api/admin/massagistas/${m.id}/ativo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: m.ativo ? 0 : 1 }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro || 'Falha');
      setLista(prev => prev.map(x => x.id === m.id ? { ...x, ativo: x.ativo ? 0 : 1 } : x));
      notify(m.ativo ? `${m.nome} inativada.` : `${m.nome} ativada.`);
    } catch (e) {
      notify(e.message || 'Erro', true);
    } finally {
      setToggling(null);
    }
  }

  const cs = {
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim },
  };

  return (<>
    <div style={{ marginBottom: 40 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Massoterapeutas
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Massoterapeutas do Spa.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Ative ou inative massoterapeutas na pesquisa de satisfação.
      </p>
    </div>

    {lista === null && !erro && (
      <div style={{ color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em' }}>Carregando…</div>
    )}
    {erro && (
      <div style={{ color: '#E07A5F', fontFamily: 'Inter, sans-serif', fontSize: 14, marginBottom: 16 }}>{erro}</div>
    )}

    {Array.isArray(lista) && lista.length === 0 && !erro && (
      <div style={{ color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 14 }}>Nenhuma massoterapeuta cadastrada.</div>
    )}

    {Array.isArray(lista) && lista.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        {lista.map(m => {
          const isAtiva = !!m.ativo;
          const isBusy = toggling === m.id;
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '14px 0' : '16px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 500, color: isAtiva ? HUB_PALETTE.marfim : HUB_PALETTE.areiaDim, marginBottom: 2 }}>
                  {m.nome}
                  {!isAtiva && <span style={{ marginLeft: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, padding: '2px 8px', border: `1px solid ${HUB_PALETTE.areiaDim}44`, verticalAlign: 'middle' }}>inativa</span>}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', color: HUB_PALETTE.areiaDim }}>
                  {[m.funcao, m.matricula ? `#${m.matricula}` : null, m.vinculo].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                disabled={isBusy}
                onClick={() => toggleAtivo(m)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${isAtiva ? HUB_PALETTE.areiaDim + '55' : HUB_PALETTE.champanhe + '88'}`,
                  color: isAtiva ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  padding: '7px 14px',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                  opacity: isBusy ? 0.5 : 1,
                  flexShrink: 0,
                  transition: 'color 150ms, border-color 150ms',
                }}
              >
                {isBusy ? '…' : isAtiva ? 'Inativar' : 'Ativar'}
              </button>
            </div>
          );
        })}
      </div>
    )}

    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: toast.isErr ? '#E07A5F' : HUB_PALETTE.champanhe, color: toast.isErr ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
        {toast.msg}
      </div>
    )}
  </>);
}

// ─── Setores (CRUD) ─────────────────────────────────────────────────────────
function SetoresPanel({ isMobile }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [editing, setEditing] = useState(null); // { id, nome } | null
  const [creating, setCreating] = useState(false);
  const [confirmar, setConfirmar] = useState(null); // { id, nome }
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');
  const [contagemUsuarios, setContagemUsuarios] = useState({});
  const [todosUsuarios, setTodosUsuarios] = useState([]);
  const [setorModal, setSetorModal] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 150);
    return () => clearTimeout(t);
  }, [busca]);

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, isErr) { setToast({ msg, err: !!isErr }); setTimeout(() => setToast(''), 2800); }

  async function carregar() {
    try {
      const [rS, rU] = await Promise.all([
        fetch('/api/admin/chamados-setores', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/admin/chamados-usuarios', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const dS = await rS.json();
      const dU = await rU.json().catch(() => ({}));
      if (rS.ok && dS.ok) setLista(dS.setores || []);
      else { setLista([]); notify(dS.erro || 'Erro ao carregar setores', true); }
      if (dU.ok && Array.isArray(dU.usuarios)) {
        const cont = {};
        for (const u of dU.usuarios) { if (u.setor && u.ativo !== 0) cont[u.setor] = (cont[u.setor] || 0) + 1; }
        setContagemUsuarios(cont);
        setTodosUsuarios(dU.usuarios);
      }
    } catch { setLista([]); notify('Erro de conexão', true); }
  }
  useEffect(() => { carregar(); }, []);

  function startNovo() { setErro(''); setCreating(true); }
  function startEdit(s) { setErro(''); setEditing({ id: s.id, nome: s.nome }); }
  function fechar() { setEditing(null); setCreating(false); setErro(''); }

  async function salvar(nome, id) {
    nome = (nome || '').trim();
    if (!nome) { setErro('Nome obrigatório'); return; }
    // Bloqueia salvar setor existente quando o nome nao mudou.
    if (id && editing && (editing.nome || '').trim() === nome) {
      notify('Faça alguma alteração antes de salvar.', true);
      return;
    }
    setSaving(true); setErro('');
    const url = id ? `/api/admin/chamados-setores/${id}` : '/api/admin/chamados-setores';
    const method = id ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ nome }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notifyHubMutation();
      notify(id ? 'Setor atualizado' : 'Setor criado');
      fechar();
      await carregar();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  async function confirmarInativacao() {
    if (!confirmar) return;
    const id = confirmar.id;
    setConfirmar(null);
    try {
      const r = await fetch(`/api/admin/chamados-setores/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao inativar', true); return; }
      notifyHubMutation();
      notify('Setor inativado');
      await carregar();
    } catch { notify('Erro de conexão', true); }
  }

  async function reativar(id) {
    try {
      const r = await fetch(`/api/admin/chamados-setores/${id}/reativar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao reativar', true); return; }
      notifyHubMutation();
      notify('Setor reativado');
      await carregar();
    } catch { notify('Erro de conexão', true); }
  }

  const q = buscaDebounced.trim().toLowerCase();
  const filtrada = (lista || []).filter(s => !q || (s.nome || '').toLowerCase().includes(q));
  const filtradaAtiva = filtrada.filter(s => s.ativo !== 0);
  const filtradaInativa = filtrada.filter(s => s.ativo === 0);

  const cs = {
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnDanger: { background: 'transparent', color: '#E07A5F', border: '1px solid #E07A5F88', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Setores
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Setores do hotel.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Gerencie os setores disponíveis para seleção em chamados e cadastros de usuários. Os dados ficam no sistema-chamados; aqui é só a interface.
      </p>
    </div>

    {/* Toolbar */}
    <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Filtrar por nome..." value={busca} onChange={e => setBusca(e.target.value)}
          autoComplete="off" name="setores-busca-livre" spellCheck={false}
          style={{ ...cs.input, paddingLeft: 34 }} />
      </div>
      <button onClick={startNovo} style={cs.btnPrim}>+ Novo setor</button>
    </div>

    {/* Lista */}
    {lista === null ? (
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', padding: '40px 0' }}>Carregando...</div>
    ) : filtrada.length === 0 ? (
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>
        {q ? 'Nenhum setor encontrado.' : 'Nenhum setor cadastrado ainda.'}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        {filtradaAtiva.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 17, color: HUB_PALETTE.marfim, fontWeight: 600 }}>{s.nome}</span>
              {(() => { const cnt = contagemUsuarios[s.nome] || 0; const clicavel = cnt > 0; return (
                <button onClick={clicavel ? () => setSetorModal(s.nome) : undefined}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.15em', color: clicavel ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, border: `1px solid ${clicavel ? HUB_PALETTE.champanhe + '55' : HUB_PALETTE.areiaDim + '33'}`, padding: '2px 8px', background: 'transparent', cursor: clicavel ? 'pointer' : 'default', transition: 'color 150ms, border-color 150ms' }}>
                  {cnt} {cnt === 1 ? 'usuário' : 'usuários'}
                </button>
              ); })()}
            </div>
            <button onClick={() => startEdit(s)} style={cs.btnGhost}>Editar</button>
            <button onClick={() => setConfirmar({ id: s.id, nome: s.nome })} style={cs.btnDanger}>Inativar</button>
          </div>
        ))}
        {filtradaInativa.length > 0 && (
          <>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, padding: '18px 4px 8px' }}>Inativos</div>
            {filtradaInativa.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}11`, flexWrap: 'wrap', opacity: 0.55 }}>
                <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, color: HUB_PALETTE.areiaDim, fontWeight: 400, textDecoration: 'line-through' }}>{s.nome}</span>
                </div>
                <button onClick={() => reativar(s.id)} style={{ ...cs.btnGhost, opacity: 1 }}>Reativar</button>
              </div>
            ))}
          </>
        )}
      </div>
    )}

    {/* Modal Criar/Editar */}
    {(creating || editing) && (
      <SetorForm isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        initialNome={editing ? editing.nome : ''}
        isEdit={!!editing}
        onCancel={fechar}
        onSave={(nome) => salvar(nome, editing ? editing.id : null)} />
    )}

    {/* Modal Confirmar inativação de setor */}
    {confirmar && (() => {
      const cntUsuarios = contagemUsuarios[confirmar.nome] || 0;
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#9C5843', marginBottom: 6 }}>Confirmar inativação</div>
            <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 14px', lineHeight: 1.25 }}>
              Inativar o setor "{confirmar.nome}"?
            </h3>
            {cntUsuarios > 0 ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 22px', lineHeight: 1.6 }}>
                Este setor possui {cntUsuarios} usuário{cntUsuarios !== 1 ? 's' : ''} ativo{cntUsuarios !== 1 ? 's' : ''}.<br />
                {cntUsuarios === 1 ? 'Esse usuário ficará' : 'Esses usuários ficarão'} sem setor após a inativação.<br />
                Ao reativar, quem ainda estiver sem setor será restaurado automaticamente.
              </p>
            ) : (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 22px', lineHeight: 1.5 }}>
                O setor ficará inativo e não aparecerá para seleção. É possível reativá-lo posteriormente.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmar(null)} style={cs.btnGhost}>Cancelar</button>
              <button onClick={confirmarInativacao} style={{ ...cs.btnPrim, color: '#ECE4D2', fontFamily: 'Inter, sans-serif', letterSpacing: 'normal', textTransform: 'none' }}>Inativar</button>
            </div>
          </div>
        </div>
      );
    })()}

    {setorModal && (
      <SetorUsuariosModal setor={setorModal} usuarios={todosUsuarios.filter(u => u.setor === setorModal && u.ativo !== 0)} isMobile={isMobile} onClose={() => setSetorModal(null)} />
    )}

    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: toast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
        {toast.msg}
      </div>
    )}
  </>);
}

function SetorUsuariosModal({ setor, usuarios, isMobile, onClose }) {
  useEffect(() => {
    const lock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = lock; };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, width: '100%', maxWidth: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 4 }}>Setor</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, lineHeight: 1.2 }}>{setor}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: HUB_PALETTE.areiaDim, border: `1px solid ${HUB_PALETTE.areiaDim}55`, padding: '8px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0 }}>Fechar</button>
        </div>
        <div style={{ padding: '7px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}15` }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', color: HUB_PALETTE.areiaDim }}>
            {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '4px 20px 16px' : '4px 24px 16px' }}>
          {usuarios.length === 0
            ? <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 15, color: HUB_PALETTE.areiaDim, padding: '32px 0', textAlign: 'center' }}>Nenhum usuário ativo neste setor.</div>
            : usuarios.map(u => {
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}18` }}>
                    <AvatarUsuario size={32} email={u.email} nome={u.nome} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.nome || '—'}</div>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: HUB_PALETTE.areiaDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[u.cargo, u.ramal ? `ramal ${u.ramal}` : null, u.email].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

function SetorForm({ isMobile, cs, erro, saving, initialNome, isEdit, onCancel, onSave }) {
  const [nome, setNome] = useState(initialNome || '');
  const inputRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 60);
    return () => clearTimeout(t);
  }, []);
  function handleKey(e) {
    if (e.key === 'Enter' && !saving) { e.preventDefault(); onSave(nome); }
    if (e.key === 'Escape' && !saving) { e.preventDefault(); onCancel(); }
  }
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 6 }}>Setor</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, margin: '0 0 22px' }}>
          {isEdit ? 'Editar setor' : 'Informar novo setor'}
        </h3>
        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave(nome); }}>
          <label style={cs.label}>Nome *</label>
          <input ref={inputRef} style={cs.input} value={nome} maxLength={80}
            autoComplete="off" name="setor-nome-randomx1" spellCheck={false}
            onChange={e => setNome(e.target.value)} onKeyDown={handleKey}
            placeholder="Ex.: Recepção, Financeiro, TI" />
          {erro && (
            <div style={{ marginTop: 14, padding: '10px 12px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              {erro}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={cs.btnPrim}>{saving ? '...' : (isEdit ? 'Salvar' : 'Criar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Feriados (CRUD) ─────────────────────────────────────────────────────────
const TIPO_FERIADO_LABEL = { nacional: 'Nacional', estadual: 'Estadual CE', municipal: 'Municipal For.', interno: 'Interno' };
const TIPO_FERIADO_COR = { nacional: '#996442', estadual: '#9C5843', municipal: '#5f7a5f', interno: '#555' };

function FeriadosPanel({ isMobile }) {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [statusAba, setStatusAba] = useState('ativos');
  const [lista, setLista] = useState(null);
  const [editing, setEditing] = useState(null); // feriado object
  const [creating, setCreating] = useState(false);
  const [confirmar, setConfirmar] = useState(null); // { id, nome }
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, isErr) { setToast({ msg, err: !!isErr }); setTimeout(() => setToast(''), 2800); }

  async function carregar(a, s) {
    const anoParam = a !== undefined ? a : ano;
    const statusParam = s !== undefined ? s : statusAba;
    try {
      const r = await fetch(`/api/admin/feriados?ano=${anoParam}&status=${statusParam}`, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) setLista(d.feriados || []);
      else { setLista([]); notify(d.erro || 'Erro ao carregar feriados', true); }
    } catch { setLista([]); notify('Erro de conexão', true); }
  }
  useEffect(() => { carregar(ano, statusAba); }, [ano, statusAba]);

  function mudarAno(v) { setAno(v); setEditing(null); setCreating(false); setErro(''); }
  function mudarAba(s) { setStatusAba(s); setEditing(null); setCreating(false); setErro(''); }
  function startNovo() { setErro(''); setCreating(true); }
  function startEdit(f) { setErro(''); setEditing(f); }
  function fechar() { setEditing(null); setCreating(false); setErro(''); }

  async function salvar(campos) {
    setSaving(true); setErro('');
    const url = editing ? `/api/admin/feriados/${editing.id}` : '/api/admin/feriados';
    const method = editing ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(campos),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notify(editing ? 'Feriado atualizado' : 'Feriado criado');
      fechar();
      await carregar(ano);
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  async function confirmarExclusao() {
    if (!confirmar) return;
    const id = confirmar.id;
    setConfirmar(null);
    try {
      const r = await fetch(`/api/admin/feriados/${id}/inativar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao inativar', true); return; }
      notify('Feriado inativado');
      await carregar(ano, statusAba);
    } catch { notify('Erro de conexão', true); }
  }

  async function reativar(id) {
    try {
      const r = await fetch(`/api/admin/feriados/${id}/reativar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao reativar', true); return; }
      notify('Feriado reativado');
      await carregar(ano, statusAba);
    } catch { notify('Erro de conexão', true); }
  }

  function fmtData(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  const cs = {
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnDanger: { background: 'transparent', color: '#E07A5F', border: '1px solid #E07A5F88', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  const anos = [];
  for (let y = anoAtual; y <= anoAtual + 2; y++) anos.push(y);

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Feriados
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Feriados do hotel.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Feriados usados na construção da escala do SPA. Colaboradores que trabalham em feriados têm direito a <strong style={{ color: HUB_PALETTE.areia }}>CF — Compensação de Feriado</strong>.
      </p>
      <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.jangada, border: `1px solid ${HUB_PALETTE.jangada}44`, background: HUB_PALETTE.jangada + '10', padding: '5px 12px' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: HUB_PALETTE.jangada, animation: 'hubPulse 2.4s infinite' }} />
        Sincronizado com a escala do Gran Spa
      </div>
    </div>

    {/* Tabs status */}
    <div style={{ display: 'flex', marginBottom: 14, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
      {[{ id: 'ativos', label: 'Ativos' }, { id: 'inativos', label: 'Inativos' }].map(t => (
        <button key={t.id} onClick={() => mudarAba(t.id)}
          style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${statusAba === t.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: statusAba === t.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '12px 18px 10px', cursor: 'pointer', marginBottom: -1, transition: 'color 200ms, border-color 200ms' }}>
          {t.label}
        </button>
      ))}
    </div>

    {/* Toolbar */}
    <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>Ano</span>
        <select value={ano} onChange={e => mudarAno(Number(e.target.value))}
          style={{ ...cs.input, width: 'auto', padding: '8px 12px', cursor: 'pointer' }}>
          {anos.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div style={{ flex: 1 }} />
      {statusAba === 'ativos' && <button onClick={startNovo} style={cs.btnPrim}>+ Novo feriado</button>}
    </div>

    {/* Lista */}
    {lista === null ? (
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', padding: '40px 0' }}>Carregando...</div>
    ) : lista.length === 0 ? (
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>
        Nenhum feriado {statusAba === 'inativos' ? 'inativo' : 'cadastrado'} para {ano}.
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        {lista.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, flexWrap: 'wrap', opacity: statusAba === 'inativos' ? 0.6 : 1 }}>
            <div style={{ minWidth: 96, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: HUB_PALETTE.champanhe, letterSpacing: '0.05em' }}>
              {fmtData(f.data)}
            </div>
            <div style={{ flex: 1, minWidth: 180, fontFamily: 'Inter, sans-serif', fontSize: 16, color: HUB_PALETTE.marfim, fontWeight: 500 }}>
              {f.nome}
            </div>
            <div style={{ padding: '3px 10px', border: `1px solid ${TIPO_FERIADO_COR[f.tipo] || '#555'}66`, color: TIPO_FERIADO_COR[f.tipo] || '#aaa', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              {TIPO_FERIADO_LABEL[f.tipo] || f.tipo}
            </div>
            {statusAba === 'ativos' ? (<>
              <button onClick={() => startEdit(f)} style={{ ...cs.btnGhost, padding: '8px 16px', fontSize: 11 }}>Editar</button>
              <button onClick={() => setConfirmar({ id: f.id, nome: f.nome })} style={{ ...cs.btnDanger, padding: '8px 16px', fontSize: 11 }}>Inativar</button>
            </>) : (
              <button onClick={() => reativar(f.id)} style={{ ...cs.btnGhost, padding: '8px 16px', fontSize: 11, color: HUB_PALETTE.champanhe, borderColor: HUB_PALETTE.champanhe + '55' }}>Reativar</button>
            )}
          </div>
        ))}
      </div>
    )}

    {/* Modal Criar/Editar */}
    {(creating || editing) && (
      <FeriadoForm isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        initial={editing || null}
        isEdit={!!editing}
        onCancel={fechar}
        onSave={salvar} />
    )}

    {/* Modal Confirmar exclusão */}
    {confirmar && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6 }}>Confirmar inativação</div>
          <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 14px', lineHeight: 1.25 }}>
            Inativar "{confirmar.nome}"?
          </h3>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 22px', lineHeight: 1.5 }}>
            O feriado será removido da lista e não contará mais para a escala. O histórico permanece.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmar(null)} style={cs.btnGhost}>Cancelar</button>
            <button onClick={confirmarExclusao} style={{ ...cs.btnPrim, background: HUB_PALETTE.areiaDim, color: HUB_PALETTE.noite }}>Inativar</button>
          </div>
        </div>
      </div>
    )}

    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: toast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
        {toast.msg}
      </div>
    )}
  </>);
}

function FeriadoForm({ isMobile, cs, erro, saving, initial, isEdit, onCancel, onSave }) {
  const [dataField, setDataField] = useState(initial ? initial.data : '');
  const [nome, setNome] = useState(initial ? initial.nome : '');
  const [tipo, setTipo] = useState(initial ? (initial.tipo || 'nacional') : 'nacional');
  const inputRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 60);
    return () => clearTimeout(t);
  }, []);
  function handleKey(e) {
    if (e.key === 'Escape' && !saving) { e.preventDefault(); onCancel(); }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 6 }}>Feriado</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, margin: '0 0 22px' }}>
          {isEdit ? 'Editar feriado' : 'Novo feriado'}
        </h3>
        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave({ data: dataField, nome, tipo }); }} onKeyDown={handleKey}>
          <div style={{ marginBottom: 16 }}>
            <label style={cs.label}>Data *</label>
            <input type="date" style={cs.input} value={dataField} onChange={e => setDataField(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={cs.label}>Nome *</label>
            <input ref={inputRef} style={cs.input} value={nome} maxLength={120}
              autoComplete="off" spellCheck={false}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex: Natal, Tiradentes, Corpus Christi…" required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={cs.label}>Tipo</label>
            <select style={{ ...cs.input, cursor: 'pointer' }} value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="nacional">Nacional</option>
              <option value="estadual">Estadual CE</option>
              <option value="municipal">Municipal Fortaleza</option>
              <option value="interno">Interno</option>
            </select>
          </div>
          {erro && (
            <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              {erro}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={cs.btnPrim}>{saving ? '...' : (isEdit ? 'Salvar' : 'Criar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Ausências (CRUD) ────────────────────────────────────────────────────────
function AusenciasPanel({ isMobile }) {
  const [lista, setLista] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');
  const [filtro, setFiltro] = useState('ativos'); // 'ativos' | 'inativos'

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, isErr) { setToast({ msg, err: !!isErr }); setTimeout(() => setToast(''), 2800); }

  async function carregar() {
    try {
      const r = await fetch('/api/admin/ausencias', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) setLista(d.ausencias || []);
      else { setLista([]); notify(d.erro || 'Erro ao carregar', true); }
    } catch { setLista([]); notify('Erro de conexão', true); }
  }
  useEffect(() => { carregar(); }, []);

  function fechar() { setEditing(null); setCreating(false); setErro(''); }

  async function salvar(campos) {
    setSaving(true); setErro('');
    const url = editing ? `/api/admin/ausencias/${editing.id}` : '/api/admin/ausencias';
    const method = editing ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(campos),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notify(editing ? 'Tipo atualizado' : 'Tipo criado');
      fechar();
      await carregar();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  // Soft-delete no lugar de exclusao: a sigla pode estar gravada em celulas
  // historicas da escala do SPA — apagar o tipo deixaria essas celulas sem
  // nome/legenda. Desativar tira do seletor e de novas gravacoes, mas preserva
  // o historico. Reversivel, entao dispensa modal de confirmacao.
  async function toggleAtivo(a) {
    const novoAtivo = a.ativo === false;
    try {
      const r = await fetch(`/api/admin/ausencias/${a.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ nome: a.nome, sigla: a.sigla, ativo: novoAtivo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao salvar', true); return; }
      notify(novoAtivo ? 'Tipo reativado' : 'Tipo desativado');
      await carregar();
    } catch { notify('Erro de conexão', true); }
  }

  const cs = {
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnDanger: { background: 'transparent', color: '#E07A5F', border: '1px solid #E07A5F88', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Ausências
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Tipos de ausência.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Legenda usada na escala do SPA. Cada tipo tem uma sigla de identificação rápida.
      </p>
    </div>

    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
      <button onClick={() => { setErro(''); setCreating(true); }} style={cs.btnPrim}>+ Novo tipo</button>
    </div>

    {/* Filtro Ativos / Inativos — mesmo padrao da aba Links */}
    {(() => {
      const itens = lista || [];
      const nAtivos = itens.filter(a => a.ativo !== false).length;
      const nInativos = itens.filter(a => a.ativo === false).length;
      const tabs = [{ id: 'ativos', label: 'Ativos', count: nAtivos }, { id: 'inativos', label: 'Inativos', count: nInativos }];
      return (
        <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
          {tabs.map(t => {
            const active = filtro === t.id;
            return (
              <button key={t.id} onClick={() => setFiltro(t.id)}
                style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? HUB_PALETTE.champanhe : 'transparent'}`, color: active ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', padding: '10px 20px 8px', cursor: 'pointer', transition: 'color 200ms, border-color 200ms', display: 'flex', alignItems: 'center', gap: 8 }}>
                {t.label}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, background: active ? `${HUB_PALETTE.champanhe}20` : `${HUB_PALETTE.areiaDim}15`, color: active ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, padding: '1px 6px', borderRadius: 2, transition: 'background 200ms, color 200ms' }}>{t.count}</span>
              </button>
            );
          })}
        </div>
      );
    })()}

    {lista === null ? (
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', padding: '40px 0' }}>Carregando...</div>
    ) : (() => {
      const visiveis = lista.filter(a => filtro === 'ativos' ? a.ativo !== false : a.ativo === false);
      if (visiveis.length === 0) return (
        <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>
          {filtro === 'ativos' ? 'Nenhum tipo ativo.' : 'Nenhum tipo desativado.'}
        </div>
      );
      return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visiveis.map(a => {
          const inativo = a.ativo === false;
          return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, flexWrap: 'wrap', opacity: inativo ? 0.55 : 1 }}>
            <div style={{ minWidth: 48, textAlign: 'center', padding: '4px 10px', background: inativo ? HUB_PALETTE.areiaDim + '15' : HUB_PALETTE.champanhe + '18', border: `1px solid ${inativo ? HUB_PALETTE.areiaDim + '44' : HUB_PALETTE.champanhe + '44'}`, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: inativo ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe }}>
              {a.sigla}
            </div>
            <div style={{ flex: 1, minWidth: 180, fontFamily: 'Inter, sans-serif', fontSize: 16, color: HUB_PALETTE.marfim, fontWeight: 500 }}>
              {a.nome}
            </div>
            <button onClick={() => { setErro(''); setEditing(a); }} style={{ ...cs.btnGhost, padding: '8px 16px', fontSize: 11 }}>Editar</button>
            {inativo ? (
              <button onClick={() => toggleAtivo(a)} style={{ ...cs.btnGhost, padding: '8px 16px', fontSize: 11, color: '#4CAF87', borderColor: '#4CAF8788' }}>Reativar</button>
            ) : (
              <button onClick={() => toggleAtivo(a)} style={{ ...cs.btnDanger, padding: '8px 16px', fontSize: 11 }}>Desativar</button>
            )}
          </div>
          );
        })}
      </div>
      );
    })()}

    {(creating || editing) && (
      <AusenciaForm isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        initial={editing || null} isEdit={!!editing}
        onCancel={fechar}
        onSave={salvar} />
    )}

    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: toast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
        {toast.msg}
      </div>
    )}
  </>);
}

function AusenciaForm({ isMobile, cs, erro, saving, initial, isEdit, onCancel, onSave }) {
  const [nome, setNome] = useState(initial ? initial.nome : '');
  const [sigla, setSigla] = useState(initial ? initial.sigla : '');
  const nomeRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (nomeRef.current) nomeRef.current.focus(); }, 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 6 }}>Tipo de ausência</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, margin: '0 0 22px' }}>
          {isEdit ? 'Editar tipo' : 'Novo tipo'}
        </h3>
        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave({ nome, sigla }); }}
          onKeyDown={e => { if (e.key === 'Escape' && !saving) { e.preventDefault(); onCancel(); } }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={cs.label}>Nome *</label>
              <input ref={nomeRef} style={cs.input} value={nome} maxLength={60}
                autoComplete="off" spellCheck={false}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: Licença Maternidade" />
            </div>
            <div>
              <label style={cs.label}>Sigla *</label>
              <input style={{ ...cs.input, width: 80, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: '0.1em', textAlign: 'center' }}
                value={sigla} maxLength={4}
                autoComplete="off" spellCheck={false}
                onChange={e => setSigla(e.target.value.toUpperCase())}
                placeholder="LM" />
            </div>
          </div>
          {erro && (
            <div style={{ marginTop: 14, padding: '10px 12px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              {erro}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={cs.btnPrim}>{saving ? '...' : (isEdit ? 'Salvar' : 'Criar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── UHs — Mapa visual ───────────────────────────────────────────────────────

function _parseAndar(numero) {
  const base = numero.split('/')[0];
  if (base.length >= 4) return parseInt(base.slice(0, base.length - 2), 10);
  if (base.length === 3) return parseInt(base.slice(0, 1), 10);
  return 0;
}

function MapaUHsModal({ uhs, categorias, onClose, onEditUH }) {
  const catMap = useMemo(() => {
    const m = {};
    categorias.forEach(c => { m[c.id] = c; });
    return m;
  }, [categorias]);

  const CELL_W = 68, CELL_GAP = 3;

  const porAndar = useMemo(() => {
    const m = {};
    uhs.forEach(u => {
      const a = _parseAndar(u.numero);
      if (!m[a]) m[a] = [];
      m[a].push(u);
    });
    Object.values(m).forEach(arr => arr.sort((a, b) => {
      const slotA = parseInt(a.numero.split('/')[0].slice(-2), 10);
      const slotB = parseInt(b.numero.split('/')[0].slice(-2), 10);
      return slotA - slotB;
    }));
    return Object.entries(m).sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10));
  }, [uhs]);

  const [hoveredId, setHoveredId] = useState(null);
  const [hoveredLegend, setHoveredLegend] = useState(null);
  const hoveredUH = hoveredId ? uhs.find(u => u.id === hoveredId) : null;

  const CONJ_COLOR = '#C8963C';

  // Pares de conjugados reais — extraídos das linhas (shapes) da planilha Excel
  const REAL_CONJ_PAIRS = [
    // X16 ↔ X17 em todos os andares 5–18
    ['516','517'],['616','617'],['716','717'],['816','817'],['916','917'],
    ['1016','1017'],['1116','1117'],['1216','1217'],['1316','1317'],['1416','1417'],
    ['1516','1517'],['1616','1617'],['1716','1717'],['1816','1817'],
    // Andar 8 — pares adicionais
    ['806','807'],['810','811'],['814','815'],
    // Andar 10 — pares adicionais
    ['1002','1003'],['1006','1007'],['1010','1011'],['1014','1015'],
    // Andares 11–13
    ['1102','1103'],['1202','1203'],['1302','1303'],
    // Andares 14–16 (suíte ↔ apto individual)
    ['1402/03','1404'],['1502/03','1504'],['1602/03','1604'],
    // Andar 17
    ['1702','1703/04/05'],
  ];
  const conjRightSet = useMemo(() => new Set(REAL_CONJ_PAIRS.map(([a]) => a)), []);
  const conjLeftSet  = useMemo(() => new Set(REAL_CONJ_PAIRS.map(([,b]) => b)), []);
  const conjPartner  = useMemo(() => {
    const m = {};
    REAL_CONJ_PAIRS.forEach(([a, b]) => { m[a] = b; m[b] = a; });
    return m;
  }, []);

  const FLAGS_LEG = [
    { color: HUB_PALETTE.champanhe, label: 'GC',   nome: 'Gran Class', desc: 'Categoria premium do hotel' },
    { color: '#3498DB',             label: 'ADAPT', nome: 'Adaptado',   desc: 'Adaptado para necessidades especiais' },
    { color: '#27AE60',             label: 'VAR',   nome: 'Varanda',    desc: 'Unidade com varanda' },
    { color: CONJ_COLOR,            label: 'CONJ',  nome: 'Conjugado',  desc: 'Porta de comunicação com apartamento adjacente' },
  ];

  function renderInfoBar() {
    if (hoveredUH) {
      const cat = catMap[hoveredUH.categoria_id] || {};
      return (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 26, fontWeight: 700, color: cat.cor || HUB_PALETTE.champanhe, letterSpacing: '-0.02em' }}>{hoveredUH.numero}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areiaDim }}>{_parseAndar(hoveredUH.numero)}º andar</span>
            {hoveredUH.numero.includes('/') && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.15em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase' }}>⊞ Suíte · {hoveredUH.numero.split('/').length} aptos</span>}
            {conjPartner[hoveredUH.numero] && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', color: CONJ_COLOR, textTransform: 'uppercase' }}>⟺ Conj. c/ {conjPartner[hoveredUH.numero]}</span>}
          </div>
        </div>
        <span style={{ width: 1, height: 28, background: HUB_PALETTE.areiaDim + '30', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: cat.cor || HUB_PALETTE.areiaDim, letterSpacing: '0.08em' }}>{cat.sigla || '—'}</span>
          <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 15, color: HUB_PALETTE.marfim }}>{cat.nome || hoveredUH.categoria_id}</span>
        </div>
        <span style={{ width: 1, height: 28, background: HUB_PALETTE.areiaDim + '30', flexShrink: 0 }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {hoveredUH.leito && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areia, padding: '3px 8px', border: `1px solid ${HUB_PALETTE.areiaDim}28` }}>{hoveredUH.leito}</span>}
          {hoveredUH.banheiro && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areia, padding: '3px 8px', border: `1px solid ${HUB_PALETTE.areiaDim}28` }}>{hoveredUH.banheiro}</span>}
          {hoveredUH.vista && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#3498DB', padding: '3px 8px', border: '1px solid #3498DB33' }}>{hoveredUH.vista === 'frente-mar' ? 'Frente mar' : 'Lateral'}</span>}
          {hoveredUH.gran_class && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.champanhe, padding: '3px 8px', border: `1px solid ${HUB_PALETTE.champanhe}44` }}>Gran Class</span>}
          {hoveredUH.adaptado && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#3498DB', padding: '3px 8px', border: '1px solid #3498DB44' }}>Adaptado</span>}
          {hoveredUH.varanda && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#27AE60', padding: '3px 8px', border: '1px solid #27AE6044' }}>Varanda</span>}
          {hoveredUH.obs && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>{hoveredUH.obs}</span>}
        </div>
        <span style={{ marginLeft: 'auto', fontFamily: 'Inter, sans-serif', fontSize: 11, color: HUB_PALETTE.areiaDim + '88', fontStyle: 'italic', flexShrink: 0 }}>clique para editar</span>
      </>);
    }
    if (hoveredLegend) {
      return hoveredLegend.tipo === 'cat' ? (<>
        <span style={{ width: 14, height: 14, background: hoveredLegend.cor, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: hoveredLegend.cor, letterSpacing: '0.08em' }}>{hoveredLegend.sigla}</span>
        <span style={{ width: 1, height: 24, background: HUB_PALETTE.areiaDim + '30', flexShrink: 0 }} />
        <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 18, color: HUB_PALETTE.marfim }}>{hoveredLegend.nome}</span>
      </>) : (<>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: hoveredLegend.cor, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: hoveredLegend.cor }}>{hoveredLegend.label}</span>
        <span style={{ width: 1, height: 24, background: HUB_PALETTE.areiaDim + '30', flexShrink: 0 }} />
        <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 18, color: HUB_PALETTE.marfim }}>{hoveredLegend.nome}</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim }}>{hoveredLegend.desc}</span>
      </>);
    }
    return <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim + '77', fontStyle: 'italic' }}>Passe o mouse sobre uma UH para ver detalhes · Clique para editar</span>;
  }

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: HUB_PALETTE.noite, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Topo: título + fechar */}
      <div style={{ background: HUB_PALETTE.noiteAlt, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}20`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 3, height: 32, background: HUB_PALETTE.champanhe }} />
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 3 }}>Gran Marquise · Visualização</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim }}>Mapa de Unidades Habitacionais</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.areiaDim }}>{uhs.length} UHs · {categorias.length} cat.</span>
          <button onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '9px 18px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '88'; }}
            onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
            Fechar ✕
          </button>
        </div>
      </div>

      {/* Barra de info — em cima, logo abaixo do header */}
      <div style={{ background: HUB_PALETTE.noiteAlt + 'cc', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}18`, padding: '0 32px', height: 52, display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0, overflow: 'hidden' }}>
        {renderInfoBar()}
      </div>

      {/* Grid central */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '20px 32px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {porAndar.map(([andar, uhsAndar]) => (
            <div key={andar} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 36, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600, color: HUB_PALETTE.areiaDim, textAlign: 'right', paddingRight: 10 }}>{andar}º</div>
              {(() => {
                const mkCell = (u, inPair) => {
                  const cat = catMap[u.categoria_id] || {};
                  const cor = cat.cor || '#555';
                  const isHov = hoveredId === u.id;
                  const parts = u.numero.split('/');
                  const spans = parts.length;
                  const isSuite = spans > 1;
                  const cellWidth = spans * CELL_W + (spans - 1) * CELL_GAP;
                  const dotBottom = inPair ? 18 : 3;
                  return (
                    <div key={u.id}
                      onMouseEnter={() => { setHoveredId(u.id); setHoveredLegend(null); }}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => onEditUH(u)}
                      style={{
                        width: cellWidth, height: 43,
                        background: isHov
                          ? `linear-gradient(135deg, ${cor}ff 0%, ${cor}cc 100%)`
                          : `linear-gradient(135deg, ${cor}dd 0%, ${cor}aa 100%)`,
                        border: `1.5px solid ${isHov ? cor + 'ff' : cor + 'ee'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 80ms ease',
                        position: 'relative', flexShrink: 0, overflow: 'hidden',
                        boxShadow: isHov
                          ? `0 2px 14px ${cor}66, inset 0 1px 0 #ffffff22`
                          : `inset 0 1px 0 #ffffff18, 0 1px 3px #00000033`,
                      }}>
                      {isSuite ? (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, lineHeight: 1, userSelect: 'none', pointerEvents: 'none', letterSpacing: '0.03em', textShadow: '0 1px 2px #00000055' }}>
                          {u.numero.split('/').map((part, i, arr) => (
                            <React.Fragment key={i}>
                              <span style={{ color: isHov ? '#fff' : '#ffffffee', fontWeight: 700 }}>{part}</span>
                              {i < arr.length - 1 && <span style={{ color: isHov ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.32)', fontWeight: 400 }}>/</span>}
                            </React.Fragment>
                          ))}
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: isHov ? '#fff' : '#ffffffcc', fontWeight: 700, lineHeight: 1, userSelect: 'none', pointerEvents: 'none', letterSpacing: '0.04em', textShadow: '0 1px 2px #00000055' }}>
                          {u.numero}
                        </span>
                      )}
                      {u.banheiro && <span style={{ position: 'absolute', top: 3, left: 3, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600, lineHeight: 1, color: '#fff', background: 'rgba(0,0,0,0.28)', padding: '1px 5px', borderRadius: 4, backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', pointerEvents: 'none', userSelect: 'none' }}>{u.banheiro}</span>}
                      {u.gran_class && <span style={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%', background: HUB_PALETTE.champanhe, boxShadow: `0 0 6px ${HUB_PALETTE.champanhe}cc, 0 0 2px #fff8`, border: '1px solid #ffffff44', pointerEvents: 'none' }} />}
                      {u.adaptado && <span style={{ position: 'absolute', bottom: dotBottom, left: 3, width: 7, height: 7, borderRadius: '50%', background: '#3498DB', boxShadow: '0 0 5px #3498DBaa', border: '1px solid #ffffff44', pointerEvents: 'none' }} />}
                      {u.varanda && <span style={{ position: 'absolute', bottom: dotBottom, right: 3, width: 7, height: 7, borderRadius: '50%', background: '#27AE60', boxShadow: '0 0 5px #27AE60aa', border: '1px solid #ffffff44', pointerEvents: 'none' }} />}
                    </div>
                  );
                };

                const segs = [];
                let si = 0;
                while (si < uhsAndar.length) {
                  const u = uhsAndar[si];
                  const nxt = uhsAndar[si + 1];
                  if (conjRightSet.has(u.numero) && nxt && conjPartner[u.numero] === nxt.numero) {
                    segs.push({ conj: true, left: u, right: nxt });
                    si += 2;
                  } else {
                    segs.push({ conj: false, uh: u });
                    si++;
                  }
                }

                return segs.map((seg, si) => seg.conj ? (
                  <div key={`pair-${seg.left.id}`} style={{ position: 'relative', flexShrink: 0, display: 'flex', gap: CELL_GAP, boxShadow: `0 0 0 1px ${CONJ_COLOR}66, 0 0 18px ${CONJ_COLOR}28` }}>
                    {mkCell(seg.left, true)}
                    {mkCell(seg.right, true)}
                    {/* Barra conjugado metalizada sobre os dois quadradinhos */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 15, background: `linear-gradient(90deg, ${CONJ_COLOR}88 0%, ${CONJ_COLOR} 15%, #E2B25A 50%, ${CONJ_COLOR} 85%, ${CONJ_COLOR}88 100%)`, borderTop: '1px solid rgba(255,255,255,0.25)', boxShadow: `0 -4px 12px ${CONJ_COLOR}77, inset 0 1px 0 rgba(255,255,255,0.18)`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, zIndex: 6, pointerEvents: 'none' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#160800', fontWeight: 900, lineHeight: 1, userSelect: 'none' }}>←</span>
                      <span style={{ width: 1, height: 7, background: 'rgba(0,0,0,0.3)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 6.5, letterSpacing: '0.32em', color: '#160800', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1, userSelect: 'none' }}>CONJUGADO</span>
                      <span style={{ width: 1, height: 7, background: 'rgba(0,0,0,0.3)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#160800', fontWeight: 900, lineHeight: 1, userSelect: 'none' }}>→</span>
                    </div>
                  </div>
                ) : mkCell(seg.uh, false));
              })()}
            </div>
          ))}
        </div>
      </div>

      {/* Etiquetas da legenda — em baixo */}
      <div style={{ background: HUB_PALETTE.noiteAlt, borderTop: `1px solid ${HUB_PALETTE.areiaDim}18`, padding: '10px 32px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.25em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', flexShrink: 0 }}>Legenda</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {categorias.slice().sort((a, b) => a.sigla.localeCompare(b.sigla)).map(c => (
            <div key={c.id}
              onMouseEnter={() => { setHoveredLegend({ tipo: 'cat', sigla: c.sigla, nome: c.nome, cor: c.cor }); setHoveredId(null); }}
              onMouseLeave={() => setHoveredLegend(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: hoveredLegend && hoveredLegend.sigla === c.sigla ? c.cor + '55' : c.cor + '33', border: `1px solid ${hoveredLegend && hoveredLegend.sigla === c.sigla ? c.cor + 'dd' : c.cor + '88'}`, cursor: 'default', transition: 'all 100ms' }}>
              <span style={{ width: 7, height: 7, background: c.cor, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.06em', color: c.cor, fontWeight: 700 }}>{c.sigla}</span>
            </div>
          ))}
          <div style={{ width: 1, height: 14, background: HUB_PALETTE.areiaDim + '33', margin: '0 6px', flexShrink: 0 }} />
          {FLAGS_LEG.map(({ color, label, nome, desc }) => (
            <div key={label}
              onMouseEnter={() => { setHoveredLegend({ tipo: 'flag', label, nome, cor: color, desc }); setHoveredId(null); }}
              onMouseLeave={() => setHoveredLegend(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', border: `1px solid ${hoveredLegend && hoveredLegend.label === label ? color + 'dd' : color + '88'}`, background: hoveredLegend && hoveredLegend.label === label ? color + '44' : color + '1a', cursor: 'default', transition: 'all 100ms' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── UHs — Formulário de edição ───────────────────────────────────────────────

function UHForm({ uh, categorias, isMobile, onSave, onCancel, saving, erro }) {
  const isEdit = !!uh;
  const [form, setForm] = useState(isEdit ? {
    numero: uh.numero,
    categoria_id: uh.categoria_id || '',
    leito: uh.leito || '',
    banheiro: uh.banheiro || '',
    gran_class: !!uh.gran_class,
    vista: uh.vista || '',
    varanda: !!uh.varanda,
    adaptado: !!uh.adaptado,
    obs: uh.obs || '',
  } : {
    numero: '', categoria_id: '', leito: 'KING', banheiro: 'BX',
    gran_class: false, vista: '', varanda: false, adaptado: false, obs: '',
  });

  const nomeRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (nomeRef.current) nomeRef.current.focus(); }, 60);
    return () => clearTimeout(t);
  }, []);

  const cs = {
    label: { display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 },
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 16, padding: '12px 16px', outline: 'none' },
    select: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 16, padding: '12px 16px', outline: 'none', cursor: 'pointer' },
    btnPrim: { background: HUB_PALETTE.champanhe, border: `1px solid ${HUB_PALETTE.champanhe}`, color: HUB_PALETTE.noite, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '12px 26px', cursor: 'pointer', fontWeight: 600 },
    btnGhost: { background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '12px 18px', cursor: 'pointer' },
  };

  const FLAGS = [
    { key: 'gran_class', label: 'Gran Class', color: HUB_PALETTE.champanhe },
    { key: 'varanda',    label: 'Varanda',    color: '#27AE60' },
    { key: 'adaptado',  label: 'Adaptado',   color: '#3498DB' },
  ];

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 620, width: '100%', padding: isMobile ? '28px 22px' : '40px 48px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 8 }}>Unidade Habitacional</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 32, color: HUB_PALETTE.marfim, margin: '0 0 28px' }}>
          {isEdit ? `Editar UH ${uh.numero}` : 'Nova UH'}
        </h3>

        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave(form); }}
          onKeyDown={e => { if (e.key === 'Escape' && !saving) { e.preventDefault(); onCancel(); } }}>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <label style={cs.label}>Nº da UH *</label>
              <input ref={nomeRef}
                style={{ ...cs.input, ...(isEdit ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                value={form.numero} maxLength={20} readOnly={isEdit}
                autoComplete="off" spellCheck={false}
                onChange={e => !isEdit && setForm(p => ({ ...p, numero: e.target.value }))}
                placeholder="Ex: 1201 ou 1802/03/04/05" />
            </div>
            <div>
              <label style={cs.label}>Categoria *</label>
              <select style={cs.select} value={form.categoria_id}
                onChange={e => setForm(p => ({ ...p, categoria_id: e.target.value }))}>
                <option value="">— Selecionar —</option>
                {categorias.slice().sort((a, b) => a.sigla.localeCompare(b.sigla)).map(c => (
                  <option key={c.id} value={c.id}>{c.sigla} — {c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={cs.label}>Tipo de Leito</label>
              <select style={cs.select} value={form.leito}
                onChange={e => setForm(p => ({ ...p, leito: e.target.value }))}>
                <option value="">— Selecionar —</option>
                <option value="KING">KING — 2,00×2,00m</option>
                <option value="TWIN">TWIN — 2× 1,20×2,00m</option>
                <option value="QUEEN">QUEEN — 2× 1,60×2,00m</option>
                <option value="TPL">TPL — Triplo</option>
              </select>
            </div>
            <div>
              <label style={cs.label}>Tipo de Banheiro</label>
              <select style={cs.select} value={form.banheiro}
                onChange={e => setForm(p => ({ ...p, banheiro: e.target.value }))}>
                <option value="">— Selecionar —</option>
                <option value="BA">BA — Banheira</option>
                <option value="BX">BX — Box</option>
                <option value="HIDRO">HIDRO — Hidromassagem</option>
              </select>
            </div>
            <div>
              <label style={cs.label}>Vista</label>
              <select style={cs.select} value={form.vista}
                onChange={e => setForm(p => ({ ...p, vista: e.target.value }))}>
                <option value="">— Não informado —</option>
                <option value="frente-mar">Frente Mar</option>
                <option value="lateral">Lateral</option>
              </select>
            </div>
            <div>
              <label style={cs.label}>Observações</label>
              <input style={cs.input} value={form.obs} maxLength={120}
                autoComplete="off" spellCheck={false}
                onChange={e => setForm(p => ({ ...p, obs: e.target.value }))}
                placeholder="Observações gerais" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 28, marginBottom: 24, flexWrap: 'wrap' }}>
            {FLAGS.map(({ key, label, color }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' }}>
                <div onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}
                  style={{ width: 22, height: 22, border: `2px solid ${form[key] ? color : HUB_PALETTE.areiaDim + '44'}`, background: form[key] ? color + '22' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 150ms', flexShrink: 0 }}>
                  {form[key] && <span style={{ width: 10, height: 10, background: color, display: 'block' }} />}
                </div>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: form[key] ? color : HUB_PALETTE.areia }}>{label}</span>
              </label>
            ))}
          </div>

          {erro && <div style={{ marginBottom: 18, padding: '12px 14px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={cs.btnPrim}>{saving ? '...' : (isEdit ? 'Salvar' : 'Criar UH')}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── UHs — Formulário de categoria ───────────────────────────────────────────

function CategoriaUHForm({ cat, isMobile, onSave, onCancel, saving, erro }) {
  const isEdit = !!cat;
  const [form, setForm] = useState(isEdit
    ? { sigla: cat.sigla, nome: cat.nome, cor: cat.cor || '#666666' }
    : { sigla: '', nome: '', cor: '#9B59B6' }
  );
  const nomeRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (nomeRef.current) nomeRef.current.focus(); }, 60);
    return () => clearTimeout(t);
  }, []);

  const cs = {
    label: { display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 },
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 16, padding: '12px 16px', outline: 'none' },
    btnPrim: { background: HUB_PALETTE.champanhe, border: `1px solid ${HUB_PALETTE.champanhe}`, color: HUB_PALETTE.noite, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '12px 26px', cursor: 'pointer', fontWeight: 600 },
    btnGhost: { background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '12px 18px', cursor: 'pointer' },
  };

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '28px 22px' : '40px 44px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 8 }}>Categoria de UH</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 32, color: HUB_PALETTE.marfim, margin: '0 0 28px' }}>
          {isEdit ? 'Editar categoria' : 'Nova categoria'}
        </h3>

        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave(form); }}
          onKeyDown={e => { if (e.key === 'Escape' && !saving) { e.preventDefault(); onCancel(); } }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end', marginBottom: 20 }}>
            <div>
              <label style={cs.label}>Nome *</label>
              <input ref={nomeRef} style={cs.input} value={form.nome} maxLength={60}
                autoComplete="off" spellCheck={false}
                onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                placeholder="Ex: Superior Double" />
            </div>
            <div>
              <label style={cs.label}>Sigla *</label>
              <input
                style={{ ...cs.input, width: 100, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: '0.1em', textAlign: 'center', ...(isEdit ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                value={form.sigla} maxLength={6} readOnly={isEdit}
                autoComplete="off" spellCheck={false}
                onChange={e => !isEdit && setForm(p => ({ ...p, sigla: e.target.value.toUpperCase() }))}
                placeholder="SPD" />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={cs.label}>Cor</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <input type="color" value={form.cor}
                onChange={e => setForm(p => ({ ...p, cor: e.target.value }))}
                style={{ width: 52, height: 46, border: `1px solid ${HUB_PALETTE.areiaDim}33`, background: 'transparent', cursor: 'pointer', padding: 2 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: form.cor + '1a', border: `1px solid ${form.cor}55`, flex: 1 }}>
                <span style={{ width: 16, height: 16, background: form.cor, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: form.cor, minWidth: 44 }}>{form.sigla || '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: HUB_PALETTE.marfim }}>{form.nome || 'Nome da categoria'}</span>
              </div>
            </div>
          </div>

          {erro && <div style={{ marginBottom: 18, padding: '12px 14px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={cs.btnPrim}>{saving ? '...' : (isEdit ? 'Salvar' : 'Criar')}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── UHs — Combobox de categoria ─────────────────────────────────────────────

function CatCombobox({ value, categorias, onChange }) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  const catSelecionada = value ? categorias.find(c => c.id === value) : null;

  const filtradas = useMemo(() => {
    const sorted = categorias.slice().sort((a, b) => a.sigla.localeCompare(b.sigla));
    if (!texto.trim()) return sorted;
    const q = texto.toLowerCase();
    return sorted.filter(c => c.sigla.toLowerCase().includes(q) || c.nome.toLowerCase().includes(q));
  }, [texto, categorias]);

  useEffect(() => {
    function fora(e) { if (ref.current && !ref.current.contains(e.target)) { setAberto(false); setTexto(''); } }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  function select(c) { onChange(c ? c.id : ''); setTexto(''); setAberto(false); }

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 230, flex: 1 }}>
      <div style={{ position: 'relative' }}>
        {catSelecionada && !aberto && (
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, background: catSelecionada.cor, display: 'inline-block', pointerEvents: 'none', flexShrink: 0 }} />
        )}
        <input type="text"
          placeholder="Todas as categorias"
          value={aberto ? texto : (catSelecionada ? `${catSelecionada.sigla} — ${catSelecionada.nome}` : '')}
          onFocus={() => { setAberto(true); setTexto(''); }}
          onChange={e => { setTexto(e.target.value); setAberto(true); }}
          autoComplete="off" spellCheck={false}
          style={{
            boxSizing: 'border-box', width: '100%',
            background: HUB_PALETTE.noite,
            border: `1px solid ${aberto ? HUB_PALETTE.dourado + '77' : HUB_PALETTE.areiaDim + '33'}`,
            color: HUB_PALETTE.marfim,
            fontFamily: catSelecionada && !aberto ? 'JetBrains Mono, monospace' : 'Inter, sans-serif',
            fontSize: 14, outline: 'none', cursor: 'text',
            padding: catSelecionada && !aberto ? '10px 32px 10px 26px' : '10px 32px 10px 12px',
          }} />
        {value ? (
          <button onClick={e => { e.stopPropagation(); select(null); }}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>
            ×
          </button>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="2" strokeLinecap="round"
            style={{ position: 'absolute', right: 11, top: '50%', transform: `translateY(-50%) ${aberto ? 'rotate(180deg)' : ''}`, pointerEvents: 'none', transition: 'transform 150ms' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
      </div>
      {aberto && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: HUB_PALETTE.noiteAlt, border: `1px solid ${HUB_PALETTE.areiaDim}33`, borderTop: 'none', maxHeight: 280, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <div onClick={() => select(null)}
            style={{ padding: '11px 14px', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 13, color: !value ? HUB_PALETTE.dourado : HUB_PALETTE.areiaDim, background: !value ? HUB_PALETTE.dourado + '10' : 'transparent', borderLeft: !value ? `3px solid ${HUB_PALETTE.dourado}` : '3px solid transparent' }}
            onMouseEnter={e => { if (value) e.currentTarget.style.background = HUB_PALETTE.areiaDim + '0d'; }}
            onMouseLeave={e => { if (value) e.currentTarget.style.background = 'transparent'; }}>
            Todas as categorias
          </div>
          {filtradas.map(c => (
            <div key={c.id} onClick={() => select(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: value === c.id ? c.cor + '18' : 'transparent', borderLeft: value === c.id ? `3px solid ${c.cor}` : '3px solid transparent', transition: 'background 80ms' }}
              onMouseEnter={e => { if (value !== c.id) e.currentTarget.style.background = HUB_PALETTE.areiaDim + '0d'; }}
              onMouseLeave={e => { if (value !== c.id) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ width: 10, height: 10, background: c.cor, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: c.cor, minWidth: 44, letterSpacing: '0.06em' }}>{c.sigla}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim }}>{c.nome}</span>
            </div>
          ))}
          {filtradas.length === 0 && (
            <div style={{ padding: '11px 14px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhuma categoria encontrada</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── UHs — Painel principal ───────────────────────────────────────────────────

function UHsPanel({ isMobile }) {
  const isPhone = useWindowWidth() < 480;
  const [subAba, setSubAba] = useState('uhs');
  const [uhs, setUHs]           = useState(null);
  const [categorias, setCats]   = useState([]);
  const [busca, setBusca]       = useState('');
  const [filtroAndar, setFiltroAndar] = useState('');
  const [filtroCat, setFiltroCat]     = useState('');
  const [filtroGC, setFiltroGC]       = useState('');
  const [editingUH, setEditingUH]     = useState(null);
  const [creatingUH, setCreatingUH]   = useState(false);
  const [editingCat, setEditingCat]   = useState(null);
  const [creatingCat, setCreatingCat] = useState(false);
  const [confirmar, setConfirmar]     = useState(null); // { tipo, item }
  const [saving, setSaving]           = useState(false);
  const [erro, setErro]               = useState('');
  const [toast, setToast]             = useState(null);
  const [mapaAberto, setMapaAberto]   = useState(false);

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, isErr) { setToast({ msg, err: !!isErr }); setTimeout(() => setToast(null), 2800); }

  async function carregarUHs() {
    try {
      const r = await fetch('/api/admin/uhs', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) setUHs(d.uhs || []);
      else { setUHs([]); notify(d.erro || 'Erro ao carregar', true); }
    } catch { setUHs([]); notify('Erro de conexão', true); }
  }

  async function carregarCats() {
    try {
      const r = await fetch('/api/admin/categorias-uh', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) setCats(d.categorias || []);
    } catch {}
  }

  useEffect(() => { carregarUHs(); carregarCats(); }, []);

  const catMap = useMemo(() => {
    const m = {};
    categorias.forEach(c => { m[c.id] = c; });
    return m;
  }, [categorias]);

  const andares = useMemo(() => {
    if (!uhs) return [];
    const s = new Set();
    uhs.forEach(u => { const a = _parseAndar(u.numero); if (!isNaN(a)) s.add(a); });
    return Array.from(s).sort((a, b) => b - a);
  }, [uhs]);

  const uhsFiltradas = useMemo(() => {
    if (!uhs) return [];
    return uhs.filter(u => {
      if (filtroAndar && _parseAndar(u.numero) !== parseInt(filtroAndar, 10)) return false;
      if (filtroCat && u.categoria_id !== filtroCat) return false;
      if (filtroGC === 'gc' && !u.gran_class) return false;
      if (filtroGC === 'std' && u.gran_class) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const cat = catMap[u.categoria_id] || {};
        return u.numero.includes(busca)
          || (cat.nome || '').toLowerCase().includes(q)
          || (cat.sigla || '').toLowerCase().includes(q)
          || (u.obs || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [uhs, busca, filtroAndar, filtroCat, filtroGC, catMap]);

  async function salvarUH(form) {
    setSaving(true); setErro('');
    const url = editingUH ? `/api/admin/uhs/${encodeURIComponent(editingUH.id)}` : '/api/admin/uhs';
    const method = editingUH ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notify(editingUH ? 'UH atualizada' : 'UH criada');
      setEditingUH(null); setCreatingUH(false); setErro('');
      carregarUHs();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  async function salvarCat(form) {
    setSaving(true); setErro('');
    const url = editingCat ? `/api/admin/categorias-uh/${encodeURIComponent(editingCat.id)}` : '/api/admin/categorias-uh';
    const method = editingCat ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notify(editingCat ? 'Categoria atualizada' : 'Categoria criada');
      setEditingCat(null); setCreatingCat(false); setErro('');
      carregarCats();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  async function confirmarExclusao() {
    if (!confirmar) return;
    const { tipo, item } = confirmar;
    setConfirmar(null);
    try {
      const url = tipo === 'uh' ? `/api/admin/uhs/${encodeURIComponent(item.id)}` : `/api/admin/categorias-uh/${encodeURIComponent(item.id)}`;
      const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao excluir', true); return; }
      notify(tipo === 'uh' ? 'UH excluída' : 'Categoria excluída');
      if (tipo === 'uh') carregarUHs(); else carregarCats();
    } catch { notify('Erro de conexão', true); }
  }

  const cs = {
    label: { display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 },
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    select: { boxSizing: 'border-box', background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 12px', outline: 'none', cursor: 'pointer' },
    btnPrim: { display: 'inline-flex', alignItems: 'center', gap: 8, background: HUB_PALETTE.champanhe, border: `1px solid ${HUB_PALETTE.champanhe}`, color: HUB_PALETTE.noite, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 22px', cursor: 'pointer', fontWeight: 600 },
    btnGhost: { background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '8px 14px', cursor: 'pointer' },
    btnDanger: { background: 'transparent', border: `1px solid #E07A5F44`, color: '#E07A5F', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', padding: '8px 12px', cursor: 'pointer' },
  };

  return (<>
    {/* Cabeçalho da aba */}
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Gestão de UHs
        </div>
        <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isPhone ? 28 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 6px' }}>
          Unidades Habitacionais.
        </h2>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, margin: 0 }}>
          {uhs !== null ? `${uhs.length} UHs · ${categorias.length} categorias` : 'Carregando...'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        <button onClick={() => { setCreatingUH(true); setErro(''); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: HUB_PALETTE.champanhe, border: `1px solid ${HUB_PALETTE.champanhe}`, color: HUB_PALETTE.noite, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova UH
        </button>
        <button onClick={() => { setCreatingCat(true); setErro(''); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '10px 16px', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '77'; }}
          onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova categoria
        </button>
        <button onClick={() => setMapaAberto(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${HUB_PALETTE.champanhe}55`, color: HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '10px 16px', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = HUB_PALETTE.champanhe + '12'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Ver mapa
        </button>
      </div>
    </div>

    <div style={{ display: 'flex', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, marginBottom: 28 }}>
      {[
        { id: 'uhs', label: `UHs${uhs ? ` (${uhs.length})` : ''}` },
        { id: 'categorias', label: `Categorias (${categorias.length})` },
      ].map(s => (
        <button key={s.id} onClick={() => { setSubAba(s.id); setErro(''); }}
          style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${subAba === s.id ? HUB_PALETTE.dourado : 'transparent'}`, color: subAba === s.id ? HUB_PALETTE.dourado : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '12px 24px 10px', cursor: 'pointer', marginBottom: -1, transition: 'color 180ms, border-color 180ms' }}>
          {s.label}
        </button>
      ))}
    </div>

    {/* ── Sub-aba UHs ── */}
    {subAba === 'uhs' && (<>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 2, minWidth: 180 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Buscar nº, categoria, observação..."
            value={busca} onChange={e => setBusca(e.target.value)}
            autoComplete="off" spellCheck={false}
            style={{ ...cs.input, paddingLeft: 32 }} />
        </div>
        <select value={filtroAndar} onChange={e => setFiltroAndar(e.target.value)} style={cs.select}>
          <option value="">Todos os andares</option>
          {andares.map(a => <option key={a} value={a}>{a}º andar</option>)}
        </select>
        <CatCombobox value={filtroCat} categorias={categorias} onChange={v => setFiltroCat(v)} />
        <select value={filtroGC} onChange={e => setFiltroGC(e.target.value)} style={cs.select}>
          <option value="">Todos</option>
          <option value="gc">Gran Class</option>
          <option value="std">Padrão</option>
        </select>
      </div>

      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.18em', color: HUB_PALETTE.areiaDim, marginBottom: 16 }}>
        {uhs === null ? 'Carregando...' : `${uhsFiltradas.length} de ${uhs.length} UHs`}
      </div>

      {/* Lista de UHs */}
      {uhs === null ? (
        <Carregando />
      ) : uhsFiltradas.length === 0 ? (
        <Vazio />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {uhsFiltradas.map(u => {
            const cat = catMap[u.categoria_id] || {};
            const cor = cat.cor || HUB_PALETTE.areiaDim;
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px 14px 16px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}15`, flexWrap: 'wrap', minWidth: 0, borderLeft: `4px solid ${cor}`, background: cor + '06' }}>
                {/* Número */}
                <div style={{ flexShrink: 0, minWidth: 100 }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 700, color: HUB_PALETTE.marfim, letterSpacing: '-0.02em', lineHeight: 1 }}>{u.numero}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.areiaDim, marginTop: 3 }}>{_parseAndar(u.numero)}º andar</div>
                </div>
                {/* Categoria — badge + nome na mesma linha */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: cor, padding: '4px 10px', background: cor + '20', border: `1px solid ${cor}55`, flexShrink: 0 }}>
                    {cat.sigla || u.categoria_id || '—'}
                  </span>
                  {cat.nome && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areia, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.nome}</span>}
                </div>
                {/* Leito / banheiro */}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {u.leito && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areia, padding: '4px 8px', border: `1px solid ${HUB_PALETTE.areiaDim}28` }}>{u.leito}</span>}
                  {u.banheiro && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areia, padding: '4px 8px', border: `1px solid ${HUB_PALETTE.areiaDim}28` }}>{u.banheiro}</span>}
                  {u.vista === 'frente-mar' && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#3498DB', padding: '4px 8px', border: '1px solid #3498DB33' }}>Mar</span>}
                </div>
                {/* Flags */}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {u.gran_class && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.champanhe, padding: '4px 8px', border: `1px solid ${HUB_PALETTE.champanhe}44`, background: HUB_PALETTE.champanhe + '10' }}>GC</span>}
                  {u.adaptado && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#3498DB', padding: '4px 8px', border: '1px solid #3498DB44', background: '#3498DB10' }}>ADAPT</span>}
                  {u.varanda && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#27AE60', padding: '4px 8px', border: '1px solid #27AE6044', background: '#27AE6010' }}>VAR</span>}
                </div>
                {u.obs && !isPhone && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, fontStyle: 'italic', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{u.obs}</span>}
                {/* Ações */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => { setEditingUH(u); setErro(''); }}
                    style={cs.btnGhost}
                    onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '66'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
                    Editar
                  </button>
                  <button onClick={() => setConfirmar({ tipo: 'uh', item: u })}
                    style={cs.btnDanger}
                    onMouseEnter={e => { e.currentTarget.style.background = '#E07A5F15'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </>)}

    {/* ── Sub-aba Categorias ── */}
    {subAba === 'categorias' && (<>
      {categorias.length === 0 ? (
        <Vazio />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, 1fr)', gap: 8, marginBottom: 24 }}>
          {categorias.map(c => {
            const qtd = uhs !== null ? uhs.filter(u => u.categoria_id === c.id).length : null;
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${HUB_PALETTE.areiaDim}20`, background: c.cor + '08', overflow: 'hidden' }}>
                <div style={{ width: 6, flexShrink: 0, background: c.cor }} />
                <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, letterSpacing: '0.08em', color: c.cor }}>{c.sigla}</span>
                    {qtd !== null && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areiaDim }}>{qtd} UH{qtd !== 1 ? 's' : ''}</span>}
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: HUB_PALETTE.marfim }}>{c.nome}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 12px', justifyContent: 'center', flexShrink: 0 }}>
                  <button onClick={() => { setEditingCat(c); setErro(''); }}
                    style={cs.btnGhost}
                    onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '66'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
                    Editar
                  </button>
                  <button onClick={() => setConfirmar({ tipo: 'cat', item: c })}
                    style={cs.btnDanger}
                    onMouseEnter={e => { e.currentTarget.style.background = '#E07A5F15'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>)}

    {/* Modais de edição */}
    {(editingUH || creatingUH) && (
      <UHForm uh={editingUH} categorias={categorias} isMobile={isMobile}
        onSave={salvarUH} onCancel={() => { setEditingUH(null); setCreatingUH(false); setErro(''); }}
        saving={saving} erro={erro} />
    )}
    {(editingCat || creatingCat) && (
      <CategoriaUHForm cat={editingCat} isMobile={isMobile}
        onSave={salvarCat} onCancel={() => { setEditingCat(null); setCreatingCat(false); setErro(''); }}
        saving={saving} erro={erro} />
    )}

    {/* Confirmar exclusão */}
    {confirmar && ReactDOM.createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 400, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#9C5843', marginBottom: 6 }}>Confirmar exclusão</div>
          <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>
            {confirmar.tipo === 'uh' ? `Excluir UH ${confirmar.item.numero}?` : `Excluir categoria ${confirmar.item.sigla}?`}
          </h3>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 24px', lineHeight: 1.5 }}>Esta ação não pode ser desfeita.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmar(null)}
              style={cs.btnGhost}
              onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; }}
              onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; }}>
              Cancelar
            </button>
            <button onClick={confirmarExclusao}
              style={{ background: '#9C5843', border: '1px solid #9C5843', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '10px 22px', cursor: 'pointer' }}>
              Excluir
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Toast */}
    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 220, background: toast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px', maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>
        {toast.msg}
      </div>
    )}

    {/* Mapa */}
    {mapaAberto && <MapaUHsModal uhs={uhs || []} categorias={categorias} onClose={() => setMapaAberto(false)} onEditUH={u => { setEditingUH(u); setErro(''); }} />}
  </>);
}


// ─── Filtros do painel Contas ───────────────────────────────────────────────
// Logica pura espelhada em src/contas-filtros.js (testada via node --test) —
// mantenha as duas copias em sincronia.
const CONTAS_ORDEM_STATUS = ['ativo', 'precadastro', 'ativacao_pendente', 'bloqueado', 'desligado'];

function filtrarOrdenarContas(lista, opts) {
  const { isAdmin, busca, status, setor, cargo, ordem } = opts || {};
  const tokens = (busca || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const statusDe = r => isAdmin
    ? (r.ativo === 1 ? 'ativo' : 'desligado')
    : (r.hub_status || (r.ativo !== 0 ? 'ativo' : 'desligado'));
  function matchToken(r, t) {
    if (t === 'master' && isAdmin) return !!r.is_master;
    if (t === 'inativo') return !(isAdmin ? r.ativo === 1 : r.ativo !== 0);
    const campos = [
      isAdmin ? r.nome_completo : r.nome,
      r.email, r.usuario, r.ramal, r.setor, r.cargo, r.matricula,
    ].filter(Boolean).map(s => String(s).toLowerCase());
    return campos.some(c => c.includes(t));
  }
  const base = (lista || []).filter(r =>
    (tokens.length === 0 || tokens.every(t => matchToken(r, t))) &&
    (!setor || (r.setor || '') === setor) &&
    (!cargo || (r.cargo || '') === cargo)
  );
  const contagem = {};
  for (const r of base) {
    const s = statusDe(r);
    contagem[s] = (contagem[s] || 0) + 1;
  }
  const porStatus = base.filter(r => {
    if (!status || status === 'todos') return true;
    if (isAdmin) {
      if (status === 'ativo') return r.ativo === 1;
      if (status === 'desligado') return r.ativo !== 1;
      return true;
    }
    return statusDe(r) === status;
  });
  const nomeDe = r => (isAdmin ? r.nome_completo : r.nome) || '';
  const cmpNome = (a, b) => nomeDe(a).localeCompare(nomeDe(b), 'pt-BR', { sensitivity: 'base' });
  const resultado = porStatus.slice().sort((a, b) => {
    if (ordem === 'setor') {
      return ((a.setor || '').localeCompare(b.setor || '', 'pt-BR', { sensitivity: 'base' })) || cmpNome(a, b);
    }
    if (ordem === 'status') {
      return (CONTAS_ORDEM_STATUS.indexOf(statusDe(a)) - CONTAS_ORDEM_STATUS.indexOf(statusDe(b))) || cmpNome(a, b);
    }
    return cmpNome(a, b);
  });
  return { resultado, contagem, base };
}

// Dropdown de filtro no padrao visual do hub (label mono + popup custom).
function FiltroSelect({ label, value, options, onChange, minWidth, emptyLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const sel = options.find(o => o.value === value);
  const temValor = !!value;
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: minWidth || 150, flex: '0 1 auto' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: temValor ? HUB_PALETTE.champanhe + '12' : HUB_PALETTE.areiaDim + '0a', border: `1px solid ${temValor ? HUB_PALETTE.champanhe + '66' : HUB_PALETTE.areiaDim + '33'}`, color: temValor ? HUB_PALETTE.marfim : HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '9px 12px', cursor: 'pointer', textAlign: 'left', transition: 'border-color 180ms, background 180ms' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 8 }}>{label}</span>
          {sel ? sel.label : (emptyLabel || 'Todos')}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}>
          <path d="M1 1l4 4 4-4" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="listbox" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}44`, maxHeight: 240, overflowY: 'auto', marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {[{ value: '', label: emptyLabel || 'Todos' }, ...options].map(o => (
            <div key={o.value || '__todos'} role="option" aria-selected={o.value === value}
              onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              style={{ padding: '8px 12px', cursor: 'pointer', background: o.value === value ? HUB_PALETTE.champanhe + '22' : 'transparent', color: o.value === value ? HUB_PALETTE.marfim : HUB_PALETTE.areia, fontFamily: 'Inter, sans-serif', fontSize: 13 }}
              onMouseEnter={e => { e.currentTarget.style.background = HUB_PALETTE.champanhe + '18'; }}
              onMouseLeave={e => { e.currentTarget.style.background = o.value === value ? HUB_PALETTE.champanhe + '22' : 'transparent'; }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tipos de Cortesia ────────────────────────────────────────────────────────
function TiposCortesiaPanel({ isMobile, isPhone }) {
  const [lista, setLista] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nome: '', descricao: '' });
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState(null);

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, err) { setToast({ msg, err: !!err }); setTimeout(() => setToast(null), 2800); }

  async function carregar() {
    try {
      const r = await fetch('/api/admin/tipos-cortesia', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      setLista(d.tipos || []);
    } catch { setLista([]); }
  }

  useEffect(() => { carregar(); }, []);

  function abrirNovo() { setForm({ nome: '', descricao: '' }); setErro(''); setEditing(null); setCreating(true); }
  function abrirEditar(t) { setForm({ nome: t.nome, descricao: t.descricao || '' }); setErro(''); setCreating(false); setEditing(t); }
  function fechar() { setCreating(false); setEditing(null); setErro(''); setForm({ nome: '', descricao: '' }); }

  useEffect(() => {
    if (!creating) return;
    const fn = e => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [creating]);

  async function salvar() {
    const nome = form.nome.trim();
    const descricao = form.descricao.trim();
    if (!nome) { setErro('Nome obrigatório'); return; }
    setSaving(true); setErro('');
    try {
      const url = editing ? `/api/admin/tipos-cortesia/${editing.id}` : '/api/admin/tipos-cortesia';
      const r = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ nome, descricao }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notify(editing ? 'Tipo atualizado.' : 'Tipo criado.');
      fechar();
      await carregar();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }

  async function toggleAtivo(tipo) {
    if (savingId === tipo.id) return;
    setSavingId(tipo.id);
    setLista(prev => prev.map(t => t.id === tipo.id ? { ...t, ativo: !t.ativo } : t));
    try {
      const r = await fetch(`/api/admin/tipos-cortesia/${tipo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ ativo: !tipo.ativo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erro || `Erro ${r.status}`);
      notify(tipo.ativo ? 'Tipo desativado.' : 'Tipo ativado.');
    } catch (e) {
      setLista(prev => prev.map(t => t.id === tipo.id ? { ...t, ativo: tipo.ativo } : t));
      notify(e.message || 'Erro de conexão.', true);
    }
    setSavingId(null);
  }

  async function confirmarExclusao() {
    if (!confirmar) return;
    const { id, nome } = confirmar;
    setConfirmar(null);
    try {
      const r = await fetch(`/api/admin/tipos-cortesia/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao excluir', true); return; }
      notify(`"${nome}" excluído.`);
      await carregar();
    } catch { notify('Erro de conexão', true); }
  }

  const cs = {
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '9px 12px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 5, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '9px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}55`, padding: '9px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (
    <div>
      {/* Cabeçalho com contador e botão novo */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>
            {lista !== null ? `${lista.length} tipo${lista.length !== 1 ? 's' : ''} cadastrado${lista.length !== 1 ? 's' : ''}` : '—'}
          </div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim + 'bb', marginTop: 5, lineHeight: 1.5, maxWidth: 460 }}>
            Defina as categorias de cortesia disponíveis para concessão aos hóspedes.
          </div>
        </div>
        {!creating && !editing && (
          <button onClick={abrirNovo} style={{ ...cs.btnPrim, display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Novo Tipo
          </button>
        )}
      </div>

      {/* Modal de criação */}
      {creating && ReactDOM.createPortal(
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: HUB_PALETTE.noiteAlt, padding: isMobile ? 24 : 36, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,0.28)' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 14, height: 1, background: HUB_PALETTE.champanhe, flexShrink: 0 }} />
              Novo Tipo de Cortesia
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.marfim + '99', marginBottom: 6, display: 'block' }}>Nome *</label>
              <input
                type="text"
                value={form.nome}
                onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') fechar(); }}
                placeholder="Ex: Upgrade de Apartamento"
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.marfim + '08', border: `1px solid ${HUB_PALETTE.marfim}22`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 13px', outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = HUB_PALETTE.champanhe + '99'; }}
                onBlur={e => { e.target.style.borderColor = HUB_PALETTE.marfim + '22'; }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.marfim + '99', marginBottom: 6, display: 'block' }}>Descrição</label>
              <input
                type="text"
                value={form.descricao}
                onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') fechar(); }}
                placeholder="Descrição opcional"
                style={{ width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.marfim + '08', border: `1px solid ${HUB_PALETTE.marfim}22`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 13px', outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = HUB_PALETTE.champanhe + '99'; }}
                onBlur={e => { e.target.style.borderColor = HUB_PALETTE.marfim + '22'; }}
              />
            </div>
            {erro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#C0392B', marginBottom: 14 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={salvar} disabled={saving} style={{ background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '10px 24px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? '…' : 'Criar'}
              </button>
              <button onClick={fechar} style={{ background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.marfim}33`, padding: '10px 24px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Lista */}
      {lista === null ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>Carregando…</div>
        </div>
      ) : (
        <>
          {!creating && lista.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhum tipo cadastrado.</div>
            </div>
          )}
          {lista.length > 0 && (
            <div style={{ borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
              {lista.map(tipo => {
                const isEditingThis = editing && editing.id === tipo.id;
                const isToggling = savingId === tipo.id;
                const isConfirming = confirmar && confirmar.id === tipo.id;
                return (
                  <div key={tipo.id} style={{ borderBottom: `1px solid ${HUB_PALETTE.areiaDim}14` }}>
                    {isEditingThis ? (
                      <div style={{ padding: '14px 0 14px 15px', background: HUB_PALETTE.areiaDim + '06' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 12 }}>Editando</div>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: 12, marginBottom: 10 }}>
                          <div>
                            <label style={cs.label}>Nome *</label>
                            <input type="text" value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') fechar(); }} autoFocus style={cs.input} onFocus={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '66'; }} onBlur={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '33'; }} />
                          </div>
                          <div>
                            <label style={cs.label}>Descrição</label>
                            <input type="text" value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') fechar(); }} style={cs.input} onFocus={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '66'; }} onBlur={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '33'; }} />
                          </div>
                        </div>
                        {erro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#E07A5F', marginBottom: 10 }}>{erro}</div>}
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button onClick={salvar} disabled={saving} style={{ ...cs.btnPrim, opacity: saving ? 0.6 : 1 }}>{saving ? '…' : 'Salvar'}</button>
                          <button onClick={fechar} style={cs.btnGhost}>Cancelar</button>
                        </div>
                      </div>
                    ) : isConfirming ? (
                      <div style={{ padding: '14px 0 14px 15px', background: '#E07A5F08' }}>
                        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim, marginBottom: 12 }}>
                          Excluir <strong>"{tipo.nome}"</strong>? Esta ação não pode ser desfeita.
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button onClick={confirmarExclusao} style={{ background: 'transparent', color: '#E07A5F', border: '1px solid #E07A5F88', padding: '7px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}>Sim, excluir</button>
                          <button onClick={() => setConfirmar(null)} style={cs.btnGhost}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0' }}>
                        <div style={{ width: 3, height: 36, background: tipo.ativo ? HUB_PALETTE.champanhe : 'transparent', flexShrink: 0, borderRadius: 2, transition: 'background 300ms' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.marfim, fontWeight: 500 }}>{tipo.nome}</span>
                            <button
                              onClick={() => !isToggling && toggleAtivo(tipo)}
                              disabled={isToggling}
                              style={{ background: tipo.ativo ? `${HUB_PALETTE.champanhe}18` : `${HUB_PALETTE.areiaDim}10`, border: `1px solid ${tipo.ativo ? HUB_PALETTE.champanhe + '44' : HUB_PALETTE.areiaDim + '33'}`, color: tipo.ativo ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '2px 7px', cursor: isToggling ? 'wait' : 'pointer', transition: 'all 220ms', opacity: isToggling ? 0.5 : 1 }}
                            >
                              {isToggling ? '…' : (tipo.ativo ? 'Ativo' : 'Inativo')}
                            </button>
                          </div>
                          {tipo.descricao && (
                            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, marginTop: 3 }}>{tipo.descricao}</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <button onClick={() => abrirEditar(tipo)} style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }}>Editar</button>
                          <button onClick={() => setConfirmar(tipo)} style={{ background: 'transparent', border: '1px solid #E07A5F44', color: '#E07A5F', fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }}>Excluir</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {toast && ReactDOM.createPortal(
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: toast.err ? '#C0392B' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 24px', pointerEvents: 'none', maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>
          {toast.msg}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Cortesias (autorização para concessão de cortesias) ─────────────────────
function CortesiasPanel({ isMobile }) {
  const isPhone = useWindowWidth() < 480;
  const [subAba, setSubAba] = useState('colaboradores');
  const [users, setUsers] = useState(null);
  const [cortesias, setCortesias] = useState(null);
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState({});
  const [toast, setToast] = useState(null);

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, err) { setToast({ msg, err: !!err }); setTimeout(() => setToast(null), 2800); }

  async function carregar() {
    try {
      const [usersR, cortR] = await Promise.all([
        fetch('/api/admin/all-users', { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
        fetch('/api/admin/cortesias', { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
      ]);
      setUsers(usersR.users || []);
      setCortesias(new Set((cortR.cortesias || []).map(e => e.toLowerCase())));
    } catch { setUsers([]); setCortesias(new Set()); }
  }

  useEffect(() => { carregar(); }, []);

  async function toggle(email, temCortesia) {
    const emailNorm = email.toLowerCase();
    setSaving(p => ({ ...p, [emailNorm]: true }));
    setCortesias(prev => {
      const next = new Set(prev);
      if (temCortesia) next.delete(emailNorm); else next.add(emailNorm);
      return next;
    });
    try {
      const r = await fetch(
        temCortesia
          ? `/api/admin/cortesias/${encodeURIComponent(emailNorm)}`
          : '/api/admin/cortesias',
        {
          method: temCortesia ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: temCortesia ? undefined : JSON.stringify({ email: emailNorm }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erro || `Erro ${r.status}`);
      notify(temCortesia ? 'Permissão revogada.' : 'Permissão concedida.');
    } catch (e) {
      setCortesias(prev => {
        const next = new Set(prev);
        if (temCortesia) next.add(emailNorm); else next.delete(emailNorm);
        return next;
      });
      notify(e.message || 'Erro de conexão.', true);
    }
    setSaving(p => ({ ...p, [emailNorm]: false }));
  }

  const loading = users === null || cortesias === null;
  const totalAutorizados = !loading ? (users || []).filter(u => cortesias.has((u.email || '').toLowerCase())).length : 0;

  const filtrados = !loading ? (users || []).filter(u => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (u.nome || '').toLowerCase().includes(q)
      || (u.nome_completo || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.setor || '').toLowerCase().includes(q)
      || (u.cargo || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const ea = (a.email || '').toLowerCase();
    const eb = (b.email || '').toLowerCase();
    const ca = cortesias.has(ea) ? 0 : 1;
    const cb = cortesias.has(eb) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const na = (a.nome || a.nome_completo || '').toLowerCase();
    const nb = (b.nome || b.nome_completo || '').toLowerCase();
    return na.localeCompare(nb, 'pt');
  }) : [];
  const autorizadosCount = !loading ? filtrados.filter(u => cortesias.has((u.email || '').toLowerCase())).length : 0;
  const naoAutorizadosCount = !loading ? filtrados.length - autorizadosCount : 0;

  const corAutorizado = HUB_PALETTE.champanhe;
  const corNaoAutorizado = HUB_PALETTE.areiaDim;

  return (
    <div>
      {/* ── Cabeçalho ── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />
          Permissões
        </div>
        <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: isMobile ? 32 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px', lineHeight: 1.1 }}>Cortesias.</h2>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 540 }}>
          Defina quais colaboradores têm permissão para conceder cortesias aos hóspedes.
        </p>
        {subAba === 'colaboradores' && !loading && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: `1px solid ${HUB_PALETTE.areiaDim}28`, overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px', borderRight: `1px solid ${HUB_PALETTE.areiaDim}28`, background: `${HUB_PALETTE.champanhe}12` }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, color: HUB_PALETTE.champanhe, display: 'block', lineHeight: 1 }}>{totalAutorizados}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginTop: 3 }}>autorizados</span>
            </div>
            <div style={{ padding: '8px 16px' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, color: HUB_PALETTE.areiaDim, display: 'block', lineHeight: 1 }}>{users.length}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim + '88', display: 'block', marginTop: 3 }}>total</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Sub-tabs ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, marginBottom: 28 }}>
        {[{ id: 'colaboradores', label: 'Colaboradores' }, { id: 'tipos', label: 'Tipos' }].map(s => (
          <button key={s.id} onClick={() => setSubAba(s.id)}
            style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${subAba === s.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: subAba === s.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '10px 18px 8px', cursor: 'pointer', transition: 'color 180ms, border-color 180ms' }}>
            {s.label}
          </button>
        ))}
      </div>

      {subAba === 'colaboradores' && <>

      {/* ── Busca ── */}
      <div style={{ position: 'relative', marginBottom: 28 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="search"
          placeholder="Buscar por nome, ramal ou setor…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          autoComplete="new-password" name="cortesias-busca-x4m2" data-lpignore="true" spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', background: `${HUB_PALETTE.areiaDim}10`, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '10px 14px 10px 36px', outline: 'none' }}
          onFocus={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '66'; }}
          onBlur={e => { e.target.style.borderColor = HUB_PALETTE.areiaDim + '33'; }}
        />
        {busca && (
          <button onClick={() => setBusca('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: HUB_PALETTE.areiaDim, padding: 4, lineHeight: 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>Carregando…</div>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>
            {busca ? 'Nenhum usuário encontrado para esta busca.' : 'Nenhum usuário disponível.'}
          </div>
        </div>
      ) : (
        <div>
          {filtrados.map((u, idx) => {
            const emailNorm = (u.email || '').toLowerCase();
            const nome = u.nome || u.nome_completo || '—';
            const temCortesia = cortesias.has(emailNorm);
            const isSaving = !!saving[emailNorm];
            const isAdmin = u.tipo === 'admin' || u.is_master;
            const prevEmail = idx > 0 ? (filtrados[idx - 1].email || '').toLowerCase() : null;
            const prevTemCortesia = prevEmail !== null ? cortesias.has(prevEmail) : null;
            const showAuthHeader = temCortesia && (idx === 0 || prevTemCortesia === false);
            const showNonAuthHeader = !temCortesia && (idx === 0 || prevTemCortesia === true);

            return (
              <React.Fragment key={emailNorm}>
                {showAuthHeader && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, whiteSpace: 'nowrap' }}>Autorizados</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: HUB_PALETTE.champanhe + '66' }}>{autorizadosCount}</span>
                    <div style={{ flex: 1, height: 1, background: `${HUB_PALETTE.champanhe}44` }} />
                  </div>
                )}
                {showNonAuthHeader && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, paddingTop: autorizadosCount > 0 ? 32 : 0 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, whiteSpace: 'nowrap' }}>Não Autorizados</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: HUB_PALETTE.areiaDim + '66' }}>{naoAutorizadosCount}</span>
                    <div style={{ flex: 1, height: 1, background: `${HUB_PALETTE.areiaDim}33` }} />
                  </div>
                )}
              <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 10 : 16, padding: '13px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}14` }}>

                {/* Indicador lateral */}
                <div style={{ width: 3, height: 36, background: temCortesia ? corAutorizado : 'transparent', flexShrink: 0, transition: 'background 300ms', borderRadius: 2 }} />

                {/* Avatar */}
                <AvatarUsuario size={36} email={u.email} nome={nome} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.marfim, fontWeight: 400, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nome}</span>
                    {isAdmin && (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.dourado, border: `1px solid ${HUB_PALETTE.dourado}44`, padding: '1px 5px', flexShrink: 0 }}>admin</span>
                    )}
                    {u.is_master && (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.jangada, border: `1px solid ${HUB_PALETTE.jangada}44`, padding: '1px 5px', flexShrink: 0 }}>master</span>
                    )}
                  </div>
                  {!isPhone && (
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.areiaDim + 'bb', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.setor ? <><span>{u.setor}</span><span style={{ margin: '0 5px', opacity: 0.4 }}>·</span></> : null}
                      <span>{u.email}</span>
                    </div>
                  )}
                </div>

                {/* Toggle */}
                <button
                  onClick={() => !isSaving && toggle(emailNorm, temCortesia)}
                  disabled={isSaving}
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    background: temCortesia ? `${corAutorizado}18` : 'transparent',
                    border: `1px solid ${temCortesia ? corAutorizado + '55' : HUB_PALETTE.areiaDim + '33'}`,
                    color: temCortesia ? corAutorizado : HUB_PALETTE.areiaDim,
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
                    padding: isPhone ? '7px 10px' : '7px 16px', cursor: isSaving ? 'wait' : 'pointer',
                    transition: 'all 220ms', opacity: isSaving ? 0.55 : 1,
                    minWidth: isPhone ? 0 : 112,
                  }}
                  onMouseEnter={e => { if (!isSaving) { e.currentTarget.style.borderColor = temCortesia ? corAutorizado + '99' : HUB_PALETTE.areiaDim + '66'; } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = temCortesia ? corAutorizado + '55' : HUB_PALETTE.areiaDim + '33'; }}
                >
                  {isSaving ? (
                    <span style={{ opacity: 0.7 }}>…</span>
                  ) : temCortesia ? (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      {!isPhone && 'Autorizado'}
                    </>
                  ) : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      {!isPhone && 'Autorizar'}
                    </>
                  )}
                </button>
              </div>
              </React.Fragment>
            );
          })}

          {/* Rodapé com contagem filtrada */}
          {busca && filtrados.length > 0 && (
            <div style={{ paddingTop: 20, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim + '88', textAlign: 'center' }}>
              {filtrados.length} resultado{filtrados.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && ReactDOM.createPortal(
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: toast.err ? '#C0392B' : HUB_PALETTE.champanhe, color: toast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 24px', pointerEvents: 'none', maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>
          {toast.msg}
        </div>,
        document.body
      )}
      </>}
      {subAba === 'tipos' && <TiposCortesiaPanel isMobile={isMobile} isPhone={isPhone} />}
    </div>
  );
}

// ─── Contas (CRUD de admins do TI e usuarios do portal) ─────────────────────
// ── Avatar do usuario: foto do Outlook (quando o Graph estiver configurado) com
// fallback para as iniciais (nome + sobrenome) num circulo colorido. Ajuda na
// identificacao visual na lista de Contas. ──
function _avatarIniciais(nome) {
  let parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
  // Ignora prefixo generico tipo "Usuário" em nomes-rotulo (ex.: "Usuário Caio ...").
  if (parts.length > 1 && /^usu[aá]rios?$/i.test(parts[0])) parts = parts.slice(1);
  if (!parts.length) return '?';
  const ini = (parts[0][0] || '') + (parts.length > 1 ? (parts[parts.length - 1][0] || '') : '');
  return ini.toUpperCase();
}
// Paleta curada (tons terrosos/sobrios, coerentes com o Hub) em vez de HSL
// aleatorio — os avatares ficam "desenhados", nao um arco-iris.
const _AVATAR_PALETTE = ['#8C6A56', '#6E7F6A', '#7A6A86', '#5F7A88', '#9C7A4A', '#8A5D5D', '#5B7A6E', '#7E7458', '#69708A', '#8A6E7E'];
function _avatarCor(chave) {
  let h = 0; const s = String(chave || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _AVATAR_PALETTE[h % _AVATAR_PALETTE.length];
}
function _avatarEscurece(hex, f) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - f)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - f)));
  const b = Math.max(0, Math.round((n & 255) * (1 - f)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
// Disponibilidade da foto (Microsoft Graph) — checada UMA vez e memoizada. Sem
// Graph configurado no backend (/api/foto/disponivel => {disponivel:false}), o
// front NEM tenta buscar foto: zero requisicao perdida, so as iniciais.
let _fotosGraphDisp = null; let _avataresSet = new Set(); let _fotosGraphProm = null;
function _fotosDisponiveis() {
  if (_fotosGraphDisp !== null) return Promise.resolve();
  if (_fotosGraphProm) return _fotosGraphProm;
  const tk = (typeof localStorage !== 'undefined' && localStorage.getItem('hub_sso_token')) || '';
  _fotosGraphProm = fetch('/api/foto/disponivel', { headers: tk ? { Authorization: 'Bearer ' + tk } : {} })
    .then(r => (r.ok ? r.json() : null))
    .then(d => { _fotosGraphDisp = !!(d && d.graph); _avataresSet = new Set(((d && d.avatares) || []).map(e => String(e).toLowerCase())); })
    .catch(() => { _fotosGraphDisp = false; _avataresSet = new Set(); });
  return _fotosGraphProm;
}
function _temFoto(email) { return !!(_fotosGraphDisp || (email && _avataresSet.has(String(email).toLowerCase()))); }
// Versao por email para bustar o cache do avatar apos upload/remocao.
const _avatarVer = new Map();
function _bumpAvatarVer(email) { const e = String(email || '').toLowerCase(); _avatarVer.set(e, (_avatarVer.get(e) || 0) + 1); }
// Redimensiona/recorta (quadrado, cover) e devolve dataURL JPEG pequeno.
function _resizeImagem(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const cv = document.createElement('canvas'); cv.width = max; cv.height = max;
      cv.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, max, max);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
    img.src = url;
  });
}
function AvatarUsuario({ nome, email, size = 40 }) {
  const [fotoSrc, setFotoSrc] = useState(null);
  const ver = email ? (_avatarVer.get(String(email).toLowerCase()) || 0) : 0;
  useEffect(() => {
    let vivo = true, urlObj = null;
    setFotoSrc(null);
    if (!email) return undefined;
    (async () => {
      await _fotosDisponiveis();
      if (!_temFoto(email) || !vivo) return;
      try {
        const tk = localStorage.getItem('hub_sso_token') || '';
        const r = await fetch('/api/foto?email=' + encodeURIComponent(email) + '&v=' + ver, { headers: { Authorization: 'Bearer ' + tk } });
        if (!r.ok || !vivo) return;
        const blob = await r.blob();
        if (!vivo) return;
        urlObj = URL.createObjectURL(blob);
        setFotoSrc(urlObj);
      } catch {}
    })();
    return () => { vivo = false; if (urlObj) URL.revokeObjectURL(urlObj); };
  }, [email, ver]);
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: `1px solid ${HUB_PALETTE.areiaDim}55`, background: HUB_PALETTE.noiteAlt };
  if (fotoSrc) {
    return (
      <div style={base}>
        <img src={fotoSrc} alt={nome || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  const iniciais = _avatarIniciais(nome);
  if (iniciais) {
    return (
      <div style={{ ...base, color: HUB_PALETTE.marfim, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: Math.round(size * 0.34), fontWeight: 500, letterSpacing: '0.03em' }} title={nome || ''} aria-label={nome || ''}>
        {iniciais}
      </div>
    );
  }
  return (
    <div style={base} title={nome || ''} aria-label={nome || ''}>
      <svg width={Math.round(size * 0.48)} height={Math.round(size * 0.48)} viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.marfim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    </div>
  );
}

function ContasPanel({ isMobile }) {
  const isPhone = useWindowWidth() < 480;
  const [subAba, _setSubAba] = useState(() => {
    try { return sessionStorage.getItem('hub_contas_subaba') || 'usuarios'; } catch { return 'usuarios'; }
  });
  const setSubAba = (v) => { try { sessionStorage.setItem('hub_contas_subaba', v); } catch {} _setSubAba(v); };
  // Filtros persistidos na URL (?ctstatus=&ctsetor=&ctcargo=&ctq=&ctord=).
  // Precedencia na carga: URL > sessionStorage > default. Nao toca nos params
  // do SSO (?theme, ?next, sso_token).
  const _urlFiltros = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return { status: p.get('ctstatus'), setor: p.get('ctsetor'), cargo: p.get('ctcargo'), q: p.get('ctq'), ord: p.get('ctord') };
    } catch { return {}; }
  })();
  const [statusAba, _setStatusAba] = useState(() => {
    try {
      const saved = sessionStorage.getItem('hub_contas_status');
      const validos = ['todos', 'ativo', 'desligado', 'precadastro', 'ativacao_pendente', 'bloqueado'];
      if (_urlFiltros.status && validos.includes(_urlFiltros.status)) return _urlFiltros.status;
      return validos.includes(saved) ? saved : 'ativo';
    } catch { return 'ativo'; }
  });
  const setStatusAba = (v) => { try { sessionStorage.setItem('hub_contas_status', v); } catch {} _setStatusAba(v); };
  const [admins, setAdmins] = useState(null);
  const [usuarios, setUsuarios] = useState(null);
  const [setoresLista, setSetoresLista] = useState([]);
  const [etiquetasLista, setEtiquetasLista] = useState([]);
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 200);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const setOrDel = (k, v, def) => { if (v && v !== def) p.set(k, v); else p.delete(k); };
      setOrDel('ctstatus', statusAba, 'ativo');
      setOrDel('ctq', buscaDebounced, '');
      const qs = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch {}
  }, [statusAba, buscaDebounced, subAba]);
  useEffect(() => () => {
    try {
      const p = new URLSearchParams(window.location.search);
      ['ctstatus','ctq','ctsetor','ctcargo','ctord'].forEach(k => p.delete(k));
      const qs = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch {}
  }, []);
  const [editing, setEditing] = useState(null); // { tipo, id, dados, etiquetas? }
  const [creating, setCreating] = useState(null); // 'admin' | 'usuario'
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');
  const [avatarTick, setAvatarTick] = useState(0); void avatarTick; // re-render da lista quando um avatar muda
  const [historicoUsuario, setHistoricoUsuario] = useState(null); // { id, nome }
  const [resetandoSenha, setResetandoSenha] = useState({}); // { tipo-id: true } — loading por card
  const [confirmAtivo, setConfirmAtivo] = useState(null); // { tipo, row, ativar:boolean }
  const [togglingAtivo, setTogglingAtivo] = useState(false);
  const [modalAtivacao, setModalAtivacao] = useState(null); // null | { url, nome }
  const [gerandoLink, setGerandoLink] = useState({}); // { userId: true }
  const [desbloqueando, setDesbloqueando] = useState({}); // { userId: true }

  // Email do admin logado (extraido do JWT em localStorage). Usado para impedir
  // que ele ative/desative a propria conta.
  const meuEmail = (parseJwt(localStorage.getItem('hub_sso_token')).email || '').toLowerCase();
  function ehEuMesmo(tipo, row) {
    if (tipo !== 'admin' || !meuEmail || !row || !row.email) return false;
    return String(row.email).toLowerCase() === meuEmail;
  }

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg) { setToast(msg); setTimeout(() => setToast(''), 2600); }
  async function enviarLinkReset(tipo, id) {
    const key = (tipo === 'admin' ? 'a' : 'u') + id;
    setResetandoSenha(p => ({ ...p, [key]: true }));
    try {
      const rota = tipo === 'admin'
        ? `/api/admin/chamados-admins/${id}/reset-link`
        : `/api/admin/chamados-usuarios/${id}/reset-link`;
      const r = await fetch(rota, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) notify('Link de redefinição enviado por e-mail.');
      else notify(d.erro || 'Erro ao enviar link.');
    } catch { notify('Erro de conexão.'); }
    setResetandoSenha(p => ({ ...p, [key]: false }));
  }

  async function gerarLinkAtivacao(userId) {
    setGerandoLink(p => ({ ...p, [userId]: true }));
    try {
      const r = await fetch(`/api/admin/chamados-usuarios/${userId}/gerar-link`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) {
        setModalAtivacao({ url: d.activation_url, nome: d.nome });
        loadUsuarios();
      } else notify(d.erro || 'Erro ao gerar link.');
    } catch { notify('Erro de conexão.'); }
    setGerandoLink(p => ({ ...p, [userId]: false }));
  }

  async function desbloquearUsuario(userId) {
    setDesbloqueando(p => ({ ...p, [userId]: true }));
    try {
      const r = await fetch(`/api/admin/chamados-usuarios/${userId}/desbloquear`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) { notify('Usuário desbloqueado.'); loadUsuarios(); }
      else notify(d.erro || 'Erro ao desbloquear.');
    } catch { notify('Erro de conexão.'); }
    setDesbloqueando(p => ({ ...p, [userId]: false }));
  }

  async function loadSetoresEEtiquetas() {
    try {
      const [s, e] = await Promise.all([
        fetch('/api/admin/chamados-setores', { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
        fetch('/api/admin/chamados-etiquetas', { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
      ]);
      if (s.ok) setSetoresLista(s.setores || []);
      if (e.ok) setEtiquetasLista(e.etiquetas || []);
    } catch {}
  }

  async function loadAdmins() {
    try {
      const r = await fetch('/api/admin/chamados-admins', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (d.ok) setAdmins(d.admins || []);
      else setAdmins([]);
    } catch { setAdmins([]); }
  }
  async function loadUsuarios() {
    try {
      const r = await fetch('/api/admin/chamados-usuarios', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (d.ok) setUsuarios(d.usuarios || []);
      else setUsuarios([]);
    } catch { setUsuarios([]); }
  }
  useEffect(() => { loadAdmins(); loadUsuarios(); loadSetoresEEtiquetas(); }, []);

  async function startEdit(tipo, row) {
    setErro('');
    if (tipo === 'admin') {
      let slugs = [];
      try {
        const r = await fetch(`/api/admin/chamados-admins/${row.id}/etiquetas`, { headers: { Authorization: `Bearer ${token()}` } });
        const d = await r.json();
        if (d.ok) slugs = d.slugs || [];
      } catch {}
      setEditing({ tipo, id: row.id, etiquetas: slugs, dados: {
        nome_completo: row.nome_completo, email: row.email || '',
        ramal: row.ramal || '', cargo: row.cargo || '', matricula: row.matricula || '',
        data_admissao: row.data_admissao || '', data_nascimento: row.data_nascimento || '',
        vinculo: row.vinculo || '', bilingue: !!row.bilingue, idiomas: row.idiomas || '',
        is_master: !!row.is_master, senha: '', ativo: !!row.ativo,
      }});
    } else {
      setEditing({ tipo, id: row.id, dados: {
        nome: row.nome, email: row.email || '', setor: row.setor || '',
        ramal: row.ramal || '', cargo: row.cargo || '', matricula: row.matricula || '',
        data_admissao: row.data_admissao || '', data_nascimento: row.data_nascimento || '',
        vinculo: row.vinculo || '', bilingue: !!row.bilingue, idiomas: row.idiomas || '',
        senha: '', ativo: row.ativo !== 0,
      }});
    }
  }
  function startNew(tipo) {
    setErro('');
    if (tipo === 'admin') setCreating('admin');
    else setCreating('usuario');
  }
  function fecharModal() { setEditing(null); setCreating(null); setErro(''); }

  async function salvarNovo(tipo, dados) {
    setSaving(true); setErro('');
    const rota = tipo === 'admin' ? '/api/admin/chamados-admins' : '/api/admin/chamados-usuarios';
    try {
      const r = await fetch(rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(dados),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      notifyHubMutation();
      fecharModal();
      if (tipo === 'admin') {
        notify('Admin criado.');
        loadAdmins();
      } else {
        loadUsuarios();
        if (d.activation_url) setModalAtivacao({ url: d.activation_url, nome: d.nome || dados.nome || '' });
        else notify('Usuário criado.');
      }
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }
  async function salvarEdit(tipo, id, dados, etiquetas) {
    setSaving(true); setErro('');
    const rota = tipo === 'admin' ? `/api/admin/chamados-admins/${id}` : `/api/admin/chamados-usuarios/${id}`;
    const body = { ...dados };
    // Envia "senha" apenas se o admin digitou algo no campo (campo começa vazio)
    const senhaMudou = !!body.senha;
    if (!senhaMudou) delete body.senha;

    // Bloqueia salvar quando NADA mudou em relacao ao snapshot do startEdit.
    // Inclui campos textuais, ativo/is_master, senha e etiquetas (admin).
    const original = (editing && editing.dados) || {};
    const camposParaComparar = tipo === 'admin'
      ? ['nome_completo', 'email', 'ramal', 'cargo', 'matricula', 'data_admissao', 'data_nascimento', 'vinculo', 'bilingue', 'idiomas', 'is_master', 'ativo']
      : ['nome', 'email', 'setor', 'ramal', 'cargo', 'matricula', 'data_admissao', 'data_nascimento', 'vinculo', 'bilingue', 'idiomas', 'ativo'];
    const algumCampoMudou = camposParaComparar.some(k => {
      const a = original[k]; const b = dados[k];
      // Normaliza bool/int (ativo=1 == true).
      const norm = v => (v === true || v === 1) ? 1 : (v === false || v === 0 || v == null) ? 0 : v;
      if (typeof a === 'boolean' || typeof b === 'boolean' || k === 'ativo' || k === 'is_master') {
        return norm(a) !== norm(b);
      }
      return (a ?? '') !== (b ?? '');
    });
    const etOrig = JSON.stringify([...((editing && editing.etiquetas) || [])].sort());
    const etNovo = JSON.stringify([...(Array.isArray(etiquetas) ? etiquetas : [])].sort());
    const etiquetasMudaram = tipo === 'admin' && etOrig !== etNovo;
    if (!algumCampoMudou && !senhaMudou && !etiquetasMudaram) {
      notify('Faça alguma alteração antes de salvar.');
      setSaving(false);
      return;
    }
    try {
      const r = await fetch(rota, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErro(d.erro || `Erro ${r.status}`); setSaving(false); return; }
      // Sincroniza etiquetas do admin (se houve mudanca)
      if (tipo === 'admin' && Array.isArray(etiquetas)) {
        try {
          await fetch(`/api/admin/chamados-admins/${id}/etiquetas`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: JSON.stringify({ slugs: etiquetas }),
          });
        } catch {}
      }
      notifyHubMutation();
      notify('Salvo.');
      fecharModal();
      if (tipo === 'admin') loadAdmins(); else loadUsuarios();
    } catch { setErro('Erro de conexão'); }
    setSaving(false);
  }
  // Toggle agora passa por modal de confirmacao (definido no JSX abaixo).
  function pedirConfirmacaoToggle(tipo, row) {
    // Salvaguarda no front: admin nao pode ativar/inativar a si mesmo
    if (ehEuMesmo(tipo, row)) {
      notify('Você não pode ativar/desativar sua própria conta.');
      return;
    }
    const estaAtivo = tipo === 'admin' ? row.ativo === 1 : row.ativo !== 0;
    setConfirmAtivo({ tipo, row, ativar: !estaAtivo });
  }
  async function executarToggleAtivo() {
    if (!confirmAtivo) return;
    const { tipo, row, ativar } = confirmAtivo;
    setTogglingAtivo(true);
    const rota = tipo === 'admin' ? `/api/admin/chamados-admins/${row.id}` : `/api/admin/chamados-usuarios/${row.id}`;
    try {
      const r = await fetch(rota, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ ativo: ativar ? 1 : 0 }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        notifyHubMutation();
        notify(ativar ? 'Conta ativada.' : 'Conta desativada.');
        setConfirmAtivo(null);
        if (tipo === 'admin') loadAdmins(); else loadUsuarios();
      } else {
        notify(d.erro || 'Falha ao atualizar.');
      }
    } catch { notify('Erro de conexão.'); }
    setTogglingAtivo(false);
  }

  const isAdmin = subAba === 'admins';
  const lista = isAdmin ? admins : usuarios;
  // Filtragem/ordenacao extraida para filtrarOrdenarContas (espelhada e testada
  // em src/contas-filtros.js). Busca: nome, email, login, ramal, setor, cargo,
  // matricula + flags (master, inativo); multi-palavra = AND.
  function getStatusEfetivo(r) {
    if (isAdmin) return r.ativo === 1 ? 'ativo' : 'desligado';
    return r.hub_status || (r.ativo !== 0 ? 'ativo' : 'desligado');
  }
  const filtroResult = filtrarOrdenarContas(lista, {
    isAdmin,
    busca: buscaDebounced,
    status: statusAba,
    setor: '',
    cargo: '',
    ordem: 'nome',
  });
  const filtrada = filtroResult.resultado;
  const contagemStatus = filtroResult.contagem;
  const buscaFiltrada = filtroResult.base;
  const nFiltrosAtivos = (statusAba !== 'ativo' && statusAba !== 'todos' ? 1 : 0) + (buscaDebounced.trim() ? 1 : 0);
  function limparFiltros() {
    setStatusAba('ativo');
    setBusca('');
    setBuscaDebounced('');
  }

  const btnPad = isPhone ? '8px 12px' : '9px 14px';
  const btnFs = isPhone ? 10 : 11;
  const cs = {
    bg: HUB_PALETTE.areiaDim + '0a',
    border: HUB_PALETTE.areiaDim + '33',
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: btnPad, fontFamily: 'JetBrains Mono, monospace', fontSize: btnFs, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: btnPad, fontFamily: 'JetBrains Mono, monospace', fontSize: btnFs, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Contas
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: isMobile ? 26 : 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Gerenciar contas.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Administração das contas de acesso da plataforma.
      </p>
    </div>

    {/* Sub-tabs tipo */}
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, marginBottom: 14 }}>
      {[{ id: 'admins', label: 'Administradores' }, { id: 'usuarios', label: 'Usuários' }].map(s => (
        <button key={s.id} onClick={() => { setSubAba(s.id); setBusca(''); setBuscaDebounced(''); setStatusAba('ativo'); }}
          style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${subAba === s.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: subAba === s.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '10px 18px 8px', cursor: 'pointer' }}>
          {s.label}
        </button>
      ))}
    </div>
    {/* Sub-tabs status */}
    {(() => {
      const todasOpcoes = [
        { id: 'todos',             label: 'Todos',             dot: null,      total: buscaFiltrada.length },
        { id: 'ativo',             label: 'Ativo',             dot: '#62A852', total: contagemStatus['ativo'] || 0 },
        { id: 'precadastro',       label: 'Pré-cadastro',      dot: '#D4AC0D', total: contagemStatus['precadastro'] || 0 },
        { id: 'ativacao_pendente', label: 'Ativação pendente', dot: '#E88B2A', total: contagemStatus['ativacao_pendente'] || 0 },
        { id: 'bloqueado',         label: 'Bloqueado',         dot: '#5BA3CC', total: contagemStatus['bloqueado'] || 0 },
        { id: 'desligado',         label: 'Desligado',         dot: '#607D8B', total: contagemStatus['desligado'] || 0 },
      ];
      // Oculta pills com contagem 0 que nunca terão dados (ex: pré-cadastro para admins),
      // mas mantém a pill selecionada sempre visível.
      const statusOptions = todasOpcoes.filter(s => s.id === 'todos' || s.id === statusAba || s.total > 0);
      return (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {statusOptions.map(s => {
            const sel = statusAba === s.id;
            return (
              <button key={s.id} onClick={() => setStatusAba(s.id)}
                style={{ background: sel ? `${s.dot || HUB_PALETTE.champanhe}15` : 'transparent', border: `1px solid ${sel ? (s.dot || HUB_PALETTE.champanhe) + '55' : HUB_PALETTE.areiaDim + '22'}`, color: sel ? (s.dot || HUB_PALETTE.marfim) : HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: sel ? 600 : 400, padding: '5px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 150ms' }}>
                {s.dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: sel ? s.dot : HUB_PALETTE.areiaDim, flexShrink: 0 }} /> : null}
                {s.label}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, opacity: 0.7 }}>{s.total}</span>
              </button>
            );
          })}
        </div>
      );
    })()}

    {/* Toolbar */}
    <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="search" placeholder="Filtrar por nome, ramal, setor..." value={busca} onChange={e => setBusca(e.target.value)}
          autoComplete="new-password" name="contas-busca-livre-x7k9" data-lpignore="true" data-form-type="other"
          aria-label="Filtrar contas"
          style={{ ...cs.input, paddingLeft: 34 }} title="Aceita múltiplas palavras (AND) e flags 'master' / 'inativo'" />
      </div>
      <button onClick={() => startNew(isAdmin ? 'admin' : 'usuario')} style={{ ...cs.btnPrim, background: HUB_PALETTE.dourado }}>
        + Novo {isAdmin ? 'admin' : 'usuário'}
      </button>
    </div>


    {/* Lista */}
    {lista === null ? (
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase', padding: '40px 0' }}>Carregando...</div>
    ) : filtrada.length === 0 ? (
      <div style={{ padding: '40px 0' }}>
        <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim }}>
          {nFiltrosAtivos > 0 ? 'Nenhum usuário encontrado com os filtros atuais.' : 'Nenhum registro.'}
        </div>
        {nFiltrosAtivos > 0 && (
          <button onClick={limparFiltros}
            style={{ marginTop: 12, background: 'transparent', border: `1.5px solid ${HUB_PALETTE.champanhe}88`, color: HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '8px 16px', cursor: 'pointer' }}>
            Limpar filtros
          </button>
        )}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        {filtrada.map(row => {
          const ativo = isAdmin ? row.ativo === 1 : row.ativo !== 0;
          const key = (isAdmin ? 'a' : 'u') + row.id;
          const resetando = !!resetandoSenha[key];
          const hubStatus = !isAdmin ? (row.hub_status || null) : null;
          const bloqueado = hubStatus === 'bloqueado';
          const aguardandoAtivacao = hubStatus === 'ativacao_pendente';
          const statusEfetivoRow = !isAdmin ? getStatusEfetivo(row) : null;
          return (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, opacity: ativo ? 1 : 0.55, flexWrap: 'wrap' }}>
              <AvatarUsuario nome={isAdmin ? row.nome_completo : row.nome} email={row.email} />
              <div style={{ flex: 1, minWidth: 260 }}>
                {/* Linha 1: Nome + badges de status */}
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 17, color: HUB_PALETTE.marfim, fontWeight: 600, lineHeight: 1.3 }}>
                  {isAdmin ? row.nome_completo : row.nome}
                  {isAdmin && row.is_master ? <span style={{ marginLeft: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, padding: '3px 10px', border: `1px solid ${HUB_PALETTE.champanhe}88`, verticalAlign: 'middle' }}>Master</span> : null}
                  {isAdmin ? (
                    ativo
                      ? <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#62A852', padding: '3px 10px 3px 8px', border: '1px solid #62A85244', background: '#62A85212', verticalAlign: 'middle' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#62A852', flexShrink: 0 }} />Ativo</span>
                      : <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#607D8B', padding: '3px 10px 3px 8px', border: '1px solid #607D8B44', background: '#607D8B12', verticalAlign: 'middle' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#607D8B', flexShrink: 0 }} />Inativo</span>
                  ) : null}
                  {!isAdmin && statusEfetivoRow ? <HubStatusBadge status={statusEfetivoRow} style={{ marginLeft: 10, verticalAlign: 'middle' }} /> : null}
                </div>
                {/* Linha 2: Email */}
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 14, color: HUB_PALETTE.areia, marginTop: 5, lineHeight: 1.4 }}>
                  {row.email ? <span style={{ color: HUB_PALETTE.marfim }}>{row.email}</span> : <span style={{ color: HUB_PALETTE.areiaDim }}>—</span>}
                </div>
                {/* Linha 3: Setor · Ramal (+ Login para admins) */}
                {(row.setor || row.ramal || (isAdmin && row.usuario)) ? (
                  <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 13, color: HUB_PALETTE.areia, marginTop: 3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0 }}>
                    {row.setor ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 5 }}>setor</span>{row.setor}</span> : null}
                    {row.setor && row.ramal ? <span style={{ color: HUB_PALETTE.areia, margin: '0 16px', fontSize: 15, opacity: 0.6 }}>|</span> : null}
                    {row.ramal ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 5 }}>ramal</span>{row.ramal}</span> : null}
                    {isAdmin && row.usuario && (row.setor || row.ramal) ? <span style={{ color: HUB_PALETTE.areia, margin: '0 10px', fontSize: 13, opacity: 0.45 }}>|</span> : null}
                    {isAdmin && row.usuario ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 5 }}>login</span>{row.usuario}</span> : null}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                <button onClick={() => setHistoricoUsuario({ id: row.id, nome: isAdmin ? row.nome_completo : row.nome, tipo: isAdmin ? 'admin' : 'usuario' })} style={cs.btnGhost}>Histórico</button>
                <button onClick={() => startEdit(isAdmin ? 'admin' : 'usuario', row)} style={cs.btnGhost}>Editar</button>
                {aguardandoAtivacao && (
                  <button
                    onClick={() => gerarLinkAtivacao(row.id)}
                    disabled={!!gerandoLink[row.id]}
                    title="Gerar novo link de ativação (48h)"
                    style={{ ...cs.btnGhost, color: '#FB8C00', borderColor: '#FB8C0066', cursor: gerandoLink[row.id] ? 'not-allowed' : 'pointer' }}>
                    {gerandoLink[row.id] ? '…' : 'Reenviar link'}
                  </button>
                )}
                {!aguardandoAtivacao && (
                  <button
                    onClick={() => isAdmin ? enviarLinkReset('admin', row.id) : gerarLinkAtivacao(row.id)}
                    disabled={isAdmin ? (resetando || !row.email) : !!gerandoLink[row.id]}
                    title={isAdmin ? (!row.email ? 'Sem e-mail cadastrado' : 'Enviar link de redefinição de senha por e-mail (válido 24h)') : 'Gerar novo link de ativação (48h)'}
                    style={{ ...cs.btnGhost, color: (isAdmin ? resetando : !!gerandoLink[row.id]) ? HUB_PALETTE.areiaDim : HUB_PALETTE.jangada, borderColor: HUB_PALETTE.jangada + '66', cursor: (isAdmin ? (resetando || !row.email) : !!gerandoLink[row.id]) ? 'not-allowed' : 'pointer' }}>
                    {(isAdmin ? resetando : !!gerandoLink[row.id]) ? '…' : 'Redefinir senha'}
                  </button>
                )}
                {bloqueado ? (
                  <button
                    onClick={() => desbloquearUsuario(row.id)}
                    disabled={!!desbloqueando[row.id]}
                    style={{ ...cs.btnGhost, color: '#4FC3F7', borderColor: '#4FC3F766' }}>
                    {desbloqueando[row.id] ? '…' : 'Desbloquear'}
                  </button>
                ) : ehEuMesmo(isAdmin ? 'admin' : 'usuario', row) ? (
                  <span title="Você não pode ativar/desativar sua própria conta"
                    style={{ ...cs.btnGhost, background: HUB_PALETTE.marfim + '12', color: HUB_PALETTE.marfim, borderColor: HUB_PALETTE.marfim + 'BB', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 700, fontStyle: 'normal', fontSize: 12, letterSpacing: '0.12em', textTransform: 'none', cursor: 'not-allowed' }}>
                    Você
                  </span>
                ) : (
                  <button onClick={() => pedirConfirmacaoToggle(isAdmin ? 'admin' : 'usuario', row)}
                    style={{ ...cs.btnGhost, color: HUB_PALETTE.champanhe, borderColor: HUB_PALETTE.champanhe + '66' }}>
                    {ativo ? 'Inativar' : 'Ativar'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* Modal Criar */}
    {creating && (
      <ContaForm tipo={creating} isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        setores={setoresLista} etiquetas={etiquetasLista}
        onCancel={fecharModal}
        onFotoChange={() => setAvatarTick(t => t + 1)}
        onSave={(dados) => salvarNovo(creating, dados)} />
    )}

    {/* Modal Editar */}
    {editing && (
      <ContaForm tipo={editing.tipo} isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        setores={setoresLista} etiquetas={etiquetasLista}
        initial={editing.dados} initialEtiquetas={editing.etiquetas} isEdit
        ehEuMesmo={editing.tipo === 'admin' && !!editing.dados && (editing.dados.email || '').toLowerCase() === meuEmail}
        onCancel={fecharModal}
        onFotoChange={() => setAvatarTick(t => t + 1)}
        onSave={(dados, et) => salvarEdit(editing.tipo, editing.id, dados, et)} />
    )}

    {/* Modal Historico do usuario */}
    {historicoUsuario && (
      <HistoricoUsuarioModal usuarioId={historicoUsuario.id} nome={historicoUsuario.nome} tipo={historicoUsuario.tipo} isMobile={isMobile} cs={cs}
        onClose={() => setHistoricoUsuario(null)} />
    )}

    {/* Modal Confirmar ativar/inativar */}
    {confirmAtivo && (() => {
      const { tipo, row, ativar } = confirmAtivo;
      const nome = tipo === 'admin' ? row.nome_completo : row.nome;
      const acaoLabel = ativar ? 'ATIVAR' : 'DESATIVAR';
      const cor = ativar ? HUB_PALETTE.champanhe : '#E07A5F';
      return (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 170, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: isMobile ? '24px 20px' : '32px 36px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: cor, marginBottom: 6 }}>
              Confirmar {acaoLabel}
            </div>
            <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 14px', lineHeight: 1.3 }}>
              {ativar ? 'Ativar' : 'Desativar'} {tipo === 'admin' ? 'o admin' : 'o usuário'} <span style={{ color: HUB_PALETTE.champanhe }}>"{nome}"</span>?
            </h3>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: HUB_PALETTE.areia, margin: '0 0 22px', lineHeight: 1.5 }}>
              {ativar
                ? 'A conta voltará a funcionar normalmente. A pessoa poderá logar e ser referenciada em chamados.'
                : 'A conta deixará de funcionar. A pessoa não conseguirá mais logar até ser reativada. Os dados não são apagados.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAtivo(null)} disabled={togglingAtivo} style={cs.btnGhost}>Cancelar</button>
              <button onClick={executarToggleAtivo} disabled={togglingAtivo}
                style={ativar
                  ? { ...cs.btnPrim, background: '#202C28', color: '#ECE4D2', border: '1px solid #202C28', fontFamily: 'Inter, sans-serif', letterSpacing: 'normal', textTransform: 'none' }
                  : { ...cs.btnPrim, background: '#9C5843', color: '#ECE4D2' }}>
                {togglingAtivo ? '...' : (ativar ? 'Ativar' : 'Desativar')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {toast && (
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
        {toast}
      </div>
    )}

    {/* Modal de ativação — exibido após criar usuário ou gerar novo link */}
    {modalAtivacao && (() => {
      const { url, nome } = modalAtivacao;
      const waMensagem = encodeURIComponent(`Olá, ${nome}!\n\nSeu acesso ao portal Gran Marquise foi criado. Clique no link abaixo para definir sua senha e ativar a conta (válido por 48h):\n\n${url}`);
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.champanhe}44`, maxWidth: 520, width: '100%', padding: isMobile ? '28px 22px' : '38px 42px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 8 }}>
              Usuário criado — Ativação pendente
            </div>
            <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 24, color: HUB_PALETTE.marfim, margin: '0 0 16px', lineHeight: 1.3 }}>
              Link de ativação gerado para <span style={{ color: HUB_PALETTE.champanhe }}>{nome}</span>.
            </h3>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: HUB_PALETTE.areia, lineHeight: 1.6, margin: '0 0 16px' }}>
              Compartilhe o link abaixo com o usuário. Ele terá <strong style={{ color: HUB_PALETTE.marfim }}>48 horas</strong> para clicar e definir a própria senha.
            </p>
            <div style={{ background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, padding: '10px 14px', marginBottom: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areia, wordBreak: 'break-all', lineHeight: 1.6 }}>
              {url}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => { navigator.clipboard.writeText(url).catch(() => {}); notify('Link copiado!'); }}
                style={{ background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '11px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Copiar link
              </button>
              <a href={`https://wa.me/?text=${waMensagem}`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#25D366', color: '#fff', border: 'none', padding: '11px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none' }}>
                WhatsApp
              </a>
              <button onClick={() => setModalAtivacao(null)}
                style={{ background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}66`, padding: '11px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', marginLeft: 'auto' }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      );
    })()}
  </>);
}

// ─── Checklist animado de força de senha (barra segmentada + critérios) ─────
function SenhaChecklist({ senha }) {
  const s = senha || '';
  const crits = [
    { label: '8 caracteres', ok: s.length >= 8 },
    { label: 'Maiúscula', ok: /[A-Z]/.test(s) },
    { label: 'Minúscula', ok: /[a-z]/.test(s) },
    { label: 'Número', ok: /[0-9]/.test(s) },
    { label: 'Especial', ok: /[^A-Za-z0-9]/.test(s) },
  ];
  const score = crits.filter(c => c.ok).length;
  const nivel = score === 0 ? null
    : score <= 2 ? { label: 'Fraca', cor: '#E07A5F' }
    : score === 3 ? { label: 'Média', cor: '#D4AC0D' }
    : score === 4 ? { label: 'Boa', cor: '#AEB84B' }
    : { label: 'Forte', cor: '#7cb342' };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, display: 'flex', gap: 4 }}>
          {crits.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, background: HUB_PALETTE.areiaDim + '2e', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: nivel ? nivel.cor : 'transparent', transform: `scaleX(${i < score ? 1 : 0})`, transformOrigin: 'left', transition: `transform 420ms ${HUB_EASE} ${i * 50}ms, background 320ms` }} />
            </div>
          ))}
        </div>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: nivel ? nivel.cor : HUB_PALETTE.areiaDim, minWidth: 44, textAlign: 'right', transition: 'color 320ms' }}>
        {nivel ? nivel.label : '—'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
        {crits.map(({ label, ok }) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: ok ? '#7cb342' : HUB_PALETTE.areiaDim, transition: 'color 250ms' }}>
            <span style={{ width: 15, height: 15, borderRadius: '50%', border: `1px solid ${ok ? '#7cb342' : HUB_PALETTE.areiaDim + '66'}`, background: ok ? '#7cb342' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: `background 300ms ${HUB_EASE}, border-color 300ms ${HUB_EASE}`, animation: ok ? `hubPop 360ms ${HUB_EASE}` : 'none' }}>
              {ok && (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6.4l2.5 2.5 4.6-5.2" stroke={HUB_PALETTE.noite} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ strokeDasharray: 14, strokeDashoffset: 14, animation: `hubDraw 320ms ${HUB_EASE} 90ms forwards` }} />
                </svg>
              )}
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContaForm({ tipo, isMobile, cs, erro, saving, initial, initialEtiquetas, isEdit, ehEuMesmo, setores, etiquetas, onCancel, onSave, onFotoChange }) {
  const [d, setD] = useState(initial || (tipo === 'admin'
    ? { nome_completo: '', email: '', ramal: '', cargo: '', matricula: '', data_admissao: '', data_nascimento: '', vinculo: '', bilingue: false, idiomas: '', is_master: false, senha: '' }
    : { nome: '', email: '', setor: '', ramal: '', cargo: '', matricula: '', data_admissao: '', data_nascimento: '', vinculo: '', bilingue: false, idiomas: '', senha: '' }));
  const [showSenha, setShowSenha] = useState(false);
  const [etSel, setEtSel] = useState(new Set(initialEtiquetas || []));
  const [etBusca, setEtBusca] = useState('');
  const [erroLocal, setErroLocal] = useState('');
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const isAdmin = tipo === 'admin';

  // ── Avatar (foto) ── upload imediato, keyed pelo e-mail (independe do salvar).
  const fotoRef = useRef(null);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [fotoVer, setFotoVer] = useState(0);
  const emailFoto = (d.email || '').trim().toLowerCase();
  const emailFotoOk = /^[^@\s]+@granmarquise\.com\.br$/.test(emailFoto);
  const temAvatar = emailFotoOk && _avataresSet.has(emailFoto);
  async function onPickFoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!emailFotoOk) { setErroLocal('Preencha o e-mail antes de enviar a foto.'); return; }
    if (!/^image\//.test(file.type)) { setErroLocal('Selecione uma imagem.'); return; }
    setFotoBusy(true); setErroLocal('');
    try {
      const dataUrl = await _resizeImagem(file, 256, 0.85);
      const tk = localStorage.getItem('hub_sso_token') || '';
      const r = await fetch('/api/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ email: emailFoto, imagem: dataUrl }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { _avataresSet.add(emailFoto); _bumpAvatarVer(emailFoto); setFotoVer(v => v + 1); if (onFotoChange) onFotoChange(); }
      else setErroLocal(j.erro || 'Falha ao enviar a foto.');
    } catch { setErroLocal('Falha ao processar a imagem.'); }
    setFotoBusy(false);
  }
  async function removerFoto() {
    if (!emailFotoOk) return;
    setFotoBusy(true); setErroLocal('');
    try {
      const tk = localStorage.getItem('hub_sso_token') || '';
      const r = await fetch('/api/avatar?email=' + encodeURIComponent(emailFoto), { method: 'DELETE', headers: { Authorization: 'Bearer ' + tk } });
      if (r.ok) { _avataresSet.delete(emailFoto); _bumpAvatarVer(emailFoto); setFotoVer(v => v + 1); if (onFotoChange) onFotoChange(); }
    } catch {}
    setFotoBusy(false);
  }

  // Validacao de setor: precisa bater com a lista oficial. Permite preservar valor legado na edicao.
  // API retorna {id, nome}; mantemos fallback p/ s.name caso o contrato mude.
  const setorNome = s => (s && (s.nome ?? s.name)) || '';
  const setoresNames = (setores || []).map(setorNome);
  const setorAtualOriginal = (initial && initial.setor) || '';
  const setorLegado = !isAdmin && !!setorAtualOriginal && !setoresNames.includes(setorAtualOriginal);
  const semListaSetores = !isAdmin && setoresNames.length === 0;
  const SENHA_OK = !!(d.senha && d.senha.length >= 8 && /[A-Z]/.test(d.senha) && /[a-z]/.test(d.senha) && /[0-9]/.test(d.senha) && /[^A-Za-z0-9]/.test(d.senha));
  const senhaValida = !isAdmin || (isEdit ? (!d.senha || SENHA_OK) : SENHA_OK);

  // Combobox de setor: input filtravel + popup customizado (tema dark, restrito ao banco).
  const [setorOpen, setSetorOpen] = useState(false);
  const [setorHighlight, setSetorHighlight] = useState(0);
  const setorWrapRef = useRef(null);
  const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  useEffect(() => {
    if (!setorOpen) return;
    function onDocMouseDown(e) {
      if (setorWrapRef.current && !setorWrapRef.current.contains(e.target)) setSetorOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [setorOpen]);
  const setorOpcoes = (() => {
    const f = norm(d.setor || '');
    const out = [];
    if (setorLegado && (!f || norm(setorAtualOriginal).includes(f))) {
      out.push({ name: setorAtualOriginal, legado: true, key: 'legado' });
    }
    (setores || []).forEach(s => {
      const nm = setorNome(s);
      if (!f || norm(nm).includes(f)) out.push({ name: nm, legado: false, key: 's-' + s.id });
    });
    return out;
  })();
  function pickSetor(name) {
    set('setor', name);
    setErroLocal('');
    setSetorOpen(false);
    setSetorHighlight(0);
  }
  function onSetorKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!setorOpen) { setSetorOpen(true); return; }
      setSetorHighlight(h => Math.min(h + 1, Math.max(0, setorOpcoes.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSetorHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (setorOpen && setorOpcoes[setorHighlight]) {
        e.preventDefault();
        pickSetor(setorOpcoes[setorHighlight].name);
      }
    } else if (e.key === 'Escape') {
      if (setorOpen) { e.preventDefault(); setSetorOpen(false); }
    }
  }

  function handleSave() {
    if (!isAdmin) {
      const v = (d.setor || '').trim();
      if (!v) { setErroLocal('Setor é obrigatório.'); return; }
      if (!setoresNames.includes(v) && v !== setorAtualOriginal) {
        setErroLocal('Selecione um setor válido da lista.');
        return;
      }
    }
    setErroLocal('');
    onSave(d, isAdmin ? Array.from(etSel) : null);
  }

  function toggleEt(slug) {
    setEtSel(p => { const n = new Set(p); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  }
  const etFiltradas = (etiquetas || []).filter(e => !etBusca.trim() || (e.nome || '').toLowerCase().includes(etBusca.trim().toLowerCase()) || (e.slug || '').includes(etBusca.trim().toLowerCase()));

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 520, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 6 }}>
          {isAdmin ? 'Admin do TI' : 'Usuário do portal'}
        </div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, margin: '0 0 22px' }}>
          {isEdit ? 'Editar' : 'Novo'}
        </h3>

        {/* "honeypot" para o autofill do Chrome/Edge: ele preenche estes dois e ignora os reais.
            Ficam fora da tela (off-screen, nao display:none — display:none faz alguns browsers
            ignorarem o honeypot). Os usuarios nunca veem nem tabulam ate eles. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
          <input type="text" name="username" tabIndex={-1} autoComplete="username" />
          <input type="password" name="password" tabIndex={-1} autoComplete="current-password" />
        </div>

        <form autoComplete="off" onSubmit={e => e.preventDefault()}>

        {/* Foto (avatar) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <AvatarUsuario key={fotoVer} nome={isAdmin ? d.nome_completo : d.nome} email={emailFotoOk ? emailFoto : ''} size={58} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input ref={fotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFoto} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={fotoBusy}
                onClick={() => { if (!emailFotoOk) { setErroLocal('Preencha o e-mail antes de enviar a foto.'); return; } fotoRef.current && fotoRef.current.click(); }}
                style={cs.btnGhost}>
                {fotoBusy ? '...' : (temAvatar ? 'Trocar foto' : 'Enviar foto')}
              </button>
              {temAvatar && (
                <button type="button" onClick={removerFoto} disabled={fotoBusy} style={{ ...cs.btnGhost, color: '#E07A5F', borderColor: '#E07A5F55' }}>Remover</button>
              )}
            </div>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: HUB_PALETTE.areiaDim }}>Sem foto, mostra as iniciais. A imagem é recortada em quadrado.</span>
          </div>
        </div>

        <label style={cs.label}>Nome Completo</label>
        <input style={cs.input} value={isAdmin ? d.nome_completo : d.nome}
          autoComplete="off" name="conta-nome-randoma1b2" spellCheck={false}
          aria-label="Nome completo"
          onChange={e => set(isAdmin ? 'nome_completo' : 'nome', e.target.value)} />

        <label style={{ ...cs.label, marginTop: 14 }}>E-mail</label>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <input style={{ ...cs.input, flex: 1, borderRight: 'none' }} type="text"
            value={(d.email || '').replace(/@granmarquise\.com\.br$/, '')}
            autoComplete="off" name="conta-email-randomc3d4" spellCheck={false} inputMode="email"
            aria-label="E-mail (apenas o usuário, sem o domínio)"
            placeholder="usuario"
            onChange={e => set('email', e.target.value.replace(/@.*/, '').trim().toLowerCase() + '@granmarquise.com.br')} />
          <div style={{ background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, borderLeft: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '10px 12px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', userSelect: 'none' }}>
            @granmarquise.com.br
          </div>
        </div>

        {!isAdmin && (<>
          <label style={{ ...cs.label, marginTop: 14 }}>Setor</label>
          <div ref={setorWrapRef} style={{ position: 'relative' }}>
            <input style={cs.input} type="text" value={d.setor || ''}
              autoComplete="off" name="conta-setor-randome5f6" spellCheck={false}
              aria-label="Setor de trabalho"
              placeholder="Digite ou selecione"
              disabled={semListaSetores && !setorLegado}
              onFocus={() => setSetorOpen(true)}
              onClick={() => setSetorOpen(true)}
              onKeyDown={onSetorKey}
              onChange={e => { set('setor', e.target.value); setErroLocal(''); setSetorOpen(true); setSetorHighlight(0); }} />
            {setorOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}44`, maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
                {setorOpcoes.length === 0 ? (
                  <div style={{ padding: '8px 12px', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
                    Nenhum setor corresponde.
                  </div>
                ) : setorOpcoes.map((it, i) => (
                  <div key={it.key}
                    onMouseDown={e => { e.preventDefault(); pickSetor(it.name); }}
                    onMouseEnter={() => setSetorHighlight(i)}
                    style={{ padding: '8px 12px', cursor: 'pointer', background: i === setorHighlight ? HUB_PALETTE.champanhe + '22' : 'transparent', color: it.legado ? HUB_PALETTE.champanhe : HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
                    {it.name}{it.legado ? ' (atual — legado)' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          {semListaSetores && !setorLegado && (
            <div style={{ marginTop: 6, fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#E07A5F' }}>
              Lista de setores indisponível. Recarregue a página antes de salvar.
            </div>
          )}
          {setorLegado && (
            <div style={{ marginTop: 6, fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#E07A5F', border: '1px solid #E07A5F44', padding: '6px 10px' }}>
              ⚠ Setor desatualizado — selecione um da lista para manter consistência dos dados.
            </div>
          )}
        </>)}

        <label style={{ ...cs.label, marginTop: 14 }}>Ramal {!isAdmin && <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(4 dígitos)</span>}</label>
        <input style={cs.input} value={d.ramal}
          autoComplete="off" name="conta-ramal-randomg7h8" inputMode="numeric"
          aria-label={isAdmin ? 'Ramal' : 'Ramal (4 dígitos)'}
          onChange={e => set('ramal', e.target.value.replace(/\D/g, ''))} maxLength={isAdmin ? 20 : 4} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
          <div>
            <label style={cs.label}>Cargo <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <input style={{ ...cs.input, marginTop: 6 }} value={d.cargo || ''}
              autoComplete="off" name="conta-cargo-randomk1l2" spellCheck={false}
              aria-label="Cargo (opcional)"
              placeholder="Ex: Massoterapeuta"
              onChange={e => set('cargo', e.target.value)} />
          </div>
          <div>
            <label style={cs.label}>Matrícula <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <input style={{ ...cs.input, marginTop: 6 }} value={d.matricula || ''}
              autoComplete="off" name="conta-matricula-randomm3n4" spellCheck={false}
              aria-label="Matrícula (opcional)"
              placeholder="Ex: 00123"
              onChange={e => set('matricula', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
          <div>
            <label style={cs.label}>Admissão <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <input type="date" style={{ ...cs.input, marginTop: 6 }} value={d.data_admissao || ''}
              aria-label="Data de admissão"
              onChange={e => set('data_admissao', e.target.value)} />
          </div>
          <div>
            <label style={cs.label}>Nascimento <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <input type="date" style={{ ...cs.input, marginTop: 6 }} value={d.data_nascimento || ''}
              aria-label="Data de nascimento"
              onChange={e => set('data_nascimento', e.target.value)} />
          </div>
        </div>

        {d.setor && d.setor.toLowerCase().includes('spa') && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
          <div>
            <label style={cs.label}>Vínculo <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <select
              style={{
                ...cs.input,
                marginTop: 6,
                appearance: 'none',
                WebkitAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A7B6A' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 14px center',
                paddingRight: 36,
                cursor: 'pointer',
              }}
              value={d.vinculo || ''}
              onChange={e => set('vinculo', e.target.value)}
              aria-label="Vínculo (opcional)"
            >
              <option value="">—</option>
              <option value="Pleno">Pleno</option>
              <option value="Part Time">Part Time</option>
              <option value="Estagiário">Estagiário</option>
            </select>
          </div>
          <div>
            <label style={cs.label}>Idiomas <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(opcional)</span></label>
            <button
              type="button"
              onClick={() => { set('bilingue', !d.bilingue); if (d.bilingue) set('idiomas', ''); }}
              style={{
                marginTop: 6,
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 14px',
                background: d.bilingue ? HUB_PALETTE.dourado + '18' : HUB_PALETTE.areiaDim + '0a',
                border: `1px solid ${d.bilingue ? HUB_PALETTE.dourado + '88' : HUB_PALETTE.areiaDim + '33'}`,
                color: d.bilingue ? HUB_PALETTE.areia : HUB_PALETTE.areiaDim,
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                transition: 'border-color 180ms, background 180ms, color 180ms',
              }}
              aria-pressed={!!d.bilingue}
            >
              <span style={{
                width: 14, height: 14, flexShrink: 0,
                border: `1px solid ${d.bilingue ? HUB_PALETTE.dourado : HUB_PALETTE.areiaDim + '88'}`,
                background: d.bilingue ? HUB_PALETTE.dourado : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 180ms, border-color 180ms',
              }}>
                {d.bilingue && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3l2 2 4-4" stroke={HUB_PALETTE.noite} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              Bilíngue
            </button>
          </div>
        </div>}
        {d.setor && d.setor.toLowerCase().includes('spa') && d.bilingue && (() => {
          const IDIOMAS = ['Inglês', 'Espanhol', 'Francês', 'Italiano', 'Alemão', 'Mandarim'];
          const selecionados = new Set((d.idiomas || '').split(',').filter(Boolean));
          const toggle = lang => {
            const s = new Set(selecionados);
            s.has(lang) ? s.delete(lang) : s.add(lang);
            set('idiomas', [...s].join(','));
          };
          return (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {IDIOMAS.map(lang => {
                const on = selecionados.has(lang);
                return (
                  <button key={lang} type="button" onClick={() => toggle(lang)}
                    style={{
                      padding: '4px 11px',
                      background: on ? HUB_PALETTE.dourado + '22' : 'transparent',
                      border: `1px solid ${on ? HUB_PALETTE.dourado + 'cc' : HUB_PALETTE.areiaDim + '44'}`,
                      color: on ? HUB_PALETTE.areia : HUB_PALETTE.areiaDim,
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      cursor: 'pointer', borderRadius: 2,
                      transition: 'border-color 150ms, background 150ms, color 150ms',
                    }}>
                    {lang}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Senha: visível apenas para admins ou ao editar usuário — criação de usuário usa link de ativação */}
        {(isAdmin || isEdit) && (<>
          <label style={{ ...cs.label, marginTop: 14 }}>Senha {isEdit && <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(altere para definir uma nova)</span>}</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...cs.input, paddingRight: 56 }} type={showSenha ? 'text' : 'password'} value={d.senha}
              autoComplete="new-password" name="conta-senha-randomi9j0" spellCheck={false}
              aria-label="Senha"
              onChange={e => set('senha', e.target.value)}
              placeholder="Mín. 8 com maiúscula, minúscula, número e especial" />
            <button type="button" onClick={() => setShowSenha(v => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}>
              {showSenha ? 'ocultar' : 'ver'}
            </button>
          </div>
          <SenhaChecklist senha={d.senha} />
        </>)}
        {/* Aviso na criação de usuário: senha gerada via link de ativação */}
        {!isAdmin && !isEdit && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: HUB_PALETTE.champanhe + '12', border: `1px solid ${HUB_PALETTE.champanhe}33`, fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, lineHeight: 1.5 }}>
            Após criar, um link de ativação será gerado para o usuário definir a própria senha.
          </div>
        )}

        {isAdmin && (<>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, fontFamily: 'Inter, sans-serif', fontSize: 13, color: ehEuMesmo ? HUB_PALETTE.areiaDim : HUB_PALETTE.areia, cursor: ehEuMesmo ? 'not-allowed' : 'pointer' }}
            title={ehEuMesmo ? 'Você não pode alterar o seu próprio nível master.' : undefined}>
            <input type="checkbox" checked={!!d.is_master} disabled={ehEuMesmo} onChange={e => set('is_master', e.target.checked)} />
            Admin master (acesso total){ehEuMesmo ? ' — bloqueado para a própria conta' : ''}
          </label>

          {(etiquetas || []).length > 0 && (<>
            <label style={{ ...cs.label, marginTop: 18 }}>Etiquetas (áreas de atuação)</label>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input style={{ ...cs.input, paddingLeft: 34 }} value={etBusca} onChange={e => setEtBusca(e.target.value)} placeholder="Buscar etiqueta..." />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', border: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: 10 }}>
              {etFiltradas.map(e => {
                const on = etSel.has(e.slug);
                return (
                  <button key={e.slug} type="button" onClick={() => toggleEt(e.slug)}
                    style={{ background: on ? '#996442' : 'transparent', border: `1px solid ${on ? '#996442' : HUB_PALETTE.areiaDim + '55'}`, color: on ? '#ECE4D2' : HUB_PALETTE.areia, fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>
                    {e.nome || e.slug}
                  </button>
                );
              })}
              {etFiltradas.length === 0 && <span style={{ fontSize: 12, color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif' }}>Nenhuma etiqueta corresponde.</span>}
            </div>
          </>)}
        </>)}

        {(erroLocal || erro) && (
          <div style={{ marginTop: 16, padding: '10px 12px', border: '1px solid #E07A5F66', color: '#E07A5F', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            {erroLocal || erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={saving} style={cs.btnGhost}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || (semListaSetores && !setorLegado) || !senhaValida} style={cs.btnPrim}>
            {saving ? '...' : (isEdit ? 'Salvar' : 'Criar')}
          </button>
        </div>

        </form>
      </div>
    </div>
  );
}

// ─── Historico do usuario do portal (chamados + atividade) ──────────────────
function HistoricoUsuarioModal({ usuarioId, nome, isMobile, cs, onClose, tipo }) {
  const ehAdmin = tipo === 'admin';
  const [aba, setAba] = useState(ehAdmin ? 'atividade' : 'chamados');
  const [chamados, setChamados] = useState(null);
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    const lock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const token = localStorage.getItem('hub_sso_token');
    if (!ehAdmin) {
      fetch(`/api/admin/chamados-usuarios/${usuarioId}/chamados`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => setChamados(d.ok ? (d.chamados || []) : [])).catch(() => setChamados([]));
    } else {
      setChamados([]);
    }
    const rotaLogs = ehAdmin
      ? `/api/admin/chamados-admins/${usuarioId}/logs`
      : `/api/admin/chamados-usuarios/${usuarioId}/logs`;
    fetch(rotaLogs, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setLogs(d.ok ? (d.logs || []) : [])).catch(() => setLogs([]));
    return () => { document.body.style.overflow = lock; };
  }, [usuarioId, ehAdmin]);

  function fmtData(s) {
    if (!s) return '—';
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });
  }
  function localDateKey(s) {
    if (!s) return '';
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
  }
  function localDateHeader(s) {
    if (!s) return '';
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
    const ontem = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
    const key = d.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
    const longo = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Fortaleza' });
    if (key === hoje) return `Hoje · ${longo.split(',')[1]?.trim() || longo}`;
    if (key === ontem) return `Ontem · ${longo.split(',')[1]?.trim() || longo}`;
    return longo;
  }

  const NOMES_SISTEMA = {
    chamados: 'Chamados TI', ramais: 'Lista de Ramais',
    'pesquisa-satisfacao': 'Pesquisa de Satisfação', pesquisa: 'Pesquisa de Satisfação',
  };
  function labelEvento(ev, detalhes) {
    const MAP = {
      login_sucesso: 'Login realizado', login_falha: 'Tentativa de login (senha incorreta)',
      logout: 'Logout', reset_solicitado: 'Reset de senha solicitado',
      reset_email_enviado: 'E-mail de reset enviado', reset_concluido: 'Senha redefinida',
      reset_link_expirado: 'Link de reset expirado', reset_link_ja_usado: 'Link de reset já utilizado',
      login_hub: 'Entrou no Hub', logout_hub: 'Saiu do Hub',
      logout_chamados: 'Saiu do Chamados', logout_ramais: 'Saiu da Lista de Ramais',
      logout_pesquisa: 'Saiu da Pesquisa de Satisfação', 'logout_pesquisa-satisfacao': 'Saiu da Pesquisa de Satisfação',
    };
    if (MAP[ev]) return MAP[ev];
    if (ev && ev.startsWith('abrir_')) {
      const sistemaId = ev.slice(6);
      const nome = (detalhes && typeof detalhes === 'string' ? detalhes : '') || NOMES_SISTEMA[sistemaId] || (sistemaId.charAt(0).toUpperCase() + sistemaId.slice(1).replace(/[-_]/g, ' '));
      return `Abriu sistema: ${nome}`;
    }
    if (ev && ev.startsWith('logout_')) {
      const sistemaId = ev.slice(7);
      return `Saiu de ${NOMES_SISTEMA[sistemaId] || sistemaId}`;
    }
    return ev || '—';
  }
  function tipoEvento(ev) {
    if (!ev) return 'neutro';
    if (ev === 'login_hub' || ev === 'login_sucesso') return 'login';
    if (ev === 'logout_hub' || ev === 'logout' || ev.startsWith('logout_')) return 'logout';
    if (ev === 'login_falha') return 'alerta';
    if (ev.startsWith('abrir_')) return 'acesso';
    if (ev.startsWith('reset_')) return 'reset';
    return 'neutro';
  }
  const COR_TIPO = { login: '#7cb342', logout: '#9E6B43', alerta: '#E07A5F', acesso: HUB_PALETTE.champanhe, reset: '#5B8FA8', neutro: HUB_PALETTE.areiaDim };

  const logsComSeparadores = React.useMemo(() => {
    if (!logs) return [];
    const rows = [];
    let lastKey = null;
    for (const l of logs) {
      const key = localDateKey(l.criado_em);
      if (key !== lastKey) { rows.push({ tipo: 'header', key, label: localDateHeader(l.criado_em) }); lastKey = key; }
      rows.push({ tipo: 'item', l });
    }
    return rows;
  }, [logs]);

  const contaLogs = logs ? logs.length : null;
  const truncado = contaLogs >= 200;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, width: '100%', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            {/* Modal so recebe id/nome — sem email, avatar cai nas iniciais. */}
            <AvatarUsuario size={40} nome={nome} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe }}>Histórico</div>
              <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 22, color: HUB_PALETTE.marfim, marginTop: 4 }}>{nome}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ ...cs.btnGhost, fontFamily: 'Inter, sans-serif', letterSpacing: 'normal', textTransform: 'none' }}>Fechar</button>
        </div>
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: '0 24px' }}>
          {[{ id: 'chamados', label: 'Chamados', count: chamados?.length, plus: false }, { id: 'atividade', label: 'Atividade de acesso', count: contaLogs, plus: truncado }].map(t => (
            <button key={t.id} onClick={() => setAba(t.id)}
              style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${aba === t.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: aba === t.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '12px 18px 10px', cursor: 'pointer' }}>
              {t.label}{t.count != null ? <span style={{ marginLeft: 6, fontSize: 9 }}>{t.count}{t.plus ? '+' : ''}</span> : null}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 20px' : '20px 24px' }}>
          {aba === 'chamados' && (chamados === null ? <Carregando /> :
            chamados.length === 0 ? <Vazio msg="Sem chamados deste usuário." /> :
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {chamados.map(c => {
                const statusAberto = !['concluido', 'encerrado'].includes(c.status);
                const statusLabel = statusAberto ? 'Em Atendimento' : (c.status === 'concluido' ? 'Concluído' : 'Encerrado');
                const statusCor = statusAberto ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim;
                return (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <a href={`https://sistema-chamados-granmarquise.fly.dev/admin-painel.html?chamado=${c.id}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.champanhe, textDecoration: 'none' }}>#{c.id}</a>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim, fontWeight: 500 }}>{c.descricao ? c.descricao.slice(0, 80) : 'Sem descrição'}{c.descricao && c.descricao.length > 80 ? '…' : ''}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: statusCor, border: `1px solid ${statusCor}44`, padding: '2px 8px' }}>{statusLabel}</span>
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, marginTop: 4 }}>
                      Criado em {fmtData(c.criado_em)}{c.categoria ? ` · ${c.categoria}` : ''}
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, marginTop: 2 }}>
                      Responsável: {c.admin_nome || '—'}{c.concluido_em ? ` · Concluído em ${fmtData(c.concluido_em)}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {aba === 'atividade' && (logs === null ? <Carregando /> :
            logs.length === 0 ? <Vazio msg="Sem atividade registrada." /> :
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {logsComSeparadores.map((row, i) => {
                if (row.tipo === 'header') return (
                  <div key={`h-${row.key}`} style={{ padding: '16px 0 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}18` }}>
                    {row.label}
                  </div>
                );
                const l = row.l;
                const cor = COR_TIPO[tipoEvento(l.evento)];
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}18` }}>
                    <div style={{ width: 3, minWidth: 3, alignSelf: 'stretch', background: cor, borderRadius: 2, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim, fontWeight: 500 }}>{labelEvento(l.evento, l.detalhes)}</div>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(32, 44, 40, 0.70)', marginTop: 2 }}>
                        {fmtData(l.criado_em)}{l.ip ? <span style={{ marginLeft: 10 }}>{l.ip}</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {truncado && (
                <div style={{ padding: '14px 0 4px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, textAlign: 'center' }}>
                  Exibindo os 200 registros mais recentes
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Carregando() { return <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>Carregando…</div>; }
function Vazio({ msg }) { return <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 15, color: HUB_PALETTE.areiaDim }}>{msg}</div>; }

// ─── Header ───────────────────────────────────────────────────────────────────

// ─── Meu perfil ──────────────────────────────────────────────────────────────
// Modal do proprio usuario logado: foto (upload/remocao via /api/me/avatar,
// e-mail vem do token no backend) + status do ciclo de vida (/api/me).
function MeuPerfilModal({ userName, userEmail, userTipo, onClose }) {
  const email = String(userEmail || '').toLowerCase();
  const [me, setMe] = useState(null);
  const [fotoVer, setFotoVer] = useState(0);
  const [enviou, setEnviou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    const lock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = lock; };
  }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    let vivo = true;
    hubFetch('/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivo && d && d.ok) setMe(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function onPickFoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErro('Selecione uma imagem.'); return; }
    setBusy(true); setErro('');
    try {
      const dataUrl = await _resizeImagem(file, 256, 0.85);
      const r = await hubFetch('/api/me/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem: dataUrl }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { if (_avataresSet) _avataresSet.add(email); _bumpAvatarVer(email); setFotoVer(v => v + 1); setEnviou(true); }
      else setErro(j.erro || 'Falha ao enviar a foto.');
    } catch { setErro('Falha ao processar a imagem.'); }
    setBusy(false);
  }
  async function removerFoto() {
    setBusy(true); setErro('');
    try {
      const r = await hubFetch('/api/me/avatar', { method: 'DELETE' });
      if (r.ok) { if (_avataresSet) _avataresSet.delete(email); _bumpAvatarVer(email); setFotoVer(v => v + 1); setEnviou(false); }
      else setErro('Falha ao remover a foto.');
    } catch { setErro('Falha ao remover a foto.'); }
    setBusy(false);
  }

  const temAvatar = _temFoto(email) || enviou;
  const nomeExib = (me && me.nome) || userName || '';
  const emailExib = (me && me.email) || userEmail || '';
  const btnGhost = { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '10px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' };

  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', padding: '32px 28px 24px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 22 }}>Perfil — Hub Gran Marquise</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <AvatarUsuario key={fotoVer} nome={nomeExib} email={email} size={96} />
        </div>
        <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, lineHeight: 1.2 }}>{nomeExib || '—'}</div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.areiaDim, marginTop: 6 }}>{emailExib || '—'}</div>
        {me && me.hub_status ? (
          <div style={{ marginTop: 12 }}><HubStatusBadge status={me.hub_status} /></div>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFoto} />
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 22, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={{ ...btnGhost, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Enviando…' : (temAvatar ? 'Trocar foto' : 'Enviar foto')}
          </button>
          {temAvatar && (
            <button type="button" disabled={busy} onClick={removerFoto} style={{ ...btnGhost, color: '#E07A5F', borderColor: '#E07A5F55', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? '…' : 'Remover foto'}
            </button>
          )}
        </div>
        {erro && <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E07A5F', marginTop: 12 }}>{erro}</div>}
        <div style={{ borderTop: `1px solid ${HUB_PALETTE.areiaDim}22`, marginTop: 24, paddingTop: 16 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Fechar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function HubHeader({ theme, onToggleTheme, isMobile, userName, userEmail, userTipo, onLogout, onOpenAdmin, updatesCount, onOpenFeed }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // Padrao Gran Marquise — todos os sistemas do hub: DD/MM/AAAA · HH:MM (Fortaleza)
  const dataFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const horaFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' }).format(now);
  const dataHora = `${dataFmt} · ${horaFmt}`;
  const primeiroNome = userName ? userName.split(' ')[0] : '';
  const [perfilOpen, setPerfilOpen] = useState(false);

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(10px)', background: HUB_PALETTE.headerBg, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '14px 18px' : '20px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none' }}>
          <img
            src="https://letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png"
            alt="Gran Marquise"
            style={{ height: 32, width: 'auto', filter: theme === 'dark' ? 'brightness(0) invert(1)' : 'none', opacity: 0.9 }}
          />
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isMobile && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.1em', color: HUB_PALETTE.marfim, fontVariantNumeric: 'tabular-nums' }} title="Horário de Fortaleza">{dataHora}</span>}
          {/* Visivel tambem no mobile — so o texto some. */}
          <button type="button" onClick={() => setPerfilOpen(true)} title="Meu perfil"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: 0 }}>
            <AvatarUsuario size={32} email={userEmail} nome={userName} />
            {!isMobile && primeiroNome && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim }}>{primeiroNome}</span>}
          </button>
          {perfilOpen && <MeuPerfilModal userName={userName} userEmail={userEmail} userTipo={userTipo} onClose={() => setPerfilOpen(false)} />}

          {/* Engrenagem — só para admins */}
          {userTipo === 'admin' && (
            <button type="button" onClick={onOpenAdmin} title="Administração"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, borderRadius: '50%', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, transition: `color 300ms, border-color 300ms` }}
              onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.champanhe; e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '55'; }}
              onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}

          {/* Sino — atualizações dos sistemas */}
          <button type="button" onClick={onOpenFeed} title="Ver atualizações"
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, borderRadius: '50%', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, transition: `color 300ms, border-color 300ms` }}
            onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.champanhe; e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '55'; }}
            onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ animation: updatesCount > 0 ? 'hubBellRing 3s ease-in-out 0.8s 2 both' : 'none' }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {updatesCount > 0 && (
              <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, padding: '0 3px', borderRadius: 8, background: HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 8, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${HUB_PALETTE.noite}`, animation: 'hubUpdatePop 600ms cubic-bezier(0.16,1,0.3,1) 1s both', lineHeight: 1 }}>
                {updatesCount > 9 ? '9+' : updatesCount}
              </span>
            )}
          </button>

          <button type="button" onClick={onToggleTheme} aria-label="Alternar tema"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, borderRadius: '50%', color: HUB_PALETTE.champanhe, cursor: 'pointer', padding: 0 }}>
            {theme === 'dark'
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a6.5 6.5 0 1 0 10.5 10.5z"/></svg>
            }
          </button>

          <button type="button" onClick={onLogout} title="Sair"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, borderRadius: '50%', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, transition: `color 300ms, border-color 300ms` }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E07A5F'; e.currentTarget.style.borderColor = '#E07A5F44'; }}
            onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HubHero({ revealed, easterActive, isMobile, userName, sistemasVisiveis }) {
  const horaFortaleza = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', hour12: false }).format(new Date()), 10);
  const primeiroNome = userName ? userName.split(' ')[0] : 'equipe Gran Marquise';
  const periodo = horaFortaleza < 5 ? 'Boa madrugada' : horaFortaleza < 12 ? 'Bom dia' : horaFortaleza < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <section style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '20px 18px 12px' : '28px 48px 12px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: isMobile ? 16 : 40, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(12px)', transition: `all 900ms ${HUB_EASE}`, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 20, height: 1, background: HUB_PALETTE.champanhe, display: 'inline-block' }} />
            {periodo}, {primeiroNome}
          </div>
          <h1 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: isMobile ? 'clamp(26px, 7vw, 48px)' : 'clamp(30px, 3.6vw, 52px)', lineHeight: 0.98, letterSpacing: '-0.025em', color: HUB_PALETTE.marfim, margin: 0, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(24px)', transition: `all 1100ms ${HUB_EASE} 120ms` }}>
            <span style={{ display: 'block', color: HUB_PALETTE.areia }}>Hub</span>
            <span style={{ display: 'block', fontStyle: 'italic', fontWeight: 300, color: HUB_PALETTE.marfim }}>Gran Marquise.</span>
          </h1>
          <p style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: isMobile ? 13 : 15, lineHeight: 1.4, color: HUB_PALETTE.areia, maxWidth: 400, margin: '12px 0 0', letterSpacing: '-0.005em', opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(16px)', transition: `all 1100ms ${HUB_EASE} 320ms` }}>
            Bem-vindo. Aqui ficam os sistemas que a equipe do hotel já pode usar no dia a dia.
          </p>
        </div>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 24, borderLeft: `1px solid ${HUB_PALETTE.champanhe}55`, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(16px)', transition: `all 1100ms ${HUB_EASE} 420ms` }}>
            <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 40, lineHeight: 1, color: HUB_PALETTE.champanhe, fontVariantNumeric: 'tabular-nums' }}>{String(sistemasVisiveis.length).padStart(2, '0')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, animation: `hubPulse 2200ms ${HUB_EASE} infinite` }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow }}>Em operação</span>
              </div>
              <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 13, lineHeight: 1.3, color: HUB_PALETTE.areia, letterSpacing: '-0.005em', maxWidth: 180 }}>Disponível para toda a equipe.</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', right: 48, top: 88, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 12, color: HUB_PALETTE.champanhe, letterSpacing: '0.04em', opacity: easterActive ? 0.6 : 0, transform: easterActive ? 'translateY(0)' : 'translateY(-6px)', transition: `all 800ms ${HUB_EASE}`, pointerEvents: 'none', display: isMobile ? 'none' : 'block' }}>
        em homenagem ao painel de 1992
      </div>
    </section>
  );
}

// ─── Updates ──────────────────────────────────────────────────────────────────

const _INI_NOW = Date.now();
const INITIAL_UPDATES = [
  {
    id: 3,
    sistemaId: 'hub',
    sistemaNome: 'Hub',
    tipo: 'feat',
    titulo: 'Badge de atualizações ao vivo',
    descricao: 'Painel de novas atualizações com feed em tempo real para acompanhar mudanças nos sistemas.',
    ts: new Date(_INI_NOW - 2 * 3600_000).toISOString(),
  },
  {
    id: 2,
    sistemaId: 'chamados',
    sistemaNome: 'Helpdesk',
    tipo: 'fix',
    titulo: 'Spinner travado no Estoque e Inventário',
    descricao: 'Correção de crash silencioso no init das páginas de Estoque e Inventário ao logar com conta master.',
    ts: new Date(_INI_NOW - 4 * 3600_000).toISOString(),
  },
  {
    id: 1,
    sistemaId: 'chamados',
    sistemaNome: 'Helpdesk',
    tipo: 'fix',
    titulo: 'Botões de ação paravam de funcionar',
    descricao: 'Correção de bloqueio CSP que impedia eventos inline (onclick, onchange) em todo o painel admin.',
    ts: new Date(_INI_NOW - 5 * 3600_000).toISOString(),
  },
];

const UPDATE_TIPO = {
  feat:     { label: 'novidade', cor: '#3E8497', glyph: '+' },
  fix:      { label: 'correção', cor: '#C8B89A', glyph: '◆' },
  melhoria: { label: 'melhoria', cor: '#996442', glyph: '↑' },
  hotfix:   { label: 'urgente',  cor: '#9C5843', glyph: '!' },
};

function fmtRelativo(isoStr) {
  try {
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return 'agora mesmo';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
    if (diff < 172800) return 'ontem';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit' }).format(new Date(isoStr));
  } catch { return ''; }
}

function fmtData(isoStr) {
  try {
    const d = new Date(isoStr);
    const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' }).format(d);
    return `${data} · ${hora}`;
  } catch { return ''; }
}

function UpdateBadge({ count }) {
  if (!count) return null;
  return (
    <div style={{
      position: 'absolute', top: 14, right: 14, zIndex: 5,
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
      color: HUB_PALETTE.champanhe,
      padding: '3px 9px 3px 7px',
      border: `1px solid ${HUB_PALETTE.champanhe}45`,
      background: `${HUB_PALETTE.champanhe}12`,
      animation: 'hubUpdatePop 700ms cubic-bezier(0.16,1,0.3,1) both',
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: HUB_PALETTE.champanhe, flexShrink: 0 }} />
      {count === 1 ? '1 novo' : `${count} novos`}
    </div>
  );
}

function NewUpdateModal({ hubSystems, onSave, onClose }) {
  const sistemasNoAr = hubSystems.filter(s => s.status === 'no-ar');
  const [sistemaId, setSistemaId] = useState('hub');
  const [tipo, setTipo] = useState('feat');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErro, setSaveErro] = useState('');

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 320);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!descricao.trim() || saving) return;
    setSaving(true);
    setSaveErro('');
    const sistema = sistemasNoAr.find(s => s.id === sistemaId);
    try {
      await onSave({
        sistemaId,
        sistemaNome: sistema ? sistema.nome : 'Hub',
        tipo,
        titulo: titulo.trim() || undefined,
        descricao: descricao.trim(),
      });
      handleClose();
    } catch (err) {
      setSaveErro(err.message || 'Erro ao publicar');
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', background: `${HUB_PALETTE.noite}aa`, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '9px 12px', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: visible ? 'translate(-50%,-50%)' : 'translate(-50%,-46%)', opacity: visible ? 1 : 0, transition: `transform 380ms cubic-bezier(0.16,1,0.3,1), opacity 280ms ease`, zIndex: 300, width: '100%', maxWidth: 480, background: HUB_PALETTE.noiteAlt, boxShadow: '0 32px 80px -20px rgba(0,0,0,0.7)', border: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        <div style={{ padding: '24px 28px 20px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}1a`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6 }}>Admin · Changelog</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 20, letterSpacing: '-0.015em', color: HUB_PALETTE.marfim }}>Nova Atualização</div>
          </div>
          <button type="button" onClick={handleClose} style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '66'; e.currentTarget.style.color = HUB_PALETTE.champanhe; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '33'; e.currentTarget.style.color = HUB_PALETTE.areiaDim; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '22px 28px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Sistema</label>
              <select value={sistemaId} onChange={e => setSistemaId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="hub">Hub (geral)</option>
                {sistemasNoAr.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="feat">+ Novidade</option>
                <option value="fix">◆ Correção</option>
                <option value="melhoria">↑ Melhoria</option>
                <option value="hotfix">! Urgente</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>
              Título <span style={{ opacity: 0.5, textTransform: 'none', fontSize: 9 }}>(opcional)</span>
            </label>
            <input type="text" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Resumo em uma linha..." style={inputStyle} maxLength={80} />
          </div>
          <div>
            <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>
              Descrição <span style={{ color: HUB_PALETTE.champanhe }}>*</span>
            </label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} required placeholder="O que mudou? Descreva a atualização para os usuários..." rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 76 }} maxLength={300} />
          </div>
          {saveErro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e07070', textAlign: 'right', marginTop: -8 }}>{saveErro}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 2 }}>
            <button type="button" onClick={handleClose} disabled={saving} style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancelar</button>
            <button type="submit" disabled={!descricao.trim() || saving} style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.noite, background: descricao.trim() && !saving ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, border: 'none', padding: '8px 24px', cursor: descricao.trim() && !saving ? 'pointer' : 'not-allowed', transition: 'background 250ms ease' }}>{saving ? 'Publicando…' : 'Publicar'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function EditUpdateModal({ update, hubSystems, onSave, onClose }) {
  const sistemasNoAr = hubSystems.filter(s => s.status === 'no-ar');
  const [sistemaId, setSistemaId] = useState(update.sistemaId || 'hub');
  const [tipo, setTipo] = useState(update.tipo || 'feat');
  const [titulo, setTitulo] = useState(update.titulo || '');
  const [descricao, setDescricao] = useState(update.descricao || '');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErro, setSaveErro] = useState('');

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 320);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!descricao.trim() || saving) return;
    setSaving(true);
    setSaveErro('');
    const sistema = sistemasNoAr.find(s => s.id === sistemaId);
    try {
      await onSave(update.id, { sistemaId, sistemaNome: sistema ? sistema.nome : 'Hub', tipo, titulo: titulo.trim() || undefined, descricao: descricao.trim() });
      handleClose();
    } catch (err) {
      setSaveErro(err.message || 'Erro ao salvar');
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', background: `${HUB_PALETTE.noite}cc`, border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '9px 12px', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 399, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: visible ? 'translate(-50%,-50%)' : 'translate(-50%,-46%)', opacity: visible ? 1 : 0, transition: `transform 380ms cubic-bezier(0.16,1,0.3,1), opacity 280ms ease`, zIndex: 400, width: '100%', maxWidth: 480, background: HUB_PALETTE.noiteAlt, boxShadow: '0 32px 80px -20px rgba(0,0,0,0.7)', border: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        <div style={{ padding: '22px 26px 18px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}1a`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 5 }}>Admin · Editar</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 19, letterSpacing: '-0.015em', color: HUB_PALETTE.marfim }}>Editar Atualização</div>
          </div>
          <button type="button" onClick={handleClose} style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '66'; e.currentTarget.style.color = HUB_PALETTE.champanhe; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '33'; e.currentTarget.style.color = HUB_PALETTE.areiaDim; }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 26px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Sistema</label>
              <select value={sistemaId} onChange={e => setSistemaId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="hub">Hub (geral)</option>
                {sistemasNoAr.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="feat">+ Novidade</option>
                <option value="fix">◆ Correção</option>
                <option value="melhoria">↑ Melhoria</option>
                <option value="hotfix">! Urgente</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Título <span style={{ opacity: 0.5, textTransform: 'none', fontSize: 9 }}>(opcional)</span></label>
            <input type="text" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Resumo em uma linha..." style={inputStyle} maxLength={80} />
          </div>
          <div>
            <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, display: 'block', marginBottom: 7 }}>Descrição <span style={{ color: HUB_PALETTE.champanhe }}>*</span></label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} required rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 76 }} maxLength={300} />
          </div>
          {saveErro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e07070', textAlign: 'right' }}>{saveErro}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={handleClose} disabled={saving} style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, padding: '8px 18px', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancelar</button>
            <button type="submit" disabled={!descricao.trim() || saving} style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.noite, background: descricao.trim() && !saving ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, border: 'none', padding: '8px 22px', cursor: descricao.trim() && !saving ? 'pointer' : 'not-allowed', transition: 'background 200ms' }}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function UpdatesFeed({ updates, onClose, userTipo, onOpenNewUpdate, isMobile, onUpdateEdited, onUpdateDeleted, seenAt }) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [hubSysLocal, setHubSysLocal] = useState([]);
  const [dateFilter, setDateFilter] = useState('all');
  const [, _tick] = useState(0);

  const filteredUpdates = React.useMemo(() => {
    if (dateFilter === 'all') return updates;
    const now = new Date();
    return updates.filter(u => {
      const ts = new Date(u.ts);
      if (dateFilter === 'today') {
        return ts.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) === now.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
      }
      if (dateFilter === 'week') return ts >= new Date(now - 7 * 86400000);
      if (dateFilter === 'month') return ts >= new Date(now - 30 * 86400000);
      return true;
    });
  }, [updates, dateFilter]);
  useEffect(() => {
    const iv = setInterval(() => _tick(t => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    fetch('/api/sistemas').then(r => r.json()).then(d => { if (d.ok) setHubSysLocal(d.sistemas); }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      const token = localStorage.getItem('hub_sso_token');
      const r = await fetch(`/api/admin/updates/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro || 'Erro');
      onUpdateDeleted(id);
    } catch (err) {
      alert(err.message || 'Erro ao excluir');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleEdit(id, body) {
    const token = localStorage.getItem('hub_sso_token');
    const r = await fetch(`/api/admin/updates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.erro || 'Erro ao salvar');
    onUpdateEdited(d.update);
  }

  const panelW = isMobile ? '100vw' : 'clamp(360px, 46vw, 660px)';

  return (
    <>
      {editing && (
        <EditUpdateModal
          update={editing}
          hubSystems={hubSysLocal}
          onSave={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Backdrop — escurece a esquerda enquanto o drawer cobre a direita */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(4,5,8,0.62)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        zIndex: 199,
        opacity: visible ? 1 : 0,
        transition: 'opacity 320ms ease',
      }} />

      {/* Drawer — desliza da direita, altura total */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: panelW,
        background: HUB_PALETTE.noiteAlt,
        zIndex: 200,
        display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 420ms cubic-bezier(0.16,1,0.3,1)',
        boxShadow: '-24px 0 80px -12px rgba(0,0,0,0.85), -1px 0 0 0 rgba(255,255,255,0.04)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: isMobile ? '20px 22px 16px' : '28px 32px 22px',
          borderBottom: `1px solid ${HUB_PALETTE.areiaDim}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.36em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 }}>
              Sistema · Changelog
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'normal', fontWeight: 300, fontSize: isMobile ? 22 : 26, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, lineHeight: 1 }}>
                Atualizações
              </span>
              {(() => { const n = seenAt ? updates.filter(u => new Date(u.ts) > new Date(seenAt)).length : 0; return n > 0 ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.noite, background: HUB_PALETTE.champanhe, padding: '2px 8px', fontWeight: 700, lineHeight: 1 }}>{n}</span> : null; })()}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {userTipo === 'admin' && (
              <button type="button" onClick={onOpenNewUpdate} title="Publicar nova atualização"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${HUB_PALETTE.champanhe}12`, border: `1px solid ${HUB_PALETTE.champanhe}48`, padding: '0 16px', height: 34, color: HUB_PALETTE.champanhe, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', whiteSpace: 'nowrap', transition: 'background 200ms, border-color 200ms' }}
                onMouseEnter={e => { e.currentTarget.style.background = HUB_PALETTE.champanhe + '24'; e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + 'aa'; }}
                onMouseLeave={e => { e.currentTarget.style.background = HUB_PALETTE.champanhe + '12'; e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '48'; }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Nova
              </button>
            )}
            <button type="button" onClick={handleClose} title="Fechar"
              style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}28`, borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'all 200ms' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '80'; e.currentTarget.style.color = HUB_PALETTE.champanhe; e.currentTarget.style.background = HUB_PALETTE.champanhe + '10'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '28'; e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.background = 'transparent'; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Linha dourada decorativa abaixo do header */}
        <div style={{ height: 1, background: `linear-gradient(90deg, ${HUB_PALETTE.champanhe}60 0%, ${HUB_PALETTE.champanhe}00 100%)`, flexShrink: 0 }} />

        {/* ── Filtro de data ── */}
        <div style={{ padding: isMobile ? '10px 22px 8px' : '12px 32px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}0e` }}>
          {[
            { key: 'all',   label: 'Todos'   },
            { key: 'today', label: 'Hoje'    },
            { key: 'week',  label: '7 dias'  },
            { key: 'month', label: '30 dias' },
          ].map(opt => {
            const active = dateFilter === opt.key;
            return (
              <button key={opt.key} type="button" onClick={() => setDateFilter(opt.key)}
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontWeight: active ? 500 : 400,
                  fontSize: 13,
                  letterSpacing: 0,
                  padding: '5px 14px',
                  background: active ? `${HUB_PALETTE.champanhe}18` : 'transparent',
                  border: `1px solid ${active ? HUB_PALETTE.champanhe + '60' : HUB_PALETTE.areiaDim + '28'}`,
                  color: active ? HUB_PALETTE.champanhe : HUB_PALETTE.areia,
                  cursor: 'pointer',
                  transition: 'all 160ms ease',
                  whiteSpace: 'nowrap',
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* ── Lista de cards ── */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredUpdates.length === 0 ? (
            <div style={{ padding: '72px 32px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 28, color: HUB_PALETTE.areiaDim, opacity: 0.2, marginBottom: 14 }}>◇</div>
              <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 14, color: HUB_PALETTE.areiaDim }}>{dateFilter === 'all' ? 'Nenhuma atualização recente.' : 'Nenhuma atualização neste período.'}</div>
            </div>
          ) : filteredUpdates.map((u, i) => {
            const tipo = UPDATE_TIPO[u.tipo] || UPDATE_TIPO.fix;
            const isHovered = hoveredId === u.id;
            const isDeleting = deletingId === u.id;
            return (
              <div key={u.id}
                onMouseEnter={() => setHoveredId(u.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  borderBottom: `1px solid ${HUB_PALETTE.areiaDim}10`,
                  opacity: isDeleting ? 0.35 : 1,
                  animation: `hubSlideDown 400ms cubic-bezier(0.16,1,0.3,1) ${i * 50}ms both`,
                  background: isHovered ? `${HUB_PALETTE.champanhe}05` : 'transparent',
                  transition: 'background 200ms ease',
                  padding: isMobile ? '20px 22px 18px' : '24px 32px 22px',
                }}>

                {/* Linha de metadados + ações */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.26em',
                      textTransform: 'uppercase', fontWeight: 700,
                      color: HUB_PALETTE.champanhe,
                      padding: '2px 8px',
                      border: `1px solid ${HUB_PALETTE.champanhe}40`,
                      background: `${HUB_PALETTE.champanhe}0d`,
                      flexShrink: 0,
                    }}>{tipo.label}</span>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 8, letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: HUB_PALETTE.areiaDim,
                      padding: '2px 7px',
                      border: `1px solid ${HUB_PALETTE.areiaDim}18`,
                      flexShrink: 0,
                    }}>{u.sistemaNome}</span>
                    {u.editedAt && (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 7, letterSpacing: '0.12em', color: HUB_PALETTE.areiaDim, opacity: 0.45, flexShrink: 0 }}>editado</span>
                    )}
                  </div>

                  {userTipo === 'admin' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: isHovered ? 1 : 0, transform: isHovered ? 'translateX(0)' : 'translateX(6px)', transition: 'opacity 180ms ease, transform 180ms ease', flexShrink: 0 }}>
                      <button type="button" onClick={() => setEditing(u)} title="Editar"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}25`, borderRadius: '50%', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, transition: 'all 180ms' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = HUB_PALETTE.champanhe + '70'; e.currentTarget.style.color = HUB_PALETTE.champanhe; e.currentTarget.style.background = HUB_PALETTE.champanhe + '10'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '25'; e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.background = 'transparent'; }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button type="button" onClick={() => handleDelete(u.id)} disabled={isDeleting} title="Excluir"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}25`, borderRadius: '50%', color: HUB_PALETTE.areiaDim, cursor: isDeleting ? 'not-allowed' : 'pointer', padding: 0, transition: 'all 180ms' }}
                        onMouseEnter={e => { if (!isDeleting) { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '55'; e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.background = HUB_PALETTE.areiaDim + '10'; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '25'; e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.background = 'transparent'; }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Título */}
                {u.titulo && (
                  <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: isMobile ? 15 : 17, color: HUB_PALETTE.marfim, lineHeight: 1.38, marginBottom: 9, letterSpacing: '-0.01em' }}>
                    {u.titulo}
                  </div>
                )}

                {/* Descrição */}
                {u.descricao && (
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.68, color: HUB_PALETTE.areia }}>
                    {u.descricao}
                  </div>
                )}

                {/* Timestamp */}
                <div style={{ marginTop: 14 }}>
                  <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: 13, color: HUB_PALETTE.areia, letterSpacing: 0 }}>{fmtData(u.ts)} · {fmtRelativo(u.ts)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, label }) {
  const fallback = { 'no-ar': 'Disponível', 'construcao': 'Em construção', 'beta': 'Beta', 'concept': 'Conceito', 'inativo': 'Inativo' };
  const displayLabel = label ?? fallback[status] ?? status;
  if (status === 'no-ar') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, animation: `hubPulse 2200ms ${HUB_EASE} infinite` }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow }}>{displayLabel}</span>
      </span>
    );
  }
  const color = status === 'construcao' ? HUB_PALETTE.champanhe : status === 'beta' ? HUB_PALETTE.areia : HUB_PALETTE.areiaDim;
  const glyph = status === 'construcao' ? '○' : status === 'beta' ? '◐' : '◇';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, fontSize: 11 }}>{glyph}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color }}>{displayLabel}</span>
    </span>
  );
}

// ─── System Preview ───────────────────────────────────────────────────────────

function SystemPreview({ kind }) {
  if (kind === 'tickets') {
    return (
      <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
        {[0,1,2,3].map((i) => (
          <g key={i} transform={`translate(16 ${16 + i * 26})`}>
            <rect width="208" height="20" rx="2" fill="none" stroke={HUB_PALETTE.areiaDim} strokeOpacity="0.25" />
            <circle cx="12" cy="10" r="3" fill={i === 0 ? HUB_PALETTE.jangadaGlow : HUB_PALETTE.areiaDim} fillOpacity={i === 0 ? 1 : 0.4} />
            <rect x="24" y="6" width={120 - i * 18} height="3" fill={HUB_PALETTE.areia} fillOpacity="0.55" />
            <rect x="24" y="13" width={60 - i * 8} height="2" fill={HUB_PALETTE.areiaDim} fillOpacity="0.4" />
            <rect x="180" y="6" width="20" height="8" rx="1" fill={HUB_PALETTE.champanhe} fillOpacity={i === 0 ? 0.6 : 0.15} />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === 'directory') {
    return (
      <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
        {[0,1,2,3,4].map((i) => (
          <g key={i} transform={`translate(16 ${14 + i * 23})`}>
            <circle cx="10" cy="10" r="7" fill={HUB_PALETTE.champanhe} fillOpacity="0.15" stroke={HUB_PALETTE.areiaDim} strokeOpacity="0.3" />
            <rect x="26" y="5" width={80 + (i % 3) * 20} height="3" fill={HUB_PALETTE.areia} fillOpacity="0.5" />
            <rect x="26" y="12" width={40 + (i % 2) * 15} height="2" fill={HUB_PALETTE.areiaDim} fillOpacity="0.35" />
            <rect x="180" y="7" width="32" height="6" rx="1" fill={HUB_PALETTE.areiaDim} fillOpacity="0.2" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === 'menu') {
    return (
      <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
        <text x="20" y="30" fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif" fontStyle="italic" fontSize="13" fill={HUB_PALETTE.champanhe}>Mangostin</text>
        <line x1="20" y1="38" x2="220" y2="38" stroke={HUB_PALETTE.areiaDim} strokeOpacity="0.3" />
        {[['Pad Thai tradicional','R$ 96'],['Curry verde de camarão','R$ 124'],['Bao de pato pequim','R$ 78'],['Mochi de coco','R$ 38']].map(([n,p],i) => (
          <g key={i} transform={`translate(0 ${56 + i * 18})`}>
            <text x="20" y="0" fontFamily="Inter, sans-serif" fontSize="9" fill={HUB_PALETTE.areia} fillOpacity="0.8">{n}</text>
            <text x="220" y="0" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="8" fill={HUB_PALETTE.areiaDim}>{p}</text>
          </g>
        ))}
      </svg>
    );
  }
  if (kind === 'rooms') {
    return (
      <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
        {Array.from({ length: 11 * 6 }).map((_, i) => {
          const x = 16 + i % 11 * 19, y = 16 + Math.floor(i / 11) * 19, seed = i * 37 % 100;
          const fill = seed < 62 ? HUB_PALETTE.champanhe : seed < 78 ? HUB_PALETTE.jangadaGlow : HUB_PALETTE.areiaDim;
          const opacity = seed < 62 ? 0.55 : seed < 78 ? 0.55 : 0.18;
          return <rect key={i} x={x} y={y} width="14" height="14" rx="1.5" fill={fill} fillOpacity={opacity} />;
        })}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
      <g stroke={HUB_PALETTE.areiaDim} strokeOpacity="0.25" fill="none"><path d="M 20 110 L 60 80 L 100 95 L 150 50 L 200 65 L 220 40" /></g>
      <g fill={HUB_PALETTE.champanhe}>{[[60,80],[100,95],[150,50],[200,65]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.5" fillOpacity="0.7" />)}</g>
      <text x="20" y="30" fontFamily="JetBrains Mono, monospace" fontSize="8" fill={HUB_PALETTE.areiaDim} letterSpacing="2">ORDENS · ÚLTIMOS 7 DIAS</text>
      <text x="20" y="130" fontFamily="JetBrains Mono, monospace" fontSize="7" fill={HUB_PALETTE.areiaDim} opacity="0.5" letterSpacing="2">SEG · TER · QUA · QUI · SEX · SAB · DOM</text>
    </svg>
  );
}

// ─── System Panel ─────────────────────────────────────────────────────────────

function SystemPanel({ system, index, revealed, isMobile, userEmail, userTipo }) {
  const [hover, setHover] = useState(false);
  const disabled = system.url === '#';

  function handleOpen(e) {
    e.preventDefault();
    if (disabled) return;
    logHubEvento(`abrir_${system.id}`, system.nome);
    const token = localStorage.getItem('hub_sso_token');
    let destUrl = system.url;
    const parsedToken = token ? parseJwt(token) : {};
    const siteRole = parsedToken?.site_roles?.[system.id];
    if (system.terapeutaUrl && siteRole === 'massoterapeuta') {
      destUrl = system.terapeutaUrl;
    } else if (isMobile && system.mobileAdminUrl) {
      const isAdminRole = userTipo === 'admin' || siteRole === 'master' || siteRole === 'admin' || siteRole === 'satisfacao' || siteRole === 'spa';
      const isAdminEmail = (system.adminEmails || []).includes(userEmail);
      if (isAdminRole || isAdminEmail) destUrl = system.mobileAdminUrl;
    } else if (system.adminUrl) {
      const isAdminRole = siteRole === 'master' || siteRole === 'admin' || siteRole === 'satisfacao' || siteRole === 'spa';
      const isAdminEmail = (system.adminEmails || []).includes(userEmail);
      if (isAdminRole || isAdminEmail) destUrl = system.adminUrl;
    }
    // Propaga o tema atual para que o destino abra no mesmo modo (claro/escuro).
    const themeAtual = (() => {
      try { return localStorage.getItem('gm-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
    })();
    let url;
    let parsedDest = null;
    try { parsedDest = new URL(destUrl); } catch { /* invalid or '#' — fallback to direct open */ }
    // Decide sobre o destino REAL (pode ser adminUrl/terapeutaUrl/mobileAdminUrl,
    // nao necessariamente system.url) — mantendo o id para o casamento por id.
    const usaSso = cardUsaSso({ ...system, url: destUrl });
    if (token && parsedDest && usaSso) {
      const origin = parsedDest.origin;
      const destPath = (parsedDest.pathname + parsedDest.search) || '/';
      const nextParam = destPath !== '/' ? `&next=${encodeURIComponent(destPath)}` : '';
      url = `${origin}/sso?sso_token=${encodeURIComponent(token)}${nextParam}&theme=${themeAtual}`;
    } else if (usaSso) {
      // Sistema interno sem token em maos (sessao ainda nao restaurada): abre
      // direto, mas ainda propaga o tema — ele entende esse parametro.
      const sep = destUrl.includes('?') ? '&' : '?';
      url = `${destUrl}${sep}theme=${themeAtual}`;
    } else {
      // Destino externo: abre a URL exatamente como o admin cadastrou. Nao
      // acrescenta token nem theme — nenhum site de fora entende esses
      // parametros e sujar a URL e' justamente o que quebrava os links novos.
      url = destUrl;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <a href={system.url} onClick={handleOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', padding: isMobile ? '20px 18px 22px' : '28px 32px 30px', textDecoration: 'none', color: 'inherit', opacity: revealed ? 1 : 0, transform: !revealed ? 'translateY(28px)' : hover && !disabled ? 'translateY(-4px)' : 'translateY(0)', transition: `opacity 900ms ${HUB_EASE} ${index * 110}ms, transform ${hover && revealed && !disabled ? 500 : 900}ms ${HUB_EASE} ${index * 110}ms, background 500ms ${HUB_EASE}, box-shadow 550ms ${HUB_EASE}`, background: hover && !disabled ? HUB_PALETTE.panelHover : 'transparent', boxShadow: hover && !disabled ? `0 20px 44px -10px rgba(0,0,0,0.38), 0 0 0 1px ${HUB_PALETTE.linkAbrir}28` : 'none', cursor: disabled ? 'not-allowed' : 'pointer', overflow: 'hidden', zIndex: hover && !disabled ? 2 : 1 }}>
      <span style={{ position: 'absolute', top: 0, left: 0, height: 1, width: hover ? '100%' : '0%', background: HUB_PALETTE.linkAbrir, transition: `width 900ms ${HUB_EASE}` }} />

      <div style={{ marginBottom: 18 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase' }}>{system.categoria}</span>
      </div>
      <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: isMobile ? 24 : 30, lineHeight: 1.05, letterSpacing: '-0.018em', color: HUB_PALETTE.marfim, margin: '0 0 8px' }}>{system.nome}</h3>
      <div style={{ marginBottom: 14 }}><StatusBadge status={system.status} label={system.statusLabel} /></div>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.55, letterSpacing: '-0.005em', color: HUB_PALETTE.areia, margin: '0 0 22px', flex: 1 }}>{system.descricao}</p>
      <div style={{ position: 'relative', height: 110, marginBottom: 22, background: HUB_PALETTE.previewBg, border: `1px solid ${HUB_PALETTE.areiaDim}1f`, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: hover ? 1 : 0.35, transform: hover ? 'scale(1)' : 'scale(0.985)', transition: `opacity 700ms ${HUB_EASE}, transform 1100ms ${HUB_EASE}` }}>
          <SystemPreview kind={system.preview} />
        </div>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 60%, ${HUB_PALETTE.noite}cc 100%)`, pointerEvents: 'none' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 19, lineHeight: 1.2, letterSpacing: '-0.01em', color: disabled ? HUB_PALETTE.areiaDim : HUB_PALETTE.linkAbrir, display: 'inline-flex', alignItems: 'baseline', gap: 12, paddingBottom: 5, borderBottom: `1px solid ${disabled ? HUB_PALETTE.areiaDim + '33' : (hover ? HUB_PALETTE.linkAbrir : HUB_PALETTE.linkAbrir + '40')}`, transition: `border-color 600ms ${HUB_EASE}` }}>
          {disabled ? 'Em breve' : `Abrir ${system.nome}`}
          {!disabled && <span style={{ display: 'inline-block', fontFamily: 'Inter, sans-serif', fontSize: 15, transform: hover ? 'translateX(10px)' : 'translateX(0)', transition: `transform 700ms ${HUB_EASE}` }}>→</span>}
        </span>
      </div>
    </a>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────

function SectionLabel({ kicker, title, hint }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 24, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />{kicker}
        {title && <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, letterSpacing: '0.01em', textTransform: 'none', color: HUB_PALETTE.areia, fontSize: 13 }}>— {title}</span>}
      </div>
      {hint && <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 13, color: HUB_PALETTE.areiaDim, maxWidth: 320, textAlign: 'right' }}>{hint}</div>}
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function HubFooter({ easterActive, isMobile }) {
  return (
    <footer style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '28px 18px 28px' : '40px 48px 48px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 12 : 32, flexWrap: 'wrap', borderTop: `1px solid ${HUB_PALETTE.areiaDim}1a` }}>
      <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 16, color: HUB_PALETTE.areiaDim, letterSpacing: '0.005em' }}>
        {easterActive ? 'Trinta e três anos depois de Burle Marx, uma nova porta — em código.' : 'Quem é bem atendido, atende bem.'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>
        <span style={{ color: HUB_PALETTE.areia }}>Equipe de TI</span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: HUB_PALETTE.champanhe, display: 'inline-block' }} />
        <span>Gran Marquise · 2026</span>
      </div>
    </footer>
  );
}

// ─── Decoration ───────────────────────────────────────────────────────────────

function HubDecoration() {
  const ref = useRef(null);
  useEffect(() => {
    const onScroll = () => { if (ref.current) ref.current.style.transform = `translateY(${window.scrollY * 0.06}px)`; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div ref={ref} style={{ position: 'absolute', right: 0, top: 0, width: 1, height: 600, background: `linear-gradient(180deg, transparent 0%, ${HUB_PALETTE.champanhe}66 30%, ${HUB_PALETTE.champanhe}10 100%)`, pointerEvents: 'none' }} />;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function HubMarquise() {
  // Mostra a animacao de boot apenas no primeiro carregamento da sessao.
  // F5/Ctrl+Shift+R nao re-exibe a animacao se ja foi vista nesta sessao.
  const [booting, setBooting] = useState(() => {
    try { return sessionStorage.getItem('hub_boot_seen') !== '1'; } catch { return true; }
  });
  useEffect(() => {
    if (!booting) { try { sessionStorage.setItem('hub_boot_seen', '1'); } catch {} }
  }, [booting]);
  const [authed, setAuthed] = useState(false);
  const [userName, setUserName] = useState('');
  const [userTipo, setUserTipo] = useState('');
  const [sistemas, setSistemas] = useState(null); // null = todos
  const [revealed, setRevealed] = useState(false);
  const [easter, setEaster] = useState(false);
  // Tema sincronizado entre sistemas do hub:
  // 1) Se a URL trouxer ?theme=dark|light (vindo de outro sistema via Sair),
  //    usa esse — fonte de verdade do "ultimo escolhido".
  // 2) Senao tenta localStorage('gm-theme') — sessao anterior.
  // 3) Senao 'light'.
  const [theme, setTheme] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const fromUrl = p.get('theme');
      if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
      const saved = localStorage.getItem('gm-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return 'light';
  });
  // Persiste qualquer mudanca para outras abas/sessoes desta origem.
  useEffect(() => {
    try { localStorage.setItem('gm-theme', theme); } catch {}
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  // Estado persistido entre reloads (F5 / Ctrl+Shift+R nao volta para a tela inicial)
  const [showAdmin, setShowAdmin] = useState(() => {
    try { return sessionStorage.getItem('hub_show_admin') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('hub_show_admin', showAdmin ? '1' : '0'); } catch {}
  }, [showAdmin]);
  const [hubSystems, setHubSystems] = useState(HUB_SYSTEMS);
  const [userEmail, setUserEmail] = useState('');
  const [feedOpen, setFeedOpen] = useState(false);
  const [newUpdateOpen, setNewUpdateOpen] = useState(false);
  const [allUpdates, setAllUpdates] = useState(INITIAL_UPDATES);
  const [seenAt, setSeenAt] = useState(() => { try { return localStorage.getItem('hub_updates_seen_at') || '1970-01-01T00:00:00Z'; } catch { return '1970-01-01T00:00:00Z'; } });
  const seqRef = useRef('');
  const winW = useWindowWidth();
  const isMobile = winW < 768;
  // Etapa intermediaria: em tablets (768-1100px) o grid de 4 colunas ficava
  // ilegivel (~100px uteis por painel). 2 colunas nessa faixa.
  const gridCols = isMobile ? 1 : winW < 1100 ? 2 : 4;

  applyHubTheme(theme);

  useEffect(() => {
    fetch('/api/sistemas')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const merged = d.sistemas.map(s => {
            const base = HUB_SYSTEMS.find(h => h.id === s.id) || {};
            return { ...base, ...s };
          });
          setHubSystems(merged);
        }
      })
      .catch(() => {});
  }, []);

  // Whitelist de origens aceitas em ?next=<url>. Evita open redirect.
  // Mesma lista do handshake: so faz sentido redirecionar via /sso para quem
  // implementa /sso. Fonte unica em SSO_ORIGINS.
  const NEXT_ALLOWED_ORIGINS = SSO_ORIGINS;

  // Se a URL atual tem ?next=<url-completa> e o token esta valido, redireciona
  // o usuario para <origin>/sso?sso_token=<token>&next=<path> e devolve true.
  function redirectToNextIfAny() {
    try {
      const token = localStorage.getItem('hub_sso_token');
      if (!token) return false;
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      if (!next) return false;
      const u = new URL(next, window.location.origin);
      if (!NEXT_ALLOWED_ORIGINS.includes(u.origin)) return false;
      const destPath = (u.pathname || '/') + (u.search || '') + (u.hash || '');
      const themeAtual = (() => {
        try { return localStorage.getItem('gm-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
      })();
      const url = `${u.origin}/sso?sso_token=${encodeURIComponent(token)}&next=${encodeURIComponent(destPath)}&theme=${themeAtual}`;
      window.location.replace(url);
      return true;
    } catch (_) { return false; }
  }

  useEffect(() => {
    if (document.getElementById('hub-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'hub-keyframes';
    s.textContent = [
      '@keyframes hubDraw{to{stroke-dashoffset:0}}',
      '@keyframes hubFadeIn{to{opacity:1}}',
      '@keyframes hubPop{0%{transform:scale(.55)}60%{transform:scale(1.18)}100%{transform:scale(1)}}',
      '@keyframes hubPulse{0%{box-shadow:0 0 0 0 rgba(62,132,151,.55)}65%{box-shadow:0 0 0 10px rgba(62,132,151,0)}100%{box-shadow:0 0 0 0 rgba(62,132,151,0)}}',
      '@keyframes hubUpdatePop{0%{transform:scale(.65) translateY(3px);opacity:0}60%{transform:scale(1.1) translateY(0)}100%{transform:scale(1) translateY(0);opacity:1}}',
      '@keyframes hubSlideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes hubBellRing{0%,100%{transform:rotate(0)}12%{transform:rotate(18deg)}24%{transform:rotate(-14deg)}36%{transform:rotate(9deg)}48%{transform:rotate(-5deg)}60%{transform:rotate(0)}}',
      '.hub-tabs-scroll::-webkit-scrollbar{display:none}',
      '@media(max-width:767px){input,select,textarea{font-size:16px!important}}',
      '@media(max-width:767px){body{padding-bottom:env(safe-area-inset-bottom,0px)}}',
      '@media(max-width:767px){button{-webkit-tap-highlight-color:transparent}}',
    ].join('');
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    document.body.style.background = HUB_PALETTE.noite;
    document.body.style.transition = `background 1200ms ${HUB_EASE}`;
    document.body.style.setProperty('--grain-opacity', String(HUB_PALETTE.grainOpacity));
    document.body.style.setProperty('--grain-blend', HUB_PALETTE.grainBlend);
  }, [theme]);

  // Restauracao de sessao roda em paralelo ao booting, nao depende dele terminar.
  // Mesmo enquanto a animacao de boot esta na tela, ja autenticamos o usuario e
  // carregamos /api/me/sistemas. Quando booting==false a tela autenticada aparece sem delay.
  useEffect(() => {
    const token = localStorage.getItem('hub_sso_token');
    // Detecta retorno de logout de algum sistema externo (?logout=1&from=X)
    // e registra na jornada do usuario. Limpa a querystring depois.
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('logout') === '1' && p.get('from') && token) {
        const from = p.get('from').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
        logHubEvento(`logout_${from}`);
        const cleanUrl = window.location.pathname + window.location.hash;
        try { window.history.replaceState({}, '', cleanUrl); } catch {}
      }
    } catch {}
    if (!token) return;
    const payload = parseJwt(token);
    if (!(payload.exp && payload.exp * 1000 > Date.now())) {
      clearHubAuth();
      return;
    }
    if (redirectToNextIfAny()) return;
    setUserName(payload.nome || '');
    setUserTipo(localStorage.getItem('hub_tipo') || payload.tipo || '');
    setUserEmail(payload.email || '');
    setAuthed(true);
    hubFetch('/api/me/sistemas')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.ok) setSistemas(d.sistemas); })
      .catch(() => {});
    const t = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!authed) return;
    const token = localStorage.getItem('hub_sso_token');
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    es.addEventListener('permissions', async e => {
      try {
        const r = await hubFetch('/api/auth/refresh', { method: 'POST' });
        const d = await r.json();
        if (d.ok && d.token) {
          localStorage.setItem('hub_sso_token', d.token);
          setSistemas(d.sistemas);
          return;
        }
      } catch {}
      // fallback: usa o payload do evento SSE (sem renovar o JWT)
      const { sistemas: s } = JSON.parse(e.data);
      setSistemas(s);
    });
    es.addEventListener('update', e => {
      try {
        const u = JSON.parse(e.data);
        setAllUpdates(prev => prev.some(x => x.id === u.id) ? prev : [u, ...prev]);
      } catch {}
    });
    es.addEventListener('update_edit', e => {
      try {
        const u = JSON.parse(e.data);
        setAllUpdates(prev => prev.map(x => x.id === u.id ? u : x));
      } catch {}
    });
    es.addEventListener('update_delete', e => {
      try {
        const { id } = JSON.parse(e.data);
        setAllUpdates(prev => prev.filter(x => x.id !== id));
      } catch {}
    });
    return () => es.close();
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const token = localStorage.getItem('hub_sso_token');
    fetch('/api/updates', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.updates.length > 0)
          setAllUpdates(prev => {
            const fromApi = d.updates;
            const apiIds = new Set(fromApi.map(u => u.id));
            const sseOnly = prev.filter(u => !apiIds.has(u.id));
            return [...sseOnly, ...fromApi];
          });
      })
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed || showAdmin) return;
    const onScroll = () => sessionStorage.setItem('hub_scroll', String(window.scrollY));
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [authed, showAdmin]);

  useEffect(() => {
    if (!revealed) return;
    history.scrollRestoration = 'manual';
    const saved = sessionStorage.getItem('hub_scroll');
    if (saved && parseInt(saved, 10) > 0) {
      const t = setTimeout(() => window.scrollTo({ top: parseInt(saved, 10), behavior: 'instant' }), 300);
      return () => clearTimeout(t);
    }
  }, [revealed]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key && e.key.length === 1) {
        seqRef.current = (seqRef.current + e.key.toUpperCase()).slice(-2);
        if (seqRef.current === 'GM') setEaster(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleLogin(nome, sis, tipo) {
    // Login concluido: se veio com ?next=, redireciona direto para o sistema destino.
    logHubEvento('login_hub');
    if (redirectToNextIfAny()) return;
    setUserName(nome);
    setUserTipo(tipo || '');
    setSistemas(sis);
    setAuthed(true);
    setTimeout(() => setRevealed(true), 80);
    setUserEmail(parseJwt(localStorage.getItem('hub_sso_token')).email || '');
  }

  function handleLogout() {
    logHubEvento('logout_hub');
    clearHubAuth();
    try { sessionStorage.removeItem('hub_boot_seen'); } catch {}
    setAuthed(false);
    setRevealed(false);
    setUserName('');
    setUserTipo('');
    setUserEmail('');
    setSistemas(null);
    setShowAdmin(false);
  }

  // Fail-closed: durante o carregamento (sistemas==null) e quando o back-end
  // devolve array vazio, NAO mostramos nada. So um array contendo o id libera.
  const sistemasVisiveis = hubSystems
    .filter(s => s.status === 'no-ar')
    .filter(s => Array.isArray(sistemas) && sistemas.includes(s.id));

  // Somente updates de sistemas que o usuário tem acesso + updates do hub (visíveis a todos).
  const visibleSystemIds = new Set(sistemasVisiveis.map(s => s.id));
  const visibleUpdates = allUpdates.filter(u => u.sistemaId === 'hub' || visibleSystemIds.has(u.sistemaId));

  const unseenCount = visibleUpdates.filter(u => new Date(u.ts) > new Date(seenAt)).length;

  return (
    <div id="top" style={{ minHeight: '100vh', background: easter ? `radial-gradient(ellipse at 70% -10%, ${HUB_PALETTE.jangada}22, transparent 50%), ${HUB_PALETTE.noite}` : HUB_PALETTE.noite, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', transition: `background 1200ms ${HUB_EASE}`, position: 'relative', overflow: 'hidden' }}>
      {booting && <HubBoot onDone={() => setBooting(false)} />}
      {!booting && !authed && <HubLogin onLogin={handleLogin} />}
      {!booting && authed && showAdmin && <HubAdmin onClose={() => setShowAdmin(false)} hubSystems={hubSystems} setHubSystems={setHubSystems} />}
      {!booting && authed && !showAdmin && (
        <>
          <HubHeader
            theme={theme}
            onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            isMobile={isMobile}
            userName={userName}
            userEmail={userEmail}
            userTipo={userTipo}
            onLogout={handleLogout}
            onOpenAdmin={() => setShowAdmin(true)}
            updatesCount={unseenCount}
            onOpenFeed={() => {
              const now = new Date().toISOString();
              try { localStorage.setItem('hub_updates_seen_at', now); } catch {}
              setSeenAt(now);
              setFeedOpen(v => !v);
            }}
          />
          <main style={{ position: 'relative' }}>
            <HubDecoration />
            <HubHero revealed={revealed} easterActive={easter} isMobile={isMobile} userName={userName} sistemasVisiveis={sistemasVisiveis} />
            <section style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px 18px 36px' : '12px 48px 48px' }}>
              <SectionLabel kicker="No ar" title="Pronto para usar." hint={isMobile ? null : 'Clique no painel para abrir o sistema em uma aba nova.'} />
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 0, borderTop: `1px solid ${HUB_PALETTE.areiaDim}2a` }}>
                {sistemasVisiveis.map((sys, i, arr) => (
                  <div key={sys.id} style={{ borderBottom: `1px solid ${HUB_PALETTE.areiaDim}2a`, borderRight: gridCols > 1 && i % gridCols !== gridCols - 1 && i < arr.length - 1 ? `1px solid ${HUB_PALETTE.areiaDim}2a` : 'none' }}>
                    <SystemPanel system={sys} index={i} revealed={revealed} isMobile={isMobile} userEmail={userEmail} userTipo={userTipo} />
                  </div>
                ))}
              </div>
            </section>
            <HubFooter easterActive={easter} isMobile={isMobile} />
          </main>
          {feedOpen && <UpdatesFeed
            updates={visibleUpdates}
            onClose={() => setFeedOpen(false)}
            userTipo={userTipo}
            onOpenNewUpdate={() => setNewUpdateOpen(true)}
            isMobile={isMobile}
            seenAt={seenAt}
            onUpdateEdited={u => setAllUpdates(prev => prev.map(x => x.id === u.id ? u : x))}
            onUpdateDeleted={id => setAllUpdates(prev => prev.filter(x => x.id !== id))}
          />}
          {newUpdateOpen && <NewUpdateModal
            hubSystems={hubSystems}
            onSave={async u => {
              const token = localStorage.getItem('hub_sso_token');
              const r = await fetch('/api/admin/updates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(u) });
              const d = await r.json();
              if (!d.ok) throw new Error(d.erro || 'Erro ao publicar');
              setAllUpdates(prev => prev.some(x => x.id === d.update.id) ? prev : [d.update, ...prev]);
            }}
            onClose={() => setNewUpdateOpen(false)}
          />}
        </>
      )}
    </div>
  );
}

Object.assign(window, { HubMarquise });
