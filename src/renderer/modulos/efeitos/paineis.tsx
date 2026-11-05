// Área Efeitos: a pilha de efeitos visuais de um vídeo ou de uma imagem do projeto (a mesma definição vale nos dois,
// ver src/nucleo/efeitos.ts). O monitor mostra o alvo com os efeitos; no vídeo, o controle deslizante já aparece na
// prévia enquanto se arrasta, e o patch sai ao soltar.
import React from 'react';
import {ArrowDown, ArrowUp, Plus, Trash2} from 'lucide-react';
import type {PaineisDoModulo} from '../../casca/contrato';
import {aplicar, documentosDe, loja, selecionar, trocar, useLoja, valorEm} from '../../estado/loja';
import {definicao, EFEITOS, novoEfeito, type Efeito} from '../../../nucleo/efeitos';
import {CampoCor, CampoDeslizante, Secao} from '../../componentes/Campos';
import {MonitorVideo} from '../video/MonitorVideo';
import {LinhaDoTempo} from '../video/LinhaDoTempo';
import {PaineisImagem} from '../imagem/paineis';
import type {OperacaoPatch} from '../../../nucleo/documentos';

const usarAlvo = () => {
  const alvo = useLoja((e) => e.alvoEfeitos);
  const modulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === e.alvoEfeitos)?.modulo);
  const efeitos = useLoja((e) => ((e.alvoEfeitos ? e.docs[e.alvoEfeitos]?.doc?.efeitos : undefined) ?? []) as Efeito[]);
  return {alvo, modulo, efeitos};
};

const PRESETS: {nome: string; efeitos: Omit<Efeito, 'id'>[]}[] = [
  {nome: 'Cinema', efeitos: [{tipo: 'contraste', valor: 1.15}, {tipo: 'saturacao', valor: 0.9}, {tipo: 'vinheta', valor: 0.45}, {tipo: 'granulado', valor: 0.15}]},
  {nome: 'Quente', efeitos: [{tipo: 'tom', valor: 0.2, cor: '#C88155'}, {tipo: 'brilho', valor: 1.05}]},
  {nome: 'Preto e branco', efeitos: [{tipo: 'saturacao', valor: 0}, {tipo: 'contraste', valor: 1.2}]},
];

const adicionar = (alvo: string, efeitos: Efeito[], novos: Efeito[]) => {
  const doc = loja.get().docs[alvo]?.doc;
  const patch: OperacaoPatch[] = doc?.efeitos === undefined
    ? [{op: 'add', path: '/efeitos', value: novos}]
    : novos.map((e) => ({op: 'add' as const, path: '/efeitos/-', value: e}));
  void aplicar(alvo, patch, `efeito ${novos.map((e) => e.tipo).join(', ')}`).then(() => selecionar({documento: alvo, caminho: `/efeitos/${efeitos.length + novos.length - 1}`}));
};

const Pilha: React.FC = () => {
  const {alvo, efeitos} = usarAlvo();
  const selecao = useLoja((e) => e.selecao);
  const docs = [...documentosDe('video'), ...documentosDe('imagem')];
  const mover = (i: number, j: number) => alvo && void aplicar(alvo, [{op: 'test', path: `/efeitos/${i}/id`, value: efeitos[i].id}, {op: 'move', from: `/efeitos/${i}`, path: `/efeitos/${j}`}], `ordem do efeito ${efeitos[i].id}`);
  const remover = (i: number) => alvo && void aplicar(alvo, [{op: 'test', path: `/efeitos/${i}/id`, value: efeitos[i].id}, {op: 'remove', path: `/efeitos/${i}`}], `remover efeito ${efeitos[i].id}`).then(() => selecionar(null));
  return (
    <div className="painel">
      <div className="painel-topo">
        <select className="campo" value={alvo ?? ''} onChange={(e) => {
          const d = docs.find((x) => x.id === e.target.value);
          loja.definir((s) => ({alvoEfeitos: e.target.value, selecao: null, ativo: d ? {...s.ativo, [d.modulo]: d.id} : s.ativo}));
        }}>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.modulo === 'video' ? 'Vídeo' : 'Imagem'} · {d.titulo}</option>)}
        </select>
      </div>
      <div className="painel-corpo">
        {!alvo ? <div className="vazio">sem vídeo ou imagem no projeto</div> : (
          <>
            <Secao titulo="Pilha (de cima para baixo)">
              {efeitos.length === 0 && <div className="vazio">Nenhum efeito. Adicione abaixo.</div>}
              <ul className="lista">
                {efeitos.map((e, i) => (
                  <li key={e.id} className={selecao?.caminho === `/efeitos/${i}` ? 'sel' : ''} onClick={() => selecionar({documento: alvo, caminho: `/efeitos/${i}`})}>
                    <input type="checkbox" checked={e.ativo !== false} onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => void trocar(alvo, `/efeitos/${i}/ativo`, ev.target.checked ? undefined : false, `${ev.target.checked ? 'ligar' : 'desligar'} ${e.id}`)} />
                    <span style={{flex: 1}}>{definicao(e.tipo).nome}</span>
                    <span className="rotulo" style={{textTransform: 'none'}}>{Number(e.valor.toFixed(2))}{definicao(e.tipo).unidade}</span>
                    <button className="bt fantasma mini" disabled={i === 0} onClick={(ev) => (ev.stopPropagation(), mover(i, i - 1))}><ArrowUp size={12} /></button>
                    <button className="bt fantasma mini" disabled={i === efeitos.length - 1} onClick={(ev) => (ev.stopPropagation(), mover(i, i + 1))}><ArrowDown size={12} /></button>
                    <button className="bt fantasma mini" onClick={(ev) => (ev.stopPropagation(), remover(i))}><Trash2 size={12} /></button>
                  </li>
                ))}
              </ul>
            </Secao>
            <Secao titulo="Adicionar efeito">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4}}>
                {EFEITOS.map((d) => (
                  <button key={d.tipo} className="bt mini" style={{justifyContent: 'flex-start'}} onClick={() => adicionar(alvo, efeitos, [novoEfeito(d.tipo, efeitos)])}>
                    <Plus size={12} />{d.nome}
                  </button>
                ))}
              </div>
            </Secao>
            <Secao titulo="Pré-ajustes">
              <div style={{display: 'flex', gap: 4, flexWrap: 'wrap'}}>
                {PRESETS.map((p) => (
                  <button key={p.nome} className="bt mini" onClick={() => {
                    const novos: Efeito[] = [];
                    for (const e of p.efeitos) novos.push({...novoEfeito(e.tipo, [...efeitos, ...novos]), ...e});
                    adicionar(alvo, efeitos, novos);
                  }}>{p.nome}</button>
                ))}
              </div>
            </Secao>
          </>
        )}
      </div>
    </div>
  );
};

const InspectorEfeito: React.FC = () => {
  const {alvo, efeitos} = usarAlvo();
  const selecao = useLoja((e) => e.selecao);
  const caminho = selecao && selecao.documento === alvo && /^\/efeitos\/\d+$/.test(selecao.caminho) ? selecao.caminho : null;
  const e = caminho ? (valorEm({efeitos}, caminho) as Efeito | undefined) : undefined;
  if (!alvo || !caminho || !e) return <div className="vazio">Selecione um efeito da pilha para ajustar.</div>;
  const d = definicao(e.tipo);
  const i = Number(caminho.split('/').pop());
  const previa = (valor: number) => {
    const lista = efeitos.map((x, k) => (k === i ? {...x, valor} : x));
    loja.definir({previaEfeitos: {documento: alvo, efeitos: lista}});
  };
  return (
    <div className="painel"><div className="painel-corpo">
      <Secao titulo={`${d.nome} · ${e.id}`}>
        <CampoDeslizante rotulo="valor" valor={e.valor} min={d.min} max={d.max} passo={d.passo} unidade={d.unidade} aoVer={previa}
          aoMudar={(v) => void trocar(alvo, `${caminho}/valor`, v, `${d.nome}: ${v}`).then(() => loja.definir({previaEfeitos: undefined}))} />
        {e.tipo === 'tom' && <CampoCor rotulo="cor" valor={e.cor ?? '#C88155'} aoMudar={(c) => void trocar(alvo, `${caminho}/cor`, c, `cor do ${e.id}`)} />}
        <label className="linha-campo"><span>ligado</span>
          <input type="checkbox" checked={e.ativo !== false} onChange={(ev) => void trocar(alvo, `${caminho}/ativo`, ev.target.checked ? undefined : false)} /></label>
      </Secao>
    </div></div>
  );
};

const MonitorEfeitos: React.FC = () => {
  const {alvo, modulo} = usarAlvo();
  if (!alvo) return <div className="vazio">sem alvo</div>;
  return modulo === 'video' ? <MonitorVideo documento={alvo} /> : <PaineisImagem.Monitor />;
};

const LinhaEfeitos: React.FC = () => {
  const {modulo} = usarAlvo();
  return modulo === 'video' ? <LinhaDoTempo /> : <div className="vazio">imagem não tem linha do tempo</div>;
};

export const PaineisEfeitos: PaineisDoModulo = {tituloLista: 'Pilha de efeitos', Lista: Pilha, Monitor: MonitorEfeitos, Inspector: InspectorEfeito, Linha: LinhaEfeitos};
