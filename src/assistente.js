// Motor de resposta do Assistente de TI do Hub — 100% local, sem chamada de LLM.
//
// Substitui a cadeia de `if (/regex/.test(msg))` que respondia pelo primeiro
// padrao encontrado na mensagem crua. Aqui a pergunta passa por normalizacao
// (acentos, giria, digitacao), vira um conjunto de radicais, e cada intencao é
// pontuada; a de maior score responde — com dados reais do Hub (sistemas do
// usuario, ramais, status, novidades) quando a sessao permite.

// ─── 1. Normalizacao ─────────────────────────────────────────────────────────

// Giria/abreviacao que a equipe realmente digita no chat interno.
const _EXPANSOES = {
  vc: 'voce', vcs: 'voces', pq: 'porque', pqp: 'porque', tb: 'tambem', tbm: 'tambem',
  q: 'que', qnd: 'quando', qdo: 'quando', qto: 'quanto', qm: 'quem',
  n: 'nao', naum: 'nao', nn: 'nao', num: 'nao', ss: 'sim',
  blz: 'beleza', vlw: 'valeu', obg: 'obrigado', obgd: 'obrigado', brigado: 'obrigado',
  pfv: 'por favor', pfvr: 'por favor', pf: 'por favor',
  hj: 'hoje', amanha: 'amanha', agr: 'agora', dps: 'depois',
  msg: 'mensagem', add: 'adicionar', config: 'configuracao', info: 'informacao',
  pc: 'computador', cpu: 'computador', note: 'notebook', maquina: 'computador',
  impressao: 'imprimir', printer: 'impressora', print: 'imprimir',
  net: 'internet', wi: 'wifi', fi: 'wifi', rede: 'rede',
  ti: 'ti', sistema: 'sistema', app: 'aplicativo',
  senha: 'senha', pass: 'senha', password: 'senha', login: 'login', logar: 'login',
  chamado: 'chamado', ticket: 'chamado', helpdesk: 'chamado', suporte: 'suporte',
  fone: 'telefone', tel: 'telefone', num: 'numero',
  gm: 'granmarquise', hotel: 'hotel',
  eh: 'e', ta: 'esta', tah: 'esta', to: 'estou', tow: 'estou', tava: 'estava',
  cade: 'onde', ond: 'onde', comu: 'como', komo: 'como',
};

// Palavras sem carga semantica — saem antes da pontuacao para nao inflar score.
const _STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela', 'para', 'pra', 'pro',
  'com', 'sem', 'sob', 'sobre', 'ate', 'apos', 'entre', 'e', 'ou', 'mas', 'porem',
  'que', 'quem', 'qual', 'quais', 'quando', 'onde', 'como', 'porque', 'porqu',
  'eu', 'tu', 'ele', 'ela', 'nos', 'voce', 'voces', 'eles', 'elas', 'me', 'te', 'se',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa',
  'este', 'esta', 'esse', 'essa', 'isso', 'isto', 'aquilo', 'aquele', 'aquela',
  'ser', 'estar', 'ter', 'haver', 'ir', 'fazer', 'poder', 'dever',
  'sou', 'sao', 'era', 'foi', 'vai', 'vou', 'estou', 'esta', 'tem', 'tenho', 'ha',
  'ja', 'ainda', 'mais', 'menos', 'muito', 'pouco', 'todo', 'toda', 'todos', 'todas',
  'aqui', 'ali', 'la', 'agora', 'hoje', 'sempre', 'nunca', 'so', 'tambem', 'entao',
  'ao', 'aos', 'as', 'dele', 'dela', 'num', 'numa', 'pelos', 'pelas', 'quer',
  'favor', 'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite',
]);

// Lixo de teste — quem testa o chat digita "teste teste teste".
const _RUIDO = /^(teste?s?|test|xxx+|asdf+|aaa+|zzz+|lorem|ipsum|abc|123+)$/;

function _semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizar(texto) {
  return _semAcento(texto)
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Corta plural e sufixos comuns; trunca em 6 para casar "configuracao"/"configurar".
function radical(t) {
  let r = String(t || '');
  if (r.length > 4) {
    r = r.replace(/(coes|aoes|oes|aes|ais|eis|ns)$/, 'ao')
         .replace(/(mente|acao|ando|endo|indo|ador|ivel|avel|ismo|ista)$/, '')
         .replace(/s$/, '');
  }
  return r.slice(0, 6);
}

function _tokens(texto) {
  return normalizar(texto)
    .split(' ')
    .filter(Boolean)
    .map(t => _EXPANSOES[t] || t)
    .filter(t => t.length > 1 && !_STOPWORDS.has(t) && !_RUIDO.test(t));
}

// Levenshtein com corte: so interessa saber se a distancia cabe no limite.
function _distancia(a, b, limite) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let melhor = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + custo);
      if (cur[j] < melhor) melhor = cur[j];
    }
    if (melhor > limite) return limite + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// Tolerancia proporcional: 1 erro a partir de 5 letras, 2 a partir de 8.
function _pareceIgual(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  const limite = n >= 8 ? 2 : 1;
  return _distancia(a, b, limite) <= limite;
}

// ─── 2. Analise da mensagem ──────────────────────────────────────────────────

function analisar(texto) {
  const limpo = normalizar(texto);
  const toks = _tokens(texto);
  const rads = toks.map(radical);
  return {
    original: String(texto || ''),
    limpo,
    tokens: toks,
    radicais: rads,
    conjunto: new Set(rads),
    curta: toks.length <= 2,
  };
}

// 1 = casou exato, 0.6 = casou com erro de digitacao, 0 = nao casou.
function _peso(rad, an) {
  if (an.conjunto.has(rad)) return 1;
  for (const r of an.conjunto) if (_pareceIgual(r, rad)) return 0.6;
  return 0;
}

// Termo pode ser palavra ou frase ("abrir chamado"): frase exige todas as partes.
function casaTermo(termo, an) {
  const partes = _tokens(termo);
  if (partes.length === 0) return 0;
  if (partes.length === 1) return _peso(radical(partes[0]), an);
  let soma = 0;
  for (const p of partes) {
    const w = _peso(radical(p), an);
    if (w === 0) return 0;
    soma += w;
  }
  return soma / partes.length;
}

// ─── 3. Entidades ────────────────────────────────────────────────────────────

// Apelidos que a equipe usa para cada sistema (o nome oficial muda, o apelido nao).
const APELIDOS_SISTEMA = {
  'chamados': ['chamado', 'chamados', 'ticket', 'helpdesk', 'suporte ti', 'sistema de chamados'],
  'ramais': ['ramal', 'ramais', 'contato', 'contatos', 'diretorio', 'telefone', 'lista telefonica', 'agenda'],
  'pesquisa-satisfacao': ['spa', 'pesquisa', 'satisfacao', 'anamnese', 'terapeuta', 'massagem', 'gran spa', 'escala do spa'],
  'gestao-de-qualidade': ['qualidade', 'gestao de qualidade', 'gq', 'auditoria', 'nao conformidade', 'checklist'],
  'hub': ['hub', 'portal', 'central', 'hub marquise', 'pagina inicial'],
};

const SETORES_CONHECIDOS = [
  'ti', 'recepcao', 'governanca', 'manutencao', 'reservas', 'eventos', 'financeiro',
  'rh', 'marketing', 'alimentos e bebidas', 'cozinha', 'restaurante', 'spa',
  'lavanderia', 'seguranca', 'compras', 'gerencia', 'comercial', 'qualidade',
];

function detectarSistema(an, sistemas) {
  const candidatos = [];
  for (const [id, apelidos] of Object.entries(APELIDOS_SISTEMA)) {
    let melhor = 0;
    for (const ap of apelidos) {
      const w = casaTermo(ap, an) * (_tokens(ap).length > 1 ? 1.4 : 1);
      if (w > melhor) melhor = w;
    }
    if (melhor > 0) candidatos.push({ id, peso: melhor });
  }
  // Nome cadastrado do sistema tambem conta (admin pode renomear).
  for (const s of (sistemas || [])) {
    const w = casaTermo(s.nome || '', an);
    if (w > 0) {
      const ja = candidatos.find(c => c.id === s.id);
      if (ja) ja.peso = Math.max(ja.peso, w * 1.2);
      else candidatos.push({ id: s.id, peso: w * 1.2 });
    }
  }
  candidatos.sort((a, b) => b.peso - a.peso);
  return candidatos[0] && candidatos[0].peso >= 0.6 ? candidatos[0].id : null;
}

function detectarSetor(an) {
  let melhor = null, peso = 0;
  for (const s of SETORES_CONHECIDOS) {
    const w = casaTermo(s, an);
    if (w > peso) { peso = w; melhor = s; }
  }
  return peso >= 0.6 ? melhor : null;
}

// ─── 4. Base de conhecimento do admin (custom_info + quick_replies) ──────────

// custom_info vira blocos recuperaveis: cada paragrafo/linha é um documento e a
// pergunta recupera o bloco mais parecido — antes, custom_info inteiro era
// despejado como ultimo recurso, mesmo sem relacao com a pergunta.
function _blocos(customInfo) {
  return String(customInfo || '')
    .split(/\n\s*\n|\n(?=[-•*\d]\s)|\n/)
    .map(b => b.trim())
    .filter(b => b.length >= 12)
    .slice(0, 60);
}

function _similaridade(an, texto) {
  const alvo = new Set(_tokens(texto).map(radical));
  if (alvo.size === 0 || an.conjunto.size === 0) return 0;
  let inter = 0;
  for (const r of an.conjunto) {
    if (alvo.has(r)) inter += 1;
    else { for (const a of alvo) if (_pareceIgual(a, r)) { inter += 0.6; break; } }
  }
  // Cobertura da pergunta pesa mais que o tamanho do bloco.
  return inter / Math.sqrt(an.conjunto.size * Math.min(alvo.size, 40));
}

function buscarQuickReply(an, quickReplies) {
  let melhor = null, score = 0;
  for (const qr of (quickReplies || [])) {
    const kws = String(qr.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    let s = 0;
    for (const k of kws) {
      const w = casaTermo(k, an) * (_tokens(k).length > 1 ? 1.5 : 1);
      if (w > s) s = w;
    }
    if (s > score) { score = s; melhor = qr; }
  }
  return score >= 0.6 ? { reply: melhor.reply, score } : null;
}

function buscarContexto(an, customInfo) {
  let melhor = null, score = 0;
  for (const b of _blocos(customInfo)) {
    const s = _similaridade(an, b);
    if (s > score) { score = s; melhor = b; }
  }
  return score >= 0.34 ? { texto: melhor, score } : null;
}

// ─── 5. Catalogo de intencoes ────────────────────────────────────────────────

const URL_HUB = 'hub-granmarquise.fly.dev';

function _listaSistemas(ctx) {
  const libs = new Set(ctx.sistemasLiberados || []);
  return (ctx.sistemas || [])
    .filter(s => s && s.status !== 'inativo')
    .map(s => ({ ...s, liberado: libs.has(s.id) }));
}

function _nomeCurto(ctx) {
  const n = ctx.usuario && ctx.usuario.nome;
  return n ? String(n).split(' ')[0] : '';
}

// Cada intencao: `chaves` (peso 3), `apoio` (peso 1), `frases` (peso 4),
// `veto` (zera se aparecer). `resposta(ctx, an)` pode retornar null para
// desistir e deixar a proxima intencao responder.
const INTENCOES = [
  {
    id: 'saudacao',
    chaves: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'eai', 'opa', 'hey'],
    apoio: ['tudo bem', 'como vai'],
    soCurta: true,
    resposta: (ctx) => {
      const n = _nomeCurto(ctx);
      return `${n ? `Oi, ${n}!` : 'Oi!'} Sou o assistente de TI do Hub. Posso ajudar com senha, acesso a sistema, chamado, ramal e o que estiver pegando no seu computador.`;
    },
    sugestoes: ['Quais sistemas tenho acesso?', 'Esqueci minha senha', 'Como abrir um chamado?'],
  },
  {
    id: 'agradecimento',
    chaves: ['obrigado', 'obrigada', 'valeu', 'agradecido', 'grato'],
    apoio: ['perfeito', 'otimo', 'show', 'beleza', 'entendi', 'ajudou', 'resolveu'],
    soCurta: true,
    resposta: () => 'Boa! Qualquer outra coisa é só chamar.',
    sugestoes: [],
  },
  {
    id: 'quem_e_voce',
    chaves: ['quem e voce', 'o que voce faz', 'voce e um robo', 'voce e humano', 'como funciona voce'],
    apoio: ['assistente', 'bot', 'robo', 'inteligencia artificial'],
    resposta: () => 'Sou o assistente do Hub — rodo aqui dentro mesmo, com o que a TI cadastrou sobre os sistemas do hotel. Sei explicar acesso, senha, chamado, ramal e os sistemas do Hub. O que eu não souber, te mando pro chamado com a categoria certa.',
    sugestoes: ['O que você sabe responder?', 'Falar com alguém do TI'],
  },
  {
    id: 'ajuda_menu',
    chaves: ['ajuda', 'o que voce sabe', 'o que posso perguntar', 'menu', 'opcoes'],
    apoio: ['duvida', 'nao sei o que perguntar'],
    resposta: () => 'Posso ajudar com:\n• Senha e login no Hub (esqueci, bloqueou, primeiro acesso)\n• Quais sistemas você tem acesso e como pedir mais\n• Abrir e acompanhar chamado de TI\n• Achar ramal de pessoa ou setor\n• Impressora, rede/wifi, computador lento, e-mail\n\nManda a dúvida do jeito que vier que eu entendo.',
    sugestoes: ['Quais sistemas tenho acesso?', 'Esqueci minha senha', 'Qual o ramal da recepção?'],
  },

  // ── Acesso / conta ──
  {
    id: 'senha_esqueci',
    chaves: ['esqueci senha', 'recuperar senha', 'resetar senha', 'redefinir senha', 'nao lembro senha', 'perdi senha'],
    apoio: ['senha', 'login', 'entrar', 'acessar'],
    veto: ['wifi', 'internet'],
    resposta: () => `Na tela de login do Hub clica em "Esqueci minha senha" e usa seu e-mail @granmarquise.com.br — chega um link no e-mail (olha o spam/lixo eletrônico, costuma cair lá).\n\nSe o link não chegar em uns minutos, abre um chamado na categoria "Acesso / Login" que a TI reseta na mão.`,
    sugestoes: ['Minha conta está bloqueada', 'Como abrir um chamado?'],
  },
  {
    id: 'senha_trocar',
    chaves: ['trocar senha', 'mudar senha', 'alterar senha', 'nova senha', 'senha forte', 'requisito de senha'],
    apoio: ['senha', 'segura'],
    veto: ['wifi'],
    resposta: () => 'A senha do Hub precisa de no mínimo 8 caracteres com maiúscula, minúscula, número e símbolo (ex: Hotel@2026).\n\nPra trocar, usa "Esqueci minha senha" na tela de login — o link do e-mail deixa você definir a nova.',
    sugestoes: ['Esqueci minha senha', 'Primeiro acesso ao Hub'],
  },
  {
    id: 'conta_bloqueada',
    chaves: ['conta bloqueada', 'usuario bloqueado', 'bloqueou', 'travou login', 'acesso negado', 'nao consigo entrar'],
    apoio: ['bloqueado', 'senha', 'login', 'errada', 'invalido'],
    resposta: () => 'Depois de várias tentativas erradas o Hub trava a conta por segurança. Espera alguns minutos e tenta de novo com calma — se continuar travado, abre um chamado em "Acesso / Login" com seu e-mail que a TI destrava na hora.',
    sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?'],
  },
  {
    id: 'primeiro_acesso',
    chaves: ['primeiro acesso', 'ativar conta', 'criar conta', 'nao tenho login', 'sou novo', 'funcionario novo', 'link de ativacao'],
    apoio: ['cadastro', 'ativacao', 'conta'],
    resposta: () => 'Conta nova é a TI que cria: você recebe um link de ativação no e-mail @granmarquise.com.br e define a senha por lá (o link expira, então usa no mesmo dia).\n\nNão recebeu? Pede pro seu gestor abrir um chamado em "Acesso / Login" com seu nome completo, setor e e-mail.',
    sugestoes: ['Requisitos da senha', 'Como abrir um chamado?'],
  },
  {
    id: 'email_corporativo',
    chaves: ['email corporativo', 'meu email', 'qual meu email', 'outlook', 'webmail', 'caixa de entrada'],
    apoio: ['email', 'mensagem', 'enviar', 'receber'],
    resposta: (ctx) => {
      const e = ctx.usuario && ctx.usuario.email;
      const base = e ? `Você está logado como ${e}.\n\n` : '';
      return `${base}O login do Hub é sempre o e-mail @granmarquise.com.br. Problema no e-mail em si (não recebe, não envia, Outlook pedindo senha) é chamado na categoria "Software" — descreve a mensagem de erro que aparece.`;
    },
    sugestoes: ['Como abrir um chamado?', 'Esqueci minha senha'],
  },

  // ── Sistemas / permissoes ──
  {
    id: 'meus_sistemas',
    chaves: ['quais sistemas tenho acesso', 'meus sistemas', 'sistemas disponiveis', 'o que tenho acesso', 'que sistemas existem', 'lista de sistemas'],
    apoio: ['sistema', 'acesso', 'liberado', 'disponivel', 'hub'],
    resposta: (ctx) => {
      const todos = _listaSistemas(ctx);
      if (todos.length === 0) return null;
      if (!ctx.usuario) {
        return `O Hub reúne: ${todos.map(s => s.nome).join(', ')}.\n\nEntra com seu e-mail @granmarquise.com.br que eu te digo exatamente quais estão liberados pra você — cada um aparece no Hub só pra quem tem permissão.`;
      }
      const lib = todos.filter(s => s.liberado);
      const nao = todos.filter(s => !s.liberado);
      if (lib.length === 0) {
        return `Não achei nenhum sistema liberado pro seu usuário ainda. Pede pro seu gestor abrir um chamado em "Permissão de Acesso" dizendo quais você precisa: ${nao.map(s => s.nome).join(', ')}.`;
      }
      let txt = `Você tem acesso a:\n${lib.map(s => `• ${s.nome} — ${s.descricao || s.categoria || ''}`.trim()).join('\n')}`;
      if (nao.length) txt += `\n\nSem acesso hoje: ${nao.map(s => s.nome).join(', ')}. Pra liberar, chamado em "Permissão de Acesso".`;
      return txt;
    },
    sugestoes: ['Como pedir acesso a um sistema?', 'Algum sistema fora do ar?'],
  },
  {
    id: 'pedir_acesso',
    chaves: ['pedir acesso', 'solicitar acesso', 'liberar acesso', 'permissao de acesso', 'nao tenho permissao', 'liberar sistema'],
    apoio: ['acesso', 'permissao', 'liberar', 'autorizar'],
    resposta: () => 'Acesso a sistema sai por chamado na categoria "Permissão de Acesso": diz qual sistema, pra quê você precisa e quem é seu gestor (a TI confirma com ele antes de liberar).\n\nAssim que liberar, o sistema aparece sozinho no seu Hub — não precisa nem sair e entrar de novo.',
    sugestoes: ['Como abrir um chamado?', 'Quais sistemas tenho acesso?'],
  },
  {
    id: 'sistema_especifico',
    chaves: [],
    apoio: ['sistema', 'acessar', 'entrar', 'link', 'endereco', 'url', 'onde fica', 'como uso', 'para que serve'],
    exigeSistema: true,
    resposta: (ctx, an) => {
      const id = detectarSistema(an, ctx.sistemas);
      if (!id) return null;
      if (id === 'hub') {
        return `O Hub (${URL_HUB}) é a porta de entrada: você entra uma vez com o e-mail @granmarquise.com.br e de lá abre os outros sistemas sem digitar senha de novo. Aparece só o que está liberado pro seu usuário.`;
      }
      const s = (ctx.sistemas || []).find(x => x.id === id);
      if (!s) return null;
      const liberado = (ctx.sistemasLiberados || []).includes(id);
      const partes = [`${s.nome}${s.descricao ? ` — ${s.descricao}` : ''}`];
      if (s.status && s.status !== 'no-ar') {
        partes.push(s.status === 'manutencao'
          ? 'No momento está em manutenção; se precisar com urgência, abre um chamado que a TI avisa quando voltar.'
          : 'Esse sistema está inativo no momento.');
      }
      if (ctx.usuario) {
        partes.push(liberado
          ? `Você já tem acesso: abre pelo card no Hub (${URL_HUB}) — o login vai junto, não pede senha de novo.`
          : `Você ainda não tem acesso. Pra liberar, chamado na categoria "Permissão de Acesso" dizendo que precisa do ${s.nome}.`);
      } else {
        partes.push(`Acessa pelo card no Hub (${URL_HUB}) — o acesso é liberado por setor/função.`);
      }
      return partes.join('\n\n');
    },
    sugestoes: ['Como pedir acesso a um sistema?', 'Quais sistemas tenho acesso?'],
  },
  {
    id: 'status_sistemas',
    chaves: ['fora do ar', 'esta no ar', 'sistema caiu', 'nao abre', 'nao carrega', 'esta funcionando', 'instabilidade', 'manutencao'],
    apoio: ['erro', 'lento', 'travando', 'sistema', 'site', 'pagina'],
    resposta: (ctx) => {
      const fora = _listaSistemas(ctx).filter(s => s.status && s.status !== 'no-ar');
      if (fora.length) {
        return `Fora do normal agora: ${fora.map(s => `${s.nome} (${s.status === 'manutencao' ? 'em manutenção' : s.status})`).join(', ')}.\n\nOs demais estão no ar. Se o seu problema é em outro sistema, abre um chamado descrevendo a tela e o horário que aconteceu.`;
      }
      return 'Pelo painel do Hub está tudo no ar agora. Se mesmo assim não abre pra você, tenta atualizar a página (Ctrl+F5) e conferir a internet — persistindo, abre um chamado com print da tela e o horário.';
    },
    sugestoes: ['Como abrir um chamado?', 'Minha internet está lenta'],
  },
  {
    id: 'novidades',
    chaves: ['novidade', 'novidades', 'o que mudou', 'atualizacao', 'changelog', 'versao nova', 'lancamento'],
    apoio: ['novo', 'mudou', 'atualizou'],
    resposta: (ctx) => {
      const ups = (ctx.updates || []).slice(0, 3);
      if (!ups.length) return 'Nenhuma atualização registrada por aqui ainda. Quando sai algo novo, aparece no sino de atualizações do Hub.';
      return `Últimas atualizações:\n${ups.map(u => `• ${u.sistemaNome || u.sistemaId}: ${u.titulo}`).join('\n')}\n\nO histórico completo fica no sino de atualizações, no topo do Hub.`;
    },
    sugestoes: ['Quais sistemas tenho acesso?'],
  },

  // ── Chamados ──
  {
    id: 'abrir_chamado',
    chaves: ['abrir chamado', 'novo chamado', 'como abro chamado', 'solicitar suporte', 'chamar ti', 'registrar problema'],
    apoio: ['chamado', 'suporte', 'ajuda', 'problema', 'ti'],
    resposta: () => 'No Hub abre o card "Chamados TI" → botão "Novo Chamado" → escolhe a categoria, descreve o problema e manda. Prazo de resposta: até 2h úteis.\n\nDica que acelera: diz onde você está (andar/setor), o que aparece na tela e desde quando acontece. Com print resolve mais rápido ainda.',
    sugestoes: ['Como acompanho meu chamado?', 'Quais categorias existem?'],
  },
  {
    id: 'acompanhar_chamado',
    chaves: ['acompanhar chamado', 'status do chamado', 'meu chamado', 'ja abri chamado', 'chamado sem resposta', 'demorando'],
    apoio: ['chamado', 'aberto', 'resposta', 'andamento', 'prazo'],
    resposta: () => 'Entra em "Chamados TI" no Hub — seus chamados ficam listados com o status (aberto, em andamento, resolvido) e o histórico de respostas.\n\nSe passou de 2h úteis sem retorno e é urgente, responde dentro do próprio chamado marcando como urgente ou liga pro ramal da TI.',
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
  {
    id: 'categorias_chamado',
    chaves: ['categoria de chamado', 'quais categorias', 'que categoria escolho', 'tipo de chamado'],
    apoio: ['categoria', 'chamado', 'classificar'],
    resposta: () => 'As categorias que a TI usa: Impressora/Periférico, Acesso/Login, Permissão de Acesso, Rede/Internet, Hardware e Software.\n\nNa dúvida escolhe a mais próxima e explica direito na descrição — a TI reclassifica se precisar.',
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'falar_humano',
    chaves: ['falar com alguem', 'falar com humano', 'atendente', 'pessoa de verdade', 'quero suporte humano', 'ramal da ti', 'telefone da ti'],
    apoio: ['ti', 'tecnico', 'analista', 'suporte'],
    resposta: (ctx) => {
      const ti = (ctx.usuarios || []).filter(u => normalizar(u.setor || '') === 'ti' && u.ramal);
      if (ti.length) {
        return `Fala com a TI direto:\n${ti.slice(0, 4).map(u => `• ${u.nome} — ramal ${u.ramal}`).join('\n')}\n\nSe ninguém atender, abre um chamado que fica registrado e alguém pega.`;
      }
      return 'Pra falar com uma pessoa da TI: procura o ramal da TI no Contatos Gran Marquise (dentro do Hub) ou abre um chamado — chamado é mais garantido porque fica registrado e alguém sempre pega.';
    },
    sugestoes: ['Como abrir um chamado?'],
  },

  // ── Ramais / pessoas ──
  {
    id: 'ramal',
    chaves: ['ramal', 'telefone', 'contato', 'numero de', 'como ligo', 'falar com setor', 'diretorio de ramais'],
    apoio: ['ligar', 'discar', 'numero', 'setor', 'pessoa'],
    resposta: (ctx, an) => {
      const setor = detectarSetor(an);
      const usuarios = ctx.usuarios || [];
      if (setor && usuarios.length) {
        const doSetor = usuarios.filter(u => normalizar(u.setor || '').startsWith(setor.slice(0, 5)) && u.ramal);
        if (doSetor.length) {
          return `Ramais de ${setor.toUpperCase()}:\n${doSetor.slice(0, 6).map(u => `• ${u.nome} — ${u.ramal}`).join('\n')}\n\nA lista completa fica no Contatos Gran Marquise, dentro do Hub.`;
        }
      }
      if (usuarios.length && !setor) {
        const nome = _procurarPessoa(an, usuarios);
        if (nome) return `${nome.nome}${nome.setor ? ` (${nome.setor})` : ''} — ramal ${nome.ramal}.`;
      }
      return `Abre o "Contatos Gran Marquise" no Hub e busca pelo nome da pessoa ou pelo setor — já aparece o ramal. É mais rápido que ligar pra recepção perguntar.${ctx.usuario ? '' : '\n\n(Entra no Hub com seu e-mail pra eu poder consultar o ramal direto aqui.)'}`;
    },
    sugestoes: ['Qual o ramal da TI?', 'Como abrir um chamado?'],
  },
  {
    id: 'meus_dados',
    chaves: ['meu ramal', 'meu setor', 'meus dados', 'meu perfil', 'meu cadastro', 'meu usuario'],
    apoio: ['perfil', 'cadastro', 'dados'],
    resposta: (ctx) => {
      const u = ctx.usuario;
      if (!u) return 'Entra no Hub com seu e-mail @granmarquise.com.br que eu te mostro seus dados de cadastro.';
      const linhas = [`Nome: ${u.nome || '—'}`, `E-mail: ${u.email}`];
      if (u.setor) linhas.push(`Setor: ${u.setor}`);
      if (u.ramal) linhas.push(`Ramal: ${u.ramal}`);
      linhas.push(`Perfil: ${u.tipo === 'admin' ? 'administrador' : 'usuário'}`);
      return `${linhas.join('\n')}\n\nSe algo aí estiver errado (setor, ramal, nome), abre um chamado que a TI corrige no cadastro.`;
    },
    sugestoes: ['Quais sistemas tenho acesso?', 'Como abrir um chamado?'],
  },

  // ── Problemas de TI ──
  {
    id: 'impressora',
    chaves: ['impressora', 'imprimir', 'toner', 'papel atolado', 'nao imprime', 'scanner', 'digitalizar'],
    apoio: ['fila de impressao', 'copia', 'multifuncional', 'cartucho'],
    resposta: () => 'Antes do chamado, dois testes que resolvem metade dos casos: confere se a impressora está ligada/com papel e manda imprimir de novo (às vezes o trabalho fica preso na fila — clica com o botão direito na impressora → "Ver o que está sendo impresso" → cancela tudo).\n\nSe não voltar, abre chamado em "Impressora / Periférico" dizendo o modelo e onde ela fica (andar e setor) — assim a TI já vai direto no equipamento.',
    sugestoes: ['Como abrir um chamado?', 'Preciso de um toner novo'],
  },
  {
    id: 'rede',
    chaves: ['internet', 'wifi', 'rede', 'sem conexao', 'sem internet', 'internet lenta', 'cabo de rede', 'sinal'],
    apoio: ['conectar', 'conexao', 'lento', 'caindo', 'desconecta'],
    resposta: () => 'Testa primeiro se é só no seu computador ou no setor inteiro (pergunta pro colega do lado). Se for só no seu: tira e recoloca o cabo de rede / desconecta e reconecta o wifi.\n\nContinua? Chamado em "Rede / Internet" dizendo o setor, se é em um ou em vários computadores e desde quando. Isso muda totalmente o diagnóstico.',
    sugestoes: ['Qual a senha do wifi?', 'Como abrir um chamado?'],
  },
  {
    id: 'senha_wifi',
    chaves: ['senha do wifi', 'senha da rede', 'senha wifi', 'conectar no wifi', 'rede de hospede'],
    apoio: ['wifi', 'senha', 'rede'],
    resposta: () => 'A senha do wifi corporativo não fica publicada aqui — abre um chamado em "Rede / Internet" ou pergunta no ramal da TI que passam na hora.\n\nSe for pra hóspede, a rede de visitantes tem senha própria e a recepção informa no check-in.',
    sugestoes: ['Minha internet está lenta', 'Qual o ramal da TI?'],
  },
  {
    id: 'computador_lento',
    chaves: ['computador lento', 'pc travando', 'maquina travando', 'lentidao', 'travou', 'congelou', 'nao liga', 'tela azul'],
    apoio: ['computador', 'notebook', 'lento', 'travando', 'reiniciar', 'desligou'],
    resposta: () => 'Primeiro socorro: reinicia a máquina (desligar de vez, não só suspender) e fecha as abas/programas que não estiver usando. Resolve a maioria das lentidões do dia a dia.\n\nSe estiver lento sempre, travando ou não liga, abre chamado em "Hardware" com a etiqueta de patrimônio do equipamento e o setor — a TI já leva peça na mão.',
    sugestoes: ['Como abrir um chamado?', 'Preciso de um computador novo'],
  },
  {
    id: 'hardware',
    chaves: ['mouse', 'teclado', 'monitor', 'headset', 'cabo', 'equipamento novo', 'computador novo', 'periferico'],
    apoio: ['quebrado', 'parou', 'nao funciona', 'trocar', 'hardware'],
    resposta: () => 'Equipamento quebrado ou pedido de novo: chamado em "Hardware". Diz o que é, o que acontece (ou por que precisa), o setor e a etiqueta de patrimônio se tiver.\n\nPedido de equipamento novo passa pela aprovação do seu gestor — vale já avisar ele.',
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'software',
    chaves: ['instalar programa', 'instalar software', 'licenca', 'excel', 'word', 'office', 'programa novo', 'atualizar programa'],
    apoio: ['instalar', 'software', 'programa', 'aplicativo', 'sistema'],
    resposta: () => 'Instalação de programa é chamado em "Software": diz qual programa, a versão (se souber) e pra que vai usar — algumas licenças são pagas e precisam do ok do gestor.\n\nO computador do hotel é bloqueado pra instalação por conta própria, então nem tenta baixar direto: é a TI que instala remotamente.',
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'seguranca',
    chaves: ['phishing', 'email suspeito', 'virus', 'golpe', 'link estranho', 'hackeado', 'vazou senha', 'ransomware'],
    apoio: ['suspeito', 'estranho', 'seguranca', 'clique'],
    resposta: () => 'Não clica em nada e não responde. Se já clicou ou digitou senha: troca a senha agora e abre chamado marcando urgente — quanto mais rápido a TI souber, menor o estrago.\n\nRegra de bolso: banco, hotel e TI nunca pedem senha por e-mail ou WhatsApp.',
    sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?'],
  },

  // ── Sinais de conversa ──
  {
    id: 'nao_resolveu',
    chaves: ['nao funcionou', 'nao deu certo', 'nao resolveu', 'continua igual', 'ja tentei isso', 'nao adiantou'],
    apoio: ['ainda', 'mesmo assim', 'continua'],
    resposta: () => 'Então isso já é caso de gente: abre um chamado contando o que você já tentou (isso poupa a TI de repetir os mesmos passos) e, se der, anexa um print do erro. Prazo de resposta é até 2h úteis.',
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
  {
    id: 'urgente',
    chaves: ['urgente', 'emergencia', 'parou tudo', 'hospede esperando', 'nao consigo trabalhar', 'agora mesmo'],
    apoio: ['rapido', 'urgencia', 'critico'],
    resposta: () => 'Caso urgente: abre o chamado marcando prioridade alta E liga no ramal da TI avisando — o chamado registra, a ligação acelera. Diz na descrição que tem hóspede/operação parada, isso muda a fila.',
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
];

function _procurarPessoa(an, usuarios) {
  let melhor = null, score = 0;
  for (const u of usuarios) {
    if (!u.ramal || !u.nome) continue;
    const partes = _tokens(u.nome);
    if (!partes.length) continue;
    let s = 0;
    for (const p of partes) {
      if (p.length < 3) continue;
      const w = _peso(radical(p), an);
      if (w > s) s = w;
    }
    if (s > score) { score = s; melhor = u; }
  }
  return score >= 0.9 ? melhor : null;
}

// ─── 6. Pontuacao ────────────────────────────────────────────────────────────

function pontuar(an, ctx) {
  const ranking = [];
  for (const it of INTENCOES) {
    if (it.soCurta && an.tokens.length > 4) continue;
    if (it.veto && it.veto.some(v => casaTermo(v, an) >= 0.9)) continue;

    let score = 0;
    for (const c of (it.chaves || [])) {
      const w = casaTermo(c, an);
      if (w > 0) score += (_tokens(c).length > 1 ? 4.5 : 3) * w;
    }
    for (const a of (it.apoio || [])) {
      const w = casaTermo(a, an);
      if (w > 0) score += (_tokens(a).length > 1 ? 1.6 : 1) * w;
    }
    if (it.exigeSistema) {
      const id = detectarSistema(an, ctx.sistemas);
      if (!id) continue;
      score += 3.2;
    }
    if (score > 0) ranking.push({ intencao: it, score });
  }
  ranking.sort((a, b) => b.score - a.score);
  return ranking;
}

const LIMIAR = 2.6;

// ─── 7. Motor ────────────────────────────────────────────────────────────────

const FOLLOWUPS = [
  'e como', 'como faco', 'como assim', 'e ai', 'onde', 'e depois', 'explica melhor',
  'nao entendi', 'detalha', 'continua', 'e entao', 'me explica', 'como', 'sim', 'isso',
];

function _ehFollowUp(an) {
  if (an.tokens.length > 4) return false;
  return FOLLOWUPS.some(f => casaTermo(f, an) >= 0.9);
}

/**
 * @param {object} entrada
 * @param {Array<{role:string,content:string}>} entrada.mensagens histórico (a última é a do usuário)
 * @param {object} entrada.contexto dados vivos do Hub (usuario, sistemas, sistemasLiberados, usuarios, updates)
 * @param {object} entrada.config ai_config do admin ({custom_info, quick_replies})
 * @returns {{reply:string, intencao:string, confianca:number, sugestoes:string[]}}
 */
function responder(entrada) {
  const { mensagens = [], contexto = {}, config = {} } = entrada || {};
  const ctx = contexto || {};
  const usuarias = mensagens.filter(m => m.role === 'user');
  const ultima = usuarias.length ? usuarias[usuarias.length - 1].content : '';
  const anteriorTxt = usuarias.length > 1 ? usuarias[usuarias.length - 2].content : '';
  const ultimaBot = [...mensagens].reverse().find(m => m.role === 'assistant');

  let an = analisar(ultima);

  // Pergunta vazia de conteudo ("teste", "???") — pede o que a pessoa precisa.
  if (an.tokens.length === 0) {
    return {
      reply: 'Me conta o que está acontecendo — senha, acesso a sistema, impressora, internet, ramal... escrevo do jeito que vier que eu entendo.',
      intencao: 'vazio',
      confianca: 0,
      sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?', 'Quais sistemas tenho acesso?'],
    };
  }

  // Follow-up curto ("e como faço?") herda o assunto da pergunta anterior.
  if (_ehFollowUp(an) && anteriorTxt) {
    const anAnterior = analisar(`${anteriorTxt} ${ultima}`);
    if (anAnterior.tokens.length > an.tokens.length) an = anAnterior;
  }

  // 1) Resposta rápida cadastrada pelo admin manda em tudo.
  const qr = buscarQuickReply(an, config.quick_replies);
  if (qr) {
    return { reply: qr.reply, intencao: 'quick_reply', confianca: Math.min(0.99, 0.7 + qr.score * 0.3), sugestoes: [] };
  }

  // 2) Intencoes.
  const ranking = pontuar(an, ctx);
  for (const cand of ranking) {
    if (cand.score < LIMIAR) break;
    const txt = cand.intencao.resposta(ctx, an);
    if (!txt) continue;
    // Nao repetir palavra por palavra a resposta anterior.
    if (ultimaBot && ultimaBot.content && txt.slice(0, 60) === String(ultimaBot.content).slice(0, 60)) {
      const alt = ranking.find(c => c !== cand && c.score >= LIMIAR);
      const txtAlt = alt && alt.intencao.resposta(ctx, an);
      if (txtAlt) {
        return { reply: txtAlt, intencao: alt.intencao.id, confianca: _conf(alt.score), sugestoes: alt.intencao.sugestoes || [] };
      }
      return {
        reply: `${txt}\n\nSe já tentou isso e não foi, abre um chamado descrevendo o que aconteceu — assim a TI não repete o mesmo passo.`,
        intencao: cand.intencao.id,
        confianca: _conf(cand.score),
        sugestoes: ['Como abrir um chamado?'],
      };
    }
    const sug = [...(cand.intencao.sugestoes || [])];
    // Empate técnico: oferece o outro assunto como sugestão em vez de errar calado.
    const segundo = ranking.find(c => c !== cand && c.score >= LIMIAR && cand.score - c.score < 1.2);
    if (segundo && segundo.intencao.rotulo) sug.push(segundo.intencao.rotulo);
    return { reply: txt, intencao: cand.intencao.id, confianca: _conf(cand.score), sugestoes: sug.slice(0, 3) };
  }

  // 3) Base de conhecimento escrita pelo admin (recuperada por similaridade).
  const bloco = buscarContexto(an, config.custom_info);
  if (bloco) {
    return { reply: bloco.texto, intencao: 'contexto_admin', confianca: 0.5 + bloco.score, sugestoes: ['Como abrir um chamado?'] };
  }

  // 4) Nao sei — mas ainda assim aponta o caminho certo.
  return {
    reply: 'Essa eu não sei responder com segurança. Abre um chamado no "Chamados TI" descrevendo a situação — a equipe responde em até 2h úteis e resolve direito.',
    intencao: 'desconhecido',
    confianca: 0,
    sugestoes: ['Como abrir um chamado?', 'Quais sistemas tenho acesso?', 'Falar com alguém do TI'],
  };
}

function _conf(score) {
  return Math.min(0.98, Math.round((score / (score + 2.5)) * 100) / 100);
}

// Resumo curto do que o motor sabe — usado para ancorar o LLM quando ha chave.
function resumoContexto(ctx = {}) {
  const linhas = [];
  const sis = _listaSistemas(ctx);
  if (sis.length) {
    linhas.push('Sistemas do Hub agora:');
    for (const s of sis) {
      linhas.push(`- ${s.nome} (${s.url || '—'}) — ${s.descricao || s.categoria || ''}${s.status && s.status !== 'no-ar' ? ` [STATUS: ${s.status}]` : ''}`);
    }
  }
  if (ctx.usuario) {
    linhas.push(`Usuário logado: ${ctx.usuario.nome || ctx.usuario.email} (${ctx.usuario.setor || 'setor não informado'}, perfil ${ctx.usuario.tipo || 'usuario'}).`);
    const libs = (ctx.sistemasLiberados || []).map(id => (sis.find(s => s.id === id) || {}).nome || id);
    linhas.push(`Sistemas liberados para ele: ${libs.length ? libs.join(', ') : 'nenhum'}.`);
  } else {
    linhas.push('Usuário NÃO está logado — não afirme quais sistemas ele tem acesso.');
  }
  if ((ctx.updates || []).length) {
    linhas.push(`Últimas atualizações: ${ctx.updates.slice(0, 3).map(u => `${u.sistemaNome || u.sistemaId}: ${u.titulo}`).join(' | ')}.`);
  }
  return linhas.join('\n');
}

module.exports = {
  responder,
  resumoContexto,
  // expostos para teste/calibragem
  normalizar,
  radical,
  analisar,
  casaTermo,
  pontuar,
  detectarSistema,
  detectarSetor,
  buscarQuickReply,
  buscarContexto,
  INTENCOES,
  LIMIAR,
};
