// "Inserir ícone" do trilho: busca nos 2000 ícones do Lucide por palavra em português ("balança", "contrato", "prazo") ou em
// inglês, e o clique põe o ícone no centro da página, na cor de destaque do kit. Sem busca, uma grade de ícones de uso
// comum no direito e no trabalho. O ícone depois é uma forma como as outras: cor, tamanho, giro, sombra e contorno.
import React, {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import type {DocImagem} from '../../../nucleo/documentos';
import {buscarIcones, existeIcone} from '../../../nucleo/icones';
import {usarFora} from '../../componentes/Menu';
import {novoIcone} from './acoes';
import {geometriaDoIcone} from './icone';
import './icones.css';

const SUGESTOES = ['scale', 'gavel', 'landmark', 'file-text', 'handshake', 'signature', 'calendar-clock', 'hourglass', 'alarm-clock', 'banknote', 'hand-coins', 'piggy-bank',
  'briefcase', 'hard-hat', 'users', 'user-round', 'door-open', 'tree-palm', 'shield-check', 'triangle-exclamation-point', 'circle-check', 'circle-x', 'lightbulb', 'circle-question-mark',
  'phone', 'mail', 'map-pin', 'arrow-right', 'star', 'heart', 'book-open', 'scroll-text'].filter(existeIcone);

/** O ícone em SVG, na grade de 24 do Lucide, com a cor do texto de onde estiver. */
export const IconeSvg: React.FC<{nome: string; tamanho?: number}> = ({nome, tamanho = 24}) => {
  const g = geometriaDoIcone(nome);
  if (!g) return null;
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {g.tracos.map((d, i) => <path key={`t${i}`} d={d} />)}
      {g.cheios.map((d, i) => <path key={`c${i}`} d={d} fill="currentColor" />)}
    </svg>
  );
};

export const BuscaIcones: React.FC<{documento: string; doc: DocImagem; fechar: () => void}> = ({documento, doc, fechar}) => {
  const [consulta, setConsulta] = useState('');
  const caixa = usarFora(true, fechar);
  const nomes = useMemo(() => (consulta.trim() ? buscarIcones(consulta, 48).map((r) => r.nome) : SUGESTOES), [consulta]);
  const escolher = async (nome: string) => {
    if (await novoIcone(documento, doc, nome)) fechar();
  };
  return (
    <div ref={caixa} className="flutuante pop-trilho busca-icones" style={{top: 160}}>
      <label className="busca-icones-campo">
        <Search className="i14" />
        <input className="campo" autoFocus value={consulta} placeholder="balança, contrato, prazo…" aria-label="Buscar ícone"
          title="Em português ou em inglês. Enter insere o primeiro."
          onChange={(e) => setConsulta(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && nomes[0] ? void escolher(nomes[0]) : e.key === 'Escape' && fechar())} />
      </label>
      <div className="busca-icones-grade" role="listbox" aria-label="Ícones">
        {nomes.map((n) => (
          <button key={n} type="button" role="option" className="busca-icones-item" title={n} aria-label={n} onClick={() => void escolher(n)}><IconeSvg nome={n} tamanho={26} /></button>
        ))}
        {consulta.trim() && !nomes.length && <div className="vazio">Nenhum ícone para "{consulta.trim()}".</div>}
      </div>
    </div>
  );
};
