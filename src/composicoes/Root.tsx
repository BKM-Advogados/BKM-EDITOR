import React from 'react';
import {Composition} from 'remotion';
import {FPS} from './anim';
import {CarrosselTema, type PropsCarrosselTema} from './cliente/CarrosselTema';

const VAZIO = {duracao_ms: 3000, audio: '', legendas: [], cenas: [{tipo: 'final', t_in: 0, t_out: 3000, ev: {}}], total_partes: 0, rotulo_partes: '',
  marca: {nome: '', site: '', insta: ''}, decisao: {titulo: '', linha: ''}, final: {titulo: '', aviso: ''}, duvida: {pergunta: '', resposta: ''}, sons: []};

export const Root: React.FC = () => (
  <Composition
    id="CarrosselTema"
    component={CarrosselTema as unknown as React.FC<Record<string, unknown>>}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={FPS * 3}
    defaultProps={VAZIO as unknown as Record<string, unknown>}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(1, Math.ceil(((props as unknown as PropsCarrosselTema).duracao_ms / 1000) * FPS)),
    })}
  />
);
