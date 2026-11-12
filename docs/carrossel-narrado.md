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

O que falta para chegar ao carrossel do roteiro:

- **Narração gravada inteira.** Hoje a fala gravada é uma por cena; dividir uma gravação longa em cenas pela transcrição
  ainda não existe.
- **Vinheta do logo, rodapé com a marca, cartão final e os efeitos sonoros de `midia/sfx/`**, que o `CarrosselTema` desenha
  e o vídeo de cenas não.
