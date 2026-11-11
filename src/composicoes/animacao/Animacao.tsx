// Composição Remotion "Animacao": desenha o documento quadro a quadro. Prévia (Player) e exportação passam por aqui
// (registro.ts), então desenham a mesma coisa. Tudo é determinístico: os valores vêm de valorEm (nucleo/animacao.ts) e a
// revelação do pixel de revelarRGBA (nucleo/animacao-pixel.ts, com semente), nada de Math.random.
import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {fonte} from '../fontes';
import {definirBaseMidia, midia} from '../midia';
import {revelarRGBA} from '../../nucleo/animacao-pixel';
import {resolverCor, valorEm, type CamadaAnimacao, type PropsAnimacao, type TemaAnimacao} from '../../nucleo/animacao';

const num = (v: number | string) => Number(v);

/** Camada de pixel: desenha a grade num canvas 2D (1 px por célula, de uma vez com putImageData) e a amplia com
 *  image-rendering pixelated. */
const CamadaPixel: React.FC<{c: CamadaAnimacao; t_ms: number}> = ({c, t_ms}) => {
  const grade = c.grade;
  const ref = useRef<HTMLCanvasElement>(null);
  const progresso = num(valorEm(c, 'progresso', t_ms));
  const tamanho = Math.max(1, num(valorEm(c, 'tamanho_pixel', t_ms)));
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !grade) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const colunas = Math.max(1, Math.floor(grade.colunas) || 1);
    const linhas = Math.max(1, Math.floor(grade.linhas) || 1);
    if (cv.width !== colunas) cv.width = colunas;
    if (cv.height !== linhas) cv.height = linhas;
    // putImageData troca todos os pixels, transparentes inclusive: não precisa de clearRect
    ctx.putImageData(new ImageData(revelarRGBA(grade, c.efeito, c.semente ?? 1, progresso), colunas, linhas), 0, 0);
  }, [grade, c.efeito, c.semente, progresso]);
  if (!grade) return null;
  return <canvas ref={ref} style={{width: grade.colunas * tamanho, height: grade.linhas * tamanho, imageRendering: 'pixelated', display: 'block'}} />;
};

const Camada: React.FC<{c: CamadaAnimacao; tema: TemaAnimacao; origem: string; t_ms: number}> = ({c, tema, origem, t_ms}) => {
  const x = num(valorEm(c, 'x', t_ms));
  const y = num(valorEm(c, 'y', t_ms));
  const escala = num(valorEm(c, 'escala', t_ms));
  const rotacao = num(valorEm(c, 'rotacao', t_ms));
  const opacidade = num(valorEm(c, 'opacidade', t_ms));
  const cor = resolverCor(String(valorEm(c, 'cor', t_ms, tema)), tema);
  // o pixel define o tamanho pela grade × tamanho_pixel; os demais usam largura/altura da camada
  const tamanho = c.tipo === 'pixel' && c.grade ? {largura: c.grade.colunas * Math.max(1, num(valorEm(c, 'tamanho_pixel', t_ms))), altura: c.grade.linhas * Math.max(1, num(valorEm(c, 'tamanho_pixel', t_ms)))} : {largura: c.largura, altura: c.altura};
  const base: React.CSSProperties = {
    position: 'absolute', left: x, top: y, width: tamanho.largura, height: tamanho.altura,
    opacity: Math.max(0, Math.min(1, opacidade)),
    transform: `rotate(${rotacao}deg) scale(${escala})`, transformOrigin: 'center center',
  };

  if (c.tipo === 'forma') {
    const raio = c.forma === 'elipse' ? '50%' : `${c.raio ?? 0}px`;
    return <div data-origem={origem} data-camada-id={c.id} style={{...base, background: cor, borderRadius: raio}} />;
  }
  if (c.tipo === 'texto') {
    const tamanhoLetra = num(valorEm(c, 'tamanho', t_ms));
    const alinhar = c.alinhar === 'esquerda' ? 'left' : c.alinhar === 'direita' ? 'right' : 'center';
    return (
      <div data-origem={origem} data-camada-id={c.id} style={{...base, fontFamily: fonte(c.fonte ?? tema.fonte), color: cor, fontSize: tamanhoLetra,
        fontWeight: c.peso ?? 400, lineHeight: 1.15, textAlign: alinhar, display: 'flex', alignItems: 'center', justifyContent: alinhar === 'left' ? 'flex-start' : alinhar === 'right' ? 'flex-end' : 'center', overflowWrap: 'anywhere'}}>
        {c.texto ?? ''}
      </div>
    );
  }
  if (c.tipo === 'pixel') return <div data-origem={origem} data-camada-id={c.id} style={base}><CamadaPixel c={c} t_ms={t_ms} /></div>;
  // imagem
  return (
    <div data-origem={origem} data-camada-id={c.id} style={{...base, overflow: 'hidden'}}>
      {c.src ? <Img src={midia(c.src)} style={{width: '100%', height: '100%', objectFit: c.ajuste === 'cobrir' ? 'cover' : 'contain', display: 'block'}} />
        : <div style={{width: '100%', height: '100%', border: '2px dashed rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)'}}>Imagem</div>}
    </div>
  );
};

export const Animacao: React.FC<PropsAnimacao> = (p) => {
  definirBaseMidia(p.base_midia);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t_ms = (frame / fps) * 1000;
  const fundo = resolverCor(p.fundo, p.tema);
  return (
    <AbsoluteFill style={{backgroundColor: fundo}}>
      {p.camadas.map((c, i) => (c.visivel === false ? null : <Camada key={c.id ?? i} c={c} tema={p.tema} origem={`/camadas/${i}`} t_ms={t_ms} />))}
    </AbsoluteFill>
  );
};
