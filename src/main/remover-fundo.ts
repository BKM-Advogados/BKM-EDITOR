// Remover fundo, o lado do processo principal: baixa o modelo no primeiro uso para %USERPROFILE%\Estudio\modelos\<id>\
// (endereço com revisão travada, SHA-256 conferido, progresso para a janela), entrega os bytes à interface, que roda o
// ONNX num Web Worker, e grava o PNG que volta em midia/<arquivo>.sem-fundo.png sem tocar no arquivo da pessoa. A
// ferramenta remover_fundo do MCP também passa por aqui: pede o PNG à janela (que pode estar em qualquer área) e o
// patch fica por conta da ferramenta. Sem o modelo, nada quebra: a função só fica indisponível com o aviso. Sem
// Electron neste arquivo: o registro recebe `lidar`, `ouvir`, `enviar` e a rede do main.ts, e os testes chamam
// `baixarModelo` e `gravarSemFundo` direto.
import {createHash, randomUUID} from 'node:crypto';
import {createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CANAL, type RespostaFundo} from '../compartilhado/api';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {caminhoSemFundo, definirRemovedorDeFundo, MODELO_FUNDO, type EstadoModeloFundo, type ModeloFundo} from '../nucleo/remover-fundo';

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
  let recebidos = 0;
  let avisado = 0;
  try {
    const leitor = r.body.getReader();
    for (;;) {
      const {done, value} = await leitor.read();
      if (done) break;
      recebidos += value.byteLength;
      if (recebidos > m.bytes) throw new Error(`o arquivo veio maior que os ${m.bytes} bytes esperados`);
      hash.update(value);
      if (!saida.write(value)) await new Promise<void>((ok) => saida.once('drain', () => ok()));
      if (recebidos - avisado >= m.bytes / 100 || recebidos === m.bytes) {
        avisado = recebidos;
        o.aoProgresso?.(recebidos, m.bytes);
      }
    }
    await new Promise<void>((ok, falha) => saida.end((e?: Error | null) => (e ? falha(e) : ok())));
    const sha = hash.digest('hex');
    if (recebidos !== m.bytes || sha !== m.sha256) throw new Error(`o modelo baixado não confere (${recebidos} bytes, SHA-256 ${sha.slice(0, 12)}…): nada foi instalado`);
    renameSync(parcial, destino);
  } catch (e) {
    saida.destroy();
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

/** Grava o PNG (data URL) ao lado do original, em midia/; devolve o caminho no projeto. Nunca escreve no original. */
export const gravarSemFundo = (projeto: Pick<Projeto, 'caminho'>, src: string, png: string) => {
  const rel = caminhoSemFundo(src).replace(/\\/g, '/');
  if (rel === src.replace(/\\/g, '/')) throw new ErroProjeto('o arquivo sem fundo não pode ser o original', 'caminho');
  const abs = projeto.caminho(rel);
  mkdirSync(path.dirname(abs), {recursive: true});
  writeFileSync(abs, Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'));
  return rel;
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
