// Lista do 3D: objetos da cena (nome e tipo) com visível, seleção, primitiva nova e exclusão; depois as luzes. Cada ação
// é um JSON Patch com teste, para não pisar no que o agente mudou por baixo.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Circle, Cone, Cylinder, Eye, EyeOff, Lightbulb, Plus, Square, Sun, SunDim, Torus, Trash2} from 'lucide-react';
import type {DocCena3D, Luz3D} from '../../../nucleo/documentos';
import {aplicar, documentosDe, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {indiceEm, luzesDe, novoObjeto, objetosDe, TIPOS, type TipoObjeto} from './comum';
import {useCena3d} from './lida';
import {Escolha} from '../../componentes/Controles';
import {trocarDocumento} from '../../componentes/SeletorDocumento';

const ICONE: Record<TipoObjeto, React.ReactNode> = {
  caixa: <Box size={13} />, esfera: <Circle size={13} />, cilindro: <Cylinder size={13} />, cone: <Cone size={13} />, toro: <Torus size={13} />, plano: <Square size={13} />,
};
const ICONE_LUZ: Record<Luz3D['tipo'], React.ReactNode> = {ambiente: <SunDim size={13} />, direcional: <Sun size={13} />, ponto: <Lightbulb size={13} />};

const cortar: React.CSSProperties = {flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'};

export const ListaTres: React.FC = () => {
  const documento = useLoja((e) => e.ativo['3d']);
  const doc = useCena3d(documento)?.doc; // validada (tres-efeitos-D12)
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const [menu, setMenu] = useState(false);
  const caixaMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const fora = (e: PointerEvent) => !caixaMenu.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', fora);
    return () => window.removeEventListener('pointerdown', fora);
  }, [menu]);

  const docs = documentosDe('3d');
  if (!documento || !doc) return <div className="vazio">Sem cena 3D ainda: crie no monitor.</div>;
  const objetos = objetosDe(doc);
  const luzes = luzesDe(doc);
  const caminhoSel = selecao?.documento === documento ? selecao.caminho : undefined;
  const abertos = comentarios.filter((c) => c.estado === 'aberto' && c.documento === documento);

  const adicionar = async (tipo: TipoObjeto) => {
    setMenu(false);
    const atual = loja.get().docs[documento]?.doc as DocCena3D | undefined;
    const novo = novoObjeto(atual, tipo);
    const patch = Array.isArray(atual?.objetos)
      ? [{op: 'add' as const, path: '/objetos/-', value: novo}]
      : [{op: 'add' as const, path: '/objetos', value: [novo]}];
    if (await aplicar(documento, patch, `adicionar ${novo.nome}`)) {
      const i = objetosDe(loja.get().docs[documento]?.doc as DocCena3D | undefined).findIndex((o) => o.id === novo.id);
      if (i >= 0) selecionar({documento, caminho: `/objetos/${i}`});
    }
  };

  const excluir = async (i: number) => {
    const o = objetos[i];
    if (indiceEm(caminhoSel, 'objetos') >= 0) selecionar(null); // os índices depois deste mudam
    await aplicar(documento, [{op: 'test', path: `/objetos/${i}/id`, value: o.id}, {op: 'remove', path: `/objetos/${i}`}], `excluir ${o.nome}`);
  };

  const alternarVisivel = (i: number) => {
    const o = objetos[i];
    const oculto = o.visivel === false;
    void trocar(documento, `/objetos/${i}/visivel`, oculto ? undefined : false, `${oculto ? 'mostrar' : 'ocultar'} ${o.nome}`);
  };

  return (
    <div className="painel">
      <div className="painel-topo">
        {docs.length > 1 ? (
          <span style={{flex: 1, minWidth: 0, display: 'flex'}}>
            <Escolha valor={documento} rotulo="Cena aberta" aoMudar={(id) => trocarDocumento('3d', id)} opcoes={docs.map((d): [string, string] => [d.id, d.titulo])} />
          </span>
        ) : (
          <span className="titulo">{objetos.length} {objetos.length === 1 ? 'objeto' : 'objetos'}</span>
        )}
        <span className="esp" />
        <div ref={caixaMenu} style={{position: 'relative'}}>
          <button className={`bt mini${menu ? ' ligado' : ''}`} onClick={() => setMenu((m) => !m)} title="Adicionar primitiva"><Plus size={13} />Adicionar</button>
          {menu && (
            <div style={{position: 'absolute', right: 0, top: 26, zIndex: 10, minWidth: 140, padding: 4, background: 'var(--fundo-2)', border: '1px solid var(--borda-forte)',
              borderRadius: 'var(--raio-2)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'}}>
              {TIPOS.map((t) => (
                <button key={t.tipo} className="bt fantasma" style={{width: '100%', justifyContent: 'flex-start'}} onClick={() => void adicionar(t.tipo)}>
                  {ICONE[t.tipo]}{t.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="painel-corpo">
        {objetos.length === 0 && <div className="vazio">Cena vazia. Use Adicionar ou peça ao Claude.</div>}
        <ul className="lista">
          {objetos.map((o, i) => {
            const caminho = `/objetos/${i}`;
            const oculto = o.visivel === false;
            return (
              <li key={o.id ?? i} className={caminhoSel === caminho ? 'sel' : ''} onClick={() => selecionar({documento, caminho})} title={o.id}
                style={oculto ? {opacity: 0.55} : undefined}>
                <button className="bt fantasma mini" title={oculto ? 'Mostrar' : 'Ocultar'}
                  onClick={(e) => {
                    e.stopPropagation();
                    alternarVisivel(i);
                  }}>
                  {oculto ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <span style={cortar}>{o.nome || o.id}</span>
                {abertos.some((c) => c.alvo.objeto_id === o.id || c.alvo.objeto === caminho) && <span style={{color: 'var(--comentario)'}} title="comentário aberto">●</span>}
                <span className="etiqueta" style={{display: 'inline-flex', alignItems: 'center', gap: 4}}>{ICONE[o.tipo]}{o.tipo}</span>
                <button className="bt fantasma mini" title="Excluir (Ctrl+Z desfaz)"
                  onClick={(e) => {
                    e.stopPropagation();
                    void excluir(i);
                  }}>
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
        {luzes.length > 0 && (
          <>
            <div className="rotulo" style={{margin: '14px 6px 6px'}}>Luzes</div>
            <ul className="lista">
              {luzes.map((l, i) => {
                const caminho = `/luzes/${i}`;
                return (
                  <li key={l.id ?? i} className={caminhoSel === caminho ? 'sel' : ''} onClick={() => selecionar({documento, caminho})} title={l.id}>
                    <span style={{display: 'inline-flex', color: l.cor}}>{ICONE_LUZ[l.tipo] ?? <Lightbulb size={13} />}</span>
                    <span style={cortar}>{l.id}</span>
                    <span className="etiqueta">{l.tipo}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
