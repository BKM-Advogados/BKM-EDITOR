# A6. Licença do Estúdio e política de dependências

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

O `package.json` tem `private: true` e o repo não tem LICENSE. Antes de escolher qualquer biblioteca de áudio é preciso saber o que pode entrar no bundle e no WASM.

## Decisão

Registrar a política.

- **Embutidas:** MIT, BSD, Apache-2.0, CC0 e CC-BY (com crédito por `musica-licencas.ts`).
- **LGPL:** só em módulo separado e substituível, com parecer.
- **GPL e AGPL:** fora do bundle e do WASM. Isso exclui Surge XT, Vital, Dexed, Dragonfly, Guitarix, Rubber Band, JUCE sem licença comercial e PyFLP como código. Podem servir como referência de ideias, sem copiar código.

## Consequências

- Dexed, Rubber Band e semelhantes são reescritos do zero (FM, stretch) ou trocados por alternativas permissivas.
- Cada dependência nova de áudio registra a licença SPDX antes de entrar.
- A licença do próprio Estúdio continua pendente de decisão do dono; esta política vale em qualquer caso.
- Vem antes de qualquer escolha de biblioteca.
