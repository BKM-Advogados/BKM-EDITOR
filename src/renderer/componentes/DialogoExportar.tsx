// Diálogo de exportar (Ctrl+Shift+E), o único lugar por onde algo "sai" do projeto (tela.md): antes, os destinos (uma ou
// mais proporções), formato, qualidade, escala, trecho, nome e a estimativa de tamanho (bitrate × duração); durante, o
// andamento de verdade e Cancelar; no fim, os arquivos e "Mostrar na pasta". No vídeo, cada destino tem a sua marca
// d'água (logo ou assinatura do kit, canto, tamanho, opacidade), com a miniatura de um quadro real ao lado, lembrada no
// projeto (.estudio/exportacao.json) quando se exporta. O vídeo passa pelo processo principal
// (renderMedia); a imagem é desenhada aqui mesmo (exportarPng) e só o arquivo vai ao principal. Fica fora do React de
// quem chama, como o Dialogo.tsx: `abrirDialogoExportar(documento)` abre e <RaizDialogoExportar/>, montada na casca, desenha.
import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Thumbnail} from '@remotion/player';
import {ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, CircleCheck, FolderOpen, Stamp, X} from 'lucide-react';
import type {Progresso, ResultadoExportacao} from '../../compartilhado/api';
import {COMPOSICOES, composicaoDe} from '../../composicoes/registro';
import {fonte as familiaDaFonte} from '../../composicoes/fontes';
import {CONTRASTE_MINIMO, placaParaMarca, type AvaliacaoContraste, type CorDaPlaca} from '../../nucleo/contraste';
import type {DocImagem} from '../../nucleo/documentos';
import {paginasDe, temPaginas} from '../../nucleo/carrossel';
import {
  CANTOS_MARCA, CODECS, configPadraoMarca, destinoDoFormato, ESCALAS_IMAGEM, ESCALAS_VIDEO, estimarExportacao, fontesDaMarcaDagua, formatarBytes, FORMATOS_IMAGEM_SAIDA,
  encostarTrecho, fecharMedidaPersonalizada, legendasDasProps, legendasNoDestino, lerMedidaPersonalizada, marcaDaguaDoDestino, nomesDosArquivos, sobreposicoes, normalizarConfigMarca, OPACIDADE_MARCA, QUALIDADES, TAMANHO_MARCA, trechoValido,
  type CodecVideo, type ConfigMarcaDagua, type Destino, type FontesMarcaDagua, type FormatoImagem, type MarcaDaguaP, type OpcoesExportarVideo, type QualidadeVideo,
} from '../../nucleo/exportacao';
import {FORMATO_PADRAO, FORMATOS_VIDEO, proporcaoDe, type Formato} from '../../nucleo/formatos';
import type {LegendasP} from '../../nucleo/legendas';
import {conjuntoDe, zonasDaMarca, type CantoMarca} from '../../nucleo/zonas-seguras';
import {avisar, useLoja} from '../estado/loja';
import {exportarPng, type SaidaPng} from '../modulos/imagem/exportarPng';
import {exportarCarrossel} from '../modulos/imagem/exportarPaginas';
import {numeroBr} from './Campos';
import '../modulos/video/zonas-seguras.css';
import './dialogo-exportar.css';

let aberto: string | null = null;
const ouvintes = new Set<() => void>();
const mudar = (d: string | null) => {
  aberto = d;
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

/** Abre o diálogo para o documento (vídeo ou imagem). */
export const abrirDialogoExportar = (documento: string) => mudar(documento);

const lerSegundos = (t: string) => Number(t.trim().replace(/\s/g, '').replace(',', '.'));
const nomeDoArquivo = (caminho: string) => caminho.split(/[\\/]/).pop() ?? caminho;

// ---------- pedaços comuns ----------
const Moldura: React.FC<{titulo: string; sub?: string; fechar?: () => void; aoEnter?: () => void; children: React.ReactNode}> = ({titulo, sub, fechar, aoEnter, children}) => (
  <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && fechar?.()}
    onKeyDown={(e) => {
      if (e.key === 'Escape') fechar?.();
      if (e.key === 'Enter' && aoEnter && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        aoEnter();
      }
    }}>
    <div className="dialogo exportar" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="dialogo-titulo">
        {titulo}
        {sub && <span className="sub" title={sub}>· {sub}</span>}
        {fechar && <button className="bti" onClick={fechar} title="Fechar (Esc)"><X size={14} /></button>}
      </div>
      {children}
    </div>
  </div>
);

const Linha: React.FC<{rotulo: string; children: React.ReactNode}> = ({rotulo, children}) => (
  <div className="linha-exp"><span className="rot">{rotulo}</span><div className="val">{children}</div></div>
);

const Segmentos = <T extends string | number>({valor, opcoes, aoMudar}: {valor: T; opcoes: {valor: T; nome: string; dica?: string}[]; aoMudar: (v: T) => void}) => (
  <span className="segmentos">
    {opcoes.map((o) => <button key={String(o.valor)} type="button" className={o.valor === valor ? 'ativo' : ''} title={o.dica} onClick={() => aoMudar(o.valor)}>{o.nome}</button>)}
  </span>
);

type Andamento = {mensagem?: string; etapa?: string; pct?: number; arquivo?: string; indice?: number; total?: number};
/** Junta um evento ao andamento guardado: a porcentagem fica até vir outra, e zera quando começa outro arquivo. */
const juntar = (a: Andamento, p: Progresso): Andamento => {
  const outroArquivo = Boolean(p.arquivo && p.arquivo !== a.arquivo);
  return {mensagem: p.mensagem ?? a.mensagem, etapa: p.etapa ?? (outroArquivo ? undefined : a.etapa), pct: p.progresso ?? (outroArquivo ? undefined : a.pct),
    arquivo: p.arquivo || a.arquivo, indice: p.indice ?? a.indice, total: p.total ?? a.total};
};

const BarraAndamento: React.FC<{a: Andamento; cancelar?: () => void}> = ({a, cancelar}) => (
  <>
    <div className="andamento">
      <div className="texto">
        <b>{a.total && a.total > 1 && a.indice ? `${a.indice} de ${a.total} · ` : ''}{a.arquivo || 'Preparando…'}</b>
        <span>{a.pct !== undefined ? `${Math.round(a.pct)}%` : ''}</span>
      </div>
      <div className={`barra-andamento${a.pct === undefined ? ' indefinida' : ''}`}><span style={{width: `${Math.max(0, Math.min(100, a.pct ?? 0))}%`}} /></div>
      <div className="texto"><span>{a.mensagem ?? ''}</span>{a.etapa && <span className="nota">{a.etapa}</span>}</div>
    </div>
    {cancelar && <div className="dialogo-botoes"><button className="bt" onClick={cancelar}>Cancelar</button></div>}
  </>
);

/** Fim: os arquivos com "Mostrar na pasta", ou o motivo de ter parado. */
const Pronto: React.FC<{arquivos: string[]; pasta?: string; erro?: string; cancelado?: boolean; voltar: () => void; fechar: () => void}> = ({arquivos, pasta, erro, cancelado, voltar, fechar}) => (
  <>
    {arquivos.length > 0 && (
      <ul className="arquivos-exp">
        {arquivos.map((a) => (
          <li key={a}><CircleCheck size={14} /><span className="nome" title={a}>{nomeDoArquivo(a)}</span>
            <button className="bt fantasma mini" onClick={() => window.estudio.mostrarArquivo(a)} title={a}><FolderOpen size={13} />Mostrar na pasta</button>
          </li>
        ))}
      </ul>
    )}
    {cancelado && <div className="dialogo-texto">Exportação cancelada{arquivos.length ? '; o que já tinha saído ficou em saidas/' : ''}.</div>}
    {erro && !cancelado && <div className="erro-exp">Não deu para exportar: {erro}</div>}
    <div className="dialogo-botoes">
      {pasta && arquivos.length > 1 && <button className="bt fantasma" onClick={() => window.estudio.mostrarNaPasta(pasta)}><FolderOpen size={14} />Abrir a pasta saidas</button>}
      {(erro || cancelado) && <button className="bt fantasma" onClick={voltar}>Voltar às opções</button>}
      <button className="bt principal" onClick={fechar} autoFocus>Fechar</button>
    </div>
  </>
);

// ---------- marca d'água ----------
const ICONES_CANTO: Record<CantoMarca, React.FC<{size?: number}>> = {'sup-esq': ArrowUpLeft, 'sup-dir': ArrowUpRight, 'inf-esq': ArrowDownLeft, 'inf-dir': ArrowDownRight};
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Endereço de um arquivo de mídia das props (o mesmo cálculo do midia.ts, sem mexer na base que a prévia usa). */
const urlDaMidia = (base: unknown, src: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : `${String(base ?? '').replace(/\/+$/, '')}/${src.split('/').map(encodeURIComponent).join('/')}`;

/** Um quadro do vídeo no tamanho do destino, com a marca d'água e as zonas da rede apagadas por cima: a composição de
 *  verdade (Thumbnail do Remotion), como a exportação vai desenhar. A legenda vai na área do destino, a mesma de que a
 *  marca se afasta. */
type EstadoContraste = 'medindo' | {avaliacao: AvaliacaoContraste} | {erro: string};
type Sobreposto = {a: string; b: string; caixa: {x: number; y: number; largura: number; altura: number}[]};

const Miniatura: React.FC<{props: Record<string, unknown>; largura: number; altura: number; fixo: boolean; fps: number; duracaoMs: number; marca: MarcaDaguaP | null;
  legendas: LegendasP | null; aoSobrepor?: (pares: string[]) => void}> = ({props, largura, altura, fixo, fps, duracaoMs, marca, legendas, aoSobrepor}) => {
    const raiz = React.useRef<HTMLDivElement>(null);
    const [sobre, setSobre] = useState<Sobreposto[]>([]);
    const tempo = useLoja((e) => e.tempo_ms);
    const total = Math.max(1, Math.ceil((duracaoMs / 1000) * fps));
    // o quadro em que a cabeça parou; no começo do vídeo, 1,5 s adiante (o primeiro bloco ainda está entrando)
    const quadro = Math.min(total - 1, Math.round(((tempo > 500 ? tempo : 1500) / 1000) * fps));
    const entrada = useMemo(() => ({...props, ...(fixo ? {} : {largura, altura}), ...(legendas ? {legendas_cenas: legendas} : {}), ...(marca ? {marca_dagua: marca} : {})}),
      [props, fixo, largura, altura, legendas, marca]);
    const escala = Math.min(150 / largura, 150 / altura);
    const zonas = conjuntoDe(zonasDaMarca(largura, altura))?.zonas ?? [];
    // video-D4: mede os blocos que a composição desenhou neste quadro, no tamanho do destino, e marca os que se sobrepõem.
    // Bloco ainda invisível (opacidade ~0: entra depois ou já saiu) não conta; a medida é a do DOM de verdade.
    useEffect(() => {
      const el = raiz.current;
      if (!el) return;
      let anim = 0;
      let ultimo = '';
      const medir = () => {
        const R = el.getBoundingClientRect();
        if (!R.width || !R.height) return;
        const caixas = [...el.querySelectorAll<HTMLElement>('[data-bloco-id]')].filter((b) => Number(getComputedStyle(b).opacity) > 0.05).map((b) => {
          const r = b.getBoundingClientRect();
          const rot = (b.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 22) || b.dataset.blocoId || '?';
          return {id: rot, x: (r.left - R.left) / R.width, y: (r.top - R.top) / R.height, largura: r.width / R.width, altura: r.height / R.height};
        });
        const pares: Sobreposto[] = sobreposicoes(caixas).map(([a, b]) => ({a, b, caixa: caixas.filter((c) => c.id === a || c.id === b)}));
        const chave = JSON.stringify(pares.map((p) => [p.a, p.b, p.caixa.map((c) => [c.x.toFixed(3), c.y.toFixed(3), c.largura.toFixed(3), c.altura.toFixed(3)])]));
        if (chave === ultimo) return;
        ultimo = chave;
        setSobre(pares);
        aoSobrepor?.(pares.map((p) => `"${p.a}" e "${p.b}"`));
      };
      const agendar = () => {
        cancelAnimationFrame(anim);
        anim = requestAnimationFrame(medir);
      };
      const mo = new MutationObserver(agendar);
      mo.observe(el, {subtree: true, childList: true, attributes: true, attributeFilter: ['style']});
      agendar();
      const t = window.setTimeout(agendar, 700); // a fonte do tema pode chegar depois do primeiro desenho
      return () => {
        mo.disconnect();
        cancelAnimationFrame(anim);
        window.clearTimeout(t);
      };
    }, [quadro, largura, altura, entrada]); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div ref={raiz} className="miniatura-exp" style={{width: Math.round(largura * escala), height: Math.round(altura * escala)}} title={`${largura}×${altura} · quadro em ${numeroBr(quadro / fps, 1)} s${sobre.length ? ' · blocos sobrepostos' : ''}`}>
        <Thumbnail component={COMPOSICOES[composicaoDe(props)]} inputProps={entrada} compositionWidth={largura} compositionHeight={altura} durationInFrames={total} fps={fps}
          frameToDisplay={quadro} style={{width: '100%', height: '100%'}} />
        <div className="zonas-seguras" aria-hidden="true">
          {zonas.map((z, i) => <div key={i} className={`zona ${z.tipo}`} style={{left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.largura * 100}%`, height: `${z.altura * 100}%`}} />)}
        </div>
        {sobre.flatMap((p, i) => p.caixa.map((c, k) => (
          <div key={`${i}-${k}`} className="sobre" data-sobreposicao style={{left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.largura * 100}%`, height: `${c.altura * 100}%`}} />
        )))}
      </div>
    );
  };

/** Uma miniatura por destino marcado, no tamanho dele, com o aviso dos blocos que se sobrepõem nesse quadro: o layout feito num
 *  formato pode não caber em outro, e o diálogo avisa antes do render (video-D4). */
const PreviaDosDestinos: React.FC<{destinos: Destino[]; props: Record<string, unknown>; medidaDe: (d: Destino) => {largura: number; altura: number}; fixo: boolean; fps: number;
  duracaoMs: number; marcaDe: (d: Destino) => MarcaDaguaP | null; legendasDe: (d: Destino) => LegendasP | null}> = ({destinos, props, medidaDe, fixo, fps, duracaoMs, marcaDe, legendasDe}) => {
  const [avisos, setAvisos] = useState<Record<string, string[]>>({});
  return (
    <div className="previa-destinos">
      {destinos.map((d) => {
        const m = medidaDe(d);
        const lista = avisos[d.id] ?? [];
        return (
          <div key={d.id} className="previa-destino">
            <Miniatura props={props} {...m} fixo={fixo} fps={fps} duracaoMs={duracaoMs} marca={marcaDe(d)} legendas={legendasDe(d)}
              aoSobrepor={(pares) => setAvisos((a) => (JSON.stringify(a[d.id] ?? []) === JSON.stringify(pares) ? a : {...a, [d.id]: pares}))} />
            <div className="nota">{d.id === 'personalizado' ? `${m.largura}×${m.altura}` : proporcaoDe(m.largura, m.altura)}</div>
            {lista.length > 0 && <div className="erro-exp" data-aviso-sobreposicao title={lista.join('; ')}>Sobrepõe: {lista.slice(0, 2).join('; ')}{lista.length > 2 ? '…' : ''}</div>}
          </div>
        );
      })}
    </div>
  );
};

/** A marca d'água do destino em edição: ligar, logo ou assinatura, canto, tamanho e opacidade, com a miniatura ao lado.
 *  Com vários destinos marcados, os botões de cima escolhem qual se edita (cada um guarda a sua escolha). */
const OpcoesMarca: React.FC<{destinos: Destino[]; atual: Destino; editar: (id: string) => void; config: (d: Destino) => ConfigMarcaDagua;
  mudar: (d: Destino, m: Partial<ConfigMarcaDagua>) => void; fontes: FontesMarcaDagua; marca: MarcaDaguaP | null; miniatura: React.ReactNode;
  contraste?: EstadoContraste; aoMedir: (placa?: CorDaPlaca | null) => void}> =
  ({destinos, atual, editar, config, mudar, fontes, marca, miniatura, contraste, aoMedir}) => {
    const c = config(atual);
    const nomeDe = (d: Destino) => (d.id === 'personalizado' ? `${d.largura}×${d.altura}` : proporcaoDe(d.largura, d.altura));
    const conteudos = [fontes.logo ? {valor: 'logo' as const, nome: 'Logo', dica: 'O logo do kit de marca'} : null,
      fontes.assinatura ? {valor: 'assinatura' as const, nome: 'Assinatura', dica: fontes.assinatura} : null].filter((x) => x !== null);
    return (
      <div className="md-exp">
        <div className="md-campos">
          {destinos.length > 1 && (
            <Segmentos valor={atual.id} aoMudar={editar} opcoes={destinos.map((d) => ({valor: d.id, nome: nomeDe(d),
              dica: `${nomeDe(d)}: ${config(d).ligada ? 'com' : 'sem'} marca d'água`}))} />
          )}
          <label className="escolha-exp"><input type="checkbox" checked={c.ligada} onChange={(e) => mudar(atual, {ligada: e.target.checked})} />
            {destinos.length > 1 ? `Marca d'água no ${nomeDe(atual)}` : 'Pôr marca d\'água'}</label>
          {c.ligada && (
            <>
              <div className="md-linha"><span className="rot2">Conteúdo</span>
                {conteudos.length > 1 ? <Segmentos valor={c.conteudo} aoMudar={(v) => mudar(atual, {conteudo: v})} opcoes={conteudos} />
                  : <span className="nota">{fontes.logo ? 'o logo do kit' : `a assinatura ${fontes.assinatura}`}</span>}
              </div>
              <div className="md-linha"><span className="rot2">Canto</span>
                <span className="cantos">
                  {CANTOS_MARCA.map((k) => {
                    const Icone = ICONES_CANTO[k.id];
                    return <button key={k.id} type="button" className={`bti${k.id === c.canto ? ' ligado' : ''}`} title={k.nome} aria-label={k.nome} onClick={() => mudar(atual, {canto: k.id})}><Icone size={13} /></button>;
                  })}
                </span>
              </div>
              <div className="md-linha"><span className="rot2">Tamanho</span>
                <input type="range" min={TAMANHO_MARCA.min * 100} max={TAMANHO_MARCA.max * 100} step={0.5} value={c.tamanho * 100} aria-label="Tamanho da marca d'água"
                  onChange={(e) => mudar(atual, {tamanho: Number(e.target.value) / 100})} />
                <span className="nota">{pct(c.tamanho)} do lado menor</span>
              </div>
              <div className="md-linha"><span className="rot2">Opacidade</span>
                <input type="range" min={OPACIDADE_MARCA.min * 100} max={OPACIDADE_MARCA.max * 100} step={5} value={c.opacidade * 100} aria-label="Opacidade da marca d'água"
                  onChange={(e) => mudar(atual, {opacidade: Number(e.target.value) / 100})} />
                <span className="nota">{pct(c.opacidade)}</span>
              </div>
              <div className="md-linha"><span className="rot2">Placa</span>
                <Segmentos valor={c.placa ?? 'nenhuma'} aoMudar={(v) => mudar(atual, {placa: v === 'nenhuma' ? undefined : v})}
                  opcoes={[{valor: 'nenhuma', nome: 'Nenhuma'}, {valor: 'escura', nome: 'Escura', dica: 'Fundo grafite atrás da marca'}, {valor: 'clara', nome: 'Clara', dica: 'Fundo osso atrás da marca'}]} />
              </div>
              <div className="md-linha" data-contraste><span className="rot2">Contraste</span>
                <button type="button" className="bt mini" disabled={contraste === 'medindo'} onClick={() => aoMedir()}
                  title="Renderiza três quadros do vídeo neste formato, sem a marca e com ela, e mede o contraste (mínimo 3:1)">{contraste === 'medindo' ? 'Medindo…' : 'Conferir'}</button>
                {contraste && contraste !== 'medindo' && ('erro' in contraste
                  ? <span className="nota" style={{color: 'var(--erro)'}}>{contraste.erro}</span>
                  : (
                    <span className="nota" data-resultado-contraste style={{color: contraste.avaliacao.ok ? 'var(--ok)' : 'var(--aviso)'}}>
                      {contraste.avaliacao.contraste === null ? 'a marca não apareceu nos quadros medidos'
                        : `${numeroBr(contraste.avaliacao.contraste, 1)}:1 ${contraste.avaliacao.ok ? `(mínimo ${CONTRASTE_MINIMO}:1)` : `— abaixo de ${CONTRASTE_MINIMO}:1`}`}
                    </span>
                  ))}
                {contraste && contraste !== 'medindo' && 'avaliacao' in contraste && !contraste.avaliacao.ok && (
                  <button type="button" className="bt mini" onClick={() => aoMedir(placaParaMarca(contraste.avaliacao.marca ?? [255, 255, 255]))}
                    title="Põe uma placa atrás da marca e mede de novo">Usar placa {placaParaMarca(contraste.avaliacao.marca ?? [255, 255, 255]) === 'escura' ? 'escura' : 'clara'}</button>
                )}
              </div>
              {marca && !marca.segura && <div className="erro-exp">Grande demais para ficar fora das zonas da rede e da legenda neste canto: diminua o tamanho ou troque o canto.</div>}
            </>
          )}
        </div>
        {miniatura}
      </div>
    );
  };

// ---------- vídeo ----------
type FaseVideo = {tipo: 'opcoes'} | {tipo: 'exportando'; a: Andamento} | {tipo: 'pronto'; r: ResultadoExportacao};

const ExportarVideo: React.FC<{documento: string; fechar: () => void}> = ({documento, fechar}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const montado = useLoja((e) => e.props[documento]);
  const props = montado && 'props' in montado ? montado.props : null;
  const formato: Formato = {largura: Number(props?.largura) || FORMATO_PADRAO.largura, altura: Number(props?.altura) || FORMATO_PADRAO.altura, fps: Number(props?.fps) || FORMATO_PADRAO.fps};
  const duracaoMs = Number(props?.duracao_ms) || 0;
  const fixo = Boolean(props) && props!.composicao !== 'VideoCenas'; // o carrossel da Cliente só sai em 1080×1920
  const comAudio = fixo || Boolean(props && ['audio', 'trilha', 'narracao', 'sons'].some((k) => (Array.isArray(props[k]) ? (props[k] as unknown[]).length > 0 : Boolean(props[k]))));
  const doDocumento = destinoDoFormato(formato);

  const [destinos, setDestinos] = useState<Destino[]>([doDocumento]);
  const [personalizado, setPersonalizado] = useState({largura: formato.largura, altura: formato.altura});
  const [textoPers, setTextoPers] = useState({largura: String(formato.largura), altura: String(formato.altura)}); // o que está nos campos (video-D5)
  const mexeu = React.useRef(false); // a pessoa já mexeu nos destinos: as props que chegam depois não os trocam (video-D18)
  const [codec, setCodec] = useState<CodecVideo>('h264');
  const [qualidade, setQualidade] = useState<QualidadeVideo>('alta');
  const [escala, setEscala] = useState(1);
  const [trechoLigado, setTrechoLigado] = useState(false);
  const [de, setDe] = useState('0');
  const [ate, setAte] = useState(numeroBr(duracaoMs / 1000, 1));
  // as props do vídeo podem chegar depois de o diálogo abrir (video-D18): até lá o formato é o padrão e a duração é 0. Quando
  // chegam, o diálogo assume o formato e a duração do vídeo, se a pessoa ainda não mexeu em nada
  const prontas = Boolean(props);
  useEffect(() => {
    if (!prontas || mexeu.current) return;
    const d = destinoDoFormato(formato);
    setDestinos([d]);
    setEditando(d.id);
    setPersonalizado({largura: formato.largura, altura: formato.altura});
    setTextoPers({largura: String(formato.largura), altura: String(formato.altura)});
    setAte(numeroBr(duracaoMs / 1000, 1));
  }, [prontas]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nome, setNome] = useState(titulo);
  const [fase, setFase] = useState<FaseVideo>({tipo: 'opcoes'});
  // marca d'água: a escolha de cada destino (a guardada no projeto por baixo do que se mexeu aqui) e o destino em edição
  const fontesMarca = useMemo(() => fontesDaMarcaDagua(props), [props]);
  const [marcas, setMarcas] = useState<Record<string, ConfigMarcaDagua>>({});
  const [editando, setEditando] = useState(doDocumento.id);
  const [proporcaoLogo, setProporcaoLogo] = useState<number>();
  const [proporcaoTexto, setProporcaoTexto] = useState<number>(); // largura ÷ altura da assinatura na fonte do kit, medida aqui (não estimada)
  const [contrastes, setContrastes] = useState<Record<string, EstadoContraste>>({});
  useEffect(() => {
    const texto = fontesMarca.assinatura;
    if (!texto) return;
    let vivo = true;
    const familia = familiaDaFonte(fontesMarca.fonte || 'Inter');
    const medir = () => {
      const c = document.createElement('canvas').getContext('2d');
      if (!c || !vivo) return;
      c.font = `600 100px ${familia}`;
      const w = c.measureText(texto).width;
      if (w > 0) setProporcaoTexto((w / 100) * 0.8); // a marca escreve a 0,8 da altura da caixa
    };
    document.fonts.load(`600 100px ${familia}`, texto).then(medir, medir);
    return () => {
      vivo = false;
    };
  }, [fontesMarca.assinatura, fontesMarca.fonte]);

  useEffect(() => {
    window.estudio.prefsExportacao().then((p) => setMarcas((m) => ({...p.marca_dagua, ...m}))).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!fontesMarca.logo) return;
    const img = new Image();
    img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0 && setProporcaoLogo(img.naturalWidth / img.naturalHeight);
    img.src = urlDaMidia(props?.base_midia, fontesMarca.logo);
  }, [fontesMarca.logo, props?.base_midia]);

  useEffect(() => {
    if (fase.tipo !== 'exportando') return;
    return window.estudio.aoProgresso((p) => setFase((f) => (f.tipo === 'exportando' ? {tipo: 'exportando', a: juntar(f.a, p)} : f)));
  }, [fase.tipo]);

  const marcado = (id: string) => destinos.some((d) => d.id === id);
  const alternar = (d: Destino) => {
    mexeu.current = true;
    setDestinos((ds) => (ds.some((x) => x.id === d.id) ? ds.filter((x) => x.id !== d.id) : [...ds, d]));
  };
  const aplicarPersonalizado = (novo: {largura: number; altura: number}) => {
    setPersonalizado(novo);
    setDestinos((ds) => ds.map((d) => (d.id === 'personalizado' ? {id: 'personalizado', ...novo} : d)));
  };
  // o campo guarda o que a pessoa digita (só dígitos): "1" a caminho de 1920 não vira 16. O destino só muda quando o número
  // está na faixa (16 a 7680); fora dela o campo fica marcado e o Exportar espera; ao sair do campo, prende à faixa
  const mudarPersonalizado = (campo: 'largura' | 'altura', v: string) => {
    mexeu.current = true;
    const l = lerMedidaPersonalizada(v);
    setTextoPers((t) => ({...t, [campo]: l.texto}));
    if (l.valor !== null) aplicarPersonalizado({...personalizado, [campo]: l.valor});
  };
  const sairPersonalizado = (campo: 'largura' | 'altura') => {
    const n = fecharMedidaPersonalizada(textoPers[campo], personalizado[campo]);
    setTextoPers((t) => ({...t, [campo]: String(n)}));
    if (n !== personalizado[campo]) aplicarPersonalizado({...personalizado, [campo]: n});
  };
  const persValido = (campo: 'largura' | 'altura') => lerMedidaPersonalizada(textoPers[campo]).valor !== null;
  const persOk = !marcado('personalizado') || (persValido('largura') && persValido('altura'));
  // o campo mostra um décimo de segundo (47,383 s aparece como 47,4): as pontas a menos de 50 ms encostam no começo e no fim (video-D11)
  const trecho = trechoLigado ? encostarTrecho({de_ms: Math.round(lerSegundos(de) * 1000), ate_ms: Math.round(lerSegundos(ate) * 1000)}, duracaoMs) : null;
  const trechoOk = !trechoLigado || trechoValido(trecho, duracaoMs);
  const configMarca = (d: Destino) => normalizarConfigMarca(marcas[d.id], configPadraoMarca(d, fontesMarca));
  const mudarMarca = (d: Destino, m: Partial<ConfigMarcaDagua>) => {
    setMarcas((ms) => ({...ms, [d.id]: {...configMarca(d), ...m}}));
    setContrastes((c) => (d.id in c ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== d.id)) : c)); // a medida era de outra marca
  };
  // o contraste com o fundo, medido em três quadros de verdade (processo principal); `placa` aplica a placa e mede de novo
  const medirContraste = async (d: Destino, placa?: CorDaPlaca | null) => {
    const config = placa ? {...configMarca(d), placa} : configMarca(d);
    if (placa) setMarcas((ms) => ({...ms, [d.id]: config}));
    setContrastes((c) => ({...c, [d.id]: 'medindo'}));
    try {
      const r = await window.estudio.medirContrasteMarca(documento, {destino: d, config, ...(proporcaoLogo ? {proporcao_logo: proporcaoLogo} : {}),
        ...(proporcaoTexto ? {proporcao_texto: proporcaoTexto} : {}), ...(trecho ? {trecho} : {})});
      setContrastes((c) => ({...c, [d.id]: r.ok ? {avaliacao: r.avaliacao} : {erro: r.mensagem}}));
    } catch (e) {
      setContrastes((c) => ({...c, [d.id]: {erro: e instanceof Error ? e.message : String(e)}}));
    }
  };
  const emEdicao = destinos.find((d) => d.id === editando) ?? destinos[0];
  // o carrossel da Cliente só sai no tamanho dele; o vídeo de cenas, no do destino
  const medidaDe = (d: Destino) => (fixo ? {largura: formato.largura, altura: formato.altura} : d);
  // a legenda de cada destino na área livre dele: a marca se afasta dela, e a miniatura a desenha ali
  const legendas = useMemo(() => legendasDasProps(props), [props]);
  const legendasDe = (d: Destino) => (fixo ? legendas : legendasNoDestino(legendas, medidaDe(d)));
  const marcaDe = (d: Destino) => marcaDaguaDoDestino(configMarca(d), medidaDe(d), fontesMarca, proporcaoLogo, legendasDe(d), proporcaoTexto);
  const temMarca = Boolean(fontesMarca.logo || fontesMarca.assinatura);
  const opcoes: OpcoesExportarVideo = {destinos, codec, qualidade, escala, trecho, nome: nome.trim() || undefined,
    ...(temMarca ? {marca_dagua: Object.fromEntries(destinos.map((d) => [d.id, configMarca(d)])), ...(proporcaoLogo ? {proporcao_logo: proporcaoLogo} : {}), ...(proporcaoTexto ? {proporcao_texto: proporcaoTexto} : {})} : {})};
  const estimativa = estimarExportacao(opcoes, formato, duracaoMs, comAudio);
  const ext = CODECS.find((c) => c.id === codec)!.ext;
  const nomes = nomesDosArquivos(nome.trim() || titulo, destinos, formato);
  const tamanhoDe = (id: string) => {
    const e = estimativa.porDestino.find((x) => x.destino.id === id);
    return e ? `~${formatarBytes(e.bytes)}` : '';
  };
  const podeExportar = Boolean(props) && destinos.length > 0 && trechoOk && persOk;

  const exportar = async () => {
    if (!podeExportar) {
      return avisar(!destinos.length ? 'Marque pelo menos um destino.' : !persOk ? `O tamanho personalizado vai de ${16} a ${7680} px.` : 'O trecho precisa ficar dentro do vídeo e ter pelo menos 0,1 s.', 'info');
    }
    setFase({tipo: 'exportando', a: {mensagem: 'Começando…'}});
    // a escolha da marca d'água fica no projeto para a próxima vez (sem ela, a exportação segue igual)
    if (Object.keys(marcas).length) window.estudio.gravarPrefsExportacao({marca_dagua: marcas}).catch(() => undefined);
    const r = await window.estudio.exportarVideo(documento, opcoes);
    setFase({tipo: 'pronto', r});
    if (r.ok) avisar(`Exportado: ${(r.arquivos ?? []).map(nomeDoArquivo).join(', ')}`, 'ok');
    else avisar(r.cancelado ? 'Exportação cancelada.' : `Exportação: ${r.mensagem}`, r.cancelado ? 'info' : 'erro');
  };

  const sub = `${formato.largura}×${formato.altura} · ${formato.fps} qps · ${numeroBr(duracaoMs / 1000, 1)} s`;
  if (fase.tipo === 'exportando') {
    return <Moldura titulo="Exportando o vídeo" sub={sub}><BarraAndamento a={fase.a} cancelar={() => window.estudio.cancelarExportacao()} /></Moldura>;
  }
  if (fase.tipo === 'pronto') {
    const r = fase.r;
    return (
      <Moldura titulo={r.ok ? 'Vídeo exportado' : r.cancelado ? 'Exportação cancelada' : 'A exportação falhou'} sub={sub} fechar={fechar}>
        <Pronto arquivos={r.arquivos ?? (r.arquivo ? [r.arquivo] : [])} pasta={r.pasta} erro={r.ok ? undefined : r.mensagem} cancelado={r.cancelado} voltar={() => setFase({tipo: 'opcoes'})} fechar={fechar} />
      </Moldura>
    );
  }
  return (
    <Moldura titulo="Exportar vídeo" sub={sub} fechar={fechar} aoEnter={() => void exportar()}>
      {montado && 'erro' in montado && <div className="erro-exp">{montado.erro}</div>}
      <Linha rotulo="Destinos">
        <div className="destinos">
          {FORMATOS_VIDEO.map((f) => {
            const d: Destino = {id: f.id, largura: f.largura, altura: f.altura};
            const desligado = fixo && (f.largura !== formato.largura || f.altura !== formato.altura);
            return (
              <label key={f.id} className={`${marcado(f.id) ? 'marcado' : ''}${desligado ? ' desligado' : ''}`}
                title={desligado ? 'O carrossel narrado da Cliente é fixo em 1080×1920: só sai em 9:16' : `${f.destino}${f.id === doDocumento.id ? ' · o formato deste vídeo' : ''}`}>
                <input type="checkbox" checked={marcado(f.id)} disabled={desligado} onChange={() => alternar(d)} />
                <span>{f.nome} <span className="medida">{f.proporcao}</span>
                  {temMarca && marcado(f.id) && configMarca(d).ligada && <span className="md-ico" title="Com marca d'água"><Stamp size={11} /></span>}</span>
                <span className="medida">{f.largura}×{f.altura}</span>
                <span className="tam">{marcado(f.id) ? tamanhoDe(f.id) : ''}</span>
              </label>
            );
          })}
          <label className={`${marcado('personalizado') ? 'marcado' : ''}${fixo ? ' desligado' : ''}`} title={fixo ? 'O carrossel narrado da Cliente é fixo em 1080×1920' : 'Outro tamanho, em pixels'}>
            <input type="checkbox" checked={marcado('personalizado')} disabled={fixo} onChange={() => alternar({id: 'personalizado', ...personalizado})} />
            <span>Personalizado{doDocumento.id === 'personalizado' ? <span className="medida"> · o formato deste vídeo</span> : null}</span>
            <span className="pers" onClick={(e) => e.preventDefault()}>
              <input className={`campo${persValido('largura') ? '' : ' invalido'}`} type="text" inputMode="numeric" value={textoPers.largura} disabled={fixo} aria-label="Largura"
                title="de 16 a 7680 px" onChange={(e) => mudarPersonalizado('largura', e.target.value)} onBlur={() => sairPersonalizado('largura')} />×
              <input className={`campo${persValido('altura') ? '' : ' invalido'}`} type="text" inputMode="numeric" value={textoPers.altura} disabled={fixo} aria-label="Altura"
                title="de 16 a 7680 px" onChange={(e) => mudarPersonalizado('altura', e.target.value)} onBlur={() => sairPersonalizado('altura')} />
            </span>
            <span className="tam">{marcado('personalizado') ? tamanhoDe('personalizado') : ''}</span>
          </label>
        </div>
      </Linha>
      <Linha rotulo="Marca d'água">
        {!temMarca ? <span className="nota">O tema deste vídeo não tem logo nem assinatura: aplique um kit de marca (menu → Marca…) para pôr a marca d'água.</span>
          : !emEdicao ? <span className="nota">Marque um destino.</span>
          : (
            <OpcoesMarca destinos={destinos} atual={emEdicao} editar={setEditando} config={configMarca} mudar={mudarMarca} fontes={fontesMarca} marca={marcaDe(emEdicao)}
              contraste={contrastes[emEdicao.id]} aoMedir={(placa) => void medirContraste(emEdicao, placa)}
              miniatura={props && <Miniatura props={props} {...medidaDe(emEdicao)} fixo={fixo} fps={formato.fps} duracaoMs={duracaoMs} marca={marcaDe(emEdicao)}
                legendas={legendasDe(emEdicao)} />} />
          )}
      </Linha>
      {props && destinos.length > 0 && (
        <Linha rotulo="Prévia">
          <PreviaDosDestinos destinos={destinos} props={props} medidaDe={medidaDe} fixo={fixo} fps={formato.fps} duracaoMs={duracaoMs} marcaDe={marcaDe} legendasDe={legendasDe} />
        </Linha>
      )}
      <Linha rotulo="Formato">
        <select className="campo" value={codec} onChange={(e) => setCodec(e.target.value as CodecVideo)}>
          {CODECS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <span className="nota">{CODECS.find((c) => c.id === codec)!.nota}</span>
      </Linha>
      <Linha rotulo="Qualidade">
        <Segmentos valor={qualidade} aoMudar={setQualidade} opcoes={QUALIDADES.map((q) => ({valor: q.id, nome: q.nome, dica: q.nota}))} />
        <span className="nota">{QUALIDADES.find((q) => q.id === qualidade)!.nota}</span>
      </Linha>
      <Linha rotulo="Escala">
        <Segmentos valor={escala} aoMudar={setEscala} opcoes={ESCALAS_VIDEO.map((e) => ({valor: e, nome: `${numeroBr(e, 2)}×`}))} />
        {escala !== 1 && <span className="nota">{estimativa.porDestino.map((d) => `${d.largura}×${d.altura}`).join(' · ')}</span>}
      </Linha>
      <Linha rotulo="Trecho">
        <label className="escolha-exp"><input type="radio" name="trecho" checked={!trechoLigado} onChange={() => setTrechoLigado(false)} />Tudo ({numeroBr(duracaoMs / 1000, 1)} s)</label>
        <label className="escolha-exp"><input type="radio" name="trecho" checked={trechoLigado} onChange={() => setTrechoLigado(true)} />Trecho</label>
        {trechoLigado && (
          <span className="trecho-campos">de <input className={`campo${trechoOk ? '' : ' invalido'}`} value={de} onChange={(e) => setDe(e.target.value)} aria-label="Início em segundos" /> a
            <input className={`campo${trechoOk ? '' : ' invalido'}`} value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Fim em segundos" /> s</span>
        )}
      </Linha>
      <Linha rotulo="Nome">
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={titulo} aria-label="Nome do arquivo" />
      </Linha>
      <div className="estimativa-exp">
        <span>
          {destinos.length === 0 ? 'Marque pelo menos um destino.' : destinos.length === 1 ? <>Sai <b>{nomes[0].nome}.{ext}</b> em saidas/</> : <><b>{destinos.length} arquivos</b> em saidas/: {nomes.map((n) => `${n.nome}.${ext}`).join(', ')}</>}
        </span>
        {destinos.length > 0 && <span title="Estimativa pelo bitrate × duração; o tamanho real varia com o conteúdo">~<b>{formatarBytes(estimativa.total)}</b></span>}
      </div>
      <div className="dialogo-botoes">
        <button className="bt fantasma" onClick={fechar}>Cancelar</button>
        <button className="bt principal" disabled={!podeExportar} onClick={() => void exportar()} autoFocus>Exportar</button>
      </div>
    </Moldura>
  );
};

// ---------- imagem ----------
type FaseImagem = {tipo: 'opcoes'} | {tipo: 'exportando'} | {tipo: 'pronto'; r: SaidaPng};

const ExportarImagem: React.FC<{documento: string; fechar: () => void}> = ({documento, fechar}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const doc = useLoja((e) => e.docs[documento]?.doc) as DocImagem | undefined;
  const [formato, setFormato] = useState<FormatoImagem>('png');
  const [qualidade, setQualidade] = useState(90);
  const [escala, setEscala] = useState(1);
  const [nome, setNome] = useState(titulo);
  const [fase, setFase] = useState<FaseImagem>({tipo: 'opcoes'});
  const f = FORMATOS_IMAGEM_SAIDA.find((x) => x.id === formato)!;
  const W = Math.round((doc?.largura ?? 0) * escala);
  const H = Math.round((doc?.altura ?? 0) * escala);
  // carrossel: sai PNG por página e PDF pelo exportarPaginas.ts (os avisos vêm da loja); formato, qualidade e escala são
  // da imagem de uma página só
  const carrossel = temPaginas(doc);
  const nPaginas = doc && carrossel ? paginasDe(doc).length : 0;

  const exportar = async () => {
    if (!doc) return;
    if (carrossel) {
      fechar();
      await exportarCarrossel(documento);
      return;
    }
    setFase({tipo: 'exportando'});
    const r = await exportarPng(documento, {formato, qualidade: qualidade / 100, escala, nome: nome.trim() || undefined, revelar: false});
    setFase({tipo: 'pronto', r});
  };

  const sub = doc ? `${doc.largura}×${doc.altura}` : undefined;
  if (fase.tipo === 'exportando') return <Moldura titulo="Exportando a imagem" sub={sub}><BarraAndamento a={{mensagem: `Desenhando ${W}×${H}…`}} /></Moldura>;
  if (fase.tipo === 'pronto') {
    const r = fase.r;
    return (
      <Moldura titulo={r.ok ? 'Imagem exportada' : 'A exportação falhou'} sub={sub} fechar={fechar}>
        {r.ok && r.faltaram.length > 0 && <div className="erro-exp">Saiu sem estas imagens (não carregaram): {r.faltaram.join(', ')}</div>}
        <Pronto arquivos={r.arquivo ? [r.arquivo] : []} pasta={r.pasta} erro={r.ok ? undefined : r.mensagem ?? 'sem detalhes'} voltar={() => setFase({tipo: 'opcoes'})} fechar={fechar} />
      </Moldura>
    );
  }
  if (carrossel) {
    return (
      <Moldura titulo="Exportar carrossel" sub={sub} fechar={fechar} aoEnter={() => void exportar()}>
        <div className="estimativa-exp"><span>Carrossel de <b>{nPaginas}</b> {nPaginas === 1 ? 'página' : 'páginas'}: sai um PNG por página em saidas/{titulo}/ e o PDF <b>{titulo}.pdf</b>, sem margem, para o LinkedIn</span></div>
        <div className="dialogo-botoes">
          <button className="bt fantasma" onClick={fechar}>Cancelar</button>
          <button className="bt principal" disabled={!doc} onClick={() => void exportar()} autoFocus>Exportar</button>
        </div>
      </Moldura>
    );
  }
  return (
    <Moldura titulo="Exportar imagem" sub={sub} fechar={fechar} aoEnter={() => void exportar()}>
      <Linha rotulo="Formato">
        <Segmentos valor={formato} aoMudar={setFormato} opcoes={FORMATOS_IMAGEM_SAIDA.map((x) => ({valor: x.id, nome: x.nome, dica: x.nota}))} />
        <span className="nota">{f.nota}</span>
      </Linha>
      {f.comQualidade && (
        <Linha rotulo="Qualidade">
          <input type="range" min={30} max={100} step={1} value={qualidade} onChange={(e) => setQualidade(Number(e.target.value))} aria-label="Qualidade" style={{width: 160}} />
          <span className="nota">{qualidade}%{qualidade >= 90 ? ' · quase sem perda' : qualidade >= 75 ? ' · bom para redes' : ' · arquivo pequeno'}</span>
        </Linha>
      )}
      <Linha rotulo="Escala">
        <Segmentos valor={escala} aoMudar={setEscala} opcoes={ESCALAS_IMAGEM.map((e) => ({valor: e, nome: `${numeroBr(e, 2)}×`}))} />
        <span className="nota">{W}×{H} px</span>
      </Linha>
      <Linha rotulo="Nome">
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={titulo} aria-label="Nome do arquivo" />
      </Linha>
      <div className="estimativa-exp"><span>Sai <b>{nome.trim() || titulo}.{f.ext}</b> em saidas/, com a pilha de efeitos</span></div>
      <div className="dialogo-botoes">
        <button className="bt fantasma" onClick={fechar}>Cancelar</button>
        <button className="bt principal" disabled={!doc} onClick={() => void exportar()} autoFocus>Exportar</button>
      </div>
    </Moldura>
  );
};

/** Montada uma vez na casca: desenha o diálogo do documento aberto por abrirDialogoExportar. */
export const RaizDialogoExportar: React.FC = () => {
  const documento = useSyncExternalStore(assinar, () => aberto);
  const modulo = useLoja((e) => (documento ? e.info?.manifesto.documentos.find((d) => d.id === documento)?.modulo : undefined));
  if (!documento || !modulo) return null;
  const fechar = () => mudar(null);
  if (modulo === 'video') return <ExportarVideo key={documento} documento={documento} fechar={fechar} />;
  if (modulo === 'imagem') return <ExportarImagem key={documento} documento={documento} fechar={fechar} />;
  return null;
};
