// Carrossel narrado por tema: as cenas vêm dos dados do roteiro.json, um gancho com frases grandes e partes com título e
// blocos (cartão, nota, frase, número, texto grande, itens, comparação, régua, carimbo, documento, selo da decisão, foto)
// que entram nas palavras da narração e podem sair para dar lugar a outro. Peças comuns (vinheta do logo, legenda palavra
// a palavra, contagem das partes, rodapé) em CarrosselNarrado.tsx. Tempos em ms de SAÍDA (src/nucleo/roteiro/resolver.ts
// lê o roteiro.json do projeto). No estúdio, cada bloco leva `data-origem` (o caminho dele no roteiro) para a prévia
// achar o que foi clicado; o atributo não muda nenhum pixel.
import React from 'react';
import {AbsoluteFill, Easing, Html5Audio, Img, Sequence, useCurrentFrame} from 'remotion';
import {FPS, quadros} from '../anim';
import {CamadaEfeitos} from '../efeitos/CamadaEfeitos';
import {definirBaseMidia, midia} from '../midia';
import type {Efeito} from '../../nucleo/efeitos';
import {casasDoNumero} from '../formatar-numero';
import type {TrechoNarracao} from '../../nucleo/roteiro/resolver';
import {Abertura, Carimbo, Contagem, Duvida, FaixaTopo, Final, Fundo, K, LegendaAtual, MONO, Numero, Rodape, SaidaSuave, Selo, Tag,
  TEMAS, TemaCtx, TIT, TituloParte, Transicao, TXT, useT, useTema, comAlfa, type Legenda, type MarcaCarrossel} from './CarrosselNarrado';
import {ehCorDeDestaque} from '../../nucleo/roteiro/tema';

type Item = {texto: string; em: number};
type Barra = {rotulo: string; valor: number; em: number; destaque?: boolean};
type MarcaRegua = {v: number; rotulo: string; em: number};
type Faixa = {de: number; ate: number; rotulo?: string; em: number; tom?: 'destaque' | 'profundo' | 'neutro' | 'cobre' | 'grafite'}; // 'cobre' e 'grafite': nomes dos roteiros antigos
export type Bloco = {
  tipo: 'cartao' | 'nota' | 'frase' | 'numero' | 'grande' | 'itens' | 'comparacao' | 'regua' | 'carimbo' | 'documento' | 'selo' | 'foto';
  id?: string; origem?: string;      // id estável e caminho no roteiro (JSON Pointer)
  em: number; sai?: number;
  y: number;                          // topo do bloco; a área livre vai de ~540 (abaixo do título) a ~1270 (acima da legenda de duas linhas, que acaba em 1420)
  x?: number; largura?: number;       // padrão 70 e 940
  texto?: string;                     // **trecho** sai em destaque
  rotulo?: string; nota?: string;     // numero e grande: linha abaixo e nota menor
  de?: number; ate?: number; prefixo?: string; sufixo?: string; casas?: number; // casas decimais do número (0 a 4)
  src?: string; credito?: string;     // foto: arquivo e crédito do bloco; sem src, a foto padrão do roteiro (props.foto)
  itens?: Item[]; marcador?: 'check' | 'numero' | 'x' | 'ponto';
  barras?: Barra[]; unidade?: string;
  escala?: [number, number]; marcas?: MarcaRegua[]; faixas?: Faixa[];
  carimbo?: {texto: string; em: number};
  titulo?: string; linha?: string;    // selo; sem eles, a decisão do tema
  tam?: number; rot?: number; alinhar?: 'centro' | 'esquerda';
};
type Linha = {t: string; em: number; sai?: number; cor?: 'destaque' | 'cobre'}; // 'cobre': nome dos roteiros antigos
export type CenaTema = {tipo: 'abertura' | 'gancho' | 'parte' | 'duvida' | 'final'; id?: string; origem?: string; n?: number; t_in: number; t_out: number;
  ev: Record<string, number>; modo?: 'claro' | 'escuro'; tag?: string; titulo?: string; linhas?: Linha[]; y_linhas?: number; blocos?: Bloco[]};
export type PropsCarrosselTema = {
  duracao_ms: number;
  audio: string;
  legendas: Legenda[];
  cenas: CenaTema[];
  total_partes: number;
  rotulo_partes: string;
  marca: MarcaCarrossel;
  decisao: {titulo: string; linha: string};
  final: {titulo: string; aviso: string};
  duvida: {pergunta: string; resposta: string};
  sons: {src: string; t: number; vol: number}[];
  logo?: string;
  foto?: {src: string; credito: string};      // a foto padrão dos blocos foto sem src (roteiro.foto)
  modo_audio?: 'tudo' | 'voz' | 'efeitos';    // 'voz' só a narração, 'efeitos' só os efeitos (trilhas separadas para mixar); 'tudo' na prévia
  base_midia?: string;                        // servidor local do estúdio (ver midia.ts)
  narracao?: {src: string; trechos: TrechoNarracao[]};  // vídeo-fonte tocado em trechos, no lugar de `audio`
  efeitos?: Efeito[];                         // pilha de efeitos visuais sobre o vídeo inteiro
};

const COM_MARCA: string[] = ['abertura', 'final']; // cenas com o logo da marca: ficam fora da pilha de efeitos
const MODO = {abertura: 'escuro', gancho: 'escuro', parte: 'claro', duvida: 'escuro', final: 'escuro'} as const;
const modoDe = (c: CenaTema) => c.modo ?? MODO[c.tipo] ?? 'escuro';

// "**trecho**" na cor de destaque
const Rico: React.FC<{texto: string; cor: string}> = ({texto, cor}) => (
  <>{texto.split('**').map((s, i) => (i % 2 ? <b key={i} style={{color: cor}}>{s}</b> : <React.Fragment key={i}>{s}</React.Fragment>))}</>
);

// Posição, entrada (sobe com mola na palavra `em`) e saída (some em `sai`) comuns a todo bloco.
const Caixa: React.FC<{b: Bloco; t0: number; sobe: boolean; children: React.ReactNode}> = ({b, t0, sobe, children}) => {
  const {mola, lin} = useT(t0);
  const m = mola(b.em);
  const sai = b.sai !== undefined ? 1 - lin(b.sai, 260) : 1;
  return (
    <div data-origem={b.origem} data-bloco-id={b.id} style={{position: 'absolute', top: b.y, left: b.x ?? 70, width: b.largura ?? 940, opacity: Math.min(1, m * 1.4) * sai,
      transform: sobe ? `translateY(${(1 - m) * 40}px)` : undefined, textAlign: b.alinhar === 'esquerda' ? 'left' : 'center'}}>{children}</div>
  );
};

const Cartao: React.FC<{b: Bloco}> = ({b}) => (
  <div style={{fontFamily: TXT, fontSize: b.tam ?? 35, lineHeight: 1.3, color: K.claro, background: K.escuro, borderLeft: `10px solid ${K.destaque}`,
    padding: '18px 26px', textAlign: 'left'}}><Rico texto={b.texto ?? ''} cor={K.destaqueClaro} /></div>
);

const Nota: React.FC<{b: Bloco}> = ({b}) => {
  const t = useTema();
  return <div style={{fontFamily: TXT, fontSize: b.tam ?? 31, lineHeight: 1.3, color: t.suave}}><Rico texto={b.texto ?? ''} cor={t.destaqueTexto} /></div>;
};

const Frase: React.FC<{b: Bloco}> = ({b}) => {
  const t = useTema();
  const tam = b.tam ?? 66;
  return (
    <div style={{fontFamily: TIT, fontWeight: 700, fontSize: tam, lineHeight: 1, color: t.texto, textTransform: 'uppercase'}}>
      <Rico texto={b.texto ?? ''} cor={tam >= 90 ? K.destaque : t.destaqueTexto} />
    </div>
  );
};

const RotuloNota: React.FC<{b: Bloco}> = ({b}) => {
  const t = useTema();
  return (
    <>
      {b.rotulo && <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 48, lineHeight: 1.05, color: t.texto, marginTop: 6, textTransform: 'uppercase'}}>{b.rotulo}</div>}
      {b.nota && <div style={{fontFamily: TXT, fontSize: 30, lineHeight: 1.3, color: t.suave, marginTop: 8}}><Rico texto={b.nota} cor={t.destaqueTexto} /></div>}
    </>
  );
};

// Número que conta de `de` até `ate` a partir da palavra; prefixo/sufixo curtos ("%", "R$") no tamanho do número.
const Contador: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {lin} = useT(t0);
  const t = useTema();
  const tam = b.tam ?? 220;
  const p = lin(b.em, 1100, Easing.inOut(Easing.cubic));
  const extra = (s: string) => <span style={{fontFamily: TIT, fontWeight: 700, fontSize: s.length <= 2 ? tam * 0.8 : tam * 0.36, lineHeight: 0.9,
    color: s.length <= 2 ? t.destaque : t.texto}}>{s}</span>;
  return (
    <div>
      <div style={{display: 'flex', justifyContent: b.alinhar === 'esquerda' ? 'flex-start' : 'center', alignItems: 'baseline', gap: 12}}>
        {b.prefixo && extra(b.prefixo)}
        <Numero de={b.de ?? 0} ate={b.ate ?? 0} p={p} tam={tam} casas={casasDoNumero(b)} />
        {b.sufixo && extra(b.sufixo)}
      </div>
      <RotuloNota b={b} />
    </div>
  );
};

// Texto grande parado (medidas como "6 MIN 50 S", "EM DOBRO", "52'30\""), no destaque; **trecho** na cor do texto.
const Grande: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {mola} = useT(t0);
  const t = useTema();
  const m = mola(b.em, 220, 13);
  return (
    <div>
      <div style={{fontFamily: TIT, fontWeight: 700, fontSize: b.tam ?? 150, lineHeight: 0.92, letterSpacing: -2, color: K.destaque,
        transform: `scale(${0.8 + 0.2 * m})`}}><Rico texto={b.texto ?? ''} cor={t.texto} /></div>
      <RotuloNota b={b} />
    </div>
  );
};

// Lista em que cada item entra na sua palavra: caixa marcada (✓), numerada, com ✕ ou um ponto.
const Itens: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {mola} = useT(t0);
  const t = useTema();
  const tam = b.tam ?? 46;
  const caixa = Math.round(tam * 1.9);
  const mk = b.marcador ?? 'check';
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: Math.round(tam * 0.55), textAlign: 'left'}}>
      {(b.itens ?? []).map((it, i) => {
        const m = mola(it.em, 220, 13);
        const marcado = m > 0.3;
        const simbolo = mk === 'check' ? (marcado ? '✓' : '') : mk === 'numero' ? String(i + 1) : mk === 'x' ? '✕' : '';
        const cheio = mk === 'check' ? marcado : true;
        const lado = mk === 'ponto' ? Math.round(caixa * 0.32) : caixa;
        const cor = mk === 'x' ? K.escuro : K.destaque;
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 28, opacity: Math.min(1, m * 1.5), transform: `translateX(${(1 - m) * 80}px)`}}>
            <div style={{flex: 'none', width: lado, height: lado, background: cheio ? cor : 'transparent`, border: `6px solid ${cor}`, display: `flex',
              alignItems: 'center', justifyContent: 'center', fontFamily: mk === 'numero' ? TIT : TXT, fontWeight: 800, fontSize: caixa * 0.6,
              color: K.claro, lineHeight: 1}}>{simbolo}</div>
            <div style={{fontFamily: TIT, fontWeight: 700, fontSize: tam, lineHeight: 1.08, color: t.texto}}><Rico texto={it.texto} cor={t.destaqueTexto} /></div>
          </div>
        );
      })}
    </div>
  );
};

// Barras horizontais que crescem na palavra (devido × pago, relógio × trabalho).
const Comparacao: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {lin} = useT(t0);
  const t = useTema();
  const barras = b.barras ?? [];
  const max = Math.max(1, ...barras.map((x) => x.valor));
  const W = (b.largura ?? 940) - 240;
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 30, textAlign: 'left'}}>
      {barras.map((x, i) => {
        const p = lin(x.em, 800, Easing.inOut(Easing.cubic));
        return (
          <div key={i} style={{opacity: Math.min(1, p * 3)}}>
            <div style={{fontFamily: MONO, fontWeight: 600, fontSize: 24, letterSpacing: 3, color: t.suave, marginBottom: 8}}>{x.rotulo.toUpperCase()}</div>
            <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
              <div style={{flex: 'none', height: 88, width: Math.max(8, W * (x.valor / max) * p),
                background: x.destaque ? K.destaque : t.modo === 'claro' ? K.escuro : K.nevoa}} />
              <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 60, color: x.destaque ? t.destaqueTexto : t.texto, whiteSpace: 'nowrap'}}>
                {Math.round(x.valor * p).toLocaleString('pt-BR')}{b.unidade ?? ''}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Régua de tempo: marcas com rótulo e faixas preenchidas (a noite de 22h às 6h38, o prazo do 7º ao 120º dia).
const Regua: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {lin, mola} = useT(t0);
  const t = useTema();
  const [a, z] = b.escala ?? [0, 10];
  const W = b.largura ?? 940;
  const X = (v: number) => 50 + ((v - a) / Math.max(1e-6, z - a)) * (W - 100);
  const neutro = t.modo === 'claro' ? K.escuro : K.nevoa;
  const tons: Record<string, string> = {destaque: K.destaque, cobre: K.destaque, profundo: K.destaqueProfundo, neutro, grafite: neutro};
  return (
    <div style={{position: 'relative', height: 250}}>
      <div style={{position: 'absolute', left: 50, right: 50, top: 100, height: 14, background: t.linha}} />
      {(b.faixas ?? []).map((f, i) => {
        const p = lin(f.em, 900, Easing.inOut(Easing.cubic));
        return (
          <React.Fragment key={i}>
            <div style={{position: 'absolute', left: X(f.de), width: (X(f.ate) - X(f.de)) * p, top: 86, height: 42, background: tons[f.tom ?? 'destaque'] ?? K.destaque}} />
            {f.rotulo && <div style={{position: 'absolute', left: X(f.de) - 40, width: X(f.ate) - X(f.de) + 80, top: 30, textAlign: 'center',
              fontFamily: MONO, fontWeight: 600, fontSize: 22, letterSpacing: 2, color: t.suave, opacity: p}}>{f.rotulo.toUpperCase()}</div>}
          </React.Fragment>
        );
      })}
      {(b.marcas ?? []).map((mk, i) => (
        <div key={i} style={{position: 'absolute', left: X(mk.v) - 100, width: 200, top: 70, textAlign: 'center', opacity: mola(mk.em, 220, 14)}}>
          <div style={{width: 5, height: 74, background: t.texto, margin: '0 auto'}} />
          <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 40, color: t.texto, marginTop: 8}}>{mk.rotulo}</div>
        </div>
      ))}
    </div>
  );
};

const Documento: React.FC<{b: Bloco; t0: number}> = ({b, t0}) => {
  const {mola} = useT(t0);
  const mQ = b.carimbo ? mola(b.carimbo.em, 220, 11) : 0;
  const alto = b.tam ?? 480;
  return (
    <div style={{position: 'relative', margin: '0 auto', width: Math.min(800, b.largura ?? 800), height: alto, background: '#FFFDF9',
      transform: 'rotate(-2deg)', boxShadow: `14px 14px 0 ${comAlfa(K.escuroProfundo, 0.22)}`, padding: '40px 50px', borderTop: `12px solid ${K.escuro}`,
      textAlign: 'left', boxSizing: 'border-box'}}>
      <div style={{fontFamily: TIT, fontWeight: 700, fontSize: 40, color: K.escuroProfundo, lineHeight: 1.05}}>{b.texto}</div>
      {b.nota && <div style={{fontFamily: MONO, fontSize: 22, color: K.nevoa, marginTop: 10}}>{b.nota}</div>}
      {Array.from({length: Math.max(2, Math.floor((alto - 200) / 40))}, (_, i) => (
        <div key={i} style={{height: 14, background: comAlfa(K.escuro, 0.14), marginTop: 26, width: `${92 - (i % 3) * 14}%`}} />
      ))}
      {b.carimbo && <div style={{position: 'absolute', right: 30, top: alto * 0.42}}><Carimbo texto={b.carimbo.texto} m={mQ} rot={-14} tam={76} /></div>}
    </div>
  );
};

const Foto: React.FC<{b: Bloco; t0: number; foto?: PropsCarrosselTema['foto']}> = ({b, t0, foto}) => {
  const {mola} = useT(t0);
  const m = mola(b.em, 260, 13);
  // foto e crédito do próprio bloco (video-D7); sem src, a padrão do roteiro com o crédito dela
  const src = b.src ?? foto?.src;
  const credito = b.credito ?? (b.src ? '' : foto?.credito ?? '');
  if (!src) return null;
  return (
    <div style={{margin: '0 auto', width: b.largura ?? 740, transform: `rotate(${-4 + (1 - m) * 18}deg) scale(${1.25 - 0.25 * m})`, background: K.claro,
      padding: 16, boxShadow: '16px 18px 0 rgba(0,0,0,0.45)', textAlign: 'left'}}>
      <Img src={midia(src)} style={{width: '100%', height: b.tam ?? 470, objectFit: 'cover', display: 'block'}} />
      {credito && <div style={{fontFamily: TXT, fontSize: 19, color: K.nevoa, marginTop: 8}}>{credito}</div>}
    </div>
  );
};

const BlocoCena: React.FC<{b: Bloco; t0: number; p: PropsCarrosselTema}> = ({b, t0, p}) => {
  const {mola} = useT(t0);
  const corpo = (() => {
    switch (b.tipo) {
      case 'cartao': return <Cartao b={b} />;
      case 'nota': return <Nota b={b} />;
      case 'frase': return <Frase b={b} />;
      case 'numero': return <Contador b={b} t0={t0} />;
      case 'grande': return <Grande b={b} t0={t0} />;
      case 'itens': return <Itens b={b} t0={t0} />;
      case 'comparacao': return <Comparacao b={b} t0={t0} />;
      case 'regua': return <Regua b={b} t0={t0} />;
      case 'carimbo': return <Carimbo texto={b.texto ?? ''} m={mola(b.em, 220, 12)} rot={b.rot ?? -8} tam={b.tam ?? 80} />;
      case 'documento': return <Documento b={b} t0={t0} />;
      case 'selo': return <div style={{textAlign: 'left'}}><Selo titulo={b.titulo ?? p.decisao.titulo} linha={b.linha ?? p.decisao.linha} m={mola(b.em)} /></div>;
      case 'foto': return b.src || p.foto ? <Foto b={b} t0={t0} foto={p.foto} /> : null;
      default: return null;
    }
  })();
  // carimbo, selo e foto já têm a própria entrada
  return <Caixa b={b} t0={t0} sobe={!['carimbo', 'selo', 'foto'].includes(b.tipo)}>{corpo}</Caixa>;
};

// Gancho: a frase de abertura em linhas grandes que entram alternando os lados, a tag (opcional) e blocos opcionais.
const Gancho: React.FC<{c: CenaTema; p: PropsCarrosselTema}> = ({c, p}) => {
  const {mola, lin} = useT(c.t_in);
  const t = useTema();
  const linhas = c.linhas ?? [];
  const maior = Math.max(1, ...linhas.map((l) => l.t.length));
  const tam = Math.min(110, Math.floor(940 / (maior * 0.7)));   // Archivo 700 em caixa alta: ~0,68 em por letra
  return (
    <AbsoluteFill>
      {c.tag && <Tag texto={c.tag} y={90} />}
      <div style={{position: 'absolute', top: c.y_linhas ?? 240, left: 60, right: 60, textAlign: 'center'}}>
        {linhas.map((l, i) => {
          const m = mola(l.em);
          const sai = l.sai !== undefined ? 1 - lin(l.sai, 260) : 1;
          return <div key={i} data-origem={c.origem ? `${c.origem}/linhas/${i}` : undefined} style={{fontFamily: TIT, fontWeight: 700, fontSize: tam, lineHeight: 1, color: ehCorDeDestaque(l.cor) ? K.destaque : t.texto,
            opacity: m * sai, transform: `translateX(${(1 - m) * (i % 2 ? 300 : -300)}px)`}}>{l.t.toUpperCase()}</div>;
        })}
      </div>
      {(c.blocos ?? []).map((b, i) => <BlocoCena key={i} b={b} t0={c.t_in} p={p} />)}
    </AbsoluteFill>
  );
};

const Parte: React.FC<{c: CenaTema; p: PropsCarrosselTema}> = ({c, p}) => (
  <AbsoluteFill>
    <TituloParte n={c.n ?? 0} tag={c.tag ?? ''} titulo={c.titulo ?? ''} t0={c.t_in} />
    {(c.blocos ?? []).map((b, i) => <BlocoCena key={i} b={b} t0={c.t_in} p={p} />)}
  </AbsoluteFill>
);

const Narracao: React.FC<{p: PropsCarrosselTema}> = ({p}) => {
  if (!p.narracao) return <Html5Audio src={midia(p.audio)} />;
  const src = midia(p.narracao.src);
  return (
    <>
      {p.narracao.trechos.map((t, i) => (
        <Sequence key={`n${i}`} from={quadros(t.em)} durationInFrames={Math.max(1, quadros(t.ate) - quadros(t.de))} layout="none">
          <Html5Audio src={src} trimBefore={quadros(t.de)} />
        </Sequence>
      ))}
    </>
  );
};

export const CarrosselTema: React.FC<PropsCarrosselTema> = (p) => {
  definirBaseMidia(p.base_midia);
  const frame = useCurrentFrame();
  const ms = (frame / FPS) * 1000;
  const atual = p.cenas.find((c) => ms >= c.t_in && ms < c.t_out) ?? p.cenas[p.cenas.length - 1];
  const tema = TEMAS[modoDe(atual)];
  const parte = atual.tipo === 'parte' ? atual.n ?? 0 : 0;
  const comp = (c: CenaTema) => {
    switch (c.tipo) {
      case 'abertura': return <Abertura c={c} logo={p.logo} nome={p.marca.nome} />;
      case 'gancho': return <Gancho c={c} p={p} />;
      case 'parte': return <Parte c={c} p={p} />;
      case 'duvida': return <Duvida c={c} p={p} />;
      case 'final': return <Final c={c} p={p} />;
      default: return null;
    }
  };
  const cena = (c: CenaTema, i: number) => {
    const de = quadros(c.t_in);
    const dur = Math.max(1, quadros(c.t_out) - de);
    return (
      <Sequence key={i} from={de} durationInFrames={dur}>
        <TemaCtx.Provider value={TEMAS[modoDe(c)]}>
          <SaidaSuave dur={dur} ultima={c.tipo === 'final'}>{comp(c)}</SaidaSuave>
        </TemaCtx.Provider>
      </Sequence>
    );
  };
  return (
    <AbsoluteFill style={{backgroundColor: tema.fundo}}>
      {p.modo_audio !== 'efeitos' && <Narracao p={p} />}
      {p.modo_audio !== 'voz' && p.sons.map((s, i) => (
        // efeito sonoro curto (o mais longo tem ~1,1 s): sem duração, cada um ficaria montado até o fim e a prévia
        // estouraria o limite de tags de áudio do Player
        <Sequence key={`s${i}`} from={Math.max(0, quadros(s.t))} durationInFrames={FPS * 3} layout="none"><Html5Audio src={midia(s.src)} volume={s.vol} /></Sequence>
      ))}
      {/* os efeitos valem no fundo, nas cenas de conteúdo e na contagem; o logo (abertura e cartão final), a legenda, a faixa do topo e o
          rodapé da marca ficam de fora, como no vídeo de cenas (o logo não leva efeito: tres-efeitos-N1 e D15) */}
      <CamadaEfeitos efeitos={p.efeitos} quadro={frame} largura={1080} altura={1920}>
      <Fundo modo={tema.modo} />
      {p.cenas.map((c, i) => (COM_MARCA.includes(c.tipo) ? null : cena(c, i)))}
      {parte > 0 && <Contagem atual={parte} total={p.total_partes} rotulo={p.rotulo_partes} tema={tema} />}
      {p.cenas.slice(1).map((c, i) => (
        <Sequence key={`t${i}`} from={quadros(c.t_in) - 4} durationInFrames={10} layout="none"><Transicao /></Sequence>
      ))}
      </CamadaEfeitos>
      {p.cenas.map((c, i) => (COM_MARCA.includes(c.tipo) ? cena(c, i) : null))}
      {!['abertura', 'duvida', 'final'].includes(atual.tipo) && <LegendaAtual legendas={p.legendas} tema={tema} />}
      <FaixaTopo />
      {atual.tipo !== 'abertura' && <Rodape m={p.marca} />}
    </AbsoluteFill>
  );
};
