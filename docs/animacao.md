# Animação 2D com Quadros-Chave e Arte em Pixel

Versão 1.0 (Novembro de 2026). Módulo de animação 2D vetorial e arte em pixel do Estúdio, editável tanto pela interface desktop quanto pelo Claude via ferramentas MCP e JSON Patch com diário.

Código principal:
- Núcleo puro: `src/nucleo/animacao.ts`, `src/nucleo/animacao-pixel.ts`, `src/nucleo/ferramentas-animacao.ts` e `src/nucleo/png.ts`.
- Composição Remotion: `src/composicoes/animacao/Animacao.tsx`, registrada em `src/composicoes/Root.tsx` e `registro.ts`.
- Interface nos painéis: `src/renderer/modulos/animacao/` (Monitor, Camadas, Linha do Tempo, Inspetor de Propriedades, Editor de Pixel).
- Testes: `testes/animacao.test.ts`, `testes/animacao-pixel.test.ts`, `testes/animacao-mcp.test.ts`.

---

## 1. Estrutura do Documento (`animacao/<id>.json`)

O documento é um JSON padronizado com esquema determinístico:

```json
{
  "formato": 1,
  "largura": 1920,
  "altura": 1080,
  "fps": 30,
  "duracao_ms": 3000,
  "fundo": "#111418",
  "tema": {
    "fundo": "#111418",
    "texto": "#F2F2F2",
    "destaque": "#FFFFFF",
    "suave": "#A3ABB5",
    "fonte": "Inter"
  },
  "camadas": [
    {
      "id": "forma-1",
      "nome": "Forma",
      "tipo": "forma",
      "visivel": true,
      "travada": false,
      "x": 860,
      "y": 440,
      "largura": 200,
      "altura": 200,
      "forma": "retangulo",
      "cor": "@destaque",
      "raio": 24,
      "trilhas": {
        "x": [
          {"t_ms": 0, "valor": 100, "curva": "suave"},
          {"t_ms": 1500, "valor": 860, "curva": "mola"}
        ]
      }
    }
  ]
}
```

### Propriedades Animáveis

Cada camada possui propriedades base e trilhas de quadros-chave (`{propriedade: [{t_ms, valor, curva}]}`):
- Comuns: `x`, `y`, `escala`, `rotacao`, `opacidade`, `cor` (interpolada perceptualmente em OKLab).
- Texto: também `tamanho` (em px).
- Pixel: também `tamanho_pixel` e `progresso` (0 a 1).

Faixas: `opacidade` e `progresso` de 0 a 1, `escala` a partir de 0, `tamanho` e `tamanho_pixel` a partir de 1; `x`, `y` e
`rotacao` são livres (entrar de fora do quadro vale). O `animar` recusa valor fora da faixa ou do tipo (`cor` é
`#rrggbb`, `#rgb` ou `@fundo`, `@texto`, `@destaque`, `@suave`; o resto é número). O resolvedor limita de novo o que
chega por `aplicar_patch` ou JSON editado à mão, com aviso. Na cor, a referência do tema é resolvida antes de interpolar:
de `@destaque` para `#FF0000` o meio parte do destaque do kit, não do preto.

### Curvas de Interpolação

- `linear`: interpolação linear constante.
- `suave`: ease-in-out cúbico.
- `entrada`: ease-in (acelera).
- `saida`: ease-out (desacelera).
- `mola`: ease-out com amortecimento e pulo natural (overshoot).
- `degrau`: step (segura o valor até o próximo quadro-chave).

---

## 2. Arte em Pixel

A camada `pixel` contém uma grade `{colunas, linhas, paleta, celulas}` codificada em formato compacto (Base 62, onde `.` indica transparência).
Colunas e linhas são inteiros de 1 a 1024 (o `pixelizar_imagem` gera até 128); uma grade fora disso (ou sem `celulas`) é
descartada pelo resolvedor com aviso: a camada não aparece na prévia nem na exportação, e a tela diz isso (aviso no pé do
monitor com o nome e o motivo de cada camada, e um ⚠ na lista de camadas; `camadasDescartadas` em `src/nucleo/animacao.ts`).
O documento não é alterado.

### Revelações Determinísticas

Com `progresso` de 0 a 1 e semente determinística, a grade pode ser revelada usando os efeitos:
1. `aleatorio`: células surgem numa permutação pseudo-aleatória determinística.
2. `decodificar`: células entram com cores trocadas da paleta e assentam na cor final.
3. `varredura`: frente da esquerda para a direita.
4. `varredura-baixo`: frente de cima para baixo.
5. `meio`: revelação que expande do centro para as bordas.
6. `chuva`: colunas caem no estilo Matrix com ponta mais clara.

Nos quatro primeiros, a célula entra quando a frente passa pelo centro dela: nada aparece em 0, a grade fica cheia antes
do último quadro e a frente anda em ritmo constante. No `decodificar`, as células entram até 3/4 do progresso e todas já
assentaram na cor final no fim.

A ferramenta MCP `pixelizar_imagem` converte uma imagem em grade de pixel com quantização de cores (median-cut) ou
aplicando a paleta do kit de marca. Lê PNG (8 bits, indexado de 1 a 8 bits, com transparência, até 4096 px de lado); JPG
e o PNG que ela não lê direto (entrelaçado, 16 bits, grande demais) passam pelo ffmpeg do app, já reduzidos. Uma célula
só é pintada com pelo menos 25% de tinta (`cobertura_min`, de 0 a 1): logo de linha fina pede um valor menor.

---

## 3. Interface Desktop

Na casca do app, a área Animação é acessada pelo atalho **6** ou pelo botão na barra de navegação:

- **Monitor**: Player do Remotion integrado; seleção direta de camadas com arrasto no palco. Ao arrastar uma camada que já possui trilha de posição, cria ou atualiza o quadro-chave na cabeça de reprodução (`tempo_ms`).
- **Camadas**: gerenciamento de camadas (ordem, visibilidade, travamento, renomear, duplicar, excluir e adicionar nova Forma, Texto, Imagem ou Pixel).
- **Linha do tempo**: régua em segundos, zoom ajustável, cabeça de reprodução com arraste interativo, losangos nos quadros-chave arrastáveis para re-sincronizar tempos.
- **Propriedades (Inspetor)**: valores exatos calculados no tempo da cabeça; botão ◆ por propriedade para ligar/desligar animação; seletor de curvas por quadro-chave.
- **Editor de Pixel**: integrado ao selecionar uma camada pixel, com Lápis, Borracha, Conta-gotas e Balde (flood fill), gerenciador de paleta e seletor de efeito.
- **Teclas**: `Espaço` (reproduzir/pausar), `K` (inserir quadro-chave), `Del` (excluir), `Ctrl+Z` (desfazer).

---

## 4. Ferramentas MCP

| Ferramenta | Parâmetros | Descrição |
| --- | --- | --- |
| `criar_animacao` | `titulo?, largura?, altura?, fps?, duracao_ms?, fundo?` | Cria o documento `animacao/<id>.json` e registra no manifesto |
| `adicionar_camada_animacao` | `documento, tipo, nome?, x?, y?, ...` | Adiciona camada de forma, texto, imagem ou pixel |
| `animar` | `documento, camada_id, propriedade, quadros` | Cria ou substitui trilha de quadros-chave com curvas |
| `pixelizar_imagem` | `documento, camada_id, imagem_src, colunas?, linhas?, cores?, usar_paleta_marca?, cobertura_min?` | Converte foto/logo (PNG ou JPG) em pixel art; só em camada pixel |
| `efeito_pixel` | `documento, camada_id, efeito, semente?, animar_progresso?, inicio_ms?, duracao_ms?` | Configura revelação determinística do pixel; só em camada pixel |
| `ver_animacao` | `documento, tempo_ms?` | Resumo e valores calculados de cada camada no tempo |
| `animar_entrada` | `camada, preajuste, duracao_ms?, em_ms?, documento?` | Entrada pronta (surgir, subir, descer, crescer, girar), como os botões do inspetor; padrão: 600 ms a partir de 0 |
| `animar_saida` | `camada, preajuste, duracao_ms?, em_ms?, documento?` | Saída pronta; padrão: termina no fim da animação |

Os pré-ajustes de entrada e saída moram em `src/nucleo/animacao-preajustes.ts`: o inspetor e o MCP gravam as mesmas
trilhas (os quadros-chave que já havia nessas propriedades dentro do trecho saem; os de fora ficam).

---

## 5. Exportação e "Usar no Vídeo"

- **Exportação**: pelo diálogo de exportação (`Ctrl+Shift+E` ou botão Exportar no Monitor), exporta em MP4 (H.264/VP9) ou imagem estática na resolução da animação.
- **Usar no vídeo**: ao exportar para MP4, o arquivo gerado pode ser colocado na pasta `midia/` e inserido diretamente como clipe em qualquer cena de um documento de vídeo (`DocCenas`) existente no projeto.
