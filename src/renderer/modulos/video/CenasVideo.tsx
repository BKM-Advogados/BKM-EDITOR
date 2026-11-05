// Lista do vídeo: cenas e blocos do roteiro, na ordem, como o índice do Final Cut ou do Resolve. Cada cena mostra o
// número da parte, o título, o início e a duração, e pode recolher; cada bloco tem o filete da família e o ícone do
// tipo. A cena em que a cabeça está ganha uma marca vermelha (lê o tempo parado da loja, não o de cada quadro).
// Clicar seleciona e leva a prévia ao tempo do objeto.
import React, {useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import {documentosDe, loja, selecionar, useLoja} from '../../estado/loja';
import {numeroBr} from '../../componentes/Campos';
import {formatarCurto, irPara} from './tocador';
import {resumoBloco, tipoDe} from './tipos';

type Cena = {tipo: string; tag?: string; titulo?: string; linhas?: {t: string}[]; blocos?: {tipo: string; texto?: string; id?: string}[]};
type CenaP = {origem?: string; tipo: string; n?: number; t_in: number; t_out: number; blocos?: {origem?: string; em: number}[]};

const recolhidas = new Set<string>(); // vale enquanto o app está aberto

export const CenasVideo: React.FC = () => {
  const documento = useLoja((e) => e.ativo.video);
  const doc = useLoja((e) => (documento ? e.docs[documento]?.doc : undefined)) as {cenas?: Cena[]} | undefined;
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const tempo = useLoja((e) => e.tempo_ms);
  const abertos = useLoja((e) => e.comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento));
  const [, forcar] = useState(0);
  const docs = documentosDe('video');
  if (!documento || !doc) return <div className="vazio">nenhum vídeo</div>;

  const cenasP = ((montado && 'props' in montado ? montado.props.cenas : undefined) ?? []) as CenaP[];
  const daCena = (i: number) => cenasP.find((c) => c.origem === `/cenas/${i}`);
  const tempoDe = (caminho: string) => {
    for (const c of cenasP) {
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
  const alternar = (chave: string) => {
    if (recolhidas.has(chave)) recolhidas.delete(chave);
    else recolhidas.add(chave);
    forcar((n) => n + 1);
  };
  const tecla = (caminho: string) => (e: React.KeyboardEvent) => e.key === 'Enter' && ir(caminho);

  return (
    <div className="painel">
      {docs.length > 1 && (
        <div className="painel-topo">
          <select className="campo" value={documento} onChange={(e) => loja.definir((s) => ({ativo: {...s.ativo, video: e.target.value}, selecao: null}))}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
        </div>
      )}
      <div className="painel-corpo sem-margem">
        <ul className="lista">
          {doc.cenas?.map((c, i) => {
            const caminho = `/cenas/${i}`;
            const p = daCena(i);
            const chave = `${documento}:${i}`;
            const fechada = recolhidas.has(chave);
            const aqui = p ? tempo >= p.t_in && tempo < p.t_out : false;
            return (
              <React.Fragment key={i}>
                <li className={selecao?.caminho === caminho ? 'sel' : ''} onClick={() => ir(caminho)} tabIndex={0} onKeyDown={tecla(caminho)} style={{paddingLeft: 4}}>
                  {aqui && <span title="A cabeça está nesta cena" style={{position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: 'var(--cabeca)'}} />}
                  {c.blocos?.length ? (
                    <button className="bti" style={{width: 18, height: 18}} title={fechada ? 'Mostrar os blocos' : 'Recolher os blocos'}
                      onClick={(e) => (e.stopPropagation(), alternar(chave))}>
                      {fechada ? <ChevronRight className="i12" /> : <ChevronDown className="i12" />}
                    </button>
                  ) : <span style={{width: 18, flex: 'none'}} />}
                  {c.tipo === 'parte' && p?.n !== undefined ? <b style={{flex: 'none'}}>{p.n}</b> : <span className="meta" style={{flex: 'none'}}>{c.tipo}</span>}
                  <span className="nome">{c.titulo ?? c.tag ?? c.linhas?.map((l) => l.t).join(' ') ?? ''}</span>
                  {p && <span className="meta" title="início · duração">{formatarCurto(p.t_in)} · {numeroBr(Math.round((p.t_out - p.t_in) / 100) / 10, 1)} s</span>}
                </li>
                {!fechada && c.blocos?.map((b, j) => {
                  const cb = `${caminho}/blocos/${j}`;
                  const t = tipoDe(b.tipo);
                  const Icone = t.icone;
                  return (
                    <li key={j} className={`sub${selecao?.caminho === cb ? ' sel' : ''}`} onClick={() => ir(cb)} title={b.id} tabIndex={0} onKeyDown={tecla(cb)}>
                      <span style={{position: 'absolute', left: 14, top: 5, bottom: 5, width: 3, borderRadius: 2, background: `var(--trilha-${t.familia})`}} />
                      <span className="tipo" style={{color: `var(--trilha-${t.familia})`}}><Icone /></span>
                      <span className="nome">{resumoBloco(b) || t.nome}</span>
                      {temComentario(cb) && <span className="ponto-c" title="comentário aberto" />}
                      <span className="meta">{b.tipo}</span>
                    </li>
                  );
                })}
              </React.Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
