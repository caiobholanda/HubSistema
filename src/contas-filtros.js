'use strict';
// Logica pura de filtro/ordenacao do painel Contas (admins e usuarios do portal).
// Espelha a funcao filtrarOrdenarContas de public/HubMarquise.jsx — mantenha os dois em sincronia.

const ORDEM_STATUS = ['ativo', 'precadastro', 'ativacao_pendente', 'bloqueado', 'desligado'];

function statusEfetivo(r, isAdmin) {
  if (isAdmin) return r.ativo === 1 ? 'ativo' : 'desligado';
  return r.hub_status || (r.ativo !== 0 ? 'ativo' : 'desligado');
}

// opts: { isAdmin, busca, status, setor, cargo, ordem }
// Retorna { resultado, contagem, base }:
// - base: lista apos busca+setor+cargo (SEM status) — fonte dos contadores das pills
// - contagem: { [status]: n } calculada sobre base
// - resultado: base filtrada por status e ordenada
function filtrarOrdenarContas(lista, opts) {
  const { isAdmin, busca, status, setor, cargo, ordem } = opts || {};
  const tokens = (busca || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

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
    const s = statusEfetivo(r, isAdmin);
    contagem[s] = (contagem[s] || 0) + 1;
  }

  const porStatus = base.filter(r => {
    if (!status || status === 'todos') return true;
    return statusEfetivo(r, isAdmin) === status;
  });

  const nomeDe = r => (isAdmin ? r.nome_completo : r.nome) || '';
  const cmpNome = (a, b) => nomeDe(a).localeCompare(nomeDe(b), 'pt-BR', { sensitivity: 'base' });
  const resultado = porStatus.slice().sort((a, b) => {
    if (ordem === 'setor') {
      return ((a.setor || '').localeCompare(b.setor || '', 'pt-BR', { sensitivity: 'base' })) || cmpNome(a, b);
    }
    if (ordem === 'status') {
      return (ORDEM_STATUS.indexOf(statusEfetivo(a, isAdmin)) - ORDEM_STATUS.indexOf(statusEfetivo(b, isAdmin))) || cmpNome(a, b);
    }
    return cmpNome(a, b);
  });

  return { resultado, contagem, base };
}

module.exports = { filtrarOrdenarContas, statusEfetivo, ORDEM_STATUS };
