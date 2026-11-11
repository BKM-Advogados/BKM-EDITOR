// O app que não perde trabalho (melhoria 8 da rodada 3). Duas decisões do processo principal, escritas à parte do Electron
// para terem teste:
//  - transversal-D5: um atalho clicado duas vezes abria dois Estúdios no mesmo projeto, que disputavam o git, o
//    observador e as preferências. A segunda instância só traz a primeira para a frente e sai.
//  - transversal-D6: o renderer que cai por falta de memória deixava a janela branca até fechar o app. A janela recarrega
//    (o projeto segue aberto no processo principal, a tela o relê), mas não em laço: depois de repetidas quedas seguidas
//    o app avisa em vez de recarregar de novo.

import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** O pedaço do `app` do Electron que a trava usa. */
export type AppComTrava = {
  requestSingleInstanceLock: () => boolean;
  quit: () => void;
  on: (evento: 'second-instance', f: (evento?: unknown, argv?: string[], cwd?: string) => void) => unknown;
};

/** Pede a trava; sem ela, esta é a segunda instância e sai. Com ela, `aoOutraInstancia` roda quando alguém abre o app de
 *  novo, com os argumentos e a pasta da segunda abertura (uma pasta de projeto passada a ela abre na primeira). */
export const garantirInstanciaUnica = (app: AppComTrava, aoOutraInstancia: (argv: string[], cwd: string) => void): boolean => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', (_e, argv, cwd) => aoOutraInstancia(argv ?? [], cwd ?? ''));
  return true;
};

/** O pedaço da janela que "trazer para a frente" usa. */
export type JanelaParaFrente = {isDestroyed: () => boolean; isMinimized: () => boolean; restore: () => void; show: () => void; focus: () => void};

export const trazerParaFrente = (janela: JanelaParaFrente | null): void => {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
};

// ---------- renderer que caiu ----------
/** Razões do `render-process-gone` em que recarregar não ajuda ou não foi a queda: a pessoa/ o app fechou o processo. */
const RAZOES_SEM_RECARGA = ['clean-exit'];
export const MAX_RECARGAS = 3;
export const JANELA_RECARGAS_MS = 60_000;

export type DecisaoDeRecarga = {recarregar: true; recargas: number[]} | {recarregar: false; recargas: number[]; motivo: 'saida_normal' | 'cai_em_laco'};

/** Recarrega, a menos que a saída tenha sido normal ou o renderer já tenha caído `MAX_RECARGAS` vezes no último minuto.
 *  `recargas` são os instantes (ms) das recargas recentes; devolve a lista nova. */
export const decidirRecarga = (razao: string, recargas: number[], agora: number): DecisaoDeRecarga => {
  const recentes = recargas.filter((t) => agora - t < JANELA_RECARGAS_MS);
  if (RAZOES_SEM_RECARGA.includes(razao)) return {recarregar: false, recargas: recentes, motivo: 'saida_normal'};
  if (recentes.length >= MAX_RECARGAS) return {recarregar: false, recargas: recentes, motivo: 'cai_em_laco'};
  return {recarregar: true, recargas: [...recentes, agora]};
};

/** Texto para a pessoa quando o renderer cai demais: o que houve e o que fazer (o trabalho já está gravado). */
export const avisoDeQuedaEmLaco = (razao: string): string =>
  `A tela do Estúdio parou ${MAX_RECARGAS + 1} vezes seguidas (${razao}). Tudo o que você editou já está gravado no projeto. ` +
  'Feche o Estúdio e abra de novo; se repetir, feche outros programas para liberar memória.';

// ---------- só a página do app (auditoria do processo principal, P5) ----------
// Um arquivo solto na janela faz o Chromium navegar para file://…, e a página nova herdaria o preload com window.estudio.
// A janela só aceita a própria página: o index.html do pacote (comparado pelo caminho, sem depender de como cada lado
// codifica a URL nem da caixa da letra do drive no Windows) ou a origem do Vite em desenvolvimento.

export type PaginaDoApp = {dev?: string; indexHtml: string; windows?: boolean};

/** Caminho absoluto comparável: no Windows com a letra da unidade (um "\x\y" ganha a da pasta atual, como o
 *  pathToFileURL faz), barras invertidas, sem o prefixo "\\?\" e sem diferenciar maiúsculas; em todos, acentos em NFC
 *  (o macOS pode devolver o nome decomposto). */
const caminhoComparavel = (p: string, windows: boolean) => {
  if (!windows) return path.posix.resolve(p).normalize('NFC');
  const semPrefixo = p.replace(/^[\\/]{2}\?[\\/](?:UNC[\\/])?/i, (m) => (/UNC/i.test(m) ? '\\\\' : ''));
  return path.win32.resolve(semPrefixo).normalize('NFC').toLowerCase();
};

export const ehPaginaDoApp = (url: string | undefined, app: PaginaDoApp): boolean => {
  try {
    const u = new URL(url ?? '');
    if (app.dev) return u.origin === new URL(app.dev).origin;
    if (u.protocol !== 'file:') return false;
    // uma decisão só de sistema para ler a URL e para comparar (antes, a URL seguia o process.platform e a comparação
    // seguia o app.windows: sem ele no Windows, "D:\…" era comparado com "/…" e a página do app era recusada)
    const windows = app.windows ?? process.platform === 'win32';
    return caminhoComparavel(fileURLToPath(u, {windows}), windows) === caminhoComparavel(app.indexHtml, windows);
  } catch {
    return false;
  }
};

/** O que a tela pode pedir: o microfone (só áudio, gravação da narração), copiar para a área de transferência e a tela
 *  cheia da prévia. Câmera, localização, notificações etc. ficam recusadas. */
export const permissaoLiberada = (permissao: string, detalhes: {mediaTypes?: string[]}): boolean =>
  ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permissao)
  && (permissao !== 'media' || (detalhes.mediaTypes ?? []).every((t) => t === 'audio'));
