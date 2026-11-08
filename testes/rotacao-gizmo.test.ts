// Rodada 3, frente C: o gizmo não grava ângulos trocados ao girar além de 90° em Y (tres-efeitos-D10).
import {describe, expect, it} from 'vitest';
import {Euler, Quaternion, Vector3} from 'three';
import {rotacaoMaisPerto} from '../src/nucleo/cena3d';
import type {Vetor3} from '../src/nucleo/documentos';

const GRAU = Math.PI / 180;

/** O que o gizmo faz: gira o objeto por um quaternion e o Three devolve o Euler XYZ em graus. */
const girarY = (rotacao: Vetor3, graus: number): Vetor3 => {
  const q = new Quaternion().setFromEuler(new Euler(rotacao[0] * GRAU, rotacao[1] * GRAU, rotacao[2] * GRAU, 'XYZ'));
  q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), graus * GRAU)); // espaço do mundo, como o gizmo
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return [e.x / GRAU, e.y / GRAU, e.z / GRAU];
};
const mesmaPose = (a: Vetor3, b: Vetor3) => {
  const qa = new Quaternion().setFromEuler(new Euler(a[0] * GRAU, a[1] * GRAU, a[2] * GRAU, 'XYZ'));
  const qb = new Quaternion().setFromEuler(new Euler(b[0] * GRAU, b[1] * GRAU, b[2] * GRAU, 'XYZ'));
  return Math.abs(qa.dot(qb)) > 1 - 1e-9;
};
const quase = (v: Vetor3, e: Vetor3) => v.forEach((x, i) => expect(x).toBeCloseTo(e[i], 6));

describe('girar pelo gizmo além de 90° em Y (D10)', () => {
  it('o Euler cru do Three troca os ângulos (a causa do defeito)', () => {
    const cru = girarY([0, 25, 0], 100);
    expect(Math.abs(cru[0])).toBeCloseTo(180, 4); // a leitura que o inspetor mostrava: 180, 55, 180
    expect(cru[1]).toBeCloseTo(55, 4);
  });

  it('com a rotação de antes como referência, 25° + 100° em Y volta como 0, 125, 0', () => {
    const cru = girarY([0, 25, 0], 100);
    const certo = rotacaoMaisPerto(cru, [0, 25, 0]);
    quase(certo, [0, 125, 0]);
    expect(mesmaPose(certo, cru)).toBe(true); // é a mesma pose, só lida de outro jeito
  });

  it('o delta do arrasto é o giro feito, e a prévia animada soma ao Y certo', () => {
    const antes: Vetor3 = [0, 25, 0];
    const depois = rotacaoMaisPerto(girarY(antes, 100), antes);
    expect(depois[1] - antes[1]).toBeCloseTo(100, 6);
    expect(depois[0]).toBeCloseTo(0, 6);
    expect(depois[2]).toBeCloseTo(0, 6);
  });

  it('segue contínuo ao girar no sentido contrário e passando de 180°', () => {
    const marcos: Vetor3[] = [[0, 25, 0]];
    let atual: Vetor3 = [0, 25, 0];
    for (let i = 0; i < 12; i++) {
      atual = rotacaoMaisPerto(girarY(atual, 30), atual); // 12 passos de 30°: 360° no total
      marcos.push(atual);
    }
    quase(marcos[4], [0, 145, 0]);
    quase(marcos[12], [0, 385, 0]); // sem voltar a 25: a pessoa girou uma volta e o delta mostra 360°
    let volta: Vetor3 = [0, 25, 0];
    for (let i = 0; i < 5; i++) volta = rotacaoMaisPerto(girarY(volta, -40), volta);
    quase(volta, [0, -175, 0]);
  });

  it('uma rotação que já está perto fica como está', () => {
    expect(rotacaoMaisPerto([10, 20, 30], [0, 0, 0])).toEqual([10, 20, 30]);
    expect(rotacaoMaisPerto([0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('com X e Z já fora do zero, mantém a pose e escolhe a forma mais próxima', () => {
    const antes: Vetor3 = [30, 80, 10];
    const cru = girarY(antes, 20);
    const certo = rotacaoMaisPerto(cru, antes);
    expect(mesmaPose(certo, cru)).toBe(true);
    const custo = (v: Vetor3) => v.reduce((s, x, i) => s + Math.abs(x - antes[i]), 0);
    expect(custo(certo)).toBeLessThanOrEqual(custo(cru) + 1e-9);
  });
});
