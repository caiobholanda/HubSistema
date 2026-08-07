'use strict';

// Sprint 5B, Estagio 1 — cobre so a logica pura do adapter (leitura de
// flag/config, decisao de skip). NAO testa o caminho real que fala com o
// hub-sdk/Tigris aqui (isso e feito separadamente, como validacao de
// integracao contra o bucket de validacao do hub-sdk — nunca em teste
// automatizado com rede real, mesma disciplina do restante do repositorio).

const test = require('node:test');
const assert = require('node:assert/strict');
const backupAdapter = require('../src/backup-adapter');

const ENV_KEYS = [
  'BACKUP_ENGINE',
  'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION',
  'BUCKET_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION',
];

function withEnv(overrides, fn) {
  const original = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const key of ENV_KEYS) if (original[key] !== undefined) process.env[key] = original[key];
  }
}

test('getBackupEngineMode(): sem BACKUP_ENGINE definido -> legacy (fail-safe)', () => {
  withEnv({}, () => {
    assert.equal(backupAdapter.getBackupEngineMode(), 'legacy');
  });
});

test('getBackupEngineMode(): valor nao reconhecido -> legacy (fail-safe)', () => {
  withEnv({ BACKUP_ENGINE: 'algo-invalido' }, () => {
    assert.equal(backupAdapter.getBackupEngineMode(), 'legacy');
  });
});

test('getBackupEngineMode(): "shadow" e "hub-sdk" sao reconhecidos (case-insensitive)', () => {
  withEnv({ BACKUP_ENGINE: 'shadow' }, () => {
    assert.equal(backupAdapter.getBackupEngineMode(), 'shadow');
  });
  withEnv({ BACKUP_ENGINE: 'HUB-SDK' }, () => {
    assert.equal(backupAdapter.getBackupEngineMode(), 'hub-sdk');
  });
});

test('isShadowModeActive(): false em legacy, true em shadow/hub-sdk', () => {
  withEnv({}, () => assert.equal(backupAdapter.isShadowModeActive(), false));
  withEnv({ BACKUP_ENGINE: 'shadow' }, () => assert.equal(backupAdapter.isShadowModeActive(), true));
  withEnv({ BACKUP_ENGINE: 'hub-sdk' }, () => assert.equal(backupAdapter.isShadowModeActive(), true));
});

test('resolveStorageConfig(): reaproveita BUCKET_NAME/AWS_* do mecanismo legado quando S3_* ausente', () => {
  withEnv(
    {
      BUCKET_NAME: 'bucket-legado',
      AWS_ACCESS_KEY_ID: 'chave-legada',
      AWS_SECRET_ACCESS_KEY: 'segredo-legado',
      AWS_ENDPOINT_URL_S3: 'https://exemplo.tigris.dev',
      AWS_REGION: 'auto',
    },
    () => {
      const cfg = backupAdapter.resolveStorageConfig();
      assert.equal(cfg.bucket, 'bucket-legado');
      assert.equal(cfg.accessKeyId, 'chave-legada');
      assert.equal(cfg.secretAccessKey, 'segredo-legado');
      assert.equal(cfg.endpoint, 'https://exemplo.tigris.dev');
      assert.equal(cfg.region, 'auto');
    }
  );
});

test('resolveStorageConfig(): S3_* explicito tem prioridade sobre BUCKET_NAME/AWS_*', () => {
  withEnv(
    {
      S3_BUCKET: 'bucket-novo',
      S3_ACCESS_KEY_ID: 'chave-nova',
      S3_SECRET_ACCESS_KEY: 'segredo-novo',
      BUCKET_NAME: 'bucket-legado',
      AWS_ACCESS_KEY_ID: 'chave-legada',
      AWS_SECRET_ACCESS_KEY: 'segredo-legado',
    },
    () => {
      const cfg = backupAdapter.resolveStorageConfig();
      assert.equal(cfg.bucket, 'bucket-novo');
      assert.equal(cfg.accessKeyId, 'chave-nova');
      assert.equal(cfg.secretAccessKey, 'segredo-novo');
    }
  );
});

test('resolveStorageConfig(): endpoint/region tem default do preset Tigris quando nada informado', () => {
  withEnv({}, () => {
    const cfg = backupAdapter.resolveStorageConfig();
    assert.equal(cfg.endpoint, 'https://fly.storage.tigris.dev');
    assert.equal(cfg.region, 'auto');
  });
});

test('isHubSdkConfigured(): false sem credenciais completas', () => {
  withEnv({}, () => assert.equal(backupAdapter.isHubSdkConfigured(), false));
  withEnv({ BUCKET_NAME: 'so-o-bucket' }, () => assert.equal(backupAdapter.isHubSdkConfigured(), false));
});

test('isHubSdkConfigured(): true com bucket + accessKeyId + secretAccessKey', () => {
  withEnv(
    { BUCKET_NAME: 'b', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's' },
    () => assert.equal(backupAdapter.isHubSdkConfigured(), true)
  );
});

test('runShadowBackup(): modo legacy -> skipped, nunca tenta carregar o hub-sdk', async () => {
  await withEnv({}, async () => {
    const resultado = await backupAdapter.runShadowBackup('/nao/importa.json');
    assert.deepEqual(resultado, { ok: false, skipped: true, reason: 'BACKUP_ENGINE=legacy' });
  });
});

test('runShadowBackup(): modo shadow mas sem credenciais -> skipped, nunca tenta carregar o hub-sdk', async () => {
  await withEnv({ BACKUP_ENGINE: 'shadow' }, async () => {
    const resultado = await backupAdapter.runShadowBackup('/nao/importa.json');
    assert.equal(resultado.ok, false);
    assert.equal(resultado.skipped, true);
    assert.equal(resultado.reason, 'credenciais ausentes');
  });
});

test('flushShadowBackup(): modo legacy -> resolve imediatamente, sem efeito', async () => {
  await withEnv({}, async () => {
    const inicio = Date.now();
    await backupAdapter.flushShadowBackup('/nao/importa.json', 4000);
    assert.ok(Date.now() - inicio < 100, 'nao deveria esperar nada em modo legacy');
  });
});
