# A7. Conteúdo: pacote base no instalador, bibliotecas por download

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

Sem som acústico embarcado, o app não pode dizer que faz metal. Embarcar tudo incha o instalador e mistura licenças; só baixar deixa o app mudo na primeira execução.

## Decisão

Um pacote base pequeno no instalador e as bibliotecas por download sob demanda.

- **Pacote base:** kit acústico mínimo, IRs próprios e 10 a 20 presets, tudo CC0 próprio.
- **Bibliotecas:** manifesto, SHA-256, SPDX e crédito.

## Consequências

- É preciso produzir o conteúdo base próprio (gravar ou sintetizar) com licença CC0.
- O download valida o SHA-256 do manifesto antes de usar; a licença e o crédito aparecem no app.
- Projetos que usam uma biblioteca guardam a referência (id e hash), não o conteúdo.
- O instalador cresce pouco; a política de licenças é a da A6.
