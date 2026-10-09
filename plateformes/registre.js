// Quel adaptateur pour quelle URL.
//
// Ce fichier est charge dans LES DEUX MONDES : le monde isole en a besoin pour
// les selecteurs, le monde MAIN pour le predicat de moisson reseau. C est
// pourquoi aucun fichier de `plateformes/` ne touche jamais `chrome.*` : il n y
// a pas d API d extension dans le monde MAIN.

(function (root) {
  "use strict";

  var ADAPTATEURS = [
    root.IMPULSION_META,
    root.IMPULSION_GOOGLE,
    root.IMPULSION_TIKTOK
  ].filter(Boolean);

  function pour(url) {
    for (var i = 0; i < ADAPTATEURS.length; i++) {
      try {
        if (ADAPTATEURS[i].reconnait(url)) return ADAPTATEURS[i];
      } catch (e) {
        /* un adaptateur casse ne doit pas empecher les autres de repondre */
      }
    }
    return null;
  }

  root.IMPULSION_REGISTRE = { pour: pour, tous: ADAPTATEURS };
})(typeof self !== "undefined" ? self : window);
