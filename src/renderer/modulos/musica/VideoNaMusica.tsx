// Monitor do vídeo dentro da Música (item 25): o quadro do vídeo ligado na posição da cabeça (o zero da música é
// video.em_ms no vídeo), sem som (a voz guia já toca pelo motor da Música). Usa a composição do monitor do Vídeo só para
// ler; nada aqui mexe no vídeo. Ver docs/musica.md, "Encaixe no vídeo".
import React, {useEffect, useRef} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {COMPOSICOES, composicaoDe} from '../../../composicoes/registro';
import type {DocMusica} from '../../../nucleo/musica';
import {useLoja} from '../../estado/loja';
import {useMusica} from './estado';

const ALTURA = 168;

export const VideoNaMusica: React.FC<{doc: DocMusica}> = ({doc}) => {
  const idVideo = doc.video?.documento;
  const montado = useLoja((e) => (idVideo ? e.props[idVideo] : undefined));
  const cabeca = useMusica((e) => e.cabeca_s);
  const ref = useRef<PlayerRef>(null);
  const props = montado && 'props' in montado ? montado.props : null;
  const medidas = props as {largura?: number; altura?: number; fps?: number; duracao_ms: number} | null;
  const fps = medidas?.fps ?? 30;
  const W = medidas?.largura ?? 1080;
  const H = medidas?.altura ?? 1920;
  const duracao = medidas ? Math.max(1, Math.ceil((medidas.duracao_ms / 1000) * fps)) : 1;
  const ms = cabeca * 1000 + (doc.video?.em_ms ?? 0);
  const quadro = Math.min(duracao - 1, Math.max(0, Math.round((ms / 1000) * fps)));
  useEffect(() => {
    ref.current?.seekTo(quadro);
  }, [quadro]);
  if (!idVideo) return null;
  if (!props) return <div className="video-na-musica vazio">{montado && 'erro' in montado ? montado.erro : 'carregando o vídeo…'}</div>;
  const largura = Math.round((ALTURA * W) / H);
  const passou = medidas && ms > medidas.duracao_ms;
  return (
    <div className="video-na-musica" style={{width: largura}} title={`${idVideo} em ${(ms / 1000).toFixed(1).replace('.', ',')} s`}>
      <Player ref={ref} component={COMPOSICOES[composicaoDe(props)]} inputProps={props} durationInFrames={duracao} fps={fps} compositionWidth={W} compositionHeight={H}
        style={{width: largura, height: ALTURA}} initiallyMuted clickToPlay={false} spaceKeyToPlayOrPause={false} doubleClickToFullscreen={false} />
      <span className="tempo">{passou ? 'depois do fim do vídeo' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`}</span>
    </div>
  );
};
