'use strict';

// Logica pura de filtro+contagem do painel Historico, extraida para teste.
// O frontend (HubMarquise.jsx HistoricoPanel) deve produzir os mesmos numeros
// para a mesma entrada — qualquer divergencia entre este modulo e o JSX e bug.

function localDateStr(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function aplicarFiltros(log, { filterDate = '', filterTipo = 'todos' } = {}) {
  const lista = Array.isArray(log) ? log : [];
  const porData = lista.filter(e => !filterDate || localDateStr(e.at) === filterDate);
  const filtrado = porData.filter(e => filterTipo === 'todos' || e.target_tipo === filterTipo);
  const contagemPorTipo = porData.reduce((acc, e) => {
    acc[e.target_tipo] = (acc[e.target_tipo] || 0) + 1;
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

module.exports = { localDateStr, aplicarFiltros };
