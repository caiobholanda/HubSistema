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
  agr: 'agora', dps: 'depois',
  msg: 'mensagem', add: 'adicionar', config: 'configuracao', info: 'informacao',
  pc: 'computador', cpu: 'computador', note: 'notebook', maquina: 'computador',
  impressao: 'imprimir', printer: 'impressora', print: 'imprimir',
  net: 'internet', wi: 'wifi', fi: 'wifi',
  app: 'aplicativo', pass: 'senha', password: 'senha', logar: 'login',
  ticket: 'chamado', helpdesk: 'chamado',
  fone: 'telefone', tel: 'telefone',
  gm: 'granmarquise',
  eh: 'e', ta: 'esta', tah: 'esta', to: 'estou', tow: 'estou',
  cade: 'onde', ond: 'onde', komo: 'como', kd: 'onde',
  mt: 'muito', mto: 'muito', msm: 'mesmo', qro: 'quero', qria: 'queria', sfw: 'software',
  // 1a pessoa do presente: o radical truncado nao junta "troco" com "trocar"
  // (distancia 2), e "como troco minha senha" — a pergunta nº1 do helpdesk —
  // caia em "nao sei". Mapear a conjugacao e mais barato que afrouxar o fuzzy.
  troco: 'trocar', mudo: 'mudar', altero: 'alterar', peco: 'pedir', pedi: 'pedir',
  instalo: 'instalar', abro: 'abrir', imprimo: 'imprimir', acesso_: 'acessar',
  reseto: 'resetar', recupero: 'recuperar', conecto: 'conectar', ligo: 'ligar',
};

// Stoplist ENXUTA de proposito: num classificador de chamados "como/qual/onde"
// sao ruido, mas aqui elas SAO a intencao ("como faco", "onde fica"). O mesmo
// vale para negacao ("nao consigo"), possessivo ("meu ramal") e "voce".
const _STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela', 'para', 'pra', 'pro',
  'com', 'sem', 'sob', 'sobre', 'ate', 'apos', 'entre', 'e', 'ou', 'mas', 'porem',
  'que', 'eu', 'tu', 'ele', 'ela', 'eles', 'elas', 'me', 'te', 'lhe', 'se',
  'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'dele', 'dela',
  'este', 'esta', 'esse', 'essa', 'aquele', 'aquela',
  'ser', 'estar', 'ter', 'haver', 'sou', 'sao', 'era', 'foi', 'vai', 'vou',
  'estou', 'tem', 'tenho', 'ha', 'sendo', 'estava', 'fica',
  'ja', 'ainda', 'mais', 'menos', 'muito', 'pouco', 'todo', 'toda', 'todos', 'todas',
  'aqui', 'ali', 'la', 'sempre', 'nunca', 'so', 'tambem', 'entao', 'assim',
  'ao', 'aos', 'numa', 'pelos', 'pelas', 'favor', 'ne',
]);

// Lixo de teste — quem testa o chat digita "teste teste teste". Formas exatas,
// nao prefixo: "test*" tambem comeria "testemunha" e "testar". Digito NAO entra
// aqui: "ramal 5001" e "andar 12" sao informacao.
const _RUIDO = /^(tst|test|teste|testes|testando|testado|x{3,}|(asdf|qwer|zxcv)+|a{3,}|z{3,}|lorem|ipsum|abc|[.@]+)$/;

function _semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizar(texto) {
  return _semAcento(texto)
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, ' ')
    // Letra esticada de teclado ("bom diaa", "oiii", "vlwww", "naaao") volta ao
    // normal: sem isso o fuzzy nao alcanca e a frase inteira vira "nao sei".
    // A segunda regra e por PALAVRA (fim de token), nao por fim de frase.
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/([a-z])\1(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Corta plural e sufixos comuns. Trunca em 8, nao em 6: com 6, "funcionario",
// "funcionando" e "funciona" viravam o mesmo "funcio" e uma pergunta de RH
// ("desconto de funcionario") era respondida como status de sistema.
function radical(t) {
  let r = String(t || '');
  if (r.length > 4) {
    r = r.replace(/(coes|aoes|oes|aes|ais|eis|ns)$/, 'ao')
         .replace(/(mente|acao|ando|endo|indo|ador|ivel|avel|ismo|ista)$/, '')
         .replace(/s$/, '');
  }
  return r.slice(0, 8);
}

// Os ~500 termos do catalogo sao re-tokenizados a cada mensagem; como sao
// strings constantes, o resultado e memoizado. O teto evita que texto de
// usuario (variavel) encha a memoria.
const _CACHE_TOKENS = new Map();

function _tokens(texto) {
  const chave = String(texto || '');
  const memo = _CACHE_TOKENS.get(chave);
  if (memo) return memo;
  const saida = normalizar(chave)
    .split(' ')
    .filter(Boolean)
    .map(t => _EXPANSOES[t] || t)
    // Digito de 1 char fica ("3 andar", "sala 5"); letra solta nao.
    .filter(t => (t.length > 1 || /\d/.test(t)) && !_STOPWORDS.has(t) && !_RUIDO.test(t));
  if (_CACHE_TOKENS.size < 4000) _CACHE_TOKENS.set(chave, saida);
  return saida;
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

// Tolerancia proporcional: 1 erro a partir de 4 letras, 2 a partir de 6
// ("esqeci"/"esqueci", "xamado"/"chamado", "sitemas"/"sistemas").
function _pareceIgual(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  const limite = n >= 6 ? 2 : 1;
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
// O fuzzy roda tambem sobre a palavra INTEIRA, nao so sobre o radical: o corte
// em 6 chars destroi a distancia ("esqeci"→"esqeci" vs "esqueci"→"esquec" da 2,
// mas as palavras inteiras dao 1).
function _peso(palavra, an) {
  const rad = radical(palavra);
  if (an.conjunto.has(rad)) return 1;
  for (const r of an.conjunto) if (_pareceIgual(r, rad)) return 0.6;
  for (const t of an.tokens) if (_pareceIgual(t, palavra)) return 0.6;
  return 0;
}

// Termo pode ser palavra ou frase ("abrir chamado"): frase exige todas as partes.
function casaTermo(termo, an) {
  const partes = _tokens(termo);
  if (partes.length === 0) return 0;
  if (partes.length === 1) return _peso(partes[0], an);
  let soma = 0;
  for (const p of partes) {
    const w = _peso(p, an);
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

// Setores reais do Gran Marquise (mesma lista de locais usada pelo analisador de
// equipamentos do sistema-chamados) — canonico -> como a equipe fala.
const SETORES_CONHECIDOS = [
  ['TI', ['ti', 'tecnologia da informacao', 'informatica', 'suporte tecnico']],
  ['Recepcao', ['recepcao', 'front desk', 'check in', 'check out']],
  ['Governanca', ['governanca', 'camareira', 'arrumacao']],
  ['Manutencao', ['manutencao', 'predial']],
  ['Reservas', ['reservas', 'central de reservas']],
  ['Eventos', ['eventos', 'convencoes', 'banquetes']],
  ['Financeiro', ['financeiro', 'controladoria', 'contas a pagar', 'contas a receber']],
  ['Recursos Humanos', ['recursos humanos', 'rh', 'departamento pessoal']],
  ['Marketing', ['marketing', 'comunicacao']],
  ['Comercial', ['comercial', 'vendas']],
  ['Cozinha', ['cozinha', 'confeitaria', 'padaria', 'nutricao']],
  ['Restaurante', ['restaurante', 'mangostin', 'mucuripe', 'room service', 'lobby bar', 'rooftop']],
  ['Spa', ['spa', 'occitane', 'gran spa']],
  ['Lavanderia', ['lavanderia', 'rouparia']],
  ['Seguranca', ['seguranca', 'portaria', 'mensageria']],
  ['Almoxarifado', ['almoxarifado', 'compras', 'estoque']],
  ['Gerencia', ['gerencia', 'gerencia geral', 'diretoria']],
  ['Qualidade', ['qualidade']],
  ['Concierge', ['concierge']],
  ['Estacionamento', ['estacionamento', 'transportes']],
  ['Fitness', ['fitness', 'academia', 'piscina']],
  ['CPD', ['cpd', 'datacenter', 'sala de servidores']],
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
    if (!s || !s.id) continue;
    const w = casaTermo(s.nome || '', an);
    if (w > 0) {
      const ja = candidatos.find(c => c.id === s.id);
      if (ja) ja.peso = Math.max(ja.peso, w * 1.2);
      else candidatos.push({ id: s.id, peso: w * 1.2 });
    }
  }
  // Corte alto de proposito: citar sistema exige casar o apelido de verdade
  // (1.0) ou uma frase inteira com um erro (0.84). Fuzzy de palavra solta (0.6)
  // nao entra — senao qualquer palavra de 6 letras "vira" um sistema.
  candidatos.sort((a, b) => b.peso - a.peso);
  return candidatos[0] && candidatos[0].peso >= 0.8 ? candidatos[0].id : null;
}

function detectarSetor(an) {
  let melhor = null, peso = 0;
  for (const [canonico, apelidos] of SETORES_CONHECIDOS) {
    for (const ap of apelidos) {
      // Apelido composto ("sala de servidores") vale mais que palavra solta.
      const w = casaTermo(ap, an) * (_tokens(ap).length > 1 ? 1.3 : 1);
      if (w > peso) { peso = w; melhor = canonico; }
    }
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

// Cobertura da PERGUNTA ponderada por tamanho de palavra: casar "mangostin"
// (9 letras) vale muito mais que casar "horas". Comprimento é um proxy barato de
// raridade — sem corpus nao da pra calcular IDF de verdade aqui.
function _similaridade(an, texto) {
  const alvo = new Set(_tokens(texto).map(radical));
  if (alvo.size === 0 || an.conjunto.size === 0) return 0;
  let casado = 0, total = 0;
  for (const r of an.radicais) {
    total += r.length;
    if (alvo.has(r)) casado += r.length;
    else { for (const a of alvo) if (_pareceIgual(a, r)) { casado += r.length * 0.6; break; } }
  }
  return total === 0 ? 0 : casado / total;
}

// Fuzzy estrito para palavra-chave do admin: 1 erro E mesma letra inicial.
// Sem a inicial, "serial" casava com "ferias" (distancia 2) e o usuario recebia
// a resposta cadastrada de férias com cara de resposta oficial.
function _casaEstrito(palavra, an) {
  const p = normalizar(palavra);
  if (!p) return 0;
  if (an.conjunto.has(radical(p))) return 1;
  for (const t of an.tokens) {
    if (t[0] === p[0] && Math.abs(t.length - p.length) <= 1 && _distancia(t, p, 1) <= 1) return 0.9;
  }
  return 0;
}

function buscarQuickReply(an, quickReplies) {
  let melhor = null, score = 0;
  for (const qr of (quickReplies || [])) {
    if (!qr || !qr.reply) continue;
    const kws = String(qr.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    let s = 0;
    for (const k of kws) {
      const partes = _tokens(k);
      const w = partes.length > 1 ? casaTermo(k, an) * 1.5 : _casaEstrito(partes[0] || k, an);
      if (w > s) s = w;
    }
    if (s > score) { score = s; melhor = qr; }
  }
  // Corte alto: 0.6 e exatamente o valor de um match POR ERRO DE DIGITACAO, e
  // com ele "serial" disparava a resposta cadastrada para "ferias" (distancia 2)
  // com cara de resposta oficial. Palavra solta agora exige acerto exato; frase
  // (peso 1.5) ainda tolera um erro.
  return score >= 0.85 ? { reply: melhor.reply, score } : null;
}

function buscarContexto(an, customInfo) {
  let melhor = null, score = 0;
  for (const b of _blocos(customInfo)) {
    const s = _similaridade(an, b);
    if (s > score) { score = s; melhor = b; }
  }
  return score >= 0.4 ? { texto: melhor, score } : null;
}

// ─── 5. Catalogo de intencoes ────────────────────────────────────────────────

const URL_HUB = 'hub-granmarquise.fly.dev';

function _listaSistemas(ctx) {
  const libs = new Set(ctx.sistemasLiberados || []);
  return (ctx.sistemas || [])
    .filter(s => s && s.nome && s.status !== 'inativo')
    .map(s => ({ ...s, liberado: libs.has(s.id) }));
}

function _nomeCurto(ctx) {
  const n = ctx.usuario && ctx.usuario.nome;
  return n ? String(n).split(' ')[0] : '';
}

// ─── Formato das respostas ───────────────────────────────────────────────────
// Toda resposta segue a mesma forma: o que a pessoa pode tentar agora, e depois
// o caminho do chamado numerado. Blocos separados por linha em branco — texto
// corrido de 5 linhas no balao do chat ninguem le.

// Passo a passo do chamado. Sempre os mesmos 4 passos, mudando so a categoria e
// o que escrever: repeticao aqui e' boa, a pessoa decora o caminho.
function _chamado(categoria, oQueEscrever, abertura) {
  return [
    abertura || 'Se não resolver, abre um chamado:',
    '',
    '1. No Hub, abre o card "Chamados TI" e clica em "Novo Chamado".',
    `2. Escolhe a categoria "${categoria}".`,
    `3. Escreve ${oQueEscrever}.`,
    '4. Envia. A TI responde em até 2h úteis.',
  ].join('\n');
}

// Junta os blocos com linha em branco entre eles, ignorando os vazios.
// (nome diferente de `_blocos`, que ja existe e fatia o texto do admin)
function _juntar(...partes) {
  return partes.filter(p => p && String(p).trim()).join('\n\n');
}

// Lista com marcador, um item por linha.
function _lista(itens) {
  return itens.map(i => `• ${i}`).join('\n');
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
      return _juntar(
        `${n ? `Oi, ${n}!` : 'Oi!'} Sou o assistente de TI do Hub.`,
        'Posso ajudar com senha, acesso a sistema, ramal, impressora, internet e o que estiver pegando no computador.',
        'Me conta o que está acontecendo. Se preferir já abrir um chamado, é só pedir que eu te passo o passo a passo.'
      );
    },
    sugestoes: ['Quais sistemas tenho acesso?', 'Esqueci minha senha', 'Como abrir um chamado?'],
  },
  {
    id: 'agradecimento',
    chaves: ['obrigado', 'obrigada', 'valeu', 'agradecido', 'grato'],
    apoio: ['perfeito', 'otimo', 'show', 'beleza', 'entendi', 'ajudou', 'resolveu'],
    soCurta: true,
    resposta: () => _juntar(
      'Boa! Qualquer outra coisa é só chamar.',
      'Se o problema voltar, me pede o passo a passo do chamado que eu te mando.'
    ),
    sugestoes: [],
  },
  {
    id: 'quem_e_voce',
    chaves: ['quem e voce', 'o que voce faz', 'voce e um robo', 'voce e humano', 'como funciona voce'],
    apoio: ['assistente', 'bot', 'robo', 'inteligencia artificial'],
    resposta: () => _juntar(
      'Sou o assistente do Hub — rodo aqui dentro mesmo, com o que a equipe de TI cadastrou sobre os sistemas do hotel.',
      'Sei explicar acesso, senha, ramal, impressora, internet e como abrir chamado.',
      'O que eu não souber vira chamado, e eu te mostro o passo a passo de como abrir.'
    ),
    sugestoes: ['O que você sabe responder?', 'Falar com alguém do TI'],
  },
  {
    id: 'ajuda_menu',
    // soCurta: "vc sabe komo eu troco a senha?" é uma pergunta concreta, não um
    // pedido de menu — antes a chave "o que voce sabe" engolia qualquer
    // "você sabe...".
    soCurta: true,
    chaves: ['ajuda', 'o que voce sabe responder', 'o que posso perguntar', 'o que voce faz aqui', 'menu', 'opcoes'],
    apoio: ['duvida', 'nao sei o que perguntar'],
    resposta: () => _juntar(
      'Posso ajudar com:',
      _lista([
        'Senha e login no Hub (esqueci, bloqueou, primeiro acesso)',
        'Quais sistemas você tem acesso e como pedir mais',
        'Abrir e acompanhar chamado de TI',
        'Achar ramal de pessoa ou setor',
        'Impressora, internet, computador lento, e-mail',
      ]),
      'Manda a dúvida do jeito que vier que eu entendo.',
      'E se já quiser abrir um chamado, me pede "abrir chamado" que eu te passo os passos.'
    ),
    sugestoes: ['Quais sistemas tenho acesso?', 'Esqueci minha senha', 'Qual o ramal da recepção?'],
  },

  // ── Acesso / conta ──
  {
    id: 'senha_esqueci',
    familia: 'acesso',
    chaves: ['esqueci senha', 'recuperar senha', 'resetar senha', 'redefinir senha', 'nao lembro senha', 'perdi senha'],
    apoio: ['senha', 'login', 'entrar', 'acessar'],
    veto: ['wifi', 'internet'],
    resposta: () => _juntar(
      'Dá pra resolver sozinho, leva 1 minuto:',
      [
        '1. Na tela de login do Hub, clica em "Esqueci minha senha".',
        '2. Digita seu e-mail @granmarquise.com.br.',
        '3. Abre o link que chega no e-mail (confere o spam, costuma cair lá).',
        '4. Cria a senha nova.',
      ].join('\n'),
      _chamado('Acesso / Login', 'seu e-mail e que o link de redefinição não chegou',
        'Se o link não chegar em uns minutos, abre um chamado:')
    ),
    sugestoes: ['Minha conta está bloqueada', 'Como abrir um chamado?'],
  },
  {
    id: 'senha_trocar',
    familia: 'acesso',
    prioridade: 4,
    chaves: ['trocar senha', 'mudar senha', 'alterar senha', 'trocar a minha senha', 'nova senha',
      'senha forte', 'requisito de senha', 'como troco a senha', 'mudar a senha'],
    apoio: ['senha', 'segura', 'trocar', 'mudar', 'alterar'],
    veto: ['wifi'],
    resposta: () => _juntar(
      'A senha do Hub precisa de no mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (exemplo: Hotel@2026).',
      'Pra trocar:',
      [
        '1. Na tela de login do Hub, clica em "Esqueci minha senha".',
        '2. Usa seu e-mail @granmarquise.com.br.',
        '3. Pelo link que chega no e-mail você define a senha nova.',
      ].join('\n'),
      _chamado('Acesso / Login', 'que precisa trocar a senha e não conseguiu pelo link')
    ),
    sugestoes: ['Esqueci minha senha', 'Primeiro acesso ao Hub'],
  },
  {
    id: 'conta_bloqueada',
    familia: 'acesso',
    prioridade: 5,
    chaves: ['conta bloqueada', 'usuario bloqueado', 'bloqueou', 'travou login', 'acesso negado',
      'nao consigo entrar', 'nao consigo logar', 'nao consigo login', 'nao loga', 'nao entra'],
    apoio: ['bloqueado', 'senha', 'login', 'errada', 'invalido'],
    resposta: () => _juntar(
      'Depois de várias tentativas erradas, o Hub trava a conta por segurança. Quase sempre destrava sozinho.',
      'Tenta assim:',
      [
        '1. Espera uns 15 minutos sem tentar entrar de novo.',
        '2. Entra com calma, conferindo maiúscula e minúscula da senha.',
        '3. Se não lembrar a senha, usa "Esqueci minha senha" na tela de login.',
      ].join('\n'),
      _chamado('Acesso / Login', 'seu e-mail e que a conta está bloqueada',
        'Se continuar travado, abre um chamado:')
    ),
    sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?'],
  },
  {
    id: 'primeiro_acesso',
    familia: 'acesso',
    // "nao tenho login" volta como chave (a intencao praticamente parou de
    // disparar sem ela); quem decide contra "nao consigo logar" e a prioridade
    // maior de conta_bloqueada, que e conta existente travada.
    chaves: ['primeiro acesso', 'ativar conta', 'criar conta', 'nao tenho cadastro', 'nao tenho login',
      'sem login', 'nunca entrei', 'nunca acessei', 'sou novo aqui', 'sou nova aqui',
      'funcionario novo', 'funcionaria nova', 'link de ativacao', 'fui contratado', 'fui contratada'],
    apoio: ['cadastro', 'ativacao', 'conta', 'novo', 'nova', 'login'],
    resposta: () => _juntar(
      'Conta nova quem cria é a TI. Funciona assim:',
      [
        '1. Você recebe um link de ativação no e-mail @granmarquise.com.br.',
        '2. Abre o link e define sua senha (o link expira, então usa no mesmo dia).',
        '3. Pronto, já entra no Hub com esse e-mail e senha.',
      ].join('\n'),
      _chamado('Acesso / Login', 'seu nome completo, setor e e-mail, dizendo que é primeiro acesso',
        'Não recebeu o link? Aí é chamado — pode ser você ou seu gestor que abre:')
    ),
    sugestoes: ['Requisitos da senha', 'Como abrir um chamado?'],
  },
  {
    id: 'email_corporativo',
    // Acima de computador_lento (4): "o outlook travou" empatava em 3.0 e a
    // pessoa recebia "reinicia a máquina" em vez de resposta de e-mail.
    prioridade: 5,
    chaves: ['email corporativo', 'meu email', 'qual meu email', 'outlook', 'webmail', 'caixa de entrada'],
    apoio: ['email', 'mensagem', 'enviar', 'receber'],
    resposta: (ctx) => {
      const e = ctx.usuario && ctx.usuario.email;
      return _juntar(
        e ? `Você está logado como ${e}. O login do Hub é sempre o e-mail @granmarquise.com.br.`
          : 'O login do Hub é sempre o e-mail @granmarquise.com.br.',
        'Se o problema é no e-mail em si (não recebe, não envia, Outlook pedindo senha), tenta primeiro:',
        [
          '1. Fecha o Outlook por completo e abre de novo.',
          '2. Confere se a internet está funcionando em outro site.',
        ].join('\n'),
        _chamado('Software', 'o que acontece e a mensagem de erro exata que aparece na tela')
      );
    },
    sugestoes: ['Como abrir um chamado?', 'Esqueci minha senha'],
  },

  // ── Sistemas / permissoes ──
  {
    id: 'meus_sistemas',
    familia: 'sistema',
    // Exige uma pista de ENUMERACAO ("quais", "meus", "lista"): sem isso,
    // "como acesso o sistema X" cairia aqui em vez de falar do sistema X.
    chaves: ['quais sistemas', 'meus sistemas', 'sistemas disponiveis', 'sistemas liberados', 'que sistemas existem', 'lista de sistemas', 'todos os sistemas'],
    apoio: ['liberado', 'disponivel', 'permissao', 'acesso'],
    resposta: (ctx) => {
      const todos = _listaSistemas(ctx);
      if (todos.length === 0) return null;
      if (!ctx.usuario) {
        return _juntar(
          `O Hub reúne: ${todos.map(s => s.nome).join(', ')}.`,
          'Entra com seu e-mail @granmarquise.com.br que eu te digo exatamente quais estão liberados pra você — cada um aparece no Hub só pra quem tem permissão.'
        );
      }
      const lib = todos.filter(s => s.liberado);
      const nao = todos.filter(s => !s.liberado);
      const pedir = _chamado('Permissão de Acesso', 'qual sistema você precisa, pra quê e quem é seu gestor',
        'Pra liberar o que falta, abre um chamado:');
      if (lib.length === 0) {
        return _juntar(
          'Não achei nenhum sistema liberado pro seu usuário ainda.',
          `Os que existem hoje: ${nao.map(s => s.nome).join(', ')}.`,
          pedir
        );
      }
      return _juntar(
        'Você tem acesso a:',
        _lista(lib.map(s => `${s.nome}${s.descricao ? ` — ${s.descricao}` : ''}`)),
        nao.length ? `Sem acesso hoje: ${nao.map(s => s.nome).join(', ')}.` : '',
        nao.length ? pedir : 'Precisando de mais algum, me avisa que eu te passo o passo a passo do chamado.'
      );
    },
    sugestoes: ['Como pedir acesso a um sistema?', 'Algum sistema fora do ar?'],
  },
  {
    id: 'pedir_acesso',
    familia: 'sistema',
    chaves: ['pedir acesso', 'solicitar acesso', 'liberar acesso', 'permissao de acesso', 'nao tenho permissao', 'liberar sistema'],
    apoio: ['acesso', 'permissao', 'liberar', 'autorizar'],
    resposta: () => _juntar(
      'Acesso a sistema sai por chamado — é rápido.',
      _chamado('Permissão de Acesso', 'qual sistema você precisa, pra quê vai usar e quem é seu gestor',
        'Faz assim:'),
      'A TI confirma com o seu gestor e libera. Assim que liberar, o sistema aparece sozinho no seu Hub — não precisa nem sair e entrar de novo.'
    ),
    sugestoes: ['Como abrir um chamado?', 'Quais sistemas tenho acesso?'],
  },
  {
    id: 'sistema_especifico',
    familia: 'sistema',
    chaves: [],
    apoio: ['sistema', 'acessar', 'entrar', 'link', 'endereco', 'url', 'onde fica', 'como uso', 'para que serve'],
    exigeSistema: true,
    resposta: (ctx, an) => {
      const id = detectarSistema(an, ctx.sistemas);
      if (!id) return null;
      if (id === 'hub') {
        return _juntar(
          `O Hub (${URL_HUB}) é a porta de entrada dos sistemas do hotel.`,
          'Você entra uma vez com o e-mail @granmarquise.com.br e de lá abre os outros sistemas sem digitar senha de novo. Aparece só o que está liberado pro seu usuário.',
          _chamado('Acesso / Login', 'o que você não está conseguindo fazer no Hub',
            'Se algo não abrir pra você, abre um chamado:')
        );
      }
      const s = (ctx.sistemas || []).find(x => x.id === id);
      if (!s) return null;
      const liberado = (ctx.sistemasLiberados || []).includes(id);
      const partes = [`${s.nome}${s.descricao ? ` — ${s.descricao}` : ''}`];
      if (s.status && s.status !== 'no-ar') {
        partes.push(s.status === 'manutencao'
          ? 'No momento ele está em manutenção. Se precisar com urgência, abre um chamado que a TI avisa assim que voltar.'
          : 'Esse sistema está inativo no momento.');
      }
      if (ctx.usuario && liberado) {
        partes.push('Como abrir:');
        partes.push([
          `1. Entra no Hub (${URL_HUB}).`,
          `2. Clica no card "${s.nome}".`,
          '3. Pronto — o login vai junto, não pede senha de novo.',
        ].join('\n'));
        partes.push(_chamado('Acesso / Login', `que o ${s.nome} não abre e o que aparece na tela`));
      } else if (ctx.usuario) {
        partes.push('Você ainda não tem acesso a ele.');
        partes.push(_chamado('Permissão de Acesso', `que precisa do ${s.nome}, pra quê e quem é seu gestor`,
          'Pra liberar, abre um chamado:'));
      } else {
        partes.push(`Ele é aberto pelo card no Hub (${URL_HUB}), e o acesso é liberado por setor/função.`);
        partes.push(_chamado('Permissão de Acesso', `que precisa do ${s.nome} e pra quê`,
          'Se você não vê o card, abre um chamado:'));
      }
      return _juntar(...partes);
    },
    sugestoes: ['Como pedir acesso a um sistema?', 'Quais sistemas tenho acesso?'],
  },
  {
    id: 'status_sistemas',
    familia: 'sistema',
    // Intencao que AFIRMA um fato ("o sistema X esta em manutencao") — a mais
    // perigosa do catalogo quando erra. Por isso o vocabulario generico ("nao
    // abre", "manutencao") virou apoio e so responde se a pessoa citou um
    // sistema do Hub; sem sistema citado, ela sai da disputa.
    chaves: ['fora do ar', 'sistema caiu', 'instabilidade', 'sistema nao abre', 'sistema fora',
      'sistema em manutencao', 'sistema funcionando', 'site fora'],
    apoio: ['erro', 'travando', 'sistema', 'site', 'pagina', 'nao abre', 'nao carrega'],
    bonus: (an, ctx) => {
      if (detectarSistema(an, ctx && ctx.sistemas)) return 1.5;
      // Pergunta generica sobre "o sistema/site/hub" continua valendo; o que
      // sai da disputa e "nao abre" solto, que antes afirmava manutencao de um
      // sistema qualquer para quem falava de porta, ar condicionado ou PDF.
      const generico = ['sistema', 'site', 'hub', 'portal', 'plataforma'].some(t => casaTermo(t, an) >= 0.9);
      return generico ? 0 : -2.5;
    },
    resposta: (ctx, an) => {
      const fora = _listaSistemas(ctx).filter(s => s.status && s.status !== 'no-ar');
      const citado = detectarSistema(an, ctx.sistemas);
      // Sem sistema citado, deixar claro que o painel cobre só os sistemas do
      // Hub — senão vira "afirmação de fato" sobre o PMS, o PDV ou a fechadura.
      const passos = _chamado('Software', 'o nome do sistema, o que aparece na tela e o horário que aconteceu');
      if (fora.length) {
        const lista = `${fora.map(s => `${s.nome} (${s.status === 'manutencao' ? 'em manutenção' : s.status})`).join(', ')}`;
        // A ressalva vem ANTES quando nenhum sistema foi citado: quem lê só a
        // primeira linha entendia que o sistema DELE (ponto, fechadura, PMS)
        // estava em manutenção — o fato é verdadeiro, a leitura é falsa.
        if (!citado) {
          return _juntar(
            'Eu só enxergo o painel dos sistemas do Hub — se o que você usa é outro (PMS, PDV, ponto, fechadura), não consigo ver o status dele daqui.',
            `Dos sistemas do Hub, fora do normal agora: ${lista}. Os demais estão no ar.`,
            passos
          );
        }
        return _juntar(`Fora do normal agora: ${lista}.`, 'Os demais estão no ar.', passos);
      }
      return _juntar(
        'Pelo painel do Hub, está tudo no ar agora.',
        'Se mesmo assim não abre pra você, tenta:',
        [
          '1. Atualizar a página com Ctrl+F5.',
          '2. Conferir se a internet está funcionando em outro site.',
          '3. Fechar o navegador e abrir de novo.',
        ].join('\n'),
        citado ? '' : 'Vale lembrar: eu enxergo só os sistemas do Hub. Se o seu é outro (PMS, PDV, ponto, fechadura), não consigo ver o status dele daqui.',
        passos
      );
    },
    sugestoes: ['Como abrir um chamado?', 'Minha internet está lenta'],
  },
  {
    id: 'novidades',
    chaves: ['novidade', 'novidades', 'mudou', 'atualizacao', 'changelog', 'versao nova', 'lancamento',
      'o que mudou no hub', 'sistema novo'],
    apoio: ['atualizou'],
    resposta: (ctx) => {
      const ups = (ctx.updates || []).filter(u => u && u.titulo).slice(0, 3);
      const fecho = 'Se alguma mudança atrapalhou seu trabalho, me fala que eu te passo o passo a passo do chamado.';
      if (!ups.length) {
        return _juntar(
          'Nenhuma atualização registrada por aqui ainda.',
          'Quando sai algo novo, aparece no sino de atualizações, no topo do Hub.',
          fecho
        );
      }
      return _juntar(
        'Últimas atualizações:',
        _lista(ups.map(u => `${u.sistemaNome || u.sistemaId}: ${u.titulo}`)),
        'O histórico completo fica no sino de atualizações, no topo do Hub.',
        fecho
      );
    },
    sugestoes: ['Quais sistemas tenho acesso?'],
  },

  // ── Chamados ──
  {
    id: 'abrir_chamado',
    familia: 'chamado',
    chaves: ['abrir chamado', 'novo chamado', 'como abro chamado', 'solicitar suporte', 'chamar ti', 'registrar problema'],
    apoio: ['chamado', 'suporte', 'ajuda', 'problema', 'ti'],
    resposta: () => _juntar(
      'É rápido, são 4 passos:',
      [
        '1. No Hub, abre o card "Chamados TI" e clica em "Novo Chamado".',
        '2. Escolhe a categoria (Impressora, Acesso/Login, Rede, Hardware, Software...).',
        '3. Descreve o problema: onde você está (andar e setor), o que aparece na tela e desde quando acontece.',
        '4. Envia. A TI responde em até 2h úteis.',
      ].join('\n'),
      'Duas dicas que aceleram: anexa um print da tela e, se for equipamento, coloca a etiqueta de patrimônio.'
    ),
    sugestoes: ['Como acompanho meu chamado?', 'Quais categorias existem?'],
  },
  {
    id: 'acompanhar_chamado',
    familia: 'chamado',
    chaves: ['acompanhar chamado', 'status do chamado', 'meu chamado', 'ja abri chamado', 'chamado sem resposta', 'demorando'],
    apoio: ['chamado', 'aberto', 'resposta', 'andamento', 'prazo'],
    resposta: () => _juntar(
      'Pra ver como está o seu:',
      [
        '1. No Hub, abre o card "Chamados TI".',
        '2. Seus chamados aparecem na lista com o status (aberto, em andamento, resolvido).',
        '3. Clica no chamado pra ler o histórico de respostas da TI.',
      ].join('\n'),
      'Passou de 2h úteis sem retorno e é urgente? Responde dentro do próprio chamado marcando como urgente e liga no ramal da TI avisando.'
    ),
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
  {
    id: 'categorias_chamado',
    familia: 'chamado',
    chaves: ['categoria de chamado', 'quais categorias', 'que categoria escolho', 'tipo de chamado'],
    apoio: ['categoria', 'chamado', 'classificar'],
    resposta: () => _juntar(
      'As categorias que a TI usa são estas:',
      _lista([
        'Impressora / Periférico — impressora, scanner, toner',
        'Acesso / Login — senha, conta bloqueada, primeiro acesso',
        'Permissão de Acesso — liberar um sistema pra você',
        'Rede / Internet — sem internet, wifi, lentidão de rede',
        'Hardware — computador, mouse, teclado, monitor, tablet',
        'Software — programa, Office, e-mail, sistema travando',
      ]),
      'Na dúvida, escolhe a mais próxima e explica direito na descrição — a TI reclassifica se precisar.',
      _chamado('a que mais combinar', 'o problema, o setor e desde quando acontece', 'Na hora de abrir:')
    ),
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'falar_humano',
    familia: 'contato',
    prioridade: 6,
    chaves: ['falar com alguem', 'falar com humano', 'falar com pessoa', 'falar ti', 'falar tecnico', 'atendente', 'pessoa de verdade', 'suporte humano', 'ramal da ti', 'telefone da ti'],
    apoio: ['ti', 'tecnico', 'analista', 'suporte', 'pessoa'],
    resposta: (ctx) => {
      const ti = _pessoasVisiveis(ctx).filter(u => _mesmoSetor(u.setor, 'TI'));
      const passos = _chamado('a que mais combinar com o problema', 'o que está acontecendo e o seu setor',
        'Se ninguém atender, abre um chamado — fica registrado e alguém pega:');
      if (ti.length) {
        return _juntar(
          'Fala com a TI direto:',
          _lista(ti.slice(0, 4).map(u => `${u.nome} — ramal ${u.ramal}`)),
          passos
        );
      }
      return _juntar(
        'Pra falar com uma pessoa da TI, procura o ramal do setor no "Contatos Gran Marquise", dentro do Hub.',
        passos
      );
    },
    sugestoes: ['Como abrir um chamado?'],
  },

  // ── Ramais / pessoas ──
  {
    id: 'ramal',
    familia: 'contato',
    prioridade: 6,
    chaves: ['ramal', 'telefone', 'contato', 'numero de', 'como ligo', 'falar com setor', 'diretorio de ramais'],
    apoio: ['ligar', 'discar', 'numero', 'setor', 'pessoa'],
    // "ramal da manutencao": citar um setor junto com a palavra ramal desempata
    // contra intencoes que compartilham o nome do setor.
    bonus: (an) => (detectarSetor(an) ? 1.5 : 0),
    resposta: (ctx, an) => {
      const setor = detectarSetor(an);
      const usuarios = _pessoasVisiveis(ctx);
      const ondeBuscar = _juntar(
        'Pra ver a lista completa:',
        [
          '1. No Hub, abre o card "Contatos Gran Marquise".',
          '2. Busca pelo nome da pessoa ou pelo setor.',
          '3. O ramal aparece do lado do nome.',
        ].join('\n')
      );
      const chamadoRamal = _chamado('Acesso / Login', 'de quem é o ramal que você procura e o setor',
        'Se o ramal estiver errado ou faltando lá, abre um chamado:');

      if (setor && usuarios.length) {
        const doSetor = usuarios.filter(u => _mesmoSetor(u.setor, setor));
        if (doSetor.length) {
          return _juntar(`Ramais de ${setor}:`, _lista(doSetor.slice(0, 6).map(u => `${u.nome} — ${u.ramal}`)), ondeBuscar);
        }
        return _juntar(`Não achei ninguém de ${setor} com ramal cadastrado aqui.`, ondeBuscar, chamadoRamal);
      }
      if (usuarios.length && !setor) {
        const nome = _procurarPessoa(an, usuarios);
        if (nome) return _juntar(`${nome.nome}${nome.setor ? ` (${nome.setor})` : ''} — ramal ${nome.ramal}.`, ondeBuscar);
      }
      return _juntar(
        ondeBuscar,
        ctx.usuario ? '' : 'Entra no Hub com seu e-mail que eu consigo consultar o ramal direto aqui na conversa.',
        chamadoRamal
      );
    },
    sugestoes: ['Qual o ramal da TI?', 'Como abrir um chamado?'],
  },
  {
    id: 'meus_dados',
    familia: 'contato',
    chaves: ['meu ramal', 'meu setor', 'meus dados', 'meu perfil', 'meu cadastro', 'meu usuario'],
    apoio: ['perfil', 'cadastro', 'dados'],
    resposta: (ctx) => {
      const u = ctx.usuario;
      if (!u) return 'Entra no Hub com seu e-mail @granmarquise.com.br que eu te mostro seus dados de cadastro.';
      const linhas = [`Nome: ${u.nome || '—'}`, `E-mail: ${u.email}`];
      if (u.setor) linhas.push(`Setor: ${u.setor}`);
      if (u.ramal) linhas.push(`Ramal: ${u.ramal}`);
      linhas.push(`Perfil: ${u.tipo === 'admin' ? 'administrador' : 'usuário'}`);
      return _juntar(
        'Seu cadastro no Hub:',
        _lista(linhas),
        _chamado('Acesso / Login', 'qual dado está errado e qual é o correto',
          'Se algum dado estiver errado, abre um chamado:')
      );
    },
    sugestoes: ['Quais sistemas tenho acesso?', 'Como abrir um chamado?'],
  },

  // ── Problemas de TI ──
  {
    id: 'impressora',
    familia: 'equipamento',
    prioridade: 5,
    chaves: ['impressora', 'imprimir', 'toner', 'cartucho', 'papel atolado', 'nao imprime', 'scanner', 'digitalizar'],
    apoio: ['fila de impressao', 'copia', 'multifuncional'],
    resposta: () => _juntar(
      'Dois testes rápidos resolvem metade dos casos:',
      [
        '1. Confere se a impressora está ligada, com papel e sem luz vermelha piscando.',
        '2. Limpa a fila: clica com o botão direito na impressora → "Ver o que está sendo impresso" → cancela tudo.',
        '3. Manda imprimir de novo.',
      ].join('\n'),
      _chamado('Impressora / Periférico', 'o modelo da impressora e onde ela fica (andar e setor)',
        'Se não voltar, abre um chamado:')
    ),
    sugestoes: ['Como abrir um chamado?', 'Preciso de um toner novo'],
  },
  {
    id: 'rede',
    chaves: ['internet', 'wifi', 'rede', 'sem conexao', 'sem internet', 'internet lenta', 'cabo de rede',
      'sinal', 'perdeu a conexao', 'caiu a conexao', 'sem sinal', 'fora da rede'],
    apoio: ['conectar', 'conexao', 'lento', 'caindo', 'desconecta'],
    resposta: () => _juntar(
      'Antes de mais nada, descobre se é só com você:',
      [
        '1. Pergunta pro colega do lado se a internet dele está funcionando.',
        '2. Se for só no seu: tira e recoloca o cabo de rede (ou desconecta e reconecta o wifi).',
        '3. Reinicia o computador e testa de novo.',
      ].join('\n'),
      _chamado('Rede / Internet', 'o setor, se está em um ou em vários computadores e desde quando começou',
        'Se continuar, abre um chamado:'),
      'Dizer se é um ou vários computadores muda totalmente o diagnóstico — não esquece essa parte.'
    ),
    sugestoes: ['Qual a senha do wifi?', 'Como abrir um chamado?'],
  },
  {
    id: 'senha_wifi',
    chaves: ['senha do wifi', 'senha da rede', 'senha wifi', 'conectar no wifi', 'rede de hospede'],
    apoio: ['wifi', 'senha', 'rede'],
    resposta: () => _juntar(
      'A senha do wifi corporativo não fica publicada aqui, por segurança.',
      'Dois caminhos: liga no ramal da TI, que passam na hora, ou abre um chamado.',
      _chamado('Rede / Internet', 'qual aparelho você precisa conectar e o seu setor',
        'Pelo chamado é assim:'),
      'Se for pra hóspede, a rede de visitantes tem senha própria e quem informa é a recepção, no check-in.'
    ),
    sugestoes: ['Minha internet está lenta', 'Qual o ramal da TI?'],
  },
  {
    id: 'computador_lento',
    familia: 'equipamento',
    prioridade: 4,
    chaves: ['computador lento', 'pc travando', 'maquina travando', 'lentidao', 'travou', 'congelou', 'nao liga', 'tela azul', 'lento'],
    apoio: ['computador', 'notebook', 'travando', 'reiniciar', 'desligou'],
    resposta: () => _juntar(
      'Primeiro socorro, resolve a maioria das lentidões do dia a dia:',
      [
        '1. Fecha as abas e programas que você não está usando agora.',
        '2. Reinicia a máquina — desligar de vez, não só suspender.',
        '3. Espera ela subir por completo antes de abrir os sistemas.',
      ].join('\n'),
      _chamado('Hardware', 'a etiqueta de patrimônio do equipamento, o setor e se ele trava sempre ou de vez em quando',
        'Se continuar lento, travando ou não ligar, abre um chamado:')
    ),
    sugestoes: ['Como abrir um chamado?', 'Preciso de um computador novo'],
  },
  {
    id: 'hardware',
    familia: 'equipamento',
    prioridade: 4,
    chaves: ['mouse', 'teclado', 'monitor', 'headset', 'cabo', 'equipamento novo', 'computador novo',
      'periferico', 'camera', 'webcam', 'microfone', 'carregador', 'fonte', 'bateria',
      'tablet', 'leitor', 'leitor de cartao', 'catraca', 'relogio de ponto', 'nobreak'],
    apoio: ['quebrado', 'parou', 'nao funciona', 'trocar', 'hardware', 'notebook'],
    resposta: () => _juntar(
      'Vale testar antes, leva 1 minuto:',
      [
        '1. Tira o cabo do equipamento e coloca de novo (se for sem fio, troca a pilha).',
        '2. Testa em outra entrada USB ou em outro computador.',
      ].join('\n'),
      _chamado('Hardware', 'qual é o equipamento, o que acontece, o setor e a etiqueta de patrimônio se tiver',
        'Não voltou, ou é pedido de equipamento novo? Abre um chamado:'),
      'Pedido de equipamento novo passa pela aprovação do seu gestor — vale já avisar ele.'
    ),
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'software',
    prioridade: 4,
    chaves: ['instalar programa', 'instalar software', 'instalar', 'licenca', 'excel', 'word', 'office',
      'programa novo', 'atualizar programa', 'pdf', 'navegador', 'chrome', 'planilha', 'adobe', 'whatsapp web'],
    apoio: ['software', 'programa', 'aplicativo', 'sistema', 'abrir arquivo'],
    // Duas situacoes bem diferentes caem aqui: pedir programa novo e programa
    // que travou/perdeu arquivo. Responder instalacao para quem perdeu planilha
    // e' resposta errada com categoria certa.
    resposta: (ctx, an) => {
      if (/trav|fech|perdi|perdeu|sumiu|corromp|nao salva|congel/.test(an.limpo)) {
        return _juntar(
          'Calma que na maioria das vezes o arquivo volta:',
          [
            '1. Abre o programa de novo — o Office costuma mostrar um painel "Documentos recuperados" do lado esquerdo.',
            '2. Se não aparecer, vai em Arquivo → Informações → Gerenciar Pasta de Trabalho.',
            '3. Se o arquivo ficava numa pasta de rede, dá pra buscar versão anterior — a TI faz isso.',
          ].join('\n'),
          _chamado('Software', 'o nome do programa, o nome do arquivo e em que pasta ele estava salvo',
            'Se o arquivo não voltar ou o programa travar sempre, abre um chamado:')
        );
      }
      return _juntar(
        'O computador do hotel é bloqueado pra instalação por conta própria — quem instala é a TI, remotamente. Então nem precisa baixar nada.',
        _chamado('Software', 'qual programa você precisa, a versão (se souber) e pra quê vai usar',
          'Pra pedir, abre um chamado:'),
        'Algumas licenças são pagas e precisam do ok do seu gestor — se for o caso, a TI confirma com ele.'
      );
    },
    sugestoes: ['Como abrir um chamado?'],
  },
  {
    id: 'seguranca',
    prioridade: 9, // ganha de qualquer outro assunto em caso de empate
    // Engenharia social chega por telefone e WhatsApp, nao so por e-mail — e em
    // gerundio ("ligaram pedindo minha senha"), que o radical nao junta com
    // "pediram". Por isso as duas formas entram na lista.
    chaves: ['phishing', 'email suspeito', 'virus', 'golpe', 'link estranho', 'hackeado', 'vazou senha',
      'ransomware', 'link', 'clicar no link', 'pediram minha senha', 'pedindo minha senha',
      'pediram senha', 'pedindo senha', 'ligaram pedindo', 'remetente estranho', 'e confiavel',
      'mandaram link', 'me pediram'],
    apoio: ['suspeito', 'estranho', 'seguranca', 'clique', 'whatsapp', 'recebi', 'chegou',
      'ligaram', 'pedindo', 'pediram', 'desconhecido'],
    resposta: () => _juntar(
      'Não clica em nada e não responde a mensagem.',
      'Se você JÁ clicou ou digitou sua senha:',
      [
        '1. Troca sua senha agora, pelo "Esqueci minha senha" na tela de login.',
        '2. Não desliga o computador — a TI pode precisar ver o que aconteceu.',
        '3. Avisa a TI na hora, pelo ramal, e abre o chamado logo em seguida.',
      ].join('\n'),
      _chamado('Software', 'o que você recebeu, por onde veio (e-mail, WhatsApp) e se chegou a clicar ou digitar a senha',
        'O chamado é assim — marca como urgente:'),
      'Regra de bolso: banco, hotel e TI nunca pedem senha por e-mail ou WhatsApp.'
    ),
    sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?'],
  },

  // Relato generico e CURTO ("nao funciona", "travou", "deu erro"): chutar um
  // diagnostico aqui e pior do que perguntar. Em frase longa a intencao
  // especifica tem mais termos e ganha ("a camera do notebook nao funciona").
  {
    id: 'ambiguo',
    soCurta: true,
    prioridade: 3,
    // As chaves aqui sao quase-sinonimas ("nao funciona" / "nao esta
    // funcionando" / "nao ta indo"): somar todas empilhava 8 pontos e vencia
    // ate intencao especifica. Vale a melhor, nao a soma.
    somaMax: true,
    // Se a pessoa nomeou a coisa, nao ha o que perguntar — quem responde e a
    // intencao especifica ("meu mouse parou de funcionar", "nao ta indo o outlook").
    veto: ['computador', 'notebook', 'impressora', 'mouse', 'teclado', 'monitor', 'camera',
      'internet', 'wifi', 'rede', 'sistema', 'email', 'senha', 'telefone', 'ramal', 'site',
      'outlook', 'excel', 'word', 'office', 'chrome', 'navegador', 'hub', 'pdf', 'tablet',
      'leitor', 'aplicativo', 'programa', 'portal', 'planilha'],
    bonus: (an, ctx) => (detectarSistema(an, ctx && ctx.sistemas) ? -5 : 0),
    chaves: ['nao funciona', 'nao esta funcionando', 'nao abre', 'nao vai', 'nao carrega',
      'deu erro', 'travou tudo', 'parou de funcionar', 'nao ta indo', 'deu problema'],
    resposta: () => _juntar(
      'O que exatamente não está funcionando?',
      'Me diz o equipamento ou o sistema (computador, impressora, internet, e-mail, um sistema do Hub) que eu já te falo o caminho certo.',
      _chamado('a que mais combinar com o problema', 'o que não está funcionando, o seu setor e desde quando',
        'Se preferir ir direto pro chamado:')
    ),
    sugestoes: ['Meu computador está lento', 'Problema na impressora', 'Problema de internet'],
  },

  // ── Fora do escopo da TI ──
  // Sem esta intencao, "desconto de funcionario" e "brigada de incendio" caiam
  // em respostas de TI absurdas por colisao de radical. Aqui a recusa e
  // explicita e ainda diz para quem a pessoa deve falar.
  {
    id: 'fora_escopo',
    // Prioridade BAIXA: so responde quando ninguem mais pontuou. Com prioridade
    // alta ela vencia empates e mandava embora chamado legitimo ("o pc do
    // quarto da governanca travou") — recusar atendimento e mais caro que
    // responder a coisa errada.
    prioridade: 2,
    // Palavra de TI na frase mata a intencao: num hotel, "quarto", "hospede" e
    // "check in" sao o LOCAL do problema de TI, nao o assunto.
    veto: ['computador', 'pc', 'notebook', 'tablet', 'impressora', 'sistema', 'senha', 'login',
      'acesso', 'internet', 'wifi', 'rede', 'telefone', 'ramal', 'email', 'leitor', 'monitor',
      'teclado', 'mouse', 'tela', 'aplicativo', 'chamado', 'usuario', 'maquina', 'camera'],
    chaves: ['ferias', 'folga', 'holerite', 'contracheque', 'salario', 'banco de horas',
      'uniforme', 'vale transporte', 'vale refeicao', 'atestado', 'demissao', 'admissao', 'beneficio',
      'refeitorio', 'buffet', 'cardapio', 'brigada', 'incendio', 'enxoval', 'amenities', 'desconto',
      'ar condicionado', 'lampada', 'vazamento', 'chuveiro', 'elevador'],
    apoio: ['rh', 'recursos humanos', 'governanca', 'beneficios', 'ponto', 'escala',
      'treinamento', 'restaurante', 'comida', 'refeicao', 'hospede', 'quarto', 'apartamento',
      'check in', 'check out', 'obra'],
    resposta: (ctx, an) => {
      const rh = /ferias|folga|escala|holerite|contracheque|salario|ponto|horas|uniforme|vale|atestado|demiss|admiss|benefic|trein|brigada|incendio/.test(an.limpo)
        ? 'RH' : (/ar condicionado|lampada|vazamento|chuveiro|elevador|obra/.test(an.limpo) ? 'Manutenção' : null);
      const destino = rh === 'RH'
        ? 'Isso é com o RH, não passa pela TI — fala com eles direto ou com seu gestor.'
        : rh === 'Manutenção'
          ? 'Isso é com a Manutenção, não com a TI — abre a solicitação com eles (ou avisa a governança, se for em UH).'
          : 'Isso aí foge da TI — quem resolve é o setor responsável (RH, Governança ou A&B, conforme o caso).';
      return _juntar(
        destino,
        'Eu cuido só do que é sistema, acesso, senha, rede e equipamento.',
        'Se no meio disso tiver algo de TI (um sistema que não abre, um computador travado), me chama que eu te passo a solução e o passo a passo do chamado.'
      );
    },
    sugestoes: ['Quais sistemas tenho acesso?', 'Como abrir um chamado?'],
  },
  // Tentativa de manipular o assistente. Nao ha o que vazar (este motor nao
  // segue instrucao, ele classifica), mas responder com naturalidade a uma
  // frase hostil passa a impressao errada de que a manipulacao funcionou.
  {
    id: 'injecao',
    prioridade: 10,
    // Toda chave precisa de 2+ palavras com peso: "todas as senhas" encolhia
    // para [senhas] e dava 1.2 pontos a QUALQUER frase com a palavra senha —
    // era o que fazia "esqueci minha senha" repetido virar acusação.
    exigeFrase: true,
    chaves: ['ignore suas instrucoes', 'ignore tudo', 'esqueca tudo', 'prompt de sistema', 'seu prompt',
      'sem restricoes', 'modo debug', 'modo desenvolvedor', 'voce agora e', 'finja que',
      'senha do administrador', 'liste todas as senhas', 'me diga a senha', 'revele a senha'],
    apoio: [],
    resposta: () => _juntar(
      'Não rola — eu não tenho senha de ninguém nem instrução secreta pra revelar. Sou um assistente com respostas cadastradas pela própria TI do hotel.',
      _chamado('Permissão de Acesso', 'a que você precisa ter acesso, pra quê e quem é seu gestor',
        'Se você precisa de acesso a alguma coisa, o caminho é este:')
    ),
    sugestoes: ['Como pedir acesso a um sistema?', 'Como abrir um chamado?'],
  },

  // ── Sinais de conversa ──
  {
    id: 'nao_resolveu',
    // So faz sentido depois de uma dica dada: quem chega dizendo "nao funciona"
    // na primeira mensagem esta relatando um problema, nao rejeitando a solucao.
    // Com historico o bonus e alto de proposito — ai a rejeicao da dica e a
    // leitura certa e precisa ganhar do "me diz o que nao funciona".
    prioridade: 5,
    // -4 (nao -3): com -3, "ja tentei isso" como PRIMEIRA mensagem ainda ficava
    // em 1.5 e passava pelo limiar reduzido de mensagem curta.
    bonus: (an, ctx) => (ctx && ctx._temHistorico ? 4 : -4),
    chaves: ['nao funcionou', 'nao deu certo', 'nao resolveu', 'continua igual', 'ja tentei isso', 'nao adiantou'],
    apoio: ['ainda', 'mesmo assim', 'continua'],
    resposta: () => _juntar(
      'Então isso já é caso de gente — não vale ficar tentando.',
      _chamado('a que combina com o problema', 'o que já tentou, o que continua acontecendo e o seu setor',
        'Abre um chamado assim:'),
      'Contar o que você já tentou poupa a TI de repetir os mesmos passos. Se der, anexa um print do erro.'
    ),
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
  {
    id: 'urgente',
    prioridade: 8,
    chaves: ['urgente', 'emergencia', 'parou tudo', 'hospede esperando', 'nao consigo trabalhar', 'agora mesmo'],
    apoio: ['rapido', 'urgencia', 'critico'],
    resposta: () => _juntar(
      'Caso urgente faz os dois: abre o chamado E liga na TI. O chamado registra, a ligação acelera.',
      [
        '1. No Hub, abre o card "Chamados TI" e clica em "Novo Chamado".',
        '2. Escolhe a categoria do problema e marca a prioridade como alta.',
        '3. Escreve na descrição que tem hóspede ou operação parada — isso muda a fila.',
        '4. Envia e liga no ramal da TI avisando que abriu.',
      ].join('\n')
    ),
    sugestoes: ['Como abrir um chamado?', 'Qual o ramal da TI?'],
  },
];

// O setor no cadastro vem sem padrao ("Recepcao", "recepção", "RECEPÇÃO").
function _mesmoSetor(cadastrado, canonico) {
  const a = normalizar(cadastrado || '');
  const b = normalizar(canonico || '');
  if (!a || !b) return false;
  if (a === b) return true;
  return radical(a.split(' ')[0]) === radical(b.split(' ')[0]);
}

// Defesa em profundidade: hoje o server ja entrega `usuarios: []` para sessao
// anonima, mas quem imprime nome/ramal e este arquivo — entao a checagem mora
// aqui tambem. Um chamador novo (script, teste, outro endpoint) nao consegue
// vazar diretorio por esquecer a regra.
function _pessoasVisiveis(ctx) {
  if (!ctx || !ctx.usuario) return [];
  return (ctx.usuarios || []).filter(u => u && u.ramal && u.nome);
}

function _procurarPessoa(an, usuarios) {
  let melhor = null, score = 0;
  for (const u of usuarios) {
    if (!u || !u.ramal || !u.nome) continue;
    const partes = _tokens(u.nome);
    if (!partes.length) continue;
    let s = 0;
    for (const p of partes) {
      if (p.length < 3) continue;
      const w = _peso(p, an);
      if (w > s) s = w;
    }
    if (s > score) { score = s; melhor = u; }
  }
  return score >= 0.9 ? melhor : null;
}

// ─── 6. Pontuacao ────────────────────────────────────────────────────────────

// Peso de um termo do catalogo. Frase com 2+ tokens uteis e o sinal mais forte.
// Frase que a stoplist reduz a UM token ("sou novo" -> [novo], "esta no ar" ->
// [ar]) vale como apoio: senao a palavra "novo" sozinha daria 3 pontos a
// "primeiro acesso" e "ar" daria 3 a "status de sistema".
function _pesoTermo(termo, forte) {
  const uteis = _tokens(termo).length;
  const cruas = normalizar(termo).split(' ').filter(Boolean).length;
  if (uteis > 1) return forte ? 4.5 : 1.6;
  if (cruas > 1) return forte ? 1.2 : 0.6;
  return forte ? 3 : 1;
}

function pontuar(an, ctx) {
  const ranking = [];
  for (const it of INTENCOES) {
    if (it.soCurta && an.tokens.length > 4) continue;
    if (it.veto && it.veto.some(v => casaTermo(v, an) >= 0.9)) continue;

    let score = 0;
    // Cada radical pontua UMA vez por intencao. Sem isso "obrigado"+"obrigada"
    // somavam em dobro, e "nao tenho login" + "sem login" + apoio "login"
    // empilhavam tres vezes a mesma evidencia — foi assim que "nao consigo
    // logar" virou "primeiro acesso".
    const contados = new Set();
    const somar = (termo, forte) => {
      const w = casaTermo(termo, an);
      if (w <= 0) return;
      // Intencao marcada como `exigeFrase` ignora termo que a stoplist reduziu
      // a uma palavra: ela so pode disparar com evidencia real.
      if (it.exigeFrase && _tokens(termo).length < 2) return;
      const rads = _tokens(termo).map(radical);
      if (rads.length && rads.every(r => contados.has(r))) return;
      for (const r of rads) contados.add(r);
      const p = _pesoTermo(termo, forte) * w;
      score = (forte && it.somaMax) ? Math.max(score, p) : score + p;
    };
    for (const c of (it.chaves || [])) somar(c, true);
    for (const a of (it.apoio || [])) somar(a, false);
    // Falar do sistema X é o assunto mais generico do catalogo: entra na
    // disputa, mas perde de uma intencao especifica ("ramal", "abrir chamado")
    // que tenha casado uma chave forte.
    if (it.exigeSistema) {
      const id = detectarSistema(an, ctx.sistemas);
      if (!id) continue;
      score += 2.7;
    }
    if (score > 0 && typeof it.bonus === 'function') score += it.bonus(an, ctx);
    if (score > 0) ranking.push({ intencao: it, score, prio: it.prioridade || 0 });
  }
  // Empate era decidido pela ordem de declaracao do array — por isso "toner
  // novo" caia em "primeiro acesso". Assunto mais especifico/grave desempata.
  ranking.sort((a, b) => (b.score - a.score) || (b.prio - a.prio));
  return ranking;
}

const LIMIAR = 2.6;

// Como oferecer cada assunto de volta ao usuario quando ele ficou em segundo lugar.
const ROTULOS = {
  senha_esqueci: 'Esqueci minha senha',
  senha_trocar: 'Requisitos da senha',
  conta_bloqueada: 'Minha conta está bloqueada',
  primeiro_acesso: 'Primeiro acesso ao Hub',
  meus_sistemas: 'Quais sistemas tenho acesso?',
  pedir_acesso: 'Como pedir acesso a um sistema?',
  status_sistemas: 'Algum sistema fora do ar?',
  abrir_chamado: 'Como abrir um chamado?',
  acompanhar_chamado: 'Como acompanho meu chamado?',
  ramal: 'Achar um ramal',
  impressora: 'Problema na impressora',
  rede: 'Problema de internet',
  senha_wifi: 'Qual a senha do wifi?',
  computador_lento: 'Meu computador está lento',
  software: 'Instalar um programa',
  hardware: 'Equipamento com defeito',
  falar_humano: 'Falar com alguém do TI',
  seguranca: 'Recebi algo suspeito',
  urgente: 'É urgente',
  email_corporativo: 'Problema no e-mail',
};

// ─── 7. Motor ────────────────────────────────────────────────────────────────

const FOLLOWUPS = [
  'e como', 'como faco', 'como assim', 'e ai', 'onde', 'e depois', 'explica melhor',
  'nao entendi', 'detalha', 'continua', 'e entao', 'me explica', 'como', 'sim', 'isso',
];

function _ehFollowUp(an) {
  if (an.tokens.length > 4) return false;
  return FOLLOWUPS.some(f => casaTermo(f, an) >= 0.9);
}

function _temAssuntoProprio(an, ctx) {
  const r = pontuar(an, ctx);
  return r.length > 0 && r[0].score >= LIMIAR;
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
  const ctx = { ...(contexto || {}) };
  // "nao funcionou" so e rejeicao de dica se ja houve dica.
  ctx._temHistorico = mensagens.some(m => m && m.role === 'assistant');
  const usuarias = mensagens.filter(m => m.role === 'user');
  const ultima = usuarias.length ? usuarias[usuarias.length - 1].content : '';
  const anteriorTxt = usuarias.length > 1 ? usuarias[usuarias.length - 2].content : '';
  const ultimaBot = [...mensagens].reverse().find(m => m.role === 'assistant');

  let an = analisar(ultima);

  // Pergunta vazia de conteudo ("teste", "???") — pede o que a pessoa precisa.
  if (an.tokens.length === 0) {
    return {
      reply: _juntar(
        'Me conta o que está acontecendo.',
        'Pode ser senha, acesso a sistema, impressora, internet, ramal... escreve do jeito que vier que eu entendo.',
        'Se preferir já abrir um chamado, me pede "abrir chamado" que eu te passo o passo a passo.'
      ),
      intencao: 'vazio',
      confianca: 0,
      sugestoes: ['Esqueci minha senha', 'Como abrir um chamado?', 'Quais sistemas tenho acesso?'],
    };
  }

  // Follow-up curto ("e como faço?") herda o assunto da pergunta anterior — mas
  // SO se a mensagem nova nao se sustenta sozinha. Sem esse teste, "como abro
  // chamado" logo depois de uma resposta sobre senha era respondido como senha.
  if (_ehFollowUp(an) && anteriorTxt && !_temAssuntoProprio(an, ctx)) {
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

  // Mensagem de uma ou duas palavras ("senha", "suporte", "permissao"): nenhuma
  // palavra de apoio sozinha alcanca o limiar normal, e o assistente antigo
  // respondia essas. Aqui o limiar cai — e, quando varios assuntos empatam,
  // perguntar qual e' melhor do que chutar um.
  const curta = an.tokens.length <= 3;
  const limiar = curta ? 1.0 : LIMIAR;
  if (curta && ranking.length > 1 && ranking[0].score < LIMIAR) {
    const empatados = ranking.filter(c => ranking[0].score - c.score < 0.3 && ROTULOS[c.intencao.id]);
    if (empatados.length >= 2) {
      return {
        reply: 'Sobre isso eu ajudo com mais de uma coisa — qual delas é?',
        intencao: 'esclarecer',
        confianca: 0.3,
        sugestoes: empatados.slice(0, 3).map(c => ROTULOS[c.intencao.id]),
      };
    }
  }

  for (const cand of ranking) {
    if (cand.score < limiar) break;
    const txt = cand.intencao.resposta(ctx, an);
    if (!txt) continue;
    // Pergunta repetida quase sempre quer dizer "não entendi", NAO "me fala de
    // outro assunto". A versao antiga pulava para o 2o colocado sem piso de
    // qualidade e trocava o tema: "esqueci minha senha" repetido chegava a cair
    // na recusa de manipulação, acusando quem só perguntou de novo.
    if (ultimaBot && ultimaBot.content && txt.slice(0, 60) === String(ultimaBot.content).slice(0, 60)) {
      return {
        reply: _juntar(
          'Vou repetir com calma — e se ainda não resolver, o chamado abaixo é o caminho.',
          txt
        ),
        intencao: cand.intencao.id,
        confianca: _conf(cand.score),
        sugestoes: ['Como abrir um chamado?', 'Falar com alguém do TI'],
      };
    }
    // Mensagem com dois assuntos ("a impressora nao imprime E esqueci a senha").
    // Intencao da MESMA familia nao conta como segundo assunto: "ramal da
    // governanca e como abro chamado" perdia o ramal porque
    // "acompanhar chamado" (irma de "abrir chamado") ocupava a vaga.
    const candidatos = ranking.filter(c => c !== cand
      && c.score >= Math.max(LIMIAR, limiar)
      && !(cand.intencao.familia && c.intencao.familia === cand.intencao.familia));
    const porGravidade = (a, b) =>
      ((b.intencao.prioridade || 0) - (a.intencao.prioridade || 0)) || (b.score - a.score);
    const outro = candidatos.slice().sort(porGravidade)[0];
    // Assunto grave (phishing, urgencia com hospede) ou pedido direto de
    // contato nao pode virar chip de sugestao: se pontuou forte, entra ANTES
    // da resposta principal. Filtra ANTES de ordenar — ordenar primeiro fazia
    // um candidato prioritario porem fraco (urgente 3.0) bloquear o forte
    // (falar_humano 4.5) e a mensagem perdia o ramal pedido.
    const elegivel = candidatos
      .filter(c => (c.intencao.prioridade || 0) >= 6 && c.score >= 4.5)
      .sort(porGravidade)[0];
    if (elegivel) {
      const grave = elegivel.intencao.resposta(ctx, an);
      if (grave) {
        return {
          reply: `${grave}\n\nSobre a outra parte: ${txt}`,
          intencao: elegivel.intencao.id,
          confianca: _conf(elegivel.score),
          sugestoes: (elegivel.intencao.sugestoes || []).slice(0, 3),
        };
      }
    }
    const sug = [];
    if (outro && ROTULOS[outro.intencao.id]) sug.push(ROTULOS[outro.intencao.id]);
    for (const s of (cand.intencao.sugestoes || [])) if (!sug.includes(s)) sug.push(s);
    const proximo = ranking.find(c => c !== cand);
    return {
      reply: txt,
      intencao: cand.intencao.id,
      // Confianca desconta a proximidade do 2o colocado: score alto com empate
      // e' menos confiavel que score alto isolado.
      confianca: _conf(cand.score, proximo ? proximo.score : 0),
      sugestoes: sug.slice(0, 3),
    };
  }

  // 3) Base de conhecimento escrita pelo admin (recuperada por similaridade).
  // `base_prompt` entra junto: como nao existe LLM, o que o admin escreve la e
  // conhecimento consultavel, nao instrucao para um modelo.
  const bloco = buscarContexto(an, [config.custom_info, config.base_prompt].filter(Boolean).join('\n\n'));
  if (bloco) {
    return { reply: bloco.texto, intencao: 'contexto_admin', confianca: Math.min(0.95, 0.5 + bloco.score * 0.4), sugestoes: ['Como abrir um chamado?'] };
  }

  // 4) Nao sei — mas ainda assim aponta o caminho certo, com os passos.
  return {
    reply: _juntar(
      'Essa eu não sei responder com segurança — prefiro não chutar.',
      _chamado('a que mais combinar com o assunto', 'a sua situação com o máximo de detalhe que conseguir',
        'O caminho certo é abrir um chamado:')
    ),
    intencao: 'desconhecido',
    confianca: 0,
    sugestoes: ['Como abrir um chamado?', 'Quais sistemas tenho acesso?', 'Falar com alguém do TI'],
  };
}

function _conf(score, scoreSegundo = 0) {
  const base = score / (score + 2.5);
  const desconto = score > 0 ? Math.min(0.4, (scoreSegundo / score) * 0.4) : 0;
  return Math.max(0, Math.min(0.98, Math.round(base * (1 - desconto) * 100) / 100));
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
