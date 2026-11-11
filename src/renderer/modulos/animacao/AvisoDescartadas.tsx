// Camadas de pixel que a validação recusa (grade inválida ou acima do teto) somem da prévia e da exportação: o monitor
// avisa com o motivo e a lista de camadas marca cada uma. Só mostra; o documento fica como está.
import React from 'react';
import {TriangleAlert} from 'lucide-react';
import {camadasDescartadas, type CamadaDescartada, type DocAnimacao} from '../../../nucleo/animacao';
import {selecionar} from '../../estado/loja';

// o monitor redesenha a cada quadro: a conta é uma vez por versão do documento, e a lista e o monitor dividem o resultado
const lidas = new WeakMap<object, CamadaDescartada[]>();
export const descartadasDe = (doc: DocAnimacao): CamadaDescartada[] => {
  let r = lidas.get(doc);
  if (!r) lidas.set(doc, (r = camadasDescartadas(doc)));
  return r;
};

const MOSTRADAS = 3;

export const AvisoCamadasDescartadas: React.FC<{documento: string; doc: DocAnimacao}> = ({documento, doc}) => {
  const lista = descartadasDe(doc);
  if (!lista.length) return null;
  const resto = lista.length - MOSTRADAS;
  return (
    <div className="aviso-descartadas" role="alert">
      <TriangleAlert className="i14" />
      <div className="texto">
        <b>{lista.length === 1 ? '1 camada não aparece' : `${lista.length} camadas não aparecem`} na prévia nem na exportação</b>
        <ul>
          {lista.slice(0, MOSTRADAS).map((c) => (
            <li key={c.indice}>
              <button className="link" onClick={() => selecionar({documento, caminho: `/camadas/${c.indice}`})} title="Selecionar a camada">{c.nome}</button>: {c.motivo}
            </li>
          ))}
        </ul>
        {resto > 0 && <span className="resto">e mais {resto}, marcadas na lista de camadas. </span>}
        <span className="resto">O documento não foi mudado: corrija a grade ou peça ao Claude.</span>
      </div>
    </div>
  );
};
