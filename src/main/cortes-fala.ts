// Grava a narração emendada dos cortes pela fala (frente Fala; a conta está em src/nucleo/cortes-fala.ts): decodifica a
// fonte com o ffmpeg do Remotion (ffmpeg-som.ts, o mesmo da limpeza de voz), tira os cortes com o crossfade de 8 ms,
// grava midia/<fonte>.cortes-<código>.wav e o palavras.json dele (as palavras que ficam, no tempo novo, com o carimbo do
// WAV novo: a transcrição continua em dia sem rodar o whisper de novo). Sem Electron: o IPC, o MCP e os testes usam igual.
import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {arquivoCortado, conferirCortes, emendarCanais, juntarCortes, palavrasDepoisDosCortes} from '../nucleo/cortes-fala';
import type {PedidoEmenda, ResultadoEmenda} from '../compartilhado/api';
import {arquivoDasPalavras, VERSAO_PALAVRAS, type PalavrasGravadas} from '../nucleo/legendas';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {decodificarAudio, gravarWav} from './ffmpeg-som';
import {fonteDoAudio} from './transcricao';

/** Emenda `fonte` (caminho no projeto) tirando os cortes (ms do arquivo) e grava o WAV e o palavras.json dele. Recusa o
 *  corte que pega palavra ou fica a menos de 80 ms de uma (conferirCortes). */
export const emendarArquivo = async (projeto: Projeto, o: PedidoEmenda & {binarios?: string | null}): Promise<ResultadoEmenda> => {
  if (typeof o.fonte !== 'string' || !projeto.existe(o.fonte)) throw new ErroProjeto(`o arquivo de áudio não está no projeto: ${String(o.fonte)}`, 'nao_achado');
  const cortes = juntarCortes((Array.isArray(o.cortes) ? o.cortes : []).map((c) => ({de_ms: Math.round(Number(c.de_ms)), ate_ms: Math.round(Number(c.ate_ms))})));
  if (!cortes.length) throw new ErroProjeto('nenhum corte para aplicar', 'patch');
  const {canais, taxa} = await decodificarAudio(projeto.caminho(o.fonte), {binarios: o.binarios});
  const antes = Math.round(((canais[0]?.length ?? 0) / taxa) * 1000);
  const {problemas, removidas} = conferirCortes(o.palavras, cortes, {duracao_ms: antes});
  if (problemas.length) throw new ErroProjeto(`cortes recusados: ${problemas.join('; ')}`, 'patch');
  const saida = emendarCanais(canais, taxa, cortes);
  const destino = arquivoCortado(o.fonte, cortes);
  const abs = projeto.caminhoParaGravar(destino);
  mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`; // o observador da pasta ignora .tmp: a interface só vê o arquivo inteiro
  writeFileSync(tmp, gravarWav(saida, taxa));
  renameSync(tmp, abs);
  const fonte = fonteDoAudio(abs);
  const palavras = palavrasDepoisDosCortes(o.palavras, cortes);
  const gravado: PalavrasGravadas = {versao: VERSAO_PALAVRAS, fonte, palavras};
  projeto.gravarTexto(arquivoDasPalavras(destino), `${JSON.stringify(gravado)}\n`);
  return {arquivo: destino, palavras: arquivoDasPalavras(destino), sha256: fonte.sha256, duracao_ms: Math.round(((saida[0]?.length ?? 0) / taxa) * 1000), antes_ms: antes,
    removidas: removidas.map((p) => p.w)};
};
