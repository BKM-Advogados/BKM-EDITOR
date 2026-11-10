// Captura do microfone para a narração (rodada 3, frente Som). Sem nada do navegador "melhorando" a voz: cancelamento de eco,
// supressão de ruído e ganho automático desligados (RESTRICOES_MICROFONE), mono, 48 kHz; a limpeza de voz vem depois, a
// pedido, e o original fica. As amostras vêm de um ScriptProcessorNode: o AudioWorklet pediria um arquivo de módulo que a
// política de segurança da janela (script-src 'self') só aceita empacotado, e o ScriptProcessor, que o Chromium ainda
// mantém, não precisa de arquivo nenhum. O monitoramento (ouvir a si mesmo nos fones) é um ganho à parte, desligado por
// padrão: sem fones, o microfone pega o som do alto-falante.
import {codificarWavPcm, juntarPedacos, niveisDoPedaco, PICO_CORTADO_DB, RESTRICOES_MICROFONE, TAXA_GRAVACAO} from '../../../nucleo/gravacao';

export type NivelGravacao = {pico_db: number; rms_db: number; cortou: boolean};
export type Tomada = {wav: Uint8Array; duracao_ms: number; pico_db: number; cortou: boolean};
export type SessaoGravacao = {
  /** Para, fecha o microfone e codifica o WAV (PCM de 24 bits, 48 kHz, mono). */
  parar: () => Promise<Tomada>;
  /** Para e joga fora. */
  cancelar: () => void;
  /** Liga ou desliga a escuta da própria voz nos fones. */
  monitor: (ligado: boolean) => void;
  /** Tempo gravado até agora (ms). */
  decorrido: () => number;
};

/** Microfones disponíveis (os nomes só aparecem depois que a pessoa deu permissão). */
export const listarMicrofones = async (): Promise<{id: string; nome: string}[]> => {
  const todos = await navigator.mediaDevices.enumerateDevices();
  return todos.filter((d) => d.kind === 'audioinput').map((d, i) => ({id: d.deviceId, nome: d.label || `Microfone ${i + 1}`}));
};

export const iniciarGravacao = async (o: {dispositivo?: string; monitor: boolean; aoNivel: (n: NivelGravacao) => void}): Promise<SessaoGravacao> => {
  const stream = await navigator.mediaDevices.getUserMedia({audio: {...RESTRICOES_MICROFONE, ...(o.dispositivo ? {deviceId: {exact: o.dispositivo}} : {})}});
  const ctx = new AudioContext({sampleRate: TAXA_GRAVACAO});
  if (ctx.sampleRate !== TAXA_GRAVACAO) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error(`o sistema abriu o áudio a ${ctx.sampleRate} Hz; a gravação precisa de ${TAXA_GRAVACAO} Hz`);
  }
  const fonte = ctx.createMediaStreamSource(stream);
  const captura = ctx.createScriptProcessor(4096, 1, 1);
  const escuta = ctx.createGain();
  escuta.gain.value = o.monitor ? 1 : 0;
  const pedacos: Float32Array[] = [];
  let amostras = 0;
  let pico = -100;
  let cortou = false;
  let ativa = true;
  captura.onaudioprocess = (e) => {
    if (!ativa) return;
    const x = new Float32Array(e.inputBuffer.getChannelData(0)); // copia: o navegador reaproveita o buffer
    pedacos.push(x);
    amostras += x.length;
    const n = niveisDoPedaco(x);
    pico = Math.max(pico, n.pico_db);
    if (n.pico_db > PICO_CORTADO_DB) cortou = true;
    o.aoNivel({...n, cortou});
  };
  fonte.connect(captura);
  captura.connect(ctx.destination); // o ScriptProcessor só anda ligado ao destino; ele não escreve saída, então não vaza som
  fonte.connect(escuta);
  escuta.connect(ctx.destination);
  const fechar = async () => {
    ativa = false;
    captura.onaudioprocess = null;
    fonte.disconnect();
    captura.disconnect();
    escuta.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
  };
  return {
    parar: async () => {
      await fechar();
      const todas = juntarPedacos(pedacos);
      return {wav: codificarWavPcm([todas], TAXA_GRAVACAO, 24), duracao_ms: Math.round((todas.length / TAXA_GRAVACAO) * 1000), pico_db: pico, cortou};
    },
    cancelar: () => void fechar(),
    monitor: (ligado) => {
      escuta.gain.value = ligado ? 1 : 0;
    },
    decorrido: () => Math.round((amostras / TAXA_GRAVACAO) * 1000),
  };
};
