// Les icones de l interface, en traces SVG.
//
// JAMAIS D EMOTICONE. C est la regle de charte qui coute le plus cher a
// enfreindre parce qu elle est invisible en revue de code : un emoji passe une
// relecture, puis se rend sur une capture d ecran, puis dans le Web Store.
//
// Grille 24, stroke-width 1,7, `currentColor` : l icone prend la couleur du
// texte qui la porte, donc le theme la suit sans une ligne de CSS de plus.
//
// Usage : poser `data-icone="nom"` sur un element vide, puis appeler
// `IMPULSION_ICONES.remplir(racine)` une fois le DOM en place.

(function (root) {
  "use strict";

  function svg(interieur) {
    return (
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      interieur +
      "</svg>"
    );
  }

  var TRACES = {
    colonnes: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
    calendrier:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    modele: '<path d="M3 17l5-6 4 4 4-7 5 5"/><circle cx="8" cy="11" r="1.2"/><circle cx="12" cy="15" r="1.2"/>',
    personnes:
      '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M17 8.5a2.8 2.8 0 100-.1M18 20c0-2.4-1-4.2-2.6-5.2"/>',
    alerte: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
    ok: '<path d="M4 12.5l5.2 5.2L20 7"/>',
    fermer: '<path d="M6 6l12 12M18 6L6 18"/>',
    lien: '<path d="M10.5 13.5a4 4 0 006 .5l2.5-2.5a4 4 0 10-5.7-5.7L12 6.9"/><path d="M13.5 10.5a4 4 0 00-6-.5L5 12.5a4 4 0 105.7 5.7L12 17.1"/>',
    rafraichir:
      '<path d="M20 12a8 8 0 10-2.6 5.9"/><path d="M20 6v5h-5"/>',
    reglages:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    diagnostic: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    replier: '<path d="M15 6l-6 6 6 6"/>',
    tableau: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'
  };

  function remplir(racine) {
    var cible = racine || document;
    var creneaux = cible.querySelectorAll("[data-icone]");
    for (var i = 0; i < creneaux.length; i++) {
      var nom = creneaux[i].getAttribute("data-icone");
      var trace = TRACES[nom];
      if (trace) creneaux[i].innerHTML = svg(trace);
    }
  }

  function html(nom) {
    return TRACES[nom] ? svg(TRACES[nom]) : "";
  }

  root.IMPULSION_ICONES = { remplir: remplir, html: html, TRACES: TRACES };
})(typeof self !== "undefined" ? self : window);
