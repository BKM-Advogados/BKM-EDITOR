// Propriedades do vídeo de cenas, com nomes de quem edita. Sem seleção: o formato (trocar 9:16 por 16:9 não desmonta
// nada, porque a posição é relativa ao quadro) e as cores do tema. Cena: nome, duração e fundo. Bloco: conteúdo,
// tempo (segundos na cena), posição e tamanho em % do quadro e a letra em px do formato atual.
import React from 'react';
import {Clapperboard, CopyPlus, Film, FileJson, ImagePlus, Link, Trash2} from 'lucide-react';
import {TIPOS_BLOCO_CENAS, type BlocoCenas, type CenaCenas, type DocCenas} from '../../../nucleo/cenas';
import {FORMATOS_VIDEO, formatoDoVideo, rotuloFormato} from '../../../nucleo/formatos';
import {avisar, mensagemDe, trocar, useLoja, valorEm} from '../../estado/loja';
import {CabecalhoInspector, CampoCor, CampoLeitura, CampoNumero, CampoSelecao, CampoTexto, Secao, copiar, numeroBr} from '../../componentes/Campos';
import type {ItemMenu} from '../../componentes/Menu';
import {formatarTempo} from './tocador';
import {resumoBloco, tipoDe} from './tipos';
import {duplicarSelecao, excluirSelecao} from './acoes';

const pct = (v: number | undefined, padrao: number) => Math.round((v ?? padrao) * 1000) / 10;
const ALINHAR: [NonNullable<BlocoCenas['alinhar']>, string][] = [['esquerda', 'Esquerda'], ['centro', 'Centro'], ['direita', 'Direita']];
const PESOS: [string, string][] = [['400', 'Normal'], ['500', 'Médio'], ['600', 'Seminegrito'], ['700', 'Negrito'], ['800', 'Extranegrito']];

const ResumoVideo: React.FC<{documento: string; doc: DocCenas; titulo: string; duracao: number; avisos: string[]; erro?: string}> = ({documento, doc, titulo, duracao, avisos, erro}) => {
  const f = formatoDoVideo(doc);
  const preset = FORMATOS_VIDEO.find((p) => p.largura === f.largura && p.altura === f.altura);
  const tema = doc.tema ?? {};
  const nBlocos = doc.cenas.reduce((n, c) => n + (c.blocos?.length ?? 0), 0);
  return (
    <div className="painel">
      <CabecalhoInspector icone={<Film />} nome={titulo} sub="Vídeo de cenas" dica={rotuloFormato(f)} />
      <div className="insp-corpo">
        <div className="resumo">
          {rotuloFormato(f)} · {formatarTempo(duracao)}<br />
          <b>{doc.cenas.length}</b> {doc.cenas.length === 1 ? 'cena' : 'cenas'} · <b>{nBlocos}</b> {nBlocos === 1 ? 'bloco' : 'blocos'}
        </div>
        <Secao titulo="Formato" chave="cenas:formato">
          <CampoSelecao rotulo="Destino" valor={preset?.id ?? 'livre'}
            opcoes={[...FORMATOS_VIDEO.map((p): [string, string] => [p.id, `${p.nome} · ${p.proporcao}`]), ...(preset ? [] : [['livre', `${f.largura}×${f.altura}`] as [string, string]])]}
            aoMudar={(id) => {
              const p = FORMATOS_VIDEO.find((x) => x.id === id);
              if (p) void trocar(documento, '/formato', {...f, largura: p.largura, altura: p.altura}, `formato ${p.proporcao}`);
            }} />
          <CampoSelecao rotulo="Quadros por segundo" valor={String(f.fps)} opcoes={['24', '25', '30', '50', '60'].map((n): [string, string] => [n, n])}
            aoMudar={(n) => void trocar(documento, '/formato', {...f, fps: Number(n)}, `${n} quadros por segundo`)} />
        </Secao>
        <Secao titulo="Cores" chave="cenas:cores">
          <CampoCor rotulo="Fundo" valor={tema.fundo ?? '#111418'} aoMudar={(v) => void trocar(documento, '/tema/fundo', v, 'cor de fundo')} />
          <CampoCor rotulo="Texto" valor={tema.texto ?? '#F2F2F2'} aoMudar={(v) => void trocar(documento, '/tema/texto', v, 'cor do texto')} />
          <CampoCor rotulo="Destaque" valor={tema.destaque ?? '#70B8FF'} aoMudar={(v) => void trocar(documento, '/tema/destaque', v, 'cor de destaque')} />
          <CampoCor rotulo="Texto suave" valor={tema.suave ?? '#A3ABB5'} aoMudar={(v) => void trocar(documento, '/tema/suave', v, 'cor do texto suave')} />
        </Secao>
        {erro && <Secao titulo="Não deu para montar o vídeo"><div className="texto-livre" style={{color: 'var(--erro)'}}>{erro}</div></Secao>}
        {avisos.length > 0 && <Secao titulo={`Avisos (${avisos.length})`}><div className="avisos-roteiro">{avisos.map((a, i) => <div key={i}>{a}</div>)}</div></Secao>}
        <div className="vazio">Clique num bloco no monitor, na lista ou na linha do tempo para editar. "**trecho**" no texto sai na cor de destaque.</div>
      </div>
    </div>
  );
};

const PropsCena: React.FC<{documento: string; caminho: string; c: CenaCenas; n: number; menu: ItemMenu[]}> = ({documento, caminho, c, n, menu}) => (
  <div className="painel">
    <CabecalhoInspector icone={<Clapperboard />} nome={c.nome || `Cena ${n}`} sub={`Cena ${n} · ${numeroBr((c.duracao_ms ?? 0) / 1000, 1)} s`} dica={caminho} menu={menu} />
    <div className="insp-corpo">
      <Secao titulo="Cena" chave="cenas:cena">
        <CampoTexto rotulo="Nome" valor={c.nome ?? ''} aoMudar={(v) => void trocar(documento, `${caminho}/nome`, v || undefined, 'nome da cena')} />
        <CampoNumero rotulo="Duração" unidade="s" passo={0.1} valor={(c.duracao_ms ?? 4000) / 1000}
          aoMudar={(v) => (v >= 0.3 ? void trocar(documento, `${caminho}/duracao_ms`, Math.round(v * 1000), `duração: ${numeroBr(v, 1)} s`) : avisar('A cena precisa de pelo menos 0,3 s', 'erro'))} />
        <CampoCor rotulo="Fundo" valor={c.fundo ?? ''} aoMudar={(v) => void trocar(documento, `${caminho}/fundo`, v, 'fundo da cena')} />
      </Secao>
      <div className="vazio">Arraste a ponta azul da cena na linha do tempo para mudar a duração.</div>
    </div>
  </div>
);

const PropsBloco: React.FC<{documento: string; caminho: string; b: BlocoCenas; formato: {largura: number; altura: number}; durCena: number; menu: ItemMenu[]; sub: string}> =
  ({documento, caminho, b, formato, durCena, menu, sub}) => {
    const t = tipoDe(b.tipo);
    const Icone = t.icone;
    const padrao = TIPOS_BLOCO_CENAS[b.tipo] ?? TIPOS_BLOCO_CENAS.texto;
    const menor = Math.min(formato.largura, formato.altura);
    const campo = (k: keyof BlocoCenas, rotulo: string) => (v: unknown) => void trocar(documento, `${caminho}/${k}`, v, `${rotulo} do bloco`);
    const fracao = (k: 'x' | 'y' | 'largura' | 'altura', rotulo: string, p: number) => (
      <CampoNumero rotulo={rotulo} unidade="%" passo={1} valor={pct(b[k], p)} aoMudar={(v) => campo(k, rotulo.toLowerCase())(Math.round(v * 10) / 1000)} />
    );
    const escolherImagem = async () => {
      try {
        const src = await window.estudio.escolherMidia('imagem');
        if (src) await trocar(documento, `${caminho}/src`, src, 'imagem do bloco');
      } catch (e) {
        avisar(mensagemDe(e), 'erro');
      }
    };
    return (
      <div className="painel">
        <CabecalhoInspector icone={<Icone />} familia={t.familia} nome={[t.nome, resumoBloco(b, 28)].filter(Boolean).join(' · ')} sub={sub} dica={b.id} menu={menu} />
        <div className="insp-corpo">
          <Secao titulo="Conteúdo" chave="cenas:conteudo">
            {(b.tipo === 'titulo' || b.tipo === 'texto') && <CampoTexto rotulo="Texto" multilinha valor={b.texto ?? ''} aoMudar={campo('texto', 'texto')} />}
            {b.tipo === 'lista' && <CampoTexto rotulo="Itens (um por linha)" multilinha valor={(b.itens ?? []).join('\n')}
              aoMudar={(v) => campo('itens', 'itens')(v.split('\n').map((x) => x.trim()).filter(Boolean))} />}
            {b.tipo === 'numero' && (
              <>
                <CampoNumero rotulo="Conta de" valor={b.de ?? 0} aoMudar={campo('de', 'início da contagem')} />
                <CampoNumero rotulo="Conta até" valor={b.ate ?? 0} aoMudar={campo('ate', 'fim da contagem')} />
                <CampoTexto rotulo="Antes" valor={b.prefixo ?? ''} aoMudar={(v) => campo('prefixo', 'prefixo')(v || undefined)} />
                <CampoTexto rotulo="Depois" valor={b.sufixo ?? ''} aoMudar={(v) => campo('sufixo', 'sufixo')(v || undefined)} />
                <CampoTexto rotulo="Legenda" valor={b.rotulo ?? ''} aoMudar={(v) => campo('rotulo', 'legenda')(v || undefined)} />
              </>
            )}
            {b.tipo === 'imagem' && (
              <>
                <CampoLeitura rotulo="Arquivo">{b.src ? b.src.split('/').pop() : 'nenhum'}</CampoLeitura>
                <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => void escolherImagem()}><ImagePlus size={14} />{b.src ? 'Trocar imagem…' : 'Escolher imagem…'}</button></div>
                <CampoSelecao rotulo="Encaixe" valor={b.ajuste ?? 'conter'} opcoes={[['conter', 'Inteira'], ['cobrir', 'Preencher']]} aoMudar={campo('ajuste', 'encaixe')} />
              </>
            )}
          </Secao>
          <Secao titulo="Tempo" chave="cenas:tempo">
            <CampoNumero rotulo="Entra" unidade="s" passo={0.1} valor={(b.em ?? 0) / 1000}
              aoMudar={(v) => campo('em', 'entrada')(Math.max(0, Math.min(durCena - 100, Math.round(v * 1000))))} />
            <CampoNumero rotulo="Sai" unidade="s" passo={0.1} valor={(b.sai ?? durCena) / 1000} padrao={durCena / 1000}
              aoRedefinir={b.sai !== undefined ? () => campo('sai', 'saída')(undefined) : undefined}
              aoMudar={(v) => campo('sai', 'saída')(v * 1000 >= durCena ? undefined : Math.max((b.em ?? 0) + 100, Math.round(v * 1000)))} />
          </Secao>
          <Secao titulo="Posição e tamanho" chave="cenas:posicao">
            {fracao('x', 'X', 0.1)}
            {fracao('y', 'Y', 0.4)}
            {fracao('largura', 'Largura', 0.8)}
            {b.tipo === 'imagem' && fracao('altura', 'Altura', 0.4)}
            {b.tipo !== 'imagem' && (
              <CampoNumero rotulo="Letra" unidade="px" valor={Math.round((b.tam ?? padrao.tam) * menor)} padrao={Math.round(padrao.tam * menor)}
                aoRedefinir={b.tam !== undefined ? () => campo('tam', 'tamanho da letra')(undefined) : undefined}
                aoMudar={(v) => (v > 4 ? campo('tam', 'tamanho da letra')(Math.round((v / menor) * 10000) / 10000) : avisar('Letra muito pequena', 'erro'))} />
            )}
          </Secao>
          {b.tipo !== 'imagem' && (
            <Secao titulo="Estilo" chave="cenas:estilo">
              <CampoSelecao rotulo="Alinhar" valor={b.alinhar ?? 'centro'} opcoes={ALINHAR} aoMudar={campo('alinhar', 'alinhamento')} />
              <CampoSelecao rotulo="Peso" valor={String(b.peso ?? padrao.peso)} opcoes={PESOS} aoMudar={(v) => campo('peso', 'peso da letra')(Number(v))} />
              <CampoCor rotulo="Cor" valor={b.cor ?? ''} aoMudar={campo('cor', 'cor')} />
            </Secao>
          )}
        </div>
      </div>
    );
  };

export const InspectorCenas: React.FC<{documento: string}> = ({documento}) => {
  const lido = useLoja((e) => e.docs[documento]);
  const montado = useLoja((e) => e.props[documento]);
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const selecao = useLoja((e) => e.selecao);
  const doc = lido?.doc as DocCenas;
  const props = montado && 'props' in montado ? montado.props : null;
  const caminho = selecao?.documento === documento ? selecao.caminho : null;
  const m = caminho ? /^\/cenas\/(\d+)(?:\/blocos\/(\d+))?$/.exec(caminho) : null;
  const obj = caminho && m ? valorEm(doc, caminho) : undefined;
  if (!caminho || !m || !obj || typeof obj !== 'object') {
    return <ResumoVideo documento={documento} doc={doc} titulo={titulo} duracao={props?.duracao_ms ?? 0}
      avisos={montado && 'avisos' in montado ? montado.avisos : []} erro={montado && 'erro' in montado ? montado.erro : undefined} />;
  }
  const n = Number(m[1]) + 1;
  const cena = doc.cenas[Number(m[1])];
  const menu: ItemMenu[] = [
    {rotulo: 'Duplicar', icone: <CopyPlus className="i14" />, tecla: 'Ctrl+D', acao: () => void duplicarSelecao(documento)},
    {rotulo: 'Excluir', icone: <Trash2 className="i14" />, tecla: 'Delete', acao: () => void excluirSelecao(documento)},
    'sep',
    {rotulo: 'Copiar caminho', icone: <Link className="i14" />, acao: () => copiar(caminho, `Caminho ${caminho} copiado`)},
    {rotulo: 'Copiar JSON', icone: <FileJson className="i14" />, acao: () => copiar(JSON.stringify(obj, null, 2), 'JSON copiado')},
  ];
  if (m[2] === undefined) return <PropsCena documento={documento} caminho={caminho} c={obj as CenaCenas} n={n} menu={menu} />;
  return <PropsBloco documento={documento} caminho={caminho} b={obj as BlocoCenas} formato={formatoDoVideo(doc)} durCena={cena?.duracao_ms ?? 4000} menu={menu}
    sub={`Cena ${n}${cena?.nome ? ` · ${cena.nome}` : ''} · bloco ${Number(m[2]) + 1}`} />;
};

