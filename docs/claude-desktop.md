# Claude Desktop (versão 2.0.1)

O Estúdio pode ser operado pelo **Claude Desktop**, e não só pelo Claude Code. A pessoa instala o Estúdio e, depois,
ou instala a extensão `Estudio-<versão>.mcpb` no Claude Desktop, ou clica em **Conectar ao Claude Desktop** em
Configurações › IA. Em seguida reinicia o Claude Desktop. Não há porta para ligar, token para colar nem JSON para
editar. Vale para Windows, Mac e Linux.

## Instalar

Há dois caminhos. Basta um deles; com os dois, o Claude Desktop mostra o Estúdio duas vezes.

1. **Extensão (recomendado para quem recebe o Estúdio pronto).** Baixe o `Estudio-<versão>.mcpb` da release, junto do
   instalador. No Claude Desktop, abra Configurações › Extensões e arraste o arquivo para a janela, ou dê dois cliques
   nele. Confirme a instalação.
2. **Botão no app.** No Estúdio, abra Configurações › IA › **Claude Desktop** e clique em **Conectar ao Claude
   Desktop**. O app grava a entrada `estudio` no `claude_desktop_config.json`:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`;
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`;
   - Linux: `~/.config/Claude/claude_desktop_config.json` (ou `$XDG_CONFIG_HOME/Claude`).

Depois, feche e abra o Claude Desktop. O Estúdio aparece entre os conectores e as ferramentas ficam disponíveis na
conversa.

## Como funciona

```
Claude Desktop ──stdio──► lançador da extensão (server/index.js, no Node do Claude Desktop)
                           │ acha o Estúdio instalado e roda, nos mesmos stdin e stdout:
                           ▼
                          Estúdio em modo Node (ELECTRON_RUN_AS_NODE=1) + resources/dist-mcp/desktop.cjs
                           │ a cada chamada de ferramenta:
                           ├─ app aberto num projeto? ──HTTP 127.0.0.1──► MCP do app (portão, diário, Reverter)
                           └─ senão: roda ali, no projeto escolhido (trava de escrita do projeto)
```

O botão do app pula o lançador: a entrada que ele grava já roda o executável do Estúdio em modo Node com o
`desktop.cjs`.

### Decisão de arquitetura: um lançador fino, e o MCP do próprio app

A extensão **não traz as ferramentas**. O `server/index.js` dela (`mcpb/lancador.ts`, uns 8 KB, sem dependências) roda
no Node que vem com o Claude Desktop, acha o Estúdio instalado e executa o MCP do próprio app
(`resources/dist-mcp/desktop.cjs`) com o executável do Estúdio em modo Node. Os motivos:

- **O MCP precisa dos recursos do app.** Transcrição (whisper), render (Remotion e o navegador de render), ffmpeg e
  música moram no pacote do Estúdio, parte deles dentro do `app.asar`. Esse arquivo só se lê pelo próprio Electron. Com
  o Node do Claude Desktop, essas ferramentas quebrariam.
- **A extensão nunca fica atrás do app.** Atualizar o Estúdio atualiza as ferramentas. Uma extensão que levasse o MCP
  dentro dela precisaria ser reinstalada a cada versão e poderia divergir do formato dos documentos do app instalado.
- **A mensagem sem o Estúdio é clara.** O lançador é JavaScript puro. Sem o app, ele mesmo responde ao Claude Desktop
  com uma ferramenta só, `estudio_instalar`, e com instruções dizendo "Instale o Estúdio…", em vez de o servidor
  simplesmente não subir. Com um Estúdio anterior à 2.0.1 (sem o `desktop.cjs`), a mensagem pede para atualizar.

A alternativa de rodar tudo no Node do Claude Desktop foi descartada pelo primeiro motivo. A de apontar o
`mcp_config` direto para o executável do Estúdio foi descartada no Windows e no Mac: a pasta de instalação pode mudar
(o instalador do Windows deixa escolher) e não haveria mensagem clara sem o app.

**Linux.** O Node que vem com o Claude Desktop existe no Mac e no Windows (README do repositório oficial do MCPB). No
Linux o Claude Desktop não é oficial, e as versões da comunidade podem não trazer Node. Por isso o manifesto tem um
`platform_overrides.linux`, que roda o mesmo lançador com o próprio Estúdio em modo Node
(`${HOME}/.local/opt/Estudio/Estudio`, onde o `scripts/instalar-linux.sh` instala). O custo: no Linux, sem o Estúdio
instalado, o Claude Desktop mostra só que o servidor não abriu, e não a mensagem "instale o Estúdio".

### Onde o lançador procura o Estúdio

Ele procura nesta ordem e usa o primeiro com executável e `desktop.cjs`:

1. `ESTUDIO_EXECUTAVEL` (e `ESTUDIO_SCRIPT`, opcional), para desenvolvimento;
2. o Estúdio aberto agora, pelo arquivo de descoberta (abaixo);
3. o registro da instalação, `instalacao.json` na pasta de dados do Estúdio (`{formato: 1, executavel, script, versao}`,
   sem token). O app grava ao abrir e não apaga ao fechar. É o que cobre a pasta escolhida à mão no instalador do
   Windows com o app fechado: basta o Estúdio ter sido aberto uma vez. Rodando de uma cópia temporária do macOS, o app
   não grava;
4. o lugar padrão de cada sistema:
   - Windows: `%LOCALAPPDATA%\Programs\Estudio\Estudio.exe`;
   - Mac: `/Applications/Estudio.app` e `~/Applications/Estudio.app`;
   - Linux: `~/.local/opt/Estudio/Estudio`.

### Manifesto

O arquivo é `mcpb/manifest.json`, com `manifest_version` **0.3**. Em 11/11/2026, a 0.3 era a versão apontada como
`latest` nos esquemas de github.com/modelcontextprotocol/mcpb. A 0.4 só acrescenta o tipo de servidor `uv` (Python), que
não se aplica aqui. O tipo do servidor é `node`, com `entry_point` `server/index.js`. O esquema oficial está copiado em
`testes/fixtures/mcpb-manifest-v0.3.schema.json` (licença MIT/Apache-2.0 do projeto MCP), e o teste valida o manifesto
contra ele. A versão do manifesto acompanha a do `package.json`, e o `npm run mcpb` recusa gerar o pacote se as duas
divergirem.

## Qual projeto o Claude Desktop opera

O Claude Desktop não abre pasta de projeto. O MCP decide a cada chamada:

- **Com o Estúdio aberto num projeto** (o caminho preferido), a chamada vai ao app e opera no projeto aberto. É um
  escritor só, a tela acompanha na hora, a mudança entra no diário e no Histórico com Reverter, e as ferramentas
  sensíveis mostram o cartão de permissão na tela do app.
- **Com o app fechado, ou aberto sem projeto**, o Claude chama `listar_projetos` e `escolher_projeto`. A lista traz os
  recentes do app (`recentes.json`) e as subpastas com `estudio.json` da pasta dos projetos (a das preferências e
  `~/Estudio`). Escolhido o projeto, as ferramentas de sempre rodam no próprio processo do MCP, com a trava de escrita
  do projeto, como no MCP da IDE. Se o projeto escolhido estiver aberto num Estúdio que não publicou a descoberta (um
  app 2.0.0, por exemplo), a chamada vai a ele pelo `.estudio/mcp-app.json` do projeto, para nunca gravar por fora de um
  app aberto.
- **O Claude Desktop nunca grava num projeto que não escolheu.** Com um projeto escolhido e o app aberto em OUTRO, toda
  chamada é recusada, sem gravar em nenhum dos dois, e a resposta diz os dois projetos e o que fazer: abrir o escolhido
  no app (ou fechar o projeto do app), ou escolher o que está aberto. Escolher outro projeto com o app aberto já avisa
  disso.
- **Sem projeto escolhido, a troca não passa calada.** Se o projeto muda entre uma chamada e outra (a pessoa abriu outro
  no app), a primeira chamada depois da troca é recusada, dizendo de qual para qual; a seguinte roda no novo.

**Origem.** Em qualquer caso, o Histórico mostra **"Claude Desktop"** e o autor é `agente`. No diário, a origem é
`Claude Desktop`; pelo `.estudio/mcp-app.json` (app que não publicou a descoberta) é `ide-<id> Claude Desktop`, a forma
das conversas de IDE com o nome do harness.

**Portão.** Com o app aberto, as ferramentas da classe "cartao" (`src/nucleo/portao.ts`) perguntam à pessoa pela tela do
app, com a origem "Claude Desktop". O "Sempre nesta conversa" vale para o token do Claude Desktop, ou seja, para todas
as conversas dele enquanto o app estiver aberto. Com o app fechado, o MCP pede a confirmação pelo próprio Claude
Desktop (elicitação do MCP), se ele oferecer. Sem a elicitação, a ferramenta não roda e a resposta pede para abrir o
Estúdio com o projeto. As ferramentas livres (ler, aplicar patch, desfazer) rodam direto nos dois casos, com diário e
Reverter.

## Criar, abrir e trocar de projeto (frente 2 do MCP)

`criar_projeto`, `abrir_projeto`, `duplicar_projeto` e `fechar_projeto` (`src/nucleo/mcp-projeto.ts`) mudam o projeto
inteiro. O perigo é a conversa que pede a troca morrer no meio: abrir projeto no app chama `fecharSessao`, que fecha as
conversas do projeto e esquece os tokens das abas (`src/main/main.ts`), e o MCP por HTTP do app é por projeto (responde
409 sem projeto aberto). Por isso as quatro só existem onde a conversa vive fora do app:

| Quem pede | App aberto | App fechado |
|---|---|---|
| **Claude Desktop** (ferramentas do próprio servidor, `mcp-desktop.ts`) | vão ao app pelo token fixo do Claude Desktop, que não cai na troca. O app as atende mesmo sem projeto aberto (só estas quatro; o resto continua 409). Depois, o servidor segue no projeto do app, sem o aviso de "projeto mudou" | rodam no servidor: `criar_projeto` e `duplicar_projeto` gravam a pasta (na pasta de projetos, `~/Estudio`) e a escolhem; `abrir_projeto` é o `escolher_projeto`; `fechar_projeto` esquece a escolha |
| **IDE** (`mcp/nucleo.ts`) | com o app no projeto da IDE, vão ao app, que troca. As próximas chamadas da IDE seguem na pasta dela, agora sem passar pelo app (a resposta avisa) | `criar_projeto` e `duplicar_projeto` gravam a pasta e dizem para abri-la na IDE; `abrir_projeto` e `fechar_projeto` explicam que o MCP da IDE fica na pasta da IDE |
| **App de IA de fora** (token fixo, `docs/ia.md`) | vão ao app, como o Claude Desktop | — |
| **Conversa dentro do app** (aba do Claude, laço próprio, agente ACP) | as quatro não aparecem na lista; o guia do projeto diz para pedir à pessoa | — |

No app, a troca é a mesma da tela (`criarProjeto`, `abrirProjeto`, `duplicarProjeto` e `fecharSessao` do `main.ts`,
na fila de troca de projeto), e depois a tela recarrega, como quando uma pasta chega de fora (`abrirDeFora`). As
quatro são "cartao": com o app aberto, a pessoa permite na tela, e o motivo avisa que o projeto aberto fecha, com as
conversas dele. Com o app fechado, `criar_projeto` e `duplicar_projeto` pedem a confirmação pelo Claude Desktop
(elicitação); `abrir_projeto` e `fechar_projeto` só escolhem, como o `escolher_projeto`, e não perguntam.

Limites: com o app fechado, o projeto novo nasce sem git (o app inicia o git na primeira abertura) e na pasta padrão
(`~/Estudio`), não na pasta de projetos das preferências, que o MCP fora do app não lê; `"pasta"` escolhe outra.

## O arquivo de descoberta

Ao abrir, o app grava `claude-desktop.json` na pasta de dados dele:

- Windows: `%APPDATA%\Estudio\claude-desktop.json`;
- Mac: `~/Library/Application Support/Estudio/claude-desktop.json`;
- Linux: `~/.config/Estudio/claude-desktop.json`.

O conteúdo é `{formato: 1, url, token, pid, host, executavel, script, versao, projeto, em}`:

- `url` é o MCP por HTTP do app, o mesmo servidor local das abas, em `127.0.0.1` e com porta aleatória;
- `token` é só do Claude Desktop, registrado no `McpHttp` com a origem "Claude Desktop", e nasce a cada abertura;
- `projeto` é o projeto aberto, ou `null`, e é atualizado ao abrir e ao fechar um projeto.

O arquivo é gravado de forma atômica, com modo `0600` no Mac e no Linux. No Windows, a pasta do perfil já é só do
usuário. Ao fechar, o app apaga o arquivo se ele ainda for o dele.

O MCP só usa a descoberta se o `pid` estiver vivo e se a `url` for `127.0.0.1` ou `localhost`. O nome da máquina
(`host`) fica no arquivo, mas não conta: no Mac ele muda com a rede, e o app aberto passaria por fechado. Com o token recusado (o app reabriu), relê o arquivo uma vez. Recusado de novo, responde erro sem gravar
nada.

Quanto à segurança, o token dá a outro programa do mesmo usuário o mesmo acesso que o Claude Desktop tem, e esse acesso
continua passando pelo portão. Um programa do mesmo usuário já consegue gravar nos arquivos do projeto direto, então o
token não abre nada novo. Ninguém de fora da máquina alcança a porta.

Isto substitui, para o Claude Desktop, o "Apps de IA de fora" com token colado (`docs/ia.md`). A porta fixa e os tokens
por app continuam para Cursor, Cline, Windsurf e VS Code.

## O botão em Configurações › IA

A seção **Claude Desktop** mostra a situação da entrada `estudio`:

| Situação | O que significa |
|---|---|
| conectado | a entrada aponta para este Estúdio |
| desatualizado | a entrada é do Estúdio, mas de outro caminho (o app mudou de lugar); "Conectar" troca |
| manual | um `estudio` posto à mão por outra pessoa ou programa; o app não mexe |
| ilegível | o arquivo não é JSON de objeto; o app não mexe |
| desconectado | não há a entrada |

A seção avisa também quando a pasta do Claude Desktop não existe, quando a extensão já está instalada e quando o app
roda de uma cópia temporária do macOS (App Translocation, aberto de Downloads). Nesse último caso o botão fica
desligado, porque o caminho gravado sumiria.

Regras da mesclagem (`configConectada` e `configDesconectada` em `src/nucleo/claude-desktop.ts`):

- a gravação é atômica e no lugar (`gravarAtomicoNoLugar`): um symlink (dotfiles) continua symlink, e o modo do arquivo
  fica (um `600` com o token de outro servidor continua `600`);

- os outros servidores e as outras chaves do arquivo ficam intactos;
- arquivo novo cria a pasta;
- BOM no início é aceito;
- se nada mudou, o arquivo não é regravado (nem a data de modificação muda);
- **Desconectar** tira só o `estudio` que o Estúdio pôs. Ele reconhece como seu o servidor cujos `args` terminam em
  `desktop.cjs` ou na `ponte.cjs` antiga dos apps de fora; a configuração antiga é trocada pela nova ao conectar.

## Limites

- **Uma janela do Estúdio por vez.** Com dois Estúdios abertos, vale a descoberta do último que abriu.
- **"Sempre nesta conversa"** vale para todas as conversas do Claude Desktop enquanto o app estiver aberto. O Claude
  Desktop não diz ao servidor qual conversa é qual.
- **Com o app fechado e sem elicitação**, as ferramentas sensíveis (ler página da web, transcrever, narrar, exportar
  legendas, destravar camadas e outras) não rodam.
- **O projeto escolhido vive enquanto o processo do MCP vive.** Ao reiniciar, o Claude Desktop sobe um processo novo, e
  o Claude precisa escolher de novo (as instruções do servidor dizem isso).
- **Sem o Estúdio no Linux**, com a extensão, não há a mensagem "instale o Estúdio" (seção Linux, acima).
- A extensão não é assinada (`mcpb sign`). O Claude Desktop mostra o aviso de extensão não verificada na instalação.

## Remover

- **Extensão:** Claude Desktop › Configurações › Extensões › Estúdio › Desinstalar.
- **Entrada do botão:** Estúdio › Configurações › IA › Claude Desktop › **Desconectar**. Sem o Estúdio, apague a chave
  `estudio` de `mcpServers` no `claude_desktop_config.json`.
- O arquivo de descoberta some quando o app fecha. Se o app caiu, ele fica e é ignorado (o `pid` morto); pode ser
  apagado.
- Reinicie o Claude Desktop depois de remover.

## CI e release

- `npm run mcpb` gera `out/mcpb/Estudio-<versão>.mcpb`: um zip com `manifest.json`, `server/index.js` (o lançador num
  arquivo só) e `icon.png` (512 px, `mcpb/icone.png`). O zip é escrito por `mcpb/zip.ts`, sem dependência.
- **Um `.mcpb` só serve aos três sistemas:** o lançador é JavaScript puro e acha o Estúdio de cada um.
- No `.github/workflows/build.yml`, a linha do Linux gera o `.mcpb` depois do `mcp:build` e o confere com o validador
  oficial (`npx @anthropic-ai/mcpb@2.1.2 unpack` e `validate`, que falha o passo se o manifesto não passar). Ele sobe
  como o artifact **`estudio-claude-desktop`**.
- **Na release**, o `.mcpb` vai junto dos instaladores. Baixe os artifacts da execução da tag e anexe tudo na mesma
  release:

  ```bash
  gh run download <id> --dir artefatos
  gh release create v4.0.1 --title "Estúdio 2.0.1" --notes-file notas.md \
    artefatos/estudio-win-x64/instalador/Estudio-Setup-2.0.1.exe \
    artefatos/estudio-mac-*/instalador/*.dmg \
    artefatos/estudio-*/pacote/make/zip/**/*.zip \
    artefatos/estudio-claude-desktop/Estudio-2.0.1.mcpb
  ```

  Os caminhos dentro de `artefatos/` seguem o que o `upload-artifact` guardou (confira com `ls -R artefatos`). A tag
  segue a convenção do README (V4 = `v4.0.0` para o pacote 2.0.0; esta é a 2.0.1).

## Testar de ponta a ponta

Pelos testes (rodam em qualquer sistema, inclusive no CI de Windows e Mac):

```bash
npx vitest run testes/claude-desktop.test.ts testes/claude-desktop-mcp.test.ts
```

O teste "extensão .mcpb de ponta a ponta" faz o caminho do Claude Desktop:

1. roda `mcp:build` e `mcpb`;
2. desempacota o `.mcpb`;
3. cria uma pasta pessoal temporária (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`);
4. roda `node server/index.js` com o cliente MCP do SDK, como manda o `mcp_config`;
5. confere:
   - sem o Estúdio, a ferramenta `estudio_instalar` e a mensagem;
   - com um Estúdio "instalado" no lugar padrão do sistema, a lista de projetos, a escolha e a gravação com a origem
     "Claude Desktop";
   - com o "app" aberto (o `McpHttp` de verdade e a descoberta publicada pelo mesmo código do app), a chamada indo ao
     app, com o cartão do portão e a origem "Claude Desktop".

À mão, numa máquina com o Claude Desktop:

1. `npm run mcp:build && npm run mcpb`, e instale o Estúdio (ou rode o de desenvolvimento com `env -u
   ELECTRON_RUN_AS_NODE npm run dev`);
2. instale `out/mcpb/Estudio-2.0.1.mcpb` no Claude Desktop, ou use o botão do app. Para o app de desenvolvimento, o botão
   grava o Electron do `node_modules` e o `dist-mcp/desktop.cjs` do repositório;
3. reinicie o Claude Desktop e confira se o conector "Estúdio" aparece com as ferramentas;
4. com o app fechado, peça "liste meus projetos do Estúdio", depois "escolha o X e mude o fundo da capa para preto".
   Abra o projeto no app: o Histórico mostra "Claude Desktop";
5. com o app aberto no projeto, peça a mesma mudança e veja a tela acompanhar. Peça para ler uma página da web: o
   cartão de permissão aparece na tela do app, com "Claude Desktop";
6. no Claude Desktop, veja o log do servidor (Configurações › Desenvolvedor, ou `mcp-server-estudio.log` na pasta de
   logs do Claude). O lançador escreve `estudio (extensão 2.0.1): usando <executável>`.

## O que só uma máquina com o Claude Desktop de verdade confirma

- se o Claude Desktop instala o `.mcpb` sem reclamar do manifesto. O validador oficial passa, mas o instalador do app
  pode ter regras próprias, como o aviso de extensão não assinada;
- se o `node` do `mcp_config` vira o Node embutido do Claude Desktop no Windows e no Mac, sem Node no sistema;
- se o Claude Desktop do Linux (da comunidade) aceita o `platform_overrides.linux`;
- se o Claude Desktop oferece elicitação, para o portão com o app fechado;
- o nome da pasta onde o Claude Desktop guarda as extensões (`Claude Extensions/<id>`), que o app usa para avisar
  "extensão já instalada". Se for outro, só o aviso some;
- no Mac assinado e notarizado, se o `ELECTRON_RUN_AS_NODE` continua valendo para um processo filho do Claude Desktop
  (é o mesmo mecanismo do `.mcp.json` da frente IDE, `docs/portes.md`, seção 8);
- no Windows, se fechar a conversa ou o Claude Desktop não deixa o Estúdio em modo Node rodando. O `desktop.cjs` sai
  quando o stdin acaba, mas isso só foi visto no Linux.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/nucleo/claude-desktop.ts` | caminhos dos três sistemas, mesclagem do `claude_desktop_config.json`, descoberta, lista de projetos |
| `src/nucleo/mcp-desktop.ts` | o servidor: catálogo, `listar_projetos` e `escolher_projeto`, pelo app ou local, portão local |
| `src/nucleo/mcp-projeto.ts`, `src/nucleo/novo-projeto.ts` | frente 2: criar, abrir, duplicar e fechar projeto, no app e sem ele |
| `mcp/desktop.ts` | a entrada por stdio (vira `dist-mcp/desktop.cjs` no `mcp:build`) |
| `src/main/claude-desktop.ts` | no app: descoberta (publicar e retirar) e o botão (conectar, desconectar, estado) |
| `mcpb/manifest.json`, `mcpb/lancador.ts`, `mcpb/index.ts`, `mcpb/zip.ts`, `mcpb/icone.png` | a extensão |
| `scripts/mcpb.ts` | `npm run mcpb` |
| `testes/claude-desktop.test.ts` | sistemas, mesclagem com arquivos, descoberta, lançador, manifesto e zip |
| `testes/claude-desktop-mcp.test.ts` | app fechado, portão, app aberto e ponta a ponta com o `.mcpb` |

## Frentes em paralelo

Esta frente não mexe no `src/nucleo/ide.ts` nem no guia do `CLAUDE.md`, que são da `frente/harnesses`. Não precisa de
nada dela. Fica uma observação: o Claude Desktop não lê o `CLAUDE.md` do projeto, então as instruções que ele recebe
são as do servidor (`INSTRUCOES_DESKTOP`, em `src/nucleo/mcp-desktop.ts`), que somam as do MCP às regras de projeto
desta página. Se o guia do projeto ganhar algo que o Claude Desktop também precise saber, ele chega pelo
`guia_do_projeto`, como para qualquer cliente.
