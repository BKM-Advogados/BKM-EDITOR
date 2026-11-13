# Pesquisa: fontes e fatos

Versão 1, de 06/11/2026 (fase 1 da pesquisa no Estúdio); leitura de PDF em 12/11/2026. Liga a pesquisa jurídica do skill `pesquisa-juridica` ao
projeto: o Claude lê a fonte e registra o fato pelo MCP, o núcleo do app confere o que dá para conferir por programa e
a pessoa vê tudo no painel Pesquisa.

**É só um visualizador.** Fato é fato: não existe aprovar nem reprovar, nada bloqueia a exportação e tudo o que o app
nota vira aviso para a pessoa decidir. Nenhum dado da fonte é censurado, apagado, tachado ou anonimizado.

## O fluxo: o Claude pesquisa, o código prova, a pessoa vê

1. **O Claude pesquisa.** Acha a fonte (catálogo do skill `pesquisa-juridica`) e chama `ler_fonte` com a url. O app
   baixa a página, decodifica, limpa o HTML (ou, se a url é um PDF, tira o texto da camada de texto do arquivo), grava o
   texto em `pesquisa/fontes/<id>.txt`, calcula o sha256 do texto limpo, dá o nível pelo catálogo e anota as marcas de
   vigência. O Claude lê o texto (`texto_da_fonte`) e chama
   `registrar_fato` com a afirmação e o trecho literal.
2. **O código prova.** Para cada fato o núcleo procura o trecho no texto gravado (exato, parecido ou não encontrado),
   confere se todo número da afirmação aparece no trecho (em algarismo ou por extenso) e olha as marcas de vigência a
   600 caracteres do trecho. O resultado é um estado só: `trecho_confere` (trecho exato e nenhum número faltando) ou
   `a_revisar` (todo o resto). Trecho confere quer dizer que o trecho existe na fonte e que os números batem, não que
   o trecho sustenta a afirmação: isso fica para o juiz (fase 3). O núcleo nunca recusa um fato: se não achou o trecho,
   grava com `achado: "nao"`.
3. **A pessoa vê.** O painel Pesquisa (grupo do inspetor, em todas as áreas, ao lado de Comentários e Histórico) mostra
   as fontes e os fatos com os selos, os dígitos que faltam, as marcas de vigência e a observação de cada fonte. No
   inspetor do vídeo de cenas, o bloco selecionado mostra os fatos que cita (`refs`) como etiquetas.

## Arquivos na pasta do projeto

| Arquivo | O que é | Git |
|---|---|---|
| `pesquisa/pesquisa.json` | `{formato: 1, fontes: Fonte[], fatos: Fato[]}` | sim |
| `pesquisa/fontes/<fonte_id>.txt` | texto limpo de cada fonte, UTF-8, como foi baixado (do PDF, o texto da camada de texto, com `\f` entre as páginas) | não (`.gitignore`: `pesquisa/fontes/`) |
| `pesquisa/dossie.md` | rascunho do skill `pesquisa-juridica` (lacunas, contexto); continua valendo | sim |

A pasta `pesquisa/` nasce no primeiro uso. Ela **não** é um documento do manifesto (`estudio.json` não muda e o tipo
`Modulo` continua `video | imagem | 3d`). O texto de cada fonte fica fora do git porque é grande e se baixa de novo
pela url; o sha256 em `pesquisa.json` diz se o texto baixado depois é o mesmo.

## Modelo de dados (`src/nucleo/pesquisa.ts`)

```ts
type NivelFonte = 1 | 2 | 0; // 0 = fora do catálogo
type Fonte = {
  id: string;              // f1, f2… (os mesmos do dossiê)
  url: string; url_final?: string; titulo?: string; orgao?: string;
  nivel: NivelFonte; catalogo?: string;   // id da entrada do catálogo que casou pelo host
  acessado_em: string; http?: number; bytes?: number;
  tipo?: 'html' | 'texto' | 'pdf'; // o que veio da url; sem o campo, fonte lida antes de 12/11/2026
  paginas_pdf?: number;    // só no PDF: páginas do arquivo
  sha256: string;          // do texto limpo normalizado
  arquivo: string;         // pesquisa/fontes/<id>.txt
  sinais_vigencia: string[];
  observacao?: string;     // "observação de quem baixou": texto livre, só cresce
  autor: string;
};
type Fato = {
  id: string;              // F1, F2…
  afirmacao: string; fonte_id: string; localizador?: string;
  trecho: string; inicio?: number; fim?: number;   // índices no texto como gravado
  achado: 'exato' | 'parecido' | 'nao';
  digitos: {afirmacao: string[]; faltando: string[]};
  vigencia: string[];      // marcas no entorno do trecho
  estado: 'trecho_confere' | 'a_revisar'; // trecho exato e números conferidos; não prova que sustenta a afirmação
  nota?: string; criado_em: string; autor: string;
};
```

No documento de cenas, `refs?: string[]` (opcional, em `BlocoCenas` e `CenaCenas`) guarda os ids dos fatos que o bloco
ou a cena afirma: `"refs": ["F3", "F7"]`. O resolvedor repassa `refs` para as props sem mexer, a lâmina leva para as duas
metades e duplicar copia. Um id em `refs` que não existe na pesquisa é só um aviso, nunca erro.

### As conferências

- **Normalizar:** NFC, U+00A0 vira espaço, espaços repetidos viram um, aspas tipográficas viram retas.
- **Achar o trecho:** `exato` casa depois de normalizar, com a quebra de linha valendo espaço (um trecho de dois
  parágrafos copiado numa linha só continua exato); `parecido` casa ignorando caixa, acentos e pontuação; senão `nao`.
  Os índices `inicio` e `fim` apontam para o texto como está no arquivo, para o painel destacar.
- **Dígitos:** números em algarismo e por extenso ("dez dias" conta 10; "5 mil" conta 5000; "trezentos e sessenta e
  cinco" conta 365) e percentuais ("40%", "quarenta por cento"). Cada número da afirmação tem de aparecer no trecho, de
  um jeito ou de outro. O leitor também entende:
  - **identificadores**, que não entram na conta da afirmação: os do `localizador` e os números logo depois de "art.",
    "artigo", "§", "inciso", "alínea", "Lei", "Lei nº", "Lei Complementar", "Decreto", "Decreto-Lei", "Emenda",
    "Emenda Constitucional", "EC", "MP", "Medida Provisória", "PEC", "Resolução", "Res.", "Portaria", "NR", "Súmula",
    "SUM-", "OJ", "SBDI-", "Tema", "Precedente"…, mais o ano que vem logo depois deles ("Emenda 141, de 2026", "Lei
    13.467/2017", "Lei 8.213, de 24 de julho de 1991") e o ano da reforma ("Reforma da Previdência de 2019"). "Pelo
    art. 477, § 6º, são 10 dias" pede só o 10. O mesmo número usado também como quantidade ("o art. 15 dá 15 dias")
    continua contando;
  - **ordinais**: com símbolo ("13º", "1º grau", "2ª", "1o" do Planalto) são nome, não quantidade; por extenso
    ("vigésimo", "décimo terceiro") viram o número. Nos dois casos, só antes de unidade de tempo ("7º dia", "vigésimo
    dia", "quinto dia útil"): "dia 20" casa com "vigésimo dia", e "o 13º", "o décimo terceiro salário", "segunda vez" e
    "segundo o art." não pedem número. No trecho, o ordinal com símbolo vale como número escrito;
  - **datas** como um token só, em dd/mm/aaaa: "11/11/2017", "11.11.2017", "11-11-2017" e "11 de novembro de 2017"
    são a mesma data. A data no trecho também vale pelo ano ("desde 2017" acha "11.11.2017");
  - **"um"/"uma"** contam como 1 antes de unidade (ano, mês, dia, hora, semana, salário, parcela, vez, terço, metade,
    dobro), entre parênteses ("1 (um)"), em composição ("vinte e um") e antes de "por cento"; no resto são artigo
    ("uma multa", "um dos quais");
  - **adjetivos de prazo**: quinquenal 5, bienal 2, trienal 3, quadrienal 4, decenal 10, anual 1 (e os plurais).
    Mensal, semanal e diário dizem a frequência e não contam.
- **Vigência:** as marcas "(Revogad", "Redação dada pela", "(Incluído", "(Vide", "cancelad", "convertid", "superad",
  "em vigor", "DOU de" e "Vigência". Na fonte, no texto inteiro; no fato, a 600 caracteres do trecho. O painel mostra
  cada marca pela palavra inteira ("revogado", "redação dada", "incluído", "vide", "cancelada", "convertida",
  "superada", "em vigor", "DOU", "vigência") e, no fato, lembra que a marca perto do trecho pede ler a fonte: sozinha
  ela não diz se o trecho vale.
- **Limpar o HTML:** tira `<script>`, `<style>` e comentários; fim de parágrafo, item, linha de tabela e título vira
  quebra de linha; entidades decodificadas. O texto **riscado** (`<strike>`, `<s>`, `<del>`, `line-through`) é mantido,
  entre "[riscado: " e "]".
- **Ler o PDF** (`src/nucleo/pdf-texto.ts`): quando o Content-Type diz PDF ou os bytes começam com `%PDF`. Lê a camada
  de texto do arquivo, **sem OCR**. Uma linha do texto para cada linha do PDF; linha em branco onde o espaço entre linhas
  passa de 1,6 vez o espaço mais comum da página (parágrafo); `\f` (quebra de página, como no `pdftotext`) entre as
  páginas. Na conferência do trecho a quebra de linha, a linha em branco e o `\f` valem um espaço só (o `\f` é espaço
  para o `normalizar`), então um trecho que atravessa linha ou página continua exato, e o sha256 é calculado do mesmo
  jeito que no HTML. Duas arrumações para o trecho copiado do PDF casar:
  - **palavra partida no fim da linha** ("Previdên-" + "cia") volta inteira na linha de cima, com a pontuação colada.
    Só junta quando a linha de baixo começa com minúscula. O hífen fica quando o próprio documento escreve a palavra com
    hífen em outro lugar numa linha só ("auxílio-doença"); senão sai. O hífen invisível (U+00AD) sempre sai;
  - **cabeçalho e rodapé repetidos:** a mesma linha (até 160 caracteres, números trocados por `#`) nas 2 primeiras ou 2
    últimas linhas de pelo menos metade das páginas, a partir de 3 páginas. Fica uma vez só: o cabeçalho na primeira
    página e o rodapé na última (o texto continua tendo os dois; só a repetição sai). O `ler_fonte` devolve um exemplo
    de cada em `repetidos_do_pdf`.
  
  PDF sem texto nenhum (digitalizado, só imagem) dá erro e não grava nada: "o PDF tem N páginas e nenhum texto: parece
  digitalizado (só imagem), e o Estúdio não faz OCR". PDF com senha ou que não abre também dá erro. PDF com algumas
  páginas só de imagem (o anexo digitalizado de uma decisão) é gravado com o que tem texto, e o `aviso` diz quais
  páginas não foram lidas. O título vem do `Title` do PDF, quando há.
- **Decodificar:** charset do cabeçalho HTTP; senão o `<meta charset>` dos primeiros 4 KB; senão UTF-8 se os bytes
  forem UTF-8 válido; senão windows-1252, o padrão dos sites antigos de governo (o Planalto é um deles). Quando o
  charset declarado é UTF-8 e os bytes não são UTF-8 válido (site que declara UTF-8 e manda windows-1252), vale o
  windows-1252 e o `ler_fonte` devolve um `aviso`: ler solto trocaria cada acento por U+FFFD e perderia dado da fonte.
- **Nível:** pelo host da url, por sufixo de domínio, contra `CATALOGO_FONTES` (`src/nucleo/catalogo-fontes.ts`).

## Ferramentas do MCP `estudio`

| Ferramenta | Entrada | Faz |
|---|---|---|
| `ler_fonte` | `url`, `observacao?`, `titulo?` | baixa, limpa (HTML) ou tira o texto (PDF), grava o texto, sha256, nível, vigência, `tipo` (`html`, `texto` ou `pdf`) e, no PDF, `paginas_pdf`; devolve a fonte, os 3.000 primeiros caracteres, quantas páginas de 6.000 há, `repetidos_do_pdf` quando tirou cabeçalho ou rodapé repetido e um `aviso` quando o texto parece página de bloqueio, é curto demais ou tem página de PDF sem texto. PDF só de imagem dá erro e não grava nada. Url repetida atualiza a mesma fonte (mesmo id, `acessado_em` novo); se o texto mudou, os fatos dela são procurados de novo no texto novo (`fatos_reconferidos`) e o texto antigo fica em `pesquisa/fontes/<id>.<8 primeiros do sha256 antigo>.txt` (`texto_anterior`) |
| `anotar_fonte` | `fonte_id`, `observacao` | acrescenta à observação, com data e autor; nunca apaga o que havia |
| `registrar_fato` | `afirmacao`, `fonte_id`, `trecho`, `localizador?`, `nota?` | confere trecho, dígitos e vigência e grava o fato; nunca recusa (fonte fora da pesquisa ou sem o texto na pasta: grava como não encontrado, com `aviso`) |
| `listar_pesquisa` | `fonte_id?` | fontes (sem o texto) e fatos; com `fonte_id`, só aquela fonte e os fatos dela |
| `texto_da_fonte` | `fonte_id`, `pagina?` ou `inicio?`/`fim?` | o texto paginado (6.000 caracteres) ou o recorte |
| `checar_texto` | `documento?` ou `texto?` | avisos das regras de conteúdo (OAB, empresa, pessoa, número sem fato) sobre todos os textos do documento (no roteiro do carrossel narrado, também as linhas do gancho, as etiquetas e a narração de `video/palavras.json`); no vídeo de cenas, os blocos com número e sem `refs`; e se o documento termina com a frase de fecho (`ultima_frase`). Só informa |

`projeto_info` passa a contar fontes e fatos. Sem rede (`registrarFerramentas` chamado sem o 5º parâmetro), `ler_fonte`
responde "este MCP não tem acesso à rede". A rede sai de `criarRede` (em `ferramentas-mcp.ts`, junto do tipo `Rede`):
User-Agent "Mozilla/5.0 (compatible; Estudio/<versão do app>)" (`src/nucleo/versao.ts`), 40 s, até 20 MB lidos em pedaços (vale
também sem Content-Length), segue redirecionamentos, só http/https. No app ela usa o `net.fetch` do Electron e entra pelo
construtor do `McpHttp` (`src/main/mcp-http.ts`); no MCP por stdio (`mcp/nucleo.ts`) e nos testes, o `fetch` do Node.

## Regras de conteúdo (`src/nucleo/regras.ts`)

`checarTexto` compara sem acento, em minúsculas e por palavra inteira, como o `conferir_capa.py` de outro projeto.
Devolve só avisos (`oab`, `empresa`, `pessoa`, `numero_sem_fato`). O filtro de nome de empresa e de pessoa vale **só para
o texto do vídeo**: a fonte e o fato guardam os nomes como estão no original. "vale" avisa, não reprova (é verbo comum).

## O que não é censurado

Nada da fonte. O texto gravado em `pesquisa/fontes/` é o da página, limpo de HTML e mais nada: nomes de pessoas e de
partes, número de OAB, CNPJ, número de processo, valores e trechos revogados ficam como no original. O riscado aparece
marcado, não apagado. A observação da fonte só cresce. As regras de conteúdo olham o texto do vídeo (blocos, falas, legenda),
nunca a pesquisa.

## Medição contra o gabarito

O gabarito da fase 0 (`tasks/estudio-pesquisa-e-grosso-2026-11-06/fase-0/gabarito.json`) tem 200 pares afirmação ×
trecho: 100 verdadeiros e 100 falsos de cinco tipos. Todos os trechos saem `exato` no texto limpo da fonte, então o
estado de cada par depende só da conferência dos números. Medido em 06/11/2026, antes e depois do leitor de números
desta versão (identificadores, ordinais, datas, "um" antes de unidade e adjetivos de prazo):

| Tipo | Pares | `a_revisar` antes | `a_revisar` depois | `trecho_confere` depois |
|---|---|---|---|---|
| verdadeiro | 100 | 10 | 2 | 98 |
| dígito trocado | 30 | 29 | 28 | 2 |
| inversão | 20 | 2 | 4 | 16 |
| norma revogada | 20 | 4 | 5 | 15 |
| generalização | 15 | 1 | 0 | 15 |
| fonte errada | 15 | 6 | 6 | 9 |
| **falsos (soma)** | 100 | 42 | 43 | **57** |

- **Os 2 verdadeiros que seguem em `a_revisar`:** P12-01 ("1 ano" × "12 (doze) meses": a conta não converte unidade) e
  C1-02 ("multa no valor de um salário" × "em valor equivalente ao seu salário": com "um salário" valendo 1, o 1 não
  está escrito no trecho). Os 8 que saíram eram falso alarme: Emenda 141 e o ano dela, Reforma da Previdência de 2019,
  "11/11/2017" × "11.11.2017", "dia 20" × "vigésimo dia", o 13º salário (duas vezes), "1 ano" × "um ano" e
  "5 anos" × "quinquenal".
- **O que se perdeu, e por quê:** C7-06 (dígito trocado) só caía porque o 141 da Emenda faltava no trecho; o erro de
  verdade ("dois meses" para as 40 horas, que é o prazo das 42) tem os números todos no trecho. C3-08 (generalização)
  caía pelo mesmo acaso, com o 2019 da Reforma.
- **O que se ganhou:** "multa de um salário" e "como um dia normal" passaram a pedir o 1 (C1-08 e C6-08, inversões), e
  "primeiro dia útil" também (C1-09, norma revogada).
- **As marcas de vigência** não mudaram: "revogado", "cancelada" ou "superada" a 600 caracteres do trecho aparecem em
  30 verdadeiros, 8 dígitos trocados, 8 inversões, 17 normas revogadas, 2 generalizações e 2 fontes erradas. A marca
  sozinha não separa verdadeiro de falso, por isso o painel pede para ler a fonte.

**O código prova trecho e números, não sentido.** Ele diz que o trecho está na fonte e que os números da afirmação estão
no trecho; não diz se a afirmação lê o trecho direito. Inversão ("perde a multa" contra "também fará jus"), norma
revogada com o número certo, generalização e trecho de outra regra com os mesmos números passam. Até haver um juiz (o
modelo lendo afirmação e trecho, fase 3), 57 dos 100 falsos saem como trecho confere. Por isso o estado se chama
`trecho_confere` (até 06/11/2026 era `fato`): diz o que o código provou, não que a afirmação é verdadeira.

O script da medição só lê (gabarito e textos da fase 0) e chama `acharTrecho`, `conferirDigitos`, `entorno`,
`sinaisDeVigencia` e `estadoDoFato`; leva uns 11 a 25 s, quase tudo em `acharTrecho` na CLT inteira.

## Limites conhecidos (06/11/2026)

- **Planalto bloqueia a rede do escritório por IP de origem.** O `del5452compilado.htm` responde "Acesso Negado!" (814 B)
  a curl, .NET, WebFetch e até ao Chromium deste PC e do Mac mini; um servidor de fora da rede do escritório baixa a CLT inteira (1,5 MB). Até a
  liberação pelo canal oficial ou a leitura por um servidor nosso, a CLT atualizada vem da Câmara (LEGIN) ou de um texto
  baixado por esse servidor. Detalhe em `tasks/estudio-pesquisa-e-grosso-2026-11-06/fase-0/achados-acesso.md`.
- **O Planalto injeta um script f5 depois do `</html>`** (`<script id="f5_cspm">` com token aleatório). A limpeza tira o
  script e o hash é do texto limpo normalizado, então o mesmo texto dá o mesmo sha256 em cada visita.
- **LexML SRU fora do ar:** a busca pede desafio em JavaScript e `/busca/SRU` dá 404 do Tomcat. Senado Normas e Dados
  Abertos do Senado abrem por programa e levam ao texto atualizado.
- **Página montada por JavaScript** não vem inteira pelo `fetch`. Uma janela fora da tela do próprio Electron resolveria;
  fica para depois.
- **O "parecido" não prova citação:** serve para a pessoa achar o trecho e o Claude corrigir; só o `exato` pode dar `trecho_confere`.
- **Números por extenso** cobrem unidades, dezenas, centenas e mil, compostos com "e" ("trezentos e sessenta e cinco" =
  365, "mil quatrocentos e doze" = 1412). "Milhão" só multiplica algarismo ("1,5 milhão"); "dois milhões" vira 2.
- **A conta não converte unidade:** "1 ano" contra "12 (doze) meses" fica com o 1 faltando (P12-01 do gabarito).
- **"um"/"uma" antes de unidade contam como 1** ("um ano", "um salário"). Efeito colateral: "multa no valor de um
  salário" contra "em valor equivalente ao seu salário" fica com o 1 faltando (C1-02 do gabarito, verdadeiro em
  `a_revisar`). Em troca, "multa de um salário" contra "dois salários" é pego. Antes de outras palavras ("uma multa",
  "um dos quais") seguem sendo artigo.
- **Ordinal só conta antes de unidade de tempo.** "O 7º e o 120º dia" pede só o 120; "na primeira vez" não pede nada.
- **"anual" vale 1:** "férias anuais" na afirmação pede um 1 no trecho; se o trecho não tiver, vai para a revisão.
- **Data sem ano** ("30/04") não é data: vira 30 e 4. Ano de dois dígitos só com barra ("11/11/17") e fica como está,
  sem virar 2017. Dia e mês são conferidos só por faixa (1 a 31, 1 a 12).
- **Tempo no processo principal:** cada `ler_fonte` ou `registrar_fato` numa fonte do tamanho da CLT inteira prende a
  interface por perto de 0,2 a 0,3 s (limpeza, busca do trecho e leitura e gravação síncronas de uns 650 KB). A rede é
  assíncrona. Mover a conferência para um worker fica para depois.

### PDF (12/11/2026)

- **Sem OCR.** PDF digitalizado (só imagem) dá erro; página só de imagem no meio de um PDF com texto fica de fora, com
  `aviso`. Texto desenhado como curvas (sem fonte) também não é texto para o PDF e não sai.
- **Ordem de leitura é a do arquivo.** O pdf.js entrega o texto na ordem em que o PDF o desenha. Página em duas colunas
  (Diário Oficial, alguns acórdãos) costuma vir coluna por coluna, mas um PDF montado fora de ordem sai fora de ordem, e
  o trecho que atravessa a coluna pode não sair `exato`. Tabela vira uma linha por linha da tabela, com as células
  separadas por espaço. Nota de rodapé fica onde está na página (no pé, antes do texto da página seguinte), então um
  trecho que atravessa a página onde há nota de rodapé no meio cai para `nao`.
- **Hífen:** a regra (junta quando a linha de baixo começa com minúscula; o hífen fica se o documento escreve a palavra
  com hífen em outro lugar) erra em palavra composta partida no hífen que aparece uma vez só no documento
  ("auxílio-" + "doença" vira "auxíliodoença"). Nome próprio e sigla depois do hífen (linha de baixo com maiúscula) não
  juntam. Quem copia o trecho do PDF aberto no navegador traz o hífen do fim da linha ("Previdên- cia"), e esse trecho
  não casa nem como `parecido`: o trecho vem de `texto_da_fonte`, não do PDF aberto.
- **Cabeçalho e rodapé:** só a partir de 3 páginas, só nas 2 primeiras e 2 últimas linhas de cada página e só a linha
  que se repete em pelo menos metade delas. Cabeçalho que varia mais que os números (o nome da parte em cada página, a
  data por extenso) fica; linha de assinatura do PJe com mais de 160 caracteres fica. A linha com a mesma cara no meio
  das páginas (uma lista numerada) é texto e não sai.
- **Marcas de vigência no PDF** são as mesmas do HTML, procuradas no texto. O riscado não existe no PDF como marca: o
  texto riscado de uma lei compilada em PDF sai como texto comum, sem "[riscado: ]".
- **Tempo:** num PDF de 300 páginas e 1,4 milhão de caracteres (gerado no teste), a extração levou uns 1,2 a 1,5 s; o
  `hashTexto` uns 80 ms e o `acharTrecho` sem achar uns 0,4 s. O pdf.js roda no processo principal, sem worker, mas a
  leitura é assíncrona por página.

## Notas de implementação

Decisões que vão além do texto do contrato da fase 1, para quem revisa:

- **Decodificar e limpar:** `decodificar` respeita o BOM e, sem charset declarado, tenta UTF-8 estrito antes do
  windows-1252 (o Planalto não é UTF-8 válido e cai no windows-1252). `limparHtml` também tira o `<head>` (o título sai
  por `tituloDoHtml`) e não deixa marcador de riscado vazio.
- **Normalizar:** tira espaço nas pontas das linhas e quebra de linha nas pontas do texto.
- **Leitor de números:** `tokens` lê o texto sem acento e em minúsculas: número com o sufixo de ordinal colado ("13º",
  "1o", "1.º"), data como um token só (dd/mm/aaaa; "24 de julho de 1991" também), "/" separado ("13.467/2017" vira
  13467, "/", 2017). `lerNumeros` marca cada número como `valor`, `identificador` ou `nome` (ordinal com símbolo fora de
  unidade de tempo). `numerosDe` devolve valores e identificadores (a regra `numero_sem_fato` das regras de conteúdo continua
  vendo "Lei 13.467" no texto do vídeo), sem os nomes. `conferirDigitos` pede só os valores da afirmação e aceita tudo
  o que está escrito no trecho, inclusive identificadores, ordinais com símbolo e o ano de cada data. Desvio do pedido
  de 06/11: o ordinal por extenso também só vira número antes de unidade de tempo, porque "segundo" é "conforme",
  "décimo terceiro" é o nome do salário e "primeira vez" não é prazo; e o ordinal com símbolo antes de unidade de tempo
  ("120º dia") é quantidade, para não perder o P11-10 do gabarito.
- **Tempo no processo principal:** o MCP por HTTP vive no processo principal, então tudo aqui roda nele. Na CLT inteira
  (657 mil caracteres), medido em 06/11: `limparHtml` uns 100 ms, `hashTexto` uns 80 ms, `acharTrecho` uns 110 ms
  quando acha exato e até 180 ms quando não acha (o texto da fonte é indexado uma vez só, e o ASCII passa sem NFC nem
  expressão regular). O painel não roda nada disso: usa `inicio`/`fim` gravados, e o texto da fonte chega pelo
  processo principal com leitura assíncrona (`Projeto.lerTextoFonteSemTravar`).
- **Fixture:** a pauta C1 do gabarito tem só 6 pares dentro do art. 477 (os outros 4 são do art. 484-A e do TST).
  `testes/fixtures/pesquisa/pares-c1.json` completa os 8 com P17-01 e P17-02 (art. 477, § 2º e caput), com o campo
  `pauta` para deixar claro. Conferido fora do teste: os 79 trechos do gabarito tirados da CLT inteira saem `exato` no
  texto limpo, e o único verdadeiro com dígito faltando é o C1-02 ("um salário"; os testes tratam a exceção pelo
  nome). No arquivo real baixado pelo servidor de fora, o `<script id="f5_cspm">`
  está antes de `</body>`, não depois de `</html>`; o fixture guarda a posição real e o teste do hash cobre as duas.
- **`ler_fonte`:** HTTP 400 ou mais não grava fonte: devolve erro com o status e os 200 primeiros caracteres da resposta
  ("Acesso Negado!"), para o Claude procurar outro caminho; o status é conferido antes de tudo, então um 403 que devolve
  PDF diz "HTTP 403". PDF com 200 é lido pela camada de texto (veja "Ler o PDF" e a biblioteca abaixo); só o PDF sem
  texto nenhum, com senha ou estragado dá erro, e nada é gravado. `text/plain` é gravado como veio. Página
  de bloqueio com HTTP 200 ("Request Rejected" do F5) vira fonte, porque a pesquisa só mostra, mas o retorno traz um
  `aviso`. A url repetida mantém o id, o autor original e a observação; uma observação nova entra como linha
  acrescentada. Toda linha da observação tem o carimbo `dd/mm/aaaa hh:mm · autor: texto` (hora local), também no
  `anotar_fonte`. Quando o texto relido muda (outro sha256), cada fato da fonte é procurado de novo: `achado`, `inicio`,
  `fim`, `vigencia` e `estado` saem do texto novo; afirmação, trecho e dígitos ficam. O texto antigo não é apagado:
  antes de gravar o novo, `Projeto.guardarVersaoTextoFonte` o renomeia para `<id>.<sha8>.txt` (também fora do git), e o
  retorno traz `texto_anterior` com o caminho. Tudo isso vale igual para o PDF: o hash é do texto extraído normalizado
  (o mesmo texto em PDF e em `.txt`, com linha em branco no lugar do `\f`, dá o mesmo sha256) e a regravação, os fatos
  reconferidos e o texto anterior seguem o mesmo caminho do HTML.
- **A biblioteca do PDF: `unpdf` 1.9.1** (MIT, uns 2,2 MB instalada; põe de 1,7 a 2,4 MB no pacote do processo
  principal e no do MCP). É o pdf.js da Mozilla (Apache-2.0, a 6.4.299 dentro dela) num arquivo só, feito para rodar fora do
  navegador, sem worker e sem binário nativo: o `pdf-lib` que o projeto já tinha só escreve PDF, não extrai texto. O
  `pdfjs-dist` direto pesaria 37 MB, pede um worker que no Node vira `import()` dinâmico de outro arquivo (ruim de
  empacotar com o esbuild do MCP e o Vite do processo principal) e pede Node 22.13 ou mais novo. Escolhida a 1.9.1 (19/10/2026) e não a 2.x, que tinha duas semanas de vida.
  O `@napi-rs/canvas` (nativo) é dependência opcional do `unpdf` só para desenhar páginas: não é instalado nem usado.
  Só `src/nucleo/pdf-texto.ts` importa o `unpdf`; a interface não. Cuidados: o pdf.js avisa por `console.log`, e no MCP
  por stdio a saída padrão é o protocolo, então ele roda com `verbosity: 0`; ele toma posse do buffer que recebe, então
  recebe uma cópia; o `unpdf` põe um `DOMMatrix` mínimo em `globalThis` quando não há um (o Node não tem), para o pdf.js
  carregar. No pacote do Vite o pdf.js sai num pedaço à parte (`pdfjs-*.js`, ao lado do `main.js`), carregado na
  primeira leitura de PDF; no MCP por stdio, dentro do `nucleo.cjs`. Conferido em 12/11: o pacote do esbuild do MCP
  roda no Node 24 e no Node do Electron 42 (`ELECTRON_RUN_AS_NODE`) sem escrever nada na saída padrão, e o Vite do
  processo principal gera o pedaço `pdfjs-*.js` com `require("./pdfjs-….js")`.
- **`registrar_fato` nunca recusa um fato.** Fonte que não está na pesquisa ou sem o texto na pasta (clone sem
  `pesquisa/fontes/`) ou trecho vazio: grava com `achado: "nao"` (e, nos dois primeiros casos, devolve um `aviso`).
  A afirmação continua obrigatória (sem ela não há fato; vazia, o erro diz "afirmacao vazia: diga o que o trecho
  sustenta"). A única outra exceção é o `pesquisa.json` ilegível
  (JSON quebrado): gravar por cima apagaria a pesquisa inteira, o que fere o "nada é apagado"; o erro diz o motivo.
- **Diário:** cada fonte lida, observação e fato vira uma entrada com `documento: "pesquisa/pesquisa.json"` e o patch e o
  inverso de verdade (`Projeto.alterarPesquisa`), no formato de sempre, sem mexer no `aplicarPatch`. O Ctrl+Z ignora
  (é do agente); o Histórico mostra e a loja avisa "Claude: fonte lida: <host>".
- **`checar_texto`:** no vídeo de cenas, os `refs` da cena valem para os blocos dela, o número do bloco `numero` entra
  como "prefixo+ate+sufixo" e a frase de fecho é procurada no último bloco com texto. Nos outros documentos, olha os
  campos `texto`, `itens`, `rotulo`, `titulo`, `legenda`, `fala(s)`, `linhas`, `prefixo`, `sufixo`, `t`, `tag` e
  `rotulo_partes`, com o JSON Pointer em `onde`, e a narração do arquivo apontado em `palavras` (`onde: "narração"`),
  onde também procura a frase de fecho.
- **`.gitignore`:** projetos novos já saem com `pesquisa/fontes/`; em projetos antigos, `Projeto.gravarTextoFonte`
  acrescenta a linha quando falta (cria o arquivo se não houver), sem mexer no resto.
- **CLAUDE.md:** projetos com vídeo ou imagem ganham a seção "## Pesquisa". O "Ver um pronto" copia o projeto
  de exemplo (`exemplos/<pasta>`, `src/nucleo/exemplo.ts`) inteiro e não gera CLAUDE.md por cima; o CLAUDE.md do exemplo
  deve trazer a seção igual à de `secaoPesquisa()` (o teste confere no projeto de teste), e o `.gitignore` dele,
  `pesquisa/fontes/`. Se uma cópia antiga do
  exemplo vier sem a seção, `gravarPlano` a acrescenta, uma vez só. O `.gitignore` do projeto novo é o `GITIGNORE` do
  app, gravado por cima do copiado.
- **Interface:** a loja guarda `pesquisa` e relê quando o arquivo mudado começa com `pesquisa/`; se a leitura falha, o
  painel mostra o motivo e um "Tentar de novo". A etiqueta do inspetor mostra a afirmação ao lado do id e, clicada,
  traz o painel Pesquisa à frente (`verFato` na loja, `quandoVerFato` na casca). O estilo do painel e das etiquetas
  (`.etiqueta-fato`, inclusive o botão de tirar) mora em `paineis/pesquisa.css`. A chave do layout salvo foi para `v6`.
  O rótulo da observação na tela é "Observação de quem baixou". O texto de cada fonte fica em
  memória só na última versão e sai na troca de projeto. Selecionar texto num cartão de fato não dispara o clique. As
  marcas de vigência aparecem pelo rótulo do mapa `ROTULO_VIGENCIA` do painel (pesquisa.ts guarda o pedaço procurado,
  como "(Revogad"; marca nova sem rótulo sai sem o parêntese), o filtro também acha pelo rótulo, e o cartão de fato com
  marca leva uma linha discreta: "marca de vigência perto do trecho: leia a fonte; a marca sozinha não diz se o trecho
  vale". A fonte em PDF leva o selo "PDF" ao lado do nível, o rodapé do cartão diz "PDF de N páginas" e, no texto,
  cada `\f` vira uma linha discreta "página N do PDF" (o cabeçalho do texto diz em que página do PDF a fatia de 6.000
  caracteres começa); a marca do trecho atravessa essa linha. Fonte lida antes desta versão não tem `tipo` e aparece
  como antes.
- **Prévia web:** `scripts/previa-web/ponte.ts` traz uma pesquisa de exemplo (f1 Planalto, f2 Câmara, f3 PDF do TST de
  duas páginas; F1 trecho confere, F2 com dígito faltando, F3 parecido, F4 atravessando a quebra de página do PDF) e o
  primeiro bloco do vídeo novo já cita `F1`. Na worktree a prévia dá 403 nas fontes de
  `node_modules` (a junção aponta para fora da raiz do Vite, `server.fs.allow`); não afeta o painel.
- **Não conferido:** o `net.fetch` do Electron no app de verdade (os testes usam o `fetch` do Node contra 127.0.0.1) e o
  painel no app empacotado. Do PDF: o app empacotado lendo um PDF de verdade (só o pacote do MCP e o build do Vite
  foram conferidos) e PDFs reais de tribunal e do Diário Oficial (os testes geram os PDFs com o `pdf-lib`). A janela só abre `https://` pelo `setWindowOpenHandler`; o `abrirFonte` aceita também
  `http://`, como pede o contrato.
- **Para depois:** `pesquisa.ts` importa `node:crypto` (só `hashTexto`), e `regras.ts` importa `numerosDe` de
  `pesquisa.ts`; a interface importa os dois só com `import type`. Se o painel precisar rodar `checarTexto` ou
  `acharTrecho` no renderer, `hashTexto` vai para um arquivo só do Node.
