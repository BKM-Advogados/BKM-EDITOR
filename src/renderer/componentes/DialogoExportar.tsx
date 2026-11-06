// Diálogo de exportar (Ctrl+Shift+E), o único lugar por onde algo "sai" do projeto (tela.md): antes, os destinos (uma ou
// mais proporções), formato, qualidade, escala, trecho, nome e a estimativa de tamanho (bitrate × duração); durante, o
// andamento de verdade e Cancelar; no fim, os arquivos e "Mostrar na pasta". O vídeo passa pelo processo principal
// (renderMedia); a imagem é desenhada aqui mesmo (exportarPng) e só o arquivo vai ao principal. Fica fora do React de
// quem chama, como o Dialogo.tsx: `abrirDialogoExportar(documento)` abre e <RaizDialogoExportar/>, montada na casca, desenha.
import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {CircleCheck, FolderOpen, X} from 'lucide-react';
import type {Progresso, ResultadoExportacao} from '../../compartilhado/api';
import type {DocImagem} from '../../nucleo/documentos';
import {
  CODECS, destinoDoFormato, ESCALAS_IMAGEM, ESCALAS_VIDEO, estimarExportacao, formatarBytes, FORMATOS_IMAGEM_SAIDA, nomesDosArquivos, QUALIDADES, trechoValido,
  type CodecVideo, type Destino, type FormatoImagem, type OpcoesExportarVideo, type QualidadeVideo,
} from '../../nucleo/exportacao';
import {FORMATO_PADRAO, FORMATOS_VIDEO, type Formato} from '../../nucleo/formatos';
import {avisar, useLoja} from '../estado/loja';
import {exportarPng, type SaidaPng} from '../modulos/imagem/exportarPng';
import {numeroBr} from './Campos';
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
  const [codec, setCodec] = useState<CodecVideo>('h264');
  const [qualidade, setQualidade] = useState<QualidadeVideo>('alta');
  const [escala, setEscala] = useState(1);
  const [trechoLigado, setTrechoLigado] = useState(false);
  const [de, setDe] = useState('0');
  const [ate, setAte] = useState(numeroBr(duracaoMs / 1000, 1));
  const [nome, setNome] = useState(titulo);
  const [fase, setFase] = useState<FaseVideo>({tipo: 'opcoes'});

  useEffect(() => {
    if (fase.tipo !== 'exportando') return;
    return window.estudio.aoProgresso((p) => setFase((f) => (f.tipo === 'exportando' ? {tipo: 'exportando', a: juntar(f.a, p)} : f)));
  }, [fase.tipo]);

  const marcado = (id: string) => destinos.some((d) => d.id === id);
  const alternar = (d: Destino) => setDestinos((ds) => (ds.some((x) => x.id === d.id) ? ds.filter((x) => x.id !== d.id) : [...ds, d]));
  const mudarPersonalizado = (campo: 'largura' | 'altura', v: string) => {
    const n = Math.max(16, Math.min(7680, Math.round(Number(v) || 0)));
    const novo = {...personalizado, [campo]: n};
    setPersonalizado(novo);
    setDestinos((ds) => ds.map((d) => (d.id === 'personalizado' ? {id: 'personalizado', ...novo} : d)));
  };
  const trecho = trechoLigado ? {de_ms: Math.round(lerSegundos(de) * 1000), ate_ms: Math.round(lerSegundos(ate) * 1000)} : null;
  const trechoOk = !trechoLigado || trechoValido(trecho, duracaoMs);
  const opcoes: OpcoesExportarVideo = {destinos, codec, qualidade, escala, trecho, nome: nome.trim() || undefined};
  const estimativa = estimarExportacao(opcoes, formato, duracaoMs, comAudio);
  const ext = CODECS.find((c) => c.id === codec)!.ext;
  const nomes = nomesDosArquivos(nome.trim() || titulo, destinos, formato);
  const tamanhoDe = (id: string) => {
    const e = estimativa.porDestino.find((x) => x.destino.id === id);
    return e ? `~${formatarBytes(e.bytes)}` : '';
  };
  const podeExportar = Boolean(props) && destinos.length > 0 && trechoOk;

  const exportar = async () => {
    if (!podeExportar) return avisar(!destinos.length ? 'Marque pelo menos um destino.' : 'O trecho precisa ficar dentro do vídeo e ter pelo menos 0,1 s.', 'info');
    setFase({tipo: 'exportando', a: {mensagem: 'Começando…'}});
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
                <span>{f.nome} <span className="medida">{f.proporcao}</span></span>
                <span className="medida">{f.largura}×{f.altura}</span>
                <span className="tam">{marcado(f.id) ? tamanhoDe(f.id) : ''}</span>
              </label>
            );
          })}
          <label className={`${marcado('personalizado') ? 'marcado' : ''}${fixo ? ' desligado' : ''}`} title={fixo ? 'O carrossel narrado da Cliente é fixo em 1080×1920' : 'Outro tamanho, em pixels'}>
            <input type="checkbox" checked={marcado('personalizado')} disabled={fixo} onChange={() => alternar({id: 'personalizado', ...personalizado})} />
            <span>Personalizado{doDocumento.id === 'personalizado' ? <span className="medida"> · o formato deste vídeo</span> : null}</span>
            <span className="pers" onClick={(e) => e.preventDefault()}>
              <input className="campo" type="text" inputMode="numeric" value={personalizado.largura} disabled={fixo} aria-label="Largura" onChange={(e) => mudarPersonalizado('largura', e.target.value)} />×
              <input className="campo" type="text" inputMode="numeric" value={personalizado.altura} disabled={fixo} aria-label="Altura" onChange={(e) => mudarPersonalizado('altura', e.target.value)} />
            </span>
            <span className="tam">{marcado('personalizado') ? tamanhoDe('personalizado') : ''}</span>
          </label>
        </div>
      </Linha>
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

  const exportar = async () => {
    if (!doc) return;
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
