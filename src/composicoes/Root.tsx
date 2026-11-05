import React from 'react';
import {Composition} from 'remotion';
import {FPS} from './anim';
import {COMPOSICOES} from './registro';
import {TEMA_NEUTRO} from '../nucleo/cenas';
import {FORMATO_PADRAO} from '../nucleo/formatos';

const VAZIO = {duracao_ms: 3000, audio: '', legendas: [], cenas: [{tipo: 'final', t_in: 0, t_out: 3000, ev: {}}], total_partes: 0, rotulo_partes: '',
  marca: {nome: '', site: '', insta: ''}, decisao: {titulo: '', linha: ''}, final: {titulo: '', aviso: ''}, duvida: {pergunta: '', resposta: ''}, sons: []};
const VAZIO_CENAS = {composicao: 'VideoCenas', duracao_ms: 3000, ...FORMATO_PADRAO, tema: TEMA_NEUTRO, cenas: [], efeitos: []};

type Medidas = {duracao_ms: number; largura?: number; altura?: number; fps?: number};

// o vídeo de cenas tem o formato no documento: largura, altura e fps chegam pelas props
export const Root: React.FC = () => (
  <>
    <Composition
      id="VideoCenas"
      component={COMPOSICOES.VideoCenas}
      fps={FPS}
      width={FORMATO_PADRAO.largura}
      height={FORMATO_PADRAO.altura}
      durationInFrames={FPS * 3}
      defaultProps={VAZIO_CENAS as unknown as Record<string, unknown>}
      calculateMetadata={({props}) => {
        const p = props as unknown as Medidas;
        const fps = p.fps ?? FPS;
        return {fps, width: p.largura ?? FORMATO_PADRAO.largura, height: p.altura ?? FORMATO_PADRAO.altura,
          durationInFrames: Math.max(1, Math.ceil((p.duracao_ms / 1000) * fps))};
      }}
    />
    <Composition
      id="CarrosselTema"
      component={COMPOSICOES.CarrosselTema}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={FPS * 3}
      defaultProps={VAZIO as unknown as Record<string, unknown>}
      calculateMetadata={({props}) => ({
        durationInFrames: Math.max(1, Math.ceil(((props as unknown as Medidas).duracao_ms / 1000) * FPS)),
      })}
    />
  </>
);
