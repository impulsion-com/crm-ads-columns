// La barre de controle du rail, et les bandeaux.
//
// LE MODELE ET LA FENETRE VIVENT ICI, PAS DANS LE POPUP. On change de modele en
// comparant, dix fois dans la meme minute ; aller chercher le popup a chaque
// fois tuerait l usage. Le popup ne porte que les VALEURS PAR DEFAUT.
//
// LA PERIODE EST TOUJOURS AFFICHEE, AVEC SA PROVENANCE. Un decalage entre ce
// que la plateforme montre et ce que le CRM a calcule ne doit jamais etre
// silencieux : c est la facon la plus simple de prendre une decision de budget
// sur les chiffres du mois dernier sans s en apercevoir.

(function (root) {
  "use strict";

  var P = root.IMPULSION_PANNEAU;
  var F = root.IMPULSION_FORMAT;

  var MODELES_REPLI = [
    { cle: "first_paid_click", label: "Premier clic payant" },
    { cle: "last_paid_click", label: "Dernier clic payant" },
    { cle: "first_click", label: "Premier clic" },
    { cle: "last_click", label: "Dernier clic" },
    { cle: "linear", label: "Linéaire" },
    { cle: "position_based", label: "Basé sur la position" },
    { cle: "time_decay", label: "Décroissance temporelle" }
  ];

  var LIBELLE_SOURCE = {
    url: "lue dans l’URL",
    selecteur: "lue dans le sélecteur de dates",
    reseau: "lue dans les appels de la page",
    extension: "forcée ici",
    defaut: "par défaut, non détectée"
  };

  function option(v, libelle, choisi) {
    return (
      '<option value="' +
      P.echapper(v) +
      '"' +
      (choisi ? " selected" : "") +
      ">" +
      P.echapper(libelle) +
      "</option>"
    );
  }

  /** « 3 leads », « 1 vente » : le nombre, puis le mot accordé. */
  function compter(n, singulier, pluriel) {
    return (
      '<b>' + P.echapper(F.nombre(n)) + "</b> " + (Math.abs(n) > 1 ? pluriel : singulier)
    );
  }

  function rendre(barre, ctx, actions) {
    var modeles = ctx.modeles && ctx.modeles.length ? ctx.modeles : MODELES_REPLI;
    var parDefaut = ctx.periode.source === "defaut";

    var html = "";
    html +=
      '<span class="marque">' + P.icone("colonnes") + "<span>Colonnes CRM</span></span>";

    // La période : quand elle n a pas pu être lue dans la page, la barre le DIT,
    // en ocre. Des chiffres sur 30 jours face à un tableau réglé sur 7 se lisent
    // sinon comme un désaccord entre la régie et le serveur.
    html +=
      '<span class="champ periode" data-defaut="' +
      (parDefaut ? "1" : "0") +
      '" title="' +
      (parDefaut
        ? "La période affichée par la page n’a pas pu être lue : les chiffres portent sur ces 30 derniers jours."
        : "Période interrogée, " + P.echapper(LIBELLE_SOURCE[ctx.periode.source] || ctx.periode.source) + ".") +
      '">';
    html += P.icone("calendrier");
    html +=
      "<span>" +
      P.echapper(F.jourCourt(ctx.periode.du) + " au " + F.jourCourt(ctx.periode.au)) +
      "</span>";
    if (parDefaut) html += '<span class="mention">période par défaut</span>';
    html += "</span>";

    html += '<label class="champ" title="Modèle d’attribution : il décide à quelle ligne revient chaque vente.">';
    html += '<span class="sr">Modèle d’attribution</span>';
    html += '<select data-role="modele">';
    for (var i = 0; i < modeles.length; i++) {
      html += option(modeles[i].cle, modeles[i].label, modeles[i].cle === ctx.modele);
    }
    html += "</select></label>";

    html +=
      '<label class="champ" title="Fenêtre d’attribution, en jours. Au-delà de ' +
      (ctx.fenetreMax || 90) +
      ', le serveur ramène à ' +
      (ctx.fenetreMax || 90) +
      '.">';
    html += "<span>Fenêtre</span>";
    html +=
      '<input type="number" min="1" max="' +
      (ctx.fenetreMax || 90) +
      '" step="1" value="' +
      Number(ctx.fenetre) +
      '" data-role="fenetre">';
    html += "<span>j</span></label>";

    // Les totaux de la periode, MEME quand aucune ligne n est identifiee : ils
    // prouvent que la moitie donnees fonctionne, et separent d un coup d oeil
    // « le DOM resiste » de « le serveur ne repond pas ». Zero ligne et des
    // totaux pleins, c est un probleme d ecran, plus jamais un mystere.
    if (ctx.totaux) {
      // Un entonnoir sans etape d entree ou sans vente n a pas ces cles : on
      // n ecrit que ce que le serveur a rendu.
      var morceaux = [];
      if (typeof ctx.totaux.leads === "number") morceaux.push(compter(ctx.totaux.leads, "lead", "leads"));
      if (typeof ctx.totaux.ventes === "number") morceaux.push(compter(ctx.totaux.ventes, "vente", "ventes"));
      if (typeof ctx.totaux.caSigne === "number") morceaux.push("<b>" + P.echapper(F.euros(ctx.totaux.caSigne)) + "</b>");
      if (morceaux.length) {
        html +=
          '<span class="totaux" title="Ce que la publicité a produit sur la période, toutes lignes confondues.">' +
          morceaux.join('<i aria-hidden="true">·</i>') +
          "</span>";
      }
    }

    var identifiees = ctx.identifiees || 0;
    var total = ctx.total || 0;
    var alerte = total > 0 && identifiees / total < 1;
    html +=
      '<span class="compteur" data-alerte="' +
      (alerte ? "1" : "0") +
      '" title="Lignes du tableau que l’extension a su rattacher à une campagne connue du serveur.">' +
      identifiees +
      " / " +
      total +
      (total > 1 ? " lignes" : " ligne") +
      "</span>";

    html += '<span class="outils">';
    html +=
      '<button class="bouton" data-role="actualiser" title="Redemander les chiffres" aria-label="Redemander les chiffres">' +
      P.icone("rafraichir") +
      "</button>";
    html +=
      '<button class="bouton" data-role="diagnostic" title="Mode diagnostic : montrer ce que l’extension reconnaît" aria-label="Mode diagnostic">' +
      P.icone("diagnostic") +
      "</button>";
    html +=
      '<button class="bouton" data-role="replier" title="Replier la barre" aria-label="Replier la barre">' +
      P.icone("replier") +
      "</button>";
    html += "</span>";

    barre.innerHTML = html;

    var sel = barre.querySelector('[data-role="modele"]');
    if (sel) {
      sel.addEventListener("change", function () {
        actions.surModele(sel.value);
      });
    }
    var fen = barre.querySelector('[data-role="fenetre"]');
    if (fen) {
      fen.addEventListener("change", function () {
        var v = Math.max(1, Math.min(Number(ctx.fenetreMax || 90), Number(fen.value) || 90));
        fen.value = String(v);
        actions.surFenetre(v);
      });
    }
    var brancher = function (role, rappel) {
      var b = barre.querySelector('[data-role="' + role + '"]');
      if (b) b.addEventListener("click", rappel);
    };
    brancher("actualiser", actions.surActualiser);
    brancher("diagnostic", actions.surDiagnostic);
    brancher("replier", actions.surReplier);
  }

  /**
   * Les bandeaux, poses entre la barre et les en-tetes.
   *
   * Un seul a la fois, par ordre de gravite : une erreur d API rend inutile
   * d apprendre que la periode ne correspond pas.
   */
  function bandeaux(rail, barre, liste) {
    var anciens = rail.querySelectorAll(".bandeau");
    for (var i = 0; i < anciens.length; i++) {
      anciens[i].parentNode.removeChild(anciens[i]);
    }
    if (!liste || !liste.length) return;

    var b = liste[0];
    var el = document.createElement("div");
    el.className = "bandeau";
    el.setAttribute("data-ton", b.ton || "alerte");
    var html = P.icone(b.ton === "erreur" ? "alerte" : "alerte");
    html += "<span>" + P.echapper(b.texte) + "</span>";
    if (b.actions && b.actions.length) {
      html += '<span class="actions">';
      for (var k = 0; k < b.actions.length; k++) {
        html +=
          '<button class="bouton" data-action="' +
          k +
          '">' +
          P.echapper(b.actions[k].libelle) +
          "</button>";
      }
      html += "</span>";
    }
    el.innerHTML = html;
    if (b.actions) {
      var boutons = el.querySelectorAll("[data-action]");
      for (var j = 0; j < boutons.length; j++) {
        (function (indice) {
          boutons[indice].addEventListener("click", function () {
            b.actions[indice].faire();
          });
        })(j);
      }
    }
    barre.parentNode.insertBefore(el, barre.nextSibling);
  }

  root.IMPULSION_ENTETE = { rendre: rendre, bandeaux: bandeaux, LIBELLE_SOURCE: LIBELLE_SOURCE };
})(typeof self !== "undefined" ? self : window);
