// Le tiroir de detail : qui se cache derriere une ligne.
//
// C EST LA FONCTION DEMANDEE EN PREMIER. « Voir exactement d ou viennent les
// prospects, les rendez-vous, les clients, et pouvoir cliquer dessus. » Tout le
// reste de l extension existe pour amener a ce panneau.
//
// UN TIROIR ET NON UNE BULLE ANCREE, et ce n est pas une question de gout : une
// bulle attachee a une ligne qui peut defiler hors champ, ou etre recyclee par
// la virtualisation pendant qu elle est ouverte, est une fabrique a bugs. Le
// tiroir est independant du tableau.
//
// NON MODAL (`aria-modal="false"`) : on veut pouvoir continuer a faire defiler
// le tableau derriere pour comparer. Le piege de focus est donc SOUPLE,
// relache par Echap.

(function (root) {
  "use strict";

  var P = root.IMPULSION_PANNEAU;
  var F = root.IMPULSION_FORMAT;

  var etat = { element: null, ouvert: false, focusPrecedent: null, cle: null };

  /** Les modeles fractionnaires repartissent une meme conversion sur plusieurs
   *  touches. Une meme personne apparait alors sous plusieurs entites, avec des
   *  fractions d euros. Sans cette note, on croit a un doublon. */
  var FRACTIONNAIRES = { linear: 1, position_based: 1, time_decay: 1 };

  function assurer(racine) {
    if (etat.element) return etat.element;
    var el = document.createElement("div");
    el.className = "tiroir";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "impulsion-tiroir-titre");
    el.setAttribute("data-ouvert", "0");
    el.style.pointerEvents = "auto";
    racine.appendChild(el);
    etat.element = el;

    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        fermer();
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        var liens = Array.prototype.slice.call(el.querySelectorAll(".prospect"));
        if (!liens.length) return;
        ev.preventDefault();
        var i = liens.indexOf(document.activeElement);
        var suivant = ev.key === "ArrowDown" ? i + 1 : i - 1;
        if (suivant < 0) suivant = liens.length - 1;
        if (suivant >= liens.length) suivant = 0;
        liens[suivant].focus();
      }
      if (ev.key === "Tab") {
        // Piege de focus SOUPLE : on boucle dans le tiroir tant qu il est
        // ouvert, et Echap le relache. Un piege dur enfermerait l utilisateur
        // dans un panneau non modal, ce qui est le pire des deux mondes.
        var focusables = el.querySelectorAll("a[href], button, [tabindex]:not([tabindex='-1'])");
        if (!focusables.length) return;
        var premier = focusables[0];
        var dernier = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === premier) {
          ev.preventDefault();
          dernier.focus();
        } else if (!ev.shiftKey && document.activeElement === dernier) {
          ev.preventDefault();
          premier.focus();
        }
      }
    });

    return el;
  }

  function squelette() {
    var s = '<div class="squelette">';
    for (var i = 0; i < 6; i++) {
      s += '<div style="width:' + (60 + ((i * 13) % 35)) + '%"></div>';
    }
    return s + "</div>";
  }

  function tete(titre, contexte) {
    return (
      '<div class="tete">' +
      '<button class="fermer" data-role="fermer" aria-label="Fermer">' +
      P.icone("fermer") +
      "</button>" +
      '<h2 id="impulsion-tiroir-titre" tabindex="-1">' +
      P.echapper(titre) +
      "</h2>" +
      '<div class="contexte">' +
      P.echapper(contexte) +
      "</div></div>"
    );
  }

  function ouvrir(racine, ligne, ctx) {
    var el = assurer(racine);
    var cle = ligne.niveau + ":" + ligne.externalId;
    if (!etat.ouvert) etat.focusPrecedent = document.activeElement;
    etat.cle = cle;
    etat.ouvert = true;

    var contexte =
      F.jourCourt(ctx.periode.du) +
      " au " +
      F.jourCourt(ctx.periode.au) +
      " · " +
      (ctx.modeleLabel || ctx.modele) +
      " · fenêtre " +
      ctx.fenetre +
      " j";

    el.innerHTML = tete(ligne.nomCrm || ligne.nom || "Ligne", contexte) + squelette();
    el.setAttribute("data-ouvert", "1");
    brancherFermeture(el);

    var titre = el.querySelector("#impulsion-tiroir-titre");
    if (titre) titre.focus();

    return cle;
  }

  function brancherFermeture(el) {
    var b = el.querySelector('[data-role="fermer"]');
    if (b) b.addEventListener("click", fermer);
  }

  function remplir(reponse, ctx, cle) {
    var el = etat.element;
    if (!el || etat.cle !== cle) return; // l utilisateur a change de ligne entre-temps

    var prospects = reponse.prospects || [];
    var total = prospects.reduce(function (n, p) {
      return n + (p.credit || 0);
    }, 0);

    var html = tete(
      reponse.entite.nom,
      F.jourCourt(reponse.periode.debut) +
        " au " +
        F.jourCourt(reponse.periode.fin) +
        " · " +
        (ctx.modeleLabel || reponse.modele) +
        " · fenêtre " +
        reponse.fenetreDemandee +
        " j"
    );

    if (!prospects.length) {
      html +=
        '<div class="vide"><strong>Personne sur cette période</strong>' +
        "Ce n’est pas une panne : cette ligne n’a amené aucune vente ni aucun prospect, " +
        "ou ce qu’elle a amené tombe hors de la fenêtre d’attribution.</div>";
    } else {
      html += '<div class="liste">';
      for (var i = 0; i < prospects.length; i++) {
        var p = prospects[i];
        html +=
          '<a class="prospect" href="' +
          P.echapper(p.lien) +
          '" target="_blank" rel="noopener noreferrer">' +
          '<span class="qui">' +
          P.echapper(p.nom) +
          "</span>" +
          '<span class="etape">' +
          P.echapper(p.etape) +
          "</span>" +
          '<span class="credit">' +
          P.echapper(F.euros(p.credit)) +
          "</span>" +
          '<span class="quand">' +
          P.echapper(F.jourCourt(p.jour)) +
          "</span></a>";
      }
      html += "</div>";
    }

    var pied = "";
    pied +=
      "<span>" +
      prospects.length +
      (reponse.caches
        ? " affichées sur " + (prospects.length + reponse.caches)
        : prospects.length > 1
          ? " personnes"
          : " personne") +
      " · " +
      F.euros(total) +
      " attribués" +
      "</span>";
    if (reponse.caches) {
      pied +=
        '<a href="' +
        P.echapper(reponse.lienListe) +
        '" target="_blank" rel="noopener noreferrer">Voir les ' +
        (prospects.length + reponse.caches) +
        "</a>";
    }
    if (FRACTIONNAIRES[reponse.modele]) {
      pied +=
        '<span class="precision">Ce modèle partage une vente entre plusieurs lignes : une même personne ' +
        "peut apparaître ailleurs, avec une fraction du montant. La somme reste juste.</span>";
    }
    html += '<div class="pied">' + pied + "</div>";

    el.innerHTML = html;
    brancherFermeture(el);
  }

  function echouer(erreur, cle, reessayer) {
    var el = etat.element;
    if (!el || etat.cle !== cle) return;
    var corps = el.querySelector(".squelette");
    var html =
      '<div class="vide">' +
      P.echapper(erreur.message || "Le serveur n’a pas répondu.") +
      '<button class="bouton" data-role="reessayer">Réessayer</button></div>';
    if (corps) {
      corps.outerHTML = html;
    } else {
      el.insertAdjacentHTML("beforeend", html);
    }
    var b = el.querySelector('[data-role="reessayer"]');
    if (b && reessayer) b.addEventListener("click", reessayer);
  }

  function fermer() {
    if (!etat.element) return;
    etat.element.setAttribute("data-ouvert", "0");
    etat.ouvert = false;
    etat.cle = null;
    // Rendre le focus a son point de depart. Si la cellule d origine a ete
    // recyclee par la virtualisation entre-temps, `focus()` echoue en silence
    // et le focus retombe sur le body, ce qui est acceptable.
    try {
      if (etat.focusPrecedent && etat.focusPrecedent.focus) etat.focusPrecedent.focus();
    } catch (e) {
      /* rien */
    }
  }

  function estOuvert() {
    return etat.ouvert;
  }

  root.IMPULSION_TIROIR = {
    ouvrir: ouvrir,
    remplir: remplir,
    echouer: echouer,
    fermer: fermer,
    estOuvert: estOuvert
  };
})(typeof self !== "undefined" ? self : window);
