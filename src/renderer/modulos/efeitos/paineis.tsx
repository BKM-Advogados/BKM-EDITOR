// Área Efeitos: a pilha de efeitos visuais de um vídeo ou de uma imagem do projeto (a mesma definição vale nos dois,
// ver src/nucleo/efeitos.ts). O monitor mostra o alvo com os efeitos; no vídeo, o controle deslizante já aparece na
// prévia enquanto se arrasta, e o patch sai ao soltar.
import {teclaDeApagar} from '../../teclas';
import React from 'react';
import {ArrowDown, ArrowUp, Blend, Copy, GripVertical, Trash2, TriangleAlert, Wrench} from 'lucide-react';
import type {PaineisDoModulo} from '../../casca/contrato';
import {aplicar, documentosDe, loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {SemDocumento} from '../../componentes/SemDocumento';
import {
  definicao, EFEITOS, efeitosDoPreajuste, filtroCss, idNoDocumento as idDoOriginal, idsEmUso as idsDaPilha, lerEfeitos, novoEfeito, patchAdicionarEfeitos, patchRemoverEfeito,
  PREAJUSTES_EFEITOS, TOM_PADRAO, type Efeito, type EfeitoLido,
} from '../../../nucleo/efeitos';
import {comLimiteDeErro} from '../../componentes/LimiteDeErro';
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoLeitura, Secao} from '../../componentes/Campos';
import {MonitorVideo} from '../video/MonitorVideo';
import {LinhaDoTempo} from '../video/LinhaDoTempo';
import {PaineisImagem} from '../imagem/paineis';
import type {OperacaoPatch} from '../../../nucleo/documentos';
import {Escolha} from '../../componentes/Controles';

// a pilha como está no documento, validada (nucleo/efeitos.ts, lerEfeitos): item com tipo desconhecido aparece na lista
// como inválido, com o botão de excluir, em vez de derrubar a área (tres-efeitos-D1); valor fora da faixa ou em texto
// aparece corrigido, com o aviso e o botão Corrigir (que grava o valor certo no documento)
const usarAlvo = () => {
  const alvo = useLoja((e) => e.alvoEfeitos);
  const modulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === e.alvoEfeitos)?.modulo);
  const bruto = useLoja((e) => (e.alvoEfeitos ? e.docs[e.alvoEfeitos]?.doc?.efeitos : undefined)) as unknown;
  const lidos = React.useMemo(() => lerEfeitos(bruto), [bruto]);
  const efeitos = React.useMemo(() => lidos.flatMap((l) => (l.efeito ? [l.efeito] : [])), [lidos]); // só os que se desenham
  return {alvo, modulo, lidos, efeitos};
};

/** O id que o documento tem no item (a prova do "test" do patch), ou undefined se não há id de texto. */
const idNoDocumento = (l: EfeitoLido) => idDoOriginal(l.original);
const testeDoId = (i: number, l: EfeitoLido): OperacaoPatch[] => {
  const id = idNoDocumento(l);
  return id ? [{op: 'test', path: `/efeitos/${i}/id`, value: id}] : [];
};

/** Amostra de 48 px com o efeito aplicado (o filtro CSS de verdade e as camadas de vinheta e tom), numa cena neutra de
 *  céu, pele e mato: dá para ver o que o efeito faz antes de pôr. */
export const AmostraEfeito: React.FC<{efeitos: Omit<Efeito, 'id'>[]}> = ({efeitos}) => {
  const lista = efeitos.map((e, i) => ({...e, id: `amostra-${i}`}));
  const vinheta = lista.find((e) => e.tipo === 'vinheta');
  const tom = lista.find((e) => e.tipo === 'tom');
  const grao = lista.find((e) => e.tipo === 'granulado');
  return (
    <span className="amostra-efeito" aria-hidden="true">
      <span className="cena" style={{filter: filtroCss(lista) || undefined}} />
      {tom && <span className="camada" style={{background: tom.cor ?? TOM_PADRAO, mixBlendMode: 'soft-light', opacity: tom.valor}} />}
      {vinheta && <span className="camada vinheta" style={{opacity: vinheta.valor}} />}
      {grao && <span className="camada grao" style={{opacity: grao.valor}} />}
    </span>
  );
};
/** Um valor que mostra bem o efeito na amostra (o padrão quase não aparece em 48 px). */
const valorDeMostra = (tipo: Efeito['tipo']) => {
  const d = definicao(tipo);
  return tipo === 'matiz' ? 90 : d.padrao + (d.max - d.padrao) * 0.5;
};

const adicionar = (alvo: string, novos: Efeito[]) => {
  // se o documento tem `efeitos` mas não é uma lista (JSON à mão), o efeito novo troca o valor por uma lista
  const {patch, primeiro} = patchAdicionarEfeitos(loja.get().docs[alvo]?.doc, novos);
  void aplicar(alvo, patch, `efeito ${novos.map((e) => e.tipo).join(', ')}`).then(() => selecionar({documento: alvo, caminho: `/efeitos/${primeiro + novos.length - 1}`}));
};

const valorCurto = (e: Efeito) => `${String(Number(e.valor.toFixed(2))).replace('.', ',')}${definicao(e.tipo).unidade}`;
// ids que o documento já usa, também os dos itens inválidos, para um efeito novo não repetir
const idsEmUso = (lidos: EfeitoLido[]) => idsDaPilha(lidos.map((l) => l.original));

// a pilha como acordeão (como os Controles de efeito do After Effects): a chave fx liga e desliga, o clique na linha
// abre os ajustes ali mesmo, arrastar ou Alt+↑/↓ reordena; nada de formulário separado
const Pilha: React.FC = () => {
  const {alvo, lidos} = usarAlvo();
  const selecao = useLoja((e) => e.selecao);
  const docs = [...documentosDe('video'), ...documentosDe('imagem')];
  const [arrastando, setArrastando] = React.useState<number | null>(null);
  const nomeDe = (i: number) => idNoDocumento(lidos[i]) ?? `efeito ${i + 1}`;
  const mover = (i: number, j: number) => {
    if (!alvo || j < 0 || j >= lidos.length) return;
    void aplicar(alvo, [...testeDoId(i, lidos[i]), {op: 'move', from: `/efeitos/${i}`, path: `/efeitos/${j}`}], `ordem do efeito ${nomeDe(i)}`)
      .then(() => selecionar({documento: alvo, caminho: `/efeitos/${j}`}));
  };
  const remover = (i: number) => alvo && void aplicar(alvo, patchRemoverEfeito(lidos.map((l) => l.original), i), `remover efeito ${nomeDe(i)}`).then(() => selecionar(null));
  const duplicar = (i: number) => {
    const e = lidos[i].efeito;
    if (alvo && e) adicionar(alvo, [{...e, id: novoEfeito(e.tipo, idsEmUso(lidos)).id}]);
  };
  const alternar = (i: number, e: Efeito) => alvo && void trocar(alvo, `/efeitos/${i}/ativo`, e.ativo !== false ? false : undefined, `${e.ativo !== false ? 'desligar' : 'ligar'} ${e.id}`);
  // o item corrigido no lugar do que está no documento (valor em texto, fora da faixa ou sem valor)
  const corrigir = (i: number, e: Efeito) => alvo && void aplicar(alvo, [...testeDoId(i, lidos[i]), {op: 'replace', path: `/efeitos/${i}`, value: e}], `corrigir efeito ${e.id}`);
  const previa = (i: number, valor: number) => alvo && loja.definir({previaEfeitos: {documento: alvo, efeitos: lidos.flatMap((l, k) => (l.efeito ? [k === i ? {...l.efeito, valor} : l.efeito] : []))}});
  return (
    <div className="painel">
      <div className="painel-topo">
        <Escolha valor={alvo ?? undefined} rotulo="Documento cujos efeitos se editam" vazio="Escolha o vídeo ou a imagem"
          opcoes={docs.map((d): [string, string] => [d.id, `${d.modulo === 'video' ? 'Vídeo' : 'Imagem'} · ${d.titulo}`])}
          aoMudar={(id) => {
            const d = docs.find((x) => x.id === id);
            loja.definir((s) => ({alvoEfeitos: id, selecao: null, ativo: d ? {...s.ativo, [d.modulo]: d.id} : s.ativo}));
          }} />
      </div>
      <div className="painel-corpo">
        {!alvo ? <SemDocumento modulo="video" compacto /> : (
          <>
            <div className="pre-ajustes">
              {PREAJUSTES_EFEITOS.map((p) => (
                <button key={p.nome} className="cartao-efeito" title={`Pôr ${p.nome}: ${p.efeitos.map((e) => definicao(e.tipo).nome).join(' · ')}`}
                  onClick={() => adicionar(alvo, efeitosDoPreajuste(p.efeitos, lidos.map((l) => l.original)))}><AmostraEfeito efeitos={p.efeitos} /><span className="nome-efeito">{p.nome}</span></button>
              ))}
            </div>
            {lidos.length === 0 && <div className="vazio">Nenhum efeito. Use um pré-ajuste acima ou adicione abaixo.</div>}
            <ul className="pilha-efeitos">
              {lidos.map((l, i) => {
                const e = l.efeito;
                if (!e) {
                  // tipo desconhecido ou item que não é objeto: não se desenha; fica aqui, avisado, para excluir
                  return (
                    <li key={`${idNoDocumento(l) ?? 'item'}-${i}`} className="efeito desligado invalido" data-efeito-invalido>
                      <div className="efeito-linha">
                        <TriangleAlert size={13} className="alca-arrastar" style={{color: 'var(--aviso)'}} />
                        <span className="nome" title={l.problema}>{idNoDocumento(l) ?? `Item ${i + 1}`} (inválido)</span>
                        <span className="valor" title={l.problema}>{l.problema?.replace(/^[^:]+: /, '')}</span>
                        <span className="acoes-efeito">
                          <button aria-label="Excluir este item" className="bti" title="Excluir este item" onClick={() => remover(i)}><Trash2 size={13} /></button>
                        </span>
                      </div>
                    </li>
                  );
                }
                const d = definicao(e.tipo);
                const aberto = selecao?.documento === alvo && selecao.caminho === `/efeitos/${i}`;
                const ligado = e.ativo !== false;
                const abrir = () => selecionar(aberto ? null : {documento: alvo, caminho: `/efeitos/${i}`});
                return (
                  <li key={`${e.id}-${i}`} className={`efeito${aberto ? ' aberto' : ''}${ligado ? '' : ' desligado'}${arrastando === i ? ' arrastando' : ''}`}
                    draggable onDragStart={() => setArrastando(i)} onDragEnd={() => setArrastando(null)}
                    onDragOver={(ev) => ev.preventDefault()} onDrop={() => {
                      if (arrastando !== null && arrastando !== i) mover(arrastando, i);
                      setArrastando(null);
                    }}>
                    <div className="efeito-linha" tabIndex={0} onClick={abrir} onKeyDown={(ev) => {
                      // a tecla vinda de um botão da linha (fx, subir, excluir…) é do botão: sem isto, Enter ligava o efeito e abria o
                      // acordeão, e D em outro botão também ligava (tres-efeitos-D14)
                      if (ev.target !== ev.currentTarget) return;
                      if (ev.altKey && ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        mover(i, i - 1);
                      } else if (ev.altKey && ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        mover(i, i + 1);
                      } else if (ev.key === 'Enter') abrir();
                      else if (ev.key.toLowerCase() === 'd') alternar(i, e);
                      else if (teclaDeApagar(ev)) remover(i);
                    }}>
                      <GripVertical size={13} className="alca-arrastar" />
                      <button className={`fx${ligado ? ' ligado' : ''}`} title={`${ligado ? 'Desligar' : 'Ligar'} (D)`} onClick={(ev) => {
                        ev.stopPropagation();
                        alternar(i, e);
                      }}>fx</button>
                      <span className="nome">{d.nome}</span>
                      {l.problema && <TriangleAlert size={12} style={{color: 'var(--aviso)'}} aria-label="valor corrigido na leitura" />}
                      <span className="valor">{valorCurto(e)}</span>
                      <span className="acoes-efeito" onClick={(ev) => ev.stopPropagation()}>
                        <button aria-label="Subir (Alt+↑)" className="bti" title="Subir (Alt+↑)" disabled={i === 0} onClick={() => mover(i, i - 1)}><ArrowUp size={13} /></button>
                        <button aria-label="Descer (Alt+↓)" className="bti" title="Descer (Alt+↓)" disabled={i === lidos.length - 1} onClick={() => mover(i, i + 1)}><ArrowDown size={13} /></button>
                        <button aria-label="Duplicar" className="bti" title="Duplicar" onClick={() => duplicar(i)}><Copy size={13} /></button>
                        <button aria-label="Excluir (Delete)" className="bti" title="Excluir (Delete)" onClick={() => remover(i)}><Trash2 size={13} /></button>
                      </span>
                    </div>
                    {aberto && (
                      <div className="efeito-ajustes">
                        {l.problema && (
                          <div className="efeito-corrigir" style={{display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 6px', color: 'var(--aviso)', fontSize: 'var(--tam-2)'}}>
                            <span style={{flex: 1, minWidth: 0}}>No documento: {l.problema.replace(/^[^:]+: /, '')}.</span>
                            <button className="bt mini" title="Grava no documento o valor que a tela está usando" onClick={() => corrigir(i, e)}><Wrench size={12} />Corrigir</button>
                          </div>
                        )}
                        <CampoDeslizante rotulo="Valor" valor={e.valor} min={d.min} max={d.max} passo={d.passo} unidade={d.unidade} padrao={d.padrao} aoVer={(v) => previa(i, v)} aoFimSemMudar={() => loja.definir({previaEfeitos: undefined})}
                          aoMudar={(v) => void trocar(alvo, `/efeitos/${i}/valor`, v, `${d.nome}: ${v}`).then(() => loja.definir({previaEfeitos: undefined}))} />
                        {e.tipo === 'tom' && <CampoCor rotulo="Cor" valor={e.cor ?? TOM_PADRAO} padrao={TOM_PADRAO} aoMudar={(c) => void trocar(alvo, `/efeitos/${i}/cor`, c, `cor do ${e.id}`)} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Secao titulo="Adicionar efeito" chave="efeitos-adicionar" fechadaDePadrao={lidos.length > 0}>
              <div className="grade-adicionar">
                {EFEITOS.map((d) => (
                  <button key={d.tipo} className="cartao-efeito" title={`Pôr ${d.nome}`} onClick={() => adicionar(alvo, [novoEfeito(d.tipo, idsEmUso(lidos))])}>
                    <AmostraEfeito efeitos={[{tipo: d.tipo, valor: valorDeMostra(d.tipo), ...(d.tipo === 'tom' ? {cor: TOM_PADRAO} : {})}]} />
                    <span className="nome-efeito">{d.nome}</span>
                  </button>
                ))}
              </div>
            </Secao>
          </>
        )}
      </div>
    </div>
  );
};

/** Antes e depois pelo teclado: segurar Shift+D mostra sem os efeitos; soltar volta (o tela.md previa a tecla). */
const usarAntesDepois = (sem: () => void, com: () => void, ligado: boolean) => {
  const ref = React.useRef({sem, com});
  ref.current = {sem, com};
  React.useEffect(() => {
    if (!ligado) return;
    let segurando = false;
    const baixa = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (/INPUT|TEXTAREA/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm')) return;
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyD' && !segurando) {
        e.preventDefault();
        segurando = true;
        ref.current.sem();
      }
    };
    const solta = (e: KeyboardEvent) => {
      if (segurando && (e.code === 'KeyD' || e.key === 'Shift')) {
        segurando = false;
        ref.current.com();
      }
    };
    window.addEventListener('keydown', baixa);
    window.addEventListener('keyup', solta);
    return () => {
      window.removeEventListener('keydown', baixa);
      window.removeEventListener('keyup', solta);
      if (segurando) ref.current.com();
    };
  }, [ligado]);
};

// inspector da área: o alvo (o que recebe os efeitos), quantos estão ligados e o "antes" segurando o botão
const InspectorEfeito: React.FC = () => {
  const {alvo, modulo, lidos, efeitos} = usarAlvo();
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === e.alvoEfeitos)?.titulo);
  const doc = useLoja((e) => (e.alvoEfeitos ? e.docs[e.alvoEfeitos]?.doc : undefined));
  const duracao = useLoja((e) => {
    const p = e.alvoEfeitos ? e.props[e.alvoEfeitos] : undefined;
    return p && 'props' in p ? p.props.duracao_ms : undefined;
  });
  const medidaVideo = useLoja((e) => {
    const p = e.alvoEfeitos ? e.props[e.alvoEfeitos] : undefined;
    return p && 'props' in p ? `${Number(p.props.largura) || 1080} × ${Number(p.props.altura) || 1920}` : '1080 × 1920';
  });
  if (!alvo) return <div className="vazio">sem alvo</div>;
  const ligados = efeitos.filter((e) => e.ativo !== false).length;
  const sub = modulo === 'video' ? `Vídeo ${medidaVideo}${duracao ? ` · ${Math.round(duracao / 1000)} s` : ''}` : `Imagem ${doc?.largura ?? '?'} × ${doc?.altura ?? '?'}`;
  const semEfeitos = () => loja.definir({previaEfeitos: {documento: alvo, efeitos: efeitos.map((x) => ({...x, ativo: false}))}});
  const comEfeitos = () => loja.definir({previaEfeitos: undefined});
  usarAntesDepois(semEfeitos, comEfeitos, Boolean(efeitos.length));
  return (
    <div className="painel"><div className="painel-corpo">
      <CabecalhoInspector icone={<Blend size={14} />} familia="efeito" nome={titulo ?? alvo} sub={sub} />
      <Secao titulo="Efeitos">
        <CampoLeitura rotulo="Ligados">{efeitos.length ? `${ligados} de ${efeitos.length}` : 'nenhum'}</CampoLeitura>
        {lidos.some((l) => l.problema) && <div style={{padding: '2px 10px 6px 18px', color: 'var(--aviso)', fontSize: 'var(--tam-2)'}}>
          {lidos.filter((l) => l.problema).length === 1 ? 'Um item do documento' : `${lidos.filter((l) => l.problema).length} itens do documento`} com valor fora do lugar: veja o aviso na pilha.
        </div>}
        <div style={{padding: '4px 10px 6px 18px'}}>
          <button className="bt mini" disabled={!efeitos.length} onPointerDown={semEfeitos} onPointerUp={comEfeitos} onPointerLeave={comEfeitos}
            title="Segure (ou segure Shift+D) para ver como fica sem os efeitos">Segure para ver o antes <kbd>Shift</kbd><kbd>D</kbd></button>
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

// cada painel dentro do seu limite de erro: um erro ao desenhar mostra o motivo no painel e a janela segue viva (tres-efeitos-D1)
export const PaineisEfeitos: PaineisDoModulo = comLimiteDeErro({tituloLista: 'Pilha de efeitos', Lista: Pilha, Monitor: MonitorEfeitos, Inspector: InspectorEfeito, Linha: LinhaEfeitos}, 'Efeitos');
