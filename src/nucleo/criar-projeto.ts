// Criar projeto e documento. `planoDoProjeto` é puro (devolve os arquivos a gravar) e serve à tela inicial, ao MCP e aos
// testes; `gravarPlano` escreve. A estrutura é a do exemplo: estudio.json, video/, imagem/, 3d/, midia/, saidas/, um
// .gitignore e um CLAUDE.md que ensina ao Claude o formato dos documentos daquele projeto. Os modelos da Cliente copiam do
// exemplo empacotado (exemplos/exemplo), sempre em cópia nova. A lista de modelos fica em modelos.ts (sem disco), que a
// tela inicial também importa. Um kit de marca entra depois, por aplicarMarcaAoPlano: tema do documento, logo em
// midia/ e fontes em fontes/. Projeto com vídeo ou imagem ganha no CLAUDE.md a seção "Pesquisa" (pesquisa/, docs/pesquisa.md);
// no modelo modelo-carrossel, que copia o CLAUDE.md do exemplo, a seção já vem no exemplo (e é acrescentada se faltar).
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {DocImagem, EntradaDocumento, Manifesto, Modulo} from './documentos';
import {novoDoc3d} from './cena3d';
import {novoDocCenas} from './cenas';
import {novaAnimacao, modeloAnimacaoLogoPixel} from './animacao';
import {novaMusica} from './musica'; // frente Música
import {EFEITOS} from './efeitos';
import {MODELOS, type IdModelo} from './modelos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, limitarTamanho, type Formato} from './formatos';
import {arquivosDaMarca, patchDaMarca, temaDaMarca} from './marca';
import {LINHAS_DO_TEXTO_ANTIGO} from './claude-md-antigo';
import {REGRAS_MIDIA_PESADA} from './midia-git';
import type {MarcaLida} from './pasta-marcas';
import {serializar} from './projeto';
import {secaoIde} from './ide'; // frente IDE: a seção "Trabalhando por uma IDE"

// o texto baixado de cada fonte (pesquisa/fontes/<id>.txt) fica fora do git: é grande e se baixa de novo pela url
// vídeo e áudio sem perda em midia/ também ficam de fora (transversal-D7, midia-git.ts); o que passa de 25 MB entra na regra
// pelo caminho exato antes de cada commit
export const GITIGNORE = `saidas/\n.estudio/estado.json\n.estudio/miniatura.jpg\n.estudio/mcp*\n*.tmp\npesquisa/fontes/\n${REGRAS_MIDIA_PESADA.join('\n')}\n`;

const DOIS = (n: number) => String(n).padStart(2, '0');

/** "Sem título · 05/11 14:32". */
export const nomePadrao = (d: Date) => `Sem título · ${DOIS(d.getDate())}/${DOIS(d.getMonth() + 1)} ${DOIS(d.getHours())}:${DOIS(d.getMinutes())}`;

/** Nome que o Windows aceita como pasta: sem <>:"/\|?*, sem ponto ou espaço no fim, até 60 letras. */
export const nomeDePasta = (nome: string) => {
  const limpo = nome
    .replace(/·/g, '-')
    .replace(/:/g, 'h')
    .replace(/[<>"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(limpo) || !limpo ? `Projeto ${limpo}`.trim() : limpo;
};

/** Pasta que ainda não existe dentro de `raiz`: "Nome", "Nome (2)", "Nome (3)"... */
export const pastaLivre = (raiz: string, nome: string, existe: (p: string) => boolean = existsSync) => {
  const base = nomeDePasta(nome);
  let p = path.join(raiz, base);
  for (let n = 2; existe(p); n++) p = path.join(raiz, `${base} (${n})`);
  return p;
};

export const dentroDoOneDrive = (p: string) => /[\\/]OneDrive( - [^\\/]+)?([\\/]|$)/i.test(p);

// ---------- documentos novos ----------
export const novoDocImagem = (largura: number, altura: number): DocImagem => {
  const menor = Math.min(largura, altura);
  return {
    formato: 1,
    largura,
    altura,
    fundo: '#111418',
    camadas: [{id: 'titulo', nome: 'Título', tipo: 'texto', x: Math.round(largura * 0.08), y: Math.round(altura * 0.4), largura: Math.round(largura * 0.84),
      altura: Math.round(menor * 0.2), texto: 'Seu título', fonte: 'Inter', tamanho: Math.round(menor * 0.085), peso: 700, cor: '#F2F2F2', alinhar: 'centro'}],
    efeitos: [],
  };
};

export {novoDoc3d} from './cena3d'; // a cena 3D nova mora em cena3d.ts (pura), para a prévia web usar a mesma (frente C)

const PASTA_DO_MODULO: Record<Modulo, string> = {video: 'video', imagem: 'imagem', '3d': '3d', musica: 'musica', animacao: 'animacao'};
const TITULO_DO_MODULO: Record<Modulo, string> = {video: 'Vídeo', imagem: 'Imagem', '3d': 'Cena 3D', musica: 'Música', animacao: 'Animação'};
const ID_DO_MODULO: Record<Modulo, string> = {video: 'video', imagem: 'imagem', '3d': 'cena3d', musica: 'musica', animacao: 'animacao'};

export const conteudoNovo = (modulo: Modulo, formato?: {largura: number; altura: number; fps?: number}) => {
  if (modulo === 'video') {
    const f = formato ?? FORMATOS_VIDEO[0];
    return novoDocCenas({largura: limitarTamanho(f.largura), altura: limitarTamanho(f.altura), fps: formato?.fps ?? 30});
  }
  if (modulo === 'imagem') {
    const f = formato ?? FORMATOS_IMAGEM[0];
    return novoDocImagem(limitarTamanho(f.largura), limitarTamanho(f.altura));
  }
  if (modulo === 'animacao') {
    const f = formato ?? {largura: FORMATOS_VIDEO.find((x) => x.id === 'youtube')!.largura, altura: FORMATOS_VIDEO.find((x) => x.id === 'youtube')!.altura};
    return novaAnimacao(f.largura, f.altura, formato?.fps ?? 30);
  }
  if (modulo === 'musica') return novaMusica(); // frente Música
  return novoDoc3d();
};

/** Entrada e conteúdo de um documento novo num manifesto que já existe (id e arquivo que não colidem). */
export const documentoNovo = (manifesto: Manifesto, modulo: Modulo, o: {formato?: Formato | {largura: number; altura: number}; titulo?: string} = {}) => {
  const ids = new Set(manifesto.documentos.map((d) => d.id));
  const caminhos = new Set(manifesto.documentos.map((d) => d.caminho));
  const base = ID_DO_MODULO[modulo];
  let n = 1;
  const nome = (k: number) => (k === 1 ? base : `${base}-${k}`);
  while (ids.has(nome(n)) || caminhos.has(`${PASTA_DO_MODULO[modulo]}/${nome(n)}.json`)) n++;
  const mesmos = manifesto.documentos.filter((d) => d.modulo === modulo).length;
  const entrada: EntradaDocumento = {
    id: nome(n),
    modulo,
    caminho: `${PASTA_DO_MODULO[modulo]}/${nome(n)}.json`,
    titulo: o.titulo?.trim() || (mesmos ? `${TITULO_DO_MODULO[modulo]} ${mesmos + 1}` : TITULO_DO_MODULO[modulo]),
  };
  return {entrada, conteudo: conteudoNovo(modulo, o.formato)};
};

// ---------- CLAUDE.md ----------
/** Seção "Pesquisa": o Claude pesquisa, o código prova (trecho exato, dígitos, vigência) e a pessoa vê no painel. A
 *  pesquisa é só um visualizador: fato é fato, nada se aprova nem se reprova, nada bloqueia, nada da fonte é apagado. */
const secaoPesquisa = () => [
  '',
  '## Pesquisa',
  '',
  'Todo fato jurídico, número, prazo ou decisão que entrar numa cena precisa de fonte. A pesquisa fica em',
  '`pesquisa/pesquisa.json` e aparece no painel Pesquisa do app; você a grava pelas ferramentas abaixo, nunca à mão.',
  '',
  '1. **Ler a fonte.** `ler_fonte` {url, observacao?, titulo?} baixa a página, guarda o texto limpo, o sha256, o nível pelo',
  '   catálogo e as marcas de vigência, e devolve a fonte (`f1`, `f2`…) com o começo do texto. `texto_da_fonte` {fonte_id,',
  '   pagina? ou inicio? e fim?} lê o resto, 6.000 caracteres por página. `anotar_fonte` {fonte_id, observacao} acrescenta',
  '   à observação da fonte (a "observação de quem baixou": contexto, ressalva, de onde veio); nunca apaga o que havia.',
  '2. **Fontes por nível.** Regra jurídica só com fonte de nível 1: Planalto (lei compilada), Câmara, Senado, LexML, Diário',
  '   Oficial da União, TST, STF, STJ, TRT-3, CNJ/DJEN. Governo e agências (MTE, gov.br, Agência Brasil, Agência Senado e',
  '   Câmara) são nível 2 e servem para notícia e contexto. Fora do catálogo vira nível 0. Fato de empresa ou de setor:',
  '   fonte primária ou duas notícias independentes. Wikipedia, blogs, redes sociais, sites de outros escritórios e',
  '   imprensa estrangeira ficam fora.',
  '3. **Registrar o fato.** `registrar_fato` {afirmacao, fonte_id, trecho, localizador?, nota?} grava o fato (`F1`, `F2`…).',
  '   O `trecho` é **literal**, copiado do texto da fonte, com todo número e prazo da afirmação dentro dele; o',
  '   `localizador` é como "CLT, art. 477, § 6º", "Súmula 51 do TST", "Tema 152 do STF". O app procura o trecho no texto',
  '   (exato, parecido ou não encontrado) e confere os dígitos e as marcas de vigência em volta. Fica `trecho_confere`',
  '   quando o trecho é exato e nenhum número falta; senão `a_revisar`. `trecho_confere` prova que o trecho existe na',
  '   fonte e que os números batem, não que ele sustenta a afirmação: isso você confere lendo. Não escreva trecho de',
  '   memória: copie de `texto_da_fonte`.',
  '4. **Vigência.** Antes de usar norma ou súmula, olhe as marcas que o app achou ("(Revogado", "Redação dada pela",',
  '   "(Vide", "cancelada", "convertida"). Norma revogada ou superada não entra na narração como regra atual.',
  '5. **Lacunas declaradas.** O que não achou em fonte de nível 1 não vira afirmação: diga "não encontrei fonte para X"',
  '   na conversa e no dossiê (`pesquisa/dossie.md`, que continua valendo), e a cena diz "em geral" ou pula.',
  '6. **Blocos citam fatos.** Todo bloco (ou cena) que afirma regra, número ou prazo leva `refs` com os ids dos fatos',
  '   (`"refs": ["F3", "F7"]`). `listar_pesquisa` devolve fontes e fatos; `checar_texto` {documento? ou texto?} avisa nome',
  '   de empresa ou pessoa, termo da OAB e bloco com número sem `refs`.',
  '7. **Regras da Cliente** (são avisos; a pessoa decide): nunca o nome da empresa empregadora nem de trabalhador no texto do',
  '   vídeo ("a usina localizada em Cidade Exemplo", "operador de alto-forno"); nada de honorários, grátis, resultado',
  '   garantido, "entre na Justiça", "contrate"; nada de valor a receber ou chance de ganhar; decisão de 1º grau é',
  '   "sujeita a recurso"; sem travessão; última frase fixa: "Ficou com alguma dúvida? Procure um advogado trabalhista."',
  '8. **Fato é fato.** A pesquisa registra o que a fonte diz: ninguém aprova nem reprova, e nada bloqueia a exportação.',
  '   Não censure, não apague nem anonimize nada da fonte (nomes, partes, OAB, CNPJ ficam como no original); o cuidado',
  '   com nomes vale só para o texto do vídeo.',
  '9. **Narração confere com os fatos.** Depois de escrever as cenas, releia cada fala contra a pesquisa: todo número e',
  '   regra da fala tem de estar num fato. O que não estiver sai ou vira pergunta para a pessoa.',
];

/** Os efeitos que existem, com a faixa de cada valor, tirados da lista do app (efeitos.ts): o Claude que inventa um
 *  tipo derruba a área Efeitos. Quebra as linhas em 118 colunas, como o resto do texto. */
const secaoEfeitos = () => {
  const num = (n: number) => String(n).replace('-', '−');
  const tipos = EFEITOS.map((d) => `\`${d.tipo}\` ${num(d.min)} a ${num(d.max)}${d.unidade === 'px' ? ' px' : d.unidade}`);
  const linhas: string[] = [];
  let atual = '  Tipos e faixa do `valor`:';
  for (const [i, t] of tipos.entries()) {
    const pedaco = ` ${t}${i === tipos.length - 1 ? '.' : ';'}`;
    if ((atual + pedaco).length > 118) {
      linhas.push(atual);
      atual = ` ${pedaco}`;
    } else atual += pedaco;
  }
  linhas.push(atual);
  return [
    '- Efeitos (vídeo de cenas e imagem): `efeitos`, na raiz do documento, é a pilha aplicada em ordem no quadro inteiro:',
    '  cada item é {`id` (único), `tipo`, `valor`, `ativo` (padrão sim), `cor` (só no `tom`)}. Só estes tipos existem.',
    ...linhas,
    '  Brilho, contraste e saturação valem 1 quando não mudam nada; preto e branco é `saturacao` 0; sépia, vinheta,',
    '  granulado e tom vão de 0 (nada) a 1. Tipo ou campo fora disto quebra a área Efeitos do app: não invente.',
  ];
};

/** O item "Imagem" da lista de arquivos do CLAUDE.md: camadas, páginas do carrossel, sombra, contorno, degradê, máscara e
 *  remover fundo. Também vai, entre as marcas da imagem (abaixo), no CLAUDE.md escrito à mão do modelo da Cliente (imagem-N3). */
export const linhasDaImagem = (): string[] => [
  '- Imagem: `largura`, `altura`, `fundo`, `camadas` (`imagem`, `texto`, `forma`) de baixo para cima e `efeitos`. Um',
  '  carrossel tem `paginas[]` (cada uma com `id`, `nome` e as suas `camadas`; a raiz fica com `camadas: []`) e as camadas',
  '  se endereçam por `/paginas/P/camadas/N`; `estado_do_editor` diz a página ativa.',
  '  Acabamento por camada: `sombra` {cor, opacidade, desfoque, x, y}; `contorno` {cor, espessura, posicao: `fora`,',
  '  `centro` ou `dentro`}; `degrade` {`tipo` (`linear` ou `radial`), `angulo` (180 = de cima para baixo), `centro` {x, y},',
  '  `paradas` [{cor, posicao de 0 a 1, opacidade}]}, no lugar da cor em texto e forma. `fundo_degrade`, na raiz do',
  '  documento, vai por cima do `fundo` em todas as páginas. Foto dentro de forma ou texto: na camada de imagem, `mascara`',
  '  é o id da forma ou do texto logo acima dela. `remover_fundo` troca o `src` pelo recorte e guarda o original em',
  '  `src_original`. A pessoa exporta PNG por página e PDF pelo app; o MCP não exporta.',
];

export const claudeMd = (modulos: Modulo[]) => {
  const tem = (m: Modulo) => modulos.includes(m);
  const linhas = [
    '# Projeto do Estúdio',
    '',
    'Esta pasta é um projeto do Estúdio, aberto no app. A pessoa edita na interface; você edita pelas ferramentas do MCP',
    '`estudio`. Os dois mexem nos mesmos arquivos JSON, e o app recarrega a tela sozinho quando um arquivo muda.',
    '',
    '## Arquivos',
    '',
    '- `estudio.json`: manifesto com o nome do projeto e os documentos (id, módulo, caminho, título).',
  ];
  if (tem('video')) {
    linhas.push(
      '- Vídeo de cenas (`"tipo": "cenas"`): `formato` {largura, altura, fps}, `tema` {fundo, texto, destaque, suave, fonte} e',
      '  `cenas`. Cada cena tem `id`, `duracao_ms`, `fundo` opcional e `blocos`. Cada bloco tem `id`, `tipo` (`titulo`, `texto`,',
      '  `lista`, `numero`, `imagem`), `em` e `sai` em ms contados do começo da cena, e posição em frações do quadro (0 a 1):',
      '  `x` e `y` do canto de cima à esquerda e `largura` (a imagem tem também `altura`). `tam` é a altura da letra como',
      '  fração do lado menor do quadro (título ~0,085; texto ~0,045). `texto` aceita `**trecho**` na cor de destaque.',
      '  `lista` usa `itens` (lista de textos, entram um a um); `numero` conta de `de` até `ate`, com `prefixo`, `sufixo` e',
      '  `rotulo`; `imagem` usa `src` (caminho em `midia/`) e `ajuste` (`cobrir` ou `conter`). `alinhar`: esquerda, centro',
      '  ou direita. Ids novos não podem repetir os que já existem.',
      '  Som (opcional): `audio.faixas[]`, cada faixa com `id`, `nome`, `papel` (`voz`, `musica` ou `efeitos`), `volume` (0 a 1),',
      '  `mudo` e, na música, `ducking` {ativo, alvo_lu (quanto fica abaixo da voz; padrão 20), ataque_ms, soltura_ms}; cada',
      '  `clipes[]` com `id`, `arquivo` (em `midia/`), `em` (ms na linha do tempo), `duracao_ms`, `corte_ms`, `volume`,',
      '  `fade_in_ms`, `fade_out_ms` e `mudo`. O que ficar fora do vídeo vira aviso, não erro (detalhe em docs/audio.md do app).',
      '  Loudness: `audio.alvo_lufs` (padrão −14) e `audio.pico_dbtp` (padrão −1) são o alvo do arquivo exportado; a exportação',
      '  mede o arquivo final e corrige o ganho. A limpeza de voz se faz na tela, por clipe: o app troca o `arquivo` pelo WAV',
      '  limpo, guarda o da pessoa em `original` e as medidas em `limpeza`. Não escreva `original` nem `limpeza` à mão.',
      '  Movimento no bloco `imagem` (zoom dinâmico): `movimento` {`tipo` (`aproximar`, `afastar`, `esquerda`, `direita`,',
      '  `cima`, `baixo`), `intensidade` (0,05 a 0,4; padrão 0,15), `suave` (padrão sim)}. Fica limpo com `ajuste: "cobrir"`.',
      '  Legendas (opcional): `legendas` {`segmentos`, `estilo`, `oculto`}. Cada segmento tem `id`, `em` e `sai` (ms do vídeo),',
      '  `texto` ("\\n" quebra a linha), `palavras` [{w, s, e}, ms do vídeo] e `falante`. `em`, `sai` e `palavras` são os',
      '  tempos do vídeo **de quando a legenda nasceu**: a legenda de um clipe de voz (`clipe`) anda com ele, e se o clipe foi',
      '  arrastado ou aparado depois, a tela mostra o tempo guardado mais o quanto ele andou (`origens`, do app: não mexa).',
      '  Por isso leia as legendas com `ler_legendas` (os tempos da tela) e corrija com `editar_legenda` {id, texto?, em?,',
      '  sai?}, que troca o texto e as palavras juntos (cada palavra guarda o tempo dela) e converte o tempo da tela. Não',
      '  escreva `texto`, `palavras`, `em` ou `sai` de legenda por `aplicar_patch`. O `estilo` muda por patch: `predefinicao`',
      '  (`classica`, `caixa`, `karaoke`, `faixa`, `discreta`), `posicao` (`baixo`, `meio`, `cima`), `tam`, `maiusculas`,',
      '  `falante`, `cor`, `cor_destaque`, `fundo` e `fonte` (padrão: os do `tema`). Gere com `transcrever`.',
      '  Narração por IA (opcional): `cenas[i].narracao` {`texto`} é o roteiro falado da cena, diferente do texto da tela;',
      '  `[pausa]` e `[pausa longa]` fazem pausa. `narracao`, na raiz, é a configuração: `provedor` (`gemini` = Gemini TTS,',
      '  com a chave do Gemini; `google-tts` = Google Cloud TTS, vozes Chirp 3: HD), `modelo` (só gemini:',
      '  `gemini-3.8-flash-tts` ou `gemini-3.8-flash-lite-tts`), `voz` (`vozes_narracao`), `estilo` (só gemini: como falar,',
      '  em linguagem natural), `velocidade` (só google-tts, 0,25 a 2), `folga_ms` (a fala entra depois do começo da cena;',
      '  padrão 300), `margem_ms` (padrão 500) e `pronuncias` [{de, para}], o dicionário aplicado antes da voz (ex.: RH →',
      '  erre agá). A fala gerada é um WAV em `midia/narracao/<hash>.wav` num clipe de voz com `narracao_ia` {cena, hash}:',
      '  não escreva `narracao_ia` nem esses clipes à mão; use `narrar`.',
    );
  }
  if (tem('imagem')) linhas.push(...linhasDaImagem());
  if (tem('3d')) {
    linhas.push(
      '- Cena 3D: `fundo` (cor), `camera`, `luzes` e `objetos`. Vetores são listas `[x, y, z]`, com y para cima e o chão em',
      '  y = 0. Cada objeto tem `id` (único), `nome`, `tipo` (`caixa`, `esfera`, `cilindro`, `cone`, `toro` ou `plano`),',
      '  `posicao` [x, y, z], `rotacao` [x, y, z] em graus, `escala` [x, y, z] (1 = tamanho normal), `cor` ("#rrggbb") e,',
      '  opcionais, `metalico` e `rugosidade` (0 a 1), `visivel` e `gira` [x, y, z] em graus por segundo (só na prévia). O',
      '  chão é um `plano` com `rotacao` [-90, 0, 0]. Cada luz tem `id`, `tipo` (`ambiente`, `direcional` ou `ponto`), `cor`,',
      '  `intensidade` (ambiente perto de 0,5; direcional perto de 1,6) e `posicao` [x, y, z] (menos na ambiente). `camera`',
      '  {`posicao` [x, y, z], `alvo` [x, y, z], `fov` em graus, padrão 40}. Outro tipo ou campo não aparece: não invente.',
    );
  }
  if (tem('animacao')) {
    linhas.push(
      '- Animação: `largura`, `altura`, `fps`, `duracao_ms`, `fundo` e `camadas` de baixo para cima. `tema` (opcional) traz',
      '  as cores do kit de marca; `fundo` e `cor` aceitam `#rrggbb` ou a referência `@fundo`, `@texto`, `@destaque` ou',
      '  `@suave`. Cada camada tem `id`, `nome`, `tipo` (`forma`, `texto`, `imagem` ou `pixel`), `visivel`, `travada` e as',
      '  propriedades base `x`, `y`, `largura`, `altura`, `escala`, `rotacao`, `opacidade`, `cor`; no texto, `texto`,',
      '  `fonte`, `tamanho`, `peso` e `alinhar`; na forma, `forma` e `raio`; na imagem, `src` e `ajuste`. As propriedades',
      '  animáveis são `x`, `y`, `escala`, `rotacao`, `opacidade`, `cor` (em OKLab), `tamanho` (texto), `tamanho_pixel` e',
      '  `progresso` (pixel), por `trilhas` {propriedade: [{t_ms, valor, curva}]} com as curvas `linear`, `suave`,',
      '  `entrada`, `saida`, `mola` e `degrau`. A camada `pixel` tem `grade` {colunas, linhas, paleta, celulas},',
      '  `tamanho_pixel`, `progresso` (0 a 1), `efeito` (`aleatorio`, `decodificar`, `varredura`, `varredura-baixo`, `meio`',
      '  ou `chuva`) e `semente`. Use `criar_animacao`, `adicionar_camada_animacao`, `animar`, `pixelizar_imagem` e',
      '  `efeito_pixel` (docs/animacao.md) em vez de montar à mão.',
    );
  }
  if (tem('video') || tem('imagem')) linhas.push(...secaoEfeitos());
  if (tem('video') || tem('imagem')) {
    linhas.push(
      '- Kit de marca: `aplicar_marca` põe num documento as cores, a fonte, o logo (`midia/logo-<id>.*`) e as fontes próprias',
      '  (`fontes/`) de um kit (ks, bkm, neutro ou outro criado no app). No vídeo de cenas isso fica no `tema`: `marca` é o id do',
      '  kit, e `logo`, `assinatura` e `fontes_arquivos` (cada uma com `familia`, `arquivo` e `peso`) acompanham as cores. Na',
      '  imagem muda o fundo e a fonte e a cor dos textos. `fonte` aceita Inter, Archivo, IBM Plex Sans, IBM Plex Mono ou a',
      '  `familia` de uma fonte própria. Fique nas cores do kit; para outra marca, troque o kit em vez de inventar cores.',
    );
  }
  linhas.push(
    '- `midia/`: arquivos usados pelos documentos. `saidas/`: o que o app exporta (fora do git).',
    '- `comentarios.json`: comentários da pessoa, ancorados num objeto (`alvo.objeto`, JSON Pointer), num tempo e num ponto.',
    '- `.estudio/diario.jsonl`: diário de todas as mudanças (quem, quando, patch e patch inverso).',
  );
  if (tem('video') || tem('imagem')) {
    linhas.push(
      '- `pesquisa/pesquisa.json`: fontes e fatos da pesquisa (seção "Pesquisa" abaixo); o texto de cada fonte fica em',
      '  `pesquisa/fontes/<id>.txt` (fora do git). `pesquisa/dossie.md` é o rascunho do skill `pesquisa-juridica`.',
    );
  }
  const passos = [
    '`estado_do_editor` diz o que a pessoa está vendo e o que está selecionado.',
    '`ler_documento` devolve o JSON e a `versao`; `aplicar_patch` muda com JSON Patch (RFC 6902) e `versao_base`.\n   Ponha um `test` no valor que vai trocar. Se o documento mudou por baixo, leia de novo e refaça.',
    '`criar_documento` cria vídeo, imagem ou cena 3D no projeto; `renomear_projeto` muda o nome.',
    '`listar_comentarios`, `ler_comentario`, `responder_comentario` e `resolver_comentario` cuidam dos pedidos da pessoa.',
    '`listar_mudancas` mostra o que a pessoa mudou à mão desde a sua última olhada.',
  ];
  if (tem('video') || tem('imagem')) passos.push('`aplicar_marca` troca o kit de marca (cores, fonte, logo e fontes próprias) de um documento.');
  if (tem('video')) {
    passos.push('`transcrever` transcreve a fala no próprio PC: grava `<arquivo>.palavras.json` e, no vídeo de cenas, gera as\n   legendas que faltam. `ler_legendas` mostra as legendas nos tempos da tela e `editar_legenda` corrige texto e tempo.\n   `exportar_legendas` grava SRT e VTT em `saidas/`; `importar_legendas` lê um SRT ou VTT do projeto.');
    passos.push('Narração por IA: escreva `cenas[i].narracao.texto`, ajuste a voz com `configurar_narracao` e as pronúncias com\n   `pronuncias_narracao`; mostre à pessoa `narrar` com `previa: true` (texto final e custo, sem gastar) e depois\n   gere com `narrar` (cache: só a cena que mudou vai ao Google). `ajustar_cenas_a_fala` faz a cena durar a fala;\n   `transcrever`, depois, cria as legendas.');
  }
  if (tem('imagem')) passos.push('`remover_fundo` tira o fundo de uma foto de pessoa com o modelo local; com `voltar: true`, volta ao original.');
  if (tem('animacao')) passos.push('`criar_animacao`, `adicionar_camada_animacao`, `animar`, `pixelizar_imagem`, `efeito_pixel` e `ver_animacao` montam e animam a animação (docs/animacao.md).');
  linhas.push('', '## Como trabalhar', '', ...passos.map((t, i) => `${i + 1}. ${t}`));
  if (tem('video') || tem('imagem')) linhas.push(...secaoPesquisa());
  linhas.push(...secaoIde(tem('video') || tem('animacao'))); // frente IDE (docs/ide.md)
  linhas.push('', FIM_DO_TEXTO);
  return [MARCA_CLAUDE_INICIO, ...linhas, MARCA_CLAUDE_FIM, ''].join('\n');
};

// ---------- CLAUDE.md refeito ao abrir ----------
/** O texto que o app escreve no CLAUDE.md fica entre estas marcas e é refeito a cada abertura do projeto, para o Claude
 *  conhecer os campos da versão instalada. O que a pessoa ou o Claude escrever fora das marcas fica como está. */
export const MARCA_CLAUDE_INICIO = '<!-- estudio:inicio · parte escrita pelo app e refeita ao abrir o projeto; escreva fora destas marcas -->';
export const MARCA_CLAUDE_FIM = '<!-- estudio:fim -->';
// até a 0.3.0 o app escrevia o texto sem marcas: ele começa com o título e esta frase e termina com FIM_DO_TEXTO
const TITULO = '# Projeto do Estúdio';
const FRASE_DO_APP = 'Esta pasta é um projeto do Estúdio, aberto no app. A pessoa edita na interface; você edita pelas ferramentas do MCP';
const FIM_DO_TEXTO = 'Tudo o que você faz cai nos documentos, e a pessoa edita depois. Não grave fora da pasta do projeto.';

// O CLAUDE.md escrito à mão do modelo "Carrossel narrado Cliente" (exemplos/exemplo) não leva o texto do app, mas leva a parte da
// imagem entre estas marcas, refeita ao abrir: o Claude daquele modelo também lê `mascara`, `sombra`, `degrade` e `paginas`
// (imagem-N3). O resto do arquivo é da pessoa e fica como está.
export const MARCA_IMAGEM_INICIO = '<!-- estudio:imagem:inicio · parte do app, refeita ao abrir o projeto; escreva fora destas marcas -->';
export const MARCA_IMAGEM_FIM = '<!-- estudio:imagem:fim -->';
const FRASE_DO_EXEMPLO_CLIENTE = 'A pessoa edita na interface; você edita pelo terminal.';

/** O bloco da imagem com as marcas, para o fim do CLAUDE.md do modelo da Cliente. */
export const blocoDaImagem = (): string => [MARCA_IMAGEM_INICIO, '## Imagem e carrossel', '', ...linhasDaImagem(), MARCA_IMAGEM_FIM, ''].join('\n');

/** O que a pessoa (ou o Claude) escreveu dentro do texto antigo do app (imagem-N5): as linhas que o app nunca escreveu.
 *  Vai para uma seção própria em vez de sumir com o resto do texto antigo. Vazio se não houver nenhuma. */
export const anotacoesDoTextoAntigo = (textoAntigo: string): string => {
  const minhas = textoAntigo.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !LINHAS_DO_TEXTO_ANTIGO.has(l));
  if (!minhas.length) return '';
  return ['## Anotações do texto anterior', '', 'O Estúdio refez a parte dele acima. Estas linhas estavam dentro do texto antigo e não eram do app:', '', ...minhas].join('\n');
};

/** O CLAUDE.md novo a partir do atual, ou null se nada muda. Sem arquivo: o texto gerado. Com as marcas: troca só o que
 *  está entre elas. Texto antigo do app, sem marcas: troca pelo gerado e guarda depois dele o que a pessoa escreveu antes
 *  ou depois. Outro texto (o CLAUDE.md escrito à mão do carrossel da Cliente, ou um da pessoa): não mexe. */
export const claudeMdAtualizado = (atual: string | null, modulos: Modulo[]): string | null => {
  const gerado = claudeMd(modulos);
  if (atual === null) return gerado;
  const texto = atual.replace(/\r\n/g, '\n');
  const i = texto.indexOf(MARCA_CLAUDE_INICIO);
  const f = i >= 0 ? texto.indexOf(MARCA_CLAUDE_FIM, i) : -1;
  let novo: string | null = null;
  if (i >= 0 && f > i) {
    novo = texto.slice(0, i) + gerado.trimEnd() + texto.slice(f + MARCA_CLAUDE_FIM.length);
  } else if (texto.includes(FRASE_DO_APP) && texto.includes(FIM_DO_TEXTO)) {
    const ini = Math.max(0, texto.indexOf(TITULO));
    const fim = texto.indexOf(FIM_DO_TEXTO) + FIM_DO_TEXTO.length;
    const antes = texto.slice(0, ini).trim();
    const depois = texto.slice(fim).trim();
    novo = `${[gerado.trimEnd(), anotacoesDoTextoAntigo(texto.slice(ini, fim)), antes, depois].filter(Boolean).join('\n\n')}\n`;
  } else if (modulos.includes('imagem')) {
    // o modelo da Cliente: texto à mão, e só a parte da imagem é do app (imagem-N3)
    const ii = texto.indexOf(MARCA_IMAGEM_INICIO);
    const fi = ii >= 0 ? texto.indexOf(MARCA_IMAGEM_FIM, ii) : -1;
    if (ii >= 0 && fi > ii) novo = texto.slice(0, ii) + blocoDaImagem().trimEnd() + texto.slice(fi + MARCA_IMAGEM_FIM.length);
    else if (texto.includes(FRASE_DO_EXEMPLO_CLIENTE)) novo = `${texto.trimEnd()}\n\n${blocoDaImagem()}`;
  }
  return novo === null || novo === texto ? null : novo;
};

/** Refaz a parte do app no CLAUDE.md de um projeto, pelos módulos que o manifesto tem. Devolve se gravou. Nunca lança:
 *  um CLAUDE.md que não dá para atualizar não impede abrir o projeto. */
export const regerarClaudeMd = (raiz: string): boolean => {
  try {
    const manifesto = JSON.parse(readFileSync(path.join(raiz, 'estudio.json'), 'utf-8')) as Manifesto;
    const modulos = [...new Set((manifesto.documentos ?? []).map((d) => d.modulo))];
    const arq = path.join(raiz, 'CLAUDE.md');
    const novo = claudeMdAtualizado(existsSync(arq) ? readFileSync(arq, 'utf-8') : null, modulos);
    if (novo === null) return false;
    writeFileSync(arq, novo, 'utf-8');
    return true;
  } catch {
    return false;
  }
};

// ---------- plano do projeto ----------
export type OpcoesProjeto = {nome: string; modelo: IdModelo; formato?: Formato | {largura: number; altura: number}};
/** `copiar` traz arquivos de fora do projeto (logo e fontes do kit de marca): `de` absoluto, `para` relativo ao projeto.
 *  `acrescentarAoClaudeMd` vai no fim do CLAUDE.md copiado do exemplo (a seção "Pesquisa"), se ele ainda não a tiver. */
export type Plano = {manifesto: Manifesto; arquivos: Record<string, string>; pastas: string[]; copiarDoExemplo?: string[]; copiar?: {de: string; para: string}[];
  acrescentarAoClaudeMd?: string};

/** Arquivos de um projeto novo (sem gravar nada). Modelos da Cliente listam o que copiar do exemplo em `copiarDoExemplo`. */
export const planoDoProjeto = (o: OpcoesProjeto): Plano => {
  const modelo = MODELOS.find((m) => m.id === o.modelo);
  if (!modelo) throw new Error(`modelo desconhecido: ${o.modelo}`);
  const nome = o.nome.trim() || 'Sem título';
  const pastas = ['midia', 'saidas', '.estudio'];
  if (o.modelo === 'modelo-carrossel') {
    // o exemplo inteiro, com o nome novo
    return {manifesto: {formato: 1, nome, documentos: []}, arquivos: {'.gitignore': GITIGNORE}, pastas, copiarDoExemplo: ['.'],
      acrescentarAoClaudeMd: secaoPesquisa().join('\n')};
  }
  if (o.modelo === 'modelo-capa') {
    const manifesto: Manifesto = {formato: 1, nome, documentos: [{id: 'capa', modulo: 'imagem', caminho: 'imagem/capa.json', titulo: 'Capa'}]};
    return {
      manifesto,
      arquivos: {'estudio.json': serializar(manifesto), '.gitignore': GITIGNORE, 'CLAUDE.md': claudeMd(['imagem'])},
      pastas,
      copiarDoExemplo: ['imagem/capa.json', 'midia/Cidade Exemplo.jpg', 'midia/logo-exemplo.png'],
    };
  }
  if (o.modelo === 'animacao-logo-pixel') {
    const entrada: EntradaDocumento = {id: 'animacao', modulo: 'animacao', caminho: 'animacao/animacao.json', titulo: 'Logo em pixels'};
    const manifesto: Manifesto = {formato: 1, nome, documentos: [entrada]};
    const conteudo = modeloAnimacaoLogoPixel();
    return {
      manifesto,
      arquivos: {'estudio.json': serializar(manifesto), [entrada.caminho]: serializar(conteudo), '.gitignore': GITIGNORE, 'CLAUDE.md': claudeMd(['animacao'])},
      pastas,
    };
  }
  const vazio: Manifesto = {formato: 1, nome, documentos: []};
  const formatoResolvido = o.modelo === 'animacao-9x16' ? {largura: 1080, altura: 1920, fps: 30} : o.modelo === 'animacao-branco' ? {largura: 1920, altura: 1080, fps: 30} : o.formato;
  const {entrada, conteudo} = documentoNovo(vazio, modelo.modulo, {formato: formatoResolvido});
  const manifesto: Manifesto = {...vazio, documentos: [entrada]};
  return {
    manifesto,
    arquivos: {'estudio.json': serializar(manifesto), [entrada.caminho]: serializar(conteudo), '.gitignore': GITIGNORE, 'CLAUDE.md': claudeMd([modelo.modulo])},
    pastas,
  };
};

/** Põe o kit de marca no plano: o tema dos documentos novos (vídeo de cenas e imagem) e o logo e as fontes a copiar.
 *  O que o kit cita mas não está na pasta dele (`existe`) fica de fora, para o tema não apontar para arquivo que não há. */
export const aplicarMarcaAoPlano = (plano: Plano, marca: MarcaLida, existe: (p: string) => boolean = existsSync): Plano => {
  const tudo = arquivosDaMarca(marca);
  const copiar = tudo.copiar.filter((c) => existe(path.join(marca.pasta, c.de))).map((c) => ({de: path.join(marca.pasta, c.de), para: c.para}));
  const presentes = new Set(copiar.map((c) => c.para));
  const tema = temaDaMarca(marca, {logo: tudo.logo && presentes.has(tudo.logo) ? tudo.logo : undefined, fontes_arquivos: tudo.fontes_arquivos.filter((f) => presentes.has(f.arquivo))});
  for (const e of plano.manifesto.documentos) {
    const texto = plano.arquivos[e.caminho];
    if (!texto) continue;
    const doc = JSON.parse(texto) as unknown;
    const patch = patchDaMarca(doc, marca, tema);
    if (patch.length) plano.arquivos[e.caminho] = serializar(jsonpatch.applyPatch(doc, patch as Operation[], true, false).newDocument);
  }
  if (copiar.length) plano.copiar = [...(plano.copiar ?? []), ...copiar];
  return plano;
};

/** Grava o plano numa pasta nova. `exemplo` é a pasta do exemplo empacotado (só para os modelos da Cliente). */
export const gravarPlano = (destino: string, plano: Plano, exemplo?: string) => {
  if (existsSync(path.join(destino, 'estudio.json'))) throw new Error(`já existe um projeto em ${destino}`);
  mkdirSync(destino, {recursive: true});
  for (const rel of plano.copiarDoExemplo ?? []) {
    if (!exemplo) throw new Error('o exemplo do Estúdio não foi achado no pacote');
    cpSync(path.join(exemplo, rel), path.join(destino, rel), {recursive: true});
  }
  for (const p of plano.pastas) mkdirSync(path.join(destino, p), {recursive: true});
  for (const c of plano.copiar ?? []) {
    mkdirSync(path.dirname(path.join(destino, c.para)), {recursive: true});
    copyFileSync(c.de, path.join(destino, c.para));
  }
  for (const [rel, texto] of Object.entries(plano.arquivos)) {
    mkdirSync(path.dirname(path.join(destino, rel)), {recursive: true});
    writeFileSync(path.join(destino, rel), texto, 'utf-8');
  }
  // o CLAUDE.md do exemplo já traz a seção "Pesquisa"; se uma cópia antiga do exemplo não trouxer, vai no fim, uma vez só
  const claude = path.join(destino, 'CLAUDE.md');
  if (plano.acrescentarAoClaudeMd && existsSync(claude)) {
    const atual = readFileSync(claude, 'utf-8');
    if (!atual.includes('## Pesquisa')) writeFileSync(claude, `${atual.replace(/\s*$/, '\n')}${plano.acrescentarAoClaudeMd}\n`, 'utf-8');
  }
  // o exemplo inteiro vem com o manifesto dele: só o nome muda
  if (plano.copiarDoExemplo?.includes('.')) {
    const arq = path.join(destino, 'estudio.json');
    const m = JSON.parse(readFileSync(arq, 'utf-8')) as Manifesto;
    writeFileSync(arq, serializar({...m, nome: plano.manifesto.nome}), 'utf-8');
  }
  return destino;
};
