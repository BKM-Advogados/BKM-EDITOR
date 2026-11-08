// Inspector da imagem: propriedades da camada selecionada (posição e tamanho, e as do tipo) ou, sem seleção, a
// prancheta (tamanho, fundo, comum a todas as páginas), a página ativa (nome) quando há várias e a pilha de efeitos
// numa linha. Cada campo grava um patch ao sair dele, ao soltar o controle ou ao fechar o seletor de cor; enquanto o
// controle mexe, o monitor mostra o valor pela prévia ao vivo. O "visível" não aparece aqui: é o olho da lista. Abaixo
// das propriedades do tipo, o acabamento (sombra, contorno, degradê: Acabamento.tsx), o recorte por máscara e, na
// imagem, "Remover fundo" e "Voltar ao original" (removerFundo.ts).
import React from 'react';
import {ChevronRight, Copy, FileJson, Image as IconeImagem, Link, Scissors, Undo2, Unlink, WandSparkles} from 'lucide-react';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {baseCamadas, paginaDoCaminho} from '../../../nucleo/carrossel';
import {ESTILOS_TRACO, JUNCOES_TRACO, PONTAS_TRACO, mascaraDe, mascarasEmUso, patchRecortar, patchSoltar, podeRecortar} from '../../../nucleo/acabamento';
import {ESPESSURA_LINHA, PONTAS_DE_SETA, linhaDe} from '../../../nucleo/linha';
import {resolverFonte} from '../../../nucleo/cor-marca';
import {existeIcone, sugerirIcones} from '../../../nucleo/icones';
import {aplicar, avisar, loja, patchTrocar, trocar, useLoja} from '../../estado/loja';
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoLeitura, CampoNumero, CampoSelecao, CampoTexto, Secao, copiar} from '../../componentes/Campos';
import {IconeEfeitos} from '../../componentes/Icones';
import {PADRAO, caminhoNoProjeto, definirPrevia, docValido, indiceDe, opcoesDeFonte, rotuloCamada, usarDocumentoImagem, usarPaginaAtiva, type PaginaAtiva} from './comum';
import {renomearPagina} from './acoes';
import {SecaoFundoDegrade, SecoesAcabamento, usarKitDaImagem} from './Acabamento';
import {removerFundoDaCamada, voltarAoOriginal} from './removerFundo';
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

const InspectorCamada: React.FC<{documento: string; caminho: string; c: CamadaImagem; doc: DocImagem; camadas: CamadaImagem[]; i: number; base: string}> = ({documento, caminho, c, doc, camadas, i, base}) => {
  const kit = usarKitDaImagem(doc);
  const [ocupado, setOcupado] = React.useState(false);
  const iMascara = mascaraDe(camadas, i);
  const iFoto = mascarasEmUso(camadas).get(i);
  const naoRecorta = podeRecortar(camadas, i);
  const recortar = () => void aplicar(documento, patchRecortar(camadas, base, i), `recortar ${c.id} pela camada ${camadas[i + 1]?.id}`);
  const soltarRecorte = () => void aplicar(documento, patchSoltar(camadas, base, i), `soltar o recorte de ${c.id}`);
  const tirarFundo = () => {
    setOcupado(true);
    void removerFundoDaCamada(documento, caminho, c).finally(() => setOcupado(false));
  };
  const gravar = (campo: keyof CamadaImagem) => (v: unknown) => void trocar(documento, `${caminho}/${campo}`, v, `${campo} de ${c.id}`);
  const positivo = (campo: keyof CamadaImagem) => (v: number) => (v > 0 ? gravar(campo)(v) : avisar(`${campo} precisa ser maior que zero`, 'erro'));
  const ver = (campo: keyof CamadaImagem) => (valor: unknown) => definirPrevia({documento, caminho: `${caminho}/${campo}`, valor});
  const sub = c.tipo === 'texto' ? `Texto · ${resolverFonte(c.fonte ?? PADRAO.fonte, doc.marca)} ${c.peso ?? PADRAO.peso}` : c.tipo === 'imagem' ? `Imagem · ${c.src ?? ''}` : c.forma === 'icone' ? `Ícone · ${c.icone ?? ''}` : c.forma === 'linha' ? 'Linha' : `Forma · ${c.forma === 'elipse' ? 'elipse' : 'retângulo'}`;

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
            <CampoSelecao rotulo="Fonte" valor={c.fonte ?? PADRAO.fonte} opcoes={opcoesDeFonte(doc.marca, c.fonte ?? PADRAO.fonte)} aoMudar={gravar('fonte')} />
            <CampoSelecao rotulo="Peso" valor={String(c.peso ?? PADRAO.peso)} opcoes={PESOS} aoMudar={(v) => gravar('peso')(Number(v))} />
            <CampoNumero rotulo="Tamanho" valor={c.tamanho ?? PADRAO.tamanho} unidade="px" padrao={PADRAO.tamanho} aoRedefinir={() => gravar('tamanho')(undefined)} aoMudar={positivo('tamanho')} />
            <CampoCor rotulo="Cor" valor={c.cor ?? PADRAO.cor} contra={doc.fundo} aoVer={ver('cor')} aoMudar={gravar('cor')} />
            <CampoSelecao rotulo="Alinhar" valor={c.alinhar ?? PADRAO.alinhar} opcoes={[['esquerda', 'À esquerda'], ['centro', 'Ao centro'], ['direita', 'À direita']]} aoMudar={gravar('alinhar')} />
          </Secao>
        )}

        {c.tipo === 'forma' && c.forma === 'icone' && (
          <Secao titulo="Ícone" chave="imagem:icone">
            <CampoTexto rotulo="Ícone" valor={c.icone ?? ''} dica="Nome do ícone do Lucide, em inglês e com hífen (scale, file-text). Para achar em português, use Inserir ícone no trilho."
              invalido={(v) => (existeIcone(v.trim()) ? null : `não existe: ${sugerirIcones(v, 3).join(', ') || 'procure no trilho'}`)} aoMudar={(v) => gravar('icone')(v.trim())} />
            <CampoCor rotulo="Cor" valor={c.preenchimento ?? PADRAO.preenchimento} aoVer={ver('preenchimento')} aoMudar={gravar('preenchimento')} />
            <CampoNumero rotulo="Traço" valor={c.icone_espessura ?? 2} padrao={2} aoRedefinir={() => gravar('icone_espessura')(undefined)}
              dica="Espessura do traço na grade de 24 do ícone: 2 é o do Lucide; cresce e encolhe com o tamanho"
              aoMudar={(v) => (v > 0 ? gravar('icone_espessura')(v) : avisar('o traço precisa ser maior que zero', 'erro'))} />
          </Secao>
        )}

        {c.tipo === 'forma' && c.forma === 'linha' && (() => {
          const l = linhaDe(c);
          // a primeira edição cria o objeto `linha`; as outras mudam o campo dele
          const gravarLinha = (campo: string) => (valor: unknown) => void trocar(documento, c.linha ? `${caminho}/linha/${campo}` : `${caminho}/linha`, c.linha ? valor : {[campo]: valor}, `${campo} da linha ${c.id}`);
          return (
            <Secao titulo="Linha" chave="imagem:linha">
              <CampoCor rotulo="Cor" valor={c.preenchimento ?? PADRAO.preenchimento} aoVer={ver('preenchimento')} aoMudar={gravar('preenchimento')} />
              <CampoNumero rotulo="Espessura" valor={l.espessura} unidade="px" padrao={ESPESSURA_LINHA} aoRedefinir={() => gravarLinha('espessura')(undefined)}
                aoMudar={(v) => (v > 0 ? gravarLinha('espessura')(v) : avisar('a espessura precisa ser maior que zero', 'erro'))} />
              <CampoSelecao rotulo="Estilo" valor={l.estilo} opcoes={ESTILOS_TRACO} aoMudar={(v) => gravarLinha('estilo')(v === 'solido' ? undefined : v)} />
              <CampoSelecao rotulo="Pontas" valor={l.pontas} opcoes={PONTAS_TRACO} aoMudar={(v) => gravarLinha('pontas')(v === 'redonda' ? undefined : v)} />
              <CampoSelecao rotulo="Junção" valor={l.juncao} opcoes={JUNCOES_TRACO} aoMudar={(v) => gravarLinha('juncao')(v === 'redonda' ? undefined : v)} />
              <CampoSelecao rotulo="Início" valor={l.inicio} opcoes={PONTAS_DE_SETA} aoMudar={(v) => gravarLinha('inicio')(v === 'nenhuma' ? undefined : v)} />
              <CampoSelecao rotulo="Fim" valor={l.fim} opcoes={PONTAS_DE_SETA} aoMudar={(v) => gravarLinha('fim')(v === 'nenhuma' ? undefined : v)} />
              <CampoNumero rotulo="Seta" valor={Math.round(l.tamanho)} unidade="px" dica="Tamanho da ponta: seta, triângulo, losango, círculo ou barra. A linha aponta pelo Giro da camada."
                aoMudar={(v) => (v > 0 ? gravarLinha('tamanho_seta')(v) : avisar('o tamanho da seta precisa ser maior que zero', 'erro'))} />
            </Secao>
          );
        })()}

        {c.tipo === 'forma' && c.forma !== 'icone' && c.forma !== 'linha' && (
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
            {c.src_original && <CampoLeitura rotulo="Original" dica="O arquivo de antes do remover fundo, intocado">{c.src_original}</CampoLeitura>}
            <div className="linha-botoes" style={{display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0'}}>
              <button type="button" className="bt mini" disabled={ocupado || !c.src} onClick={tirarFundo}
                title="Modelo local MODNet (retrato, Apache-2.0): grava midia/<arquivo>.<código>.sem-fundo.png e não mexe no original. Na primeira vez baixa o modelo (26 MB).">
                <WandSparkles />{ocupado ? 'Removendo…' : 'Remover fundo'}
              </button>
              {c.src_original && <button type="button" className="bt fantasma mini" onClick={() => void voltarAoOriginal(documento, caminho, c)} title={`Volta a ${c.src_original}`}><Undo2 />Voltar ao original</button>}
            </div>
          </Secao>
        )}

        {(c.tipo === 'imagem' || iFoto !== undefined) && (
          <Secao titulo="Recorte" chave="imagem:recorte">
            {iMascara >= 0 ? (
              <>
                <CampoLeitura rotulo="Máscara" dica="A foto aparece só dentro desta camada (a de cima). Arraste a foto para escolher o pedaço; a máscara fica onde está">{rotuloCamada(camadas[iMascara])}</CampoLeitura>
                <div style={{display: 'flex', justifyContent: 'flex-end', padding: '4px 0'}}><button type="button" className="bt fantasma mini" onClick={soltarRecorte}><Unlink />Soltar</button></div>
              </>
            ) : iFoto !== undefined ? (
              <>
                <CampoLeitura rotulo="Recorta" dica="Esta camada é a moldura da foto de baixo: arrastar leva a foto junto; duplo clique no monitor escolhe a foto">{rotuloCamada(camadas[iFoto])}</CampoLeitura>
                <div style={{display: 'flex', justifyContent: 'flex-end', padding: '4px 0'}}><button type="button" className="bt fantasma mini" onClick={soltarRecorte}><Unlink />Soltar</button></div>
              </>
            ) : (
              <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0'}}>
                <span className="vazio" style={{flex: 1, padding: 0, textAlign: 'left'}}>{naoRecorta ? `Para recortar: ${naoRecorta} (forma ou texto logo acima).` : `Recortar pela camada de cima: ${rotuloCamada(camadas[i + 1])}.`}</span>
                <button type="button" className="bt mini" disabled={Boolean(naoRecorta)} onClick={recortar}><Scissors />Recortar</button>
              </div>
            )}
          </Secao>
        )}

        <SecoesAcabamento documento={documento} caminho={caminho} c={c} kit={kit} referencia={Boolean(doc.marca)} recortada={iMascara >= 0 ? rotuloCamada(camadas[iMascara]) : undefined} />
      </div>
    </div>
  );
};

const InspectorDocumento: React.FC<{documento: string; doc: DocImagem; ativa: PaginaAtiva}> = ({documento, doc, ativa}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const efeitos = doc.efeitos ?? [];
  const varias = ativa.paginas.length > 1;
  const camadas = varias ? `${ativa.paginas.length} páginas · ${ativa.camadas.length} ${ativa.camadas.length === 1 ? 'camada' : 'camadas'} nesta página`
    : `${ativa.camadas.length} ${ativa.camadas.length === 1 ? 'camada' : 'camadas'}`;
  const ligados = efeitos.filter((e) => e.ativo !== false).length;
  const positivo = (campo: 'largura' | 'altura') => (v: number) =>
    v > 0 ? void trocar(documento, `/${campo}`, Math.round(v), `${campo} da imagem`) : avisar(`${campo} precisa ser maior que zero`, 'erro');
  const pronto = TAMANHOS.find((t) => t.l === doc.largura && t.a === doc.altura);
  const kit = usarKitDaImagem(doc);
  const tamanho = (l: number, a: number, rotulo: string) => {
    const atual = loja.get().docs[documento]?.doc;
    const patch: OperacaoPatch[] = [...(l !== doc.largura ? patchTrocar(atual, '/largura', l) : []), ...(a !== doc.altura ? patchTrocar(atual, '/altura', a) : [])];
    void aplicar(documento, patch, rotulo);
  };
  return (
    <div className="painel">
      <CabecalhoInspector icone={<IconeImagem />} nome={titulo} sub={`${varias ? 'Carrossel' : 'Imagem'} · ${doc.largura} × ${doc.altura}`} dica={camadas} />
      <div className="insp-corpo">
        {varias && (
          <Secao titulo={`Página ${ativa.p + 1} de ${ativa.paginas.length}`} chave="imagem:pagina">
            <CampoTexto rotulo="Nome" valor={ativa.pagina.nome} aoMudar={(v) => void renomearPagina(documento, ativa.p, v)} />
            <CampoLeitura rotulo="Id" dica="O id da página fica igual quando ela muda de lugar">{ativa.pagina.id}</CampoLeitura>
            <CampoLeitura rotulo="Caminho" dica="Para o Claude: ler_documento com este caminho traz só esta página">{`/paginas/${ativa.p}`}</CampoLeitura>
          </Secao>
        )}
        <Secao titulo={varias ? 'Prancheta (todas as páginas)' : 'Prancheta'} chave="imagem:prancheta">
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
        <SecaoFundoDegrade documento={documento} doc={doc} kit={kit} />
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
  const doc = lido?.doc as DocImagem | undefined;
  const ativa = usarPaginaAtiva(documento, doc);
  const selecao = useLoja((e) => e.selecao);
  if (!documento || !lido || !doc) return <div className="vazio">Sem imagem ainda: crie no monitor.</div>;
  if (!docValido(doc) || !ativa) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas" nem "paginas"</div>;
  // a camada selecionada pode estar em qualquer página (o monitor traz a página dela para a frente)
  const p = selecao?.documento === documento ? paginaDoCaminho(doc, selecao.caminho) : -1;
  const base = p >= 0 ? baseCamadas(doc, p) : null;
  const caminho = base && selecao && indiceDe(selecao.caminho, base) >= 0 ? selecao.caminho : null;
  const c = caminho && base ? ativa.paginas[p]?.camadas[indiceDe(caminho, base)] : undefined;
  if (caminho && c && base) return <InspectorCamada key={caminho} documento={documento} caminho={caminho} c={c} doc={doc} camadas={ativa.paginas[p].camadas} i={indiceDe(caminho, base)} base={base} />;
  return <InspectorDocumento documento={documento} doc={doc} ativa={ativa} />;
};

export {TIPOS as TIPOS_CAMADA};
