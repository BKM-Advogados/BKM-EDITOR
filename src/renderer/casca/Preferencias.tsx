// Preferências (menu → Preferências…, e o botão da tela inicial): a pasta dos projetos, o que abre ao iniciar e a
// aparência (tema, contraste, densidade, tamanho e movimento; estado/aparencia.ts) e as atualizações (docs/atualizacao.md).
import React, {useEffect, useState} from 'react';
import type {Preferencias} from '../../compartilhado/api';
import {aparencia, ESCALAS, usarAparencia} from '../estado/aparencia';
import {Segmentado} from '../componentes/Controles';
import {SecaoAtualizacoes} from '../componentes/AvisoAtualizacao';

/** Escolha de poucas opções num segmentado (Preferências). */
const Opcoes = <T extends string | number>({rotulo, valor, opcoes, aoMudar}: {rotulo: string; valor: T; opcoes: [T, string][]; aoMudar: (v: T) => void}) => (
  <div className="dialogo-campo">
    <span>{rotulo}</span>
    <Segmentado rotulo={rotulo} valor={valor} opcoes={opcoes} aoMudar={aoMudar} />
  </div>
);

export const PainelPreferencias: React.FC<{aoFechar: () => void}> = ({aoFechar}) => {
  const [p, setP] = useState<Preferencias | null>(null);
  const {escolha: ap} = usarAparencia();
  useEffect(() => void window.estudio.preferencias().then(setP), []);
  const gravar = async (m: Partial<Preferencias>) => setP(await window.estudio.gravarPreferencias(m));
  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && aoFechar()} onKeyDown={(e) => e.key === 'Escape' && aoFechar()}>
      <div className="dialogo preferencias" role="dialog" aria-label="Preferências">
        <div className="dialogo-titulo">Preferências</div>
        <div className="dialogo-secao">Projetos</div>
        {!p ? <div className="vazio">carregando…</div> : (
          <>
            <label className="dialogo-campo"><span>Pasta dos projetos novos</span>
              <span style={{display: 'flex', gap: 6}}>
                <input className="campo" readOnly value={p.pasta_projetos} title={p.pasta_projetos} />
                <button className="bt" onClick={async () => {
                  const pasta = await window.estudio.escolherPasta('Pasta dos projetos do Estúdio');
                  if (pasta) void gravar({pasta_projetos: pasta});
                }}>Trocar…</button>
              </span>
            </label>
            {/onedrive/i.test(p.pasta_projetos) && <div className="dialogo-texto" style={{color: 'var(--aviso)'}}>Pasta dentro do OneDrive: a sincronização pode travar a gravação.</div>}
            <Opcoes rotulo="Ao iniciar o Estúdio" valor={p.ao_iniciar} opcoes={[['inicio', 'Tela inicial'], ['ultimo', 'Último projeto']]}
              aoMudar={(v) => void gravar({ao_iniciar: v})} />
          </>
        )}
        <div className="dialogo-secao">Aparência</div>
        <Opcoes rotulo="Tema" valor={ap.tema} opcoes={[['sistema', 'Do sistema'], ['escuro', 'Escuro'], ['claro', 'Claro']]} aoMudar={(tema) => aparencia.definir({tema})} />
        <Opcoes rotulo="Contraste" valor={ap.contraste} opcoes={[['sistema', 'Do sistema'], ['normal', 'Normal'], ['alto', 'Alto']]} aoMudar={(contraste) => aparencia.definir({contraste})} />
        <Opcoes rotulo="Densidade" valor={ap.densidade} opcoes={[['auto', 'Pela janela'], ['confortavel', 'Confortável'], ['compacta', 'Compacta']]}
          aoMudar={(densidade) => aparencia.definir({densidade})} />
        <Opcoes rotulo="Tamanho da interface" valor={ap.escala} opcoes={ESCALAS.map((e): [number, string] => [e, `${Math.round(e * 100)}%`])} aoMudar={(escala) => aparencia.definir({escala})} />
        <Opcoes rotulo="Movimento" valor={ap.movimento} opcoes={[['sistema', 'Do sistema'], ['reduzido', 'Reduzir'], ['normal', 'Normal']]} aoMudar={(movimento) => aparencia.definir({movimento})} />
        <div className="dialogo-texto">"Pela janela" usa a densidade compacta abaixo de 1600 × 800. A aparência vale para este computador.</div>
        {p && <SecaoAtualizacoes automatico={p.procurar_atualizacoes !== false} aoMudar={(v) => void gravar({procurar_atualizacoes: v})} />}
        <div className="dialogo-botoes"><button className="bt principal" onClick={aoFechar} autoFocus>Fechar</button></div>
      </div>
    </div>
  );
};

