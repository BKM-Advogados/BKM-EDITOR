// Barra de páginas do carrossel, entre o monitor e o transporte (como as páginas do Canva e as pranchetas do Figma):
// miniaturas na ordem, a ativa marcada; clicar vai para a página, PageUp/PageDown também (com o foco na área Imagem),
// arrastar reordena, dois cliques no nome renomeiam (F2 na miniatura em foco), Delete exclui. À direita: nova página,
// duplicar, excluir, o menu (renomear, mover, novo carrossel) e "Exportar carrossel" (PNG por página e PDF), que ao
// fim oferece "Mostrar na pasta". Uma prancheta só também passa por aqui: a segunda página é o que faz o carrossel.
import React, {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Copy, Download, FolderOpen, LayoutGrid, MoreHorizontal, Pencil, Plus, Trash2} from 'lucide-react';
import type {ResultadoExportarPaginas} from '../../../compartilhado/api';
import type {DocImagem} from '../../../nucleo/documentos';
import {paginaDoAlvo} from '../../../nucleo/carrossel';
import {FORMATOS_IMAGEM} from '../../../nucleo/formatos';
import {useLoja} from '../../estado/loja';
import {BotaoMenu, type ItemMenu} from '../../componentes/Menu';
import {teclaLivre} from '../../componentes/Trilho';
import {duplicarPagina, excluirPagina, moverPagina, novaPagina, novoCarrossel, renomearPagina} from './acoes';
import {irParaPagina, usarPaginaAtiva} from './comum';
import {exportarCarrossel} from './exportarPaginas';
import {Miniatura} from './Prancheta';
import './paginas.css';

const ALTURA_MINI = 56;
const FORMATOS_CARROSSEL = FORMATOS_IMAGEM.filter((f) => f.id === 'feed' || f.id === 'quadrado');

type Alvo = {i: number; lado: 'antes' | 'depois'};

export const PaginasImagem: React.FC<{documento: string; doc: DocImagem}> = ({documento, doc}) => {
  const ativa = usarPaginaAtiva(documento, doc);
  // páginas com comentário aberto (lista de índices: a loja compara listas por item e não reavisa à toa)
  const comComentario = useLoja((e) => e.comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento).map((c) => paginaDoAlvo(doc, c.alvo)));
  const [renomeando, setRenomeando] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [arrastando, setArrastando] = useState<number | null>(null); // para a classe da miniatura
  const origem = useRef<number | null>(null); // a mesma página, lida na hora de soltar
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [exportando, setExportando] = useState(false);
  const [ultimo, setUltimo] = useState<ResultadoExportarPaginas | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const p = ativa?.p ?? 0;
  const paginas = ativa?.paginas ?? [];
  const n = paginas.length;

  const ir = (i: number) => irParaPagina(documento, doc, i);

  // PageUp/PageDown trocam de página quando o foco está na área Imagem (não num campo, nem no terminal)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.key !== 'PageUp' && e.key !== 'PageDown') || !teclaLivre(e) || e.shiftKey || document.querySelector('.dialogo-fundo')) return;
      e.preventDefault();
      ir(e.key === 'PageUp' ? Math.max(0, p - 1) : Math.min(n - 1, p + 1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [documento, doc, p, n]); // eslint-disable-line react-hooks/exhaustive-deps

  // a ativa sempre à vista
  useEffect(() => {
    rolagem.current?.querySelector<HTMLElement>('.pagina.ativa')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [p, n]);

  if (!ativa) return null;

  const comecarRenomear = (i: number) => {
    setNome(paginas[i].nome);
    setRenomeando(i);
  };
  const gravarNome = () => {
    const i = renomeando;
    setRenomeando(null);
    if (i !== null && nome.trim() && nome.trim() !== paginas[i].nome) void renomearPagina(documento, i, nome);
  };

  // de que lado da miniatura o cursor está: a página cai antes ou depois dela
  const ladoDe = (e: React.DragEvent): Alvo['lado'] => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'antes' : 'depois';
  };
  const soltar = (i: number, lado: Alvo['lado']) => {
    const de = origem.current;
    origem.current = null;
    setArrastando(null);
    setAlvo(null);
    if (de === null) return;
    const posicao = lado === 'antes' ? i : i + 1; // na lista de agora
    const para = de < posicao ? posicao - 1 : posicao; // depois de tirar a arrastada
    if (para !== de) void moverPagina(documento, de, para);
  };

  const exportar = () => {
    setExportando(true);
    setUltimo(null);
    void exportarCarrossel(documento).then((r) => setUltimo(r && r.ok ? r : null)).finally(() => setExportando(false));
  };
  const mostrar = ultimo?.pdf ?? ultimo?.pasta;

  const menu: ItemMenu[] = [
    {rotulo: 'Renomear página', icone: <Pencil className="i14" />, tecla: 'F2', acao: () => comecarRenomear(p)},
    {rotulo: 'Mover para a esquerda', icone: <ArrowLeft className="i14" />, acao: () => void (p > 0 && moverPagina(documento, p, p - 1))},
    {rotulo: 'Mover para a direita', icone: <ArrowRight className="i14" />, acao: () => void (p < n - 1 && moverPagina(documento, p, p + 1))},
    'sep',
    ...FORMATOS_CARROSSEL.map((f): ItemMenu => ({rotulo: `Novo carrossel ${f.proporcao} (${f.largura}×${f.altura})…`, icone: <LayoutGrid className="i14" />,
      acao: () => void novoCarrossel({largura: f.largura, altura: f.altura})})),
  ];

  return (
    <div className="paginas" role="tablist" aria-label="Páginas">
      <div className="rolagem" ref={rolagem}>
        {paginas.map((pg, i) => {
          const classe = ['pagina', i === p ? 'ativa' : '', arrastando === i ? 'arrastando' : '', alvo?.i === i && arrastando !== null && arrastando !== i ? `solta-${alvo.lado}` : ''].filter(Boolean).join(' ');
          return (
            <div key={pg.id} className={classe} role="tab" aria-selected={i === p} tabIndex={0} title={`${pg.nome}\n${pg.camadas?.length ?? 0} camadas · PageUp/PageDown trocam de página`}
              draggable={renomeando === null} onClick={() => ir(i)}
              onDoubleClick={(e) => (e.stopPropagation(), comecarRenomear(i))}
              onKeyDown={(e) => {
                if (renomeando !== null) return;
                if (e.key === 'Enter') ir(i);
                else if (e.key === 'F2') (e.preventDefault(), comecarRenomear(i));
                else if (e.key === 'Delete') (e.preventDefault(), void excluirPagina(documento, i));
                else if (e.key === 'ArrowLeft') (e.preventDefault(), ir(Math.max(0, i - 1)));
                else if (e.key === 'ArrowRight') (e.preventDefault(), ir(Math.min(n - 1, i + 1)));
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                origem.current = i;
                setArrastando(i);
              }}
              onDragEnd={() => (origem.current = null, setArrastando(null), setAlvo(null))}
              onDragOver={(e) => {
                if (origem.current === null) return;
                e.preventDefault();
                const lado = ladoDe(e);
                if (alvo?.i !== i || alvo.lado !== lado) setAlvo({i, lado});
              }}
              onDrop={(e) => (e.preventDefault(), soltar(i, ladoDe(e)))}>
              <Miniatura pagina={pg} largura={doc.largura} altura={doc.altura} fundo={doc.fundo} fundoDegrade={doc.fundo_degrade} alturaCaixa={ALTURA_MINI} />
              <span className="legenda">
                <b>{i + 1}</b>
                {renomeando === i ? (
                  <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onBlur={gravarNome} onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenomeando(null);
                    }} />
                ) : <span className="nome-pg">{pg.nome}</span>}
                {comComentario.includes(i) && <span className="ponto-c" title="comentário aberto nesta página" />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="acoes-pg">
        <div className="linha">
          <button className="bt fantasma mini" onClick={() => void novaPagina(documento)} title="Nova página depois desta"><Plus size={13} /><span className="largo">Página</span></button>
          <button className="bti" onClick={() => void duplicarPagina(documento)} title="Duplicar esta página"><Copy size={14} /></button>
          <button className="bti" onClick={() => void excluirPagina(documento)} disabled={n < 2} title={n < 2 ? 'A última página não sai' : 'Excluir esta página (Delete na miniatura)'}><Trash2 size={14} /></button>
          <BotaoMenu titulo="Mais ações da página" icone={<MoreHorizontal size={14} />} itens={menu} acima />
        </div>
        <div className="linha">
          <button className="bt fantasma mini" disabled={exportando} onClick={exportar} title={`Exportar ${n} ${n === 1 ? 'página' : 'páginas'}: PNG por página em saidas/<nome>/ e PDF para o LinkedIn`}>
            <Download size={13} /><span className="largo">{exportando ? 'Exportando…' : 'Exportar carrossel'}</span>
          </button>
          {mostrar && <button className="bti" title={`Mostrar na pasta\n${mostrar}`} onClick={() => window.estudio.mostrarNaPasta(ultimo?.pasta ?? mostrar)}><FolderOpen size={14} /></button>}
        </div>
      </div>
    </div>
  );
};
