// Lista de camadas da Animação, no mesmo desenho das outras áreas (lista da casa, ações da camada selecionada, olho e
// cadeado no hover): ordem, visibilidade, travamento, renomear (clique duplo) e "+ Camada". Com mais de uma animação no
// projeto, o seletor do topo troca a aberta, como na Imagem (sem ele, a segunda animação escondia a primeira).
import React, {useState} from "react";
import {
  ArrowDown, ArrowUp, Copy, Ellipsis, Eye, EyeOff, Grid, Image as ImageIcon, Lock, LockOpen, Plus, Square, Trash2, Type,
} from "lucide-react";
import type {CamadaAnimacao, DocAnimacao, TipoCamadaAnimacao} from "../../../nucleo/animacao";
import {idLivreAnimacao, novaCamadaAnimacao} from "../../../nucleo/animacao";
import {aplicar, selecionar, useLoja} from "../../estado/loja";
import {BotaoMenu} from "../../componentes/Menu";
import {SeletorDocumento} from "../../componentes/SeletorDocumento";

export const iconeTipoAnimacao = (tipo: TipoCamadaAnimacao) => {
  switch (tipo) {
    case "forma": return <Square />;
    case "texto": return <Type />;
    case "imagem": return <ImageIcon />;
    case "pixel": return <Grid />;
  }
};

export const NOME_TIPO_ANIMACAO: Record<TipoCamadaAnimacao, string> = {forma: "Forma", texto: "Texto", imagem: "Imagem", pixel: "Arte em pixel"};

export const CamadasAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [nomeTemp, setNomeTemp] = useState("");

  if (!ativo || !doc) {
    return (
      <div className="painel">
        <SeletorDocumento modulo="animacao" />
        <div className="vazio">Nenhuma animação aberta.</div>
      </div>
    );
  }

  const camadas = doc.camadas ?? [];

  const adicionarCamada = (tipo: TipoCamadaAnimacao) => {
    const id = idLivreAnimacao(doc, tipo);
    const nova = novaCamadaAnimacao(tipo, id);
    const novasCamadas = [...camadas, nova];
    aplicar(ativo, [{op: "replace", path: "/camadas", value: novasCamadas}], `adicionar camada ${tipo}`);
    selecionar({documento: ativo, caminho: `/camadas/${novasCamadas.length - 1}`});
  };

  const alternarVisivel = (i: number) => {
    const c = camadas[i];
    aplicar(ativo, [{op: "add", path: `/camadas/${i}/visivel`, value: !(c.visivel ?? true)}], "visibilidade da camada");
  };

  const alternarTravada = (i: number) => {
    const c = camadas[i];
    aplicar(ativo, [{op: "add", path: `/camadas/${i}/travada`, value: !(c.travada ?? false)}], "travar camada");
  };

  const moverCamada = (de: number, para: number) => {
    if (para < 0 || para >= camadas.length) return;
    const lista = [...camadas];
    const [c] = lista.splice(de, 1);
    lista.splice(para, 0, c);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "reordenar camadas");
    selecionar({documento: ativo, caminho: `/camadas/${para}`});
  };

  const duplicarCamada = (i: number) => {
    const c = camadas[i];
    const novoId = idLivreAnimacao(doc, c.tipo);
    const copia: CamadaAnimacao = {...JSON.parse(JSON.stringify(c)), id: novoId, nome: `${c.nome} (cópia)`, x: c.x + 20, y: c.y + 20};
    const lista = [...camadas];
    lista.splice(i + 1, 0, copia);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "duplicar camada");
    selecionar({documento: ativo, caminho: `/camadas/${i + 1}`});
  };

  const excluirCamada = (i: number) => {
    const lista = camadas.filter((_, idx) => idx !== i);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "excluir camada");
    selecionar(null);
  };

  const salvarNome = (i: number) => {
    if (nomeTemp.trim()) aplicar(ativo, [{op: "replace", path: `/camadas/${i}/nome`, value: nomeTemp.trim()}], "renomear camada");
    setEditandoNome(null);
  };
  const parar = (f: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    f();
  };

  return (
    <div className="painel">
      <SeletorDocumento modulo="animacao" />
      <div className="barra-lista">
        <BotaoMenu titulo="Adicionar camada" className="bt fantasma" lado="esquerda" icone={<Plus className="i14" />} rotulo="Camada"
          itens={(["forma", "texto", "imagem", "pixel"] as const).map((t) => ({rotulo: NOME_TIPO_ANIMACAO[t], icone: iconeTipoAnimacao(t), acao: () => adicionarCamada(t)}))} />
        <span className="espaco" />
        <span className="rotulo">{camadas.length === 1 ? "1 camada" : `${camadas.length} camadas`}</span>
      </div>
      <div className="painel-corpo sem-margem">
        {camadas.length === 0 && <div className="vazio">Nenhuma camada ainda. Use "+ Camada" para pôr uma forma, um texto, uma imagem ou arte em pixel.</div>}
        <ul className="lista">
          {/* de cima para baixo: a última do array é a da frente */}
          {camadas.map((_, k) => {
            const i = camadas.length - 1 - k;
            const c = camadas[i];
            const caminho = `/camadas/${i}`;
            const sel = selecao === caminho;
            const visivel = c.visivel !== false;
            const travada = c.travada === true;
            return (
              <li key={c.id ?? i} className={`${sel ? "sel" : ""}${visivel ? "" : " oculto"}`} tabIndex={0}
                onClick={() => selecionar({documento: ativo, caminho})} onKeyDown={(e) => e.key === "Enter" && selecionar({documento: ativo, caminho})}>
                <span className="tipo">{iconeTipoAnimacao(c.tipo)}</span>
                {editandoNome === c.id ? (
                  <input className="campo" value={nomeTemp} autoFocus aria-label="Nome da camada" onChange={(e) => setNomeTemp(e.target.value)}
                    onBlur={() => salvarNome(i)} onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") salvarNome(i);
                      if (e.key === "Escape") setEditandoNome(null);
                    }} />
                ) : (
                  <span className="nome" title="Clique duplo para renomear" onDoubleClick={parar(() => (setEditandoNome(c.id), setNomeTemp(c.nome)))}>{c.nome}</span>
                )}
                {sel && (
                  <>
                    <button className="bti" disabled={i === camadas.length - 1} title="Trazer para a frente" aria-label="Trazer para a frente" onClick={parar(() => moverCamada(i, i + 1))}><ArrowUp className="i14" /></button>
                    <button className="bti" disabled={i === 0} title="Enviar para trás" aria-label="Enviar para trás" onClick={parar(() => moverCamada(i, i - 1))}><ArrowDown className="i14" /></button>
                    <span onClick={(e) => e.stopPropagation()}>
                      <BotaoMenu titulo="Mais ações da camada" icone={<Ellipsis className="i14" />}
                        itens={[{rotulo: "Duplicar", icone: <Copy className="i14" />, acao: () => duplicarCamada(i)},
                          {rotulo: "Renomear", acao: () => (setEditandoNome(c.id), setNomeTemp(c.nome))}, "sep",
                          {rotulo: "Excluir camada", icone: <Trash2 className="i14" />, acao: () => excluirCamada(i)}]} />
                    </span>
                  </>
                )}
                <button className={`bti olho${visivel ? "" : " sempre"}`} title={visivel ? "Ocultar" : "Mostrar"} aria-label={visivel ? "Ocultar" : "Mostrar"}
                  onClick={parar(() => alternarVisivel(i))}>
                  {visivel ? <Eye className="i14" /> : <EyeOff className="i14" />}
                </button>
                <button className={`bti olho${travada ? " sempre" : ""}`} title={travada ? "Destravar" : "Travar: não anda no monitor e a IA não mexe"} aria-label={travada ? "Destravar" : "Travar"}
                  onClick={parar(() => alternarTravada(i))}>
                  {travada ? <Lock className="i14" /> : <LockOpen className="i14" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="dica-lista">Clique duplo renomeia · K grava um quadro-chave da posição</div>
    </div>
  );
};
