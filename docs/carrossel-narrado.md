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
