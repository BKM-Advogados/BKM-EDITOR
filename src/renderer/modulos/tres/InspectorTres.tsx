// Inspector do 3D: propriedades do objeto ou da luz selecionada; sem seleção, o fundo e a câmera da cena, com o atalho
// para gravar a vista atual do monitor como câmera. Cada campo grava um patch ao sair dele ou ao soltar o controle.
import React from 'react';
import {Camera} from 'lucide-react';
import type {DocCena3D, Luz3D, Objeto3D, OperacaoPatch, Vetor3} from '../../../nucleo/documentos';
import {aplicar, avisar, patchTrocar, trocar, useLoja} from '../../estado/loja';
import {CampoDeslizante, CampoLeitura, CampoNumero, CampoTexto, Secao} from '../../componentes/Campos';
import {indiceEm, luzesDe, objetosDe, PADRAO_METALICO, PADRAO_RUGOSIDADE, TIPOS, type TipoObjeto} from './comum';
import {CampoCorAoSoltar, CampoEscolha, CampoVetor} from './CamposTres';
import {ajustarAoVivo, lerVista, usarVistaComoCamera} from './vista';
import {corrigirCena3d, useCena3d} from './lida';
import {INTENSIDADE_PADRAO_LUZ, type CenaLida, type ProblemaCena3D} from '../../../nucleo/cena3d';

const TIPOS_LUZ: {valor: Luz3D['tipo']; nome: string}[] = [
  {valor: 'ambiente', nome: 'Ambiente'},
  {valor: 'direcional', nome: 'Direcional'},
  {valor: 'ponto', nome: 'Ponto'},
];
const OPCOES_TIPO = TIPOS.map((t) => ({valor: t.tipo, nome: t.nome}));


const Id: React.FC<{id: string}> = ({id}) => <span className="etiqueta" title="id estável (o agente e os comentários usam este)">{id}</span>;

const InspectorObjeto: React.FC<{documento: string; caminho: string; o: Objeto3D}> = ({documento, caminho, o}) => {
  const nome = o.nome || o.id;
  const gravar = (campo: string, valor: unknown) => void trocar(documento, `${caminho}/${campo}`, valor, `${campo} de ${nome}`);
  return (
    <>
      <Secao titulo="Objeto" acao={<Id id={o.id} />}>
        <CampoTexto rotulo="nome" valor={o.nome ?? ''} aoMudar={(t) => gravar('nome', t)} invalido={(t) => (t.trim() ? null : 'o nome não pode ficar vazio')} />
        <CampoEscolha<TipoObjeto> rotulo="tipo" valor={o.tipo} opcoes={OPCOES_TIPO} aoMudar={(t) => gravar('tipo', t)} />
      </Secao>
      <Secao titulo="Transformação">
        <CampoVetor rotulo="posição" valor={o.posicao} aoMudar={(v) => gravar('posicao', v)} />
        <CampoVetor rotulo="rotação (°)" valor={o.rotacao} passo={5} aoMudar={(v) => gravar('rotacao', v)} />
        <CampoVetor rotulo="escala" valor={o.escala} padrao={[1, 1, 1]} aoMudar={(v) => gravar('escala', v)} />
      </Secao>
      <Secao titulo="Material">
        <CampoCorAoSoltar rotulo="cor" valor={o.cor ?? ''} aoVer={(c) => ajustarAoVivo(o.id, {cor: c})} aoMudar={(c) => gravar('cor', c)} />
        <CampoDeslizante rotulo="metálico" valor={o.metalico ?? PADRAO_METALICO} min={0} max={1} passo={0.01}
          aoVer={(v) => ajustarAoVivo(o.id, {metalico: v})} aoMudar={(v) => gravar('metalico', v)} />
        <CampoDeslizante rotulo="rugosidade" valor={o.rugosidade ?? PADRAO_RUGOSIDADE} min={0} max={1} passo={0.01}
          aoVer={(v) => ajustarAoVivo(o.id, {rugosidade: v})} aoMudar={(v) => gravar('rugosidade', v)} />
      </Secao>
      <Secao titulo="Prévia animada">
        <CampoVetor rotulo="gira (°/s)" valor={o.gira} passo={5} aoMudar={(v) => gravar('gira', v)} />
      </Secao>
    </>
  );
};

const InspectorLuz: React.FC<{documento: string; doc: DocCena3D; caminho: string; l: Luz3D}> = ({documento, doc, caminho, l}) => {
  const gravar = (campo: string, valor: unknown) => void trocar(documento, `${caminho}/${campo}`, valor, `${campo} da luz ${l.id}`);
  const trocarTipo = (tipo: Luz3D['tipo']) => {
    // direcional e ponto precisam de posição; quem vem da ambiente ganha uma. A intensidade que ainda é a padrão do tipo antigo passa
    // a ser a do novo (a de ponto cai com o quadrado da distância: 1,6 deixava a cena quase escura; tres-efeitos-D9)
    const padraoAntigo = INTENSIDADE_PADRAO_LUZ[l.tipo];
    const intensidade = Math.abs(l.intensidade - padraoAntigo) < 0.01 ? INTENSIDADE_PADRAO_LUZ[tipo] : undefined;
    const patch: OperacaoPatch[] = [...patchTrocar(doc, `${caminho}/tipo`, tipo), ...(tipo !== 'ambiente' && !l.posicao ? patchTrocar(doc, `${caminho}/posicao`, [3, 5, 3]) : []),
      ...(intensidade !== undefined ? patchTrocar(doc, `${caminho}/intensidade`, intensidade) : [])];
    void aplicar(documento, patch, `tipo da luz ${l.id}`);
  };
  return (
    <Secao titulo="Luz" acao={<Id id={l.id} />}>
      <CampoEscolha<Luz3D['tipo']> rotulo="tipo" valor={l.tipo} opcoes={TIPOS_LUZ} aoMudar={trocarTipo} />
      <CampoCorAoSoltar rotulo="cor" valor={l.cor ?? ''} aoMudar={(c) => gravar('cor', c)} />
      <CampoNumero rotulo="intensidade" valor={l.intensidade} passo={0.1} aoMudar={(n) => gravar('intensidade', n)} />
      {l.tipo !== 'ambiente' && <CampoVetor rotulo="posição" valor={l.posicao} aoMudar={(v) => gravar('posicao', v)} />}
    </Secao>
  );
};

const InspectorCena: React.FC<{documento: string; doc: DocCena3D}> = ({documento, doc}) => {
  const camera = doc.camera as Partial<DocCena3D['camera']> | undefined;
  const [chaveFov, setChaveFov] = React.useState(0);
  // cena sem câmera: a nova parte da vista que está no monitor (e não de um alvo fixo), para a vista não saltar (tres-efeitos-D13)
  const gravarCamera = (campo: 'fov' | 'posicao' | 'alvo', valor: number | Vetor3) =>
    void (camera ? trocar(documento, `/camera/${campo}`, valor, `${campo} da câmera`)
      : trocar(documento, '/camera', {...(lerVista() ?? {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40}), [campo]: valor}, 'câmera'));
  return (
    <>
      <Secao titulo="Cena">
        <CampoCorAoSoltar rotulo="fundo" valor={doc.fundo ?? ''} aoMudar={(c) => void trocar(documento, '/fundo', c, 'fundo da cena')} />
        <CampoLeitura rotulo="objetos">{objetosDe(doc).length}</CampoLeitura>
        <CampoLeitura rotulo="luzes">{luzesDe(doc).length}</CampoLeitura>
      </Secao>
      <Secao titulo="Câmera">
        <CampoNumero key={chaveFov} rotulo="fov (°)" valor={camera?.fov} passo={1} aoMudar={(n) => {
          if (n > 1 && n < 179) return gravarCamera('fov', n);
          avisar('O campo de visão vai de 1° a 179°: o valor não foi gravado.', 'erro');
          setChaveFov((k) => k + 1); // o campo volta ao valor que está no documento
        }} />
        <CampoVetor rotulo="posição" valor={camera?.posicao} aoMudar={(v) => gravarCamera('posicao', v)} />
        <CampoVetor rotulo="alvo" valor={camera?.alvo} aoMudar={(v) => gravarCamera('alvo', v)} />
        <button className="bt" style={{width: "100%", justifyContent: "center", marginTop: 4}} onClick={() => void usarVistaComoCamera(documento)}>
          <Camera size={14} />Usar a vista atual como câmera
        </button>
      </Secao>
      <div className="vazio">Clique num objeto no monitor ou na lista para editar. W, E e R trocam o gizmo entre mover, girar e escala.</div>
    </>
  );
};

/** O que estava fora do lugar no documento neste item (ou na cena, sem item), com o botão que grava a correção. */
const AvisosDoDocumento: React.FC<{documento: string; lida: CenaLida; problemas: ProblemaCena3D[]}> = ({documento, lida, problemas}) => {
  if (!problemas.length) return null;
  return (
    <Secao titulo={`Avisos (${problemas.length})`}>
      <div className="avisos-roteiro" data-avisos-3d>
        {problemas.map((p, i) => <div key={i}>{p.texto}</div>)}
      </div>
      <div style={{padding: '4px 10px 6px'}}>
        <button className="bt mini" title="Grava no documento os valores que a tela está usando (Ctrl+Z desfaz)" onClick={() => void corrigirCena3d(documento, lida, problemas)}>Corrigir no documento</button>
      </div>
    </Secao>
  );
};

export const InspectorTres: React.FC = () => {
  const documento = useLoja((e) => e.ativo['3d']);
  const lida = useCena3d(documento); // a cena validada: campo com tipo errado não derruba a janela (tres-efeitos-D12)
  const doc = lida?.doc;
  const selecao = useLoja((e) => e.selecao);
  if (!documento || !doc || !lida) return <div className="vazio">Sem cena 3D ainda: crie no monitor.</div>;
  const caminho = selecao?.documento === documento ? selecao.caminho : undefined;
  const iObj = indiceEm(caminho, 'objetos');
  const iLuz = indiceEm(caminho, 'luzes');
  const o = iObj >= 0 ? objetosDe(doc)[iObj] : undefined;
  const l = iLuz >= 0 ? luzesDe(doc)[iLuz] : undefined;
  // os avisos do item selecionado; sem item, os da cena (fundo e câmera)
  const problemas = lida.problemas.filter((p) => (o && caminho ? p.caminho.startsWith(`${caminho}/`) || p.caminho === caminho
    : l && caminho ? p.caminho.startsWith(`${caminho}/`) || p.caminho === caminho : !/^\/(objetos|luzes)\//.test(p.caminho)));

  return (
    <div className="painel">
      <div className="painel-corpo">
        <AvisosDoDocumento documento={documento} lida={lida} problemas={problemas} />
        {o && caminho ? (
          <InspectorObjeto key={o.id} documento={documento} caminho={caminho} o={o} />
        ) : l && caminho ? (
          <InspectorLuz key={l.id} documento={documento} doc={doc} caminho={caminho} l={l} />
        ) : (
          <InspectorCena documento={documento} doc={doc} />
        )}
      </div>
    </div>
  );
};
