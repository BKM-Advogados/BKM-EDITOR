// Painel Mídia (frente Casca, rodada 3): o que há em midia/ com miniatura, duração e tipo; busca por palavras; pastas; os
// derivados (transcrição, voz limpa, recorte sem fundo, loudness) dentro do arquivo de origem; e a marcação de tomadas
// (boa, descartada, nota). Dali o arquivo vai para o vídeo ou a imagem pelo menu "Usar em…". A lista, a busca e as marcas são
// as mesmas da ferramenta `listar_midia` do MCP (src/nucleo/midia*.ts): o que a pessoa vê aqui o Claude também vê.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Check, File as ArquivoIcone, Film, FolderOpen, Image as ImagemIcone, Music, Plus, Search, Upload, X} from 'lucide-react';
import {
  duracaoCurta, filtrarMidia, ROTULO_DERIVADO, tamanhoCurto, type EntradaMidia, type EstadoDaTomada, type FiltroDeMidia, type TipoMidia,
} from '../../nucleo/midia';
import {avisar, mensagemDe, useLoja} from '../estado/loja';
import {BotaoMenu} from '../componentes/Menu';
import {carregarMidia, marcarTomada, recarregarMidiaEmBreve, urlDoArquivo, useMidia} from './midia-estado';
import {destinosDaMidia} from './midia-uso';
import './midia.css';

const ICONE_TIPO: Record<TipoMidia, React.ReactNode> = {
  video: <Film size={12} />, audio: <Music size={12} />, imagem: <ImagemIcone size={12} />, outro: <ArquivoIcone size={12} />,
};
const NOME_TIPO: Record<TipoMidia | 'todos', string> = {todos: 'Tudo', video: 'Vídeo', audio: 'Áudio', imagem: 'Imagem', outro: 'Outros'};
const MARCAS: {id: NonNullable<FiltroDeMidia['marca']> | 'todas'; nome: string}[] = [
  {id: 'todas', nome: 'Todas'}, {id: 'boa', nome: 'Boas'}, {id: 'descartada', nome: 'Descartadas'}, {id: 'sem_marca', nome: 'Sem marca'},
];

/** Só monta a imagem ou o vídeo quando o cartão chega perto da tela: 500 arquivos não abrem 500 conexões de uma vez. */
const Miniatura: React.FC<{e: EntradaMidia}> = ({e}) => {
  const caixa = useRef<HTMLDivElement>(null);
  const [perto, setPerto] = useState(false);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setPerto(true);
    const io = new IntersectionObserver((itens) => {
      if (itens.some((i) => i.isIntersecting)) {
        setPerto(true);
        io.disconnect();
      }
    }, {rootMargin: '240px'});
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const url = urlDoArquivo(e.caminho);
  return (
    <div className={`midia-mini ${e.tipo}`} ref={caixa}>
      {perto && e.tipo === 'imagem' && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
      {perto && e.tipo === 'video' && <video src={`${url}#t=0.5`} preload="metadata" muted playsInline tabIndex={-1} />}
      {(e.tipo === 'audio' || e.tipo === 'outro') && <span className="midia-icone-grande">{e.tipo === 'audio' ? <Music size={26} /> : <ArquivoIcone size={26} />}</span>}
      <span className="midia-tipo">{ICONE_TIPO[e.tipo]}</span>
      {e.duracao_ms !== undefined && <span className="midia-duracao">{duracaoCurta(e.duracao_ms)}</span>}
    </div>
  );
};

const rotuloDerivado = (d: EntradaMidia['derivados'][number]) =>
  d.tipo === 'voz_limpa' ? `voz limpa${d.detalhe && d.detalhe !== 'media' ? ` ${d.detalhe}` : ''}` : d.tipo === 'envelope' && d.detalhe ? `${ROTULO_DERIVADO.envelope} (${d.detalhe})` : ROTULO_DERIVADO[d.tipo];

const caminhoAbsoluto = (raiz: string, rel: string) => (raiz.includes('\\') ? `${raiz}\\${rel.replace(/\//g, '\\')}` : `${raiz}/${rel}`);

const Detalhe: React.FC<{e: EntradaMidia; raiz: string; aoFechar: () => void}> = ({e, raiz, aoFechar}) => {
  const docs = useLoja((s) => s.docs);
  const manifesto = useLoja((s) => s.info?.manifesto);
  useLoja((s) => s.ativo); // o menu "Usar em…" depende de qual vídeo e imagem estão abertos
  const [nota, setNota] = useState(e.marca?.nota ?? '');
  useEffect(() => setNota(e.marca?.nota ?? ''), [e.caminho, e.marca?.nota]);
  const url = urlDoArquivo(e.caminho);
  const usadaEm = useMemo(() => {
    const aspas = `"${e.caminho}"`;
    return (manifesto?.documentos ?? []).filter((d) => docs[d.id] && JSON.stringify(docs[d.id].doc).includes(aspas)).map((d) => d.titulo);
  }, [docs, manifesto, e.caminho]);
  const estado = e.marca?.estado;
  const marcar = (novo: EstadoDaTomada | null) => void marcarTomada(e.caminho, {estado: novo});
  const salvarNota = () => {
    if (nota.trim() !== (e.marca?.nota ?? '')) void marcarTomada(e.caminho, {nota});
  };
  const {itens, porque} = destinosDaMidia(e);
  return (
    <div className="midia-detalhe">
      <div className="midia-detalhe-topo">
        <b title={e.caminho}>{e.nome}</b>
        <span className="esp" />
        <button className="bt mini" title="Mostrar na pasta" onClick={() => window.estudio.mostrarArquivo(caminhoAbsoluto(raiz, e.caminho))}><FolderOpen size={13} /></button>
        <button className="bt mini" title="Fechar os detalhes" onClick={aoFechar}><X size={13} /></button>
      </div>
      <div className="midia-previa">
        {e.tipo === 'imagem' && <img src={url} alt={e.nome} />}
        {e.tipo === 'video' && <video src={url} controls preload="metadata" playsInline />}
        {e.tipo === 'audio' && <audio src={url} controls preload="metadata" />}
      </div>
      <div className="rotulo midia-meta">
        {[NOME_TIPO[e.tipo], e.duracao_ms !== undefined ? duracaoCurta(e.duracao_ms) : '', e.largura ? `${e.largura}×${e.altura}` : '', tamanhoCurto(e.tamanho),
          new Date(e.modificado_ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})].filter(Boolean).join(' · ')}
      </div>
      <div className="midia-marcar" role="group" aria-label="Marcar a tomada">
        <button className={`bt mini${estado === 'boa' ? ' ligado' : ''}`} aria-pressed={estado === 'boa'} onClick={() => marcar(estado === 'boa' ? null : 'boa')} title="Tomada boa (B)"><Check size={13} />Boa</button>
        <button className={`bt mini${estado === 'descartada' ? ' ligado' : ''}`} aria-pressed={estado === 'descartada'} onClick={() => marcar(estado === 'descartada' ? null : 'descartada')} title="Tomada descartada (X)"><X size={13} />Descartar</button>
        <span className="esp" />
        {itens.length ? (
          <BotaoMenu titulo="Leva o arquivo para o vídeo ou a imagem aberta" icone={<Plus size={13} />} rotulo="Usar em…" itens={itens} className="bt mini" acima />
        ) : (
          <button className="bt mini" disabled title={porque}><Plus size={13} />Usar em…</button>
        )}
      </div>
      <textarea className="campo midia-nota" rows={2} placeholder="Nota sobre a tomada (o Claude também lê)" value={nota} maxLength={500}
        onChange={(ev) => setNota(ev.target.value)} onBlur={salvarNota}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) ev.currentTarget.blur();
          ev.stopPropagation(); // B, X e as setas não valem dentro da nota
        }} />
      {e.derivados.length > 0 && (
        <ul className="midia-derivados" aria-label="Arquivos gerados a partir deste">
          {e.derivados.map((d) => <li key={d.caminho} title={d.caminho}><span>{rotuloDerivado(d)}</span><span className="rotulo">{tamanhoCurto(d.tamanho)}</span></li>)}
        </ul>
      )}
      <div className="rotulo midia-uso">{usadaEm.length ? `Usada em: ${usadaEm.join(', ')}` : 'Não é usada em nenhum documento'}</div>
    </div>
  );
};

export const Midia: React.FC = () => {
  const raiz = useLoja((s) => s.info?.raiz) ?? '';
  const indice = useMidia((s) => s.indice);
  const erro = useMidia((s) => s.erro);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<TipoMidia | 'todos'>('todos');
  const [marca, setMarca] = useState<(typeof MARCAS)[number]['id']>('todas');
  const [pasta, setPasta] = useState('');
  const [ordem, setOrdem] = useState<NonNullable<FiltroDeMidia['ordem']>>('nome');
  const [escolhido, setEscolhido] = useState<string | null>(null);

  // lê ao abrir o painel e quando algo de midia/ muda no disco
  useEffect(() => {
    void carregarMidia();
    return window.estudio.aoMudar(({arquivo}) => {
      if (arquivo.startsWith('midia/')) recarregarMidiaEmBreve();
    });
  }, [raiz]);
  useEffect(() => {
    setEscolhido(null);
    setPasta('');
  }, [raiz]);

  const todas = indice?.entradas ?? [];
  const lista = useMemo(
    () => filtrarMidia(todas, {busca, tipo: tipo === 'todos' ? undefined : tipo, marca: marca === 'todas' ? undefined : marca, pasta: pasta || undefined, ordem}),
    [todas, busca, tipo, marca, pasta, ordem],
  );
  const contagem = useMemo(() => {
    const c: Record<string, number> = {todos: todas.length};
    for (const e of todas) c[e.tipo] = (c[e.tipo] ?? 0) + 1;
    return c;
  }, [todas]);
  const atual = escolhido ? todas.find((e) => e.caminho === escolhido) ?? null : null;
  const filtrando = Boolean(busca || tipo !== 'todos' || marca !== 'todas' || pasta);

  const trazer = async (t: 'imagem' | 'audio' | 'video') => {
    try {
      const caminho = await window.estudio.escolherMidia(t);
      if (!caminho) return;
      await carregarMidia();
      setEscolhido(caminho);
      setBusca('');
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };

  const andar = (passo: number) => {
    if (!lista.length) return;
    const i = lista.findIndex((e) => e.caminho === escolhido);
    setEscolhido(lista[Math.max(0, Math.min(lista.length - 1, i < 0 ? 0 : i + passo))].caminho);
  };
  const teclas = (ev: React.KeyboardEvent) => {
    if (/INPUT|TEXTAREA|SELECT/.test((ev.target as HTMLElement).tagName) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const mover: Record<string, number> = {arrowright: 1, arrowdown: 1, arrowleft: -1, arrowup: -1};
    if (k in mover) (ev.preventDefault(), andar(mover[k]));
    else if (k === 'b' && atual) void marcarTomada(atual.caminho, {estado: atual.marca?.estado === 'boa' ? null : 'boa'});
    else if (k === 'x' && atual) void marcarTomada(atual.caminho, {estado: atual.marca?.estado === 'descartada' ? null : 'descartada'});
    else if (k === 'escape') setEscolhido(null);
  };

  return (
    <div className="painel painel-midia" tabIndex={-1} onKeyDown={teclas}>
      <div className="painel-topo midia-busca">
        <Search size={13} aria-hidden="true" />
        <input className="campo" type="search" placeholder="Buscar na mídia…" title="Palavras no nome, na nota ou nos derivados: transcrito, sem fundo, voz limpa" aria-label="Buscar na mídia" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
        <BotaoMenu titulo="Trazer um arquivo para a pasta midia/ do projeto" icone={<Upload size={13} />} rotulo="Trazer…" className="bt mini" itens={[
          {rotulo: 'Imagem…', icone: <ImagemIcone size={13} />, acao: () => void trazer('imagem')},
          {rotulo: 'Áudio…', icone: <Music size={13} />, acao: () => void trazer('audio')},
          {rotulo: 'Vídeo…', icone: <Film size={13} />, acao: () => void trazer('video')},
        ]} />
      </div>
      <div className="midia-filtros">
        <div className="midia-chips" role="group" aria-label="Tipo">
          {(['todos', 'video', 'audio', 'imagem'] as const).map((t) => (
            <button key={t} className={`midia-chip${tipo === t ? ' ligado' : ''}`} aria-pressed={tipo === t} onClick={() => setTipo(t)}>{NOME_TIPO[t]}{contagem[t] ? ` ${contagem[t]}` : ''}</button>
          ))}
        </div>
        <div className="midia-chips" role="group" aria-label="Marca da tomada">
          {MARCAS.map((m) => <button key={m.id} className={`midia-chip${marca === m.id ? ' ligado' : ''}`} aria-pressed={marca === m.id} onClick={() => setMarca(m.id)}>{m.nome}</button>)}
          <select className="campo midia-ordem" aria-label="Ordem" value={ordem} onChange={(ev) => setOrdem(ev.target.value as typeof ordem)}>
            <option value="nome">Por nome</option>
            <option value="recentes">Mais recentes</option>
            <option value="tamanho">Maiores</option>
          </select>
        </div>
        {(indice?.pastas.length ?? 0) > 1 && (
          <div className="midia-chips" role="group" aria-label="Pastas">
            <button className={`midia-chip${pasta === '' ? ' ligado' : ''}`} aria-pressed={pasta === ''} onClick={() => setPasta('')}>Todas as pastas</button>
            {indice!.pastas.map((p) => (
              <button key={p.pasta} className={`midia-chip${pasta === p.pasta ? ' ligado' : ''}`} aria-pressed={pasta === p.pasta} title={p.pasta} onClick={() => setPasta(p.pasta)}>
                {p.pasta.replace(/^midia\/?/, '') || 'midia'} {p.quantidade}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="painel-corpo midia-corpo">
        {erro && <div className="vazio" role="alert">Não deu para ler a pasta midia/: {erro}</div>}
        {!erro && !indice && <div className="vazio">Lendo a pasta midia/…</div>}
        {indice && todas.length === 0 && <div className="vazio">Nada em midia/ ainda. Use “Trazer…” ou peça ao Claude para pôr uma tomada na pasta.</div>}
        {indice && todas.length > 0 && lista.length === 0 && (
          <div className="vazio">Nada com esses filtros.{' '}
            {filtrando && <button className="bt mini" onClick={() => (setBusca(''), setTipo('todos'), setMarca('todas'), setPasta(''))}>Limpar filtros</button>}
          </div>
        )}
        <div className="midia-grade" role="listbox" aria-label="Arquivos de midia/">
          {lista.map((e) => (
            <button key={e.caminho} role="option" aria-selected={e.caminho === escolhido} className={`midia-cartao${e.caminho === escolhido ? ' sel' : ''}${e.marca?.estado ? ` ${e.marca.estado}` : ''}`}
              onClick={() => setEscolhido(e.caminho === escolhido ? null : e.caminho)} title={`${e.caminho}${e.marca?.nota ? `\n${e.marca.nota}` : ''}`}>
              <Miniatura e={e} />
              {e.marca?.estado && <span className={`midia-marca ${e.marca.estado}`} aria-label={e.marca.estado === 'boa' ? 'tomada boa' : 'tomada descartada'}>{e.marca.estado === 'boa' ? <Check size={11} /> : <X size={11} />}</span>}
              <span className="midia-nome">{e.nome}</span>
              <span className="midia-sub">
                {e.derivados.length > 0 ? [...new Set(e.derivados.map((d) => ROTULO_DERIVADO[d.tipo]))].join(' · ') : tamanhoCurto(e.tamanho)}
              </span>
            </button>
          ))}
        </div>
      </div>
      {atual && <Detalhe e={atual} raiz={raiz} aoFechar={() => setEscolhido(null)} />}
    </div>
  );
};
