// Web Worker do remover fundo: recebe os bytes do modelo uma vez e, a cada foto, o arquivo; devolve o PNG com o fundo
// transparente. Tudo fora da thread da interface: decodificar, reduzir para a entrada do modelo, rodar o ONNX
// (onnxruntime-web em WASM, numa thread só: a janela não é cross-origin isolated, e assim o worker não precisa de
// SharedArrayBuffer), ampliar o alfa para a foto inteira e codificar o PNG. A foto sai com as cores dela; só o alfa muda.
import * as ort from 'onnxruntime-web/wasm';
import urlWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import {MODELO_FUNDO, tamanhoDaEntrada} from '../../../nucleo/remover-fundo';

export type PedidoWorker = {id: number; tipo: 'carregar'; modelo: Uint8Array} | {id: number; tipo: 'rodar'; arquivo: Blob};
export type RespostaWorker = {id: number; ok: true; png?: Blob; ms?: number; entrada?: {w: number; h: number}} | {id: number; ok: false; mensagem: string};

const responder = (r: RespostaWorker) => (self as unknown as Worker).postMessage(r);

let sessao: Promise<ort.InferenceSession> | null = null;

const carregar = (modelo: Uint8Array) => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {wasm: urlWasm};
  sessao = ort.InferenceSession.create(modelo, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
  return sessao;
};

const contexto2d = (c: OffscreenCanvas) => {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível no worker');
  return ctx;
};

const rodar = async (arquivo: Blob) => {
  if (!sessao) throw new Error('o modelo ainda não foi carregado');
  const s = await sessao;
  const foto = await createImageBitmap(arquivo);
  try {
    const iw = foto.width;
    const ih = foto.height;
    const {w, h} = tamanhoDaEntrada(iw, ih);
    const pequena = new OffscreenCanvas(w, h);
    const pc = contexto2d(pequena);
    pc.imageSmoothingQuality = 'high';
    pc.drawImage(foto, 0, 0, w, h);
    const px = pc.getImageData(0, 0, w, h).data;
    // RGB em planos separados, (x/255 − média) / desvio
    const plano = w * h;
    const entrada = new Float32Array(3 * plano);
    const {media, desvio} = MODELO_FUNDO;
    for (let i = 0; i < plano; i++) {
      entrada[i] = (px[i * 4] / 255 - media) / desvio;
      entrada[plano + i] = (px[i * 4 + 1] / 255 - media) / desvio;
      entrada[2 * plano + i] = (px[i * 4 + 2] / 255 - media) / desvio;
    }
    const nomeEntrada = s.inputNames.includes(MODELO_FUNDO.entrada) ? MODELO_FUNDO.entrada : s.inputNames[0];
    const nomeSaida = s.outputNames.includes(MODELO_FUNDO.saida) ? MODELO_FUNDO.saida : s.outputNames[0];
    const t0 = performance.now();
    const r = await s.run({[nomeEntrada]: new ort.Tensor('float32', entrada, [1, 3, h, w])});
    const ms = Math.round(performance.now() - t0);
    const alfa = r[nomeSaida].data as Float32Array;
    // o alfa do modelo (h × w, de 0 a 1) numa imagem pequena, ampliada com suavização para o tamanho da foto
    const mascara = pc.createImageData(w, h);
    for (let i = 0; i < plano; i++) mascara.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alfa[i])) * 255);
    pc.clearRect(0, 0, w, h);
    pc.putImageData(mascara, 0, 0);
    const grande = new OffscreenCanvas(iw, ih);
    const gc = contexto2d(grande);
    gc.imageSmoothingQuality = 'high';
    gc.drawImage(pequena, 0, 0, iw, ih);
    gc.globalCompositeOperation = 'source-in';
    gc.drawImage(foto, 0, 0);
    return {png: await grande.convertToBlob({type: 'image/png'}), ms, entrada: {w, h}};
  } finally {
    foto.close();
  }
};

self.addEventListener('message', (e: MessageEvent<PedidoWorker>) => {
  const p = e.data;
  void (async () => {
    try {
      if (p.tipo === 'carregar') {
        await carregar(p.modelo);
        responder({id: p.id, ok: true});
      } else responder({id: p.id, ok: true, ...(await rodar(p.arquivo))});
    } catch (erro) {
      if (p.tipo === 'carregar') sessao = null;
      responder({id: p.id, ok: false, mensagem: (erro as Error)?.message ?? String(erro)});
    }
  })();
});
