// Windows: atualização automática pelo electron-updater (NSIS), a partir do GitHub Releases do repositório público.
//
// O instalador sai do electron-builder com --prepackaged (o Forge empacota antes), e nesse caminho o electron-builder não
// grava o resources/app-update.yml no app (o afterPack não roda). Por isso o próprio app escreve a configuração do
// atualizador em userData e aponta o electron-updater para ela: o mesmo conteúdo que o electron-builder gravaria,
// conferido contra o publish do electron-builder.yml nos testes.
//
// Sem assinatura de código: sem publisherName na configuração, o electron-updater não confere a assinatura do instalador
// baixado (confere o sha512 do latest.yml). Instalação por usuário (perMachine: false): o latest.yml sai sem
// isAdminRightsRequired e o instalador roda sem pedir administrador.
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {PASTA_CACHE_ATUALIZADOR, REPOSITORIO} from '../nucleo/atualizacao';
import type {MotorWindows} from './atualizacao';

/** O app-update.yml do Estúdio (provider github; sem token: o repositório é público). */
export const configDoAtualizador = () => ({provider: 'github', owner: REPOSITORIO.dono, repo: REPOSITORIO.nome, updaterCacheDirName: PASTA_CACHE_ATUALIZADOR});

export const yamlDoAtualizador = () => `${Object.entries(configDoAtualizador()).map(([k, v]) => `${k}: ${v}`).join('\n')}\n`;

/** O mínimo do NsisUpdater que o motor usa (os testes passam um falso). */
export type UpdaterNsis = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  updateConfigPath: string | null;
  logger: unknown;
  on: (evento: string, f: (...a: never[]) => void) => unknown;
  removeListener: (evento: string, f: (...a: never[]) => void) => unknown;
  checkForUpdates: () => Promise<{isUpdateAvailable?: boolean; updateInfo: {version: string; releaseName?: string | null; releaseNotes?: unknown}} | null>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (silencioso?: boolean, reabrir?: boolean) => void;
};

export const motorWindows = (o: {updater: UpdaterNsis; pastaDados: string; aceitarTestes: boolean; registrar: (m: string) => void}): MotorWindows => {
  const u = o.updater;
  const arquivo = path.join(o.pastaDados, 'atualizacao', 'app-update.yml');
  mkdirSync(path.dirname(arquivo), {recursive: true});
  writeFileSync(arquivo, yamlDoAtualizador(), 'utf-8');
  u.updateConfigPath = arquivo;
  u.autoDownload = false; // o atualizador decide (versão de teste fica de fora) e então baixa
  u.autoInstallOnAppQuit = true; // baixada, instala ao fechar o Estúdio
  u.autoRunAppAfterInstall = true;
  u.allowPrerelease = o.aceitarTestes;
  u.allowDowngrade = false;
  u.logger = {info: () => undefined, warn: (m: unknown) => o.registrar(`atualização: ${String(m)}`), error: (m: unknown) => o.registrar(`atualização: ${String(m)}`),
    debug: () => undefined};
  // sem ouvinte, o "error" do EventEmitter derrubaria o processo principal
  u.on('error', ((x: Error) => o.registrar(`atualização: ${x?.message ?? x}`)) as never);
  return {
    async procurar() {
      const r = await u.checkForUpdates();
      if (!r || r.isUpdateAvailable === false) return null;
      return {versao: r.updateInfo.version, titulo: r.updateInfo.releaseName ?? undefined, notas: r.updateInfo.releaseNotes ?? undefined};
    },
    async baixar(aoProgresso) {
      const ouvir = ((p: {percent?: number}) => aoProgresso((p?.percent ?? 0) / 100)) as never;
      u.on('download-progress', ouvir);
      try {
        await u.downloadUpdate();
      } finally {
        u.removeListener('download-progress', ouvir);
      }
    },
    // silencioso (sem as telas do instalador) e reabrindo o Estúdio no fim
    instalarAgora: () => u.quitAndInstall(true, true),
  };
};
