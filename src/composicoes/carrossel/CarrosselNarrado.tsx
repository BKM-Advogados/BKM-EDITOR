// Peças do carrossel narrado em vídeo vertical (1080×1920): fundo, faixa do topo, rodapé da marca, tag, contagem das
// partes, título de seção, carimbo, selo, número que conta, vinheta do logo, cena de dúvida, cartão final, legenda
// palavra a palavra e a transição entre cenas. O CarrosselTema monta as cenas com elas a partir do roteiro.json. Paleta e
// fontes do tema do carrossel (src/nucleo/roteiro/tema.ts): as cenas de conteúdo são claras e abertura, gancho, dúvida
// e final são escuras. O logo nunca gira nem leva efeito. Todo tempo das props em ms de SAÍDA. A vinheta, o cartão final,
// o logo e o rodapé são as peças comuns de ../marca-video.tsx (o vídeo de cenas usa as mesmas, nas cores do kit), aqui
// com a paleta e as fontes fixas do carrossel.
import React, {createContext, useContext} from 'react';
import {AbsoluteFill, Easing, interpolate, random, useCurrentFrame} from 'remotion';
import {FPS} from '../anim';
import {fonte} from '../fontes';
import {TEMA_CARROSSEL_NEUTRO} from '../../nucleo/roteiro/tema';
import {baseDaLegendaCarrossel} from '../../nucleo/zonas-seguras';
import {casasDoNumero, formatarNumero} from '../formatar-numero';
import {CartaoFinal, comAlfa, FaixaRodape, MarcaVideo, useT, Vinheta, type CoresMarcaVideo} from '../marca-video';

export {comAlfa, useT};

export const K = {...TEMA_CARROSSEL_NEUTRO.cores};
export const TIT = fonte(TEMA_CARROSSEL_NEUTRO.fontes.titulo);
export const TXT = fonte(TEMA_CARROSSEL_NEUTRO.fontes.texto);
export const MONO = fonte(TEMA_CARROSSEL_NEUTRO.fontes.mono);

// a paleta do carrossel nos papéis das peças comuns da marca (marca-video.tsx)
const CORES_MARCA: CoresMarcaVideo = {destaque: K.destaque, destaqueClaro: K.destaqueClaro, destaqueProfundo: K.destaqueProfundo, claro: K.claro};

export type Tema = {modo: 'claro' | 'escuro'; fundo: string; texto: string; suave: string; destaque: string; destaqueTexto: string;
  cartao: string; cartaoTexto: string; linha: string; vazio: string};
export const TEMAS: Record<'claro' | 'escuro', Tema> = {
  // no claro, o texto de destaque vai na versão profunda (contraste); o destaque puro fica para formas e preenchimentos
  claro: {modo: 'claro', fundo: K.claro, texto: K.escuroProfundo, suave: K.nevoa, destaque: K.destaque, destaqueTexto: K.destaqueProfundo,
    cartao: K.escuro, cartaoTexto: K.claro, linha: comAlfa(K.escuro, 0.18), vazio: comAlfa(K.escuro, 0.08)},
  escuro: {modo: 'escuro', fundo: K.escuroProfundo, texto: K.claro, suave: comAlfa(K.claro, 0.62), destaque: K.destaque, destaqueTexto: K.destaqueClaro,
    cartao: K.claro, cartaoTexto: K.escuroProfundo, linha: comAlfa(K.claro, 0.16), vazio: comAlfa(K.claro, 0.06)},
};
export const TemaCtx = createContext<Tema>(TEMAS.escuro);
export const useTema = () => useContext(TemaCtx);

export type Palavra = {w: string; s: number; e: number};
export type Legenda = {s: number; e: number; palavras: Palavra[]};
export type Cena = {tipo: string; n?: number; t_in: number; t_out: number; ev: Record<string, number>};
/** Quem assina o vídeo: o nome (sem logo, a vinheta e o cartão final escrevem o nome), o @ e o site. Vazio não aparece. */
export type MarcaCarrossel = {nome: string; site: string; insta: string};

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ---------- fundo e moldura fixa ----------
const Particulas: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({length: 26}, (_, i) => {
        const x = random(`x${i}`) * 1080;
        const vel = 0.5 + random(`v${i}`) * 1.1;
        const y = 1920 - ((frame * vel + random(`y${i}`) * 1920) % 2100);
        const tam = 2 + random(`t${i}`) * 3.5;
        return <div key={i} style={{position: 'absolute', left: x + Math.sin((frame + i * 20) / 30) * 10, top: y, width: tam, height: tam,
          borderRadius: 99, background: K.destaqueClaro, opacity: 0.12 + random(`o${i}`) * 0.35, boxShadow: `0 0 ${tam * 3}px ${K.destaque}`}} />;
      })}
    </>
  );
};

export const Fundo: React.FC<{modo: 'claro' | 'escuro'}> = ({modo}) =>
  modo === 'escuro' ? (
    <AbsoluteFill style={{background: `radial-gradient(ellipse 120% 60% at 50% 108%, ${comAlfa(K.destaque, 0.30)} 0%, ${comAlfa(K.escuroProfundo, 0)} 62%), ${K.escuroProfundo}`}}>
      <AbsoluteFill style={{opacity: 0.07, backgroundImage: `radial-gradient(${K.claro} 1.2px, transparent 1.2px)`, backgroundSize: '36px 36px'}} />
      <Particulas />
    </AbsoluteFill>
  ) : (
    <AbsoluteFill style={{background: `linear-gradient(180deg, ${K.claro} 0%, #E5E8EC 100%)`}}>
      <AbsoluteFill style={{opacity: 0.5, backgroundImage: `radial-gradient(${comAlfa(K.escuro, 0.16)} 1.3px, transparent 1.3px)`, backgroundSize: '36px 36px'}} />
    </AbsoluteFill>
  );

export const FaixaTopo: React.FC = () => (
  <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 12,
    background: `linear-gradient(90deg, ${K.destaqueProfundo}, ${K.destaque} 50%, ${K.destaqueClaro})`}} />
);

export const Rodape: React.FC<{m: MarcaCarrossel}> = ({m}) => (
  <FaixaRodape nome={m.nome} contato={[m.insta, m.site].filter(Boolean)} fontes={{titulo: TIT, texto: TXT, mono: MONO}} cores={{...CORES_MARCA, fundo: K.escuroProfundo}} />
);

export const Tag: React.FC<{texto: string; y?: number}> = ({texto, y = 70}) => {
  const t = useTema();
  return (
    <div style={{position: 'absolute', top: y, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
      <div style={{background: t.destaque, color: t.modo === 'claro' ? K.claro : K.escuroProfundo, fontFamily: MONO, fontWeight: 600, fontSize: 24,
        letterSpacing: 3, padding: '10px 30px', borderRadius: 999, textTransform: 'uppercase'}}>{texto}</div>
    </div>
  );
};

export const Contagem: React.FC<{atual: number; total: number; rotulo: string; tema: Tema}> = ({atual, total, rotulo, tema}) => (
  <div style={{position: 'absolute', top: 50, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12}}>
    <div style={{display: 'flex', gap: 16}}>
      {Array.from({length: total}, (_, i) => {
        const ativo = i + 1 === atual;
        const feito = i + 1 < atual;
        return <div key={i} style={{width: 66, height: 66, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: MONO, fontWeight: 600, fontSize: 30, background: ativo ? K.destaque : 'transparent',
          color: ativo ? K.claro : feito ? tema.destaqueTexto : tema.suave, border: `4px solid ${ativo || feito ? K.destaque : tema.linha}`}}>{i + 1}</div>;
      })}
    </div>
    <div style={{fontFamily: MONO, fontWeight: 500, fontSize: 20, letterSpacing: 4, color: tema.suave}}>{rotulo}</div>
  </div>
);

// Título de seção: número fantasma ao fundo, tag no destaque e título condensado com filete.
export const TituloParte: React.FC<{n: number; tag: string; titulo: string; t0: number}> = ({n, tag, titulo, t0}) => {
  const {mola, lin} = useT(t0);
  const t = useTema();
  const m = mola(t0);
  return (
    <div style={{position: 'absolute', top: 205, left: 60, right: 60, height: 300}}>
      <div style={{position: 'absolute', right: -6, top: -150, fontFamily: TIT, fontWeight: 700, fontSize: 210, lineHeight: 1, color: t.linha, opacity: 0.8 * m}}>
        {String(n).padStart(2, '0')}</div>
      <div style={{position: 'relative', transform: `translateY(${(1 - m) * 60}px)`, opacity: m}}>
        <span style={{display: 'inline-block', background: K.destaque, color: K.claro, fontFamily: MONO, fontWeight: 600, fontSize: 22,
          letterSpacing: 3, padding: '8px 22px', borderRadius: 999, textTransform: 'uppercase'}}>{tag}</span>
        <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 77, lineHeight: 0.95, color: t.texto, marginTop: 18}}>{titulo.toUpperCase()}</div>
        <div style={{height: 8, width: 150 * lin(t0 + 150, 500), background: K.destaque, marginTop: 18}} />
      </div>
    </div>
  );
};

export const Carimbo: React.FC<{texto: string; m: number; rot?: number; tam?: number}> = ({texto, m, rot = -8, tam = 84}) => {
  const t = useTema();
  const cor = t.modo === 'claro' ? K.destaqueProfundo : K.destaqueClaro;
  return (
    <div style={{display: 'inline-block', transform: `rotate(${rot}deg) scale(${2.2 - 1.2 * m})`, opacity: Math.min(1, m * 1.4),
      border: `8px solid ${cor}`, color: cor, fontFamily: TIT, fontWeight: 700, fontSize: tam * 0.64, padding: '10px 28px', lineHeight: 1.05,
      letterSpacing: 1, background: t.modo === 'claro' ? comAlfa(K.claro, 0.94) : comAlfa(K.escuroProfundo, 0.9)}}>{texto}</div>
  );
};

// Selo de fonte (decisão, tribunal): cartão em contraste com a cena e filete no destaque.
export const Selo: React.FC<{titulo: string; linha: string; m: number}> = ({titulo, linha, m}) => {
  const t = useTema();
  return (
    <div style={{transform: `translateY(${(1 - m) * 80}px)`, opacity: m, background: t.cartao, borderLeft: `14px solid ${K.destaque}`,
      padding: '22px 30px 18px', boxShadow: `10px 10px 0 ${comAlfa(K.escuroProfundo, 0.25)}`}}>
      <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 37, color: t.modo === 'claro' ? K.destaqueClaro : K.destaqueProfundo, lineHeight: 1}}>{titulo}</div>
      <div style={{fontFamily: MONO, fontSize: 24, color: t.cartaoTexto, marginTop: 10}}>{linha}</div>
    </div>
  );
};

export const Numero: React.FC<{de: number; ate: number; p: number; tam: number; cor?: string; casas?: number}> = ({de, ate, p, tam, cor, casas}) => {
  const t = useTema();
  const n = casas ?? casasDoNumero({de, ate}); // 7,5% não vira 8% (video-D8)
  return (
    <span style={{fontFamily: TIT, fontWeight: 700, fontSize: tam, lineHeight: 0.9, letterSpacing: -2, color: cor ?? t.destaque, fontVariantNumeric: 'tabular-nums'}}>
      {formatarNumero(n === 0 ? Math.round(de + (ate - de) * p) : de + (ate - de) * p, n)}
    </span>
  );
};

// O logo (arquivo na mídia do projeto) ou, sem ele, o nome de quem assina em texto, com degradê no destaque.
export const Marca: React.FC<{logo?: string; nome?: string; tam?: number}> = ({logo, nome, tam = 1}) =>
  <MarcaVideo logo={logo} nome={nome} tam={tam} fonte={TIT} cores={CORES_MARCA} />;

export const Abertura: React.FC<{c: Cena; logo?: string; nome?: string}> = ({c, logo, nome}) =>
  <Vinheta t_in={c.t_in} t_out={c.t_out} logo={logo} nome={nome} fonte={TIT} cores={CORES_MARCA} />;

// CTA de orientação, narrado: "Ficou com alguma dúvida? Procure um advogado trabalhista." Sem chamar para um escritório.
export const Duvida: React.FC<{c: Cena; p: {duvida: {pergunta: string; resposta: string}}}> = ({c, p}) => {
  const {mola} = useT(c.t_in);
  const m1 = mola(c.ev.duvida ?? c.t_in);
  const m2 = mola(c.ev.advogado ?? c.t_in + 1500);
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', top: 380, left: 70, right: 70, textAlign: 'center'}}>
        <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 93, color: K.claro, lineHeight: 0.95, opacity: m1, transform: `translateY(${(1 - m1) * 50}px)`}}>
          {p.duvida.pergunta.toUpperCase()}</div>
        <div style={{height: 8, width: 220, background: K.destaque, margin: '44px auto', transform: `scaleX(${m2})`}} />
        <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 74, color: K.destaque, lineHeight: 0.95, opacity: m2, transform: `scale(${0.85 + 0.15 * m2})`}}>
          {p.duvida.resposta.toUpperCase()}</div>
      </div>
    </AbsoluteFill>
  );
};

// Cartão final: segura ~3,5 s com a marca, o convite para salvar e compartilhar, o @ e o site.
export const Final: React.FC<{c: Cena; p: {logo?: string; final: {titulo: string; aviso: string}; marca: MarcaCarrossel}}> = ({c, p}) => (
  <CartaoFinal t_in={c.t_in} logo={p.logo} nome={p.marca.nome} titulo={p.final.titulo} contato={[p.marca.insta, p.marca.site].filter(Boolean).join(' · ')}
    aviso={p.final.aviso} fontes={{titulo: TIT, texto: TXT}} cores={CORES_MARCA} />
);

// ---------- legenda palavra a palavra ----------
export const LegendaAtual: React.FC<{legendas: Legenda[]; tema: Tema}> = ({legendas, tema}) => {
  const frame = useCurrentFrame();
  const ms = (frame / FPS) * 1000;
  const b = legendas.find((l) => ms >= l.s - 80 && ms <= l.e + 250);
  if (!b) return null;
  const entra = interpolate(ms, [b.s - 80, b.s + 70], [0, 1], clamp);
  const claro = tema.modo === 'claro';
  return (
    <div style={{position: 'absolute', left: 50, right: 50, bottom: 1920 - baseDaLegendaCarrossel(), display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px 22px',
      opacity: entra, transform: `translateY(${(1 - entra) * 16}px)`}}>
      {b.palavras.map((w, i) => {
        const ativo = ms >= w.s && ms < w.e + 60;
        const dita = ms >= w.s;
        const cor = ativo ? (claro ? K.destaqueProfundo : K.destaque) : dita ? tema.texto : claro ? comAlfa(K.escuroProfundo, 0.38) : comAlfa(K.claro, 0.5);
        return <span key={i} style={{fontFamily: TIT, fontWeight: 700, fontSize: 64, lineHeight: 1.12, color: cor,
          textShadow: claro ? 'none' : '0 4px 0 rgba(0,0,0,0.85)'}}>{w.w}</span>;
      })}
    </div>
  );
};

export const Transicao: React.FC = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 9], [-1300, 1300], {...clamp, easing: Easing.inOut(Easing.cubic)});
  return <div style={{position: 'absolute', top: -200, bottom: -200, width: 320, left: 380 + x, transform: 'skewX(-14deg)',
    background: `linear-gradient(90deg, ${K.destaqueProfundo}, ${K.destaque}, ${K.destaqueClaro})`}} />;
};

export const SaidaSuave: React.FC<{dur: number; ultima: boolean; children: React.ReactNode}> = ({dur, ultima, children}) => {
  const frame = useCurrentFrame();
  const o = ultima ? 1 : interpolate(frame, [dur - 6, dur], [1, 0], clamp);
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};
