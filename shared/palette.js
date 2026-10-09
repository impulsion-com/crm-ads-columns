// Les couleurs de la charte, en JavaScript.
//
// POURQUOI CE FICHIER EXISTE, ALORS QUE LES JETONS SONT DANS jetons.css. Le
// rendu natif ecrit des styles INLINE sur des cellules posees dans le DOM de la
// plateforme, hors de notre shadow root. Les proprietes personnalisees `--ac-*`
// n y sont pas heritees : elles vivent sur notre hote, pas sur leur tableau.
// C est le seul endroit ou une couleur doit exister en JavaScript.
//
// LA CONTRAINTE QUI VA AVEC : chaque valeur d ici DOIT figurer dans
// shared/jetons.css. `scripts/verifier.py` echoue sinon. Deux palettes qui
// derivent l une de l autre, c est une interface qui n a plus l air d elle-meme
// a un seul endroit, et personne ne sait lequel fait autorite.

(function (root) {
  "use strict";

  root.IMPULSION_PALETTE = {
    cream: "#f5f2ec",
    creamDark: "#ece7dd",
    navy: "#081f29",
    navySoft: "#0f2d3a",
    petrol: "#1f4d5c",
    olive: "#5c6b3e",
    terra: "#a04733",
    gray: "#5c6773",
    ochre: "#7b6032",
    ochreLight: "#c4a46e"
  };
})(typeof self !== "undefined" ? self : window);
