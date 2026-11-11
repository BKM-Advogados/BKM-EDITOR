// Inspetor de propriedades da Animação: valores na cabeça, botão ◆ por propriedade, curvas e editor de pixel
import React, {useEffect, useState} from "react";
import {Diamond} from "lucide-react";
import {
  CURVAS, TEMA_ANIMACAO_NEUTRO, valorEm, type CamadaAnimacao, type Curva, type DocAnimacao,
  type PropriedadeAnimavel, type QuadroChave,
} from "../../../nucleo/animacao";
import {aplicar, useLoja} from "../../estado/loja";
import {
  CampoCor, CampoDeslizante, CampoNumero, CampoTexto, LinhaCampo,
} from "../../componentes/Campos";
import {EditorPixel} from "./EditorPixel";
import {aoQuadro, msAtual} from "./tocador";

export const InspectorAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const [tempoMs, setTempoMs] = useState(msAtual());

  useEffect(() => {
    return aoQuadro((ms) => setTempoMs(ms));
  }, []);

  if (!ativo || !doc) return <div className="vazio">Nenhuma animação aberta.</div>;

  // Se nenhuma camada selecionada, inspeciona as propriedades da cena / documento
  const matchCamada = selecao?.match(/^\/camadas\/(\d+)$/);
  const indiceCamada = matchCamada ? Number(matchCamada[1]) : -1;
  const camada: CamadaAnimacao | undefined = indiceCamada >= 0 ? doc.camadas?.[indiceCamada] : undefined;

  if (!camada || indiceCamada < 0) {
    return (
      <div className="inspector-conteudo">
        <div className="secao-titulo">Cena da Animação</div>
        <CampoNumero
          rotulo="Largura"
          valor={doc.largura}
          aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/largura", value: Math.max(16, v)}], "largura da cena")}
          unidade="px"
        />
        <CampoNumero
          rotulo="Altura"
          valor={doc.altura}
          aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/altura", value: Math.max(16, v)}], "altura da cena")}
          unidade="px"
        />
        <CampoNumero
          rotulo="Taxa (FPS)"
          valor={doc.fps}
          aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/fps", value: Math.max(1, v)}], "fps da cena")}
          unidade="qps"
        />
        <CampoNumero
          rotulo="Duração"
          valor={Math.round(doc.duracao_ms / 1000)}
          aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/duracao_ms", value: Math.max(100, v * 1000)}], "duração da cena")}
          unidade="s"
        />
        <CampoCor
          rotulo="Fundo"
          valor={doc.fundo}
          aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/fundo", value: v}], "fundo da animação")}
        />
      </div>
    );
  }

  const origem = `/camadas/${indiceCamada}`;
  const tema = {...TEMA_ANIMACAO_NEUTRO, ...(doc.tema ?? {})};

  // Auxiliar para verificar se há quadro-chave exatamente no tempo atual (margem de 25ms)
  const quadroChaveNoTempo = (prop: PropriedadeAnimavel): QuadroChave | undefined => {
    const trilha = camada.trilhas?.[prop];
    return trilha?.find((k) => Math.abs(k.t_ms - tempoMs) < 25);
  };

  const alternarQuadroChave = (prop: PropriedadeAnimavel) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = [...(trilhas[prop] ?? [])];
    const k = quadroChaveNoTempo(prop);

    if (k) {
      // Remove o quadro-chave no tempo
      const nova = lista.filter((item) => item !== k);
      if (nova.length > 0) trilhas[prop] = nova;
      else delete trilhas[prop];
    } else {
      // Adiciona quadro-chave com o valor atual
      const val = valorEm(camada, prop, tempoMs, tema);
      const novoK: QuadroChave = {
        t_ms: Math.round(tempoMs),
        valor: val,
        curva: "suave",
      };
      lista.push(novoK);
      lista.sort((a, b) => a.t_ms - b.t_ms);
      trilhas[prop] = lista;
    }

    aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `alternar quadro-chave ${prop}`);
  };

  const mudarValorPropriedade = (prop: PropriedadeAnimavel, novoValor: number | string) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = trilhas[prop];
    if (lista && lista.length > 0) {
      // Se a propriedade já está animada, cria ou atualiza o quadro-chave na cabeça de reprodução
      const k = quadroChaveNoTempo(prop);
      if (k) {
        k.valor = novoValor;
      } else {
        lista.push({t_ms: Math.round(tempoMs), valor: novoValor, curva: "suave"});
        lista.sort((a, b) => a.t_ms - b.t_ms);
      }
      aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `animar ${prop}`);
    } else {
      // Altera o valor base da camada
      aplicar(ativo, [{op: "add", path: `${origem}/${prop}`, value: novoValor}], `mudar ${prop}`);
    }
  };

  const mudarCurvaDoQuadro = (prop: PropriedadeAnimavel, curva: Curva) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = trilhas[prop];
    if (!lista || lista.length === 0) return;
    // Modifica o quadro-chave ativo ou o mais recente antes do tempo
    const ks = [...lista].sort((a, b) => a.t_ms - b.t_ms);
    const k = ks.find((item) => Math.abs(item.t_ms - tempoMs) < 25) ??
      [...ks].reverse().find((item) => item.t_ms <= tempoMs) ?? ks[0];
    if (k) {
      k.curva = curva;
      aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `curva de ${prop}`);
    }
  };

  // Valores avaliados no tempo corrente
  const x = Number(valorEm(camada, "x", tempoMs));
  const y = Number(valorEm(camada, "y", tempoMs));
  const escala = Number(valorEm(camada, "escala", tempoMs));
  const rotacao = Number(valorEm(camada, "rotacao", tempoMs));
  const opacidade = Number(valorEm(camada, "opacidade", tempoMs));
  const cor = String(valorEm(camada, "cor", tempoMs, tema));

  const BotaoLosango: React.FC<{prop: PropriedadeAnimavel}> = ({prop}) => {
    const ativoK = Boolean(quadroChaveNoTempo(prop));
    const temTrilha = Boolean(camada.trilhas?.[prop]?.length);
    return (
      <button
        type="button"
        className={`bt-losango${ativoK ? " ativo" : temTrilha ? " animado" : ""}`}
        onClick={() => alternarQuadroChave(prop)}
        title={ativoK ? "Remover quadro-chave neste tempo" : "Inserir quadro-chave neste tempo (K)"}
      >
        <Diamond size={11} fill={ativoK ? "currentColor" : "none"} />
      </button>
    );
  };

  return (
    <div className="inspector-conteudo">
      <div className="secao-titulo">
        <span>{camada.nome} ({camada.tipo})</span>
      </div>

      <div className="secao-subtitulo">Transformação</div>
      <div className="linha-com-losango">
        <BotaoLosango prop="x" />
        <CampoNumero rotulo="Posição X" valor={x} aoMudar={(v) => mudarValorPropriedade("x", v)} unidade="px" />
      </div>
      <div className="linha-com-losango">
        <BotaoLosango prop="y" />
        <CampoNumero rotulo="Posição Y" valor={y} aoMudar={(v) => mudarValorPropriedade("y", v)} unidade="px" />
      </div>
      <div className="linha-com-losango">
        <BotaoLosango prop="escala" />
        <CampoNumero rotulo="Escala" valor={escala} aoMudar={(v) => mudarValorPropriedade("escala", v)} passo={0.1} />
      </div>
      <div className="linha-com-losango">
        <BotaoLosango prop="rotacao" />
        <CampoNumero rotulo="Rotação" valor={rotacao} aoMudar={(v) => mudarValorPropriedade("rotacao", v)} unidade="°" />
      </div>
      <div className="linha-com-losango">
        <BotaoLosango prop="opacidade" />
        <CampoDeslizante
          rotulo="Opacidade"
          valor={opacidade}
          min={0}
          max={1}
          passo={0.05}
          aoMudar={(v) => mudarValorPropriedade("opacidade", v)}
        />
      </div>

      {camada.tipo === "forma" && (
        <>
          <div className="secao-subtitulo">Forma</div>
          <LinhaCampo rotulo="Tipo de forma">
            <select
              className="campo"
              value={camada.forma ?? "retangulo"}
              onChange={(e) =>
                aplicar(ativo, [{op: "add", path: `${origem}/forma`, value: e.target.value as "retangulo" | "elipse"}], "tipo de forma")
              }
            >
              <option value="retangulo">Retângulo</option>
              <option value="elipse">Elipse</option>
            </select>
          </LinhaCampo>
          <div className="linha-com-losango">
            <BotaoLosango prop="cor" />
            <CampoCor rotulo="Cor" valor={cor} aoMudar={(v) => mudarValorPropriedade("cor", v)} />
          </div>
          {camada.forma !== "elipse" && (
            <CampoNumero
              rotulo="Raio cantos"
              valor={camada.raio ?? 0}
              aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/raio`, value: v}], "raio cantos")}
              unidade="px"
            />
          )}
          <CampoNumero
            rotulo="Largura"
            valor={camada.largura}
            aoMudar={(v) => aplicar(ativo, [{op: "replace", path: `${origem}/largura`, value: Math.max(10, v)}], "largura")}
            unidade="px"
          />
          <CampoNumero
            rotulo="Altura"
            valor={camada.altura}
            aoMudar={(v) => aplicar(ativo, [{op: "replace", path: `${origem}/altura`, value: Math.max(10, v)}], "altura")}
            unidade="px"
          />
        </>
      )}

      {camada.tipo === "texto" && (
        <>
          <div className="secao-subtitulo">Texto</div>
          <CampoTexto
            rotulo="Conteúdo"
            valor={camada.texto ?? ""}
            aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/texto`, value: v}], "texto")}
            multilinha
          />
          <div className="linha-com-losango">
            <BotaoLosango prop="tamanho" />
            <CampoNumero
              rotulo="Tamanho"
              valor={Number(valorEm(camada, "tamanho", tempoMs))}
              aoMudar={(v) => mudarValorPropriedade("tamanho", v)}
              unidade="px"
            />
          </div>
          <div className="linha-com-losango">
            <BotaoLosango prop="cor" />
            <CampoCor rotulo="Cor" valor={cor} aoMudar={(v) => mudarValorPropriedade("cor", v)} />
          </div>
          <LinhaCampo rotulo="Alinhamento">
            <select
              className="campo"
              value={camada.alinhar ?? "centro"}
              onChange={(e) =>
                aplicar(ativo, [{op: "add", path: `${origem}/alinhar`, value: e.target.value as "esquerda" | "centro" | "direita"}], "alinhar")
              }
            >
              <option value="esquerda">Esquerda</option>
              <option value="centro">Centro</option>
              <option value="direita">Direita</option>
            </select>
          </LinhaCampo>
        </>
      )}

      {camada.tipo === "pixel" && (
        <>
          <div className="secao-subtitulo">Arte em Pixel</div>
          <div className="linha-com-losango">
            <BotaoLosango prop="progresso" />
            <CampoDeslizante
              rotulo="Progresso"
              valor={Number(valorEm(camada, "progresso", tempoMs))}
              min={0}
              max={1}
              passo={0.05}
              aoMudar={(v) => mudarValorPropriedade("progresso", v)}
            />
          </div>
          <div className="linha-com-losango">
            <BotaoLosango prop="tamanho_pixel" />
            <CampoNumero
              rotulo="Tamanho pixel"
              valor={Number(valorEm(camada, "tamanho_pixel", tempoMs))}
              aoMudar={(v) => mudarValorPropriedade("tamanho_pixel", v)}
              unidade="px"
            />
          </div>
          <EditorPixel documento={ativo} camada={camada} origem={origem} />
        </>
      )}

      {/* Curvas de animação das trilhas ativas */}
      {camada.trilhas && Object.keys(camada.trilhas).length > 0 && (
        <>
          <div className="secao-subtitulo">Curvas de Interpolação</div>
          {Object.entries(camada.trilhas).map(([p, ks]) => {
            if (!ks || ks.length === 0) return null;
            const prop = p as PropriedadeAnimavel;
            const k = ks.find((item) => Math.abs(item.t_ms - tempoMs) < 25) ?? ks[0];
            return (
              <LinhaCampo key={prop} rotulo={`Curva (${prop})`}>
                <select
                  className="campo"
                  value={k.curva ?? "suave"}
                  onChange={(e) => mudarCurvaDoQuadro(prop, e.target.value as Curva)}
                >
                  {CURVAS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </LinhaCampo>
            );
          })}
        </>
      )}
    </div>
  );
};
