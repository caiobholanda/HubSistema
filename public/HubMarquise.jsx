const { useState, useEffect, useRef } = React;

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

const HUB_SYSTEMS = [
{
  id: 'chamados',
  num: '01',
  categoria: 'Suporte · Atendimento interno',
  nome: 'Chamados TI',
  paraQuem: 'Todos os setores',
  descricao: 'Para pedir ajuda da equipe de TI do hotel — Você abre o chamado, anexa fotos se quiser, e acompanha o atendimento.',
  detalhe: 'Em uso por todos os setores do hotel.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://sistema-chamados-granmarquise.fly.dev',
  repo: 'caiobholanda/sistema-chamados',
  stack: ['Anexar fotos e prints', 'Acompanhar atendimento', 'Histórico de chamados', 'Acesso pelo navegador'],
  preview: 'tickets'
},
{
  id: 'ramais',
  num: '02',
  categoria: 'Comunicação · Interno',
  nome: 'Lista de Ramais',
  paraQuem: 'Todos os setores',
  descricao: 'Diretório de ramais e contatos internos do hotel — consulte o ramal de qualquer setor ou colaborador sem precisar ligar para a recepção.',
  detalhe: 'Acesso pelo navegador.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://diretorio-ramais-granmarquise.fly.dev',
  repo: 'caiobholanda/ListaRamais',
  stack: ['Busca por nome ou setor', 'Ramais e contatos'],
  preview: 'directory'
},
{
  id: 'pesquisa-satisfacao',
  num: '03',
  categoria: 'Spa · Atendimento ao hóspede',
  nome: 'Pesquisa de Satisfação',
  paraQuem: 'Equipe do Spa',
  descricao: 'Coleta de feedback dos hóspedes após os tratamentos no Spa — avaliação dos serviços, instalações, massoterapeutas e experiência geral.',
  detalhe: 'Acesso restrito à equipe do Spa e TI.',
  status: 'no-ar',
  statusLabel: 'Disponível',
  statusHint: 'Pode usar agora',
  url: 'https://pesquisa-satisfacao.fly.dev',
  adminUrl: 'https://pesquisa-satisfacao.fly.dev/admin',
  adminEmails: ['estagio.ti@granmarquise.com.br', 'suporte.ti@granmarquise.com.br', 'richard@granmarquise.com.br'],
  repo: 'caiobholanda/PesquisaSatisfacao',
  stack: ['Avaliação pós-tratamento', 'Painel de relatórios', 'Gestão de massoterapeutas'],
  preview: 'tickets'
}];


// ─── Boot ─────────────────────────────────────────────────────────────────────

function HubBoot({ onDone }) {
  const [phase, setPhase] = useState('drawing');
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fade'), 1500);
    const t2 = setTimeout(() => onDone(), 2100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: HUB_PALETTE.noite,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: phase === 'fade' ? 0 : 1,
      transition: `opacity 600ms ${HUB_EASE}`,
      pointerEvents: phase === 'fade' ? 'none' : 'auto'
    }}>
      <img
        src="https://letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png"
        alt="Gran Marquise"
        style={{ height: 80, width: 'auto', filter: HUB_PALETTE.noite === HUB_THEMES.dark.noite ? 'brightness(0) invert(1)' : 'none', opacity: 0.9 }}
      />
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
  const [esqOpen, setEsqOpen] = useState(false);
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
    e.preventDefault();
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
      if (r.ok && d.ok) {
        setEsqMsg({ tipo: 'ok', titulo: 'E-mail enviado!', texto: 'Verifique sua caixa de entrada (e o spam) e clique no link para redefinir sua senha.' });
        setEsqEnviado(true);
      } else if (r.status === 404) {
        _esqErro('E-mail não encontrado', 'Este endereço não está cadastrado no sistema. Verifique e tente novamente.');
      } else {
        _esqErro('Algo deu errado', d.erro || 'Tente novamente em instantes.');
      }
    } catch { _esqErro('Sem conexão', 'Verifique sua conexão com a internet e tente novamente.'); }
    setEsqLoading(false);
  }

  function resetEsqueci() {
    setEsqEnviado(false); setEsqMsg(null); setEsqEmail('');
    setTimeout(() => { if (esqEmailRef.current) esqEmailRef.current.focus(); }, 60);
  }

  // Foco automatico ao abrir o painel
  useEffect(() => {
    if (esqOpen && !esqEnviado) {
      const t = setTimeout(() => { if (esqEmailRef.current) esqEmailRef.current.focus(); }, 180);
      return () => clearTimeout(t);
    }
  }, [esqOpen, esqEnviado]);

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
    fontSize: 14,
    padding: '14px 16px',
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: trocaForcada ? 36 : 48 }}>
          <img
            src="https://letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png"
            alt="Gran Marquise"
            style={{ height: trocaForcada ? 56 : 46, width: 'auto', filter: HUB_PALETTE.noite === HUB_THEMES.dark.noite ? 'brightness(0) invert(1)' : 'none', opacity: 0.9, marginBottom: trocaForcada ? 24 : 20 }}
          />
          <h1 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: trocaForcada ? 44 : 36, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: 0, lineHeight: 1 }}>{trocaForcada ? 'Defina sua nova senha.' : 'Entrar.'}</h1>
          {trocaForcada && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: HUB_PALETTE.areia, marginTop: 18, textAlign: 'center', lineHeight: 1.6 }}>
              É o seu primeiro acesso. Por segurança, troque a senha temporária<br />que você recebeu antes de continuar.
            </div>
          )}
        </div>

        {trocaForcada ? (() => {
          const senhaScore = (() => {
            const s = novaSenha || '';
            if (!s) return null;
            let n = 0;
            if (s.length >= 8) n++;
            if (/[A-Z]/.test(s)) n++;
            if (/[a-z]/.test(s)) n++;
            if (/[0-9]/.test(s)) n++;
            if (/[^A-Za-z0-9]/.test(s)) n++;
            return n;
          })();
          const senhaCor = senhaScore == null ? null : ['#e53935', '#e53935', '#fb8c00', '#fdd835', '#7cb342', '#43a047'][senhaScore];
          const senhaLabel = senhaScore == null ? null : ['Muito fraca', 'Fraca', 'Média', 'Boa', 'Forte', 'Excelente'][senhaScore];
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
              {senhaScore != null && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, height: 5, background: HUB_PALETTE.areiaDim + '33', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(senhaScore / 5) * 100}%`, height: '100%', background: senhaCor, transition: 'width 220ms, background 220ms' }} />
                  </div>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: senhaCor, minWidth: 90, textAlign: 'right' }}>{senhaLabel}</span>
                </div>
              )}
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: HUB_PALETTE.areiaDim, marginTop: 10, lineHeight: 1.55 }}>
                Mínimo 8 caracteres, com maiúscula, minúscula, número e caractere especial.<br />
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
        })() : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 }}>E-mail</div>
            <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@granmarquise.com.br" required disabled={loading}
              style={inputBase}
              onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
              onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
          </div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 }}>Senha</div>
            <div style={{ position: 'relative' }}>
              <input type={mostrarSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" required disabled={loading}
                style={{ ...inputBase, paddingRight: 48 }}
                onFocus={e => e.target.style.borderColor = HUB_PALETTE.champanhe + '88'}
                onBlur={e => e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'} />
              <button type="button" onClick={() => setMostrarSenha(v => !v)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: HUB_PALETTE.areiaDim, cursor: 'pointer', padding: 0, display: 'flex' }}>
                {mostrarSenha
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
          {erro && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#E07A5F', paddingTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}><span>—</span> {erro}</div>}
          <button type="submit" disabled={loading}
            style={{ marginTop: 10, width: '100%', padding: '14px', background: 'transparent', border: `1px solid ${loading ? HUB_PALETTE.champanhe + '44' : HUB_PALETTE.champanhe + 'aa'}`, borderRadius: 0, color: loading ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer', transition: `background 300ms ${HUB_EASE}, border-color 250ms ${HUB_EASE}, color 250ms ${HUB_EASE}`, opacity: loading ? 0.55 : 1 }}
            onMouseEnter={e => { if (!loading) { e.target.style.background = 'rgba(156,88,67,0.1)'; e.target.style.borderColor = HUB_PALETTE.champanhe; } }}
            onMouseLeave={e => { if (!loading) { e.target.style.background = 'transparent'; e.target.style.borderColor = HUB_PALETTE.champanhe + 'aa'; } }}>
            {loading ? 'Verificando...' : 'Entrar'}
          </button>

          {/* Esqueci a senha */}
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <button type="button"
              onClick={() => { setEsqOpen(v => !v); setEsqMsg(null); setEsqEnviado(false); if (!esqOpen && email) setEsqEmail(email); }}
              style={{ background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: '6px 4px' }}>
              {esqOpen ? 'Cancelar' : 'Esqueci minha senha'}
            </button>
          </div>

          {esqOpen && (
            <div style={{ marginTop: 4, paddingTop: 16, borderTop: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.areia, margin: 0, lineHeight: 1.55 }}>
                Digite seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
              {!esqEnviado && (
                <div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 8 }}>E-mail cadastrado</div>
                  <input key={esqShakeKey} ref={esqEmailRef} type="email" value={esqEmail} onChange={e => setEsqEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleEsqueci(e); }}
                    placeholder="seu@granmarquise.com.br" required disabled={esqLoading}
                    style={{ ...inputBase, ...(esqMsg && esqMsg.tipo === 'erro' ? { borderColor: '#E07A5F', boxShadow: '0 0 0 3px rgba(224,122,95,0.13)', animation: 'hubShake .42s ease' } : null) }}
                    onFocus={e => { if (!(esqMsg && esqMsg.tipo === 'erro')) e.target.style.borderColor = HUB_PALETTE.champanhe + '88'; }}
                    onBlur={e => { if (!(esqMsg && esqMsg.tipo === 'erro')) e.target.style.borderColor = HUB_PALETTE.areiaDim + '44'; }} />
                </div>
              )}
              {esqMsg && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  borderLeft: `3px solid ${esqMsg.tipo === 'ok' ? '#7cb342' : '#E07A5F'}`,
                  background: esqMsg.tipo === 'ok' ? 'rgba(124,179,66,0.08)' : 'rgba(224,122,95,0.08)',
                  fontFamily: 'Inter, sans-serif',
                  animation: 'hubSlideIn .22s ease',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={esqMsg.tipo === 'ok' ? '#7cb342' : '#E07A5F'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    {esqMsg.tipo === 'ok'
                      ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
                      : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: esqMsg.tipo === 'ok' ? '#7cb342' : '#E07A5F', marginBottom: 2 }}>{esqMsg.titulo}</div>
                    <div style={{ fontSize: 12.5, color: HUB_PALETTE.areia, lineHeight: 1.5 }}>{esqMsg.texto}</div>
                  </div>
                </div>
              )}
              {!esqEnviado && (
                <button type="button" onClick={handleEsqueci} disabled={esqLoading}
                  style={{ width: '100%', padding: '13px', background: 'transparent', border: `1px solid ${HUB_PALETTE.champanhe}88`, color: esqLoading ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, letterSpacing: '0.28em', textTransform: 'uppercase', cursor: esqLoading ? 'not-allowed' : 'pointer' }}>
                  {esqLoading ? 'Enviando…' : (esqMsg && esqMsg.tipo === 'erro' ? 'Solicitar redefinição' : 'Enviar link de redefinição')}
                </button>
              )}
              {esqEnviado && (
                <button type="button" onClick={resetEsqueci}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.areiaDim, textDecoration: 'underline', padding: 0, alignSelf: 'flex-start' }}>
                  Não recebeu? Reenviar
                </button>
              )}
            </div>
          )}
        </form>
        )}

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

function LinkForm({ form, setForm, onSave, onCancel, linkErro, linkSaving }) {
  const isMobile = useWindowWidth() < 768;
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
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v} style={optStyle}>{l}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={labelStyle}>URL</div>
          <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder="https://..." style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Categoria</div>
          <input value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))} placeholder="Ex: Operação · Hospedagem" style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Para quem</div>
          <input list="lf-para-quem" value={form.paraQuem} onChange={e => setForm(p => ({ ...p, paraQuem: e.target.value }))} placeholder="Ex: Todos os setores" style={inputStyle} />
          <datalist id="lf-para-quem">
            <option value="Todos os setores" />
            <option value="Equipe do Spa" />
            <option value="Equipe de TI" />
          </datalist>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={labelStyle}>Descrição</div>
          <textarea value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))} placeholder="Breve descrição do sistema" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
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

function LinkEditModal({ sys, form, setForm, onSave, onCancel, linkErro, linkSaving, isMobile, users }) {
  const [aba, setAba] = useState('edicao'); // 'edicao' | 'liberacao'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 720, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe }}>Editar link</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 22, color: HUB_PALETTE.marfim, marginTop: 4 }}>{sys.nome}</div>
          </div>
          <button onClick={onCancel} aria-label="Fechar" style={{ background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 14, padding: '6px 12px', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: '0 24px' }}>
          {/* Aba Liberacao escondida para 'chamados' — la os cookies de admin
              sao decididos automaticamente pelo banco do proprio sistema-chamados
              (admin do TI vs usuario do portal), nao por allowlist do Hub.
              Manter a aba seria enganoso (mudanca aqui nao afeta cookie de la). */}
          {[{ id: 'edicao', label: 'Informações' }, ...(sys.id !== 'chamados' ? [{ id: 'liberacao', label: 'Liberação' }] : [])].map(t => (
            <button key={t.id} onClick={() => setAba(t.id)}
              style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${aba === t.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: aba === t.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '12px 18px 10px', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {aba === 'edicao' && (
            <div style={{ padding: isMobile ? '12px' : '4px 24px 8px' }}>
              <LinkForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} linkErro={linkErro} linkSaving={linkSaving} />
            </div>
          )}
          {aba === 'liberacao' && (
            <LiberacaoPanel sistemaId={sys.id} sistemaNome={sys.nome} isMobile={isMobile} users={users} />
          )}
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
function LiberacaoPanel({ sistemaId, sistemaNome, isMobile, users }) {
  const [items, setItems] = useState(null); // null=loading, []=vazio
  const [novoEmail, setNovoEmail] = useState('');
  const [novoPapel, setNovoPapel] = useState('admin');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemover, setConfirmRemover] = useState(null); // null | { email }
  const [sugAberto, setSugAberto] = useState(false);
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
  const btn = { background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer' };

  return (
    <div style={{ padding: isMobile ? '12px' : '18px 24px 24px' }}>
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
            onChange={e => { setNovoEmail(e.target.value); setSugAberto(true); }}
            onFocus={() => setSugAberto(true)}
            onBlur={() => setTimeout(() => setSugAberto(false), 180)}
            placeholder="Digite para buscar um e-mail cadastrado…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.marfim, padding: '10px 14px', fontFamily: 'Inter, sans-serif', fontSize: 13 }} />
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
                {candidatos.map(u => {
                  const ehAdmin = u.tipo === 'admin' || u.is_master;
                  return (
                    <div key={u.email}
                      onMouseDown={e => { e.preventDefault(); setNovoEmail(u.email); setSugAberto(false); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}1a`, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: HUB_PALETTE.marfim, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.background = HUB_PALETTE.areiaDim + '14'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
            style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}44`, padding: '10px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13 }}
            title="Papel: master vê e edita tudo · admin só vê · spa edita Spa · satisfação edita Relatórios">
            <option value="master"     style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Master</option>
            <option value="admin"      style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Admin (só ver)</option>
            <option value="spa"        style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Spa</option>
            <option value="satisfacao" style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Satisfação</option>
          </select>
        )}
        <button onClick={adicionar} disabled={busy} style={{ background: HUB_PALETTE.champanhe + '22', border: `1px solid ${HUB_PALETTE.champanhe}55`, color: HUB_PALETTE.champanhe, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '10px 18px', cursor: busy ? 'wait' : 'pointer' }}>
          + Adicionar
        </button>
      </div>
      {erro && <div style={{ color: '#E07A5F', fontFamily: 'Inter, sans-serif', fontSize: 13, marginBottom: 14 }}>{erro}</div>}

      {confirmRemover && (
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
        </div>
      )}

      <div style={subTitulo}>Admins ({admins.length})</div>
      <div style={lista}>
        {items === null && <div style={{ ...item, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Carregando…</div>}
        {items !== null && admins.length === 0 && <div style={{ ...item, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhum admin definido. Adicione contas acima.</div>}
        {admins.map(x => (
          <div key={'a-' + x.email} style={item}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.email}</span>
            {ehPesquisa ? (
              <select value={x.papel || 'admin'} onChange={e => trocarPapel(x.email, e.target.value)} disabled={busy}
                style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}44`, padding: '4px 8px', fontFamily: 'Inter, sans-serif', fontSize: 12 }}
                title="Mudar papel">
                <option value="master" style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Master</option>
                <option value="admin"  style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Admin</option>
                <option value="spa"    style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Spa</option>
                <option value="satisfacao" style={{ background: HUB_PALETTE.noiteAlt || HUB_PALETTE.noite, color: HUB_PALETTE.marfim }}>Satisfação</option>
              </select>
            ) : null}
            <button onClick={() => remover(x.email)} disabled={busy} style={{ ...btn, color: '#E07A5F', borderColor: '#E07A5F44' }} title="Remover acesso de admin">× Remover</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

function HubAdmin({ onClose, hubSystems, setHubSystems }) {
  const isMobile = useWindowWidth() < 768;
  const [aba, _setAba] = useState(() => {
    try { return sessionStorage.getItem('hub_admin_aba') || 'contas'; } catch { return 'contas'; }
  });
  const setAba = (v) => { try { sessionStorage.setItem('hub_admin_aba', v); } catch {} _setAba(v); };
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [saving, setSaving] = useState(null);

  // Links tab state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  // Snapshot do link no momento do startEdit; usado para detectar 'nada mudou'.
  const [editOriginal, setEditOriginal] = useState({});
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState({ nome: '', url: '', status: 'no-ar', categoria: '', descricao: '', paraQuem: '' });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkErro, setLinkErro] = useState('');
  const [expandedLink, setExpandedLink] = useState(null);
  const [filtroSemAcesso, setFiltroSemAcesso] = useState('');
  // Toast simples para feedback de Links (sucesso/erro). Auto-some em 2.6s.
  const [linkToast, setLinkToast] = useState(null); // { msg, err: boolean }
  function notifyLink(msg, err) { setLinkToast({ msg, err: !!err }); setTimeout(() => setLinkToast(null), 2600); }

  const noArSystems = hubSystems.filter(s => s.status === 'no-ar');

  useEffect(() => {
    const token = localStorage.getItem('hub_sso_token');
    Promise.all([
      fetch('/api/admin/all-users', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/admin/data', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([allUsers, hubData]) => {
      setUsers(allUsers.users || []);
      setPermissions(hubData.permissions || {});
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
    const initial = { nome: sys.nome, url: sys.url, status: sys.status, categoria: sys.categoria || '', descricao: sys.descricao || '', paraQuem: sys.paraQuem || '' };
    setEditForm(initial);
    setEditOriginal(initial);
    setLinkErro('');
  }

  async function saveEdit() {
    if (!editForm.nome || !editForm.status) { setLinkErro('Nome e status são obrigatórios'); return; }
    // Bloqueia salvar se nada mudou em relacao ao snapshot do startEdit.
    const camposLink = ['nome', 'url', 'status', 'categoria', 'descricao', 'paraQuem'];
    const algumMudou = camposLink.some(k => (editOriginal[k] ?? '') !== (editForm[k] ?? ''));
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
      setNewForm({ nome: '', url: '', status: 'no-ar', categoria: '', descricao: '', paraQuem: '' });
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
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.areia }}>Administração · Hub</span>
          </div>
          <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', padding: '8px 16px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = HUB_PALETTE.marfim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '88'; }}
            onMouseLeave={e => { e.currentTarget.style.color = HUB_PALETTE.areiaDim; e.currentTarget.style.borderColor = HUB_PALETTE.areiaDim + '44'; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Fechar
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', paddingLeft: isMobile ? 18 : 48, gap: 0, overflowX: 'auto' }}>
          {ABAS.map(a => (
            <button key={a.id} onClick={() => { setAba(a.id); setEditingId(null); setAddingNew(false); setLinkErro(''); }}
              style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${aba === a.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: aba === a.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', padding: '12px 20px 10px', cursor: 'pointer', transition: `color 200ms, border-color 200ms` }}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '48px 48px 80px', width: '100%' }}>

        {/* ── Aba Links ── */}
        {aba === 'links' && (<>
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Gerenciar Links
            </div>
            <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Links do Hub.</h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
              Edite os sistemas existentes ou adicione novos links ao Hub.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
            {hubSystems.map(sys => {
              const isLinkOpen = expandedLink === sys.id;
              // Mesma regra do back-end: admin/master sempre tem acesso; demais
              // precisam do id no array (undefined/null/vazio = sem acesso).
              const comAcesso = users.filter(u => {
                if (u.tipo === 'admin' || u.is_master) return true;
                const p = permissions[u.email];
                return Array.isArray(p) && p.includes(sys.id);
              });
              const semAcesso = users.filter(u => {
                if (u.tipo === 'admin' || u.is_master) return false;
                const p = permissions[u.email];
                return !Array.isArray(p) || !p.includes(sys.id);
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
                        {comAcesso.length === 0 ? (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areiaDim, fontStyle: 'italic' }}>Nenhum usuário com acesso.</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {comAcesso.map(u => (
                              <span key={u.email}
                                onClick={() => toggleSystem(u.email, sys.id)}
                                title="Clique para remover acesso"
                                style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, background: `${HUB_PALETTE.areiaDim}10`, border: `1px solid ${HUB_PALETTE.areiaDim}22`, padding: '4px 12px', cursor: 'pointer', userSelect: 'none' }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#E07A5F18'; e.currentTarget.style.borderColor = '#E07A5F44'; e.currentTarget.style.color = '#E07A5F'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = `${HUB_PALETTE.areiaDim}10`; e.currentTarget.style.borderColor = `${HUB_PALETTE.areiaDim}22`; e.currentTarget.style.color = HUB_PALETTE.areia; }}>
                                {u.nome.split(' ')[0]}{u.setor ? <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>{u.setor}</span> : null}
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {semAcesso
                                .filter(u => u.nome.toLowerCase().includes(filtroSemAcesso.toLowerCase()) || (u.setor && u.setor.toLowerCase().includes(filtroSemAcesso.toLowerCase())))
                                .sort((a, b) => {
                                  const sa = (a.setor || '￿').toLowerCase();
                                  const sb = (b.setor || '￿').toLowerCase();
                                  if (sa !== sb) return sa.localeCompare(sb, 'pt');
                                  return (a.nome || '').toLowerCase().localeCompare((b.nome || '').toLowerCase(), 'pt');
                                })
                                .map(u => (
                                <div key={u.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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

          {addingNew ? (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 16 }}>Novo link</div>
              <LinkForm form={newForm} setForm={setNewForm} onSave={saveNew} onCancel={() => { setAddingNew(false); setLinkErro(''); }} linkErro={linkErro} linkSaving={linkSaving} />
            </div>
          ) : (
            <button onClick={() => { setAddingNew(true); setEditingId(null); setLinkErro(''); }}
              style={{ marginTop: 32, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#996442', border: '1px solid #996442', color: '#ECE4D2', fontFamily: 'Inter, sans-serif', fontSize: 12, letterSpacing: 'normal', textTransform: 'none', padding: '10px 20px', cursor: 'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar novo link
            </button>
          )}
        </>)}

        {/* ── Aba Contas ── */}
        {aba === 'contas' && <ContasPanel isMobile={isMobile} />}

        {/* ── Aba Setores ── */}
        {aba === 'setores' && <SetoresPanel isMobile={isMobile} />}

        {/* ── Aba Historico ── */}
        {aba === 'historico' && <HistoricoPanel isMobile={isMobile} />}

      </div>
      {linkToast && (
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: linkToast.err ? '#E07A5F' : HUB_PALETTE.champanhe, color: linkToast.err ? '#fff' : HUB_PALETTE.noite, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '12px 22px' }}>
          {linkToast.msg}
        </div>
      )}
      {/* Fase 3: modal de edicao de link (substitui edicao inline). */}
      {editingId && (() => {
        const sys = hubSystems.find(s => s.id === editingId);
        if (!sys) return null;
        return (
          <LinkEditModal sys={sys} form={editForm} setForm={setEditForm} onSave={saveEdit}
            onCancel={() => { setEditingId(null); setLinkErro(''); }}
            linkErro={linkErro} linkSaving={linkSaving} isMobile={isMobile} users={users} />
        );
      })()}
    </div>
  );
}

// ─── Historico (audit log de Administracao Hub) ─────────────────────────────
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
    const alvo = e.target_nome || `#${e.target_id || ''}`;
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
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Alterações no painel.</h2>
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

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 150);
    return () => clearTimeout(t);
  }, [busca]);

  function token() { return localStorage.getItem('hub_sso_token'); }
  function notify(msg, isErr) { setToast({ msg, err: !!isErr }); setTimeout(() => setToast(''), 2800); }

  async function carregar() {
    try {
      const r = await fetch('/api/admin/chamados-setores', { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (r.ok && d.ok) setLista(d.setores || []);
      else { setLista([]); notify(d.erro || 'Erro ao carregar setores', true); }
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

  async function confirmarExclusao() {
    if (!confirmar) return;
    const id = confirmar.id;
    setConfirmar(null);
    try {
      const r = await fetch(`/api/admin/chamados-setores/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { notify(d.erro || 'Erro ao excluir', true); return; }
      notifyHubMutation();
      notify('Setor excluído');
      await carregar();
    } catch { notify('Erro de conexão', true); }
  }

  const q = buscaDebounced.trim().toLowerCase();
  const filtrada = (lista || []).filter(s => !q || (s.nome || '').toLowerCase().includes(q));

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
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontStyle: 'italic', fontSize: 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Setores do hotel.</h2>
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
        {filtrada.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, fontFamily: 'Inter, sans-serif', fontSize: 17, color: HUB_PALETTE.marfim, fontWeight: 600 }}>
              {s.nome}
            </div>
            <button onClick={() => startEdit(s)} style={cs.btnGhost}>Editar</button>
            <button onClick={() => setConfirmar({ id: s.id, nome: s.nome })} style={cs.btnDanger}>Excluir</button>
          </div>
        ))}
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
    {confirmar && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 420, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#9C5843', marginBottom: 6 }}>Confirmar inativação</div>
          <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 22, color: HUB_PALETTE.marfim, margin: '0 0 14px', lineHeight: 1.25 }}>
            Inativar o setor "{confirmar.nome}"?
          </h3>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.areia, margin: '0 0 22px', lineHeight: 1.5 }}>
            O setor será removido da lista. Chamados existentes não são afetados.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmar(null)} style={cs.btnGhost}>Cancelar</button>
            <button onClick={confirmarExclusao} style={{ ...cs.btnPrim, color: '#ECE4D2', fontFamily: 'Inter, sans-serif', letterSpacing: 'normal', textTransform: 'none' }}>Inativar</button>
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
      <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 460, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 6 }}>Setor</div>
        <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontWeight: 300, fontSize: 26, color: HUB_PALETTE.marfim, margin: '0 0 22px' }}>
          {isEdit ? 'Editar setor' : 'Informar novo setor'}
        </h3>
        <form autoComplete="off" onSubmit={e => { e.preventDefault(); onSave(nome); }}>
          <label style={cs.label}>Nome do setor *</label>
          <input ref={inputRef} style={cs.input} value={nome} maxLength={80}
            autoComplete="off" name="setor-nome-randomx1" spellCheck={false}
            onChange={e => setNome(e.target.value)} onKeyDown={handleKey}
            placeholder="Ex: Recepção, Financeiro, TI…" />
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

// ─── Contas (CRUD de admins do TI e usuarios do portal) ─────────────────────
function ContasPanel({ isMobile }) {
  const [subAba, _setSubAba] = useState(() => {
    try { return sessionStorage.getItem('hub_contas_subaba') || 'usuarios'; } catch { return 'usuarios'; }
  });
  const setSubAba = (v) => { try { sessionStorage.setItem('hub_contas_subaba', v); } catch {} _setSubAba(v); };
  const [statusAba, _setStatusAba] = useState(() => {
    try { return sessionStorage.getItem('hub_contas_status') || 'ativos'; } catch { return 'ativos'; }
  });
  const setStatusAba = (v) => { try { sessionStorage.setItem('hub_contas_status', v); } catch {} _setStatusAba(v); };
  const [admins, setAdmins] = useState(null);
  const [usuarios, setUsuarios] = useState(null);
  const [setoresLista, setSetoresLista] = useState([]);
  const [etiquetasLista, setEtiquetasLista] = useState([]);
  const [busca, setBusca] = useState('');
  const [editing, setEditing] = useState(null); // { tipo, id, dados, etiquetas? }
  const [creating, setCreating] = useState(null); // 'admin' | 'usuario'
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');
  const [historicoUsuario, setHistoricoUsuario] = useState(null); // { id, nome }
  const [resetandoSenha, setResetandoSenha] = useState({}); // { tipo-id: true } — loading por card
  const [confirmAtivo, setConfirmAtivo] = useState(null); // { tipo, row, ativar:boolean }
  const [togglingAtivo, setTogglingAtivo] = useState(false);

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
        ramal: row.ramal || '', is_master: !!row.is_master,
        senha: '', ativo: !!row.ativo,
      }});
    } else {
      setEditing({ tipo, id: row.id, dados: {
        nome: row.nome, email: row.email || '', setor: row.setor || '',
        ramal: row.ramal || '', senha: '', ativo: row.ativo !== 0,
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
      notify(tipo === 'admin' ? 'Admin criado.' : 'Usuário criado.');
      fecharModal();
      if (tipo === 'admin') loadAdmins(); else loadUsuarios();
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
      ? ['nome_completo', 'email', 'ramal', 'is_master', 'ativo']
      : ['nome', 'email', 'setor', 'ramal', 'ativo'];
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
  // Filtro de busca: nome, email, login, ramal, setor + flags (master, inativo).
  // Multiplas palavras separadas por espaco viram AND (toda token precisa bater).
  const tokens = busca.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wantAtivo = statusAba === 'ativos';
  function matchToken(r, t) {
    if (t === 'master' && isAdmin) return !!r.is_master;
    if (t === 'inativo') return !(isAdmin ? r.ativo === 1 : r.ativo !== 0);
    const campos = [
      isAdmin ? r.nome_completo : r.nome,
      r.email,
      r.usuario,
      r.ramal,
      r.setor,
    ].filter(Boolean).map(s => String(s).toLowerCase());
    return campos.some(c => c.includes(t));
  }
  const filtrada = (lista || [])
    .filter(r => {
      const ativo = isAdmin ? r.ativo === 1 : r.ativo !== 0;
      if (wantAtivo !== ativo) return false;
      if (!tokens.length) return true;
      return tokens.every(t => matchToken(r, t));
    })
    .slice()
    .sort((a, b) => {
      const nomeA = (isAdmin ? a.nome_completo : a.nome) || '';
      const nomeB = (isAdmin ? b.nome_completo : b.nome) || '';
      return nomeA.localeCompare(nomeB, 'pt-BR', { sensitivity: 'base' });
    });
  const totalAtivos = (lista || []).filter(r => isAdmin ? r.ativo === 1 : r.ativo !== 0).length;
  const totalInativos = (lista || []).filter(r => isAdmin ? r.ativo === 0 : r.ativo === 0).length;

  const cs = {
    bg: HUB_PALETTE.areiaDim + '0a',
    border: HUB_PALETTE.areiaDim + '33',
    input: { width: '100%', boxSizing: 'border-box', background: HUB_PALETTE.areiaDim + '0a', border: `1px solid ${HUB_PALETTE.areiaDim}33`, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', fontSize: 14, padding: '10px 14px', outline: 'none' },
    label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginBottom: 6, display: 'block' },
    btnPrim: { background: HUB_PALETTE.champanhe, color: HUB_PALETTE.noite, border: 'none', padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
    btnGhost: { background: 'transparent', color: HUB_PALETTE.marfim, border: `1px solid ${HUB_PALETTE.areiaDim}77`, padding: '12px 22px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  };

  return (<>
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />Contas
      </div>
      <h2 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: 40, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: '0 0 10px' }}>Gerenciar contas.</h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: HUB_PALETTE.areiaDim, lineHeight: 1.5, margin: 0 }}>
        Crie, edite ou desative admins do TI e usuários do portal de chamados. Os dados ficam no sistema-chamados; aqui é só a interface.
      </p>
    </div>

    {/* Sub-tabs tipo */}
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, marginBottom: 14 }}>
      {[{ id: 'admins', label: 'Admins do TI' }, { id: 'usuarios', label: 'Usuários do portal' }].map(s => (
        <button key={s.id} onClick={() => { setSubAba(s.id); setBusca(''); setStatusAba('ativos'); }}
          style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${subAba === s.id ? HUB_PALETTE.champanhe : 'transparent'}`, color: subAba === s.id ? HUB_PALETTE.champanhe : HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', padding: '10px 18px 8px', cursor: 'pointer' }}>
          {s.label}
        </button>
      ))}
    </div>
    {/* Sub-tabs status */}
    <div style={{ display: 'flex', gap: 18, marginBottom: 18 }}>
      {[{ id: 'ativos', label: 'Ativos', total: totalAtivos }, { id: 'inativos', label: 'Inativos', total: totalInativos }].map(s => (
        <button key={s.id} onClick={() => setStatusAba(s.id)}
          style={{ background: 'transparent', border: 'none', color: statusAba === s.id ? HUB_PALETTE.marfim : HUB_PALETTE.areiaDim, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: statusAba === s.id ? 600 : 400, padding: '4px 0', cursor: 'pointer', borderBottom: `1px solid ${statusAba === s.id ? HUB_PALETTE.champanhe + '88' : 'transparent'}` }}>
          {s.label} <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: HUB_PALETTE.areiaDim, marginLeft: 4 }}>{s.total}</span>
        </button>
      ))}
    </div>

    {/* Toolbar */}
    <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={HUB_PALETTE.areiaDim} strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Filtrar por nome, email, login, ramal, setor..." value={busca} onChange={e => setBusca(e.target.value)}
          autoComplete="off" name="contas-busca-livre"
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
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 16, color: HUB_PALETTE.areiaDim, padding: '40px 0' }}>Nenhum registro.</div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
        {filtrada.map(row => {
          const ativo = isAdmin ? row.ativo === 1 : row.ativo !== 0;
          const key = (isAdmin ? 'a' : 'u') + row.id;
          const resetando = !!resetandoSenha[key];
          return (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 4px', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`, opacity: ativo ? 1 : 0.55, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 17, color: HUB_PALETTE.marfim, fontWeight: 600, lineHeight: 1.3 }}>
                  {isAdmin ? row.nome_completo : row.nome}
                  {isAdmin && row.is_master ? <span style={{ marginLeft: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, padding: '3px 10px', border: `1px solid ${HUB_PALETTE.champanhe}88`, verticalAlign: 'middle' }}>Master</span> : null}
                  {!ativo ? <span style={{ marginLeft: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#E07A5F', padding: '3px 10px', border: '1px solid #E07A5F66', verticalAlign: 'middle' }}>Inativo</span> : null}
                </div>
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 14, color: HUB_PALETTE.areia, marginTop: 6, lineHeight: 1.5 }}>
                  {row.email ? <span style={{ color: HUB_PALETTE.marfim }}>{row.email}</span> : '—'}
                  {row.setor ? <span style={{ color: HUB_PALETTE.areiaDim }}> · </span> : null}
                  {row.setor ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 6 }}>setor</span>{row.setor}</span> : null}
                  {row.ramal ? <span style={{ color: HUB_PALETTE.areiaDim }}> · </span> : null}
                  {row.ramal ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 6 }}>ramal</span>{row.ramal}</span> : null}
                  {isAdmin && row.usuario ? <span style={{ color: HUB_PALETTE.areiaDim }}> · </span> : null}
                  {isAdmin && row.usuario ? <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, marginRight: 6 }}>login</span>{row.usuario}</span> : null}
                </div>
              </div>
              <button onClick={() => setHistoricoUsuario({ id: row.id, nome: isAdmin ? row.nome_completo : row.nome, tipo: isAdmin ? 'admin' : 'usuario' })} style={cs.btnGhost}>Histórico</button>
              <button onClick={() => startEdit(isAdmin ? 'admin' : 'usuario', row)} style={cs.btnGhost}>Editar</button>
              <button
                onClick={() => enviarLinkReset(isAdmin ? 'admin' : 'usuario', row.id)}
                disabled={resetando || !row.email}
                title={!row.email ? 'Sem e-mail cadastrado' : 'Enviar link de redefinição de senha por e-mail (válido 24h)'}
                style={{ ...cs.btnGhost, color: resetando ? HUB_PALETTE.areiaDim : HUB_PALETTE.jangada, borderColor: HUB_PALETTE.jangada + '66', cursor: resetando || !row.email ? 'not-allowed' : 'pointer' }}>
                {resetando ? '…' : 'Redefinir senha'}
              </button>
              {ehEuMesmo(isAdmin ? 'admin' : 'usuario', row) ? (
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
          );
        })}
      </div>
    )}

    {/* Modal Criar */}
    {creating && (
      <ContaForm tipo={creating} isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        setores={setoresLista} etiquetas={etiquetasLista}
        onCancel={fecharModal}
        onSave={(dados) => salvarNovo(creating, dados)} />
    )}

    {/* Modal Editar */}
    {editing && (
      <ContaForm tipo={editing.tipo} isMobile={isMobile} cs={cs} erro={erro} saving={saving}
        setores={setoresLista} etiquetas={etiquetasLista}
        initial={editing.dados} initialEtiquetas={editing.etiquetas} isEdit
        ehEuMesmo={editing.tipo === 'admin' && !!editing.dados && (editing.dados.email || '').toLowerCase() === meuEmail}
        onCancel={fecharModal}
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
          <div style={{ background: HUB_PALETTE.noite, border: `1px solid ${HUB_PALETTE.areiaDim}33`, maxWidth: 460, width: '100%', padding: isMobile ? '24px 20px' : '32px 36px' }}>
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
  </>);
}

function ContaForm({ tipo, isMobile, cs, erro, saving, initial, initialEtiquetas, isEdit, ehEuMesmo, setores, etiquetas, onCancel, onSave }) {
  const [d, setD] = useState(initial || (tipo === 'admin'
    ? { nome_completo: '', email: '', ramal: '', is_master: false, senha: '' }
    : { nome: '', email: '', setor: '', ramal: '', senha: '' }));
  const [showSenha, setShowSenha] = useState(false);
  const [etSel, setEtSel] = useState(new Set(initialEtiquetas || []));
  const [etBusca, setEtBusca] = useState('');
  const [erroLocal, setErroLocal] = useState('');
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const isAdmin = tipo === 'admin';

  // Validacao de setor: precisa bater com a lista oficial. Permite preservar valor legado na edicao.
  // API retorna {id, nome}; mantemos fallback p/ s.name caso o contrato mude.
  const setorNome = s => (s && (s.nome ?? s.name)) || '';
  const setoresNames = (setores || []).map(setorNome);
  const setorAtualOriginal = (initial && initial.setor) || '';
  const setorLegado = !isAdmin && !!setorAtualOriginal && !setoresNames.includes(setorAtualOriginal);
  const semListaSetores = !isAdmin && setoresNames.length === 0;

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

  // Forca de senha (5 criterios)
  const senhaScore = (() => {
    const s = d.senha || '';
    if (!s) return null;
    let n = 0;
    if (s.length >= 8) n++;
    if (/[A-Z]/.test(s)) n++;
    if (/[a-z]/.test(s)) n++;
    if (/[0-9]/.test(s)) n++;
    if (/[^A-Za-z0-9]/.test(s)) n++;
    return n;
  })();
  const senhaCor = senhaScore == null ? null : ['#e53935', '#e53935', '#fb8c00', '#fdd835', '#7cb342', '#43a047'][senhaScore];
  const senhaLabel = senhaScore == null ? null : ['Muito fraca', 'Fraca', 'Média', 'Boa', 'Forte', 'Excelente'][senhaScore];

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

        <label style={cs.label}>Nome</label>
        <input style={cs.input} value={isAdmin ? d.nome_completo : d.nome}
          autoComplete="off" name="conta-nome-randoma1b2" spellCheck={false}
          onChange={e => set(isAdmin ? 'nome_completo' : 'nome', e.target.value)} />

        <label style={{ ...cs.label, marginTop: 14 }}>E-mail</label>
        <input style={cs.input} type="text" value={d.email}
          autoComplete="off" name="conta-email-randomc3d4" spellCheck={false} inputMode="email"
          onChange={e => set('email', e.target.value)} placeholder="usuario@granmarquise.com.br" />

        {!isAdmin && (<>
          <label style={{ ...cs.label, marginTop: 14 }}>Setor</label>
          <div ref={setorWrapRef} style={{ position: 'relative' }}>
            <input style={cs.input} type="text" value={d.setor || ''}
              autoComplete="off" name="conta-setor-randome5f6" spellCheck={false}
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
            <div style={{ marginTop: 6, fontFamily: 'Inter, sans-serif', fontSize: 11, color: HUB_PALETTE.areiaDim }}>
              Setor atual não está na lista oficial. Pode salvar como está ou escolher um setor válido.
            </div>
          )}
        </>)}

        <label style={{ ...cs.label, marginTop: 14 }}>Ramal {!isAdmin && <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(4 dígitos)</span>}</label>
        <input style={cs.input} value={d.ramal}
          autoComplete="off" name="conta-ramal-randomg7h8" inputMode="numeric"
          onChange={e => set('ramal', e.target.value)} maxLength={isAdmin ? 20 : 4} />

        <label style={{ ...cs.label, marginTop: 14 }}>Senha {isEdit && <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .6 }}>(altere para definir uma nova)</span>}</label>
        <div style={{ position: 'relative' }}>
          <input style={{ ...cs.input, paddingRight: 56 }} type={showSenha ? 'text' : 'password'} value={d.senha}
            autoComplete="new-password" name="conta-senha-randomi9j0" spellCheck={false}
            onChange={e => set('senha', e.target.value)}
            placeholder="Mín. 8 com maiúscula, minúscula, número e especial" />
          <button type="button" onClick={() => setShowSenha(v => !v)}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: HUB_PALETTE.areiaDim, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}>
            {showSenha ? 'ocultar' : 'ver'}
          </button>
        </div>
        {senhaScore != null && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 3, background: HUB_PALETTE.areiaDim + '33', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${(senhaScore / 5) * 100}%`, height: '100%', background: senhaCor, transition: 'width 200ms, background 200ms' }} />
            </div>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: senhaCor }}>{senhaLabel}</span>
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
          <button type="button" onClick={handleSave} disabled={saving || (semListaSetores && !setorLegado)} style={cs.btnPrim}>
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
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe }}>Histórico</div>
            <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 22, color: HUB_PALETTE.marfim, marginTop: 4 }}>{nome}</div>
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
              {chamados.map(c => (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px 0', borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: HUB_PALETTE.champanhe }}>#{c.id}</span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: HUB_PALETTE.marfim, fontWeight: 500 }}>{c.descricao ? c.descricao.slice(0, 80) : 'Sem descrição'}{c.descricao && c.descricao.length > 80 ? '…' : ''}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim, border: `1px solid ${HUB_PALETTE.areiaDim}44`, padding: '2px 8px' }}>{c.status}</span>
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim, marginTop: 4 }}>
                    Criado em {fmtData(c.criado_em)}{c.categoria ? ` · ${c.categoria}` : ''}
                  </div>
                </div>
              ))}
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

function HubHeader({ theme, onToggleTheme, isMobile, userName, userTipo, onLogout, onOpenAdmin }) {
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
          {!isMobile && primeiroNome && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: HUB_PALETTE.areiaDim }}>{primeiroNome}</span>}

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
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.4em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(12px)', transition: `all 900ms ${HUB_EASE}`, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
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
      <div style={{ position: 'absolute', right: 48, top: 88, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'italic', fontSize: 12, color: HUB_PALETTE.champanhe, letterSpacing: '0.04em', opacity: easterActive ? 0.6 : 0, transform: easterActive ? 'translateY(0)' : 'translateY(-6px)', transition: `all 800ms ${HUB_EASE}`, pointerEvents: 'none', display: typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'block' }}>
        em homenagem ao painel de 1992
      </div>
    </section>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, label }) {
  if (status === 'no-ar') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, animation: `hubPulse 2200ms ${HUB_EASE} infinite` }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow }}>{label}</span>
      </span>
    );
  }
  const color = status === 'construcao' ? HUB_PALETTE.champanhe : status === 'beta' ? HUB_PALETTE.areia : HUB_PALETTE.areiaDim;
  const glyph = status === 'construcao' ? '○' : status === 'beta' ? '◐' : '◇';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, fontSize: 11 }}>{glyph}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color }}>{label}</span>
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
    if (system.adminUrl) {
      const isAdmin = (system.adminEmails || []).includes(userEmail);
      if (isAdmin) destUrl = system.adminUrl;
    }
    // Propaga o tema atual para que o destino abra no mesmo modo (claro/escuro).
    const themeAtual = (() => {
      try { return localStorage.getItem('gm-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
    })();
    let url;
    if (token) {
      const destPath = destUrl.slice(system.url.length) || '/';
      const nextParam = destPath !== '/' ? `&next=${encodeURIComponent(destPath)}` : '';
      url = `${system.url}/sso?sso_token=${encodeURIComponent(token)}${nextParam}&theme=${themeAtual}`;
    } else {
      const sep = destUrl.includes('?') ? '&' : '?';
      url = `${destUrl}${sep}theme=${themeAtual}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <a href={system.url} onClick={handleOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'block', padding: isMobile ? '20px 18px 22px' : '28px 32px 30px', textDecoration: 'none', color: 'inherit', opacity: revealed ? 1 : 0, transform: !revealed ? 'translateY(28px)' : hover && !disabled ? 'translateY(-4px)' : 'translateY(0)', transition: `opacity 900ms ${HUB_EASE} ${index * 110}ms, transform ${hover && revealed && !disabled ? 500 : 900}ms ${HUB_EASE} ${index * 110}ms, background 500ms ${HUB_EASE}, box-shadow 550ms ${HUB_EASE}`, background: hover && !disabled ? HUB_PALETTE.panelHover : 'transparent', boxShadow: hover && !disabled ? `0 20px 44px -10px rgba(0,0,0,0.38), 0 0 0 1px ${HUB_PALETTE.linkAbrir}28` : 'none', cursor: disabled ? 'not-allowed' : 'pointer', overflow: 'hidden', zIndex: hover && !disabled ? 2 : 1 }}>
      <span style={{ position: 'absolute', top: 0, left: 0, height: 1, width: hover ? '100%' : '0%', background: HUB_PALETTE.linkAbrir, transition: `width 900ms ${HUB_EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px 20px', marginBottom: 18 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase' }}>{system.categoria}</span>
        <span style={{ flexShrink: 0 }}><StatusBadge status={system.status} label={system.statusLabel} /></span>
      </div>
      <h3 style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 300, fontSize: isMobile ? 24 : 30, lineHeight: 1.05, letterSpacing: '-0.018em', color: HUB_PALETTE.marfim, margin: '0 0 6px' }}>{system.nome}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.28em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase' }}>Para</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 500, color: HUB_PALETTE.champanhe, letterSpacing: '-0.005em' }}>{system.paraQuem}</span>
      </div>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.55, letterSpacing: '-0.005em', color: HUB_PALETTE.areia, margin: '0 0 22px' }}>{system.descricao}</p>
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
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, display: 'flex', alignItems: 'center', gap: 12 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areiaDim }}>
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
  const seqRef = useRef('');
  const isMobile = useWindowWidth() < 768;

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
  const NEXT_ALLOWED_ORIGINS = [
    'https://sistema-chamados-granmarquise.fly.dev',
    'https://diretorio-ramais-granmarquise.fly.dev',
    'https://pesquisa-satisfacao.fly.dev',
  ];

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
      '@keyframes hubPulse{0%{box-shadow:0 0 0 0 rgba(62,132,151,.55)}65%{box-shadow:0 0 0 10px rgba(62,132,151,0)}100%{box-shadow:0 0 0 0 rgba(62,132,151,0)}}',
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
    es.addEventListener('permissions', e => {
      const { sistemas: s } = JSON.parse(e.data);
      setSistemas(s);
    });
    return () => es.close();
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
            userTipo={userTipo}
            onLogout={handleLogout}
            onOpenAdmin={() => setShowAdmin(true)}
          />
          <main style={{ position: 'relative' }}>
            <HubDecoration />
            <HubHero revealed={revealed} easterActive={easter} isMobile={isMobile} userName={userName} sistemasVisiveis={sistemasVisiveis} />
            <section style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px 18px 36px' : '12px 48px 48px' }}>
              <SectionLabel kicker="No ar" title="Pronto para usar." hint={isMobile ? null : 'Clique no painel para abrir o sistema em uma aba nova.'} />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(420px, 1fr))', gap: 0, borderTop: `1px solid ${HUB_PALETTE.areiaDim}2a` }}>
                {sistemasVisiveis.map((sys, i, arr) => (
                  <div key={sys.id} style={{ borderBottom: `1px solid ${HUB_PALETTE.areiaDim}2a`, borderRight: !isMobile && arr.length > 1 && i % 2 === 0 ? `1px solid ${HUB_PALETTE.areiaDim}2a` : 'none' }}>
                    <SystemPanel system={sys} index={i} revealed={revealed} isMobile={isMobile} userEmail={userEmail} userTipo={userTipo} />
                  </div>
                ))}
              </div>
            </section>
            <HubFooter easterActive={easter} isMobile={isMobile} />
          </main>
        </>
      )}
    </div>
  );
}

Object.assign(window, { HubMarquise });
