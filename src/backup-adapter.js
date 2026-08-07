'use strict';

// Adapter entre o Portal HUB (CommonJS) e o hub-sdk (ESM puro) — unico
// arquivo que fala com @hub/storage-client e @hub/backup-core. Sprint 5B,
// Estagio 1 (modo sombra): grava em PARALELO ao mecanismo legado
// (aws4fetch, server.js), nunca substitui a fonte de restore ainda.
//
// Nao toca em writeData() nem em nenhum dos 80+ call sites que a chamam —
// so o bloco de replicacao existente (agendarBackup/_uploadBackupS3) passa
// a, opcionalmente, tambem chamar este adapter. Ver
// Sprint5-Revisao-Arquitetural-Final.txt (matriz de responsabilidades) e
// Sprint5B-Release-Checklist.txt.
//
// require() de um pacote ESM lanca ERR_REQUIRE_ESM — por isso os imports do
// hub-sdk sao dinamicos (await import()), carregados uma unica vez e
// cacheados.

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const SOURCE_NAME = 'hub-data';

let _hubSdkModules = null;
let _backupService = null;

/**
 * BACKUP_ENGINE controla o que este adapter faz:
 *   legacy  (default/fail-safe) — nunca chama o hub-sdk
 *   shadow  — grava em paralelo ao aws4fetch, nunca usado para restore real
 *   hub-sdk — reservado para o Estagio 2 (corte do restore); esta versao do
 *             adapter ainda trata "hub-sdk" como sinonimo de "shadow" —
 *             o corte de restore em si e mudanca de server.js, nao daqui.
 */
function getBackupEngineMode() {
  const raw = String(process.env.BACKUP_ENGINE || '').trim().toLowerCase();
  if (raw === 'shadow' || raw === 'hub-sdk') return raw;
  return 'legacy';
}

function isShadowModeActive() {
  return getBackupEngineMode() !== 'legacy';
}

/**
 * Reaproveita as MESMAS credenciais que o mecanismo legado ja usa
 * (BUCKET_NAME/AWS_*) em vez de exigir um novo conjunto de Secrets —
 * achado do Release Checklist: se esses Secrets ja estao configurados no
 * Fly, esse ja e o bucket dedicado do Portal HUB exigido pelo ADR-010 V2.
 * S3_* explicito (convencao do hub-sdk) tem prioridade se informado, para
 * quem preferir configurar Secrets novos e separados.
 */
function resolveStorageConfig() {
  const bucket = process.env.S3_BUCKET || process.env.BUCKET_NAME || '';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
  const endpoint = (process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT_URL_S3 || 'https://fly.storage.tigris.dev').replace(/\/+$/, '');
  const region = process.env.S3_REGION || process.env.AWS_REGION || 'auto';
  return { bucket, accessKeyId, secretAccessKey, endpoint, region };
}

function isHubSdkConfigured() {
  const cfg = resolveStorageConfig();
  return !!(cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

async function loadHubSdk() {
  if (_hubSdkModules) return _hubSdkModules;
  const [storageClient, backupCore] = await Promise.all([
    import('@hub/storage-client'),
    import('@hub/backup-core'),
  ]);
  _hubSdkModules = { storageClient, backupCore };
  return _hubSdkModules;
}

async function getBackupService() {
  if (_backupService) return _backupService;
  const { storageClient, backupCore } = await loadHubSdk();
  const cfg = resolveStorageConfig();
  const storage = new storageClient.S3CompatibleProvider({
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    endpoint: cfg.endpoint,
    region: cfg.region,
  });
  const strategy = new backupCore.FileSnapshotStrategy();
  _backupService = new backupCore.BackupService({
    strategy,
    storageProvider: storage,
    appName: 'hub-portal',
  });
  return _backupService;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Roda o backup real via hub-sdk (streaming, checksum, sidecar) e, em
 * seguida, um restore de LEITURA para um arquivo temporario (nunca o
 * hub_data.json real) — so para medir tempo/checksum de restore e
 * comparar com o mecanismo legado. Nunca usado para restaurar de verdade
 * nesta fase (Estagio 1). Best-effort: qualquer erro e capturado e
 * retornado como { ok:false, error }, nunca lancado — mesma filosofia do
 * aws4fetch original, para nao arriscar a aplicacao principal.
 *
 * @param {string} hubDataFilePath - caminho real de data/hub_data.json
 * @returns {Promise<object>} resultado estruturado da comparacao, ou
 *   { ok:false, skipped:true } se o modo sombra nao estiver ativo/configurado
 */
async function runShadowBackup(hubDataFilePath) {
  if (!isShadowModeActive()) return { ok: false, skipped: true, reason: 'BACKUP_ENGINE=legacy' };
  if (!isHubSdkConfigured()) return { ok: false, skipped: true, reason: 'credenciais ausentes' };

  console.log('[SHADOW BACKUP] iniciado');
  const source = { name: SOURCE_NAME, path: hubDataFilePath };

  try {
    const localChecksum = sha256File(hubDataFilePath);

    let backupService;
    try {
      backupService = await getBackupService();
    } catch (err) {
      const msg = `falha ao carregar hub-sdk: ${err.message}`;
      console.error('[SHADOW BACKUP] falhou:', err && err.stack ? err.stack : msg);
      return { ok: false, error: msg };
    }

    const uploadStart = Date.now();
    const backupResult = await backupService.runBackup(source);
    const uploadMs = Date.now() - uploadStart;

    if (!backupResult.success) {
      const msg = `backup hub-sdk falhou: ${backupResult.error}`;
      console.error('[SHADOW BACKUP] falhou:', msg);
      return { ok: false, error: msg, uploadMs };
    }
    console.log('[SHADOW BACKUP] upload realizado');

    const comparison = {
      ok: true,
      objectKey: backupResult.objectKey,
      checksumMatchesLocal: backupResult.checksum === localChecksum,
      localChecksum,
      hubSdkChecksum: backupResult.checksum,
      sizeBytes: backupResult.sizeBytes,
      uploadMs,
    };
    console.log('[SHADOW BACKUP] checksum validado');

    const restoreProbe = await dryRunRestoreProbe(backupService, source, localChecksum);
    comparison.restore = restoreProbe;

    console.log('[SHADOW BACKUP] concluído');
    return comparison;
  } catch (err) {
    // Rede de seguranca adicional: qualquer excecao NAO prevista pelos
    // blocos acima (cada chamada interna ja trata seus proprios erros)
    // ainda assim nunca escapa como rejeicao — sempre retorna {ok:false,
    // error}, com stack completa no log, nunca lancado. Mantem a garantia
    // ja documentada no topo deste arquivo: erro aqui nunca afeta o
    // mecanismo legado nem a aplicacao.
    console.error('[SHADOW BACKUP] falhou:', err && err.stack ? err.stack : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/** Restore de leitura para um destino temporario — nunca sobrescreve hub_data.json. */
async function dryRunRestoreProbe(backupService, source, expectedChecksum) {
  const strategy = backupService.strategy;
  const storage = backupService.storageProvider;
  const tempPath = path.join(os.tmpdir(), `hub-portal-shadow-restore-${process.pid}-${Date.now()}.json`);
  const start = Date.now();
  try {
    const result = await strategy.restoreLatestTo(source, storage, tempPath);
    const restoreMs = Date.now() - start;
    return {
      ok: true,
      restoreMs,
      checksumMatchesUpload: result.checksum === expectedChecksum,
    };
  } catch (err) {
    return { ok: false, error: err.message, restoreMs: Date.now() - start };
  } finally {
    fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

/**
 * Flush best-effort para o shutdown (SIGTERM/SIGINT) — dispara um backup
 * final via hub-sdk se o modo sombra estiver ativo, respeitando um
 * timeout. Nao substitui o flush do mecanismo legado, roda ao lado dele.
 */
async function flushShadowBackup(hubDataFilePath, timeoutMs) {
  if (!isShadowModeActive() || !isHubSdkConfigured()) return;
  const backupPromise = (async () => {
    try {
      const backupService = await getBackupService();
      await backupService.runBackup({ name: SOURCE_NAME, path: hubDataFilePath });
    } catch {
      // best-effort — mesma filosofia do flush legado
    }
  })();
  await Promise.race([backupPromise, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

module.exports = {
  getBackupEngineMode,
  isShadowModeActive,
  isHubSdkConfigured,
  resolveStorageConfig,
  runShadowBackup,
  flushShadowBackup,
};
