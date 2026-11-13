# Carrossel narrado

Vídeo vertical (1080×1920, 30 qps) em que as cenas entram presas às palavras de uma narração. O documento é o
`video/roteiro.json` do projeto (sem `"tipo"`); o resolvedor (`src/nucleo/roteiro/resolver.ts`) o transforma nas props
da composição `CarrosselTema` (`src/composicoes/carrossel/`), em ms de saída: vinheta do logo, gancho, partes, dúvida e
cartão final, legenda palavra a palavra e os efeitos sonoros de `midia/sfx/`.

## Campos do roteiro

- `fonte`: o vídeo ou áudio da narração em `midia/`, tocado em trechos (mudar uma pausa não regrava áudio).
- `palavras`: a transcrição com o tempo de cada palavra (`[{w, s, e}]` em ms da fonte), gerada por `transcrever`.
- `cenas`: começa num `gancho` e termina numa `duvida`; no meio, `parte`s com `tag`, `titulo` e `blocos` (`frase`,
  `nota`, `cartao`, `numero`, `grande`, `itens`, `comparacao`, `regua`, `carimbo`, `documento`, `selo`, `foto`). Cada
  cena depois da primeira tem `inicio`; cada bloco, `em` (e `sai`, opcional) como âncora `"palavra@ms"`: a primeira
  palavra que começa com `palavra` a partir de `ms` da fonte; `"palavra$@ms"` ancora no fim e `"palavra@ms+120"` desloca.
- `rotulo_partes`, `pausas` (`[{depois_de, ms}]`), `decisao` (o selo padrão) e `efeitos` (a pilha de efeitos visuais).
- `tema`: o tema de cores e fontes (`src/nucleo/roteiro/tema.ts`). Hoje há um, `neutro`; nome desconhecido vale o neutro.
- `marca`: `{nome, site, insta}`, o que vai no rodapé, na vinheta sem logo e no cartão final. Vazio não aparece.
- `logo`: arquivo em `midia/` para a vinheta e o cartão final. Sem ele, o primeiro `midia/logo*` do projeto (o kit de
  marca copia o logo como `midia/logo-<kit>.png`).
- `foto`: `{src, credito}`, a foto dos blocos `foto` sem `src`. Sem ela, a primeira outra imagem da raiz de `midia/`, sem
  crédito. O bloco `foto` com `src` e `credito` próprios dispensa a padrão.
- `final`: `{titulo, aviso}` do cartão final; sem eles, um convite para salvar e compartilhar e o aviso de conteúdo
  informativo.

## Roteiros antigos

Os roteiros de antes do tema neutro abrem como antes, com outra paleta: `"tema": "c2"` vale o neutro, a cor `"cobre"`
de uma linha do gancho vale o destaque e os tons `"cobre"` e `"grafite"` da régua valem o destaque e o neutro. Sem
`marca`, `logo` e `foto` no roteiro, o logo e a foto saem da `midia/` do projeto, como descrito acima.

## Modelo "Carrossel narrado" na tela inicial (Onda B)

**Decisão:** o modelo é um vídeo de cenas com a fala de cada cena em `narracao.texto` (narração por IA, ou gravada por cena),
não um `roteiro.json` novo: o vídeo de cenas já tem a narração, o "Ajustar as cenas à fala" e as legendas palavra a palavra,
e assim o modelo herda a edição, a exportação e o MCP dele.

O modelo (`src/nucleo/modelo-carrossel-narrado.ts`, id `video-carrossel-narrado`, 9:16 fixo) traz gancho, duas partes
(lista e número), dúvida e fecho, com a duração de partida estimada pela fala. O caminho é escrever os textos, gerar a
narração (`narrar`), ajustar as cenas à fala (`ajustar_cenas_a_fala`) e transcrever (`transcrever`, que cria as legendas).

### Bloco preso a uma palavra (feito)

O bloco do vídeo de cenas pode entrar e sair numa palavra da fala, como no roteiro: `em_palavra` e `sai_palavra` usam
a mesma âncora (`src/nucleo/ancora-palavra.ts`, que o resolvedor do roteiro também usa), com o `ms` contado do começo
da cena:

- `"multa@0"`: entra na primeira palavra da cena que começa com "multa"; `"multa@2000"`, na primeira depois de 2 s.
- `"multa$@0"`: no fim da palavra (o natural para `sai_palavra`); `"multa@0+120"` atrasa 120 ms e `"-80"` adianta.

As palavras são as das legendas (geradas por `transcrever`) que começam dentro da cena, já no lugar em que o clipe de
voz está: arrastar a fala leva o bloco junto. Sem legendas na cena, com a âncora mal escrita ou sem achar a palavra, o
bloco fica no `em`/`sai` em ms e o resolvedor devolve um aviso, que o `aplicar_patch` repassa ao agente; a prévia e a
exportação nunca param por isso. O tempo resolvido não sai da cena.

Na tela, o inspetor do bloco tem "Entra na palavra" e "Sai na palavra", com as palavras transcritas da cena e o segundo
de cada uma; escolher grava a âncora e põe o `em`/`sai` no mesmo ponto (o que vale se a palavra sumir). Mudar o tempo em
segundos, no inspetor ou arrastando o bloco na linha do tempo, solta o bloco da palavra naquela ponta. A lâmina
(`dividir_cena`) conta a âncora do novo começo da segunda cena e larga a ponta que o corte define. Pelo MCP, a âncora
muda por `aplicar_patch` (`/cenas/i/blocos/j/em_palavra`).

### Vinheta, rodapé, cartão final e efeitos sonoros (feito)

O vídeo de cenas ganhou o bloco opcional `acabamento` (`src/nucleo/acabamento-video.ts`), com as mesmas peças do
`CarrosselTema`: o logo, a vinheta e o cartão final saíram de `CarrosselNarrado.tsx` para `src/composicoes/marca-video.tsx`
e servem às duas composições (o carrossel desenha igual, conferido quadro a quadro pela marcação).

```json
"acabamento": {"nome": "Escritório Exemplo", "vinheta": {"ligada": true, "duracao_ms": 1600}, "rodape": {"ligado": true},
  "cartao_final": {"ligado": true, "titulo": "Salve e compartilhe com quem precisa", "aviso": "Conteúdo informativo", "duracao_ms": 3500},
  "sons": {"ligados": true, "volume": 0.5}}
```

- **O que aparece** vem do kit de marca do `tema` (`logo`, `assinatura`, as cores e a fonte de título) e do bloco: `nome`
  é quem assina por extenso. Peça presente vale ligada; `false` no interruptor desliga só ela. Sem logo, a vinheta escreve
  o nome (ou a assinatura); sem logo, nome nem assinatura, a vinheta e o rodapé não aparecem e o resolvedor avisa. O cartão
  aparece mesmo sem kit, só com o título (padrão "Salve e compartilhe com quem precisa"; o aviso é vazio de fábrica).
- **Tempo (a escolha):** a vinheta **ocupa o começo da primeira cena** (cobre os primeiros 1,6 s, nunca mais que a cena, e
  some revelando a cena); o cartão final **soma ao fim** (vem depois da última cena, 3,5 s de fábrica, e o `duracao_ms` das
  props cresce esse tanto). Assim nada anda: clipes de áudio, legendas e âncoras de palavra ficam nos tempos de sempre, e a
  música que vai "até o fim do vídeo" cobre o cartão. A linha do tempo mostra o cartão depois da última cena.
- **Rodapé:** uma linha com um filete no destaque, o nome em caixa alta e a assinatura (ou só o logo), na letra de 2,4% do
  lado menor, durante as cenas (some na vinheta e no cartão). Fica o mais embaixo e à esquerda possível fora das zonas da
  rede do formato (`zonas-seguras.ts`, a mesma conta da marca d'água) e da faixa da legenda: no 9:16, acima da faixa de
  484 px que a rede cobre embaixo, e acima da legenda quando há.
- **Efeitos sonoros:** os arquivos que o projeto tem em `midia/sfx/` com os nomes do carrossel (`whoosh.wav` na vinheta e em
  cada troca de cena, `impacto_grave.wav` na vinheta, `pop.wav` no número e em cada item de lista, `swell.wav` antes do
  cartão); o que falta é pulado. O app não traz esses arquivos. Volume de fábrica 0,5 sobre o de cada efeito (metade do
  carrossel) e, quando o efeito cai sobre a narração, o ducking da música o põe 20 LU abaixo da voz (a medida da casa
  para efeito, `docs/audio.md`); efeito sem envelope medido conta como −6 dB, para baixar demais e não de menos. Tocam como mais uma
  faixa de efeitos das props (`acabamento.sons`), fora da linha do tempo; o medidor de loudness do inspetor não os conta,
  mas a exportação mede o arquivo final.
- **Na tela:** no resumo do vídeo (nada selecionado), a seção "Marca no vídeo" liga e desliga cada peça, com quem assina,
  título, aviso, durações e volume. **Pelo MCP:** `aplicar_patch` em `/acabamento` (o bloco inteiro), ou
  `aplicar_marca {acabamento: true}`, que troca o kit e liga vinheta, rodapé e cartão num patch só.
- **Modelo:** com um kit que tenha logo ou assinatura, o "Carrossel narrado" começa por uma cena "Abertura" sem fala, do
  tamanho da vinheta, e vem com vinheta, rodapé e cartão final ligados (os efeitos, desligados). Sem kit, ou com o Neutro,
  o modelo é o de antes.

O que falta para chegar ao carrossel do roteiro:

- **Narração gravada inteira (feito).** Quem grava a fala inteira de uma vez divide a gravação nas cenas pela transcrição:
  o texto falado de cada cena é alinhado às palavras transcritas (ou, sem texto, os cortes caem nas pausas mais longas), e
  cada cena passa a tocar o trecho dela da mesma gravação, com a duração ajustada e as legendas que a âncora de palavra
  usa. Tela: inspetor do vídeo, "Narração gravada inteira"; MCP: `dividir_narracao` (`docs/narracao.md`).
