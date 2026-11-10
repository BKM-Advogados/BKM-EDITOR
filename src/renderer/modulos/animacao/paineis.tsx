// Módulo de animação 2D com quadros-chave e arte em pixel
import type {PaineisDoModulo} from "../../casca/contrato";
import {comLimiteDeErro} from "../../componentes/LimiteDeErro";
import {CamadasAnimacao} from "./CamadasAnimacao";
import {InspectorAnimacao} from "./InspectorAnimacao";
import {LinhaDoTempoAnimacao} from "./LinhaDoTempoAnimacao";
import {MonitorAnimacao} from "./MonitorAnimacao";
import "./animacao.css";

// cada painel dentro do limite de erro, como nas outras áreas: um documento fora do formato mostra o motivo no painel
// em vez de deixar a janela em branco
export const PaineisAnimacao: PaineisDoModulo = comLimiteDeErro({
  tituloLista: "Camadas",
  Lista: CamadasAnimacao,
  Monitor: () => <MonitorAnimacao />,
  Inspector: InspectorAnimacao,
  Linha: LinhaDoTempoAnimacao,
}, "Animação");
