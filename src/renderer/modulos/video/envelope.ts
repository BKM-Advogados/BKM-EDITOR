// Mede o envelope de loudness de um arquivo de áudio do projeto na própria interface: baixa pelo servidor de mídia,
// decodifica com Web Audio e passa as amostras ao núcleo (ponderação K, janelas de 50 ms). O resultado vai ao processo
// principal, que grava midia/<arquivo>.envelope.json; o observador da pasta avisa e as props dos vídeos ganham a forma
// de onda e o ducking. Cada arquivo é medido uma vez por sessão; o que falhar não é tentado de novo até trocar de projeto.
import {envelopeDeAmostras, type AudioP, type Envelope} from '../../../nucleo/audio';
import {loja, quandoTrocarProjeto} from '../../estado/loja';

/** URL de um arquivo do projeto para a interface (o mesmo que a composição faz em midia.ts). */
export const urlDaMidia = (arquivo: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(arquivo)) return arquivo;
  const base = loja.get().info?.base_midia?.replace(/\/+$/, '');
  return base ? `${base}/${arquivo.split('/').map(encodeURIComponent).join('/')}` : arquivo;
};

let contexto: AudioContext | null = null;

export const medirArquivo = async (arquivo: string): Promise<Envelope> => {
  const r = await fetch(urlDaMidia(arquivo));
  if (!r.ok) throw new Error(`não deu para baixar ${arquivo} (${r.status})`);
  contexto ??= new AudioContext();
  const buffer = await contexto.decodeAudioData(await r.arrayBuffer());
  const canais = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
  return envelopeDeAmostras(canais, buffer.sampleRate);
};

const emAndamento = new Map<string, Promise<Envelope>>();
const falhados = new Set<string>();
quandoTrocarProjeto(() => {
  emAndamento.clear();
  falhados.clear();
});

/** Mede e grava o envelope de um arquivo (uma vez por sessão); devolve o envelope. */
export const garantirEnvelope = (arquivo: string): Promise<Envelope> => {
  let p = emAndamento.get(arquivo);
  if (!p) {
    p = medirArquivo(arquivo).then(async (env) => {
      await window.estudio.audio.gravarEnvelope(arquivo, env);
      return env;
    });
    p.catch(() => {
      emAndamento.delete(arquivo);
      falhados.add(arquivo);
    });
    emAndamento.set(arquivo, p);
  }
  return p;
};

/** Clipes do vídeo que ainda não têm envelope nas props: mede em segundo plano (arquivo trocado à mão, projeto vindo de outro PC). */
export const medirPendentes = (props: {audio?: AudioP} | null | undefined) => {
  for (const f of props?.audio?.faixas ?? []) {
    for (const c of f.clipes) if (!c.envelope && !falhados.has(c.arquivo)) void garantirEnvelope(c.arquivo).catch(() => undefined);
  }
};
