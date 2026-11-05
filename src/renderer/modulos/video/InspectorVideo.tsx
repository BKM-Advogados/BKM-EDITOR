// Inspector do vídeo: as propriedades do objeto selecionado no roteiro (bloco, cena, item), com nomes de quem edita
// ("Entra", "Largura") em vez das chaves do JSON, agrupadas em seções recolhíveis. A tabela abaixo diz o rótulo, a
// seção e a unidade de cada chave; o que não estiver nela cai em "Outros". Âncoras de tempo ("palavra@ms") mostram a
// palavra e o código de tempo, e são conferidas contra a narração antes de gravar. Sem seleção, o resumo do vídeo.
import React, {useEffect, useState} from 'react';
import {Clapperboard, Copy, Film, FileJson, Link} from 'lucide-react';
import {ehDocCenas} from '../../../nucleo/cenas';
import {lerAncora, norm, type Palavra} from '../../../nucleo/roteiro/resolver';
import {aplicar, trocar, useLoja, valorEm} from '../../estado/loja';
import {CabecalhoInspector, CampoLeitura, CampoNumero, CampoTexto, LinhaCampo, Secao, copiar, numeroBr} from '../../componentes/Campos';
import type {ItemMenu} from '../../componentes/Menu';
import {FPS, formatarTempo, irPara} from './tocador';
import {resumoBloco, tipoDe} from './tipos';
import {InspectorCenas} from './InspectorCenas';

type NomeSecao = 'Tempo' | 'Conteúdo' | 'Posição e tamanho' | 'Outros';
const SECOES: NomeSecao[] = ['Tempo', 'Conteúdo', 'Posição e tamanho', 'Outros'];

const CAMPOS: Record<string, {rotulo: string; secao: NomeSecao; unidade?: string; longo?: boolean}> = {
  em: {rotulo: 'Entra', secao: 'Tempo'},
  sai: {rotulo: 'Sai', secao: 'Tempo'},
  inicio: {rotulo: 'Início', secao: 'Tempo'},
  depois_de: {rotulo: 'Depois de', secao: 'Tempo'},
  pausa: {rotulo: 'Pausa', secao: 'Tempo', unidade: 'ms'},
  tag: {rotulo: 'Etiqueta', secao: 'Conteúdo'},
  titulo: {rotulo: 'Título', secao: 'Conteúdo', longo: true},
  texto: {rotulo: 'Texto', secao: 'Conteúdo', longo: true},
  rotulo: {rotulo: 'Rótulo', secao: 'Conteúdo'},
  nota: {rotulo: 'Nota', secao: 'Conteúdo', longo: true},
  linha: {rotulo: 'Linha', secao: 'Conteúdo'},
  de: {rotulo: 'Conta de', secao: 'Conteúdo'},
  ate: {rotulo: 'Conta até', secao: 'Conteúdo'},
  prefixo: {rotulo: 'Prefixo', secao: 'Conteúdo'},
  sufixo: {rotulo: 'Sufixo', secao: 'Conteúdo'},
  marcador: {rotulo: 'Marcador', secao: 'Conteúdo'},
  src: {rotulo: 'Arquivo', secao: 'Conteúdo'},
  t: {rotulo: 'Texto', secao: 'Conteúdo'},
  x: {rotulo: 'X', secao: 'Posição e tamanho', unidade: 'px'},
  y: {rotulo: 'Y', secao: 'Posição e tamanho', unidade: 'px'},
  largura: {rotulo: 'Largura', secao: 'Posição e tamanho', unidade: 'px'},
  altura: {rotulo: 'Altura', secao: 'Posição e tamanho', unidade: 'px'},
  tam: {rotulo: 'Tamanho', secao: 'Posição e tamanho', unidade: 'px'},
  rot: {rotulo: 'Giro', secao: 'Posição e tamanho', unidade: '°'},
};
const ANCORAS = new Set(['em', 'sai', 'inicio', 'depois_de']);
const OCULTOS = new Set(['id', 'tipo', 'origem', 'blocos', 'linhas', 'itens', 'barras', 'marcas', 'faixas', 'carimbo']);
const rotuloDe = (k: string) => CAMPOS[k]?.rotulo ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');

// padrões da composição (CarrosselTema): sem a chave no JSON, o bloco usa estes
const TAM_PADRAO: Record<string, number> = {cartao: 35, nota: 31, frase: 66, numero: 220, itens: 46, documento: 480, foto: 470, carimbo: 80, grande: 150};
const padraoDe = (tipo: unknown, k: string): number | undefined => {
  if (k === 'x') return 70;
  if (k === 'largura') return tipo === 'foto' || tipo === 'documento' ? undefined : 940;
  if (k === 'tam') return TAM_PADRAO[String(tipo)];
  return undefined;
};

const usarPalavras = (caminho?: string) => {
  const [p, setP] = useState<Palavra[]>([]);
  useEffect(() => {
    if (caminho) void window.estudio.lerJson<Palavra[]>(caminho).then(setP).catch(() => setP([]));
  }, [caminho]);
  return p;
};

const conferirAncora = (palavras: Palavra[]) => (v: string) => {
  if (!v.trim()) return null;
  try {
    const a = lerAncora(v);
    const alvo = norm(a.w);
    return palavras.some((p) => p.s >= a.ms && norm(p.w).startsWith(alvo)) ? null : `não há "${a.w}" depois de ${a.ms} ms na narração`;
  } catch (e) {
    return (e as Error).message;
  }
};

/** Âncora: mostra a palavra e o código de tempo; em foco, o texto cru ("palavra@ms") para editar. */
const CampoAncora: React.FC<{rotulo: string; valor: string; ms?: number; palavras: Palavra[]; aoMudar: (v: string) => void}> = ({rotulo, valor, ms, palavras, aoMudar}) => {
  const [v, setV] = useState(valor);
  const [foco, setFoco] = useState(false);
  useEffect(() => setV(valor), [valor]);
  const erro = conferirAncora(palavras)(v);
  const gravar = () => {
    if (v !== valor && !erro) aoMudar(v);
  };
  const amigavel = v.replace(/\$?@[\d+-]+$/, '').replace(/^"|"$/g, '');
  return (
    <LinhaCampo rotulo={rotulo} dica="âncora na narração: palavra@ms (palavra$@ms = fim da palavra; +120 desloca)">
      <div className="valor">
        <div className={`campo${erro ? ' invalido' : ''}`}>
          <input value={foco ? v : amigavel} onFocus={() => setFoco(true)} onBlur={() => (setFoco(false), gravar())} onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())} />
          {ms !== undefined && !foco && <span className="tm" style={{cursor: 'pointer'}} title="Ir para este tempo" onMouseDown={(e) => (e.preventDefault(), irPara(ms))}>{formatarTempo(ms)}</span>}
        </div>
        {erro && <div className="erro-campo">{erro}</div>}
      </div>
    </LinhaCampo>
  );
};

type Ctx = {documento: string; palavras: Palavra[]; tempos: Record<string, number | undefined>};

const Campo: React.FC<{ctx: Ctx; caminho: string; obj: Record<string, unknown>; k: string; v: string | number}> = ({ctx, caminho, obj, k, v}) => {
  const path = `${caminho}/${k}`;
  const def = CAMPOS[k];
  if (typeof v === 'number') {
    const padrao = padraoDe(obj.tipo, k);
    return <CampoNumero rotulo={rotuloDe(k)} valor={v} unidade={def?.unidade} padrao={padrao}
      aoRedefinir={padrao !== undefined ? () => void trocar(ctx.documento, path, undefined, `${rotuloDe(k)} volta ao padrão`) : undefined}
      aoMudar={(n) => void trocar(ctx.documento, path, n, `${rotuloDe(k)}: ${n}`)} />;
  }
  if (ANCORAS.has(k)) return <CampoAncora rotulo={rotuloDe(k)} valor={v} ms={ctx.tempos[k]} palavras={ctx.palavras} aoMudar={(t) => void trocar(ctx.documento, path, t, `${rotuloDe(k)} em "${t}"`)} />;
  return <CampoTexto rotulo={rotuloDe(k)} valor={v} multilinha={def?.longo || v.length > 40} aoMudar={(t) => void trocar(ctx.documento, path, t, `${rotuloDe(k)} de ${caminho}`)} />;
};

const editaveis = (obj: Record<string, unknown>) =>
  Object.entries(obj).filter((e): e is [string, string | number] => !OCULTOS.has(e[0]) && (typeof e[1] === 'string' || typeof e[1] === 'number'));

/** Campos agrupados nas seções da tabela. */
const Secoes: React.FC<{ctx: Ctx; caminho: string; obj: Record<string, unknown>; duracao?: number}> = ({ctx, caminho, obj, duracao}) => {
  const campos = editaveis(obj);
  return (
    <>
      {SECOES.map((s) => {
        const meus = campos.filter(([k]) => (CAMPOS[k]?.secao ?? 'Outros') === s);
        if (!meus.length && !(s === 'Tempo' && duracao !== undefined)) return null;
        const voltar = s === 'Posição e tamanho' ? meus.filter(([k, v]) => typeof v === 'number' && padraoDe(obj.tipo, k) !== undefined && padraoDe(obj.tipo, k) !== v) : [];
        return (
          <Secao key={s} titulo={s} chave={`video:${s}`} fechadaDePadrao={s === 'Outros'}
            aoRedefinir={voltar.length ? () => void aplicar(ctx.documento,
              voltar.flatMap(([k]) => [{op: 'test' as const, path: `${caminho}/${k}`, value: obj[k]}, {op: 'remove' as const, path: `${caminho}/${k}`}]),
              'posição e tamanho voltam ao padrão') : undefined}>
            {meus.map(([k, v]) => <Campo key={k} ctx={ctx} caminho={caminho} obj={obj} k={k} v={v} />)}
            {s === 'Tempo' && duracao !== undefined && <CampoLeitura rotulo="Duração">{numeroBr(duracao / 1000, 1)} s</CampoLeitura>}
          </Secao>
        );
      })}
    </>
  );
};

type CenaP = {origem?: string; t_in: number; t_out: number; blocos?: {origem?: string; em: number; sai?: number; itens?: {em?: number}[]}[]};

export const InspectorVideo: React.FC = () => {
  const documento = useLoja((e) => e.ativo.video);
  const lido = useLoja((e) => (documento ? e.docs[documento] : undefined));
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const selecao = useLoja((e) => e.selecao);
  const palavras = usarPalavras((lido?.doc as {palavras?: string} | undefined)?.palavras);
  if (!documento || !lido) return <div className="vazio">Sem vídeo ainda: crie no monitor.</div>;
  if (ehDocCenas(lido.doc)) return <InspectorCenas documento={documento} />;
  const caminho = selecao?.documento === documento ? selecao.caminho : null;
  const obj = caminho ? (valorEm(lido.doc, caminho) as Record<string, unknown> | undefined) : undefined;
  const props = montado && 'props' in montado ? montado.props : null;
  const cenasP = (props?.cenas as CenaP[] | undefined) ?? [];

  if (!caminho || !obj || typeof obj !== 'object') {
    const avisos = montado && 'avisos' in montado ? montado.avisos : [];
    const nBlocos = cenasP.reduce((n, c) => n + (c.blocos?.length ?? 0), 0);
    return (
      <div className="painel">
        <CabecalhoInspector icone={<Film />} nome={titulo ?? 'Vídeo'} sub="Carrossel narrado" dica={`9:16 · 1080×1920 · ${FPS} qps`} />
        <div className="insp-corpo">
          <div className="resumo">
            9:16 · 1080×1920 · {FPS} qps · {formatarTempo(props?.duracao_ms ?? 0)}<br />
            <b>{lido.doc.cenas?.length ?? 0}</b> cenas · <b>{nBlocos}</b> blocos
          </div>
          <Secao titulo="Vídeo" chave="video:doc">
            <CampoTexto rotulo="Contagem das partes" dica="texto antes do número da parte (ex.: PARTE)" valor={String(lido.doc.rotulo_partes ?? '')} aoMudar={(t) => void trocar(documento, '/rotulo_partes', t, 'rótulo das partes')} />
          </Secao>
          {montado && 'erro' in montado && <Secao titulo="Não deu para montar o vídeo"><div className="texto-livre" style={{color: 'var(--erro)'}}>{montado.erro}</div></Secao>}
          {avisos.length > 0 && <Secao titulo={`Avisos (${avisos.length})`}><div className="avisos-roteiro">{avisos.map((a, i) => <div key={i}>{a}</div>)}</div></Secao>}
          <div className="vazio">Clique num bloco no monitor ou na linha do tempo para editar.</div>
        </div>
      </div>
    );
  }

  // tempos resolvidos (ms de saída) do objeto selecionado, para mostrar ao lado das âncoras
  const tempos: Record<string, number | undefined> = {};
  let fim: number | undefined;
  for (const c of cenasP) {
    if (c.origem === caminho) {
      tempos.inicio = c.t_in;
      tempos.em = c.t_in;
    }
    const b = c.blocos?.find((x) => x.origem === caminho);
    if (b) {
      tempos.em = b.em;
      tempos.sai = b.sai;
      fim = b.sai ?? c.t_out;
    }
  }
  const m = /^\/cenas\/(\d+)(?:\/blocos\/(\d+))?/.exec(caminho);
  const cena = m ? (lido.doc.cenas?.[Number(m[1])] as Record<string, unknown> | undefined) : undefined;
  const ehCena = Boolean(m && !m[2] && caminho === `/cenas/${m[1]}`);
  const t = tipoDe(String(obj.tipo ?? ''));
  const Icone = ehCena ? Clapperboard : t.icone;
  const nome = ehCena
    ? (cena?.tipo === 'parte' ? `Parte · ${String(cena.tag ?? cena.titulo ?? '')}` : `Cena · ${String(obj.tipo ?? '')}`)
    : [t.nome, resumoBloco(obj as Parameters<typeof resumoBloco>[0], 28)].filter(Boolean).join(' · ');
  const sub = ehCena ? String(obj.titulo ?? obj.id ?? '') : [String(cena?.tag ?? cena?.titulo ?? cena?.tipo ?? ''), m?.[2] !== undefined ? `bloco ${Number(m[2]) + 1}` : ''].filter(Boolean).join(' · ');
  const menu: ItemMenu[] = [
    {rotulo: 'Copiar caminho', icone: <Link className="i14" />, acao: () => copiar(caminho, `Caminho ${caminho} copiado`)},
    ...(obj.id ? [{rotulo: 'Copiar id', icone: <Copy className="i14" />, acao: () => copiar(String(obj.id), 'Id copiado')}] : []),
    {rotulo: 'Copiar JSON', icone: <FileJson className="i14" />, acao: () => copiar(JSON.stringify(obj, null, 2), 'JSON copiado')},
  ];
  const ctx: Ctx = {documento, palavras, tempos};
  const itens = (obj.itens ?? obj.linhas) as Record<string, unknown>[] | undefined;
  const chaveLista = obj.itens ? 'itens' : 'linhas';
  const temposItens = cenasP.flatMap((c) => c.blocos ?? []).find((b) => b.origem === caminho)?.itens;

  return (
    <div className="painel">
      <CabecalhoInspector icone={<Icone />} familia={ehCena ? undefined : t.familia} nome={nome} sub={sub} dica={caminho} menu={menu} />
      <div className="insp-corpo">
        <Secoes ctx={ctx} caminho={caminho} obj={obj} duracao={!ehCena && fim !== undefined && tempos.em !== undefined ? fim - tempos.em : undefined} />
        {Array.isArray(itens) && (
          <Secao titulo={`${chaveLista === 'itens' ? 'Itens' : 'Linhas'} (${itens.length})`} chave={`video:${chaveLista}`}>
            {itens.map((it, i) => (
              <div key={i} style={{borderLeft: '2px solid var(--borda-forte)', margin: '4px 0 6px 10px'}}>
                <div className="rotulo" style={{padding: '2px 8px'}}>{chaveLista === 'itens' ? 'Item' : 'Linha'} {i + 1}</div>
                {editaveis(it).map(([k, v]) => (
                  <Campo key={k} ctx={{...ctx, tempos: {em: temposItens?.[i]?.em}}} caminho={`${caminho}/${chaveLista}/${i}`} obj={it} k={k} v={v} />
                ))}
              </div>
            ))}
          </Secao>
        )}
      </div>
    </div>
  );
};
