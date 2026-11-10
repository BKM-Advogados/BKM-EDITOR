// Três peças sem React da gravação na interface (frente Casca, rodada 3), para terem teste:
//  - transversal-D10: quanto tempo o aviso fica no rodapé (o erro fica 9 s no estado e o rodapé o escondia aos 4 s);
//  - transversal-D16: edições do mesmo documento saem uma por vez, cada uma com a versão que a anterior deixou, e o aviso
//    de conflito só culpa o agente quando a causa não foi a pessoa mesma;
//  - transversal-D11: o selo "Salvo" da barra diz se está gravando ou se a última gravação falhou.

export const VALIDADE_AVISO_MS = 4000;
export const VALIDADE_ERRO_MS = 9000;

/** Erro fica mais tempo que o resto: dá para ler, e o rodapé e a loja contam o mesmo prazo. */
export const validadeDoAviso = (tipo: string): number => (tipo === 'erro' ? VALIDADE_ERRO_MS : VALIDADE_AVISO_MS);

/** O aviso ainda vale em `agora`? Devolve o próprio aviso ou null. */
export const avisoVivo = <T extends {tipo: string; em: number}>(aviso: T | undefined | null, agora: number): T | null =>
  aviso && agora - aviso.em < validadeDoAviso(aviso.tipo) ? aviso : null;

/** Quanto falta (ms) para o aviso vencer; 0 se já venceu. */
export const restaDoAviso = (aviso: {tipo: string; em: number}, agora: number): number => Math.max(0, validadeDoAviso(aviso.tipo) - (agora - aviso.em));

// ---------- fila por documento ----------
/** Roda as tarefas de uma mesma chave uma depois da outra; chaves diferentes não esperam umas pelas outras. */
export class FilaPorChave {
  private caudas = new Map<string, Promise<unknown>>();

  /** `esperou` diz à tarefa se havia outra da mesma chave na frente dela. Um erro de uma tarefa não trava as seguintes. */
  enfileirar<T>(chave: string, tarefa: (esperou: boolean) => Promise<T>): Promise<T> {
    const anterior = this.caudas.get(chave);
    const rodar = (anterior ?? Promise.resolve()).then(() => tarefa(Boolean(anterior)));
    const cauda = rodar.catch(() => undefined);
    this.caudas.set(chave, cauda);
    void cauda.then(() => {
      if (this.caudas.get(chave) === cauda) this.caudas.delete(chave);
    });
    return rodar;
  }
}

/** Dois cliques ou duas teclas seguidos da pessoa: o segundo conflito é dela mesma e não do agente. */
export const JANELA_EDICAO_PROPRIA_MS = 1500;

export const AVISO_EDICOES_SEGUIDAS = 'Duas edições seguidas se cruzaram e a segunda não entrou. Refaça a última.';
export const AVISO_OUTRA_MAO = 'O documento mudou por outra mão (agente?). Recarreguei; refaça a edição.';

/** Mensagem para uma edição que não entrou. `propria` é true quando uma edição da própria pessoa estava na frente dela na
 *  fila ou acabou de terminar; só um conflito de versão ou de teste sem isso culpa "outra mão". */
export const mensagemDeFalhaNaEdicao = (mensagem: string, propria: boolean): string => {
  const conflito = mensagem.includes('mudou') || /TEST_OPERATION_FAILED/.test(mensagem);
  if (!conflito) return mensagem;
  return propria ? AVISO_EDICOES_SEGUIDAS : AVISO_OUTRA_MAO;
};

// ---------- selo "Salvo" ----------
export type Gravacao = {estado: 'salvo' | 'gravando' | 'falhou'; erro?: string};

/** Conta as gravações em andamento e guarda a última falha até uma gravação dar certo. */
export class EstadoDeGravacao {
  private pendentes = 0;
  private ultimoErro: string | undefined;

  comecar(): Gravacao {
    this.pendentes++;
    return this.ler();
  }

  /** `erro` é a mensagem de uma gravação que falhou; sem ele, a gravação deu certo e limpa a falha anterior. */
  terminar(erro?: string): Gravacao {
    this.pendentes = Math.max(0, this.pendentes - 1);
    this.ultimoErro = erro;
    return this.ler();
  }

  ler(): Gravacao {
    if (this.pendentes > 0) return {estado: 'gravando'};
    return this.ultimoErro ? {estado: 'falhou', erro: this.ultimoErro} : {estado: 'salvo'};
  }
}
