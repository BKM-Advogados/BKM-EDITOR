// Largura do texto medida com a fonte (frente Fala, fala-D6; docs/legendas.md): o avanço de cada letra nas quatro
// fontes do Google que as composições carregam (Inter, Archivo, IBM Plex Sans e IBM Plex Mono, OFL), em milésimos de
// em, por peso. Medido em 08/11/2026 no Chromium, com os arquivos .woff2 do subconjunto latino que o
// @remotion/google-fonts usa, carregados por FontFace e medidos letra a letra pelo canvas. A soma por letra fica a menos
// de 0,7% da medida da frase inteira (o kerning, que a tabela não tem). As letras acentuadas têm o avanço da letra base
// nas quatro fontes (conferido), então a tabela guarda só a base. Puro: serve ao núcleo, ao MCP e à composição quando
// não há canvas; no navegador, a composição mede com o canvas e a fonte carregada.

/** As letras da tabela, na ordem dos avanços. */
export const LETRAS_MEDIDAS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ºª°§–—“”‘’…€';

const AVANCOS: Record<string, Record<number, string>> = {
  Inter: {
    400: '281 288 466 633 642 982 644 300 365 365 501 662 288 460 288 360 631 407 610 618 646 593 620 566 619 620 288 302 662 662 662 511 966 690 654 730 722 601 590 746 743 269 571 672 565 903 753 765 639 765 644 642 646 744 690 985 682 679 629 365 360 365 471 456 323 562 612 571 612 583 370 613 591 242 242 549 242 876 591 600 612 612 376 528 327 591 562 818 546 562 552 426 333 426 662 482 454 456 568 500 1000 440 440 261 261 864 667',
    500: '267 304 494 639 646 993 653 313 369 369 521 667 303 462 303 370 646 415 616 627 656 603 630 571 629 630 303 315 667 667 667 527 982 709 657 733 722 603 589 748 745 272 575 688 565 913 756 767 642 769 648 646 653 740 709 1003 701 696 641 369 370 369 477 463 337 568 618 577 618 587 379 620 602 252 252 559 252 888 602 604 618 618 387 539 340 602 575 829 557 575 559 440 346 440 667 485 457 457 568 500 1000 474 471 277 277 910 672',
    600: '252 321 523 644 650 1004 663 326 373 373 540 673 319 465 319 379 660 423 623 636 666 612 640 576 640 640 319 329 673 673 673 543 999 728 659 737 722 605 588 749 746 277 580 703 565 922 759 769 645 773 652 650 660 736 728 1020 720 713 652 373 379 373 481 469 351 574 624 583 624 591 389 625 612 262 262 569 262 900 612 609 624 624 397 549 353 612 587 839 569 588 566 455 359 455 673 487 460 458 568 500 1000 507 501 294 294 956 679',
    700: '237 338 552 649 655 1016 672 339 377 377 559 679 334 468 334 388 674 431 630 646 676 622 649 582 651 649 334 343 679 679 679 560 1016 747 662 740 722 607 587 750 747 281 584 719 565 932 762 771 648 777 657 655 667 732 747 1038 738 731 664 377 388 377 487 476 365 581 630 588 630 596 398 632 623 271 271 580 271 913 623 613 630 630 407 560 366 623 600 850 580 602 573 469 372 469 679 490 464 459 568 500 1000 540 532 311 311 1002 685',
    800: '219 358 586 655 660 1029 683 354 382 382 583 686 353 471 353 400 692 441 638 657 688 634 662 588 664 662 353 360 686 686 686 579 1036 770 665 744 723 610 585 752 749 286 590 738 565 943 766 773 652 782 662 660 677 727 770 1059 761 752 679 382 400 382 493 484 382 588 638 595 638 601 410 639 635 283 283 593 283 927 635 619 638 638 420 573 382 635 615 863 594 618 581 486 388 486 686 493 468 461 568 500 1000 581 569 331 331 1058 692',
  },
  Archivo: {
    400: '209 273 374 582 510 950 692 209 355 355 407 625 277 333 277 294 573 521 567 573 555 571 573 553 574 573 296 296 625 625 625 578 1005 682 698 728 734 677 612 796 736 267 559 662 536 847 736 788 665 788 727 673 606 731 648 924 680 655 635 296 294 296 625 485 187 545 567 519 567 548 280 556 563 225 223 514 225 860 563 570 567 567 332 510 297 562 504 723 513 504 498 353 245 353 625 379 385 400 568 500 1000 394 394 239 239 844 581',
    500: '205 282 407 582 524 958 710 227 356 356 407 630 288 333 288 296 574 547 571 575 566 573 575 564 575 574 315 315 630 630 630 595 1002 695 702 725 731 674 611 795 734 274 571 677 552 846 734 785 667 785 722 670 612 728 659 938 683 666 635 316 296 316 630 495 197 550 579 532 579 554 293 573 573 238 236 528 238 860 573 583 579 579 346 524 305 572 516 740 529 516 503 372 245 372 630 385 390 400 573 500 1000 435 435 258 258 901 580',
    600: '200 292 444 583 541 966 729 246 357 357 407 636 300 333 300 298 575 576 576 576 577 575 576 576 576 575 336 336 636 636 636 613 998 709 706 721 728 672 609 794 732 282 585 695 570 844 732 782 670 782 717 667 619 724 671 954 686 677 634 339 298 339 636 507 209 556 592 547 592 561 307 591 584 252 250 543 252 861 584 598 592 592 362 541 314 583 529 758 546 529 509 394 245 394 636 391 397 400 579 500 1000 482 482 280 280 965 580',
    700: '196 301 456 600 556 973 764 253 364 364 407 641 307 333 307 300 595 596 596 596 597 595 596 596 596 595 335 335 641 641 641 613 1001 724 722 733 739 683 622 802 754 301 603 725 591 872 754 793 681 793 730 679 641 748 694 964 706 699 653 350 300 350 641 518 228 580 608 573 608 584 325 607 602 267 264 570 267 891 602 613 608 608 380 556 342 601 547 798 572 547 519 393 253 393 641 393 398 400 598 500 1000 488 488 280 280 973 599',
    800: '189 314 473 625 579 984 816 263 374 374 407 649 318 333 318 302 625 625 625 625 626 625 625 625 625 625 334 334 649 649 649 612 1005 746 745 752 755 699 641 815 787 329 630 770 623 914 787 810 698 810 750 697 675 783 729 979 736 732 682 366 302 366 649 534 257 616 633 612 633 619 352 632 629 288 286 610 288 937 629 635 633 633 407 579 385 629 574 859 612 574 535 391 265 391 649 396 399 400 627 500 1000 496 496 279 279 984 627',
  },
  'IBM Plex Sans': {
    400: '236 284 419 713 598 927 694 242 335 335 450 600 272 399 272 383 600 600 600 600 600 600 600 600 600 600 292 292 600 600 600 477 891 641 653 621 671 583 559 695 707 400 510 634 501 812 707 708 606 708 640 581 572 678 609 891 613 593 580 317 383 317 600 565 600 534 580 503 580 549 324 528 568 250 250 527 272 873 568 560 580 580 367 487 351 568 492 768 507 499 464 343 314 343 600 398 399 468 586 588 780 475 474 273 273 803 625',
    500: '236 299 451 678 599 947 706 253 336 336 514 600 288 401 288 416 600 600 600 600 600 600 600 600 600 600 308 308 600 600 600 487 896 660 659 634 682 593 570 705 714 414 531 660 513 815 714 711 627 711 655 599 577 685 627 926 639 617 592 324 416 324 600 561 600 549 592 509 592 555 340 538 580 265 265 548 285 882 580 562 592 592 383 494 365 580 512 799 530 514 487 355 352 355 600 413 420 469 579 588 780 501 500 285 285 843 626',
    600: '236 309 471 656 600 960 713 260 337 337 556 600 299 402 299 437 600 600 600 600 600 600 600 600 600 600 319 319 600 600 600 493 899 672 663 642 689 600 577 712 719 423 545 678 521 817 719 712 641 712 664 611 580 689 638 949 655 632 599 329 437 329 600 559 600 559 600 513 600 558 350 545 588 275 275 562 294 888 588 563 600 600 393 499 374 588 524 819 544 524 502 363 376 363 600 423 434 469 574 588 780 517 517 292 292 869 626',
    700: '236 320 493 632 601 974 721 268 338 338 601 600 310 403 310 460 600 600 600 600 600 600 600 600 600 600 330 330 600 600 600 500 903 685 667 651 697 607 585 719 724 432 559 696 530 819 724 714 656 714 674 624 584 694 650 973 673 649 607 334 460 334 600 556 600 569 608 517 608 562 361 552 596 286 286 577 303 894 596 564 608 608 404 504 383 596 538 841 560 534 518 372 402 372 600 433 449 470 569 588 780 535 535 300 300 897 627',
  },
};
// a Plex Mono é monoespaçada: 600 milésimos de em em todas as letras e pesos (medido)
const MONO = 600;

export const FONTES_MEDIDAS = ['Inter', 'Archivo', 'IBM Plex Sans', 'IBM Plex Mono'] as const;

const lidos = new Map<string, number[]>();
/** Os avanços (milésimos de em, na ordem de LETRAS_MEDIDAS) de uma fonte e peso medidos; o peso mais perto quando o
 *  pedido não foi medido. */
export const avancosDaFonte = (familia: string, peso: number): number[] => {
  if (familia === 'IBM Plex Mono') return Array.from(LETRAS_MEDIDAS, () => MONO);
  const pesos = AVANCOS[familia] ?? AVANCOS.Inter;
  const p = Object.keys(pesos).map(Number).reduce((a, b) => (Math.abs(b - peso) < Math.abs(a - peso) ? b : a));
  const chave = `${familia in AVANCOS ? familia : 'Inter'}|${p}`;
  let v = lidos.get(chave);
  if (!v) {
    v = pesos[p].split(' ').map(Number);
    lidos.set(chave, v);
  }
  return v;
};

/** O nome da fonte medida que corresponde a um font-family (com aspas, lista de reserva ou "Variable"); null quando não
 *  é nenhuma das quatro (fonte própria de um kit: aí a medida usa a Inter, a mais larga das sem serifa medidas). */
export const fonteMedida = (familia: string | undefined): (typeof FONTES_MEDIDAS)[number] | null => {
  const primeira = String(familia ?? '').split(',')[0].replace(/["']/g, '').replace(/\s+Variable$/i, '').trim().toLowerCase();
  return FONTES_MEDIDAS.find((f) => f.toLowerCase() === primeira) ?? null;
};

const semAcento = (ch: string) => ch.normalize('NFD').replace(/\p{Mn}/gu, '');

const mapas = new Map<string, Map<string, number>>();
/** Letra → avanço, já com as acentuadas (pela base) e o "n" para o que não está na tabela. */
const mapaDaFonte = (familia: string, peso: number) => {
  const f = fonteMedida(familia) ?? 'Inter';
  const chave = `${f}|${peso}`;
  let m = mapas.get(chave);
  if (!m) {
    const adv = avancosDaFonte(f, peso);
    m = new Map([...LETRAS_MEDIDAS].map((ch, i) => [ch, adv[i]]));
    m.set('', adv[LETRAS_MEDIDAS.indexOf('n')]);
    mapas.set(chave, m);
  }
  return m;
};

/** Largura do texto em milésimos de em, letra a letra. Letra acentuada vale a base; letra fora da tabela vale o "n". */
export const larguraEmMilesimos = (texto: string, familia: string, peso: number) => {
  const m = mapaDaFonte(familia, peso);
  let soma = 0;
  for (const ch of texto) {
    let a = m.get(ch);
    if (a === undefined) {
      a = m.get(semAcento(ch)) ?? m.get('')!;
      m.set(ch, a);
    }
    soma += a;
  }
  return soma;
};

/** Mede um texto em px. */
export type Medir = (texto: string) => number;

/** O medidor pela tabela: fonte, peso e tamanho da letra em px (maiúsculas mede o texto em caixa alta). */
export const medidorDaFonte = (o: {familia?: string; peso: number; tam: number; maiusculas?: boolean}): Medir => {
  const m = mapaDaFonte(o.familia ?? 'Inter', o.peso);
  const escala = o.tam / 1000;
  return (texto) => {
    let soma = 0;
    for (const ch of o.maiusculas ? texto.toLocaleUpperCase('pt-BR') : texto) {
      let a = m.get(ch);
      if (a === undefined) {
        a = m.get(semAcento(ch)) ?? m.get('')!;
        m.set(ch, a);
      }
      soma += a;
    }
    return soma * escala;
  };
};
