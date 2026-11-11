// Linux instalado pelo scripts/instalar-linux.sh (~/.local/opt/Estudio): atualização com a confirmação da pessoa.
//
// 1. baixa o Estudio-linux-x64-<versão>.zip da release para ~/.local/opt/Estudio.baixando, calculando o SHA-256 no
//    caminho, e confere com o SHA256SUMS.txt da mesma release (pega download truncado ou corrompido; não protege de
//    uma release adulterada, que traria as duas coisas trocadas);
// 2. extrai com o unzip (ou o bsdtar) e deixa o app em ~/.local/opt/Estudio.novo, conferindo o executável;
// 3. no reinício (depois de fechar o projeto e esperar exportação e gravação), troca a pasta como o script faz, com
//    renomeações no mesmo disco, e reabre pelo executável novo. A pasta antiga sai na abertura seguinte, junto com uma
//    versão preparada que não chegou a ser trocada (o estado da atualização não sobrevive ao fechamento).
//
// A troca só acontece no reinício, e não logo depois do download: com o app aberto, um processo auxiliar do Electron que
// nascesse da pasta trocada seria da versão nova num app da antiga. O atalho (.desktop) e o ícone ficam como estão.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, readdirSync, renameSync, rmSync, statSync} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ReadableStream as ReadableStreamWeb} from 'node:stream/web';
import {lerSomas, urlPermitida, type Novidade} from '../nucleo/atualizacao';
import type {MotorLinux} from './atualizacao';

/** O fetch com corpo em stream (net.fetch do Electron; o fetch do Node nos testes). */
export type BuscarArquivo = (url: string) => Promise<{ok: boolean; status: number; headers: {get: (n: string) => string | null}; body: unknown;
  text: () => Promise<string>}>;
export type Extrair = (zip: string, pasta: string) => Promise<void>;

export const pastasDaTroca = (destino: string) => ({baixando: `${destino}.baixando`, novo: `${destino}.novo`, antigo: `${destino}.antigo`});

/** A pasta do app dentro do que o zip trouxe: a que tem o executável Estudio e resources/ (o zip do Forge traz Estudio-linux-x64/). */
export const acharPastaDoApp = (raiz: string): string | null => {
  const ehApp = (p: string) => existsSync(path.join(p, 'Estudio')) && statSync(path.join(p, 'Estudio')).isFile() && existsSync(path.join(p, 'resources'));
  if (ehApp(raiz)) return raiz;
  for (const nome of readdirSync(raiz)) {
    const p = path.join(raiz, nome);
    if (statSync(p).isDirectory() && ehApp(p)) return p;
  }
  return null;
};

/** Troca a pasta instalada pela nova, como o instalar-linux.sh (renomeações no mesmo disco); se a segunda falhar, volta a antiga. */
export const trocarPastas = (destino: string) => {
  const {novo, antigo} = pastasDaTroca(destino);
  if (!existsSync(novo)) throw new Error('a versão nova não está pronta');
  rmSync(antigo, {recursive: true, force: true});
  if (existsSync(destino)) renameSync(destino, antigo);
  try {
    renameSync(novo, destino);
  } catch (e) {
    if (existsSync(antigo) && !existsSync(destino)) renameSync(antigo, destino);
    throw e;
  }
};

/** Na abertura: a pasta antiga da última troca, um download pela metade e uma versão preparada que ficou sem troca. */
export const limparSobras = async (destino: string) => {
  await Promise.all(Object.values(pastasDaTroca(destino)).map((p) => rm(p, {recursive: true, force: true}))).catch(() => undefined);
};

/** unzip (mantém as permissões do zip do Forge); sem ele, o bsdtar (libarchive). */
export const extrairComUnzip: Extrair = (zip, pasta) => new Promise((ok, falha) => {
  execFile('unzip', ['-q', '-o', zip, '-d', pasta], (erro) => {
    if (!erro) return ok();
    if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') return falha(new Error(`o unzip falhou: ${erro.message}`));
    execFile('bsdtar', ['-xf', zip, '-C', pasta], (e2) => {
      if (!e2) return ok();
      falha(new Error((e2 as NodeJS.ErrnoException).code === 'ENOENT' ? 'falta o unzip para extrair o zip (sudo pacman -S unzip, ou apt install unzip)'
        : `o bsdtar falhou: ${e2.message}`));
    });
  });
});

export const motorLinux = (o: {destino: string; buscar: BuscarArquivo; extrair?: Extrair; reabrir: (executavel: string) => void}): MotorLinux => {
  const {baixando, novo} = pastasDaTroca(o.destino);
  const extrair = o.extrair ?? extrairComUnzip;
  return {
    async preparar(n: Novidade, aoProgresso) {
      try {
        await prepararAgora(n, aoProgresso);
      } catch (e) {
        await rm(baixando, {recursive: true, force: true}).catch(() => undefined); // nada de zip pela metade no disco
        throw e;
      }
    },
    async trocarEReabrir() {
      trocarPastas(o.destino);
      o.reabrir(path.join(o.destino, 'Estudio'));
    },
  };

  async function prepararAgora(n: Novidade, aoProgresso: (fracao: number) => void) {
    const arquivo = n.arquivo;
    if (!arquivo || !urlPermitida(arquivo.url)) throw new Error('a release não tem o zip do Linux');
    if (!n.somas || !urlPermitida(n.somas)) throw new Error('a release não tem o SHA256SUMS.txt');
    const somas = await o.buscar(n.somas);
    if (!somas.ok) throw new Error(`o SHA256SUMS.txt não baixou (${somas.status})`);
    const esperado = lerSomas(await somas.text()).get(arquivo.nome);
    if (!esperado) throw new Error(`o SHA256SUMS.txt não traz ${arquivo.nome}`);

    await rm(baixando, {recursive: true, force: true});
    await mkdir(baixando, {recursive: true});
    const zip = path.join(baixando, arquivo.nome);
    const r = await o.buscar(arquivo.url);
    if (!r.ok || !r.body) throw new Error(`o zip não baixou (${r.status})`);
    const total = Number(r.headers.get('content-length')) || arquivo.tamanho || 0;
    const hash = createHash('sha256');
    let recebido = 0;
    const contar = new Transform({transform(pedaco: Buffer, _c, feito) {
      hash.update(pedaco);
      recebido += pedaco.length;
      if (total) aoProgresso(Math.min(0.95, (recebido / total) * 0.95));
      feito(null, pedaco);
    }});
    await pipeline(Readable.fromWeb(r.body as ReadableStreamWeb), contar, createWriteStream(zip));
    const obtido = hash.digest('hex');
    if (obtido !== esperado) {
      throw new Error(`o SHA-256 do zip não confere com o SHA256SUMS.txt (esperado ${esperado.slice(0, 12)}…, veio ${obtido.slice(0, 12)}…)`);
    }

    const extraido = path.join(baixando, 'extraido');
    await mkdir(extraido, {recursive: true});
    await extrair(zip, extraido);
    const app = acharPastaDoApp(extraido);
    if (!app) throw new Error('o zip não tem o Estudio e a pasta resources');
    if (process.platform !== 'win32' && !(statSync(path.join(app, 'Estudio')).mode & 0o111)) throw new Error('o Estudio do zip veio sem permissão de execução');
    await rm(novo, {recursive: true, force: true});
    renameSync(app, novo);
    await rm(baixando, {recursive: true, force: true});
    aoProgresso(1);
  }
};
