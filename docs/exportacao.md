# Vídeo curto e exportação

Versão 1, de 07/11/2026 (rodada 2, frente C: zoom dinâmico nas imagens e marca d'água por rede). Junta o que a
exportação faz desde a rodada 1 (diálogo com destinos, formato, qualidade, escala, trecho, estimativa, andamento e
Cancelar; zona segura no monitor; lâmina) com o que entrou agora. Vale para o vídeo de cenas (`"tipo": "cenas"`); a
marca d'água vale também para o carrossel narrado da Cliente.

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
encaixe "Preencher" (`ajuste: "cobrir"`). Em "Inteira" (`conter`) a foto pode ter faixas vazias, e elas se movem junto.
Como tudo é relativo à caixa, o mesmo documento serve nos quatro formatos.

Na interface: o grupo **Movimento** no inspetor do bloco de imagem (tipo, intensidade, suave) e o botão
**Movimento em todas as imagens** na barra da lista de cenas, que põe movimento nas imagens paradas alternando
aproximar, deslizar para a direita, afastar e deslizar para a esquerda; quando todas já se movem, o mesmo botão tira de
todas. Tudo passa pelo diário (Ctrl+Z desfaz).

Limite conhecido: a lâmina (Ctrl+K) que corta uma imagem com movimento deixa o movimento inteiro em cada metade (ele
recomeça no corte).

## Marca d'água por rede

No diálogo de exportar, a linha **Marca d'água** edita a escolha de cada destino marcado (com vários, os botões 9:16,
4:5… escolhem qual se edita): ligar, **logo** ou **assinatura** do kit de marca, canto, tamanho (altura, de 3% a 15% do
lado menor; padrão 6%) e opacidade (20% a 100%; padrão 85%). Ao lado, uma miniatura com um quadro de verdade do vídeo
no tamanho do destino, a marca e as zonas da rede apagadas por cima. O destino com marca ligada ganha um carimbo na
lista.

- **De onde vem:** no vídeo de cenas, `tema.logo` e `tema.assinatura` (o kit de marca põe os dois); no carrossel da
  Cliente, `logo` e `marca.insta`. Sem nenhum dos dois, a linha avisa para aplicar um kit. Se o conteúdo pedido faltar, vai o
  outro. O logo vai como está, sem sombra nem filtro (o manual da Cliente não deixa o logo levar efeito); a assinatura sai em
  branco, na fonte do tema (no carrossel, IBM Plex Sans), com uma sombra curta para ler em fundo claro.
- **Onde fica:** o canto padrão é o livre de cada rede: em cima à direita no 9:16 (logo abaixo do nome do perfil; a
  coluna de ícones só começa no meio do quadro), embaixo à direita no 4:5 (dentro dos cortes 1:1 e 3:4 da grade) e em
  cima à direita no 16:9 (abaixo do título; embaixo ficam os controles e a marca do próprio canal). Escolhido o canto,
  `posicaoSegura` (`src/nucleo/zonas-seguras.ts`) acha a posição mais perto dele que fica dentro do quadro e dos cortes
  (`miolo`) e fora das áreas cobertas e da área das legendas, a 3,5% do lado menor de cada borda. O quadrado só leva a
  margem (as zonas do 4:5 não servem para 1:1). Um tamanho personalizado usa as zonas da proporção mais parecida. Se a
  marca for grande demais para caber livre, o diálogo avisa.
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
- Nenhuma dependência nova. O `Thumbnail` da miniatura é do `@remotion/player`, que o app já usa.

## Como foi conferido

- `npm run typecheck` e `npm test` (147 testes: os 131 da `main` e 16 novos em `testes/movimento.test.ts` e
  `testes/marca-dagua.test.ts`; entre eles, a marca fora das zonas em todo formato, canto e tamanho, e as preferências
  juntando por destino).
- Prévia web (`?vista`, porta 5204): "Escolher imagem" devolve fotos sintéticas e o kit da Cliente ganha um logo de exemplo
  (`scripts/previa-web/ponte.ts`); o movimento aparece no monitor e no inspetor, e o diálogo mostra a miniatura e
  lembra a escolha.
- `npx tsx scripts/exportar-teste-kenburns.mjs` renderiza três fotos com movimento nos quatro formatos com o logo e uma
  vez sem, e tira quadros de cada MP4 com o ffmpeg do compositor do Remotion (testes/saida/kenburns/, fora do git).
  Neste PC, com escala 0,5: cinco MP4 em 57 s.
- Não conferido: o app Electron de verdade (o antivírus bloqueia o de desenvolvimento).
