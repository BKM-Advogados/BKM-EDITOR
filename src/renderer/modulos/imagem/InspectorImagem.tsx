// Inspector da imagem: propriedades da camada selecionada (posição, tamanho, giro, opacidade e as do tipo) ou, sem
// seleção, as do documento. Cada campo grava um patch ao sair dele, ao soltar o controle ou ao fechar o seletor de cor;
// enquanto o controle mexe, o monitor mostra o valor pela prévia ao vivo.
import React, {useEffect, useRef, useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {CamadaImagem, DocImagem} from '../../../nucleo/documentos';
import {avisar, loja, trocar, useLoja} from '../../estado/loja';
import {CampoDeslizante, CampoNumero, CampoTexto, Secao} from '../../componentes/Campos';
import {FONTES, PADRAO, caminhoNoProjeto, definirPrevia, docValido, indiceDe, usarDocumentoImagem, visivel} from './comum';

const PESOS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
const TIPOS: Record<CamadaImagem['tipo'], string> = {texto: 'Texto', forma: 'Forma', imagem: 'Imagem'};

const Seletor: React.FC<{rotulo: string; valor: string; opcoes: [string, string][]; aoMudar: (v: string) => void}> = ({rotulo, valor, opcoes, aoMudar}) => (
  <label className="linha-campo">
    <span>{rotulo}</span>
    <select className="campo" value={valor} onChange={(e) => aoMudar(e.target.value)}>
      {!opcoes.some(([v]) => v === valor) && <option value={valor}>{valor}</option>}
      {opcoes.map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
    </select>
  </label>
);

/** Cor com seletor e texto. O seletor só grava no "change" nativo, quando fecha (o onChange do React dispara a cada
 *  movimento); o texto aceita qualquer cor CSS e grava ao sair do campo ou com Enter. */
const CampoCorGesto: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; aoVer?: (v: string) => void}> = ({rotulo, valor, aoMudar, aoVer}) => {
  const seletor = useRef<HTMLInputElement>(null);
  const atual = useRef({valor, aoMudar});
  atual.current = {valor, aoMudar};
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  useEffect(() => {
    const el = seletor.current;
    if (!el) return;
    const fechar = () => {
      if (el.value.toLowerCase() !== atual.current.valor.toLowerCase()) atual.current.aoMudar(el.value.toUpperCase());
    };
    el.addEventListener('change', fechar);
    return () => el.removeEventListener('change', fechar);
  }, []);
  const gravarTexto = () => {
    const v = texto.trim();
    if (v && v !== valor && CSS.supports('color', v)) aoMudar(v);
    else setTexto(valor);
  };
  const hex = [texto, valor].find((v) => /^#[0-9a-f]{6}$/i.test(v)) ?? '#000000';
  return (
    <div className="linha-campo">
      <span>{rotulo}</span>
      <div style={{display: 'grid', gridTemplateColumns: '40px 1fr', gap: 6}}>
        <input ref={seletor} type="color" value={hex.toLowerCase()} onChange={(e) => {
          setTexto(e.target.value.toUpperCase());
          aoVer?.(e.target.value.toUpperCase());
        }} />
        <input className="campo" value={texto} style={{fontFamily: 'var(--fonte-mono)'}} onChange={(e) => setTexto(e.target.value)}
          onBlur={gravarTexto} onKeyDown={(e) => e.key === 'Enter' && gravarTexto()} />
      </div>
    </div>
  );
};

const InspectorCamada: React.FC<{documento: string; caminho: string; c: CamadaImagem}> = ({documento, caminho, c}) => {
  const gravar = (campo: keyof CamadaImagem) => (v: unknown) => void trocar(documento, `${caminho}/${campo}`, v, `${campo} de ${c.id}`);
  const positivo = (campo: keyof CamadaImagem) => (v: number) => (v > 0 ? gravar(campo)(v) : avisar(`${campo} precisa ser maior que zero`, 'erro'));
  const ver = (campo: keyof CamadaImagem) => (valor: unknown) => definirPrevia({documento, caminho: `${caminho}/${campo}`, valor});

  return (
    <div className="painel"><div className="painel-corpo">
      <Secao titulo={`${TIPOS[c.tipo] ?? c.tipo} · ${c.id}`}>
        <div className="rotulo" style={{textTransform: 'none', marginBottom: 8, fontFamily: 'var(--fonte-mono)'}}>{caminho}</div>
        <CampoTexto rotulo="nome" valor={c.nome ?? ''} aoMudar={gravar('nome')} />
        <CampoNumero rotulo="x" valor={c.x} aoMudar={gravar('x')} />
        <CampoNumero rotulo="y" valor={c.y} aoMudar={gravar('y')} />
        <CampoNumero rotulo="largura" valor={c.largura} aoMudar={positivo('largura')} />
        <CampoNumero rotulo="altura" valor={c.altura} aoMudar={positivo('altura')} />
        <CampoNumero rotulo="rotação (°)" valor={c.rotacao} padrao={0} aoMudar={gravar('rotacao')} />
        <CampoDeslizante rotulo="opacidade" valor={c.opacidade ?? 1} min={0} max={1} passo={0.01} aoVer={ver('opacidade')} aoMudar={gravar('opacidade')} />
        <label className="linha-campo">
          <span>visível</span>
          <input type="checkbox" checked={visivel(c)} onChange={(e) => gravar('visivel')(e.target.checked ? undefined : false)} />
        </label>
      </Secao>

      {c.tipo === 'texto' && (
        <Secao titulo="Texto">
          <CampoTexto rotulo="texto" valor={c.texto ?? ''} multilinha dica="Enter quebra a linha; grava ao sair do campo ou com Ctrl+Enter" aoMudar={gravar('texto')} />
          <Seletor rotulo="fonte" valor={c.fonte ?? PADRAO.fonte} opcoes={FONTES.map((f) => [f, f])} aoMudar={gravar('fonte')} />
          <CampoNumero rotulo="tamanho (px)" valor={c.tamanho} padrao={PADRAO.tamanho} aoMudar={positivo('tamanho')} />
          <Seletor rotulo="peso" valor={String(c.peso ?? PADRAO.peso)} opcoes={PESOS.map((p) => [p, p])} aoMudar={(v) => gravar('peso')(Number(v))} />
          <CampoCorGesto rotulo="cor" valor={c.cor ?? PADRAO.cor} aoVer={ver('cor')} aoMudar={gravar('cor')} />
          <Seletor rotulo="alinhar" valor={c.alinhar ?? PADRAO.alinhar} opcoes={[['esquerda', 'esquerda'], ['centro', 'centro'], ['direita', 'direita']]} aoMudar={gravar('alinhar')} />
        </Secao>
      )}

      {c.tipo === 'forma' && (
        <Secao titulo="Forma">
          <Seletor rotulo="forma" valor={c.forma ?? 'retangulo'} opcoes={[['retangulo', 'retângulo'], ['elipse', 'elipse']]} aoMudar={gravar('forma')} />
          <CampoCorGesto rotulo="preenchimento" valor={c.preenchimento ?? PADRAO.preenchimento} aoVer={ver('preenchimento')} aoMudar={gravar('preenchimento')} />
          {c.forma !== 'elipse' && (
            <CampoNumero rotulo="raio (px)" valor={c.raio} padrao={PADRAO.raio}
              aoMudar={(v) => (v >= 0 ? gravar('raio')(v) : avisar('o raio não pode ser negativo', 'erro'))} />
          )}
        </Secao>
      )}

      {c.tipo === 'imagem' && (
        <Secao titulo="Imagem">
          <CampoTexto rotulo="arquivo" valor={c.src ?? ''} dica="caminho dentro da pasta do projeto, ex.: midia/logo-exemplo.png"
            invalido={(v) => (caminhoNoProjeto(v) ? null : 'use um caminho dentro do projeto')} aoMudar={(v) => gravar('src')(caminhoNoProjeto(v))} />
          <Seletor rotulo="ajuste" valor={c.ajuste ?? PADRAO.ajuste} opcoes={[['cobrir', 'cobrir (corta)'], ['conter', 'conter (inteira)']]} aoMudar={gravar('ajuste')} />
        </Secao>
      )}
    </div></div>
  );
};

const InspectorDocumento: React.FC<{documento: string; doc: DocImagem; versao: string}> = ({documento, doc, versao}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const efeitos = doc.efeitos ?? [];
  const ligados = efeitos.filter((e) => e.ativo !== false).length;
  const positivo = (campo: 'largura' | 'altura') => (v: number) =>
    v > 0 ? void trocar(documento, `/${campo}`, Math.round(v), `${campo} da imagem`) : avisar(`${campo} precisa ser maior que zero`, 'erro');
  return (
    <div className="painel"><div className="painel-corpo">
      <Secao titulo={`Imagem · ${titulo}`}>
        <CampoNumero rotulo="largura (px)" valor={doc.largura} aoMudar={positivo('largura')} />
        <CampoNumero rotulo="altura (px)" valor={doc.altura} aoMudar={positivo('altura')} />
        <CampoCorGesto rotulo="fundo" valor={doc.fundo} aoVer={(valor) => definirPrevia({documento, caminho: '/fundo', valor})}
          aoMudar={(v) => void trocar(documento, '/fundo', v, 'fundo da imagem')} />
        <div className="linha-campo"><span>camadas</span><span>{doc.camadas.length}</span></div>
        <div className="linha-campo"><span>versão</span><span style={{fontFamily: 'var(--fonte-mono)'}}>{versao}</span></div>
      </Secao>
      <Secao titulo="Efeitos" acao={
        <button className="bt fantasma mini" onClick={() => loja.definir({area: 'efeitos', alvoEfeitos: documento, selecao: null})} title="Editar a pilha na área Efeitos (4)">
          <Sparkles size={12} />Abrir em Efeitos
        </button>
      }>
        <div style={{color: 'var(--texto-2)', fontSize: 12}}>
          {efeitos.length === 0 ? 'Nenhum efeito.' : `${efeitos.length} ${efeitos.length === 1 ? 'efeito' : 'efeitos'} na pilha (${ligados} ${ligados === 1 ? 'ligado' : 'ligados'}).`}
          {' '}Os efeitos são editados na área Efeitos.
        </div>
      </Secao>
      <div className="vazio">Clique numa camada no monitor ou na lista para editar.</div>
    </div></div>
  );
};

export const InspectorImagem: React.FC = () => {
  const documento = usarDocumentoImagem();
  const lido = useLoja((e) => (documento ? e.docs[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  if (!documento || !lido) return <div className="vazio">nenhuma imagem</div>;
  const doc = lido.doc as DocImagem;
  if (!docValido(doc)) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas"</div>;
  const caminho = selecao?.documento === documento && indiceDe(selecao.caminho) >= 0 ? selecao.caminho : null;
  const c = caminho ? doc.camadas[indiceDe(caminho)] : undefined;
  if (caminho && c) return <InspectorCamada key={caminho} documento={documento} caminho={caminho} c={c} />;
  return <InspectorDocumento documento={documento} doc={doc} versao={lido.versao} />;
};
