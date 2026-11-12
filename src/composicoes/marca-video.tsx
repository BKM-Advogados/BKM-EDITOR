// Peças da marca em vídeo, comuns ao carrossel narrado (CarrosselTema, pelas versões de CarrosselNarrado.tsx com a paleta
// fixa dele) e ao vídeo de cenas (o acabamento: src/nucleo/acabamento-video.ts): o logo ou o nome, a vinheta do logo, o
// cartão final, a faixa do rodapé do carrossel e o selo do rodapé do vídeo de cenas. Cores, fontes e escala vêm de quem
// chama: `u` é o lado menor do quadro dividido por 1080 (o carrossel, em 1080×1920, usa 1, e os números saem iguais aos de
// antes). O logo nunca gira nem leva efeito. Tempos em ms de SAÍDA; `t0` é o começo da Sequence em que a peça está.
import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {midia} from './midia';

/** As cores da marca por papel: o destaque e as versões clara e profunda dele (degradê do nome, filetes) e o claro (texto
 *  sobre o fundo escuro do cartão e da vinheta). `fundo`: a cor por trás da vinheta e do cartão, quando a peça cobre a cena. */
export type CoresMarcaVideo = {destaque: string; destaqueClaro: string; destaqueProfundo: string; claro: string; fundo?: string};
export type FontesMarcaVideo = {titulo: string; texto: string; mono?: string};

/** "#RRGGBB" (ou "#RGB") com transparência, para sombras, linhas e véus na cor da paleta; outra forma de cor volta igual. */
export const comAlfa = (cor: string, alfa: number) => {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3}\b)/i.exec(cor.trim());
  if (!m) return cor;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
};

// ---------- utilidades de tempo (frame local da Sequence × evento em ms de saída) ----------
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const useT = (t0: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ms = (frame / fps) * 1000 + t0;
  const mola = (evMs: number, rig = 180, am = 16) =>
    spring({frame: frame - Math.round(((evMs - t0) / 1000) * fps), fps, config: {stiffness: rig, damping: am, mass: 0.8}});
  const lin = (evMs: number, durMs: number, ease = Easing.out(Easing.cubic)) =>
    interpolate(ms, [evMs, evMs + Math.max(1, durMs)], [0, 1], {...clamp, easing: ease});
  return {frame, ms, mola, lin};
};

/** O logo (arquivo na mídia do projeto) ou, sem ele, o nome de quem assina em texto, com degradê no destaque. `altoMax`
 *  (px) segura um logo alto num quadro deitado. */
export const MarcaVideo: React.FC<{logo?: string; nome?: string; tam?: number; u?: number; altoMax?: number; fonte: string; cores: CoresMarcaVideo}> =
  ({logo, nome, tam = 1, u = 1, altoMax, fonte, cores}) =>
    logo ? (
      <Img src={midia(logo)} style={{width: 640 * tam * u, objectFit: 'contain', ...(altoMax ? {maxHeight: altoMax} : {})}} />
    ) : nome ? (
      <div style={{maxWidth: 940 * u, textAlign: 'center', fontFamily: fonte, fontWeight: 700, fontSize: 96 * tam * u, lineHeight: 0.95, letterSpacing: -2 * tam * u,
        background: `linear-gradient(135deg, ${cores.destaqueClaro}, ${cores.destaque} 45%, ${cores.destaqueProfundo})`, WebkitBackgroundClip: 'text', color: 'transparent'}}>
        {nome.toUpperCase()}</div>
    ) : null;

/** Vinheta do logo: o logo (ou o nome) cresce de leve e aparece, um filete no destaque corre embaixo, e tudo some nos
 *  últimos 260 ms. `topoLinha`: onde fica o filete (px); `fundo` nas cores cobre a cena por baixo. */
export const Vinheta: React.FC<{t_in: number; t_out: number; logo?: string; nome?: string; fonte: string; cores: CoresMarcaVideo; u?: number; tam?: number;
  topoLinha?: number; altoMax?: number}> = ({t_in, t_out, logo, nome, fonte, cores, u = 1, tam = 1, topoLinha = 1280, altoMax}) => {
  const {mola, lin} = useT(t_in);
  const m = mola(t_in + 80, 200, 15);
  const sai = 1 - lin(t_out - 260, 260);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: sai, ...(cores.fundo ? {backgroundColor: cores.fundo} : {})}}>
      <div style={{transform: `scale(${0.9 + 0.1 * m})`, opacity: Math.min(1, m * 1.3)}}><MarcaVideo logo={logo} nome={nome} tam={tam} u={u} altoMax={altoMax} fonte={fonte} cores={cores} /></div>
      <div style={{position: 'absolute', top: topoLinha, height: 6 * u, width: 300 * u * lin(t_in + 250, 500), background: cores.destaque}} />
    </AbsoluteFill>
  );
};

/** Cartão final: a marca em cima, o convite (título), um filete, o contato (o @ e o site) e o aviso, cada um entrando com
 *  mola. `topoMarca` e `topoTexto` em px; o carrossel usa 210 e 820 em 1920 de altura. */
export const CartaoFinal: React.FC<{t_in: number; logo?: string; nome?: string; titulo: string; contato: string; aviso: string; fontes: FontesMarcaVideo;
  cores: CoresMarcaVideo; u?: number; topoMarca?: number; topoTexto?: number; tamMarca?: number; altoMax?: number}> =
  ({t_in, logo, nome, titulo, contato, aviso, fontes, cores, u = 1, topoMarca = 210, topoTexto = 820, tamMarca = 0.62, altoMax}) => {
    const {mola} = useT(t_in);
    const m = mola(t_in);
    const mm = mola(t_in + 350);
    return (
      <AbsoluteFill style={cores.fundo ? {backgroundColor: cores.fundo} : undefined}>
        <div style={{position: 'absolute', top: topoMarca, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: mm,
          transform: `scale(${0.8 + 0.2 * mm})`}}><MarcaVideo logo={logo} nome={nome} tam={tamMarca} u={u} altoMax={altoMax} fonte={fontes.titulo} cores={cores} /></div>
        <div style={{position: 'absolute', top: topoTexto, left: 70 * u, right: 70 * u, textAlign: 'center', opacity: m, transform: `translateY(${(1 - m) * 60 * u}px)`}}>
          <div style={{fontFamily: fontes.titulo, fontWeight: 700, fontSize: 82 * u, color: cores.claro, lineHeight: 0.95}}>{titulo}</div>
          <div style={{height: 8 * u, width: 220 * u, background: cores.destaque, margin: `${40 * u}px auto`}} />
          <div style={{fontFamily: fontes.texto, fontSize: 40 * u, color: cores.destaqueClaro, fontWeight: 600}}>{contato}</div>
          <div style={{fontFamily: fontes.texto, fontSize: 26 * u, color: comAlfa(cores.claro, 0.55), marginTop: 50 * u}}>{aviso}</div>
        </div>
      </AbsoluteFill>
    );
  };

/** Rodapé do carrossel narrado: uma faixa de 120 px no pé do quadro com o nome à esquerda e o contato à direita. */
export const FaixaRodape: React.FC<{nome: string; contato: string[]; fontes: FontesMarcaVideo; cores: CoresMarcaVideo & {fundo: string}}> = ({nome, contato, fontes, cores}) => {
  if (!nome && !contato.length) return null;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 120, background: cores.fundo, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 48px', borderTop: `4px solid ${cores.destaque}`}}>
      <div style={{fontFamily: fontes.titulo, fontWeight: 700, fontSize: 28, color: cores.claro, letterSpacing: 1}}>{nome.toUpperCase()}</div>
      <div style={{fontFamily: fontes.mono ?? fontes.texto, fontSize: 21, color: comAlfa(cores.claro, 0.7), textAlign: 'right', lineHeight: 1.4}}>
        {contato.map((c, i) => <React.Fragment key={i}>{i > 0 && <br />}{c}</React.Fragment>)}</div>
    </div>
  );
};

/** Rodapé do vídeo de cenas: um selo de uma linha (filete no destaque, o nome em caixa alta e a assinatura, ou só o logo)
 *  na caixa que o acabamento achou fora das zonas da rede e da legenda. Entra e sai em 250 ms. Posição em px. */
export const SeloRodape: React.FC<{t_in: number; t_out: number; x: number; y: number; altura: number; maxLargura: number; tam: number; logo?: string; nome?: string;
  assinatura?: string; fontes: FontesMarcaVideo; cores: CoresMarcaVideo & {suave: string; fundo: string}}> =
  ({t_in, t_out, x, y, altura, maxLargura, tam, logo, nome, assinatura, fontes, cores}) => {
    const {lin} = useT(t_in);
    const o = lin(t_in, 250) * (1 - lin(t_out - 250, 250));
    const comTexto = Boolean(nome || assinatura);
    return (
      <div style={{position: 'absolute', left: x, top: y, height: altura, maxWidth: maxLargura, display: 'flex', alignItems: 'center', gap: tam * 0.5, opacity: o,
        padding: `0 ${tam * 0.6}px 0 0`, background: comAlfa(cores.fundo, 0.72), borderRadius: tam * 0.3, overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box'}}>
        <div style={{flex: 'none', alignSelf: 'stretch', width: Math.max(2, tam * 0.18), background: cores.destaque}} />
        {comTexto ? (
          <div style={{fontFamily: fontes.titulo, fontSize: tam, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis'}}>
            {nome && <span style={{fontWeight: 700, color: cores.claro, letterSpacing: tam * 0.04}}>{nome.toLocaleUpperCase('pt-BR')}</span>}
            {nome && assinatura && <span style={{color: cores.suave, whiteSpace: 'pre'}}>{'  ·  '}</span>}
            {assinatura && <span style={{fontFamily: fontes.texto, fontWeight: 500, color: cores.suave}}>{assinatura}</span>}
          </div>
        ) : logo ? (
          <Img src={midia(logo)} style={{height: altura * 0.72, maxWidth: maxLargura - tam, objectFit: 'contain', objectPosition: 'left center'}} />
        ) : null}
      </div>
    );
  };
