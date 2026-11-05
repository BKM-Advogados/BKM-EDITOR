// Lista de camadas da imagem, de cima para baixo (o inverso do array, que guarda de baixo para cima). Cada ação é um
// patch: ver ou ocultar, subir ou descer (move), adicionar texto, forma ou imagem do projeto e excluir (com test do id).
import React, {useState} from 'react';
import {ArrowDown, ArrowUp, Check, Circle, Eye, EyeOff, Image as IconeImagem, ImagePlus, Square, Trash2, Type, X} from 'lucide-react';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, avisar, documentosDe, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {ENTRELINHA, caminhoNoProjeto, docValido, idNovo, indiceDe, medirImagem, rotuloCamada, usarDocumentoImagem, visivel} from './comum';

const icone = (c: CamadaImagem) => {
  if (c.tipo === 'texto') return <Type size={13} />;
  if (c.tipo === 'imagem') return <IconeImagem size={13} />;
  return c.forma === 'elipse' ? <Circle size={13} /> : <Square size={13} />;
};

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocImagem | undefined;

const adicionar = async (documento: string, base: string, camada: Omit<CamadaImagem, 'id'>) => {
  const doc = docDe(documento);
  if (!doc) return;
  const nova: CamadaImagem = {id: idNovo(base, doc.camadas), ...camada};
  if (!(await aplicar(documento, [{op: 'add', path: '/camadas/-', value: nova}], `nova camada ${nova.id}`))) return;
  const i = docDe(documento)?.camadas.findIndex((c) => c.id === nova.id) ?? -1;
  if (i >= 0) selecionar({documento, caminho: `/camadas/${i}`});
};

const novoTexto = (documento: string, doc: DocImagem) => {
  const tamanho = Math.max(12, Math.round(doc.largura * 0.06));
  void adicionar(documento, 'texto', {
    nome: 'Texto', tipo: 'texto', texto: 'Novo texto', fonte: 'Archivo', peso: 700, tamanho, cor: '#F4F0EA', alinhar: 'esquerda',
    x: Math.round(doc.largura * 0.1), y: Math.round(doc.altura * 0.45), largura: Math.round(doc.largura * 0.8), altura: Math.round(tamanho * ENTRELINHA * 2),
  });
};

const novaForma = (documento: string, doc: DocImagem) => {
  const lado = Math.max(8, Math.round(Math.min(doc.largura, doc.altura) * 0.3));
  void adicionar(documento, 'forma', {
    nome: 'Forma', tipo: 'forma', forma: 'retangulo', preenchimento: '#C88155', raio: 0,
    x: Math.round((doc.largura - lado) / 2), y: Math.round((doc.altura - lado) / 2), largura: lado, altura: lado,
  });
};

const novaImagem = async (documento: string, doc: DocImagem, bruto: string) => {
  const src = caminhoNoProjeto(bruto);
  if (!src) {
    avisar('Use um caminho dentro da pasta do projeto, ex.: midia/logo-exemplo.png', 'erro');
    return false;
  }
  try {
    const {iw, ih} = await medirImagem(src);
    const largura = Math.round(doc.largura * 0.5);
    const altura = Math.max(1, Math.round((largura * ih) / iw));
    const nome = src.split('/').pop()!.replace(/\.[^.]+$/, '');
    await adicionar(documento, nome, {
      nome, tipo: 'imagem', src, ajuste: 'conter',
      x: Math.round((doc.largura - largura) / 2), y: Math.round((doc.altura - altura) / 2), largura, altura,
    });
    return true;
  } catch (e) {
    avisar((e as Error).message, 'erro');
    return false;
  }
};

export const CamadasImagem: React.FC = () => {
  const documento = usarDocumentoImagem();
  const doc = useLoja((e) => (documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined));
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const docs = documentosDe('imagem');
  const [pedindoImagem, setPedindoImagem] = useState(false);
  const [caminho, setCaminho] = useState('');
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

  const confirmarImagem = async () => {
    if (await novaImagem(documento, doc, caminho)) {
      setPedindoImagem(false);
      setCaminho('');
    }
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
      <div className="painel-topo" style={{flexWrap: 'wrap', gap: 4}}>
        <button className="bt mini" onClick={() => novoTexto(documento, doc)} title="Nova camada de texto"><Type size={13} />Texto</button>
        <button className="bt mini" onClick={() => novaForma(documento, doc)} title="Nova forma"><Square size={13} />Forma</button>
        <button className={`bt mini${pedindoImagem ? ' ligado' : ''}`} onClick={() => setPedindoImagem((v) => !v)} title="Nova imagem do projeto"><ImagePlus size={13} />Imagem</button>
      </div>
      {pedindoImagem && (
        <div className="painel-topo">
          <input className="campo" autoFocus value={caminho} placeholder="midia/logo-exemplo.png" title="Caminho do arquivo dentro da pasta do projeto"
            onChange={(e) => setCaminho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirmarImagem();
              if (e.key === 'Escape') setPedindoImagem(false);
            }} />
          <button className="bt principal mini" disabled={!caminho.trim()} onClick={() => void confirmarImagem()} title="Adicionar"><Check size={13} /></button>
          <button className="bt fantasma mini" onClick={() => setPedindoImagem(false)} title="Cancelar"><X size={13} /></button>
        </div>
      )}
      <div className="painel-corpo">
        {doc.camadas.length === 0 && <div className="vazio">Nenhuma camada. Adicione texto, forma ou imagem acima.</div>}
        <ul className="lista">
          {ordem.map(({c, i}) => {
            const ativa = i === iSel;
            return (
              <li key={c.id || i} className={ativa ? 'sel' : ''} onClick={() => selecionar({documento, caminho: `/camadas/${i}`})} title={`${c.id} · /camadas/${i}`}
                style={visivel(c) ? undefined : {opacity: 0.55}}>
                <span style={{display: 'flex', color: 'var(--texto-3)'}}>{icone(c)}</span>
                <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{rotuloCamada(c)}</span>
                {(comComentario.has(c.id) || comComentario.has(`/camadas/${i}`)) && <span style={{color: 'var(--comentario)'}} title="comentário aberto">●</span>}
                {ativa && (
                  <>
                    <button className="bt fantasma mini" disabled={i === doc.camadas.length - 1} title="Subir" onClick={(e) => (e.stopPropagation(), void mover(i, i + 1))}><ArrowUp size={12} /></button>
                    <button className="bt fantasma mini" disabled={i === 0} title="Descer" onClick={(e) => (e.stopPropagation(), void mover(i, i - 1))}><ArrowDown size={12} /></button>
                    <button className="bt fantasma mini" title="Excluir camada" onClick={(e) => (e.stopPropagation(), void excluir(i))}><Trash2 size={12} /></button>
                  </>
                )}
                <button className="bt fantasma mini" title={visivel(c) ? 'Ocultar' : 'Mostrar'}
                  onClick={(e) => (e.stopPropagation(), void trocar(documento, `/camadas/${i}/visivel`, visivel(c) ? false : undefined, `${visivel(c) ? 'ocultar' : 'mostrar'} ${c.id}`))}>
                  {visivel(c) ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
