# Como cabe na tela: decisões de disposição, painéis, atalhos e tema

Estúdio desktop (Electron + React + TypeScript), 05/11/2026. Frente "estilo e disposição". Este documento junta as duas pesquisas da frente: **A**, sobre o costume dos programas tradicionais, e **B**, sobre como caber na tela. Ele **decide**. Quando a decisão vem de uma fonte, a referência aparece como [A n] ou [B n], com o número da lista de fontes da pesquisa correspondente (as principais estão repetidas no fim). Dedução sem fonte vem marcada **[inferência]**. Fato que conheço mas não conferi nesta rodada vem marcado **[conhecimento prévio]**.

Este documento conversa com `docs/desempenho.md` (orçamentos de RAM e GPU) e com o código que já existe em `src/renderer` (`casca/Casca.tsx`, `estilo.css`, `estado/loja.ts`). Quando ele muda algo do código, isso está escrito na seção 12.

---

## 0. Decisões em uma página

1. **Quatro áreas de trabalho em abas na barra de título: Vídeo · Imagem · 3D · Efeitos.** Há também uma **tela inicial**, que aparece sem projeto aberto, e um **diálogo de Exportar**, que não é uma área. Cada área lembra o próprio arranjo e tem "Redefinir layout". É o modelo das abas do Blender, do Cinema 4D e do Affinity unificado, e não o do menu escondido do Premiere [A28][A34][A37][A5].
2. **O mesmo esqueleto nas quatro áreas:**
   - **Estrutura à esquerda:** cenas e blocos, camadas, objetos, pilha de efeitos.
   - **Monitor no centro**, com o trilho de ferramentas colado nele.
   - **Propriedades à direita do monitor**, com as abas Comentários, Histórico e Pesquisa no mesmo grupo.
   - **Terminal do agente na coluna da extrema direita.**
   - **Linha do tempo embaixo**, onde houver tempo.
3. **O terminal fica sempre no mesmo lugar, na extrema direita, e não embaixo.** Embaixo é da linha do tempo, e a altura é o recurso escasso: são 636 px úteis no pior caso comum. A largura sobra, ainda mais com o C2 em 9:16 [B §1][B40]. O agente nunca muda de lugar entre áreas.
4. **Duas faixas de layout no MVP, escolhidas pela janela:**
   - **C (compacta):** largura útil < 1600 ou altura útil < 800.
   - **P (padrão):** o resto.
   - **A (ampla):** fica para depois. Por ora reaproveita a P com colunas mais largas.

   Os layouts são guardados por **área × faixa** [B §1].
5. **Biblioteca de painéis: dockview 8.8.3, com a versão exata fixada e só os recursos MIT.** O plano B é o flexlayout-react. Os presets de layout ficam escritos em código, com `addPanel`, e não como blobs JSON. Assim dá para trocar de biblioteca sem refazer os layouts [B §3].
6. **Atalhos unificados**, com Premiere como base no tempo, Photoshop no 2D e Blender (no keymap Industry) e Maya no 3D. Os verbos comuns usam as mesmas teclas em toda parte. A tabela completa está na seção 6.
   - O terminal em foco recebe quase tudo. O app só segura Alt+1…4, Ctrl+PgUp/PgDn, Ctrl+', Ctrl+Shift+', Ctrl+Shift+P, F3 e F11.
   - As teclas de símbolo são lidas pela posição física, por causa do teclado ABNT2.
7. **Tema escuro em cinza neutro** (croma zero, escala `gray` dark da Radix). Cor só aparece em marcas pequenas, e cada cor tem um significado:
   - azul: seleção e foco;
   - violeta: agente;
   - âmbar: comentário;
   - vermelho: cabeça de reprodução;
   - verde: áudio;
   - rosa: efeitos.
8. **Fonte da interface: a do sistema** (Segoe UI Variable no Windows, SF no macOS), que não pesa nada no pacote. **Fonte do terminal: JetBrains Mono empacotada**, porque a conta de colunas precisa ser igual no Windows e no macOS [inferência].

---

## 1. Áreas de trabalho

### 1.1 O que é cada área

| Área | Documento | Estrutura (esquerda) | Monitor (centro) | Embaixo | Barra do monitor |
|---|---|---|---|---|---|
| **Vídeo** | `roteiro.json` (+ `props.json` resolvido) | **Cenas e blocos**: cena → blocos, com o trecho da narração | Remotion Player | **Linha do tempo**: Cenas, Blocos, Palavras, Narração | Transporte: ⏮ ◀ ⏯ ▶ ⏭, timecode, volume |
| **Imagem** | `*.imagem.json` | **Camadas**: imagem, texto, forma | Canvas da peça, com fundo xadrez de transparência | — | Opções da ferramenta em cima (como no Photoshop [A23]); zoom embaixo |
| **3D** | `*.cena.json` | **Objetos**: câmeras, luzes, primitivas, glTF | Viewport three.js com gizmo e eixos no canto | — (linha do tempo só depois do MVP, quando houver animação) | Vista ▾, câmera ▾, sombreamento ▾ |
| **Efeitos** | Pilha de efeitos do **alvo** (bloco do vídeo ou camada da imagem) | **Pilha de efeitos** (em cima) + **Biblioteca** (embaixo) | Prévia do alvo com o botão "antes" | Linha do tempo, só quando o alvo é vídeo | Alvo: [Vídeo › frase#3 ▾] · ◐ antes |

**Por que a estrutura fica à esquerda e não à direita:**

- **O costume varia entre os programas:**
  - Photoshop, Blender e Cinema 4D põem camadas e outliner à direita [A23][A28][A34];
  - Figma, Godot e Unity põem a estrutura à esquerda e o inspector à direita ([B41][B35]; Unity: [conhecimento prévio]);
  - nos NLEs, a coluna da esquerda é a do Projeto ou do Media Pool [A3][A9].
- **Pesou a largura.** Com o agente ocupando 600 px na extrema direita, a direita já tem duas colunas: Propriedades e Terminal. Uma terceira espremeria o monitor.
- **A conta fecha com a estrutura à esquerda:** estrutura 260 + Propriedades 320 + Terminal 600 deixa o monitor com cerca de 740 px na P.
- **O código atual já faz assim** (o painel `lista` fica à esquerda, em `Casca.tsx`).
- **Quem vem do Photoshop** pode arrastar Camadas para a direita, e o layout fica guardado.

**Na faixa C**, a coluna da esquerda vira uma faixa de borda recolhida (o *edge group* do dockview, com 35 px). Nas áreas sem linha do tempo (Imagem e 3D), a estrutura desce para a coluna da direita, lado a lado com Propriedades, embaixo do terminal (seção 3). O motivo é a falta de largura [B §4.3].

### 1.2 Fora das áreas

- **Tela inicial**, quando não há projeto aberto: "Abrir pasta…" (Ctrl+O), a lista de projetos recentes e "Abrir exemplo C2". Ela ocupa a janela inteira, sem dockview.
- **Diálogo Exportar** (Ctrl+Shift+E): escolhe o formato (MP4 do vídeo ou PNG da imagem), o destino e a qualidade. O andamento aparece na barra de status. A exportação é a única operação que "sai" do projeto. O projeto está sempre salvo (JSON + histórico + git), e por isso não existe a confusão entre Salvar e Exportar do GIMP [A26].
- **Paleta de comandos** (F3 / Ctrl+Shift+P): sobreposta, no topo e no centro.
- **Preferências** (Ctrl+,): escala da interface, entorno do monitor e caminho do `claude`.

### 1.3 Áreas futuras (não entram no MVP)

- **Áudio**, no estilo da Fairlight, só se a mixagem crescer além de "narração + SFX + trilha".
- **Entrega** fica como painel "Exportações" (fila), não como área.
- **Áreas personalizadas e compartilháveis**, como os studios do Affinity [A37].
- Ficam **no máximo seis áreas**: muitas áreas foi a crítica ao Premiere [A1].

---

## 2. Casca comum

### 2.1 Barra de título (36 px)

```
┌ ≡ │ Estúdio · exemplo │ [Vídeo] Imagem 3D Efeitos │      ⌕ Comandos  F3      │ ● 2 agentes · agente editou há 12 s │ ─ □ × ┐
```

- **Itens, da esquerda para a direita:**
  - menu ≡ (Arquivo, Editar, Janela, Ver, Ajuda);
  - nome do projeto;
  - abas das áreas, com o atalho visível na dica;
  - campo da paleta;
  - **estado do agente**: pontos das abas do terminal e a última mudança do agente, que leva ao Histórico;
  - controles da janela.
- **Moldura no Electron** [B23]:
  - `titleBarStyle: 'hidden'` + `titleBarOverlay: {height: 36, color: '#111111', symbolColor: '#b4b4b4'}`;
  - `-webkit-app-region: drag` na barra e `no-drag` nos controles;
  - margens com `env(titlebar-area-x)` e `env(titlebar-area-width)`. No macOS, os semáforos ficam à esquerda e o ≡ vem logo depois.
- **Não há faixa extra de cabeçalho:** a altura extra que o Premiere 22.3 acrescentou foi criticada [A5]. Na faixa C, o nome do projeto encurta (reticências), e o estado do agente vira só os pontos.

### 2.2 Barra de status (22 px na P; na C, oculta por padrão, com Janela › Barra de status)

```
│ V seleção · C lâmina · Espaço tocar · J K L · I O · M comentar │ q 1413/2422 · 30 fps │ frase#3 │ 1 mudança do agente │ 🔒 1 │ 412 MB │
```

Da esquerda para a direita:
- as **teclas da ferramenta e do contexto atual** (como a barra de status do Blender, um pedido explícito de quem está aprendendo [A34]);
- tempo e fps, ou zoom e tamanho do documento;
- a seleção;
- as mudanças do agente desde a última vez que a pessoa olhou, com link para o Histórico;
- os locks abertos;
- a RAM do app, por `app.getAppMetrics()`, que é o selo de `desempenho.md`;
- o andamento da exportação.

**Na C sem barra de status:** as dicas de tecla ficam no tooltip de cada botão, e o estado vai para a barra de título.

### 2.3 Painéis e seus nomes

Glossário único em pt-BR. O id é o usado no código.

| Nome na tela | id (dockview) | O que é |
|---|---|---|
| Cenas e blocos / Camadas / Objetos / Pilha de efeitos | `lista` | Estrutura do documento da área |
| Projeto | `projeto` | Arquivos da pasta (dados, mídia, documentos) |
| Biblioteca | `biblioteca` | Efeitos disponíveis (só em Efeitos) |
| Monitor | `monitor` | Visor da área (Player, canvas, viewport). O nome vem do "Monitor do programa" do Premiere em pt-BR |
| Propriedades | `inspector` | Inspector contextual do que está selecionado |
| Comentários | `comentarios` | Lista de comentários (todos, ou só os do objeto) |
| Histórico | `historico` | Diário de mudanças: cada patch, com autor (pessoa ou agente) |
| Pesquisa | `pesquisa` | Fontes e fatos da pesquisa (`pesquisa/pesquisa.json`), só para ver: selos, vigência, observação de quem baixou, texto da fonte (`docs/pesquisa.md`) |
| Linha do tempo | `linha` | Tempo (Vídeo, e Efeitos com alvo vídeo) |
| Terminal | `terminal` | Abas de sessões `claude`, dentro de um painel só |

**Componentes, não telas:** Estrutura, Propriedades, Comentários, Histórico, Pesquisa e Terminal são os mesmos componentes em todas as áreas. O que muda entre áreas é o documento e o schema [A §6.2].

---

## 3. Disposição de cada área

Contas de pixel (px CSS) [B §1]:
- **1920×1080 a 100%**, janela maximizada (barra de tarefas de 48 px): **1920×974** úteis, descontadas a barra de título (36) e a barra de status (22).
- **1366×768 a 100%:** **1366×684** úteis (sem barra de status na faixa C).
- **Pior caso: 1280×636** (notebook Full HD a 150%), que usa o mesmo preset C.

**Larguras dos painéis:**

| Painel | Mínimo | Ideal |
|---|---|---|
| Monitor | 360×300 | — |
| Propriedades | 260 | 300 (C) / 320 (P) |
| Estrutura | 200 | 260 |
| Terminal | 420 | 560–670 (C) / 600 (P) |
| Linha do tempo (altura) | 140 | 220 (C) / 260 (P) |

Sobre o terminal: o Claude Code troca tabela por lista abaixo de ~70 colunas [B43]. Com JetBrains Mono a 12 px, cada coluna tem 7,2 px, então 80 colunas pedem cerca de 600 px [B §5].

Abas de painel: 28 px (C) / 30 px (P).

### 3.1 Vídeo, 1920×1080 (faixa P)

```
┌ ≡ │ Estúdio · exemplo │ [Vídeo] Imagem 3D Efeitos │   ⌕ Comandos F3   │ ● tempo ◐ logo3d · agente editou há 12 s │ ─ □ × ┐ 36
├ Cenas e blocos | Projeto ┬ Monitor · 50% ▾ · área segura · ◎ ────┬ Propriedades | Coment. 2 | Hist. ┬ Terminal ──────────────────┤ 30
│ ▾ 1 gancho   0:00–0:07   │ ┌─┐                                  │ frase#3              ⧉ /cenas/0/b/3 │ [● tempo][◐ logo3d][○][+] │
│     linha ×3             │ │V│          ┌──────────┐            │ ▾ Tempo                             │                           │
│     frase "Antes de…" ●  │ │C│          │          │            │    entra [Antes@2400 ▾]   ◇        │ claude · tempo            │
│     foto                 │ │H│          │   9:16   │            │    sai   [fim da cena ▾]           │ > o título entra cedo,    │
│ ▸ 2 parte 1              │ │M│          │ 367×652  │            │ ▾ Texto                             │   segura até "Antes"      │
│ ▸ 3 parte 2              │ └─┘          │          │            │    [Antes de responder…]            │ ● nucleo.aplicar_patch    │
│ ▸ 4 parte 3              │              └──────────┘            │ ▾ Transformação  x 0  y 560  t 50   │                           │
│ ▸ 5 fecho                │ ⏮ ◀ ⏯ ▶ ⏭   00:47:03 / 01:20:22  🔊  │ ▸ Efeitos (2)   💬 2 neste bloco    │   ~83 colunas a 13 px     │
├──────────────────────────┴──────────────────────────────────────┴─────────────────────────────────────┤                           │
│ Linha do tempo  ⊢ 0:00 ······ 0:10 ······ 0:20 ······ ◆ ······ 0:40 ··▼··· 0:50 ······ 1:00 ······ 1:20 │                           │
│ Cenas    │gancho────────│parte 1───────────────────│parte 2──────────────│parte 3──────│fecho──│      │                           │
│ Blocos   │lin│lin│frase─│foto──│ │frase│nota│itens─│cartão─│ fx·2                                    │ ctx: exemplo · q1413 ·      │
│ Palavras │Recebeu│mudar│cidade│Antes│de│responder│…                                                  │      frase#3              │
│ Narração │▁▃▅▃▁▂▅▇▅▃▁▁▂▃▅▇▅▃▂▁▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁│                                                       │ [inserir seleção]         │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────┤
│ V seleção · C lâmina · Espaço tocar · J K L · I O · M comentar │ q 1413/2422 · 30 fps │ frase#3 │ 1 do agente │ 412 MB          │ 22
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   260                         ~740                                  320                                    600
```

- **Conta:** 260 + 740 + 320 + 600 = 1920. A altura do monitor é 974 − 260 (linha do tempo) − 30 (aba) − 32 (transporte) = 652, o que dá **367×652 em 9:16**.
- **O terminal desce até a barra de status.** A linha do tempo vai da borda esquerda até o fim de Propriedades (1320 px, cerca de 16 px/s para os 80,7 s do C2).
- **Trilho de ferramentas (36 px) dentro do monitor:** V seleção · C lâmina · H mão · M comentário. O trilho e o transporte fazem parte do componente Monitor e não são painéis, como no Blender e no Photoshop [B §12].
- **Os blocos encaixam nas palavras** (a âncora `palavra@ms`). A tecla S liga e desliga o encaixe, como no Premiere [conhecimento prévio].

### 3.2 Vídeo, 1366×768 (faixa C, variante retrato, que é a do C2)

```
┌ ≡ │ exemplo │ [Vídeo] Imagem 3D Efeitos │ ⌕ │ ●◐ │ ─ □ × ┐ 36
├▤┬ Monitor ───────────┬ Propriedades | Coment. ┬ Terminal [● tempo][◐ logo3d][+] ┤ 28
│▦│┌─┐  ┌──────────┐   │ frase#3        ⧉       │ claude · tempo                     │
│ ││V│  │          │   │ ▾ Tempo                │ > o título entra cedo…             │
│ ││C│  │   9:16   │   │   entra [Antes@2400▾]  │                                    │
│ ││H│  │ 350×622  │   │ ▾ Texto                │  ~93 colunas a 12 px · 434 px alt. │
│ ││M│  │          │   │ ▸ Transformação        │ ctx: q1413 · frase#3               │
│ │└─┘  │          │   ├────────────────────────┴────────────────────────────────────┤
│ │     └──────────┘   │ Linha do tempo · 971×220                                    │
│ │ ⏯ 00:47:03 ◀ ▶     │ Cenas │ Blocos │ Palavras │ Narração                         │
└─┴────────────────────┴─────────────────────────────────────────────────────────────┘
 35        360                   300                       671
```

- É a saída do workspace Vertical do Premiere: **o monitor ocupa uma coluna de altura total** [B28].
- **Conta:** 35 + 360 + 300 + 671 = 1366. Monitor: 684 − 28 − 32 = 622, o que dá **350×622**. Terminal: 671×434. Linha do tempo: 971×220.
- **Faixa de borda à esquerda (35 px):** ▤ Cenas e blocos e ▦ Projeto. O clique abre a coluna empurrando o layout, porque os edge groups do dockview vêm de graça [B6]. Na C, a própria linha do tempo serve de estrutura.
- **Em 1280×636**, o mesmo preset dá monitor de 324×576, terminal de 604×~390 e linha do tempo de 904×220 [B §4.2].
- **Vídeo paisagem (16:9)** fica fora do MVP. Quando entrar, usa a disposição da seção 3.4 com a linha do tempo embaixo do monitor.

### 3.3 Imagem, 1920×1080 (faixa P)

```
├ Camadas | Projeto ──────┬ Monitor · Texto: [Inter ▾] 48 · 700 · ■ #EEEEEE · ≡ alinhar ─┬ Propriedades | Coment. | Hist. ┬ Terminal ────────┤
│ ◉ T  título       ●     │ ┌─┐                                                       │ texto "título"   ⧉ /camadas/0  │ [● capa] [+]     │
│ ◉ ▭  cartão             │ │V│       ┌────────────────────────────┐                 │ ▾ Transformação                │                  │
│ ◉ ▣  foto               │ │T│       │                            │                 │   x 120  y 80  l 840  a 160    │ claude · capa    │
│ ◉ ▭  fundo              │ │U│       │      documento 1080×1350   │                 │   girar 0°                     │ > aumenta o      │
│                         │ │H│       │        ≈ 730×912           │                 │ ▾ Texto  Inter 48 · 700        │   título         │
│ + camada ▾  ⧉  🗑        │ │Z│       │                            │                 │ ▾ Aparência  opac. 100%        │                  │
│                         │ │M│       └────────────────────────────┘                 │ ▸ Ajustes (brilho, contraste…) │                  │
│                         │ └─┘   67% ▾ · ⊞ grade · réguas            [Exportar PNG]   │ ▸ Efeitos (1)                  │                  │
├─────────────────────────┴───────────────────────────────────────────────────────────┴────────────────────────────────┴──────────────────┤
│ V mover · T texto · U forma · Ctrl+T transformar · M comentar │ 1080×1350 · 67% │ título │ 380 MB                                       │
```

- **Conta:** 260 + 740 + 320 + 600. O canvas fica com 740×912 (974 − 30 aba − 32 opções), e a peça 4:5 com cerca de 730×912.
- **Barra de opções da ferramenta** no topo do monitor, como no Photoshop [A23]. **Trilho:** V mover · T texto · U forma · H mão · Z zoom · M comentário.
- **Não há linha do tempo.** A pilha de efeitos da camada aparece resumida em Propriedades ("Efeitos (1)"), como os Smart Filters do Photoshop [A §6.2]. Um clique leva à área Efeitos com a camada como alvo.

### 3.4 Imagem, 1366×768 (faixa C, paisagem)

```
├▤┬ Monitor · Texto: Inter 48 · 700 · ■ ──────────┬ Terminal [● capa] [+] ─────────────────┤ 28
│▦│┌─┐                                            │ claude · capa                          │
│ ││V│         ┌──────────────┐                   │ > aumenta o título e alinha à esquerda │
│ ││T│         │              │                   │   ~76 colunas · Ctrl+' recolhe         │
│ ││U│         │  1080×1350   │                   ├ Camadas ─────────┬ Propriedades|Coment. ┤
│ ││H│         │  ≈ 498×622   │                   │ ◉ T título   ●   │ x 120   y 80         │
│ ││Z│         │              │                   │ ◉ ▭ cartão       │ opacidade 100%       │
│ ││M│         └──────────────┘                   │ ◉ ▣ foto         │ ▸ Ajustes            │
│ │└─┘  67% ▾                                     │ ◉ ▭ fundo        │ ▸ Efeitos (1)        │
└─┴──────────────────────────────────────────────┴──────────────────┴──────────────────────┘
 35              ~771                                   220                 340   (coluna de 560)
```

- **Conta:** 35 + 771 + 560 = 1366.
- **A coluna da direita (560) empilha o Terminal em cima** (cerca de 300 px de altura) **e Camadas | Propriedades lado a lado embaixo** (cerca de 350 px). Com o terminal recolhido (Ctrl+'), Camadas e Propriedades ganham a coluna inteira, e o app parece um editor de imagem comum [B §4.3].
- O agente continua na direita, mas nesta faixa ele divide a coluna. É a única concessão da C.

### 3.5 3D, 1920×1080 (faixa P)

```
├ Objetos | Projeto ──────┬ Monitor · Perspectiva ▾ · câmera: cam1 ▾ · sólido ▾ · 🎥 ver pela câmera ─┬ Propriedades | Coment. | Hist. ┬ Terminal ──────┤
│ ▾ cena                  │ ┌─┐                                                    ┌─────┐          │ logo-exemplo         ⧉ /objetos/3   │ [◐ logo3d] [+] │
│    🎥 cam1              │ │Q│                                                    │  Y  │ eixos    │ ▾ Transformação                │                │
│    💡 luz-chave         │ │W│                 [ objeto com gizmo ]               │ Z┘X │          │   posição  0.00  1.20  0.00    │ claude · logo  │
│    💡 luz-recorte       │ │E│                                                    └─────┘          │   rotação  0     35    0       │ > gira menos e │
│    ◇ logo-exemplo      ●     │ │R│                                                                     │   escala   1     1     1       │   baixa a luz  │
│    ▢ chão               │ │M│                                                                     │ ▾ Material  cobre ■ · rug. 0.4 │   do cobre     │
│ + adicionar  Shift+A    │ └─┘   grade · ⌖ F enquadrar · vistas F1–F4                              │ ▸ Efeitos (0)                  │                │
├─────────────────────────┴─────────────────────────────────────────────────────────────────────────┴────────────────────────────────┴────────────────┤
│ Q seleção · W mover · E girar · R escalar · F enquadrar · Alt+arrastar orbitar │ 4 objetos · 1 selecionado │ logo-exemplo │ 520 MB                    │
```

- O viewport fica com cerca de 740×944 (sem barra de opções: os controles de vista ficam no cabeçalho do painel).
- **Trilho:** Q seleção · W mover · E girar · R escalar · M comentário.
- **Gizmo sempre visível** e indicador de eixos no canto. O Y fica para cima, como no glTF e no three.js [A41][A §10 D3].

### 3.6 3D, 1366×768 (faixa C)

É igual à 3.4 (Imagem C), com **Objetos** no lugar de Camadas:

```
├▤┬ Monitor · Persp. ▾ · cam1 ▾ · sólido ▾ ───────┬ Terminal [◐ logo3d] [+] ───────────────┤
│▦││Q│                                    ┌───┐  │ claude · logo3d                        │
│ ││W│        [ objeto com gizmo ]        │ Y │  │ > gira menos                           │
│ ││E│                                    └───┘  ├ Objetos ─────────┬ Propriedades|Coment. ┤
│ ││R│                                           │ 🎥 cam1          │ posição 0 1.2 0      │
│ ││M│                                           │ ◇ logo-exemplo   ●    │ rotação 0 35 0       │
│ │   F enquadrar                                 │ ▢ chão           │ ▸ Material           │
└─┴──────────────────────────────────────────────┴──────────────────┴──────────────────────┘
 35              ~771                                   220                 340
```

### 3.7 Efeitos, 1920×1080 (faixa P)

```
├ Pilha de efeitos ───────┬ Monitor · alvo: [Vídeo › frase#3 ▾] · ◐ antes (Shift+D) ────────┬ Propriedades | Coment. | Hist. ┬ Terminal ──────┤
│ ☑ Correção de cor       │                                                                  │ Desfoque        ⧉ /efeitos/2   │ [● tempo] [+]  │
│ ☑ Brilho                │                    ┌──────────┐                                  │ raio          [ 12 ]           │                │
│ ☑ Desfoque        ●     │                    │  prévia  │                                  │ intensidade   [ 0.6 ]          │ claude · tempo │
│ ☐ Vinheta (desligado)   │                    │  do alvo │                                  │ ▸ Máscara (depois do MVP)      │                │
│ ☑ Granulado             │                    └──────────┘                                  │                                │                │
│ + adicionar   Shift+A   │                                                                  │                                │                │
├ Biblioteca ─────────────┤   ⏯ 00:47:03                                                     │                                │                │
│ ⌕ buscar efeito         │                                                                  │                                │                │
│ Cor · Correção de cor   │                                                                  │                                │                │
│ Luz · Brilho · Vinheta  │                                                                  │                                │                │
│ Textura · Granulado     │                                                                  │                                │                │
│ Foco · Desfoque         │                                                                  │                                │                │
├─────────────────────────┴──────────────────────────────────────────────────────────────────┴────────────────────────────────┤                │
│ Linha do tempo (alvo vídeo) · 200 px · mesmo estado da área Vídeo: cursor, zoom, seleção                                   │                │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────────────┤
│ Shift+A adicionar · D ligar/desligar · Shift+D antes · Ctrl+D duplicar │ alvo frase#3 │ 4 de 5 ligados │ 460 MB                              │
```

- **A pilha é uma lista de camadas, não um grafo de nós.** Nós como única interface é o que mais confunde quem vem do After Effects [A19]. A visão de nós sobre o mesmo JSON fica para depois, como o Resolve 21 fez ao mostrar nós como lista de camadas [A13].
- **Ordem da pilha:** de cima para baixo é a ordem de aplicação. Para reordenar, arraste ou use Alt+↑/↓ [inferência].
- **A linha do tempo é o mesmo componente e o mesmo estado da área Vídeo.** Trocar de Vídeo para Efeitos mantém cursor, zoom e seleção [B §7]. Se o alvo é imagem, o painel some.

### 3.8 Efeitos, 1366×768 (faixa C)

```
├▤┬ Monitor · alvo: [Vídeo › frase#3 ▾] · ◐ antes ┬ Terminal [● tempo] [+] ────────────────┤
│▦│                                                │ claude · tempo                         │
│ │               ┌──────┐                         │                                        │
│ │               │ 9:16 │                         ├ Pilha ───────────┬ Propriedades|Coment. ┤
│ │               │341×  │                         │ ☑ Correção de cor│ raio      [12]       │
│ │               │ 606  │                         │ ☑ Desfoque   ●   │ intens.   [0.6]      │
│ │               └──────┘                         │ ☐ Vinheta        │                      │
│ │ ⏯ 00:47:03 ━━━━━━━━━━●━━━━━━━━━ (barra de tempo)│ + adicionar ⇧A   │                      │
└─┴───────────────────────────────────────────────┴──────────────────┴──────────────────────┘
 35              ~771                                   220                 340
```

- **Na C, a linha do tempo começa recolhida** (só o cabeçalho). O transporte do monitor ganha uma barra de tempo de 48 px. Assim o monitor fica com 684 − 28 − 48 = 606 de altura, o que dá **341×606 em 9:16**.
- A **Biblioteca** abre como busca sobreposta com Shift+A ou "+ adicionar", no estilo da busca de nós por nome do Nuke e do "adicionar" do Blender [A35][A30].

### 3.9 Regras de redistribuição

- **Faixa:**
  - C se largura útil < 1600 **ou** altura útil < 800; P no resto.
  - Histerese de ±40 px e 300 ms de espera, para não trocar de faixa durante o arraste.
  - Recalculada em `resize` e em `display-metrics-changed`, quando a janela troca de monitor [B §1][inferência].
- **Primeira abertura** de uma área numa faixa: usa o preset. **Depois**, vale o layout salvo daquela **área × faixa**. Ao trocar de monitor, cada faixa recupera o seu.
- **O monitor nunca fica abaixo de 360×300.** Se um painel aberto empurraria o monitor abaixo disso, ele abre como grupo flutuante sobre o monitor, que é recurso grátis do dockview [B4]. É o equivalente ao "visor único em tela pequena" do Resolve [A11].
- **Janela mínima: 1024×600.** Abaixo de 1280 de largura, o terminal recolhe sozinho até o cabeçalho, com os pontos de estado visíveis [inferência].
- **Arrastar divisória:** no máximo um passo por `requestAnimationFrame`. O Player e o canvas redimensionam ao soltar, e o `fit` do xterm espera 80 ms [B §11].

---

## 4. Biblioteca de painéis: dockview 8.8.3

**Escolha: `dockview` 8.8.3**, com versão exata (já está no `package.json`) e **só os recursos do núcleo MIT** [B3][B4].

**Por quê:**

| Motivo | Detalhe |
|---|---|
| Modos de render documentados | `onlyWhenVisible` (padrão: tira do DOM o painel oculto, "the most memory efficient") e `always`, mais o evento `onDidVisibilityChange` [B7]. O Player, o viewport 3D e o xterm precisam pausar e soltar recursos quando somem (`desempenho.md` §4.2) |
| Tudo num pacote | `DockviewReact` (docking), `PaneviewReact` (seções recolhíveis do inspector), `SplitviewReact`/`GridviewReact` [B9] |
| Grátis o que o MVP usa | Edge groups (faixa de 35 px que empurra o layout) [B6], grupos flutuantes, popout, maximizar e navegação por teclado [B4]; `toJSON`/`fromJSON` com edge groups [B6] |
| Tema por variáveis CSS | `--dv-*` [B10], alimentadas pelos nossos tokens |
| Mais usado e mais ativo | 823 mil downloads/semana; 5 versões entre 27 e 30/10/2026 [B18][B2] |
| Sem dependências | Núcleo vanilla, com React como par [B3] |

**Riscos e contenção:**

| Risco | Contenção |
|---|---|
| Open-core: desde a v8 existe o `dockview-enterprise`, proprietário, com marca-d'água sem chave [B4][B5] | Não usar auto-ocultar, sobrepor, "dock to edge" nem histórico de layout (são enterprise). O desfazer de layout se resolve com "Redefinir layout" |
| Ritmo alto de versões | Versão exata; atualizar só com teste. A cada atualização, conferir se algum recurso usado passou para o enterprise |
| Trocar de biblioteca | Presets em código (`presetVideoP(api)`, `presetImagemC(api)`…) e registro de painéis próprio. **Plano B: `flexlayout-react` 0.11.1 (MIT)**, que tem borders recolhíveis e `useUndo` de graça [B11][B12] |
| Popout no Electron | Exige protocolo próprio (`app://`); `file:` é recusado [B8]. Fica para depois do MVP, junto com o segundo monitor |

**Descartados:**
- golden-layout: parado desde 09/2022 [B14];
- rc-dock: Apache-2.0 e pouco uso [B13];
- react-mosaic: ladrilhos, sem docking por abas [B15];
- react-resizable-panels e allotment: só splits [B16].

**Como é usado:**

- **Um `DockviewReact` abaixo da barra de título.** Trocar de área faz `toJSON` da área que sai, `clear()` e `fromJSON` (ou o preset) da que entra. Só a área ativa fica montada (`desempenho.md`: zero áreas pesadas além da visível no perfil leve).
- **O registro de painéis** é uma tabela com `{id, componente, render, minLargura, minAltura}`:

  | Painel | render | mínimo (L×A) |
  |---|---|---|
  | `monitor` | `onlyWhenVisible` | 360×300 |
  | `terminal` | `always` (pausa o WebGL quando some) | 420×160 |
  | `linha` | `onlyWhenVisible` | — × 140 |
  | `inspector`, `lista`, `comentarios`, `historico`, `projeto`, `biblioteca` | `onlyWhenVisible` | 200×120 |

- **O terminal sobrevive à troca de área:**
  - O PTY mora no pty-host (`desempenho.md` §2).
  - No renderer, cada `Terminal` do xterm fica num **registro fora do React**. O painel só anexa `terminal.element` ao próprio contêiner quando monta e chama `fit`, então trocar de área não recria a sessão nem perde o scroll [inferência].
  - Se o renderer cair, o buffer circular do pty-host repõe a tela.
- **Persistência:**
  - No MVP, em `localStorage` com a chave `estudio:layout:v2:<area>:<faixa>`. Ela sobe para v2 porque os presets mudam.
  - Gravação 1 s depois da última mudança. Se o `fromJSON` falhar, volta ao preset.
  - O layout é preferência da pessoa e fica **fora do git do projeto**.
  - Depois: `userData/layouts/*.json` e um `.estudio/layout-sugerido.json` opcional no projeto.

---

## 5. Onde fica cada coisa

| Coisa | Onde | Como chega | Detalhe |
|---|---|---|---|
| **Terminal** | Coluna da extrema direita, em todas as áreas: altura total na P (600 px); na C, 671 px acima da linha do tempo no Vídeo, ou em cima da coluna de 560 em Imagem, 3D e Efeitos | **Ctrl+'** foca ou recolhe; Ctrl+Shift+' abre nova aba | Detalhes logo abaixo da tabela |
| **Comentários** | **Aba do grupo de Propriedades** ("Propriedades \| Comentários \| Histórico") nas quatro áreas. Também aparecem como **pinos no monitor**, **marcas na régua** da linha do tempo e um contador **"💬 N neste objeto"** em Propriedades | **M**: modo comentário (ferramenta no trilho); **Ctrl+Shift+M**: comentário na seleção atual; **Shift+M**: mostra ou oculta os pinos | Detalhes logo abaixo da tabela |
| **Propriedades (inspector)** | À direita do monitor, 300–320 px | Sempre visível na P; Ctrl+Alt+I recolhe | Detalhes logo abaixo da tabela |
| **Estrutura (camadas, objetos, cenas e blocos, pilha)** | Esquerda na P (260 px). Na C: faixa de borda no Vídeo; ao lado de Propriedades, na coluna da direita, em Imagem, 3D e Efeitos | Ctrl+Alt+B recolhe a coluna esquerda | Cada linha mostra ícone de tipo, nome, olho ◉ (visível), cadeado e ● quando há comentário. Arrastar reordena; Delete, Ctrl+D e Ctrl+G valem com foco na lista |
| **Linha do tempo** | Embaixo: 260 px na P, 220 na C. Existe no Vídeo e em Efeitos com alvo vídeo | Ctrl+Alt+L recolhe | Detalhes logo abaixo da tabela |
| **Histórico (diário)** | Aba do grupo de Propriedades | Clique em "N mudanças do agente" na barra de status ou de título | Detalhes logo abaixo da tabela |
| **Projeto (arquivos)** | Aba ao lado da Estrutura (P) ou faixa de borda (C) | Ctrl+O abre outra pasta | Árvore da pasta. Clicar num documento abre na área certa |

**Terminal:**
- As abas das sessões ficam **dentro** do painel, com estado:
  - ● trabalhando (violeta, pulsando);
  - ◐ precisa de você (laranja);
  - ✓ pronto (verde);
  - ○ hibernada (cinza).

  O estado vem dos hooks e do OSC 7501 (relatório 2).
- **Rodapé de 22 px:** chip de contexto e botão "inserir seleção", que cola `@bloco:frase#3` por *bracketed paste* [B §5].
- **Fonte:** JetBrains Mono, 12 px (C) / 13 px (P).

**Comentários:**
- Clique no monitor, na linha do tempo ou no viewport. A aba Comentários abre sozinha.
- Cada item tem "→ aba X" e "nova frente", que mandam o comentário ao terminal.
- Comentário resolvido fica com 45% de opacidade.
- Sobre a tecla M, ver a seção 6.1.

**Propriedades (inspector):**
- **Cabeçalho:** tipo e id do objeto, e o caminho JSON (`/cenas/0/blocos/3`) com botão de copiar.
- **Seções recolhíveis** (Transformação, Texto, Tempo, Aparência, Ajustes, Efeitos), geradas do schema zod: cada campo é um caminho JSON.
- **Cada edição vira um JSON Patch** com origem "ui", o mesmo que o agente usaria [A §6.2].
- **Campos numéricos:** arrasto no rótulo, como no Blender e no AE, e números tabulares.
- **"Ver JSON"** mostra o trecho cru, que é a porta do "editar à mão". Depois do MVP ele vira CodeMirror 6 [B §6].
- **Seleção múltipla:** edita o que é comum e mostra "—" onde os valores diferem [A4][A21].

**Linha do tempo:**

| Trilha | Altura |
|---|---|
| Régua (com marcas de comentário ◆ e a cabeça ▼) | 20 |
| Cenas | 24 |
| Blocos | 36 |
| Palavras | 24 (o texto some no zoom baixo) |
| Narração (forma de onda) | 32 |
| SFX | 28 |

- Bloco com efeito ganha o selo `fx·2`.
- **Desenho:** DOM para os blocos (são 12 no C2); canvas para a forma de onda e as palavras no zoom baixo; renderiza só o trecho visível [B §7].

**Histórico (diário):**
- Lista de patches: autor (você / agente + aba), hora, rótulo legível e objeto. Clicar seleciona o objeto.
- **"Copiar como patch"** gera um texto para colar no terminal, como o editor Info do Blender [A32].
- **Desfazer** (Ctrl+Z) volta o último patch da pessoa.

---

## 6. Atalhos

### 6.1 Regras

1. **Escopos, do mais forte ao mais fraco:**

   ```
   campo de texto em foco › terminal em foco › painel em foco › área › global
   ```

   - **Num campo de texto**, valem as teclas nativas do campo (inclusive Ctrl+Z do próprio campo) e só Esc (sai do campo), Enter, Alt+1…4, Ctrl+S e F3.
   - **Com o terminal em foco, tudo vai para o `claude`** (Tab, Shift+Tab, Esc, Esc Esc, Ctrl+B, Ctrl+C, Ctrl+R e o resto [B42]). O app só segura **Alt+1…4, Ctrl+PgUp/PgDn, Ctrl+', Ctrl+Shift+', Ctrl+Shift+P, F3 e F11**, como o `commandsToSkipShell` do VS Code [B37]. Para copiar no terminal, use Ctrl+Shift+C ou a seleção [inferência].
2. **Mesmo verbo, mesma tecla, em todas as áreas:** Espaço, J/K/L, ←/→, Ctrl+Z, Delete, Ctrl+D, Ctrl+G, F (enquadrar), Ctrl+0 (ajustar), Shift+A (adicionar), M (comentar), F3 (comandos), Alt+1…4. Só as **teclas de ferramenta** mudam por área, como em qualquer programa com modos [A §6.2].
3. **Como o app lê a tecla:**
   - **Letras pela tecla lógica** (`KeyboardEvent.key`): V é V em qualquer layout.
   - **Símbolos, teclado numérico e F1–F12 pela tecla física** (`KeyboardEvent.code`).
   - O rótulo mostra o caractere do layout atual, via `navigator.keyboard.getLayoutMap()` [A §4][B38].
   - **Ignorar eventos com `getModifierState('AltGraph')`.** No Windows, AltGr chega como Ctrl+Alt, e no ABNT2 AltGr+Q/W/E/1…6/=/[/] produz caracteres [conhecimento prévio]. Por isso **nenhum atalho Ctrl+Alt usa essas teclas**.
4. **ABNT2:** acento grave, agudo, til, circunflexo e trema são teclas mortas e não servem como atalho padrão [A §4][A8].
   - O "Ctrl+`" do VS Code vira **Ctrl+'**: é a mesma tecla física (`Backquote`), que no ABNT2 tem ' e ".
   - A barra invertida fica entre o Shift esquerdo e o Z.
5. **macOS:** Cmd no lugar de Ctrl. **Alt+1…4 vira Cmd+1…4.** Nunca usar Cmd+H/M/Q para ações do app. Ctrl+Espaço (maximizar) fica em aberto no macOS, porque troca a fonte de entrada [A §10 D6].
6. **Mapa num JSON** (`atalhos.json` no perfil), editável à mão ou pelo terminal. Paleta, menus e atalhos usam o **mesmo registro de comandos**, com ids como `ui.area.video`, `ui.layout.redefinir` e `tempo.cortar` [B §10].
   - Depois: editor visual e predefinições "Resolve" e "Blender" [A17][A31].
7. **Por que comentar é M e não C** (C no Figma [B41]): C é a lâmina no Vídeo (Premiere [A7]) e o recorte no Photoshop. M é "marcador" no Premiere e no Resolve [conhecimento prévio], e o comentário é o nosso marcador. Esta decisão substitui o "Ctrl+Shift+M provisório" da pesquisa A (D7): Ctrl+Shift+M passa a ser "comentar a seleção".
8. **Tab esconde os painéis** (Photoshop [B34]). "Adicionar" é Shift+A (Blender). Tab não serve para adicionar como no Nuke [A35], porque o Photoshop é o costume mais difundido.

### 6.2 Tabela unificada (MVP marcado com ✔)

**Global** (fora de campo de texto)

| Ação | Windows | macOS | Origem | MVP |
|---|---|---|---|---|
| Ir para Vídeo / Imagem / 3D / Efeitos | Alt+1 / 2 / 3 / 4 | Cmd+1…4 | Resolve Shift+n [B31], Blender [A28] [inferência na escolha] | ✔ |
| Área anterior / próxima | Ctrl+PgUp / PgDn | Cmd+Option+← / → [inferência] | Blender [A28] | ✔ |
| Paleta de comandos | F3 · Ctrl+Shift+P | F3 · Cmd+Shift+P | Blender [A30], VS Code | ✔ |
| Desfazer / refazer | Ctrl+Z / Ctrl+Shift+Z · Ctrl+Y | Cmd+Z / Cmd+Shift+Z | Photoshop desde 2019 [A24], Blender | ✔ |
| Ponto de restauração (commit git) | Ctrl+S | Cmd+S | [inferência] | ✔ |
| Abrir pasta de projeto | Ctrl+O | Cmd+O | — | ✔ |
| Exportar | Ctrl+Shift+E | Cmd+Shift+E | Figma [conhecimento prévio] | ✔ |
| Focar ou recolher o terminal | Ctrl+' (tecla física `Backquote`) | Ctrl+` | VS Code | ✔ |
| Nova aba de terminal | Ctrl+Shift+' | Ctrl+Shift+` | VS Code | ✔ |
| Esconder todos os painéis (ficam monitor e transporte) | Tab | Tab | Photoshop [B34] | ✔ |
| Esconder só as colunas laterais | Shift+Tab | Shift+Tab | Photoshop [B34] | ✔ |
| Maximizar o painel sob o cursor | Ctrl+Espaço · duplo clique na aba | duplo clique na aba (tecla a definir) | Blender [A29] | ✔ |
| Tela cheia da janela | F11 | Ctrl+Cmd+F | — | ✔ |
| Tela cheia do monitor | Ctrl+F (com foco no monitor ou na linha do tempo) | Cmd+F | Resolve [A15] | depois |
| Recolher coluna esquerda / Propriedades / linha do tempo | Ctrl+Alt+B / Ctrl+Alt+I / Ctrl+Alt+L | Cmd+Option+… | VS Code (Ctrl+B foi para "cortar") [B36] | ✔ |
| Modo comentário / mostrar pinos / comentar a seleção | M / Shift+M / Ctrl+Shift+M | igual (Cmd) | Premiere/Resolve (marcador), Figma [B41] | ✔ |
| Preferências | Ctrl+, | Cmd+, | — | ✔ |
| Mapa de atalhos | F1 (fora do 3D) | — | [inferência] | ✔ |
| Sair de modo / limpar seleção | Esc | Esc | — | ✔ |

**Edição comum** (com foco na Estrutura, no monitor ou na linha do tempo)

| Ação | Tecla | Origem | MVP |
|---|---|---|---|
| Excluir | Delete · Backspace | — | ✔ |
| Duplicar | Ctrl+D (e Ctrl+J na Imagem) | After Effects; Photoshop Ctrl+J [A §4] | ✔ |
| Copiar / recortar / colar | Ctrl+C / X / V | — | ✔ |
| Selecionar tudo / nada | Ctrl+A / Esc | — | ✔ |
| Agrupar / desagrupar | Ctrl+G / Ctrl+Shift+G | Photoshop, Figma [conhecimento prévio] | depois |
| Adicionar (efeito, primitiva, camada) por busca | Shift+A | Blender [A30] | ✔ |
| Enquadrar seleção | F | Maya, Blender Industry [A31] | ✔ |
| Ajustar à janela / 100% | Ctrl+0 / Ctrl+1 | Photoshop [conhecimento prévio] | ✔ |
| Zoom no monitor | Ctrl+= / Ctrl+-; roda = zoom no ponto do cursor | Photoshop | ✔ |
| Mover a vista | Botão do meio · H (mão) · Espaço+arrastar (fora do Vídeo) | Photoshop, Krita [A27] | ✔ |
| Empurrar seleção 1 px / 10 px (monitor 2D em foco) | ←↑→↓ / Shift+seta | Photoshop [conhecimento prévio] | ✔ |

**Tempo** (Vídeo; Efeitos com alvo vídeo)

| Ação | Tecla | Origem | MVP |
|---|---|---|---|
| Tocar / pausar | Espaço | Premiere, Resolve [A §4] | ✔ |
| Shuttle (voltar / parar / avançar; repetir acelera) | J / K / L | NLEs [conhecimento prévio] | ✔ |
| Quadro anterior / próximo | ← / → | Premiere [A7] | ✔ |
| 10 quadros | Shift+← / → | [inferência] | ✔ |
| Ponto anterior / próximo (corte, bloco ou palavra, conforme a trilha em foco) | ↑ / ↓ | Premiere [A7] | ✔ |
| Início / fim | Home / End | — | ✔ |
| Marcar entrada / saída | I / O | Premiere, Resolve | depois |
| Cortar no cursor | Ctrl+K · Ctrl+B | Premiere [A7]; Resolve, CapCut [A16][A40] | depois |
| Aparar até o cursor (início / fim) | Q / W | Premiere [A7] | depois |
| Excluir fechando o buraco | Shift+Delete | Premiere [A7] | depois |
| Zoom da linha do tempo | = / - · Ctrl+roda | Premiere [A7] | ✔ |
| Ajustar a linha do tempo à janela | Shift+Z · \ | Resolve, Premiere | ✔ |
| Encaixe nas palavras (liga/desliga) | S | Premiere [conhecimento prévio] | ✔ |

**Ferramentas por área** (trilho do monitor)

| Área | Teclas | MVP |
|---|---|---|
| Vídeo | **V** seleção · **C** lâmina (depois) · **H** mão · **M** comentário | ✔ (sem C) |
| Imagem | **V** mover · **T** texto · **U** forma · **H** mão · **Z** zoom · **M** comentário · **Ctrl+T** transformação livre | ✔ |
| 3D | **Q** seleção · **W** mover · **E** girar · **R** escalar · **M** comentário | ✔ |
| Efeitos | **V** seleção (alvo) · **H** mão · **M** comentário · **D** liga/desliga o efeito · **Shift+D** antes (desliga a pilha enquanto ativo) · **Alt+↑/↓** move na pilha | ✔ |

**Navegação 3D (híbrida, sem conflitos)** [A31][A §10 D2]

| Ação | Mouse / tecla | MVP |
|---|---|---|
| Orbitar | Botão do meio · Alt+botão esquerdo | ✔ |
| Mover a vista | Shift+botão do meio · Alt+botão do meio | ✔ |
| Zoom | Roda · Alt+botão direito | ✔ |
| Vistas frente / lado / topo / perspectiva | F1 / F2 / F3* / F4 · numérico 1 / 3 / 7 / 5 | ✔ |
| Ver pela câmera ativa | Numérico 0 | ✔ |

\* **Conflito:** com foco no viewport 3D, F3 é a vista de topo, e a paleta fica em Ctrl+Shift+P. Fora do 3D, F3 abre a paleta. É o único atalho que muda de sentido entre áreas, e por isso a dica do viewport mostra "F3 topo · Ctrl+Shift+P comandos". O teclado numérico cobre quem não quer usar F1–F4.

---

## 7. Tokens de design

Uma fonte só, `src/renderer/estilo/tokens.ts`, gera:
- as variáveis CSS abaixo;
- a classe de tema do dockview (mapeando para `--dv-*` [B10]);
- o `ITheme` do xterm (16 cores ANSI sobre os mesmos cinzas e acentos) [B §9].

Os nomes mantêm os do `estilo.css` atual onde já existem, e os valores mudam para o cinza neutro.

**De onde vêm as cores:**
- Cinzas e acentos azul, verde, âmbar e vermelho: Radix Colors 3.0.0, escalas dark (MIT) [B48].
- Rosa (plum), laranja e verde-água (teal): [conhecimento prévio da Radix; conferir no pacote].
- Contrastes sobre `#191919`: os marcados com "B" vêm da pesquisa B. Os demais são [inferência] e precisam ser conferidos.

```css
:root {
  /* ── superfícies: cinza de croma zero (Radix gray dark 1–5) ── */
  --fundo-0: #111111;   /* moldura, barra de título, vãos entre painéis */
  --fundo-1: #191919;   /* fundo de painel */
  --fundo-2: #222222;   /* cabeçalho de painel, barras, campos, fundo de trilha */
  --fundo-3: #2a2a2a;   /* hover */
  --fundo-4: #313131;   /* pressionado; seleção em painel sem foco */
  --entorno-monitor: #222222;        /* em volta da peça no monitor (padrão) */
  --entorno-cinza-medio: #777777;    /* opção "julgar cor": L* 50, ISO 12646 [B46][B47] */

  /* ── bordas (gray 6–8) ── */
  --borda: #3a3a3a;        /* divisória */
  --borda-forte: #484848;  /* contorno de campo e botão */
  --borda-3: #606060;      /* campo em hover; trilha selecionada */

  /* ── texto (gray 10–12) ── */
  --texto: #eeeeee;    /* valores, títulos — 15,2:1 (B) */
  --texto-2: #b4b4b4;  /* rótulos — 8,5:1 (B) */
  --texto-3: #7b7b7b;  /* desabilitado, ícone inativo; só ícone ou texto ≥ 12 px semibold — 4,2:1 (B) */

  /* ── acento = seleção e foco (blue dark) ── */
  --acento: #70b8ff;        /* blue 11: contorno de seleção, anel de foco, alças — 8,4:1 (B) */
  --acento-forte: #3b9eff;  /* blue 10: hover do botão principal */
  --acento-fundo: #003362;  /* blue 4: linha selecionada em painel com foco */
  --acento-fraco: #0d2847;  /* blue 3: seleção secundária (multi), hover sobre item selecionado */
  --texto-sobre-acento: #111111;  /* texto do botão principal — 9,0:1 (B) */

  /* ── significados fixos (uma cor, um sentido) ── */
  --agente: #baa7ff;       /* violet 11: mudança, lock e aba do agente — 8,4:1 (B) */
  --agente-fundo: #291f43; /* violet 3 */
  --pessoa: var(--texto-2);/* a pessoa não tem cor: só o agente salta à vista [inferência] */
  --comentario: #ffca16;   /* amber 11: pinos e marcas — 11,5:1 (B) */
  --cabeca: #e5484d;       /* red 9: cabeça de reprodução (costume do Resolve) [conhecimento prévio] */
  --trilha-video: #70b8ff; /* blue 11: borda e rótulo dos blocos; preenchimento em #104d87 (blue 6) */
  --trilha-audio: #3dd68c; /* green 11 — 9,4:1 (B) */
  --trilha-efeito: #e796f3;/* plum 11: efeitos, selo fx, keyframes */
  --trilha-3d: #0bd8b6;    /* teal 11: chaves de 3D (depois do MVP) */
  --ok: #3dd68c;           /* green 11 */
  --aviso: #ffa057;        /* orange 11: "precisa de você", avisos (sempre com ícone) */
  --erro: #ff9592;         /* red 11 */
  --marca: #c88155;        /* cobre: só o logotipo do Estúdio; botão principal usa --acento */

  /* ── espaçamento: grade de 4 px ── */
  --esp-0: 2px;
  --esp-1: 4px;
  --esp-2: 8px;
  --esp-3: 12px;
  --esp-4: 16px;
  --esp-5: 24px;

  /* ── raios ── */
  --raio-1: 2px;  /* blocos da linha do tempo, etiquetas, keyframes */
  --raio: 4px;    /* botões, campos, linhas de lista */
  --raio-2: 6px;  /* menus, balões de comentário, paleta */
  --raio-3: 8px;  /* diálogos */

  /* ── tipografia ── */
  --fonte: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "SF Pro Text", sans-serif;
  --fonte-mono: "JetBrains Mono", "Cascadia Mono", Consolas, "SF Mono", monospace; /* JetBrains Mono empacotada (OFL-1.1) [B50] */
  --tam-1: 11px;  /* metadados, nomes de trilha, kbd */
  --tam-2: 12px;  /* corpo da interface (base) */
  --tam-3: 13px;  /* títulos de seção, terminal na P */
  --tam-4: 15px;  /* títulos de diálogo, tela inicial */
  --peso-normal: 400;
  --peso-forte: 600;
  --altura-linha: 1.35;
  --tam-terminal: 13px;

  /* ── ícones (lucide-react 1.68, ISC; traço 1,5) [B49] ── */
  --icone: 16px;    /* padrão: botões, abas, cabeçalhos */
  --icone-p: 14px;  /* linhas densas: olho e cadeado na lista */
  --icone-g: 18px;  /* trilho de ferramentas (botão de 32×32) */
  --traco-icone: 1.5;

  /* ── medidas da casca ── */
  --barra: 36px;       /* barra de título */
  --rodape: 22px;      /* barra de status */
  --aba: 30px;         /* cabeçalho de aba do dockview */
  --controle: 24px;    /* altura de botão e campo */
  --linha-lista: 24px; /* linha de lista e de inspector */
  --trilho: 36px;      /* largura do trilho de ferramentas */
  --opcoes: 32px;      /* barra de opções da ferramenta */
  --transporte: 32px;  /* barra de transporte do monitor */
  --borda-recolhida: 35px; /* edge group recolhido do dockview [B6] */
}

/* faixa compacta: só mexe em medidas, nunca em cor */
:root[data-faixa="c"] {
  --aba: 28px;
  --linha-lista: 22px;
  --tam-terminal: 12px;
}

/* ponte para o dockview (nomes do tema 8.x; conferir na 8.8.3) [B10] [conhecimento prévio] */
.dockview-theme-estudio {
  --dv-background-color: var(--fundo-0);
  --dv-group-view-background-color: var(--fundo-1);
  --dv-tabs-and-actions-container-background-color: var(--fundo-2);
  --dv-tabs-and-actions-container-height: var(--aba);
  --dv-tabs-and-actions-container-font-size: var(--tam-2);
  --dv-activegroup-visiblepanel-tab-background-color: var(--fundo-1);
  --dv-activegroup-visiblepanel-tab-color: var(--texto);
  --dv-activegroup-hiddenpanel-tab-color: var(--texto-2);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--fundo-1);
  --dv-inactivegroup-visiblepanel-tab-color: var(--texto-2);
  --dv-inactivegroup-hiddenpanel-tab-color: var(--texto-3);
  --dv-separator-border: var(--fundo-0);
  --dv-paneview-active-outline-color: var(--acento);
  --dv-drag-over-background-color: rgba(112, 184, 255, 0.12);
  --dv-drag-over-border-color: var(--acento);
}
```

**Regras de uso:**
- **Nenhuma área grande colorida perto do monitor.** Cor só em marca de até cerca de 4 px de espessura, ícone, selo ou texto [B §9].
- **Números tabulares** (`font-variant-numeric: tabular-nums`) em timecode, campos e réguas.
- **Rótulos com letra só na inicial** (sentence case), sem caixa alta, em português direto e sem jargão de IA. O que já está em caixa alta no `estilo.css` (`.rotulo`) passa a ser normal [inferência].
- **Escala da interface de 80% a 150%** (Ver › Escala), por `webContents.setZoomFactor`, separada da escala do Windows [B25][B33]. Os zooms padrão do Electron (Ctrl+= / Ctrl+-) ficam desligados, porque essas teclas são da linha do tempo e do monitor.
- **Tema claro e alto contraste** ficam fora do MVP. Os tokens já permitem.

---

## 8. Estados: seleção, foco, hover, agente

### 8.1 Seleção

**Uma seleção só no app** (`loja.selecao`), sincronizada entre monitor, Estrutura, linha do tempo, Propriedades e Comentários pelo id do objeto, o mesmo que os comentários usam [A §6.2]. Selecionar em qualquer lugar seleciona em todos.

| Estado | Lista (Estrutura, Histórico) | Monitor 2D / 3D | Linha do tempo |
|---|---|---|---|
| Hover | Fundo `--fundo-3` | Contorno de 1 px tracejado `--acento` a 60% | Bloco +8% de brilho; cursor de mover |
| **Selecionado, primário**, painel com foco | Fundo `--acento-fundo` + barra interna de 2 px `--acento` à esquerda; texto `--texto` | Contorno de 1,5 px `--acento` + sombra de 1 px preta; **alças** de 8×8 com preenchimento `--fundo-0` e borda `--acento`; no 3D, o gizmo | Contorno de 2 px `--acento`, com 1 px de afastamento |
| Selecionado, primário, painel **sem** foco | Fundo `--fundo-4` + barra de 2 px `--borda-3` | Igual (o monitor sempre mostra a seleção) | Igual |
| **Selecionado, secundário** (multi) | Fundo `--acento-fraco`, sem barra | Contorno de 1 px `--acento`, sem alças | Contorno de 1 px `--acento` |
| Oculto (olho desligado) | Texto `--texto-3`, ícone ◌ | Não desenha | Bloco com 40% de opacidade e hachura |
| Travado pela pessoa (cadeado) | Ícone 🔒 `--texto-2` | Não seleciona pelo clique; só pela lista | Sem alças de arraste |
| **Em edição pelo agente** (lock otimista aberto) | Ícone de agente `--agente` + "agente editando" | Contorno de 1 px tracejado `--agente`; selo "agente" no canto | Borda tracejada `--agente` |
| **Acabou de mudar pelo agente** | Fundo `--agente-fundo` que some em 1,2 s | Brilho `--agente` em volta do objeto que some em 1,2 s | Idem |
| Com comentário | ● `--comentario` à direita | Pino `--comentario` (22 px) | ◆ `--comentario` na régua |

**Conflito com o agente:** se a pessoa edita um objeto com lock do agente, o patch volta com conflito de versão. A tela mostra a toast "o agente mudou este objeto; recarreguei" e reaplica a seleção [inferência, segue o lock otimista já decidido].

### 8.2 Foco

- **O grupo ativo do dockview** (o que recebe as teclas de painel) fica com a aba visível com texto `--texto` e uma **linha de 1 px `--acento` no topo da aba**. Grupos inativos ficam com a aba em `--texto-2`. Assim a pessoa sempre sabe para onde vão J/K/L ou Delete [inferência].
- **Foco por teclado** (`:focus-visible`): anel de 1 px `--acento` com `outline-offset: -1px` dentro de botões e campos, e de 2 px nas linhas de lista. **Nunca** remover o contorno de foco sem trocar por outro.
- **Campo em edição:** borda `--acento`, fundo `--fundo-0`. Enter confirma (gera o patch), e Esc cancela e devolve o foco ao painel.
- **Terminal:**
  - em foco, cursor em bloco cheio e aba com a linha `--acento`;
  - sem foco, cursor em contorno (`cursorInactiveStyle: 'outline'` do xterm) [conhecimento prévio].
- **Modo comentário:** cursor de pino, borda interna de 2 px `--comentario` no monitor e "Modo comentário · Esc sai" na barra de status.
- **Tab / Shift+Tab** (esconder painéis) não roubam o Tab do terminal nem dos campos: só valem com foco no monitor, na lista ou na linha do tempo.

### 8.3 Botões e controles

| Estado | Botão comum | Botão principal (um por diálogo) | Ferramenta no trilho |
|---|---|---|---|
| Normal | Fundo `--fundo-3`, borda `--borda-forte` | Fundo `--acento`, texto `--texto-sobre-acento` | Ícone `--texto-2` |
| Hover | Fundo `--fundo-4` | Fundo `--acento-forte` | Fundo `--fundo-3`, ícone `--texto`; tooltip com nome e tecla em 400 ms |
| Pressionado / ligado | Fundo `--acento-fraco`, borda `--acento` | — | **Ferramenta ativa:** fundo `--acento-fundo`, ícone `--acento` |
| Desabilitado | 50% de opacidade, sem hover | 50% | Ícone `--texto-3` |

---

## 9. Desempenho que o layout precisa respeitar

Junto com `desempenho.md`, que manda nos números:

- **Só a área ativa montada.** Painel oculto em aba não renderiza (`onlyWhenVisible`) [B7].
- **Player:** um por vez, pausado e desmontado quando some.
- **Viewport three.js:** só renderiza sob demanda (sem laço contínuo parado).
- **Contextos WebGL contados:** no máximo 3 vivos no perfil leve e 4 no padrão (`desempenho.md`). A tela gasta, no máximo:
  - 1 no viewport 3D;
  - 1 na prévia de efeitos;
  - 1 no terminal **visível**.

  Terminal oculto solta o addon WebGL e fica no renderizador DOM. Em perda de contexto, volta para o DOM [B44][B45].
- **Troca de área em até 150 ms** (`desempenho.md` §3.1). O layout sai de `fromJSON` sem animação.
- **Sem kit de UI pesado:** primitivas próprias + tokens. Fonte da interface do sistema (0 bytes); só a JetBrains Mono empacotada.

---

## 10. Corte do MVP (tela)

**Entra:**

1. **Casca:**
   - barra de título própria com ≡, abas das quatro áreas, paleta e estado do agente;
   - barra de status na P;
   - tela inicial "Abrir pasta" e diálogo Exportar (MP4 e PNG).
2. **dockview 8.8.3**, com **presets em código para as quatro áreas nas faixas C e P** (as oito disposições da seção 3). A faixa A usa a P.
   - Persistência por área × faixa e "Janela › Redefinir layout".
   - Faixa de borda à esquerda na C.
3. **Componentes comuns:** Estrutura, Projeto, Monitor (trilho + transporte ou opções), Propriedades geradas do schema com "Ver JSON" (texto cru, sem CodeMirror), Comentários, Histórico com "copiar como patch" e Terminal com abas, estado e chip de contexto.
4. **Linha do tempo do Vídeo:**
   - régua com marcas de comentário;
   - trilhas Cenas, Blocos, Palavras e Narração;
   - encaixe nas palavras;
   - selo fx;
   - o mesmo componente em Efeitos (P).

   Fica sem cortar, aparar e editor de curvas.
5. **Seleção única sincronizada**, com os estados da seção 8.1, incluindo "em edição pelo agente" e "acabou de mudar pelo agente".
6. **Atalhos marcados ✔ na seção 6.2** (cerca de 45), com escopo, a lista de teclas reservadas do terminal, a leitura de AltGr e o rótulo pelo layout. O mapa fica em `atalhos.json`.
7. **Tokens da seção 7** num `tokens.ts` que gera CSS, tema do dockview e `ITheme` do xterm.
8. **Escala da interface de 80% a 150%.**

**Critérios de aceite:**
- sem rolagem horizontal em 1280×636;
- o monitor nunca abaixo de 360×300 nos presets;
- trocar de área mantém seleção, posição de reprodução e sessões do terminal;
- toda ação do trilho tem dica com a tecla;
- "Redefinir layout" volta ao preset;
- o terminal recebe Esc, Ctrl+C, Shift+Tab e Ctrl+B;
- Alt+1…4 funciona com o terminal em foco.

**Fica para depois:**
- Vídeo paisagem e faixa A afinada (dois terminais lado a lado, Comentários em grupo próprio);
- popout do monitor para o segundo monitor (exige `app://`);
- cortar, aparar e I/O na linha do tempo; mini-mapa;
- modo efeitos da linha do tempo, com trilhas por efeito e keyframes;
- keyframes (◇ nas propriedades, I sobre o campo) e dope sheet no 3D;
- antes/depois com cortina;
- visão de nós dos efeitos;
- tela cheia do monitor;
- agrupar;
- editor de atalhos e predefinições "Resolve" e "Blender";
- tema claro e alto contraste;
- layout sugerido por projeto;
- tema do Claude Code aplicado (só com consentimento);
- comandos de interface expostos no `nucleo` (o agente muda o layout);
- áreas personalizadas.

---

## 11. Decisões fechadas aqui (antes estavam em aberto nas pesquisas)

| # | Decisão | Fica assim | Por quê |
|---|---|---|---|
| T1 | Lugar do terminal | Extrema direita em todas as áreas (pesquisa A queria embaixo fora do Vídeo) | Altura é o recurso escasso; o agente não muda de lugar [B §2] |
| T2 | Estrutura em cima à direita ou à esquerda | **Esquerda** na P; na C, ao lado de Propriedades, embaixo do terminal (Imagem, 3D e Efeitos) | Largura com o agente à direita; Figma, Godot e Unity; código atual |
| T3 | Comentar | M / Shift+M / Ctrl+Shift+M (não C) | C é lâmina e recorte; M é marcador nos NLEs |
| T4 | Tab | Esconder painéis (Photoshop); adicionar = Shift+A | Costume mais difundido |
| T5 | Ctrl+B | Cortar no cursor (Resolve, CapCut); colunas com Ctrl+Alt+B/I/L | O verbo do domínio vence o do VS Code |
| T6 | Paleta | F3 e Ctrl+Shift+P (não F1); F1 = mapa de atalhos; F1–F4 = vistas no 3D | Blender Industry usa F1–F4 nas vistas [A31] |
| T7 | Fontes | Sistema na interface; JetBrains Mono empacotada no terminal | 0 bytes na UI; colunas previsíveis no terminal |
| T8 | Cores de autor | Só o agente tem cor (violeta); efeitos passam para rosa | Uma cor, um sentido; o que o agente fez salta à vista |
| T9 | Cabeça de reprodução e comentário | Vermelho e âmbar | Não confundir na régua |
| T10 | Maximizar painel no macOS | Em aberto: só duplo clique na aba até testar | Ctrl+Espaço troca a fonte de entrada [A §10 D6] |

---

## 12. O que muda no código atual

- **`casca/Casca.tsx` → `layoutPadrao`:**
  - trocar o preset único pelos presets por área × faixa (seção 3);
  - o terminal sai de "embaixo à direita da linha do tempo" para a coluna da extrema direita;
  - a chave do layout vai para `estudio:layout:v2:<area>:<faixa>`;
  - o título "Inspector" vira "Propriedades";
  - Efeitos ganha a Biblioteca.
- **`paineis/Terminal`:** registro de instâncias do xterm fora do React, com anexar e soltar ao montar e desmontar; WebGL só na aba visível.
- **`estilo.css`:**
  - valores dos tokens trocados pelos da seção 7 (cinzas sem matiz azul);
  - `--comentario` para âmbar #ffca16 e `--agente` para violeta #baa7ff (já era violeta);
  - `--pessoa` sem cor;
  - `.bt.principal` passa de `--marca` para `--acento`;
  - `--tam-3` deixa de ser a fonte de corpo: o corpo vira 12 px;
  - `.rotulo` sem caixa alta;
  - cabeça da linha do tempo com `--cabeca`;
  - blocos com borda `--trilha-video` e fundo blue 6.
- **`estado/loja.ts`:**
  - a seleção passa a aceitar vários ids (`{documento, ids: string[], primario}`), mantendo o caminho JSON do primário;
  - entram os campos `faixa` e `foco` (painel ativo) para o roteamento de atalhos.

---

## Fontes principais

Repetidas das pesquisas A e B, com acesso em 05/11/2026. As listas completas estão nas pesquisas.

- [A1] Adobe, workspaces do Premiere — https://helpx.adobe.com/ee/premiere/desktop/get-started/tour-the-workspace/what-are-workspaces.html (trecho de busca; 403 no fetch)
- [A4] Adobe, Premiere 25.0 (painel Properties) — https://helpx.adobe.com/premiere-pro/using/whats-new/2025.html
- [A5] Adobe, Premiere 22.3 (barra de cabeçalho) e críticas — https://helpx.adobe.com/premiere-pro/using/whats-new/2022-3.html
- [A7] FilmDaft, atalhos do Premiere — https://filmdaft.com/premiere-pro-keyboard-shortcuts-pc-mac/
- [A8] ProVideo Coalition, maximizar no Premiere e teclado não americano — https://provideocoalition.com/tool-tip-tuesday-for-adobe-premiere-pro-maximize-monitor-shortcut
- [A11] Manual do Resolve 18, Single Viewer Mode — https://ltbits.github.io/davinci-resolve-manuals/DR18/DR18-RM05-Edit.pdf
- [A13] Newsshooter, Resolve 21 — https://www.newsshooter.com/2026/06/02/davinci-resolve-21-final-release/
- [A16] Versluis, Premiere → Resolve — https://www.versluis.com/2026/01/switching-to-davinci-resolve-with-a-premiere-pro-mindset/
- [A19] DaVinci Resolve Club, Fusion × After Effects — https://davinciresolveclub.com/fusion-vs-after-effects/
- [A23] Adobe, fundamentos do Photoshop — https://www.adobe.com/learn/photoshop/web/ps-basics-fundamentals
- [A24] Photography Life, desfazer no Photoshop — https://photographylife.com/how-to-undo-redo-in-photoshop
- [A26] discuss.pixls.us, Salvar × Exportar no GIMP — https://discuss.pixls.us/t/gimp-is-the-only-app-where-the-actual-save-function-is-called-export/42251
- [A28] Blender 5.2, Workspaces — https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html
- [A29] Blender, Areas — https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/interface/window_system/areas.rst
- [A30] Blender, Default Keymap — https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/interface/keymap/blender_default.rst
- [A31] Blender, Industry Compatible Keymap — https://docs.blender.org/manual/en/latest/interface/keymap/industry_compatible.html
- [A32] Blender, Info Editor — https://www.blender.org/manual/de/editors/info_editor.html
- [A34] Maxon, Cinema 4D 2027 (layouts) — https://help.maxon.net/c4d/2027/en-us/Content/html/5425.html
- [A35] Foundry, Nuke 17.1 (workspaces, menu Tab) — https://learn.foundry.com/nuke/content/getting_started/using_interface/tab_menu.html
- [A37] MacRumors, Affinity unificado — https://www.macrumors.com/2025/10/31/canva-relaunches-affinity-free-app/
- [A40] Skillademia, atalhos do CapCut — https://www.skillademia.com/shortcuts/capcut-shortcuts/
- [A41] Khronos, glTF 2.0 §3.4 — https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- [B2] dockview releases — https://github.com/mathuo/dockview/releases
- [B3] npm dockview 8.8.3 — https://registry.npmjs.org/dockview/latest
- [B4] dockview, licença e enterprise — https://dockview.dev/docs/overview/licence ; https://dockview.dev/blog/dockview-enterprise
- [B5] dockview, novidades da v8 — https://dockview.dev/docs/releases/whats-new/whats-new-v8
- [B6] dockview, edge groups — https://dockview.dev/docs/core/groups/edgeGroups
- [B7] dockview, render modes — https://dockview.dev/docs/core/panels/rendering
- [B8] dockview, popout — https://dockview.dev/docs/core/groups/popoutGroups
- [B10] dockview, theming — https://dockview.dev/docs/core/theming
- [B11] FlexLayout — https://github.com/caplin/FlexLayout
- [B18] npm downloads, 28/10–03/11/2026 — https://api.npmjs.org/downloads/point/last-week/dockview,flexlayout-react,rc-dock,golden-layout,react-mosaic-component
- [B19] StatCounter, resoluções no mundo — https://gs.statcounter.com/screen-resolution-stats/desktop/worldwide
- [B21] Microsoft, High DPI — https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/high-dpi-and-windows
- [B23] Electron, Custom Title Bar — https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- [B25] Electron, `setZoomFactor` — https://www.electronjs.org/docs/latest/api/web-contents
- [B28] Adobe, workspace Vertical do Premiere (mesma página de A1)
- [B34] Photoshop Essentials, Tab e modos de tela — https://www.photoshopessentials.com/?p=5179
- [B36] VS Code, Custom Layout — https://code.visualstudio.com/docs/configure/custom-layout
- [B37] VS Code, `commandsToSkipShell` — https://code.visualstudio.com/docs/terminal/advanced
- [B38] VS Code, layouts de teclado — https://code.visualstudio.com/docs/configure/keybindings
- [B40] Zed, `agent.default_width` — https://zed.dev/docs/reference/all-settings
- [B41] Figma, comentários — https://help.figma.com/hc/en-us/articles/360041547593
- [B42] Claude Code, modo interativo — https://code.claude.com/docs/en/interactive-mode
- [B43] Issues do Claude Code sobre largura — https://claudeissues.com/issue/68839-feature-force-table-rendering-independent-of-terminal-width-font-size
- [B44] Chromium, limite de contextos WebGL — https://chromium.googlesource.com/chromium/blink/+/master/Source/modules/webgl/WebGLRenderingContextBase.cpp
- [B45] @xterm/addon-webgl — https://npmjs.com/package/@xterm/addon-webgl
- [B46] darktable, color assessment — https://docs.darktable.org/usermanual/4.6/en/module-reference/utility-modules/darkroom/color-assessment/
- [B48] Radix Colors 3.0.0 — https://github.com/radix-ui/colors
- [B49] lucide-react 1.68.0 (ISC) — https://registry.npmjs.org/lucide-react/latest
- [B50] JetBrains Mono (OFL-1.1) — https://github.com/JetBrains/JetBrainsMono
- Internos: `C:\Users\usuario\OneDrive - Empresa\Área de Trabalho\projs\tasks\pesquisa-editor-video-ia-2026-11-04\relatorio-2-suite-e-terminal.md` (§5.7, estados e chip de contexto); `C:\Users\usuario\projetos\estudio\docs\desempenho.md`; `C:\Users\usuario\projetos\estudio\src\renderer` (Casca.tsx, estilo.css, loja.ts).
