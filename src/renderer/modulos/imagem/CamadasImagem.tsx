// Lista de camadas da imagem, de cima para baixo (o inverso do array, que guarda de baixo para cima). Cada ação é um
// patch: ver ou ocultar, subir ou descer (move) e excluir (com test do id). Criar texto, forma e imagem fica no trilho
// do monitor (T, U, inserir imagem).
import React from 'react';
import {ArrowDown, ArrowUp, Circle, Eye, EyeOff, Image as IconeImagem, Square, Trash2, Type} from 'lucide-react';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, documentosDe, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {docValido, indiceDe, rotuloCamada, usarDocumentoImagem, visivel} from './comum';

export const iconeCamada = (c: CamadaImagem) => {
  if (c.tipo === 'texto') return <Type />;
  if (c.tipo === 'imagem') return <IconeImagem />;
  return c.forma === 'elipse' ? <Circle /> : <Square />;
};

export const CamadasImagem: React.FC = () => {
  const documento = usarDocumentoImagem();
  const doc = useLoja((e) => (documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined));
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const docs = documentosDe('imagem');
  if (!documento || !doc) return <div className="vazio">nenhuma imagem no projeto</div>;
  if (!docValido(doc)) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas"</div>;

  const iSel = selecao?.documento === documento ? indiceDe(selecao.caminho) : -1;
  const comComentario = new Set(comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento).flatMap((c) => [c.alvo.objeto_id, c.alvo.objeto]));

  const mover = async (i: number, j: number) => {
    const c = doc.camadas[i];
    const patch: OperacaoPatch[] = [{op: 'test', path: `/camadas/${i}/id`, value: c.id}, {op: 'move', from: `/camadas/${i}`, path: `/camadas/${j}`}];
    if (!(await aplicar(documento, patch, `${j > i ? 'subir' : 'descer'} camada ${c.id}`))) return;
    if (iSel === i) selecionar({documento, caminho: `/camadas/${j}`});
    else if (iSel === j) selecionar({documento, caminho: `/camadas/${i}`});
  };

  const excluir = async (i: number) => {
    const c = doc.camadas[i];
    const patch: OperacaoPatch[] = [{op: 'test', path: `/camadas/${i}/id`, value: c.id}, {op: 'remove', path: `/camadas/${i}`}];
    if (!(await aplicar(documento, patch, `excluir camada ${c.id}`))) return;
    if (iSel === i) selecionar(null);
    else if (iSel > i) selecionar({documento, caminho: `/camadas/${iSel - 1}`});
  };

  const ordem = doc.camadas.map((c, i) => ({c, i})).reverse();

  return (
    <div className="painel">
      {docs.length > 1 && (
        <div className="painel-topo">
          <select className="campo" value={documento} onChange={(e) => loja.definir((s) => ({ativo: {...s.ativo, imagem: e.target.value}, selecao: null}))}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
        </div>
      )}
      <div className="painel-corpo sem-margem">
        {doc.camadas.length === 0 && <div className="vazio">Nenhuma camada. Use o trilho do monitor: T texto, U forma ou inserir imagem.</div>}
        <ul className="lista">
          {ordem.map(({c, i}) => {
            const ativa = i === iSel;
            const ir = () => selecionar({documento, caminho: `/camadas/${i}`});
            return (
              <li key={c.id || i} className={`${ativa ? 'sel' : ''}${visivel(c) ? '' : ' oculto'}`} onClick={ir} title={c.id} tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && ir()}>
                <span className="tipo">{iconeCamada(c)}</span>
                <span className="nome">{rotuloCamada(c)}</span>
                {(comComentario.has(c.id) || comComentario.has(`/camadas/${i}`)) && <span className="ponto-c" title="comentário aberto" />}
                {ativa && (
                  <>
                    <button className="bti" disabled={i === doc.camadas.length - 1} title="Subir" onClick={(e) => (e.stopPropagation(), void mover(i, i + 1))}><ArrowUp className="i14" /></button>
                    <button className="bti" disabled={i === 0} title="Descer" onClick={(e) => (e.stopPropagation(), void mover(i, i - 1))}><ArrowDown className="i14" /></button>
                    <button className="bti" title="Excluir camada" onClick={(e) => (e.stopPropagation(), void excluir(i))}><Trash2 className="i14" /></button>
                  </>
                )}
                <button className={`bti olho${visivel(c) ? '' : ' sempre'}`} title={visivel(c) ? 'Ocultar' : 'Mostrar'}
                  onClick={(e) => (e.stopPropagation(), void trocar(documento, `/camadas/${i}/visivel`, visivel(c) ? false : undefined, `${visivel(c) ? 'ocultar' : 'mostrar'} ${c.id}`))}>
                  {visivel(c) ? <Eye className="i14" /> : <EyeOff className="i14" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
