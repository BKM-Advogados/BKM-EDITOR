// Vídeo de cenas com o tema neutro: título, texto, lista, número e imagem, em qualquer formato. Largura, altura e fps
// vêm do Remotion (calculateMetadata no Root, compositionWidth no Player); posição e letra são frações do quadro, então
// o mesmo documento serve a 9:16 e a 16:9. Cada bloco leva `data-origem` (o caminho dele no documento) para a prévia
// achar o que foi clicado; o atributo não muda nenhum pixel. Tempos em ms de saída (src/nucleo/cenas.ts). O som são
// os clipes das faixas (src/nucleo/audio.ts), cada um num Html5Audio dentro de uma Sequence, com o volume por quadro
// (faixa × clipe × fades × ducking); o renderMedia da exportação mixa tudo no MP4.
import React from 'react';
import {AbsoluteFill, Easing, getRemotionEnvironment, Html5Audio, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {CamadaEfeitos} from '../efeitos/CamadaEfeitos';
import {Legendas} from './Legendas'; // frente Fala
import {fonte} from '../fontes';
import {definirBaseMidia, midia} from '../midia';
import {volumeDoClipe, type AudioP, type ClipeAudioP, type FaixaAudioP} from '../../nucleo/audio';
import {TIPOS_BLOCO_CENAS, type BlocoCenasP, type CenaCenasP, type PropsCenas, type TemaCenas} from '../../nucleo/cenas';
import {transformDoMovimento} from './movimento';
import {casasDoNumero, formatarNumero} from '../formatar-numero';
import {tempoDoBloco} from './continuidade';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Destaque sem matiz (o branco do kit Neutro): a cor quase não muda do texto, então o trecho ganha peso. */
export const destaqueSemCor = (cor: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(cor.trim());
  if (!m) return false;
  const c = m.slice(1, 4).map((x) => parseInt(x, 16));
  return Math.max(...c) - Math.min(...c) < 16;
};

const Rico: React.FC<{texto: string; cor: string}> = ({texto, cor}) => (
  <>{texto.split('**').map((s, i) => (i % 2 ? <b key={i} style={{color: cor, fontWeight: destaqueSemCor(cor) ? 'bolder' : 'inherit'}}>{s}</b> : <React.Fragment key={i}>{s}</React.Fragment>))}</>
);

/** Quadros desde o começo da sequência da cena até `ms` (saída). */
const usarRelogio = (t0: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const q = (ms: number) => ((ms - t0) / 1000) * fps;
  const mola = (ms: number, rigidez = 170, amortecimento = 18) => spring({frame: frame - q(ms), fps, config: {stiffness: rigidez, damping: amortecimento, mass: 0.8}});
  const lin = (ms: number, dur: number, easing = Easing.out(Easing.cubic)) => interpolate(frame, [q(ms), q(ms + dur)], [0, 1], {...clamp, easing});
  return {mola, lin};
};

const Bloco: React.FC<{b: BlocoCenasP; t0: number; tema: TemaCenas; familia: string}> = ({b, t0, tema, familia}) => {
  const {width: W, height: H} = useVideoConfig();
  const {mola, lin} = usarRelogio(t0);
  const menor = Math.min(W, H);
  const padrao = TIPOS_BLOCO_CENAS[b.tipo] ?? TIPOS_BLOCO_CENAS.texto;
  const tam = (b.tam ?? padrao.tam) * menor;
  const cor = b.cor ?? (b.tipo === 'texto' ? tema.suave : tema.texto);
  // lâmina (video-D1): o bloco que atravessa o corte entra, conta e se move como um bloco só, e não some no corte
  const tempo = tempoDoBloco(b);
  const m = mola(tempo.inicio);
  const saida = tempo.segue ? 1 : 1 - lin(b.sai - 250, 250);
  const alinhar = b.alinhar === 'esquerda' ? 'left' : b.alinhar === 'direita' ? 'right' : 'center';
  const base: React.CSSProperties = {position: 'absolute', left: b.x * W, top: b.y * H, width: b.largura * W, fontFamily: familia, color: cor,
    fontSize: tam, fontWeight: b.peso ?? padrao.peso, lineHeight: b.tipo === 'titulo' ? 1.08 : 1.3, textAlign: alinhar, opacity: Math.min(1, m * 1.4) * saida,
    transform: `translateY(${(1 - m) * menor * 0.03}px)`, overflowWrap: 'anywhere'};

  if (b.tipo === 'lista') {
    const itens = b.itens ?? [];
    return (
      <div data-origem={b.origem} data-bloco-id={b.id} style={{...base, opacity: saida, transform: undefined, display: 'flex', flexDirection: 'column', gap: tam * 0.55}}>
        {itens.map((it, i) => {
          const mi = mola(tempo.inicio + i * 450);
          return (
            <div key={i} style={{display: 'flex', alignItems: 'baseline', gap: tam * 0.5, opacity: Math.min(1, mi * 1.5), transform: `translateX(${(1 - mi) * menor * 0.05}px)`,
              justifyContent: alinhar === 'center' ? 'center' : alinhar === 'right' ? 'flex-end' : 'flex-start'}}>
              <span style={{flex: 'none', width: tam * 0.42, height: tam * 0.42, borderRadius: tam * 0.1, background: tema.destaque, transform: `translateY(-${tam * 0.06}px)`}} />
              <span><Rico texto={it} cor={tema.destaque} /></span>
            </div>
          );
        })}
      </div>
    );
  }
  if (b.tipo === 'numero') {
    const p = lin(tempo.inicio, 1100, Easing.inOut(Easing.cubic));
    const de = b.de ?? 0;
    const ate = b.ate ?? 0;
    const valor = formatarNumero(de + (ate - de) * p, casasDoNumero(b)); // casas dos valores, ou o campo `casas` (video-D8)
    return (
      <div data-origem={b.origem} data-bloco-id={b.id} style={base}>
        <div style={{lineHeight: 0.95, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em'}}>
          {b.prefixo && <span style={{fontSize: '0.45em', color: tema.destaque}}>{b.prefixo} </span>}
          {valor}
          {b.sufixo && <span style={{fontSize: b.sufixo.length <= 2 ? '0.8em' : '0.4em', color: tema.destaque}}>{b.sufixo}</span>}
        </div>
        {b.rotulo && <div style={{fontSize: '0.2em', fontWeight: 500, lineHeight: 1.3, color: tema.suave, marginTop: '0.2em'}}><Rico texto={b.rotulo} cor={tema.destaque} /></div>}
      </div>
    );
  }
  if (b.tipo === 'imagem') {
    const altura = (b.altura ?? 0.4) * H;
    const movimento = transformDoMovimento(b.movimento, lin(tempo.inicio, tempo.total, Easing.linear)); // Ken Burns (movimento.ts)
    return (
      <div data-origem={b.origem} data-bloco-id={b.id} style={{...base, height: altura, transform: `scale(${0.96 + 0.04 * m})`, ...(movimento ? {overflow: 'hidden'} : {})}}>
        {b.src ? <Img src={midia(b.src)} style={{width: '100%', height: '100%', objectFit: b.ajuste === 'cobrir' ? 'cover' : 'contain', display: 'block', transform: movimento}} />
          : <div style={{width: '100%', height: '100%', border: `${Math.max(2, menor * 0.004)}px dashed ${tema.suave}`, borderRadius: menor * 0.01, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: menor * 0.03, color: tema.suave, fontWeight: 500}}>Escolha a imagem em Propriedades</div>}
      </div>
    );
  }
  return (
    <div data-origem={b.origem} data-bloco-id={b.id} style={base}>
      <Rico texto={b.texto ?? ''} cor={tema.destaque} />
    </div>
  );
};

// O fundo da cena fica sólido até o último quadro: o corte entre cenas é limpo (video-D2). Antes a cena inteira, fundo
// junto, apagava nos 6 últimos quadros e aparecia o fundo do tema por baixo (um pisca escuro entre duas cenas claras, e sem
// os efeitos, tres-efeitos-D4). Quem some antes do corte são os blocos, que já saem em 250 ms antes do `sai`.
const Cena: React.FC<{c: CenaCenasP; tema: TemaCenas; familia: string}> = ({c, tema, familia}) => {
  return (
    <AbsoluteFill style={{backgroundColor: c.fundo}} data-cena={c.origem}>
      {c.blocos.map((b) => <Bloco key={b.id ?? b.origem} b={b} t0={c.t_in} tema={tema} familia={familia} />)}
    </AbsoluteFill>
  );
};

/** Um clipe de áudio: a Sequence põe o clipe no tempo do vídeo, trimBefore pula o corte dentro do arquivo e o volume é
 *  calculado por quadro desde o começo do clipe. Na prévia, arquivo que não carrega vira aviso no console; no render o
 *  Remotion para e avisa (melhor que exportar mudo sem ninguém saber). */
const Clipe: React.FC<{c: ClipeAudioP; f: FaixaAudioP}> = ({c, f}) => {
  const {fps} = useVideoConfig();
  const q = (ms: number) => Math.round((ms / 1000) * fps);
  const de = q(c.em);
  const dur = Math.max(1, q(c.em + c.duracao_ms) - de);
  const {isRendering} = getRemotionEnvironment();
  return (
    <Sequence from={de} durationInFrames={dur} layout="none" name={`${f.nome} · ${c.nome}`}>
      <Html5Audio src={midia(c.arquivo)} trimBefore={q(c.corte_ms)} volume={(quadro) => volumeDoClipe(f, c, (quadro / fps) * 1000)}
        onError={isRendering ? undefined : (e) => console.warn(`[estúdio] não deu para tocar ${c.arquivo}:`, e)} />
    </Sequence>
  );
};

const Som: React.FC<{audio?: AudioP; duracao_ms: number}> = ({audio, duracao_ms}) => (
  <>
    {(audio?.faixas ?? []).filter((f) => !f.mudo).flatMap((f) =>
      f.clipes.filter((c) => !c.mudo && !c.fora && c.em < duracao_ms).map((c) => <Clipe key={c.origem} c={c} f={f} />))}
  </>
);

/** Quadros da cena: de round(t_in) a round(t_out). A última vai até o fim do vídeo, que tem ceil(duração) quadros (Root.tsx):
 *  sem isso, quando a duração termina antes do meio de um quadro, o último quadro saía só com o fundo do tema. */
export const quadrosDaCena = (c: {t_in: number; t_out: number}, ultima: boolean, fps: number, totalQuadros: number) => {
  const q = (ms: number) => Math.round((ms / 1000) * fps);
  const de = q(c.t_in);
  return {de, dur: Math.max(1, (ultima ? Math.max(totalQuadros, q(c.t_out)) : q(c.t_out)) - de)};
};

export const VideoCenas: React.FC<PropsCenas> = (p) => {
  definirBaseMidia(p.base_midia);
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const familia = fonte(p.tema.fonte || 'Inter');
  return (
    <AbsoluteFill style={{backgroundColor: p.tema.fundo}}>
      <CamadaEfeitos efeitos={p.efeitos} quadro={frame} largura={p.largura} altura={p.altura}>
        {/* o fundo do tema também dentro da camada: os efeitos valem nele (tres-efeitos-D4) */}
        <AbsoluteFill style={{backgroundColor: p.tema.fundo}} />
        {p.cenas.map((c, i) => {
          const {de, dur} = quadrosDaCena(c, i === p.cenas.length - 1, fps, durationInFrames);
          return (
            <Sequence key={c.id ?? i} from={de} durationInFrames={dur}>
              <Cena c={c} tema={p.tema} familia={familia} />
            </Sequence>
          );
        })}
      </CamadaEfeitos>
      <Legendas legendas={p.legendas_cenas} />
      <Som audio={p.audio} duracao_ms={p.duracao_ms} />
    </AbsoluteFill>
  );
};
