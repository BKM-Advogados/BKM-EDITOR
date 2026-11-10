// Faixas de áudio da linha do tempo do vídeo de cenas, abaixo das cenas e dos blocos: cada faixa é uma linha verde com
// o nome e o mudo presos à esquerda; cada clipe é uma barra com a forma de onda (do envelope medido) e a linha do volume
// por cima (faixa × clipe × fades × ducking), então a música cai à vista onde há voz. Arrastar move o clipe no tempo; as
// alças aparam o começo (muda o corte dentro do arquivo, o fim fica no lugar) e o fim; clicar seleciona e o inspector
// mostra as propriedades. Delete e Ctrl+D valem quando a seleção é um clipe ou uma faixa: ouvidos na fase de captura,
// antes do monitor, que só conhece cenas e blocos.
import React, {useEffect, useMemo, useState} from 'react';
import {Volume2, VolumeX} from 'lucide-react';
import {SILENCIO_DB, volumeDoClipe, type AudioP, type ClipeAudioP, type Envelope, type FaixaAudioP} from '../../../nucleo/audio';
import {loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {irPara} from './tocador';
import {dividirSelecaoAudio, duplicarSelecaoAudio, ehSelecaoAudio, excluirSelecaoAudio, ICONES_PAPEL, moverClipe} from './acoes-audio';

type Arrasto = {origem: string; modo: 'mover' | 'ini' | 'fim'; x0: number; dms: number};
export const ALTURA_FAIXA = 36;
const PISO_DB = -60; // abaixo disto a onda é zero
const r50 = (v: number) => Math.round(v / 50) * 50;
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Começo, duração e corte do clipe com o arrasto em curso aplicado (o que a barra mostra antes de soltar). */
const comArrasto = (c: ClipeAudioP, a: Arrasto | null, duracaoVideo: number) => {
  if (!a || a.origem !== c.origem) return {em: c.em, duracao_ms: c.duracao_ms, corte_ms: c.corte_ms};
  const maxDur = c.envelope ? c.envelope.duracao_ms - c.corte_ms : Infinity;
  if (a.modo === 'mover') return {em: lim(c.em + a.dms, 0, Math.max(0, duracaoVideo - 100)), duracao_ms: c.duracao_ms, corte_ms: c.corte_ms};
  if (a.modo === 'ini') {
    // som-D1: a alça não passa do zero do vídeo nem do começo do arquivo; sem isto o começo ia para o zero e o corte seguia, atrasando o som
    const d = lim(a.dms, -Math.min(c.corte_ms, c.em), c.duracao_ms - 100);
    return {em: c.em + d, duracao_ms: c.duracao_ms - d, corte_ms: c.corte_ms + d};
  }
  return {em: c.em, duracao_ms: lim(c.duracao_ms + a.dms, 100, maxDur), corte_ms: c.corte_ms};
};

const alturaDe = (db: number) => (db <= SILENCIO_DB ? 0 : lim((db - PISO_DB) / -PISO_DB, 0, 1));

/** Caminhos SVG do clipe: a onda crua (contorno), a onda com o ducking (cheia) e a linha do volume. Um ponto por px, ou
 *  um por janela do envelope quando o clipe está mais largo que isso. */
const desenhar = (c: ClipeAudioP, f: FaixaAudioP, env: Envelope | undefined, largura: number, altura: number, corte: number, duracao: number) => {
  const meio = altura / 2;
  const max = meio - 2;
  const janelas = env ? Math.ceil(duracao / env.janela_ms) : 0;
  const n = Math.max(2, Math.min(Math.floor(largura), janelas || Math.floor(largura / 4) || 2));
  const topoCrua: string[] = [];
  const baseCrua: string[] = [];
  const topoCheia: string[] = [];
  const baseCheia: string[] = [];
  const vol: string[] = [];
  for (let j = 0; j < n; j++) {
    const t0 = (j / n) * duracao;
    const t1 = ((j + 1) / n) * duracao;
    const x = ((j + 0.5) / n) * largura;
    let db = SILENCIO_DB;
    if (env) {
      const i0 = Math.floor((corte + t0) / env.janela_ms);
      const i1 = Math.max(i0 + 1, Math.ceil((corte + t1) / env.janela_ms));
      for (let i = i0; i < i1 && i < env.db.length; i++) if (env.db[i] > db) db = env.db[i];
    }
    const t = (t0 + t1) / 2;
    const k = c.ducking ? lim(Math.floor(t / c.ducking.janela_ms), 0, c.ducking.ganho.length - 1) : -1;
    const ganho = k >= 0 ? c.ducking!.ganho[k] ?? 1 : 1;
    const h = alturaDe(db) * max;
    const hd = alturaDe(ganho > 0 ? db + 20 * Math.log10(ganho) : SILENCIO_DB) * max;
    topoCrua.push(`${x.toFixed(1)},${(meio - h).toFixed(1)}`);
    baseCrua.unshift(`${x.toFixed(1)},${(meio + h).toFixed(1)}`);
    topoCheia.push(`${x.toFixed(1)},${(meio - hd).toFixed(1)}`);
    baseCheia.unshift(`${x.toFixed(1)},${(meio + hd).toFixed(1)}`);
    vol.push(`${x.toFixed(1)},${(altura - 1 - volumeDoClipe(f, {...c, duracao_ms: duracao}, t) * (altura - 2)).toFixed(1)}`);
  }
  return {
    crua: `M${topoCrua.join('L')}L${baseCrua.join('L')}Z`,
    cheia: `M${topoCheia.join('L')}L${baseCheia.join('L')}Z`,
    volume: `M${vol.join('L')}`,
    semEnvelope: !env,
  };
};

const Clipe: React.FC<{documento: string; f: FaixaAudioP; c: ClipeAudioP; x: (ms: number) => number; pxs: number; duracaoVideo: number; sel: boolean;
  arrasto: Arrasto | null; aoPegar: (e: React.PointerEvent, c: ClipeAudioP, modo: Arrasto['modo']) => void; aoMover: (e: React.PointerEvent) => void; aoSoltar: () => void}> =
  ({documento, f, c, x, pxs, duracaoVideo, sel, arrasto, aoPegar, aoMover, aoSoltar}) => {
    const {em, duracao_ms, corte_ms} = comArrasto(c, arrasto, duracaoVideo);
    const esq = x(em);
    const largura = Math.max(4, (duracao_ms / 1000) * pxs - 1);
    const altura = ALTURA_FAIXA - 4;
    const onda = useMemo(() => desenhar(c, f, c.envelope, largura, altura, corte_ms, duracao_ms), [c, f, largura, altura, corte_ms, duracao_ms]);
    const nivel = c.nivel_db !== undefined ? ` · ${c.nivel_db.toFixed(0)} dB` : ' · medindo…';
    const duck = c.ducking && c.ducking.reducao_db > 0 ? ` · cai ${c.ducking.reducao_db.toFixed(0)} dB sob a voz` : '';
    return (
      <div className={`clipe ${f.papel}${sel ? ' sel' : ''}${c.fora ? ' fora' : ''}${c.mudo ? ' mudo' : ''}`} style={{left: esq, width: largura}}
        title={`${c.nome} · ${(duracao_ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1})} s${nivel}${duck}${c.mudo ? ' · mudo' : ''}`}
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => aoPegar(e, c, 'mover')} onPointerMove={aoMover} onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar} onDoubleClick={() => irPara(em)} data-origem-audio={c.origem}>
        <svg className="onda" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden>
          {onda.semEnvelope
            ? <rect x={0} y={altura / 2 - 1} width={largura} height={2} className="medindo" />
            : <>
              <path d={onda.crua} className="crua" />
              <path d={onda.cheia} className="cheia" />
            </>}
          <path d={onda.volume} className="vol" />
        </svg>
        {largura > 48 && <span className="txt">{c.nome}</span>}
        {sel && largura >= 28 && (
          <>
            <span className="alc ini" title="Arraste para aparar o começo (muda o corte no arquivo)" onPointerDown={(e) => aoPegar(e, c, 'ini')} />
            <span className="alc fim" title="Arraste para aparar o fim" onPointerDown={(e) => aoPegar(e, c, 'fim')} />
          </>
        )}
      </div>
    );
  };

export const FaixasAudio: React.FC<{documento: string; audio: AudioP; x: (ms: number) => number; pxs: number; duracaoVideo: number; aoBuscar: (e: React.MouseEvent) => void}> =
  ({documento, audio, x, pxs, duracaoVideo, aoBuscar}) => {
    const selecao = useLoja((e) => e.selecao);
    const [arrasto, setArrasto] = useState<Arrasto | null>(null);

    // Delete e Ctrl+D na seleção de áudio (na captura: o monitor ouve as mesmas teclas para cenas e blocos)
    useEffect(() => {
      const tecla = (e: KeyboardEvent) => {
        if (loja.get().area !== 'video' || !ehSelecaoAudio(documento)) return;
        const comCtrlD = e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd';
        const comCtrlK = e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'; // dividir na cabeça (frente Som)
        if (e.key !== 'Delete' && !comCtrlD && !comCtrlK) return;
        const alvo = e.target as HTMLElement;
        if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void (comCtrlK ? dividirSelecaoAudio(documento) : comCtrlD ? duplicarSelecaoAudio(documento) : excluirSelecaoAudio(documento));
      };
      window.addEventListener('keydown', tecla, true);
      return () => window.removeEventListener('keydown', tecla, true);
    }, [documento]);

    const pegar = (e: React.PointerEvent, c: ClipeAudioP, modo: Arrasto['modo']) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      selecionar({documento, caminho: c.origem});
      setArrasto({origem: c.origem, modo, x0: e.clientX, dms: 0});
    };
    const mover = (e: React.PointerEvent) => {
      if (arrasto) setArrasto({...arrasto, dms: ((e.clientX - arrasto.x0) / pxs) * 1000});
    };
    const soltar = () => {
      const a = arrasto;
      setArrasto(null);
      if (!a || Math.abs(a.dms) < 25) return;
      const c = audio.faixas.flatMap((f) => f.clipes).find((k) => k.origem === a.origem);
      if (!c) return;
      const novo = comArrasto(c, a, duracaoVideo);
      const rotulo = a.modo === 'mover' ? `mover ${c.nome} para ${(r50(novo.em) / 1000).toLocaleString('pt-BR')} s` : a.modo === 'ini' ? `aparar o começo de ${c.nome}` : `aparar o fim de ${c.nome}`;
      void moverClipe(documento, c.origem, a.modo === 'mover' ? {em: novo.em} : a.modo === 'ini' ? {em: novo.em, corte_ms: novo.corte_ms, duracao_ms: novo.duracao_ms} : {duracao_ms: novo.duracao_ms}, rotulo);
    };

    return (
      <>
        {audio.faixas.map((f) => {
          const Icone = ICONES_PAPEL[f.papel];
          const selFaixa = selecao?.documento === documento && selecao.caminho === f.origem;
          return (
            <div key={f.origem} className={`trilha audio ${f.papel}${selFaixa ? ' sel' : ''}${f.mudo ? ' muda' : ''}`} onClick={aoBuscar}>
              <div className="rotulo-faixa" title={`${f.nome} · volume ${Math.round(f.volume * 100)}%${f.mudo ? ' · muda' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selecionar({documento, caminho: f.origem});
                }}>
                <Icone />
                <span className="nome">{f.nome}</span>
                <button className={`bti${f.mudo ? ' ligado' : ''}`} title={f.mudo ? 'Faixa muda: clique para ouvir' : 'Silenciar a faixa'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void trocar(documento, `${f.origem}/mudo`, f.mudo ? undefined : true, `${f.mudo ? 'ouvir' : 'silenciar'} ${f.nome}`);
                  }}>
                  {f.mudo ? <VolumeX /> : <Volume2 />}
                </button>
              </div>
              {f.clipes.map((c) => (
                <Clipe key={c.origem} documento={documento} f={f} c={c} x={x} pxs={pxs} duracaoVideo={duracaoVideo} sel={selecao?.documento === documento && selecao.caminho === c.origem}
                  arrasto={arrasto} aoPegar={pegar} aoMover={mover} aoSoltar={soltar} />
              ))}
            </div>
          );
        })}
      </>
    );
  };
