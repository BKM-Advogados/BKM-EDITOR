// Remover fundo pela interface. O botão do inspector (e o pedido da ferramenta remover_fundo do Claude, que chega do
// processo principal) seguem o mesmo caminho: o modelo baixa no primeiro uso (a pessoa confirma, com nome, tamanho e
// licença; o andamento aparece no aviso), os bytes vão uma vez para o Web Worker (removerFundo.worker.ts), a foto do
// projeto vai como arquivo e o PNG sem fundo volta para o main gravar em midia/<arquivo>.sem-fundo.png. A camada passa
// a usar o novo e guarda o original em src_original ("Voltar ao original").
import type {CamadaImagem} from '../../../nucleo/documentos';
import {patchSemFundo, patchVoltarAoOriginal} from '../../../nucleo/remover-fundo';
import {aplicar, avisar} from '../../estado/loja';
import {confirmar} from '../../componentes/Dialogo';
import {urlMidia} from './comum';
import type {PedidoWorker, RespostaWorker} from './removerFundo.worker';

type SemId<T> = T extends unknown ? Omit<T, 'id'> : never;

let trabalhador: Worker | null = null;
let seq = 0;
const esperando = new Map<number, (r: RespostaWorker) => void>();

const pedir = (p: SemId<PedidoWorker>, transferir: Transferable[] = []) => {
  trabalhador ??= (() => {
    const w = new Worker(new URL('./removerFundo.worker.ts', import.meta.url), {type: 'module'});
    w.addEventListener('message', (e: MessageEvent<RespostaWorker>) => {
      esperando.get(e.data.id)?.(e.data);
      esperando.delete(e.data.id);
    });
    w.addEventListener('error', (e) => {
      // worker que não sobe (wasm bloqueado, arquivo faltando): todos os pedidos em curso falham com o motivo
      for (const [id, f] of esperando) f({id, ok: false, mensagem: e.message || 'o worker do remover fundo não abriu'});
      esperando.clear();
      trabalhador = null;
      carregado = null;
    });
    return w;
  })();
  const id = ++seq;
  return new Promise<RespostaWorker & {ok: true}>((ok, falha) => {
    esperando.set(id, (r) => (r.ok ? ok(r) : falha(new Error(r.mensagem))));
    trabalhador!.postMessage({...p, id}, transferir);
  });
};

let carregado: Promise<unknown> | null = null;
const megas = (n: number) => `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** Modelo na máquina e no worker. Com `perguntar`, a pessoa confirma o download (o Claude pede pela ferramenta, que já
 *  diz na descrição que baixa no primeiro uso). Devolve false se a pessoa não quis. */
const prepararModelo = async (perguntar: boolean) => {
  const api = window.estudio.removerFundo;
  const e = await api.modelo();
  if (!e.pronto) {
    if (perguntar && !(await confirmar({titulo: 'Baixar o modelo de remover fundo?', botao: 'Baixar',
      texto: `${e.nome}, ${megas(e.bytes)}, licença ${e.licenca} (uso comercial liberado). Vai para ${e.pasta} uma vez só; depois funciona sem internet.`}))) return false;
    const parar = api.aoProgresso((p) => avisar(`Baixando o modelo de remover fundo: ${Math.round((p.recebidos / p.total) * 100)}%`));
    try {
      await api.baixar();
    } finally {
      parar();
    }
  }
  carregado ??= api.ler().then((bytes) => pedir({tipo: 'carregar', modelo: bytes}, [bytes.buffer as ArrayBuffer])).catch((erro: unknown) => {
    carregado = null;
    throw erro;
  });
  await carregado;
  return true;
};

const dataUrl = (b: Blob) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(new Error('não deu para ler o PNG gerado'));
    r.readAsDataURL(b);
  });

/** PNG sem fundo (data URL) de uma imagem do projeto e o tempo do modelo em ms. */
export const calcularSemFundo = async (src: string) => {
  const r = await fetch(urlMidia(src));
  if (!r.ok) throw new Error(`não achei ${src} no projeto`);
  const saida = await pedir({tipo: 'rodar', arquivo: await r.blob()});
  if (!saida.png) throw new Error('o modelo não devolveu imagem');
  return {png: await dataUrl(saida.png), ms: saida.ms ?? 0, entrada: saida.entrada};
};

let ocupado = false;

/** O botão "Remover fundo" de uma camada de imagem. */
export const removerFundoDaCamada = async (documento: string, caminho: string, c: CamadaImagem) => {
  const original = c.src_original ?? c.src;
  if (!original || ocupado) return false;
  ocupado = true;
  try {
    if (!(await prepararModelo(true))) return false;
    avisar(`Removendo o fundo de ${original}…`);
    const t0 = performance.now();
    const r = await calcularSemFundo(original);
    const novo = await window.estudio.removerFundo.gravar(original, r.png);
    const ok = await aplicar(documento, patchSemFundo(c, caminho, novo), `fundo removido de ${c.id}`);
    if (ok) avisar(`Fundo removido em ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s (modelo: ${r.ms} ms). O original continua em ${original}.`, 'ok');
    return ok;
  } catch (e) {
    avisar(`Remover fundo falhou: ${(e as Error).message}`, 'erro');
    return false;
  } finally {
    ocupado = false;
  }
};

export const voltarAoOriginal = (documento: string, caminho: string, c: CamadaImagem) =>
  aplicar(documento, patchVoltarAoOriginal(c, caminho), `${c.id} volta ao original`);

/** Pedido da ferramenta remover_fundo (pedidosRemoverFundo.ts): o main já baixou o modelo; aqui só carrega, calcula
 *  e devolve o PNG. */
export const atenderPedido = async (id: string, src: string) => {
  try {
    await prepararModelo(false);
    avisar(`O Claude pediu para remover o fundo de ${src}…`);
    const r = await calcularSemFundo(src);
    window.estudio.removerFundo.responder(id, {ok: true, png: r.png, ms: r.ms});
  } catch (e) {
    window.estudio.removerFundo.responder(id, {ok: false, mensagem: (e as Error).message});
  }
};
