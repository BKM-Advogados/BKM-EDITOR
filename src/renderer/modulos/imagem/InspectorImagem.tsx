// Inspector da imagem: propriedades da camada selecionada (posição e tamanho, e as do tipo) ou, sem seleção, a
// prancheta (tamanho, fundo) e a pilha de efeitos numa linha. Cada campo grava um patch ao sair dele, ao soltar o
// controle ou ao fechar o seletor de cor; enquanto o controle mexe, o monitor mostra o valor pela prévia ao vivo.
// O "visível" não aparece aqui: é o olho da lista de camadas.
import React from 'react';
import {ChevronRight, Copy, FileJson, Image as IconeImagem, Link} from 'lucide-react';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, avisar, loja, patchTrocar, trocar, useLoja} from '../../estado/loja';
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoNumero, CampoSelecao, CampoTexto, Secao, copiar} from '../../componentes/Campos';
import {IconeEfeitos} from '../../componentes/Icones';
import {FONTES, PADRAO, caminhoNoProjeto, definirPrevia, docValido, indiceDe, rotuloCamada, usarDocumentoImagem} from './comum';
import {iconeCamada} from './CamadasImagem';

const PESOS: [string, string][] = ['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((p) => [p, p]);
const TIPOS: Record<CamadaImagem['tipo'], string> = {texto: 'Texto', forma: 'Forma', imagem: 'Imagem'};
const TAMANHOS: {nome: string; l: number; a: number}[] = [
  {nome: 'Instagram retrato', l: 1080, a: 1350},
  {nome: 'Quadrado', l: 1080, a: 1080},
  {nome: 'Story e Reels', l: 1080, a: 1920},
  {nome: 'LinkedIn', l: 1200, a: 627},
  {nome: 'A4 a 300 dpi', l: 2480, a: 3508},
];

const InspectorCamada: React.FC<{documento: string; caminho: string; c: CamadaImagem}> = ({documento, caminho, c}) => {
  const gravar = (campo: keyof CamadaImagem) => (v: unknown) => void trocar(documento, `${caminho}/${campo}`, v, `${campo} de ${c.id}`);
  const positivo = (campo: keyof CamadaImagem) => (v: number) => (v > 0 ? gravar(campo)(v) : avisar(`${campo} precisa ser maior que zero`, 'erro'));
  const ver = (campo: keyof CamadaImagem) => (valor: unknown) => definirPrevia({documento, caminho: `${caminho}/${campo}`, valor});
  const sub = c.tipo === 'texto' ? `Texto · ${c.fonte ?? PADRAO.fonte} ${c.peso ?? PADRAO.peso}` : c.tipo === 'imagem' ? `Imagem · ${c.src ?? ''}` : `Forma · ${c.forma === 'elipse' ? 'elipse' : 'retângulo'}`;

  return (
    <div className="painel">
      <CabecalhoInspector icone={iconeCamada(c)} familia={c.tipo === 'imagem' ? 'midia' : 'texto'} nome={rotuloCamada(c)} sub={sub} dica={`${c.id} · ${caminho}`}
        menu={[
          {rotulo: 'Copiar caminho', icone: <Link className="i14" />, acao: () => copiar(caminho, `Caminho ${caminho} copiado`)},
          {rotulo: 'Copiar id', icone: <Copy className="i14" />, acao: () => copiar(c.id, 'Id copiado')},
          {rotulo: 'Copiar JSON', icone: <FileJson className="i14" />, acao: () => copiar(JSON.stringify(c, null, 2), 'JSON copiado')},
        ]} />
      <div className="insp-corpo">
        <Secao titulo="Camada" chave="imagem:camada">
          <CampoTexto rotulo="Nome" valor={c.nome ?? ''} aoMudar={gravar('nome')} />
        </Secao>
        <Secao titulo="Posição e tamanho" chave="imagem:posicao"
          aoRedefinir={c.rotacao || (c.opacidade !== undefined && c.opacidade !== 1) ? () => {
            const atual = loja.get().docs[documento]?.doc;
            void aplicar(documento, [...patchTrocar(atual, `${caminho}/rotacao`, undefined), ...patchTrocar(atual, `${caminho}/opacidade`, undefined)], `giro e opacidade de ${c.id} voltam ao padrão`);
          } : undefined}>
          <CampoNumero rotulo="X" valor={c.x} unidade="px" aoMudar={gravar('x')} />
          <CampoNumero rotulo="Y" valor={c.y} unidade="px" aoMudar={gravar('y')} />
          <CampoNumero rotulo="Largura" valor={c.largura} unidade="px" aoMudar={positivo('largura')} />
          <CampoNumero rotulo="Altura" valor={c.altura} unidade="px" aoMudar={positivo('altura')} />
          <CampoNumero rotulo="Giro" valor={c.rotacao ?? 0} unidade="°" padrao={0} aoRedefinir={() => gravar('rotacao')(undefined)} aoMudar={gravar('rotacao')} />
          <CampoDeslizante rotulo="Opacidade" valor={c.opacidade ?? 1} min={0} max={1} passo={0.01} padrao={1} formatar={(v) => `${Math.round(v * 100)}%`}
            aoVer={ver('opacidade')} aoMudar={(v) => gravar('opacidade')(v === 1 ? undefined : v)} />
        </Secao>

        {c.tipo === 'texto' && (
          <Secao titulo="Texto" chave="imagem:texto">
            <CampoTexto rotulo="Texto" valor={c.texto ?? ''} multilinha dica="Enter quebra a linha; grava ao sair do campo ou com Ctrl+Enter" aoMudar={gravar('texto')} />
            <CampoSelecao rotulo="Fonte" valor={c.fonte ?? PADRAO.fonte} opcoes={FONTES.map((f) => [f, f] as [string, string])} aoMudar={gravar('fonte')} />
            <CampoSelecao rotulo="Peso" valor={String(c.peso ?? PADRAO.peso)} opcoes={PESOS} aoMudar={(v) => gravar('peso')(Number(v))} />
            <CampoNumero rotulo="Tamanho" valor={c.tamanho ?? PADRAO.tamanho} unidade="px" padrao={PADRAO.tamanho} aoRedefinir={() => gravar('tamanho')(undefined)} aoMudar={positivo('tamanho')} />
            <CampoCor rotulo="Cor" valor={c.cor ?? PADRAO.cor} aoVer={ver('cor')} aoMudar={gravar('cor')} />
            <CampoSelecao rotulo="Alinhar" valor={c.alinhar ?? PADRAO.alinhar} opcoes={[['esquerda', 'À esquerda'], ['centro', 'Ao centro'], ['direita', 'À direita']]} aoMudar={gravar('alinhar')} />
          </Secao>
        )}

        {c.tipo === 'forma' && (
          <Secao titulo="Forma" chave="imagem:forma">
            <CampoSelecao rotulo="Forma" valor={c.forma ?? 'retangulo'} opcoes={[['retangulo', 'Retângulo'], ['elipse', 'Elipse']]} aoMudar={gravar('forma')} />
            <CampoCor rotulo="Preenchimento" valor={c.preenchimento ?? PADRAO.preenchimento} aoVer={ver('preenchimento')} aoMudar={gravar('preenchimento')} />
            {c.forma !== 'elipse' && (
              <CampoNumero rotulo="Raio" valor={c.raio ?? PADRAO.raio} unidade="px" padrao={PADRAO.raio} aoRedefinir={() => gravar('raio')(undefined)}
                aoMudar={(v) => (v >= 0 ? gravar('raio')(v) : avisar('o raio não pode ser negativo', 'erro'))} />
            )}
          </Secao>
        )}

        {c.tipo === 'imagem' && (
          <Secao titulo="Imagem" chave="imagem:imagem">
            <CampoTexto rotulo="Arquivo" valor={c.src ?? ''} dica="caminho dentro da pasta do projeto, ex.: midia/logo-exemplo.png"
              invalido={(v) => (caminhoNoProjeto(v) ? null : 'use um caminho dentro do projeto')} aoMudar={(v) => gravar('src')(caminhoNoProjeto(v))} />
            <CampoSelecao rotulo="Ajuste" valor={c.ajuste ?? PADRAO.ajuste} opcoes={[['cobrir', 'Cobrir (corta)'], ['conter', 'Conter (inteira)']]} aoMudar={gravar('ajuste')} />
          </Secao>
        )}
      </div>
    </div>
  );
};

const InspectorDocumento: React.FC<{documento: string; doc: DocImagem; versao: string}> = ({documento, doc, versao}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const efeitos = doc.efeitos ?? [];
  const ligados = efeitos.filter((e) => e.ativo !== false).length;
  const positivo = (campo: 'largura' | 'altura') => (v: number) =>
    v > 0 ? void trocar(documento, `/${campo}`, Math.round(v), `${campo} da imagem`) : avisar(`${campo} precisa ser maior que zero`, 'erro');
  const pronto = TAMANHOS.find((t) => t.l === doc.largura && t.a === doc.altura);
  const tamanho = (l: number, a: number, rotulo: string) => {
    const atual = loja.get().docs[documento]?.doc;
    const patch: OperacaoPatch[] = [...(l !== doc.largura ? patchTrocar(atual, '/largura', l) : []), ...(a !== doc.altura ? patchTrocar(atual, '/altura', a) : [])];
    void aplicar(documento, patch, rotulo);
  };
  return (
    <div className="painel">
      <CabecalhoInspector icone={<IconeImagem />} nome={titulo} sub={`Imagem · ${doc.largura} × ${doc.altura}`} dica={`versão ${versao} · ${doc.camadas.length} camadas`}
        menu={[{rotulo: 'Copiar versão', icone: <Copy className="i14" />, acao: () => copiar(versao, 'Versão copiada')}]} />
      <div className="insp-corpo">
        <Secao titulo="Prancheta" chave="imagem:prancheta">
          <CampoSelecao rotulo="Tamanho" valor={pronto ? `${pronto.l}x${pronto.a}` : 'outro'}
            opcoes={[...TAMANHOS.map((t) => [`${t.l}x${t.a}`, `${t.nome} · ${t.l} × ${t.a}`] as [string, string]), ['outro', 'Personalizado']]}
            aoMudar={(v) => {
              const t = TAMANHOS.find((x) => `${x.l}x${x.a}` === v);
              if (t) tamanho(t.l, t.a, `tamanho da imagem: ${t.nome}`);
            }} />
          <CampoNumero rotulo="Largura" valor={doc.largura} unidade="px" aoMudar={positivo('largura')} />
          <CampoNumero rotulo="Altura" valor={doc.altura} unidade="px" aoMudar={positivo('altura')} />
          <CampoCor rotulo="Fundo" valor={doc.fundo} aoVer={(valor) => definirPrevia({documento, caminho: '/fundo', valor})}
            aoMudar={(v) => void trocar(documento, '/fundo', v, 'fundo da imagem')} />
        </Secao>
        <section className="secao">
          <div className="secao-titulo" role="button" tabIndex={0} title="Editar a pilha na área Efeitos (4)"
            onClick={() => loja.definir({area: 'efeitos', alvoEfeitos: documento, selecao: null})}
            onKeyDown={(e) => e.key === 'Enter' && loja.definir({area: 'efeitos', alvoEfeitos: documento, selecao: null})}>
            <IconeEfeitos className="i12" />Efeitos ({efeitos.length})
            <span className="acao-secao" style={{color: 'var(--texto-3)'}}>{efeitos.length > 0 && `${ligados} ${ligados === 1 ? 'ligado' : 'ligados'} · `}Abrir em Efeitos<ChevronRight className="i12" /></span>
          </div>
        </section>
        <div className="vazio">Clique numa camada no monitor ou na lista para editar.</div>
      </div>
    </div>
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

export {TIPOS as TIPOS_CAMADA};
