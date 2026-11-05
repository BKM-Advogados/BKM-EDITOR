// Lista do vídeo: cenas e blocos do roteiro, na ordem. Clicar seleciona e leva a prévia ao tempo do objeto.
import React from 'react';
import {documentosDe, loja, selecionar, useLoja} from '../../estado/loja';
import {irPara} from './tocador';

type Cena = {tipo: string; tag?: string; titulo?: string; linhas?: {t: string}[]; blocos?: {tipo: string; texto?: string; id?: string}[]};

const resumo = (b: {tipo: string; texto?: string}) => (b.texto ? b.texto.replace(/\*\*/g, '').slice(0, 40) : '');

export const CenasVideo: React.FC = () => {
  const documento = useLoja((e) => e.ativo.video);
  const doc = useLoja((e) => (documento ? e.docs[documento]?.doc : undefined)) as {cenas?: Cena[]} | undefined;
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const abertos = useLoja((e) => e.comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento));
  const docs = documentosDe('video');
  if (!documento || !doc) return <div className="vazio">nenhum vídeo</div>;

  const tempoDe = (caminho: string) => {
    const p = montado && 'props' in montado ? montado.props : null;
    for (const c of (p?.cenas ?? []) as {origem?: string; t_in: number; blocos?: {origem?: string; em: number}[]}[]) {
      if (c.origem === caminho) return c.t_in;
      const b = c.blocos?.find((x) => x.origem === caminho);
      if (b) return b.em;
    }
    return undefined;
  };
  const ir = (caminho: string) => {
    selecionar({documento, caminho});
    const t = tempoDe(caminho);
    if (t !== undefined) irPara(t + 300);
  };
  const temComentario = (caminho: string) => abertos.some((c) => c.alvo.objeto === caminho);

  return (
    <div className="painel">
      {docs.length > 1 && (
        <div className="painel-topo">
          <select className="campo" value={documento} onChange={(e) => loja.definir((s) => ({ativo: {...s.ativo, video: e.target.value}, selecao: null}))}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
        </div>
      )}
      <div className="painel-corpo">
        <ul className="lista">
          {doc.cenas?.map((c, i) => (
            <React.Fragment key={i}>
              <li className={selecao?.caminho === `/cenas/${i}` ? 'sel' : ''} onClick={() => ir(`/cenas/${i}`)}>
                <span className="etiqueta">{c.tipo}</span>
                <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{c.titulo ?? c.tag ?? c.linhas?.map((l) => l.t).join(' ') ?? ''}</span>
              </li>
              {c.blocos?.map((b, j) => {
                const caminho = `/cenas/${i}/blocos/${j}`;
                return (
                  <li key={j} className={`sub${selecao?.caminho === caminho ? ' sel' : ''}`} onClick={() => ir(caminho)} title={b.id}>
                    <span style={{color: 'var(--texto-3)', width: 64, flex: 'none'}}>{b.tipo}</span>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1}}>{resumo(b)}</span>
                    {temComentario(caminho) && <span style={{color: 'var(--comentario)'}} title="comentário aberto">●</span>}
                  </li>
                );
              })}
            </React.Fragment>
          ))}
        </ul>
      </div>
    </div>
  );
};
