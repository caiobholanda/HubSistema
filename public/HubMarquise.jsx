const { useState, useEffect, useRef } = React;

const HUB_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const HUB_THEMES = {
  dark: {
    noite: '#0A0E1A',
    noiteAlt: '#0D1322',
    champanhe: '#C9A961',
    dourado: '#B8924A',
    marfim: '#F5F0E6',
    areia: '#D4C4A0',
    areiaDim: '#8A7E64',
    jangada: '#2A5A6B',
    jangadaGlow: '#3E8497',
    panelHover: 'rgba(255,255,255,0.012)',
    previewBg: 'rgba(255,255,255,0.015)',
    headerBg: 'rgba(10, 14, 26, 0.72)',
    grainOpacity: 0.025,
    grainBlend: 'overlay',
  },
  light: {
    noite: '#F4EEE1',
    noiteAlt: '#EBE3D2',
    champanhe: '#8A6B1F',
    dourado: '#6B531A',
    marfim: '#1C2030',
    areia: '#44402F',
    areiaDim: '#605738',
    jangada: '#175F4F',
    jangadaGlow: '#15705A',
    panelHover: 'rgba(30,34,48,0.03)',
    previewBg: 'rgba(30,34,48,0.035)',
    headerBg: 'rgba(244, 238, 225, 0.82)',
    grainOpacity: 0.05,
    grainBlend: 'multiply',
  },
};

const HUB_PALETTE = { ...HUB_THEMES.dark };
function applyHubTheme(name) {
  Object.assign(HUB_PALETTE, HUB_THEMES[name] || HUB_THEMES.dark);
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
  id: 'cardapio',
  num: '02',
  categoria: 'Restaurantes · F&B',
  nome: 'Cardápio Digital',
  paraQuem: 'Mangostin e Mucuripe Grill',
  descricao: 'Cardápio dos restaurantes acessado por QR Code na mesa. A gerência atualiza preços e disponibilidade de pratos, e o hóspede vê tudo em tempo real, em três idiomas.',
  detalhe: 'Conectado ao sistema de gestão de alimentos e bebidas.',
  status: 'construcao',
  statusLabel: 'Em desenvolvimento',
  statusHint: 'Ainda não pronto para uso',
  url: '#',
  repo: null,
  stack: ['QR Code na mesa', 'Três idiomas', 'Atualização em tempo real'],
  preview: 'menu'
},
{
  id: 'ocupacao',
  num: '03',
  categoria: 'Operação · Hospedagem',
  nome: 'Painel de Ocupação',
  paraQuem: 'Recepção e Governança',
  descricao: 'Mapa visual dos 222 apartamentos do dia — quem fez check-in, quem sai hoje, quais estão em limpeza e quais estão bloqueados para manutenção. Tudo numa tela só.',
  detalhe: 'Conversa com o sistema de reservas atual automaticamente.',
  status: 'beta',
  statusLabel: 'Em testes',
  statusHint: 'Disponível só para a equipe-piloto',
  url: '#',
  repo: null,
  stack: ['Mapa visual dos quartos', 'Status em tempo real', 'Filtro por andar'],
  preview: 'rooms'
},
{
  id: 'predial',
  num: '04',
  categoria: 'Operação · Manutenção',
  nome: 'Manutenção Predial',
  paraQuem: 'Engenharia e Governança',
  descricao: 'Ordens de serviço para conserto e manutenção dos quartos, áreas comuns e instalações. Quem viu o problema registra; quem conserta recebe a ordem direto.',
  detalhe: 'Em conversa com o time de operações para definir o escopo.',
  status: 'concept',
  statusLabel: 'Em planejamento',
  statusHint: 'Ainda em estudo',
  url: '#',
  repo: null,
  stack: ['Ordens de serviço', 'Foto do problema', 'Histórico por quarto'],
  preview: 'maintenance'
}];


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
      <svg width="140" height="100" viewBox="0 0 140 100" fill="none" style={{ overflow: 'visible' }}>
        <path d="M 55 8 Q 8 8 8 50 Q 8 92 55 92 Q 70 92 70 80 L 70 55 L 40 55"
          stroke={HUB_PALETTE.champanhe} strokeWidth="1.2" fill="none" strokeLinecap="round"
          style={{ strokeDasharray: 260, strokeDashoffset: 260, animation: `hubDraw 1300ms ${HUB_EASE} forwards` }} />
        <path d="M 80 92 L 80 8 L 102 60 L 124 8 L 124 92"
          stroke={HUB_PALETTE.champanhe} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 320, strokeDashoffset: 320, animation: `hubDraw 1300ms ${HUB_EASE} 200ms forwards` }} />
      </svg>
      <div style={{
        marginTop: 32,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10, letterSpacing: '0.35em',
        color: HUB_PALETTE.areiaDim,
        textTransform: 'uppercase',
        opacity: 0,
        animation: `hubFadeIn 600ms ${HUB_EASE} 900ms forwards`
      }}>
        Gran Marquise · Sistemas
      </div>
    </div>
  );
}

function HubHeader({ theme, onToggleTheme }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(now);

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      backdropFilter: 'blur(10px)',
      background: HUB_PALETTE.headerBg,
      borderBottom: `1px solid ${HUB_PALETTE.areiaDim}22`
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none' }}>
          <svg width="22" height="16" viewBox="0 0 140 100" fill="none">
            <path d="M 55 8 Q 8 8 8 50 Q 8 92 55 92 Q 70 92 70 80 L 70 55 L 40 55" stroke={HUB_PALETTE.champanhe} strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M 80 92 L 80 8 L 102 60 L 124 8 L 124 92" stroke={HUB_PALETTE.champanhe} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: HUB_PALETTE.areia }}>
            Gran Marquise <span style={{ color: HUB_PALETTE.areiaDim, margin: '0 6px' }}>/</span> Hub
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.1em', color: HUB_PALETTE.marfim, fontVariantNumeric: 'tabular-nums' }}>{hora}</span>
          <button type="button" onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, background: 'transparent', border: `1px solid ${HUB_PALETTE.areiaDim}44`, borderRadius: '50%', color: HUB_PALETTE.champanhe, cursor: 'pointer', padding: 0, transition: `border-color 500ms ${HUB_EASE}` }}>
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a6.5 6.5 0 1 0 10.5 10.5z" /></svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function HubHero({ revealed, easterActive }) {
  const horaFortaleza = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', hour12: false }).format(new Date()), 10);
  const saudacao = horaFortaleza < 5 ? 'Boa madrugada, equipe Gran Marquise' : horaFortaleza < 12 ? 'Bom dia, equipe Gran Marquise' : horaFortaleza < 18 ? 'Boa tarde, equipe Gran Marquise' : 'Boa noite, equipe Gran Marquise';

  return (
    <section style={{ maxWidth: 1400, margin: '0 auto', padding: '56px 48px 40px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 56, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
        <div style={{ flex: '1 1 540px', minWidth: 0 }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.4em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(12px)', transition: `all 900ms ${HUB_EASE}`, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 28, height: 1, background: HUB_PALETTE.champanhe, display: 'inline-block' }} />
            {saudacao}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 'clamp(48px, 6.4vw, 92px)', lineHeight: 0.98, letterSpacing: '-0.025em', color: HUB_PALETTE.marfim, margin: 0, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(24px)', transition: `all 1100ms ${HUB_EASE} 120ms` }}>
            <span style={{ display: 'block', color: HUB_PALETTE.areia }}>Hub de sites</span>
            <span style={{ display: 'block', fontStyle: 'italic', fontWeight: 300, color: HUB_PALETTE.marfim }}>Gran Marquise.</span>
          </h1>
          <p style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 19, lineHeight: 1.4, color: HUB_PALETTE.areia, maxWidth: 460, margin: '32px 0 0', letterSpacing: '-0.005em', opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(16px)', transition: `all 1100ms ${HUB_EASE} 320ms` }}>
            Bem-vindo. Aqui ficam os sistemas que a equipe do hotel já pode usar no dia a dia.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, paddingLeft: 32, borderLeft: `1px solid ${HUB_PALETTE.champanhe}55`, opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(16px)', transition: `all 1100ms ${HUB_EASE} 420ms` }}>
          <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 64, lineHeight: 1, color: HUB_PALETTE.champanhe, fontVariantNumeric: 'tabular-nums' }}>01</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, animation: `hubPulse 2200ms ${HUB_EASE} infinite` }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow }}>Em operação</span>
            </div>
            <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontStyle: 'italic', fontSize: 16, lineHeight: 1.3, color: HUB_PALETTE.areia, letterSpacing: '-0.005em', maxWidth: 200 }}>Disponível para toda a equipe.</span>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 48, top: 88, fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: 12, color: HUB_PALETTE.champanhe, letterSpacing: '0.04em', opacity: easterActive ? 0.6 : 0, transform: easterActive ? 'translateY(0)' : 'translateY(-6px)', transition: `all 800ms ${HUB_EASE}`, pointerEvents: 'none' }}>
        em homenagem ao painel de 1992
      </div>
    </section>
  );
}

function StatusBadge({ status, label }) {
  if (status === 'no-ar') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: HUB_PALETTE.jangadaGlow, boxShadow: `0 0 0 0 ${HUB_PALETTE.jangadaGlow}`, animation: `hubPulse 2200ms ${HUB_EASE} infinite` }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: HUB_PALETTE.jangadaGlow }}>{label}</span>
      </span>
    );
  }
  const color = status === 'construcao' ? HUB_PALETTE.champanhe : status === 'beta' ? HUB_PALETTE.areia : HUB_PALETTE.areiaDim;
  const glyph = status === 'construcao' ? '○' : status === 'beta' ? '◐' : '◇';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, fontSize: 11, lineHeight: 1 }}>{glyph}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color }}>{label}</span>
    </span>
  );
}

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
  if (kind === 'menu') {
    return (
      <svg viewBox="0 0 240 140" width="100%" height="100%" preserveAspectRatio="none">
        <text x="20" y="30" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="13" fill={HUB_PALETTE.champanhe}>Mangostin</text>
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

function SystemPanel({ system, index, revealed }) {
  const [hover, setHover] = useState(false);
  const disabled = system.url === '#';

  return (
    <a href={system.url} target={disabled ? undefined : '_blank'} rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => { if (disabled) e.preventDefault(); }}
      style={{ position: 'relative', display: 'block', padding: '28px 32px 30px', textDecoration: 'none', color: 'inherit', opacity: revealed ? 1 : 0, transform: !revealed ? 'translateY(28px)' : hover && !disabled ? 'translateY(-4px)' : 'translateY(0)', transition: `opacity 900ms ${HUB_EASE} ${index * 110}ms, transform ${hover && revealed && !disabled ? 500 : 900}ms ${HUB_EASE} ${index * 110}ms, background 500ms ${HUB_EASE}, box-shadow 550ms ${HUB_EASE}`, background: hover && !disabled ? HUB_PALETTE.panelHover : 'transparent', boxShadow: hover && !disabled ? `0 20px 44px -10px rgba(0,0,0,0.38), 0 0 0 1px ${HUB_PALETTE.champanhe}28` : 'none', cursor: disabled ? 'not-allowed' : 'pointer', overflow: 'hidden', zIndex: hover && !disabled ? 2 : 1 }}>
      <span style={{ position: 'absolute', top: 0, left: 0, height: 1, width: hover ? '100%' : '0%', background: HUB_PALETTE.champanhe, transition: `width 900ms ${HUB_EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.28em', color: HUB_PALETTE.areiaDim, textTransform: 'uppercase' }}>{system.categoria}</span>
        <StatusBadge status={system.status} label={system.statusLabel} />
      </div>
      <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.018em', color: HUB_PALETTE.marfim, margin: '0 0 6px' }}>{system.nome}</h3>
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
        <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 19, lineHeight: 1.2, letterSpacing: '-0.01em', color: disabled ? HUB_PALETTE.areiaDim : HUB_PALETTE.champanhe, display: 'inline-flex', alignItems: 'baseline', gap: 12, paddingBottom: 5, borderBottom: `1px solid ${disabled ? HUB_PALETTE.areiaDim + '33' : (hover ? HUB_PALETTE.champanhe : HUB_PALETTE.champanhe + '40')}`, transition: `border-color 600ms ${HUB_EASE}` }}>
          {disabled ? 'Em breve' : `Abrir ${system.nome}`}
          {!disabled && <span style={{ display: 'inline-block', fontFamily: 'Inter, sans-serif', fontSize: 15, transform: hover ? 'translateX(10px)' : 'translateX(0)', transition: `transform 700ms ${HUB_EASE}` }}>→</span>}
        </span>
      </div>
    </a>
  );
}

function SectionLabel({ kicker, title, hint }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, gap: 24, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.35em', textTransform: 'uppercase', color: HUB_PALETTE.champanhe, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 18, height: 1, background: HUB_PALETTE.champanhe }} />{kicker}
        </div>
        <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontStyle: 'italic', fontSize: 'clamp(34px, 4vw, 52px)', lineHeight: 1.02, letterSpacing: '-0.02em', color: HUB_PALETTE.marfim, margin: 0 }}>{title}</h2>
      </div>
      {hint && <div style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 14, color: HUB_PALETTE.areiaDim, maxWidth: 280, textAlign: 'right' }}>{hint}</div>}
    </div>
  );
}


function HubFooter({ easterActive }) {
  return (
    <footer style={{ maxWidth: 1400, margin: '0 auto', padding: '40px 48px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 32, flexWrap: 'wrap', borderTop: `1px solid ${HUB_PALETTE.areiaDim}1a` }}>
      <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 16, color: HUB_PALETTE.areiaDim, letterSpacing: '0.005em' }}>
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

function HubDecoration() {
  const ref = useRef(null);
  useEffect(() => {
    const onScroll = () => { if (ref.current) ref.current.style.transform = `translateY(${window.scrollY * 0.06}px)`; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div ref={ref} style={{ position: 'absolute', right: 0, top: 0, width: 1, height: 600, background: `linear-gradient(180deg, transparent 0%, ${HUB_PALETTE.champanhe}66 30%, ${HUB_PALETTE.champanhe}10 100%)`, pointerEvents: 'none' }} />;
}

function HubMarquise() {
  const [booting, setBooting] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [easter, setEaster] = useState(false);
  const [theme, setTheme] = useState('light');
  const seqRef = useRef('');

  applyHubTheme(theme);

  useEffect(() => {
    if (document.getElementById('hub-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'hub-keyframes';
    s.textContent = [
      '@keyframes hubDraw{to{stroke-dashoffset:0}}',
      '@keyframes hubFadeIn{to{opacity:1}}',
      '@keyframes hubPulse{',
      '0%{box-shadow:0 0 0 0 rgba(62,132,151,.55)}',
      '65%{box-shadow:0 0 0 10px rgba(62,132,151,0)}',
      '100%{box-shadow:0 0 0 0 rgba(62,132,151,0)}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    document.body.style.background = HUB_PALETTE.noite;
    document.body.style.transition = `background 1200ms ${HUB_EASE}`;
    document.body.style.setProperty('--grain-opacity', String(HUB_PALETTE.grainOpacity));
    document.body.style.setProperty('--grain-blend', HUB_PALETTE.grainBlend);
  }, [theme]);

  useEffect(() => {
    if (!booting) {
      const t = setTimeout(() => setRevealed(true), 80);
      return () => clearTimeout(t);
    }
  }, [booting]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key && e.key.length === 1) {
        seqRef.current = (seqRef.current + e.key.toUpperCase()).slice(-2);
        if (seqRef.current === 'GM') setEaster((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div id="top" style={{ minHeight: '100vh', background: easter ? `radial-gradient(ellipse at 70% -10%, ${HUB_PALETTE.jangada}22, transparent 50%), ${HUB_PALETTE.noite}` : HUB_PALETTE.noite, color: HUB_PALETTE.marfim, fontFamily: 'Inter, sans-serif', transition: `background 1200ms ${HUB_EASE}`, position: 'relative', overflow: 'hidden' }}>
      {booting && <HubBoot onDone={() => setBooting(false)} />}
      <HubHeader theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
      <main style={{ position: 'relative' }}>
        <HubDecoration />
        <HubHero revealed={revealed} easterActive={easter} />
        <section style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 48px 48px' }}>
          <SectionLabel kicker="No ar" title="Pronto para usar." hint="Clique no painel para abrir o sistema em uma aba nova." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 0, borderTop: `1px solid ${HUB_PALETTE.areiaDim}2a` }}>
            {HUB_SYSTEMS.filter(s => s.status === 'no-ar').map((sys, i, arr) => (
              <div key={sys.id} style={{ borderBottom: `1px solid ${HUB_PALETTE.areiaDim}2a`, borderRight: arr.length > 1 && i % 2 === 0 ? `1px solid ${HUB_PALETTE.areiaDim}2a` : 'none' }}>
                <SystemPanel system={sys} index={i} revealed={revealed} />
              </div>
            ))}
          </div>
        </section>
        <HubFooter easterActive={easter} />
      </main>
    </div>
  );
}

Object.assign(window, { HubMarquise });
