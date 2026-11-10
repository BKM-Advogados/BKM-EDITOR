// IPC da gravação de narração (rodada 3, frente Som): a interface captura o microfone e entrega o WAV pronto (PCM 48 kHz,
// src/nucleo/gravacao.ts); aqui o cabeçalho é conferido e o arquivo vai para midia/ com um nome que ainda não existe, sem
// nunca sobrescrever uma tomada. O envelope é medido pela interface quando o clipe entra (adicionarClipeAudio), como o de
// qualquer áudio. Registrado no main.ts com uma linha.
import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CANAL} from '../compartilhado/api';
import {lerCabecalhoWav, nomeDaTomada, TAXA_GRAVACAO} from '../nucleo/gravacao';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';

const LIMITE_BYTES = 1024 * 1024 * 1024; // 1 GB: mais de 1 h de WAV mono de 24 bits a 48 kHz

/** Grava a tomada em midia/narracao-gravada[-N].wav; devolve o caminho no projeto. */
export const salvarTomada = (p: Projeto, dados: ArrayBuffer | Uint8Array): string => {
  const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
  if (bytes.byteLength > LIMITE_BYTES) throw new ErroProjeto('a tomada passa de 1 GB', 'caminho');
  const c = lerCabecalhoWav(bytes);
  if ('erro' in c) throw new ErroProjeto(`tomada recusada: ${c.erro}`);
  if (c.taxa !== TAXA_GRAVACAO) throw new ErroProjeto(`tomada recusada: ${c.taxa} Hz (a gravação é de ${TAXA_GRAVACAO} Hz)`);
  if (c.amostras < 1) throw new ErroProjeto('tomada recusada: o WAV não tem som');
  const rel = nomeDaTomada((r) => p.existe(r));
  const destino = p.caminho(rel);
  mkdirSync(path.dirname(destino), {recursive: true});
  const tmp = `${destino}.${process.pid}.tmp`; // o observador da pasta ignora .tmp: a interface só vê o arquivo inteiro
  writeFileSync(tmp, bytes);
  renameSync(tmp, destino);
  return path.relative(p.raiz, destino).split(path.sep).join('/');
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcGravacao = (lidar: Lidar, projeto: () => Projeto) => {
  lidar(CANAL.audioSalvarTomada, (wav: ArrayBuffer) => salvarTomada(projeto(), wav));
};
