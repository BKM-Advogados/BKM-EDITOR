// O projeto de exemplo do botão "Ver um exemplo": uma pasta de projeto do Estúdio dentro de exemplos/ no repositório,
// empacotada com o app (forge.config.ts, extraResource). Abrir o exemplo copia a pasta inteira para um projeto novo, então
// editar não estraga o exemplo da próxima vez. Sem a pasta (ou sem o estudio.json dela) o app não oferece o exemplo e o
// botão some. O conteúdo é neutro e sintético (exemplo-conteudo.ts) e a pasta sai de `npm run exemplo`
// (scripts/gerar-exemplo.ts). Para trocar o exemplo, mude exemplo-conteudo.ts e rode o script de novo.
export const EXEMPLO = {
  pasta: 'exemplo', // em exemplos/
  nome: 'Exemplo', // nome do projeto criado a partir dele
};
