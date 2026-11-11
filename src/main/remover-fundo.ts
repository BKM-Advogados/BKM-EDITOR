// Remover fundo, o lado do processo principal: baixa o modelo no primeiro uso para %USERPROFILE%\Estudio\modelos\<id>\
// (endereço com revisão travada, SHA-256 conferido, progresso para a janela), entrega os bytes à interface, que roda o
// ONNX num Web Worker, e grava o PNG que volta em midia/<arquivo>.<código>.sem-fundo.png sem tocar no arquivo da pessoa
// nem no recorte de outra foto (marca de origem dentro do PNG). A
// ferramenta remover_fundo do MCP também passa por aqui: pede o PNG à janela (que pode estar em qualquer área) e o
// patch fica por conta da ferramenta. Sem o modelo, nada quebra: a função só fica indisponível com o aviso. Sem
// Electron neste arquivo: o registro recebe `lidar`, `ouvir`, `enviar` e a rede do main.ts, e os testes chamam
// `baixarModelo` e `gravarSemFundo` direto.
import {createHash, randomUUID} from 'node:crypto';
import {createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CANAL, type RespostaFundo} from '../compartilhado/api';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {caminhoSemFundo, chaveDoOriginal, definirRemovedorDeFundo, MODELO_FUNDO, type EstadoModeloFundo, type ModeloFundo} from '../nucleo/remover-fundo';

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

const TEMPO_PEDIDO_MS = 180_000; // a janela tem 3 min para devolver o PNG (o primeiro uso carrega o modelo)

export const arquivoDoModelo = (pasta: string, m: ModeloFundo = MODELO_FUNDO) => path.join(pasta, m.id, m.arquivo);

/** Pronto é o arquivo no lugar com o tamanho certo; o SHA-256 é conferido ao baixar e de novo ao ler. */
export const estadoDoModelo = (pasta: string, m: ModeloFundo = MODELO_FUNDO): EstadoModeloFundo => {
  const arquivo = arquivoDoModelo(pasta, m);
  const pronto = existsSync(arquivo) && statSync(arquivo).size === m.bytes;
  return {pronto, id: m.id, nome: m.nome, licenca: m.licenca, bytes: m.bytes, pasta: path.dirname(arquivo)};
};

/** Baixa o modelo em pedaços para "<arquivo>.parcial", conferindo tamanho e SHA-256 antes de pôr no lugar. */
export const baixarModelo = async (o: {pasta: string; buscar: Buscar; aoProgresso?: (recebidos: number, total: number) => void; modelo?: ModeloFundo}) => {
  const m = o.modelo ?? MODELO_FUNDO;
  const destino = arquivoDoModelo(o.pasta, m);
  const parcial = `${destino}.parcial`;
  mkdirSync(path.dirname(destino), {recursive: true});
  const r = await o.buscar(m.url, {redirect: 'follow', headers: {'User-Agent': 'Estudio-BKM (remover fundo)'}});
  if (!r.ok || !r.body) throw new Error(`o download do modelo respondeu ${r.status}`);
  const hash = createHash('sha256');
  const saida = createWriteStream(parcial);
  // como o baixarConferido (transcricao.ts): nunca um 'error' solto que derruba o processo principal, nem um ouvinte
  // novo a cada espera de 'drain' (download grande passaria de 10 e o Node avisaria vazamento)
  let erroEscrita: Error | null = null;
  saida.on('error', (e) => (erroEscrita = e));
  const dreno = () => new Promise<void>((ok, falha) => {
    const fim = (e?: Error) => {
      saida.off('drain', fim);
      saida.off('error', fim);
      if (e) falha(e);
      else ok();
    };
    saida.on('drain', fim);
    saida.on('error', fim);
  });
  let recebidos = 0;
  let avisado = 0;
  const leitor = r.body.getReader();
  try {
    for (;;) {
      const {done, value} = await leitor.read();
      if (done) break;
      if (erroEscrita) throw erroEscrita;
      recebidos += value.byteLength;
      if (recebidos > m.bytes) throw new Error(`o arquivo veio maior que os ${m.bytes} bytes esperados`);
      hash.update(value);
      if (!saida.write(value)) await dreno();
      if (recebidos - avisado >= m.bytes / 100 || recebidos === m.bytes) {
        avisado = recebidos;
        o.aoProgresso?.(recebidos, m.bytes);
      }
    }
    await new Promise<void>((ok, falha) => saida.end((e?: Error | null) => (e ? falha(e) : ok())));
    if (erroEscrita) throw erroEscrita;
    const sha = hash.digest('hex');
    if (recebidos !== m.bytes || sha !== m.sha256) throw new Error(`o modelo baixado não confere (${recebidos} bytes, SHA-256 ${sha.slice(0, 12)}…): nada foi instalado`);
    renameSync(parcial, destino);
  } catch (e) {
    await leitor.cancel().catch(() => undefined); // não segue baixando por trás
    // espera o arquivo fechar antes de apagar: aberto pela metade, ele voltaria depois do rmSync (Windows)
    await new Promise<void>((ok) => (saida.closed ? ok() : (saida.once('close', () => ok()), saida.destroy())));
    rmSync(parcial, {force: true});
    throw e;
  }
  return estadoDoModelo(o.pasta, m);
};

/** Bytes do modelo, com o SHA-256 conferido; arquivo estragado é apagado (o próximo uso baixa de novo). */
export const lerModelo = (pasta: string, m: ModeloFundo = MODELO_FUNDO) => {
  const arquivo = arquivoDoModelo(pasta, m);
  if (!existsSync(arquivo)) throw new Error('o modelo de remover fundo ainda não foi baixado');
  const bytes = readFileSync(arquivo);
  if (createHash('sha256').update(bytes).digest('hex') !== m.sha256) {
    rmSync(arquivo, {force: true});
    throw new Error('o modelo na pasta não confere com o SHA-256 esperado e foi apagado: baixe de novo');
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};

// ---------- marca de origem no PNG ----------
// O recorte leva no próprio PNG um bloco tEXt "Estudio-original" com o caminho do original (o mesmo usado no código do
// nome). Antes de gravar por cima de um arquivo que já existe, a marca tem de ser do mesmo original; senão o recorte
// vai para o nome seguinte ("-2", "-3"…) e o arquivo que estava lá fica intacto.
const CHAVE_ORIGEM = 'Estudio-original';
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TABELA_CRC = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** O PNG com o bloco da origem logo depois do IHDR (o caminho vai em encodeURIComponent: o tEXt é Latin-1). */
export const marcarOrigem = (png: Buffer, original: string) => {
  if (png.length < 33 || !png.subarray(0, 8).equals(ASSINATURA_PNG)) throw new Error('a janela não devolveu um PNG');
  const fimIhdr = 8 + 12 + png.readUInt32BE(8);
  const tipoEDados = Buffer.from(`tEXt${CHAVE_ORIGEM}\0${encodeURIComponent(chaveDoOriginal(original))}`, 'latin1');
  const bloco = Buffer.alloc(8 + tipoEDados.length);
  bloco.writeUInt32BE(tipoEDados.length - 4, 0);
  tipoEDados.copy(bloco, 4);
  bloco.writeUInt32BE(crc32(tipoEDados), 4 + tipoEDados.length);
  return Buffer.concat([png.subarray(0, fimIhdr), bloco, png.subarray(fimIhdr)]);
};

/** O original marcado num PNG; null se não é PNG ou não tem a marca (arquivo que o Estúdio não fez). */
export const origemMarcada = (png: Buffer): string | null => {
  if (png.length < 8 || !png.subarray(0, 8).equals(ASSINATURA_PNG)) return null;
  for (let i = 8; i + 12 <= png.length;) {
    const n = png.readUInt32BE(i);
    const tipo = png.toString('latin1', i + 4, i + 8);
    if (tipo === 'tEXt') {
      const texto = png.toString('latin1', i + 8, i + 8 + n);
      const zero = texto.indexOf('\0');
      if (texto.slice(0, zero) === CHAVE_ORIGEM) {
        try {
          return decodeURIComponent(texto.slice(zero + 1));
        } catch {
          return null;
        }
      }
    }
    if (tipo === 'IDAT' || tipo === 'IEND') break; // a marca do Estúdio vem antes da imagem
    i += 12 + n;
  }
  return null;
};

/** Grava o PNG (data URL) ao lado do original, em midia/ (caminhoSemFundo), com a marca da origem; devolve o caminho
 *  no projeto. O mesmo original grava por cima do recorte dele; arquivo de outro original, ou que não é recorte do
 *  Estúdio, nunca é sobrescrito: o recorte vai para "-2", "-3"… Nunca escreve no original. */
export const gravarSemFundo = (projeto: Pick<Projeto, 'caminho' | 'caminhoParaGravar'>, src: string, png: string) => {
  const base = caminhoSemFundo(src);
  const chave = chaveDoOriginal(src);
  if (chaveDoOriginal(base) === chave) throw new ErroProjeto('o arquivo sem fundo não pode ser o original', 'caminho');
  const bytes = marcarOrigem(Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'), src);
  for (let n = 1; n <= 99; n++) {
    const rel = n === 1 ? base : base.replace(/\.sem-fundo\.png$/, `-${n}.sem-fundo.png`);
    const abs = projeto.caminhoParaGravar(rel);
    if (existsSync(abs) && origemMarcada(readFileSync(abs)) !== chave) continue;
    mkdirSync(path.dirname(abs), {recursive: true});
    writeFileSync(abs, bytes);
    return rel;
  }
  throw new ErroProjeto(`não achei nome livre para o recorte de ${src} em midia/`, 'caminho');
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;
type Deps = {
  ouvir: (canal: string, f: (...a: never[]) => void) => void;
  enviar: (canal: string, ...a: unknown[]) => void;
  projeto: () => Projeto;
  pasta: string;
  buscar: Buscar;
};

/** Registra o IPC e o executor do MCP (duas linhas no main.ts). */
export const registrarRemoverFundo = (lidar: Lidar, d: Deps) => {
  let baixando: Promise<EstadoModeloFundo> | null = null;
  const garantir = () => {
    const e = estadoDoModelo(d.pasta);
    if (e.pronto) return Promise.resolve(e);
    baixando ??= baixarModelo({pasta: d.pasta, buscar: d.buscar, aoProgresso: (recebidos, total) => d.enviar(CANAL.removerFundoProgresso, {recebidos, total})})
      .finally(() => (baixando = null));
    return baixando;
  };

  lidar(CANAL.removerFundoModelo, () => estadoDoModelo(d.pasta));
  lidar(CANAL.removerFundoBaixar, () => garantir());
  lidar(CANAL.removerFundoLer, () => lerModelo(d.pasta));
  lidar(CANAL.removerFundoGravar, (src: string, png: string) => gravarSemFundo(d.projeto(), src, png));

  // pedidos do MCP: a janela calcula e devolve o PNG pelo id do pedido
  const pendentes = new Map<string, {ok: (r: RespostaFundo) => void; relogio: NodeJS.Timeout}>();
  d.ouvir(CANAL.removerFundoResposta, (id: string, r: RespostaFundo) => {
    const p = pendentes.get(id);
    if (!p) return;
    clearTimeout(p.relogio);
    pendentes.delete(id);
    p.ok(r);
  });
  const pedirAJanela = (src: string) =>
    new Promise<RespostaFundo>((ok) => {
      const id = randomUUID();
      const relogio = setTimeout(() => {
        pendentes.delete(id);
        ok({ok: false, mensagem: 'a janela do Estúdio não respondeu em 3 minutos'});
      }, TEMPO_PEDIDO_MS);
      pendentes.set(id, {ok, relogio});
      d.enviar(CANAL.removerFundoPedido, id, src);
    });

  definirRemovedorDeFundo(async (src) => {
    await garantir();
    const r = await pedirAJanela(src);
    if (!r.ok || !r.png) throw new Error(r.mensagem ?? 'a janela não devolveu a imagem');
    return {caminho: gravarSemFundo(d.projeto(), src, r.png), ms: r.ms ?? 0};
  });
};
