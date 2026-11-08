// Mídia grande fora do git (transversal-D7). O commit automático faz `git add -A`: um vídeo bruto de 1,5 GB em midia/ ia
// parar no .git e o projeto ocupava o dobro. Duas regras, as duas só para midia/:
//  - por extensão: vídeo e áudio sem perda nunca entram (REGRAS_MIDIA_PESADA, já no .gitignore do projeto novo);
//  - por tamanho: qualquer outro arquivo acima de LIMITE_MIDIA_BYTES entra no .gitignore pelo caminho exato antes do commit.
// Os JSON ao lado (transcrições, marcas, envelopes) seguem versionados: são pequenos e são o trabalho da pessoa. Quem já
// entrou no histórico continua nele; a regra vale daqui para a frente.

import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

export const EXTENSOES_PESADAS =['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts', 'mxf', 'flac', 'aif', 'aiff'];
export const LIMITE_MIDIA_BYTES = 25 * 1024 * 1024;
export const PASTA_MIDIA = 'midia';

export const REGRAS_MIDIA_PESADA = EXTENSOES_PESADAS.map((e) => `${PASTA_MIDIA}/**/*.${e}`);

export type ArquivoDaMidia = {rel: string; tamanho: number};

const extensao = (rel: string) => (rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '');

/** Linhas de .gitignore que faltam: `ignoradas` são as linhas que o .gitignore já tem. Sem repetir o que já está. */
export const regrasQueFaltam = (arquivos: ArquivoDaMidia[], ignoradas: string[], limite = LIMITE_MIDIA_BYTES): string[] => {
  const tem = new Set(ignoradas.map((l) => l.trim()));
  const novas: string[] = [];
  for (const regra of REGRAS_MIDIA_PESADA) if (!tem.has(regra)) novas.push(regra);
  for (const a of arquivos) {
    const rel = a.rel.split('\\').join('/');
    if (!rel.startsWith(`${PASTA_MIDIA}/`) || a.tamanho <= limite) continue;
    if (EXTENSOES_PESADAS.includes(extensao(rel))) continue; // já coberto pela regra da extensão
    if (!tem.has(rel) && !novas.includes(rel)) novas.push(rel);
  }
  return novas;
};

/** O .gitignore com as linhas novas no fim, ou o mesmo texto se não falta nada. */
export const gitignoreComMidiaPesada = (texto: string, arquivos: ArquivoDaMidia[], limite = LIMITE_MIDIA_BYTES): string => {
  const novas = regrasQueFaltam(arquivos, texto.split(/\r?\n/), limite);
  if (!novas.length) return texto;
  const separador = texto && !texto.endsWith('\n') ? '\n' : '';
  const cabecalho = texto.includes('# mídia pesada') ? '' : '# mídia pesada fica fora do git (vídeo, áudio sem perda e o que passa de 25 MB)\n';
  return `${texto}${separador}${cabecalho}${novas.join('\n')}\n`;
};

/** Arquivos de midia/ (até 4 níveis de pasta) com o tamanho, caminhos relativos à raiz do projeto com "/". */
export const arquivosDaMidia = (raiz: string, profundidade = 4): ArquivoDaMidia[] => {
  const saida: ArquivoDaMidia[] = [];
  const andar = (rel: string, nivel: number) => {
    let itens;
    try {
      itens = readdirSync(path.join(raiz, rel), {withFileTypes: true});
    } catch {
      return;
    }
    for (const item of itens) {
      const relItem = `${rel}/${item.name}`;
      if (item.isDirectory()) {
        if (nivel < profundidade) andar(relItem, nivel + 1);
      } else if (item.isFile()) {
        try {
          saida.push({rel: relItem, tamanho: statSync(path.join(raiz, relItem)).size});
        } catch {
          /* sumiu entre a lista e a medida */
        }
      }
    }
  };
  if (existsSync(path.join(raiz, PASTA_MIDIA))) andar(PASTA_MIDIA, 1);
  return saida;
};
