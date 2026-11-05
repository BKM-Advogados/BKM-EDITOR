// Inspector do vídeo: as propriedades do objeto selecionado no roteiro (bloco, cena, linha do gancho), editáveis.
// Âncoras de tempo ("palavra@ms") são conferidas contra a narração antes de gravar.
import React, {useEffect, useState} from 'react';
import {lerAncora, norm, type Palavra} from '../../../nucleo/roteiro/resolver';
import {trocar, useLoja, valorEm} from '../../estado/loja';
import {CampoNumero, CampoTexto, Secao} from '../../componentes/Campos';
import {irPara} from './tocador';

const LONGOS = new Set(['texto', 'nota', 'titulo']);
const ANCORAS = new Set(['em', 'sai', 'inicio', 'depois_de']);
const OCULTOS = new Set(['id', 'tipo', 'origem', 'blocos', 'linhas', 'itens', 'barras', 'marcas', 'faixas', 'carimbo']);

const usarPalavras = (caminho?: string) => {
  const [p, setP] = useState<Palavra[]>([]);
  useEffect(() => {
    if (caminho) void window.estudio.lerJson<Palavra[]>(caminho).then(setP).catch(() => setP([]));
  }, [caminho]);
  return p;
};

const conferirAncora = (palavras: Palavra[]) => (v: string) => {
  if (!v.trim()) return null;
  try {
    const a = lerAncora(v);
    const alvo = norm(a.w);
    return palavras.some((p) => p.s >= a.ms && norm(p.w).startsWith(alvo)) ? null : `não há "${a.w}" depois de ${a.ms} ms na narração`;
  } catch (e) {
    return (e as Error).message;
  }
};

const Campos: React.FC<{documento: string; caminho: string; obj: Record<string, unknown>; palavras: Palavra[]}> = ({documento, caminho, obj, palavras}) => (
  <>
    {Object.entries(obj).filter(([k, v]) => !OCULTOS.has(k) && (typeof v === 'string' || typeof v === 'number')).map(([k, v]) =>
      typeof v === 'number' ? (
        <CampoNumero key={k} rotulo={k} valor={v} aoMudar={(n) => void trocar(documento, `${caminho}/${k}`, n)} />
      ) : (
        <CampoTexto key={k} rotulo={k} valor={v as string} multilinha={LONGOS.has(k) || (v as string).length > 40}
          invalido={ANCORAS.has(k) ? conferirAncora(palavras) : undefined}
          dica={ANCORAS.has(k) ? 'âncora na narração: palavra@ms (palavra$@ms = fim da palavra; +120 desloca)' : undefined}
          aoMudar={(t) => void trocar(documento, `${caminho}/${k}`, t)} />
      ))}
  </>
);

export const InspectorVideo: React.FC = () => {
  const documento = useLoja((e) => e.ativo.video);
  const lido = useLoja((e) => (documento ? e.docs[documento] : undefined));
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const palavras = usarPalavras((lido?.doc as {palavras?: string} | undefined)?.palavras);
  if (!documento || !lido) return <div className="vazio">nenhum vídeo</div>;
  const caminho = selecao?.documento === documento ? selecao.caminho : null;
  const obj = caminho ? (valorEm(lido.doc, caminho) as Record<string, unknown> | undefined) : undefined;

  if (!caminho || !obj) {
    const avisos = montado && 'avisos' in montado ? montado.avisos : [];
    return (
      <div className="painel"><div className="painel-corpo">
        <Secao titulo="Vídeo">
          <CampoTexto rotulo="rótulo das partes" valor={String(lido.doc.rotulo_partes ?? '')} aoMudar={(t) => void trocar(documento, '/rotulo_partes', t)} />
          <div className="linha-campo"><span>cenas</span><span>{lido.doc.cenas?.length ?? 0}</span></div>
          <div className="linha-campo"><span>versão</span><span style={{fontFamily: 'var(--fonte-mono)'}}>{lido.versao}</span></div>
        </Secao>
        {montado && 'erro' in montado && <Secao titulo="Erro no roteiro"><div style={{color: 'var(--erro)'}}>{montado.erro}</div></Secao>}
        {avisos.length > 0 && <Secao titulo={`Avisos do roteiro (${avisos.length})`}>{avisos.map((a, i) => <div key={i} style={{color: 'var(--comentario)', fontSize: 12, marginBottom: 4}}>{a}</div>)}</Secao>}
        <div className="vazio">Clique num bloco no monitor ou na linha do tempo para editar.</div>
      </div></div>
    );
  }

  const itens = (obj.itens ?? obj.linhas) as Record<string, unknown>[] | undefined;
  const chaveLista = obj.itens ? 'itens' : 'linhas';
  const emMs = (() => {
    const p = montado && 'props' in montado ? montado.props : null;
    const c = (p?.cenas as {origem?: string; t_in: number; blocos?: {origem?: string; em: number}[]}[] | undefined) ?? [];
    for (const cena of c) {
      if (cena.origem === caminho) return cena.t_in;
      const b = cena.blocos?.find((x) => x.origem === caminho);
      if (b) return b.em;
    }
    return undefined;
  })();

  return (
    <div className="painel"><div className="painel-corpo">
      <Secao titulo={`${String(obj.tipo ?? 'objeto')} · ${String(obj.id ?? caminho)}`}
        acao={emMs !== undefined ? <button className="bt fantasma mini" onClick={() => irPara(emMs)}>ir para o tempo</button> : undefined}>
        <div className="rotulo" style={{textTransform: 'none', marginBottom: 8, fontFamily: 'var(--fonte-mono)'}}>{caminho}</div>
        <Campos documento={documento} caminho={caminho} obj={obj} palavras={palavras} />
      </Secao>
      {itens && (
        <Secao titulo={chaveLista}>
          {itens.map((it, i) => (
            <div key={i} style={{borderLeft: '2px solid var(--borda-forte)', paddingLeft: 8, marginBottom: 8}}>
              <Campos documento={documento} caminho={`${caminho}/${chaveLista}/${i}`} obj={it} palavras={palavras} />
            </div>
          ))}
        </Secao>
      )}
    </div></div>
  );
};
