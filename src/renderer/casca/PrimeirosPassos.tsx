// Primeiros passos (Onda B): uma ficha discreta na barra do editor ("Primeiros passos · 2 de 5") que abre um cartão com
// a lista. Não é tutorial nem modal: o cartão não bloqueia nada, fecha no ×, na ficha, com Esc ou ao clicar fora, e abre sozinho só na
// primeira vez (nenhum passo feito). Cada passo se marca pelo estado do projeto ou do editor (nucleo/primeiros-passos.ts),
// nunca por clique aqui. Some ao concluir ou com "Não mostrar mais"; as Preferências trazem de volta.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Check, Circle, ListChecks, X} from 'lucide-react';
import {andamentoPassos, juntarPassos, mostrarPassos, PASSOS, passosFeitosAgora} from '../../nucleo/primeiros-passos';
import type {Modulo} from '../../nucleo/documentos';
import {avisar, useLoja} from '../estado/loja';
import {carregarPassos, definirPassos, useFatosDoEditor, usePassos} from '../estado/primeiros-passos';
import {carregarMidia, recarregarMidiaEmBreve, useMidia} from '../paineis/midia-estado';
import {usarFora} from '../componentes/Menu';

export const PrimeirosPassos: React.FC = () => {
  const raiz = useLoja((e) => e.info?.raiz);
  const entradas = useLoja((e) => e.info?.manifesto.documentos);
  const docs = useLoja((e) => e.docs);
  const diario = useLoja((e) => e.diario);
  const midias = useMidia((s) => s.indice?.total ?? 0);
  const editor = useFatosDoEditor();
  const estado = usePassos();
  const [aberto, setAberto] = useState(false);
  const abriuSozinho = useRef(false);
  const caixa = usarFora(aberto, () => setAberto(false)); // clicar fora ou Esc fecha o cartão; a ficha fica

  useEffect(() => void carregarPassos(), []);
  // a lista de midia/ (a mesma do painel Mídia), relida quando um arquivo de lá muda
  useEffect(() => {
    if (!raiz) return;
    void carregarMidia();
    return window.estudio.aoMudar(({arquivo}) => {
      if (arquivo.startsWith('midia/')) recarregarMidiaEmBreve();
    });
  }, [raiz]);

  const agora = useMemo(() => {
    const modulo = new Map((entradas ?? []).map((d) => [d.id, d.modulo] as [string, Modulo]));
    const documentos = Object.entries(docs).flatMap(([id, l]) => (modulo.has(id) ? [{modulo: modulo.get(id)!, doc: l.doc}] : []));
    return passosFeitosAgora({midias, documentos, diario, tocou: editor.tocou, exportou: editor.exportou});
  }, [entradas, docs, diario, midias, editor]);

  useEffect(() => {
    if (!estado) return;
    // na primeira vez (nada feito ainda), o cartão abre sozinho uma vez
    if (!abriuSozinho.current) {
      abriuSozinho.current = true;
      if (mostrarPassos(estado) && !estado.feitos.length) setAberto(true);
    }
    const novo = juntarPassos(estado, agora);
    if (novo === estado) return;
    definirPassos(novo);
    if (!novo.dispensado && !mostrarPassos(novo)) avisar('Primeiros passos concluídos. A lista sai da barra.', 'ok');
  }, [estado, agora]);

  if (!estado || !mostrarPassos(estado)) return null;
  const feitos = new Set(estado.feitos);
  const proximo = PASSOS.find((p) => !feitos.has(p.id));
  return (
    <div className="passos" ref={caixa}>
      <button className={`bt passos-bt${aberto ? ' ligado' : ''}`} onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        title={`Primeiros passos: ${andamentoPassos(estado)}${proximo ? `. Próximo: ${proximo.titulo.toLowerCase()}` : ''}`}>
        <ListChecks size={14} /><span className="passos-nome">Primeiros passos</span><span className="passos-n">{andamentoPassos(estado)}</span>
      </button>
      {aberto && (
        <section className="flutuante passos-cartao" aria-label="Primeiros passos">
          <header>
            <b>Primeiros passos</b>
            <span className="passos-n">{andamentoPassos(estado)}</span>
            <button className="bti" onClick={() => setAberto(false)} title="Fechar (a ficha continua na barra)" aria-label="Fechar os primeiros passos"><X size={14} /></button>
          </header>
          <ol>
            {PASSOS.map((p) => {
              const ok = feitos.has(p.id);
              return (
                <li key={p.id} className={`${ok ? 'feito' : ''}${p === proximo ? ' proximo' : ''}`}>
                  <span className="passos-marca" role="img" aria-label={ok ? 'feito' : 'a fazer'}>{ok ? <Check size={12} /> : <Circle size={12} />}</span>
                  <span>
                    <span className="passos-titulo">{p.titulo}</span>
                    {!ok && <span className="passos-dica">{p.dica}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          <footer>
            <span>Cada passo se marca sozinho quando você faz.</span>
            <button className="bt fantasma mini" onClick={() => {
              setAberto(false);
              definirPassos({...estado, dispensado: true});
              avisar('Os primeiros passos saíram da barra. Para ver de novo: menu Estúdio › Preferências.', 'info');
            }}>Não mostrar mais</button>
          </footer>
        </section>
      )}
    </div>
  );
};
