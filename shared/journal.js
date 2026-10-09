// Journalisation silencieuse par defaut.
//
// Une extension qui parle dans la console d Ads Manager pollue le seul endroit
// ou l on va chercher un vrai probleme. Elle se tait donc, sauf en mode
// diagnostic, ou elle devient au contraire tres bavarde : c est le moment ou
// l on cherche pourquoi une ligne n est pas reconnue.
//
// Les erreurs, elles, sont TOUJOURS gardees en memoire, meme silencieuses : le
// rapport de diagnostic doit pouvoir raconter ce qui s est passe avant qu on
// pense a activer le mode.

(function (root) {
  "use strict";

  var PREFIXE = "[colonnes-crm]";
  var actif = false;
  var dernieres = [];
  var MAX = 40;

  function garder(niveau, args) {
    dernieres.push({
      niveau: niveau,
      quand: new Date().toISOString(),
      texte: Array.prototype.map
        .call(args, function (a) {
          if (a instanceof Error) return a.message;
          if (typeof a === "object") {
            try {
              return JSON.stringify(a).slice(0, 400);
            } catch (e) {
              return "[objet]";
            }
          }
          return String(a);
        })
        .join(" ")
    });
    if (dernieres.length > MAX) dernieres.shift();
  }

  root.IMPULSION_JOURNAL = {
    activer: function (v) {
      actif = Boolean(v);
    },
    estActif: function () {
      return actif;
    },
    dire: function () {
      garder("info", arguments);
      if (!actif) return;
      var a = Array.prototype.slice.call(arguments);
      a.unshift(PREFIXE);
      console.log.apply(console, a);
    },
    erreur: function () {
      garder("erreur", arguments);
      if (!actif) return;
      var a = Array.prototype.slice.call(arguments);
      a.unshift(PREFIXE);
      console.warn.apply(console, a);
    },
    /** Les dernieres lignes, pour le rapport copiable. */
    historique: function () {
      return dernieres.slice();
    }
  };
})(typeof self !== "undefined" ? self : window);
