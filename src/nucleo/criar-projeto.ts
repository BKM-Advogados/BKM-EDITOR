// Criar projeto e documento. `planoDoProjeto` é puro (devolve os arquivos a gravar) e serve à tela inicial, ao MCP e aos
// testes; `gravarPlano` escreve. A estrutura é a do exemplo: estudio.json, video/, imagem/, 3d/, midia/, saidas/, um
// .gitignore e um CLAUDE.md que ensina ao Claude o formato dos documentos daquele projeto. Os modelos da Cliente copiam do
// exemplo empacotado (exemplos/exemplo), sempre em cópia nova. A lista de modelos fica em modelos.ts (sem disco), que a
// tela inicial também importa. Um kit de marca entra depois, por aplicarMarcaAoPlano: tema do documento, logo em
// midia/ e fontes em fontes/.
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {DocCena3D, DocImagem, EntradaDocumento, Manifesto, Modulo} from './documentos';
import {novoDocCenas} from './cenas';
import {MODELOS, type IdModelo} from './modelos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, type Formato} from './formatos';
import {arquivosDaMarca, patchDaMarca, temaDaMarca} from './marca';
import type {MarcaLida} from './pasta-marcas';
import {serializar} from './projeto';

export const GITIGNORE = 'saidas/\n.estudio/estado.json\n.estudio/miniatura.jpg\n.estudio/mcp*\n*.tmp\n';

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

export const novoDoc3d = (): DocCena3D => ({
  formato: 1,
  fundo: '#111418',
  camera: {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40},
  luzes: [
    {id: 'ambiente', tipo: 'ambiente', cor: '#ffffff', intensidade: 0.5},
    {id: 'sol', tipo: 'direcional', cor: '#ffffff', intensidade: 1.6, posicao: [5, 8, 4]},
  ],
  objetos: [
    {id: 'chao', nome: 'Chão', tipo: 'plano', posicao: [0, 0, 0], rotacao: [-90, 0, 0], escala: [8, 8, 1], cor: '#2a2f36'},
    {id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.75, 0], rotacao: [0, 25, 0], escala: [1.5, 1.5, 1.5], cor: '#70B8FF', gira: [0, 20, 0]},
  ],
});

const PASTA_DO_MODULO: Record<Modulo, string> = {video: 'video', imagem: 'imagem', '3d': '3d'};
const TITULO_DO_MODULO: Record<Modulo, string> = {video: 'Vídeo', imagem: 'Imagem', '3d': 'Cena 3D'};
const ID_DO_MODULO: Record<Modulo, string> = {video: 'video', imagem: 'imagem', '3d': 'cena3d'};

export const conteudoNovo = (modulo: Modulo, formato?: {largura: number; altura: number; fps?: number}) => {
  if (modulo === 'video') {
    const f = formato ?? FORMATOS_VIDEO[0];
    return novoDocCenas({largura: f.largura, altura: f.altura, fps: formato?.fps ?? 30});
  }
  if (modulo === 'imagem') {
    const f = formato ?? FORMATOS_IMAGEM[0];
    return novoDocImagem(f.largura, f.altura);
  }
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
    );
  }
  if (tem('imagem')) linhas.push('- Imagem: `largura`, `altura`, `fundo` e `camadas` (`imagem`, `texto`, `forma`) de baixo para cima, com `efeitos`.');
  if (tem('3d')) linhas.push('- Cena 3D: objetos com `posicao`, `rotacao` em graus, `escala` e `cor`; luzes; câmera.');
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
    '',
    '## Como trabalhar',
    '',
    '1. `estado_do_editor` diz o que a pessoa está vendo e o que está selecionado.',
    '2. `ler_documento` devolve o JSON e a `versao`; `aplicar_patch` muda com JSON Patch (RFC 6902) e `versao_base`.',
    '   Ponha um `test` no valor que vai trocar. Se o documento mudou por baixo, leia de novo e refaça.',
    '3. `criar_documento` cria vídeo, imagem ou cena 3D no projeto; `renomear_projeto` muda o nome.',
    '4. `listar_comentarios`, `ler_comentario`, `responder_comentario` e `resolver_comentario` cuidam dos pedidos da pessoa.',
    '5. `listar_mudancas` mostra o que a pessoa mudou à mão desde a sua última olhada.',
  );
  if (tem('video') || tem('imagem')) linhas.push('6. `aplicar_marca` troca o kit de marca (cores, fonte, logo e fontes próprias) de um documento.');
  linhas.push(
    '',
    'Tudo o que você faz cai nos documentos, e a pessoa edita depois. Não grave fora da pasta do projeto.',
    '',
  );
  return linhas.join('\n');
};

// ---------- plano do projeto ----------
export type OpcoesProjeto = {nome: string; modelo: IdModelo; formato?: Formato | {largura: number; altura: number}};
/** `copiar` traz arquivos de fora do projeto (logo e fontes do kit de marca): `de` absoluto, `para` relativo ao projeto. */
export type Plano = {manifesto: Manifesto; arquivos: Record<string, string>; pastas: string[]; copiarDoExemplo?: string[]; copiar?: {de: string; para: string}[]};

/** Arquivos de um projeto novo (sem gravar nada). Modelos da Cliente listam o que copiar do exemplo em `copiarDoExemplo`. */
export const planoDoProjeto = (o: OpcoesProjeto): Plano => {
  const modelo = MODELOS.find((m) => m.id === o.modelo);
  if (!modelo) throw new Error(`modelo desconhecido: ${o.modelo}`);
  const nome = o.nome.trim() || 'Sem título';
  const pastas = ['midia', 'saidas', '.estudio'];
  if (o.modelo === 'modelo-carrossel') {
    // o exemplo inteiro, com o nome novo
    return {manifesto: {formato: 1, nome, documentos: []}, arquivos: {'.gitignore': GITIGNORE}, pastas, copiarDoExemplo: ['.']};
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
  const vazio: Manifesto = {formato: 1, nome, documentos: []};
  const {entrada, conteudo} = documentoNovo(vazio, modelo.modulo, {formato: o.formato});
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
  // o exemplo inteiro vem com o manifesto dele: só o nome muda
  if (plano.copiarDoExemplo?.includes('.')) {
    const arq = path.join(destino, 'estudio.json');
    const m = JSON.parse(readFileSync(arq, 'utf-8')) as Manifesto;
    writeFileSync(arq, serializar({...m, nome: plano.manifesto.nome}), 'utf-8');
  }
  return destino;
};
