// Mede o envelope de loudness de um arquivo de áudio do projeto na própria interface: baixa pelo servidor de mídia,
// decodifica com Web Audio e passa as amostras ao núcleo (ponderação K, janelas de 50 ms). O resultado vai ao processo
// principal, que grava midia/<arquivo>.envelope.json com o carimbo do arquivo (tamanho, data e sha256); o observador da
// pasta avisa e as props dos vídeos ganham a forma de onda e o ducking. Cada arquivo é medido uma vez por sessão, até ele
// mudar no disco (tomada nova gravada com o mesmo nome): aí a medida é esquecida e os vídeos que o tocam são montados de
// novo; o processo principal vê que o carimbo não confere, e a linha do tempo mede outra vez. O que falhar não é tentado
// de novo até o arquivo mudar ou trocar de projeto.
import {envelopeDeAmostras, type AudioCenas, type AudioP, type Envelope} from '../../../nucleo/audio';
import {carregarDoc, loja, quandoTrocarProjeto} from '../../estado/loja';

/** URL de um arquivo do projeto para a interface (o mesmo que a composição faz em midia.ts). */
export const urlDaMidia = (arquivo: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(arquivo)) return arquivo;
  const base = loja.get().info?.base_midia?.replace(/\/+$/, '');
  return base ? `${base}/${arquivo.split('/').map(encodeURIComponent).join('/')}` : arquivo;
};

let contexto: AudioContext | null = null;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** Envelope do arquivo como ele está agora, com `fonte` = tamanho e sha256 dos bytes medidos (o processo principal confere
 *  com o disco ao gravar e recusa se o arquivo mudou no meio). */
export const medirArquivo = async (arquivo: string): Promise<Envelope> => {
  const r = await fetch(urlDaMidia(arquivo), {cache: 'no-store'}); // a tomada regravada tem o mesmo endereço
  if (!r.ok) throw new Error(`não deu para baixar ${arquivo} (${r.status})`);
  const bytes = await r.arrayBuffer();
  const tamanho = bytes.byteLength;
  // antes do decodeAudioData, que esvazia o buffer
  const sha256 = globalThis.crypto?.subtle ? hex(await globalThis.crypto.subtle.digest('SHA-256', bytes)) : undefined;
  contexto ??= new AudioContext();
  const buffer = await contexto.decodeAudioData(bytes);
  const canais = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
  return {...envelopeDeAmostras(canais, buffer.sampleRate), fonte: {tamanho, ...(sha256 ? {sha256} : {})}};
};

const emAndamento = new Map<string, Promise<Envelope>>();
const falhados = new Set<string>();
quandoTrocarProjeto(() => {
  emAndamento.clear();
  falhados.clear();
});

const AUDIO = /\.(wav|mp3|m4a|ogg|aac)$/i;
let ouvindo = false;
/** Arquivo de áudio mudou no disco: esquece a medida e monta de novo os vídeos que o tocam. */
const ouvirMudancas = () => {
  if (ouvindo) return;
  ouvindo = true;
  window.estudio.aoMudar(({arquivo}) => {
    if (!AUDIO.test(arquivo)) return;
    emAndamento.delete(arquivo);
    falhados.delete(arquivo);
    const e = loja.get();
    for (const d of e.info?.manifesto.documentos ?? []) {
      if (d.modulo !== 'video') continue;
      const audio = (e.docs[d.id]?.doc as {audio?: AudioCenas} | undefined)?.audio;
      if (audio?.faixas?.some((f) => f.clipes?.some((c) => c.arquivo === arquivo))) void carregarDoc(d.id);
    }
  });
};

/** Mede e grava o envelope de um arquivo (uma vez por sessão, até ele mudar); devolve o envelope. */
export const garantirEnvelope = (arquivo: string): Promise<Envelope> => {
  ouvirMudancas();
  let p = emAndamento.get(arquivo);
  if (!p) {
    const esta: Promise<Envelope> = medirArquivo(arquivo).then(async (env) => {
      await window.estudio.audio.gravarEnvelope(arquivo, env);
      return env;
    });
    esta.catch(() => {
      if (emAndamento.get(arquivo) !== esta) return; // o arquivo mudou no meio e já há outra medida
      emAndamento.delete(arquivo);
      falhados.add(arquivo);
    });
    emAndamento.set(arquivo, (p = esta));
  }
  return p;
};

/** Clipes do vídeo que ainda não têm envelope nas props: mede em segundo plano (arquivo trocado à mão, projeto vindo de
 *  outro PC, envelope da 0.3.0 ou de uma tomada que foi regravada). */
export const medirPendentes = (props: {audio?: AudioP} | null | undefined) => {
  ouvirMudancas();
  for (const f of props?.audio?.faixas ?? []) {
    for (const c of f.clipes) if (!c.envelope && !falhados.has(c.arquivo)) void garantirEnvelope(c.arquivo).catch(() => undefined);
  }
};
