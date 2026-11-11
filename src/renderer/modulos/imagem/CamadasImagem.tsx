// Lista de camadas da página ativa da imagem, de cima para baixo (o inverso do array, que guarda de baixo para cima).
// Cada ação é um patch: ver ou ocultar, subir ou descer (move) e excluir (com test do id). Criar texto, forma e imagem
// fica no trilho do monitor (T, U, inserir imagem). Num carrossel, o cabeçalho diz em que página se está; trocar de
// página é na barra de páginas do monitor (ou PageUp/PageDown). O menu ⋯ da camada recorta a imagem pela camada de
// cima e solta (acabamento.ts); a foto recortada aparece recuada, e subir ou descer leva a máscara junto. Shift ou
// Ctrl+clique põe ou tira a camada da seleção múltipla (as selecionadas ficam acesas). O cadeado trava e destrava; a
// camada de grupo mostra o ícone do grupo.
import React from 'react';
import {ArrowDown, ArrowUp, Circle, CornerLeftUp, Ellipsis, Eye, EyeOff, Group, Image as IconeImagem, Lock, LockOpen, Square, Trash2, Type} from 'lucide-react';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {blocoDe, mascaraDe, mascarasEmUso, patchMoverCamada, patchRecortar, patchSoltar, podeRecortar} from '../../../nucleo/acabamento';
import {caminhoDoAlvo} from '../../../nucleo/carrossel';
import {patchTravar, travada} from '../../../nucleo/layout-imagem';
import {alternarNaSelecao, aplicar, avisar, caminhosDaSelecao, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {BotaoMenu, type ItemMenu} from '../../componentes/Menu';
import {docValido, indiceDe, rotuloCamada, usarDocumentoImagem, usarPaginaAtiva, visivel} from './comum';
import {SeletorDocumento} from '../../componentes/SeletorDocumento';
import {mudouEm} from '../../estado/agente';

export const iconeCamada = (c: CamadaImagem) => {
  if (c.tipo === 'texto') return <Type />;
  if (c.tipo === 'imagem') return <IconeImagem />;
  return c.forma === 'elipse' ? <Circle /> : <Square />;
};

export const CamadasImagem: React.FC = () => {
  const documento = usarDocumentoImagem();
  const doc = useLoja((e) => (documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined));
  const ativa = usarPaginaAtiva(documento, doc);
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const mudancas = useLoja((e) => e.mudancasAgente);
  if (!documento || !doc) return <div className="vazio">Sem imagem ainda: crie no monitor.</div>;
  if (!docValido(doc) || !ativa) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas" nem "paginas"</div>;

  const {base, camadas, pagina, paginas, p} = ativa;
  const iSel = selecao?.documento === documento ? indiceDe(selecao.caminho, base) : -1;
  // seleção múltipla: todas acesas; os botões de subir, descer e excluir ficam na principal
  const selecionadas = new Set(caminhosDaSelecao(selecao, documento).map((c) => indiceDe(c, base)).filter((i) => i >= 0));
  // o ponto vale para a camada de agora do comentário, na página dele (o id da camada se repete entre páginas: imagem-N1)
  const comComentario = new Set(comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento).map((c) => caminhoDoAlvo(doc, c.alvo)));

  // sobe ou desce a camada (com a máscara junto, se for par recortado); a seleção segue a mesma camada pelo id
  const mover = async (i: number, direcao: 1 | -1) => {
    const c = camadas[i];
    const r = patchMoverCamada(camadas, base, i, direcao);
    if (!r || !(await aplicar(documento, r.patch, `${direcao > 0 ? 'subir' : 'descer'} camada ${c.id}`))) return;
    const idSel = iSel >= 0 ? camadas[iSel]?.id : undefined;
    const depois = loja.get().docs[documento]?.doc as DocImagem | undefined;
    const novas = depois && camadasDaPagina(depois);
    const k = idSel && novas ? novas.findIndex((x) => x.id === idSel) : -1;
    if (k >= 0) selecionar({documento, caminho: `${base}/${k}`});
  };
  const camadasDaPagina = (d: DocImagem) => (d.paginas ? d.paginas[p]?.camadas : d.camadas) ?? [];

  const recortar = async (i: number) => {
    const motivo = podeRecortar(camadas, i);
    if (motivo) return avisar(`Não dá para recortar: ${motivo}.`, 'info');
    await aplicar(documento, patchRecortar(camadas, base, i), `recortar ${camadas[i].id} pela camada ${camadas[i + 1].id}`);
  };
  const soltarRecorte = (i: number) => void aplicar(documento, patchSoltar(camadas, base, i), `soltar o recorte de ${camadas[i].id}`);

  const excluir = async (i: number) => {
    const c = camadas[i];
    // a máscara apagada solta a foto de baixo (sem deixar o id dela pendurado)
    const foto = mascarasEmUso(camadas).get(i);
    const patch: OperacaoPatch[] = [...(foto !== undefined ? patchSoltar(camadas, base, foto) : []),
      {op: 'test', path: `${base}/${i}/id`, value: c.id}, {op: 'remove', path: `${base}/${i}`}];
    if (!(await aplicar(documento, patch, `excluir camada ${c.id}`))) return;
    if (iSel === i) selecionar(null);
    else if (iSel > i) selecionar({documento, caminho: `${base}/${iSel - 1}`});
  };

  const ordem = camadas.map((c, i) => ({c, i})).reverse();
  const mascaras = mascarasEmUso(camadas);
  const menuDe = (c: CamadaImagem, i: number): ItemMenu[] => {
    const itens: ItemMenu[] = [];
    if (mascaraDe(camadas, i) >= 0 || mascaras.has(i)) itens.push({rotulo: 'Soltar o recorte', acao: () => soltarRecorte(i)});
    else if (c.tipo === 'imagem') itens.push({rotulo: 'Recortar pela camada de cima', acao: () => void recortar(i)});
    return itens;
  };

  return (
    <div className="painel">
      <SeletorDocumento modulo="imagem" />
      <div className="painel-corpo sem-margem">
        {paginas.length > 1 && (
          <div className="lista-titulo" role="button" tabIndex={0} title="Propriedades da página (clique)" style={{marginTop: 2, cursor: 'pointer'}}
            onClick={() => selecionar(null)} onKeyDown={(e) => e.key === 'Enter' && selecionar(null)}>
            Página {p + 1} de {paginas.length} · <span style={{color: 'var(--texto)', marginLeft: 4}}>{pagina.nome}</span>
          </div>
        )}
        {camadas.length === 0 && <div className="vazio">Nenhuma camada{paginas.length > 1 ? ' nesta página' : ''}. Use o trilho do monitor: T texto, U forma ou inserir imagem.</div>}
        <ul className="lista">
          {ordem.map(({c, i}) => {
            const ativaL = i === iSel;
            const caminho = `${base}/${i}`;
            const ir = () => selecionar({documento, caminho});
            const recortada = mascaraDe(camadas, i) >= 0;
            const [lo, hi] = blocoDe(camadas, i);
            const menu = ativaL ? menuDe(c, i) : [];
            return (
              <li key={c.id || i} className={`${selecionadas.has(i) ? 'sel' : ''}${visivel(c) ? '' : ' oculto'}${mudouEm(mudancas, documento, caminho) ? ' agente' : ''}`} tabIndex={0}
                onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? alternarNaSelecao(documento, caminho) : ir())}
                title={recortada ? `${c.id} · recortada por ${rotuloCamada(camadas[i + 1])}` : mascaras.has(i) ? `${c.id} · máscara de ${rotuloCamada(camadas[mascaras.get(i)!])}` : c.id}
                style={recortada ? {paddingLeft: 22} : undefined} onKeyDown={(e) => e.key === 'Enter' && ir()}>
                {recortada && <CornerLeftUp className="i12" style={{marginLeft: -14, color: 'var(--texto-3)'}} />}
                {c.grupo && <span className="tipo" title={`no ${c.grupo}: o clique no monitor escolhe o grupo inteiro`} style={{color: 'var(--texto-3)'}}><Group className="i12" /></span>}
                <span className="tipo">{iconeCamada(c)}</span>
                <span className="nome">{rotuloCamada(c)}</span>
                {comComentario.has(caminho) && <span className="ponto-c" title="comentário aberto" />}
                {mudouEm(mudancas, documento, caminho) && <span className="ponto-agente" title="O Claude mudou esta camada" />}
                {ativaL && (
                  <>
                    <button className="bti" disabled={hi === camadas.length - 1} title="Subir" onClick={(e) => (e.stopPropagation(), void mover(i, 1))}><ArrowUp className="i14" /></button>
                    <button className="bti" disabled={lo === 0} title="Descer" onClick={(e) => (e.stopPropagation(), void mover(i, -1))}><ArrowDown className="i14" /></button>
                    <button className="bti" title="Excluir camada" onClick={(e) => (e.stopPropagation(), void excluir(i))}><Trash2 className="i14" /></button>
                    {menu.length > 0 && <span onClick={(e) => e.stopPropagation()}><BotaoMenu titulo="Mais ações da camada" icone={<Ellipsis className="i14" />} itens={menu} /></span>}
                  </>
                )}
                <button className={`bti olho${visivel(c) ? '' : ' sempre'}`} title={visivel(c) ? 'Ocultar' : 'Mostrar'}
                  onClick={(e) => (e.stopPropagation(), void trocar(documento, `${caminho}/visivel`, visivel(c) ? false : undefined, `${visivel(c) ? 'ocultar' : 'mostrar'} ${c.id}`))}>
                  {visivel(c) ? <Eye className="i14" /> : <EyeOff className="i14" />}
                </button>
                <button className={`bti olho${travada(c) ? ' sempre' : ''}`} title={travada(c) ? 'Destravar' : 'Travar: não anda nem muda de tamanho, e a IA não mexe'}
                  onClick={(e) => (e.stopPropagation(), void aplicar(documento, patchTravar(camadas, base, [i], !travada(c)), `${travada(c) ? 'destravar' : 'travar'} ${c.id}`))}>
                  {travada(c) ? <Lock className="i14" /> : <LockOpen className="i14" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
