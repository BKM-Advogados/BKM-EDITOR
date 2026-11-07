// Legendas do vídeo de cenas (src/nucleo/legendas.ts, docs/legendas.md): o segmento da hora, com a palavra falada em
// destaque, no estilo escolhido (posição, tamanho, caixa, destaque) e com as cores e a fonte do tema, que o kit de marca
// preenche. A legenda fica dentro da área segura do destino (o que a interface de cada rede cobre, zonas-seguras.ts),
// por cima dos efeitos. Entra no VideoCenas com uma linha; sem `legendas_cenas` nas props, não desenha nada.
import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {fonte} from '../fontes';
import type {EstiloLegendaP, LegendasP, PalavraLegenda, SegmentoLegendaP} from '../../nucleo/legendas';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ENTRA_MS = 120;
const SAI_MS = 120;

/** "#RRGGBB" (ou "#RGB") com transparência, para a caixa translúcida atrás da linha. */
export const comAlfa = (cor: string, alfa: number) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cor.trim());
  if (!m) return cor;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alfa})`;
};

const Palavra: React.FC<{p: PalavraLegenda; ms: number; e: EstiloLegendaP; tam: number; ultima: boolean}> = ({p, ms, e, tam, ultima}) => {
  const ativa = e.destaque !== 'nenhum' && ms >= p.s && ms < p.e + 60;
  const dita = ms >= p.s;
  const texto = e.maiusculas ? p.w.toLocaleUpperCase('pt-BR') : p.w;
  const cor = ativa && e.destaque === 'cor' ? e.cor_destaque
    : ativa && e.destaque === 'caixa' ? e.fundo
    : e.apagadas && !dita ? comAlfa(e.cor, 0.45) : e.cor;
  const estilo: React.CSSProperties = {color: cor, whiteSpace: 'pre', borderRadius: tam * 0.18, transition: 'none'};
  if (ativa && e.destaque === 'caixa') Object.assign(estilo, {background: e.cor_destaque, padding: `0 ${tam * 0.16}px`, margin: `0 ${-tam * 0.16}px`, boxDecorationBreak: 'clone'});
  if (ativa && e.destaque === 'sublinhado') Object.assign(estilo, {textDecoration: 'underline', textDecorationColor: e.cor_destaque, textDecorationThickness: Math.max(2, tam * 0.08),
    textUnderlineOffset: tam * 0.14});
  return <><span style={estilo}>{texto}</span>{ultima ? null : ' '}</>;
};

/** As linhas do segmento: a quebra à mão ("\n") separa; as palavras são as do segmento, na mesma ordem do texto. */
const linhasDe = (s: SegmentoLegendaP): PalavraLegenda[][] => {
  const partes = s.texto.split('\n').map((l) => l.split(/\s+/).filter(Boolean).length);
  if (partes.length <= 1) return [s.palavras];
  const out: PalavraLegenda[][] = [];
  let i = 0;
  for (const n of partes) {
    out.push(s.palavras.slice(i, i + n));
    i += n;
  }
  return out.filter((l) => l.length);
};

const Segmento: React.FC<{s: SegmentoLegendaP; ms: number; e: EstiloLegendaP; tam: number; familia: string}> = ({s, ms, e, tam, familia}) => {
  const entra = interpolate(ms, [s.em - ENTRA_MS, s.em], [0, 1], clamp);
  const sai = interpolate(ms, [s.sai, s.sai + SAI_MS], [1, 0], clamp);
  const o = Math.min(entra, sai);
  const sombra = e.sombra ? `0 ${tam * 0.06}px ${tam * 0.18}px rgba(0,0,0,0.85), 0 0 ${tam * 0.04}px rgba(0,0,0,0.9)` : 'none';
  const contorno = e.sombra && e.peso >= 700 ? {WebkitTextStroke: `${Math.max(1, tam * 0.035)}px rgba(0,0,0,0.75)`, paintOrder: 'stroke fill'} : {};
  const linhaCaixa: React.CSSProperties = e.caixa === 'linha'
    ? {background: comAlfa(e.fundo, 0.82), padding: `${tam * 0.12}px ${tam * 0.32}px`, borderRadius: tam * 0.22, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'}
    : {};
  return (
    <div data-legenda={s.origem} style={{opacity: o, transform: `translateY(${(1 - entra) * tam * 0.25}px)`, textAlign: 'center', fontFamily: familia, fontWeight: e.peso,
      fontSize: tam, lineHeight: e.caixa === 'linha' ? 1.42 : 1.18, textShadow: sombra, letterSpacing: e.maiusculas ? '0.01em' : undefined, ...contorno}}>
      {e.falante && s.falante && <div style={{fontSize: tam * 0.62, fontWeight: 600, color: e.cor_suave, marginBottom: tam * 0.12}}>{s.falante}</div>}
      {linhasDe(s).map((l, i) => (
        <div key={i}>
          <span style={linhaCaixa}>{l.map((p, j) => <Palavra key={j} p={p} ms={ms} e={e} tam={tam} ultima={j === l.length - 1} />)}</span>
        </div>
      ))}
    </div>
  );
};

export const Legendas: React.FC<{legendas?: LegendasP}> = ({legendas}) => {
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  if (!legendas || legendas.oculto || !legendas.segmentos.length) return null;
  const ms = (frame / fps) * 1000;
  const ativos = legendas.segmentos.filter((s) => ms >= s.em - ENTRA_MS && ms < s.sai + SAI_MS);
  if (!ativos.length) return null;
  const e = legendas.estilo;
  const a = legendas.area;
  const tam = e.tam * Math.min(W, H);
  const familia = fonte(e.fonte || 'Inter');
  const vertical: React.CSSProperties = e.posicao === 'cima' ? {top: a.topo * H}
    : e.posicao === 'meio' ? {top: (a.topo + (a.base - a.topo) * 0.62) * H, transform: 'translateY(-50%)'}
    : {bottom: (1 - a.base) * H};
  // a faixa da marca vai de lado a lado e acende e apaga com a fala
  const faixa = e.caixa === 'faixa';
  const acesa = Math.max(...ativos.map((s) => Math.min(interpolate(ms, [s.em - ENTRA_MS, s.em], [0, 1], clamp), interpolate(ms, [s.sai, s.sai + SAI_MS], [1, 0], clamp))));
  return (
    <div data-legendas style={{position: 'absolute', left: faixa ? 0 : a.esq * W, right: faixa ? 0 : a.dir * W, ...vertical, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: tam * 0.3, pointerEvents: 'none',
      ...(faixa ? {background: comAlfa(e.fundo, 0.96 * acesa), padding: `${tam * 0.4}px ${a.esq * W}px`} : {})}}>
      {ativos.map((s) => <Segmento key={s.id} s={s} ms={ms} e={e} tam={tam} familia={familia} />)}
    </div>
  );
};
