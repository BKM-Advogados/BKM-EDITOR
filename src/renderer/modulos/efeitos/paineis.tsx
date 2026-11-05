// Área Efeitos: a pilha de efeitos visuais de um vídeo ou de uma imagem do projeto (a mesma definição vale nos dois,
// ver src/nucleo/efeitos.ts). O monitor mostra o alvo com os efeitos; no vídeo, o controle deslizante já aparece na
// prévia enquanto se arrasta, e o patch sai ao soltar.
import React from 'react';
import {ArrowDown, ArrowUp, Blend, Copy, GripVertical, Plus, Trash2} from 'lucide-react';
import type {PaineisDoModulo} from '../../casca/contrato';
import {aplicar, documentosDe, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {SemDocumento} from '../../componentes/SemDocumento';
import {definicao, EFEITOS, novoEfeito, type Efeito} from '../../../nucleo/efeitos';
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoLeitura, Secao} from '../../componentes/Campos';
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

const valorCurto = (e: Efeito) => `${String(Number(e.valor.toFixed(2))).replace('.', ',')}${definicao(e.tipo).unidade}`;

// a pilha como acordeão (como os Controles de efeito do After Effects): a chave fx liga e desliga, o clique na linha
// abre os ajustes ali mesmo, arrastar ou Alt+↑/↓ reordena; nada de formulário separado
const Pilha: React.FC = () => {
  const {alvo, efeitos} = usarAlvo();
  const selecao = useLoja((e) => e.selecao);
  const docs = [...documentosDe('video'), ...documentosDe('imagem')];
  const [arrastando, setArrastando] = React.useState<number | null>(null);
  const mover = (i: number, j: number) => {
    if (!alvo || j < 0 || j >= efeitos.length) return;
    void aplicar(alvo, [{op: 'test', path: `/efeitos/${i}/id`, value: efeitos[i].id}, {op: 'move', from: `/efeitos/${i}`, path: `/efeitos/${j}`}], `ordem do efeito ${efeitos[i].id}`)
      .then(() => selecionar({documento: alvo, caminho: `/efeitos/${j}`}));
  };
  const remover = (i: number) => alvo && void aplicar(alvo, [{op: 'test', path: `/efeitos/${i}/id`, value: efeitos[i].id}, {op: 'remove', path: `/efeitos/${i}`}], `remover efeito ${efeitos[i].id}`).then(() => selecionar(null));
  const duplicar = (i: number) => alvo && adicionar(alvo, efeitos, [{...efeitos[i], id: novoEfeito(efeitos[i].tipo, efeitos).id}]);
  const alternar = (i: number, e: Efeito) => alvo && void trocar(alvo, `/efeitos/${i}/ativo`, e.ativo !== false ? false : undefined, `${e.ativo !== false ? 'desligar' : 'ligar'} ${e.id}`);
  const previa = (i: number, valor: number) => alvo && loja.definir({previaEfeitos: {documento: alvo, efeitos: efeitos.map((x, k) => (k === i ? {...x, valor} : x))}});
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
        {!alvo ? <SemDocumento modulo="video" compacto /> : (
          <>
            <div className="pre-ajustes">
              {PRESETS.map((p) => (
                <button key={p.nome} className="anexo-preset" title={p.efeitos.map((e) => definicao(e.tipo).nome).join(' · ')} onClick={() => {
                  const novos: Efeito[] = [];
                  for (const e of p.efeitos) novos.push({...novoEfeito(e.tipo, [...efeitos, ...novos]), ...e});
                  adicionar(alvo, efeitos, novos);
                }}><Plus size={12} />{p.nome}</button>
              ))}
            </div>
            {efeitos.length === 0 && <div className="vazio">Nenhum efeito. Use um pré-ajuste acima ou adicione abaixo.</div>}
            <ul className="pilha-efeitos">
              {efeitos.map((e, i) => {
                const d = definicao(e.tipo);
                const aberto = selecao?.documento === alvo && selecao.caminho === `/efeitos/${i}`;
                const ligado = e.ativo !== false;
                const abrir = () => selecionar(aberto ? null : {documento: alvo, caminho: `/efeitos/${i}`});
                return (
                  <li key={e.id} className={`efeito${aberto ? ' aberto' : ''}${ligado ? '' : ' desligado'}${arrastando === i ? ' arrastando' : ''}`}
                    draggable onDragStart={() => setArrastando(i)} onDragEnd={() => setArrastando(null)}
                    onDragOver={(ev) => ev.preventDefault()} onDrop={() => {
                      if (arrastando !== null && arrastando !== i) mover(arrastando, i);
                      setArrastando(null);
                    }}>
                    <div className="efeito-linha" tabIndex={0} onClick={abrir} onKeyDown={(ev) => {
                      if (ev.altKey && ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        mover(i, i - 1);
                      } else if (ev.altKey && ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        mover(i, i + 1);
                      } else if (ev.key === 'Enter') abrir();
                      else if (ev.key.toLowerCase() === 'd') alternar(i, e);
                      else if (ev.key === 'Delete') remover(i);
                    }}>
                      <GripVertical size={13} className="alca-arrastar" />
                      <button className={`fx${ligado ? ' ligado' : ''}`} title={`${ligado ? 'Desligar' : 'Ligar'} (D)`} onClick={(ev) => {
                        ev.stopPropagation();
                        alternar(i, e);
                      }}>fx</button>
                      <span className="nome">{d.nome}</span>
                      <span className="valor">{valorCurto(e)}</span>
                      <span className="acoes-efeito" onClick={(ev) => ev.stopPropagation()}>
                        <button className="bti" title="Subir (Alt+↑)" disabled={i === 0} onClick={() => mover(i, i - 1)}><ArrowUp size={13} /></button>
                        <button className="bti" title="Descer (Alt+↓)" disabled={i === efeitos.length - 1} onClick={() => mover(i, i + 1)}><ArrowDown size={13} /></button>
                        <button className="bti" title="Duplicar" onClick={() => duplicar(i)}><Copy size={13} /></button>
                        <button className="bti" title="Excluir (Delete)" onClick={() => remover(i)}><Trash2 size={13} /></button>
                      </span>
                    </div>
                    {aberto && (
                      <div className="efeito-ajustes">
                        <CampoDeslizante rotulo="Valor" valor={e.valor} min={d.min} max={d.max} passo={d.passo} unidade={d.unidade} padrao={d.padrao} aoVer={(v) => previa(i, v)}
                          aoMudar={(v) => void trocar(alvo, `/efeitos/${i}/valor`, v, `${d.nome}: ${v}`).then(() => loja.definir({previaEfeitos: undefined}))} />
                        {e.tipo === 'tom' && <CampoCor rotulo="Cor" valor={e.cor ?? '#C88155'} padrao="#C88155" aoMudar={(c) => void trocar(alvo, `/efeitos/${i}/cor`, c, `cor do ${e.id}`)} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Secao titulo="Adicionar efeito" chave="efeitos-adicionar" fechadaDePadrao={efeitos.length > 0}>
              <div className="grade-adicionar">
                {EFEITOS.map((d) => (
                  <button key={d.tipo} className="bt fantasma mini" onClick={() => adicionar(alvo, efeitos, [novoEfeito(d.tipo, efeitos)])}><Plus size={12} />{d.nome}</button>
                ))}
              </div>
            </Secao>
          </>
        )}
      </div>
    </div>
  );
};

// inspector da área: o alvo (o que recebe os efeitos), quantos estão ligados e o "antes" segurando o botão
const InspectorEfeito: React.FC = () => {
  const {alvo, modulo, efeitos} = usarAlvo();
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === e.alvoEfeitos)?.titulo);
  const doc = useLoja((e) => (e.alvoEfeitos ? e.docs[e.alvoEfeitos]?.doc : undefined));
  const duracao = useLoja((e) => {
    const p = e.alvoEfeitos ? e.props[e.alvoEfeitos] : undefined;
    return p && 'props' in p ? p.props.duracao_ms : undefined;
  });
  if (!alvo) return <div className="vazio">sem alvo</div>;
  const ligados = efeitos.filter((e) => e.ativo !== false).length;
  const sub = modulo === 'video' ? `Vídeo 1080 × 1920${duracao ? ` · ${Math.round(duracao / 1000)} s` : ''}` : `Imagem ${doc?.largura ?? '?'} × ${doc?.altura ?? '?'}`;
  const semEfeitos = () => loja.definir({previaEfeitos: {documento: alvo, efeitos: efeitos.map((x) => ({...x, ativo: false}))}});
  const comEfeitos = () => loja.definir({previaEfeitos: undefined});
  return (
    <div className="painel"><div className="painel-corpo">
      <CabecalhoInspector icone={<Blend size={14} />} familia="efeito" nome={titulo ?? alvo} sub={sub} />
      <Secao titulo="Efeitos">
        <CampoLeitura rotulo="Ligados">{efeitos.length ? `${ligados} de ${efeitos.length}` : 'nenhum'}</CampoLeitura>
        <div style={{padding: '4px 10px 6px 18px'}}>
          <button className="bt mini" disabled={!efeitos.length} onPointerDown={semEfeitos} onPointerUp={comEfeitos} onPointerLeave={comEfeitos}
            title="Segure para ver como fica sem os efeitos">Segure para ver o antes</button>
        </div>
      </Secao>
      <div className="vazio" style={{textAlign: 'left'}}>Os ajustes de cada efeito abrem na própria pilha: clique no nome.</div>
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
