# Vídeo curto e exportação

Versão 1, de 07/11/2026 (rodada 2, frente C: zoom dinâmico nas imagens e marca d'água por rede). Junta o que a
exportação faz desde a rodada 1 (diálogo com destinos, formato, qualidade, escala, trecho, estimativa, andamento e
Cancelar; zona segura no monitor; lâmina) com o que entrou agora. Vale para o vídeo de cenas (`"tipo": "cenas"`); a
marca d'água vale também para o carrossel narrado.

## Zoom dinâmico (Ken Burns)

Campo opcional `movimento` no bloco de imagem. Sem ele a imagem fica parada, como antes; documento antigo continua
válido e sai igual, pixel por pixel.

```json
{"id": "cena-2-imagem", "tipo": "imagem", "src": "midia/foto.jpg", "ajuste": "cobrir",
 "x": 0, "y": 0, "largura": 1, "altura": 1,
 "movimento": {"tipo": "aproximar", "intensidade": 0.15, "suave": true}}
```

- `tipo`: `aproximar`, `afastar`, `esquerda`, `direita`, `cima` ou `baixo` (os quatro últimos deslizam a imagem para
  esse lado).
- `intensidade`: quanto a imagem cresce, de 0,05 a 0,4 (padrão 0,15). Fora da faixa, volta para dentro dela.
- `suave`: começa e termina devagar (padrão `true`); `false` anda em velocidade constante.

O movimento dura o tempo em que o bloco está na tela (do `em` ao `sai`). A conta fica em
`src/composicoes/cenas/movimento.ts`: escala e deslocamento em frações da própria caixa, aplicados no `<Img>` dentro da
caixa com o excesso escondido. O deslizar nunca passa da folga que a escala dá, então a borda da foto não aparece no
encaixe "Preencher" (`ajuste: "cobrir"`). Em "Inteira" (`conter`, o padrão do bloco novo) a foto pode ter faixas vazias,
e elas se moveriam junto: por isso o botão abaixo passa essas imagens para Preencher, e o inspetor avisa quando uma
imagem com movimento está em Inteira (`movimentoEmInteira`). Como tudo é relativo à caixa, o mesmo documento serve nos
quatro formatos.

Na interface: o grupo **Movimento** no inspetor do bloco de imagem (tipo, intensidade, suave; com movimento em
Inteira, a linha "Em Inteira, as faixas vazias andam junto com a foto" e o botão **Preencher**) e o botão
**Movimento em todas as imagens** na barra da lista de cenas, que põe movimento nas imagens paradas alternando
aproximar, deslizar para a direita, afastar e deslizar para a esquerda e, no mesmo patch, passa para Preencher as que
estavam em Inteira (um Ctrl+Z desfaz as duas coisas). As imagens que já se moviam ficam como estão. Quando todas já se
movem, o mesmo botão tira o movimento de todas e deixa o encaixe como está. Tudo passa pelo diário.

Limite conhecido: a lâmina (Ctrl+K) que corta uma imagem com movimento deixa o movimento inteiro em cada metade (ele
recomeça no corte).

## Marca d'água por rede

No diálogo de exportar, a linha **Marca d'água** edita a escolha de cada destino marcado (com vários, os botões 9:16,
4:5… escolhem qual se edita): ligar, **logo** ou **assinatura** do kit de marca, canto, tamanho (altura, de 3% a 15% do
lado menor; padrão 6%) e opacidade (20% a 100%; padrão 85%). Ao lado, uma miniatura com um quadro de verdade do vídeo
no tamanho do destino, a marca e as zonas da rede apagadas por cima. O destino com marca ligada ganha um carimbo na
lista.

- **De onde vem:** no vídeo de cenas, `tema.logo` e `tema.assinatura` (o kit de marca põe os dois); no carrossel
  narrado, `logo` e `marca.insta`. Sem nenhum dos dois, a linha avisa para aplicar um kit. Se o conteúdo pedido faltar, vai o
  outro. O logo vai como está, sem sombra nem filtro (os manuais de marca não deixam o logo levar efeito); a assinatura sai em
  branco, na fonte do tema (no carrossel, IBM Plex Sans), com uma sombra curta para ler em fundo claro.
- **Onde fica:** o canto padrão é o livre de cada rede: em cima à direita no 9:16 (logo abaixo do nome do perfil; a
  coluna de ícones só começa no meio do quadro), embaixo à direita no 4:5 (dentro dos cortes 1:1 e 3:4 da grade) e em
  cima à direita no 16:9 (abaixo do título; embaixo ficam os controles e a marca do próprio canal). Escolhido o canto,
  `posicaoSegura` (`src/nucleo/zonas-seguras.ts`) acha a posição mais perto dele que fica dentro do quadro e dos cortes
  (`miolo`) e fora das áreas cobertas da rede, da área das legendas automáticas do YouTube e da legenda do próprio
  vídeo, a 3,5% do lado menor de cada borda. O quadrado só leva a margem (as zonas do 4:5 não servem para 1:1). Um
  tamanho personalizado usa as zonas da proporção mais parecida. Se a marca não couber livre, o diálogo avisa.
- **Fora da legenda:** com legenda no vídeo (frente Fala, `docs/legendas.md`), a marca não a cobre. A caixa da legenda
  (`caixaDaLegenda`, em `exportacao.ts`) é o pior caso, com a mesma geometria do `Legendas.tsx`: de margem a margem da
  área (a Faixa da marca, de borda a borda), na posição do estilo, com todas as linhas na letra dele, mais uma folga de
  0,3 da letra. Ela entra em `posicaoSegura` como mais uma área a evitar. Por isso, no 4:5 e no 1:1 com a legenda
  embaixo, a marca do canto de baixo sobe para logo acima dela, e no 9:16 com a legenda "Em cima", a do canto de cima
  desce para logo abaixo dela. Com a legenda do outro lado ou oculta, a marca fica no canto de sempre. A legenda lida é a
  das props que vão ao render daquele destino (`legendasDasProps`); a miniatura do diálogo põe a legenda na área livre
  do destino (`legendasNoDestino`) e mostra a legenda e a marca onde o arquivo vai ter.
- **Só na exportação:** a marca entra nas props (`marca_dagua`, já posicionada em frações do quadro) só quando o
  processo principal exporta, ou na miniatura do diálogo; o `registro.ts` desenha `src/composicoes/MarcaDagua.tsx` por
  cima da composição, fora da pilha de efeitos. O documento e a prévia do monitor nunca a veem. Com a marca desligada,
  o arquivo sai idêntico ao de antes.
- **Lembrada por projeto:** ao exportar, a escolha de cada destino vai para `.estudio/exportacao.json`, dentro do
  projeto (quem abrir a mesma pasta acha a mesma escolha); o diálogo lê de lá ao abrir. Arquivo ausente ou estragado é
  escolha vazia: volta aos padrões, desligada.

```json
{"marca_dagua": {"reels": {"ligada": true, "conteudo": "logo", "canto": "sup-dir", "tamanho": 0.06, "opacidade": 0.85}}}
```

## Para quem mexe no código

- `OpcoesExportarVideo` ganhou `marca_dagua` (por id de destino) e `proporcao_logo` (largura ÷ altura do logo, medida
  pela interface; sem ela, 3). Chamadas antigas continuam valendo e saem sem marca.
- Canais novos no fim do `CANAL`: `prefsExportacao` e `gravarPrefsExportacao` (`src/main/ipc-exportacao.ts`, registrado
  no `main.ts` com uma linha). A assinatura de `renderizarVideo` não mudou: a frente Som entra depois do render.
- `ZonaSegura` ganhou `miolo` (o contorno é o que sobra do corte); a sobreposição do monitor não mudou.
- `posicaoSegura` aceita `evitar` (retângulos em frações, tratados como zonas cobertas), e `marcaDaguaDoDestino`
  aceita as legendas do destino (`LegendasP`, de `legendasDasProps`). No laço de exportação (`src/main/exportacao-video.ts`, antes no `main.ts`), a marca lê a
  legenda das mesmas props que vão ao `renderizarVideo`.
- Nenhuma dependência nova. O `Thumbnail` da miniatura é do `@remotion/player`, que o app já usa.

## Como foi conferido

- `npm run typecheck` e `npm test` (`testes/movimento.test.ts`, `testes/marca-dagua.test.ts` e
  `testes/marca-dagua-legenda.test.ts`; entre eles, a marca fora das zonas em todo formato, canto e tamanho, as
  preferências juntando por destino, o botão passando Inteira para Preencher com um Ctrl+Z só e a marca fora da legenda
  em todo formato, estilo e posição de legenda, canto e tamanho até 10%).
- Prévia web (`?vista`, porta 5204): "Escolher imagem" devolve fotos sintéticas e o kit de exemplo da prévia ganha um logo
  (`scripts/previa-web/ponte.ts`); o movimento aparece no monitor e no inspetor, e o diálogo mostra a miniatura e
  lembra a escolha.
- `npx tsx scripts/exportar-teste-kenburns.mjs` renderiza três fotos com movimento nos quatro formatos com o logo e uma
  vez sem, e tira quadros de cada MP4 com o ffmpeg do compositor do Remotion (testes/saida/kenburns/, fora do git).
  Neste PC, com escala 0,5: cinco MP4 em 57 s.
- Não conferido: o app Electron de verdade (o antivírus bloqueia o de desenvolvimento).

## Rodada 3: correções do vídeo que vai ao ar

Para o guia da IA (texto para o `claudeMd`), no vídeo de cenas e no carrossel narrado:

- **Número com decimais** (video-D8): o bloco `numero` mostra as casas decimais que `de` e `ate` têm (7,5 → "7,5"; 2824,68 →
  "2.824,68"); em dinheiro (`prefixo` ou `sufixo` com "R$" ou "reais") com centavos, sempre duas ("R$ 1.412,50"). Para forçar,
  o campo opcional `casas` (0 a 4) no bloco. Vale também nos blocos `numero` do carrossel narrado.
- **Lâmina sem corte visível** (video-D1): quando a lâmina (Ctrl+K) corta no meio de um bloco, ela põe `segue_ms` na primeira
  metade e `desde_ms` na segunda. **Não edite esses dois campos**: dizem à composição que o bloco continua dos dois lados do
  corte (não some, não entra de novo, a contagem e o Ken Burns seguem). O vídeo dividido sai igual ao inteiro. Se a cena
  seguinte for apagada, o bloco com `segue_ms` só termina no fim da cena, sem o fade de saída.
- **Corte entre cenas** (video-D2, tres-efeitos-D4): o fundo da cena fica sólido até o último quadro; quem some antes do corte
  são os blocos. O fundo do tema entra na camada de efeitos, então os efeitos valem nele.
- **Carrossel: dúvida e foto** (video-D6, video-D7): a cena de dúvida acompanha "ficou" e "procure" na narração mas monta sem
  elas (aviso por palavra). O bloco `foto` aceita `src` e `credito` próprios; sem `src`, vale a foto e o crédito da campanha.
- **Carrossel: legenda** (video-D17): a legenda palavra a palavra termina 16 px acima da faixa que a rede cobre embaixo no
  9:16 (y 1420 de 1920) e cresce para cima; a área livre dos blocos acaba em ~1270.

Conferido: `testes/numero.test.ts`, `testes/corte-limpo.test.ts`, `testes/carrossel-duvida-foto.test.ts` e
`testes/zonas-seguras.test.ts`; e um render fora do Electron comparando, quadro a quadro, o vídeo dividido com o inteiro
(diferença 0 em nove instantes; sem as marcas, média acima de 8) e duas cenas claras sobre tema escuro com Brilho 0,5
(128 em todos os quadros do corte).

### Rodada 3: diálogo de exportar e marca d'água (fechamento)

- **Tamanho personalizado** (video-D5): o campo guarda o que se digita (só dígitos, até 4) e só passa o número ao destino de 16 a
  7680; fora disso o campo fica marcado e o Exportar espera; ao sair do campo, prende à faixa. Digitar 1920 não passa por 16 e 7680.
- **Trecho** (video-D11): as pontas a menos de 50 ms do começo e do fim encostam neles (47,4 s num vídeo de 47,383 s é o vídeo
  inteiro). **Props tardias** (video-D18): se o vídeo termina de montar depois de o diálogo abrir, ele assume o formato, o destino e
  a duração do vídeo, se a pessoa ainda não mexeu em nada; se já escolheu destinos, eles ficam e só o fim do trecho (ainda 0 s) passa à
  duração. A regra é `ajusteDasPropsTardias`, em `src/nucleo/exportacao.ts`.
- **Prévia por destino** (video-D4): linha "Prévia" com uma miniatura por destino marcado, no tamanho dele. Os blocos que a composição
  desenhou e se sobrepõem naquele quadro (a medida é a do DOM, no quadro em que a cabeça parou) ficam destacados e listados antes do
  render; bloco ainda invisível no quadro não conta.
- **Contraste de 3:1 da marca d'água**: o botão **Conferir** (linha "Contraste") renderiza três quadros do destino (25%, 50% e 75% do
  trecho), sem a marca e com ela, e mede na caixa dela o fundo (média do quadro sem a marca) e a cor da marca na tela (os pixels que
  mudaram, já com a opacidade). O pior quadro manda; o mínimo é 3:1 (WCAG para gráficos e texto grande). Abaixo disso, o diálogo
  avisa e oferece **Usar placa escura/clara**, a que mais contrasta com a marca: a placa é a caixa da marca (escura `#171A19` ou clara
  `#F4F0EA`), com respiro de um quarto da altura, e continua fora das zonas da rede e da legenda; com ela aplicada, o diálogo mede de
  novo (a medida passa a ser da marca contra a placa). A escolha vai em `.estudio/exportacao.json` (`"placa": "escura"`).
  Código: `src/nucleo/contraste.ts` (a conta), `src/main/contraste-marca.ts` (o render e a leitura dos pixels, canal
  `medirContrasteMarca`), `scripts/medir-contraste-teste.mjs` (o mesmo caminho fora do Electron).
- **Largura da assinatura medida** (não estimada): o diálogo mede o texto na fonte do kit (canvas) e passa `proporcao_texto`
  (largura ÷ altura da caixa); sem ela, vale a estimativa antiga de 0,6 da letra por caractere. Na prévia web e no vídeo, a caixa tem
  a largura exata do texto.

Conferido: `testes/dialogo-exportar.test.ts`, `testes/contraste.test.ts`, `testes/marca-contraste.test.ts`; na prévia web (digitar 1920,
Trecho num vídeo de 47,383 s, miniaturas por formato com a sobreposição destacada, o fluxo Conferir → Usar placa); e, fora do
Electron, a medida num render de verdade (logo claro em fundo claro quase invisível; com placa escura 8,4:1; assinatura branca em
fundo claro 1,4:1). Na prévia web o "Conferir" devolve uma medida de exemplo (não há render lá).

### Rodada 3: ferramentas MCP da marca d'água

Código: `src/nucleo/mcp-exportar.ts` (uma linha em `registrarFerramentas`), `src/nucleo/prefs-exportacao.ts` (ler e gravar
`.estudio/exportacao.json`, o mesmo código que o diálogo usa) e `src/nucleo/contraste.ts` (o pedido, o registro de quem mede e o texto
da medida). Teste: `testes/mcp-exportar.test.ts`; a cadeia inteira, com render de verdade, em `scripts/medir-contraste-mcp-teste.mjs`.

| ferramenta | classe de permissão | o que faz |
|---|---|---|
| `marca_dagua` | `livre` | Lê ou muda a marca d'água de um destino (`reels`, `feed`, `quadrado`, `youtube`, `personalizado`): `ligada`, `conteudo` (`logo` ou `assinatura`), `canto`, `tamanho`, `opacidade`, `placa` (`escura`, `clara` ou `nenhuma`). Sem campo de mudança, só mostra. Grava `.estudio/exportacao.json` e a mudança entra no diário (autor, origem, patch e inverso). Esse arquivo não é documento: o Reverter do Histórico não o toca, e para desfazer se chama a ferramenta de novo com o `antes` que a resposta traz. |
| `medir_contraste_marca` | `livre` | Renderiza três quadros do destino (25%, 50% e 75%) sem a marca e com ela e devolve o contraste do pior (mínimo 3:1) com o que fazer se ficou abaixo. Os campos de marca opcionais testam outra escolha sem gravar. **Só com o app aberto** (quem renderiza é o processo principal); fora dele devolve erro. Não grava nada nem exporta; leva uns 15 s por destino e usa CPU. |

Para o guia da IA (texto para o `claudeMd`): **a marca d'água não é campo do documento**: é uma escolha por destino, em
`.estudio/exportacao.json`, e só se muda pela ferramenta `marca_dagua` (não por `aplicar_patch`). Ligue a marca no destino que a pessoa
pediu e rode `medir_contraste_marca`: abaixo de 3:1 a marca não lê no fundo (logo claro em fundo claro, por exemplo), e a resposta diz
qual placa pôr atrás (`placa: "escura"` ou `"clara"`); depois de pôr, meça de novo. Sem logo nem assinatura no kit do projeto, a
exportação sai sem marca e a medida avisa. A largura da assinatura é medida no diálogo (canvas); pela ferramenta vale a estimativa de
0,6 da letra por caractere para o encaixe, e o contraste, que é lido nos pixels, não depende dela.

## Pelo MCP: o arquivo final sem clicar em Exportar

O agente entrega o vídeo, a imagem ou o carrossel pelas ferramentas abaixo, com o mesmo resultado do diálogo. Código:
`src/nucleo/mcp-exportacao-final.ts` (as ferramentas, uma linha em `registrarFerramentas`), `src/main/exportacao-video.ts` (a
exportação do vídeo, a mesma do diálogo), `src/main/exportacao-servico.ts` (o serviço montado no app e fora dele) e
`src/renderer/modulos/imagem/exportarPeloMcp.ts` (a janela desenha a imagem e o carrossel). Teste:
`testes/exportacao-mcp.test.ts`.

| ferramenta | classe | parâmetros | com o app fechado |
|---|---|---|---|
| `exportar_video` | `cartao` | `{documento?, destinos?, codec?, qualidade?, escala?, trecho?, nome?, legendas?, marca_dagua?}` | roda no processo do MCP |
| `situacao_exportacao` | `livre` | `{exportacao?, cancelar?}` | a do próprio processo |
| `exportar_imagem` | `cartao` | `{documento?, formato?, qualidade?, escala?, nome?}` | erro: "abra o projeto no Estúdio" |
| `exportar_carrossel` | `cartao` | `{documento?, pdf?, nome?}` | erro: "abra o projeto no Estúdio" |

- **`exportar_video`**: vídeo de cenas, carrossel narrado e animação. `destinos` são os ids da tela (`reels`, `feed`,
  `quadrado`, `youtube`) ou `LARGURAxALTURA` (16 a 7680, um personalizado por vez); só o vídeo de cenas muda de
  proporção, e o carrossel narrado e a animação saem no tamanho deles (a resposta avisa). `codec` `h264`, `h265` ou
  `webm`; `qualidade` `alta`, `media` ou `leve`; `escala` 1, 0,75 ou 0,5; `trecho` `{de_ms, ate_ms}` (trecho fora do
  vídeo é recusado, não vira o vídeo inteiro); `legendas` `video`, `srt` ou `ambos`, para todos os destinos; a marca
  d'água de cada destino é a guardada em `.estudio/exportacao.json` (ferramenta `marca_dagua`) e `marca_dagua: false`
  tira. A proporção do logo, que o diálogo mede na tela, aqui sai do cabeçalho do arquivo (PNG, JPEG, GIF, WebP; SVG fica
  na estimativa de 3). Uma exportação por vez, somando a da tela: com uma em curso, a outra é recusada.
- **Vídeo longo**: o MCP da IDE espera o app aberto por no máximo 15 min (`PRAZO_DO_APP_MS`, em `mcp-app.ts`), e até 10
  deles podem ir no cartão do portão. Por isso `exportar_video` espera o arquivo até 4 min (`ESPERA_PADRAO_MS`); se o
  render passar disso, devolve `{exportacao, situacao: "renderizando", andamento}` e o render segue no processo que o
  começou (o app, ou o MCP da IDE com o app fechado). `situacao_exportacao` diz o andamento (arquivo, etapa e
  porcentagem), a lista de arquivos quando fica pronta ou o motivo da falha, e `cancelar: true` para o render. Escolhemos
  devolver cedo em vez de só mandar progresso por notificação MCP: o repasse da IDE ao app lê a resposta HTTP inteira (a
  notificação não chegaria antes do fim) e o prazo de 15 min corre igual. As notificações (`progressToken`) também saem,
  enquanto a chamada está aberta, para o cliente que fala direto com o processo que renderiza. As exportações ficam na
  memória do processo (as últimas 20): se o app fecha no meio, o render para e o id some.
- **`exportar_imagem` e `exportar_carrossel`**: desenhados no canvas da janela, pelas mesmas funções do diálogo
  (`exportarPng`, `exportarCarrossel`), com o documento relido antes. O processo principal pede pela ponte com a janela
  (`exportar:imagem`, `exportar:carrossel`) e espera até 4 min. Imagem com páginas é carrossel (`exportar_imagem`
  recusa e indica a outra). O carrossel aceita `pdf: false` (só os PNG) e `nome` para a pasta e o PDF.
- **Permissão**: as três que gravam pedem o cartão no app. Com o app fechado, o MCP da IDE roda sem perguntar (o
  `portao` é `undefined` em `mcp/nucleo.ts`): a permissão é a do harness, de propósito.
- **Resposta**: caminhos absolutos (`arquivos`, `arquivo`, `pdf`), os mesmos relativos ao projeto (`em_saidas`) e, no
  vídeo e na imagem, um `markdown` para a pessoa abrir no chat da IDE.
