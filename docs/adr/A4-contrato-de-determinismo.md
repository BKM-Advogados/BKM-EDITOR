# A4. Contrato de determinismo em duas classes

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

A D1 promete que se ouve o que vai para o vídeo. Tempo real em worklet, knob mexido na hora e entrada de áudio não podem prometer amostra a amostra. A SEQ-18 marcava `exige_rever_D1` por engano: tempo real em worklet não fere a D1, só muda a garantia.

## Decisão

Duas classes.

- **Canônico:** offline, bloco fixo, mesmo código ou `.wasm`, soma em ordem fixa, denormais tratados no código. Verificado por hash SHA-256 do PCM na janela, no main e no stdio.
- **Prévia viva:** worklet, knob mexido na hora, entrada de áudio. Declarada "aproximada". Um botão "ouvir como no render" toca o canônico.

Regra de ouro da migração: documento de música antigo soa igual (mesmo PCM) depois de qualquer mudança no motor.

## Consequências

- Hashes de referência nos 4 ambientes viram teste obrigatório (M-03).
- Uma mudança que altere o PCM de um documento antigo é bloqueada; se for inevitável, pede decisão do dono e versão nova do esquema.
- A interface mostra quando o que se ouve é prévia aproximada.
- Corrige a classificação da SEQ-18.
