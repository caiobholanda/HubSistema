'use strict';

// Logica pura de filtro+contagem do painel Historico, extraida para teste.
// O frontend (HubMarquise.jsx HistoricoPanel) deve produzir os mesmos numeros
// para a mesma entrada — qualquer divergencia entre este modulo e o JSX e bug.

function localDateStr(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Tipo "logico" do evento para filtro/contadores.
// Eventos liberar_link/bloquear_link/resetar_permissoes sao tecnicamente
// gravados como target_tipo='permissao' (pois afetam permissoes do usuario),
// mas conceitualmente sao acoes sobre LINKS — agrupamos na aba 'link'.
function tipoLogico(e) {
  if (!e) return '';
  if (e.target_tipo === 'permissao'
    && (e.action === 'liberar_link' || e.action === 'bloquear_link' || e.action === 'resetar_permissoes')) {
    return 'link';
  }
  return e.target_tipo;
}

function aplicarFiltros(log, { filterDate = '', filterTipo = 'todos' } = {}) {
  const lista = Array.isArray(log) ? log : [];
  const porData = lista.filter(e => !filterDate || localDateStr(e.at) === filterDate);
  const filtrado = porData.filter(e => filterTipo === 'todos' || tipoLogico(e) === filterTipo);
  const contagemPorTipo = porData.reduce((acc, e) => {
    const t = tipoLogico(e);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return {
    logPorData: porData,
    filtrado,
    contagemPorTipo,
    totalGeral: porData.length,
    totalSemFiltro: lista.length,
  };
}

module.exports = { localDateStr, aplicarFiltros, tipoLogico };
