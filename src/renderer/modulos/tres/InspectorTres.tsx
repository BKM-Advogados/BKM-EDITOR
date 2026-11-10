// Inspector do 3D: propriedades do objeto ou da luz selecionada; sem seleção, o fundo e a câmera da cena, com o atalho
// para gravar a vista atual do monitor como câmera. Cada campo grava um patch ao sair dele ou ao soltar o controle.
import React from 'react';
import {Camera} from 'lucide-react';
import type {DocCena3D, Luz3D, Objeto3D, OperacaoPatch, Vetor3} from '../../../nucleo/documentos';
import {aplicar, patchTrocar, trocar, useLoja} from '../../estado/loja';
import {CampoDeslizante, CampoLeitura, CampoNumero, CampoTexto, Secao} from '../../componentes/Campos';
import {indiceEm, luzesDe, objetosDe, PADRAO_METALICO, PADRAO_RUGOSIDADE, TIPOS, type TipoObjeto} from './comum';
import {CampoCorAoSoltar, CampoEscolha, CampoVetor} from './CamposTres';
import {ajustarAoVivo, usarVistaComoCamera} from './vista';

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
    // direcional e ponto precisam de posição; quem vem da ambiente ganha uma
    const patch: OperacaoPatch[] = [...patchTrocar(doc, `${caminho}/tipo`, tipo), ...(tipo !== 'ambiente' && !l.posicao ? patchTrocar(doc, `${caminho}/posicao`, [3, 5, 3]) : [])];
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
  const gravarCamera = (campo: 'fov' | 'posicao' | 'alvo', valor: number | Vetor3) =>
    void (camera ? trocar(documento, `/camera/${campo}`, valor, `${campo} da câmera`) : trocar(documento, '/camera', {posicao: [4, 3, 6], alvo: [0, 0, 0], fov: 40, [campo]: valor}, 'câmera'));
  return (
    <>
      <Secao titulo="Cena">
        <CampoCorAoSoltar rotulo="fundo" valor={doc.fundo ?? ''} aoMudar={(c) => void trocar(documento, '/fundo', c, 'fundo da cena')} />
        <CampoLeitura rotulo="objetos">{objetosDe(doc).length}</CampoLeitura>
        <CampoLeitura rotulo="luzes">{luzesDe(doc).length}</CampoLeitura>
      </Secao>
      <Secao titulo="Câmera">
        <CampoNumero rotulo="fov (°)" valor={camera?.fov} passo={1} aoMudar={(n) => n > 1 && n < 179 && gravarCamera('fov', n)} />
        <CampoVetor rotulo="posição" valor={camera?.posicao} aoMudar={(v) => gravarCamera('posicao', v)} />
        <CampoVetor rotulo="alvo" valor={camera?.alvo} aoMudar={(v) => gravarCamera('alvo', v)} />
        <button className="bt principal" style={{width: '100%', justifyContent: 'center', marginTop: 4}} onClick={() => void usarVistaComoCamera(documento)}>
          <Camera size={14} />Usar a vista atual como câmera
        </button>
      </Secao>
      <div className="vazio">Clique num objeto no monitor ou na lista para editar. W, E e R trocam o gizmo entre mover, girar e escala.</div>
    </>
  );
};

export const InspectorTres: React.FC = () => {
  const documento = useLoja((e) => e.ativo['3d']);
  const doc = useLoja((e) => (documento ? e.docs[documento]?.doc : undefined)) as DocCena3D | undefined;
  const selecao = useLoja((e) => e.selecao);
  if (!documento || !doc) return <div className="vazio">Sem cena 3D ainda: crie no monitor.</div>;
  const caminho = selecao?.documento === documento ? selecao.caminho : undefined;
  const iObj = indiceEm(caminho, 'objetos');
  const iLuz = indiceEm(caminho, 'luzes');
  const o = iObj >= 0 ? objetosDe(doc)[iObj] : undefined;
  const l = iLuz >= 0 ? luzesDe(doc)[iLuz] : undefined;

  return (
    <div className="painel">
      <div className="painel-corpo">
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
