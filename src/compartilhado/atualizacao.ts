// Atualização do Estúdio (docs/atualizacao.md): o que a tela vê e pede. Os canais entram no CANAL do api.ts.
import type {Novidade} from '../nucleo/atualizacao';

export const CANAL_ATUALIZACAO = {
  atualizacaoEstado: 'estudio:atualizacao-estado',
  atualizacaoProcurar: 'estudio:atualizacao-procurar',
  atualizacaoAcao: 'estudio:atualizacao-acao',
  atualizacaoMudou: 'estudio:atualizacao-mudou',
  atualizacaoOcupado: 'estudio:atualizacao-ocupado',
} as const;

/**
 * - `windows`: o electron-updater baixa sozinho e instala ao fechar (ou no "Reiniciar e atualizar");
 * - `aviso`: Mac e Linux avisam e abrem o download no navegador; no Linux instalado pelo script, também atualizam sozinhos
 *   com a confirmação da pessoa (`linux_script`);
 * - `desligado`: em desenvolvimento (app sem empacotar), nada acontece.
 */
export type ModoAtualizacao = 'windows' | 'aviso' | 'desligado';

/**
 * nada → disponivel (aviso na tela) → baixando → pronta (instala ao fechar ou no reinício) → aguardando (reinício pedido
 * com exportação ou gravação em andamento) → instalando. `falhou` só aparece para o que a pessoa pediu.
 */
export type FaseAtualizacao = 'nada' | 'disponivel' | 'baixando' | 'pronta' | 'aguardando' | 'instalando' | 'falhou';

export type EstadoAtualizacao = {
  versao_atual: string;
  modo: ModoAtualizacao;
  /** Linux instalado pelo scripts/instalar-linux.sh (~/.local/opt/Estudio): oferece atualizar sozinho e mostra o comando. */
  linux_script: boolean;
  comando_linux?: string;
  automatico: boolean;
  procurando: boolean;
  /** Quando procurou pela última vez (ISO), com ou sem novidade. */
  ultima_procura?: string;
  /** Resultado da última procura pedida pelo botão ("Você já está na versão mais nova", "Sem conexão…"). */
  mensagem?: string;
  fase: FaseAtualizacao;
  novidade?: Novidade;
  /** 0 a 1, durante o download. */
  progresso?: number;
  /** O que segura o reinício ("a exportação", "a gravação da narração"). */
  esperando?: string;
  /** O aviso foi escondido com "Lembrar depois" (volta na próxima procura). */
  adiada: boolean;
  erro?: string;
};

export type AcaoAtualizacao = 'baixar' | 'pular' | 'depois' | 'mostrar' | 'reiniciar' | 'atualizar_linux' | 'cancelar_reinicio';

/** O que a tela diz estar fazendo e que segura o reinício (a exportação o processo principal já sabe). */
export type OcupadoNaTela = {gravando_narracao?: boolean; exportando?: boolean; salvando?: boolean};

export type ApiAtualizacao = {
  estado: () => Promise<EstadoAtualizacao>;
  /** "Procurar agora": mesmo com a procura automática desligada. */
  procurar: () => Promise<EstadoAtualizacao>;
  acao: (a: AcaoAtualizacao) => Promise<EstadoAtualizacao>;
  aoMudar: (cb: (e: EstadoAtualizacao) => void) => () => void;
  ocupado: (o: OcupadoNaTela) => void;
};
