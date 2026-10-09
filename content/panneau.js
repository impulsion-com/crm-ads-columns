// Le rail : les colonnes du CRM, alignees ligne a ligne sur le tableau de la
// plateforme.
//
// C EST LE MODE DE REPLI, ET IL EST TOUJOURS DISPONIBLE. L injection de vraies
// cellules dans leur tableau (`rendu-natif.js`) est tentee en premier ; quand
// la structure n est pas reconnue, on bascule ici et on le DIT. Une refonte de
// DOM chez Meta ne doit jamais rendre l extension muette.
//
// POURQUOI CE MODE NE PEUT PAS BOUCLER SUR LUI-MEME, et c est sa propriete
// structurante : le MutationObserver surveille LEUR tableau, nos noeuds vivent
// sous `document.body`, hors de cette cible. La cible d observation et la cible
// d ecriture sont disjointes par construction. Toute la classe de bugs
// « injection qui declenche l observateur qui reinjecte » disparait, elle n est
// pas seulement attenuee.
//
// LE COUT ASSUME, ET SA PARADE. Un rail decale d un cran met le bon chiffre en
// face de la mauvaise ligne, et c est invisible. D ou le nom de l entite
// affiche dans CHAQUE ligne du rail, en premiere position : l oeil compare deux
// textes sur la meme ligne visuelle, et un decalage saute aux yeux. Ca coute
// environ 120 px de rail. Ca les vaut.

(function (root) {
  "use strict";

  var J = root.IMPULSION_JOURNAL;
  var F = root.IMPULSION_FORMAT;
  var ICONES = root.IMPULSION_ICONES;

  var ID_HOTE = "impulsion-crm-colonnes";

  var etat = {
    hote: null,
    ombre: null,
    racine: null,
    rail: null,
    corps: null,
    enteteMesures: null,
    pool: new Map(),
    colonnes: [],
    largeur: 560,
    replie: false,
    afficherNom: true
  };

  function texteRessource(chemin) {
    return fetch(chrome.runtime.getURL(chemin)).then(function (r) {
      return r.text();
    });
  }

  /** Monte l hote et son shadow root. Idempotent : appele a chaque fois que
   *  l orchestrateur constate que l hote a disparu, ce qui arrive quand la SPA
   *  change de route et vide le body. */
  function monter(options) {
    if (document.getElementById(ID_HOTE)) return Promise.resolve(etat);

    var hote = document.createElement("div");
    hote.id = ID_HOTE;
    hote.setAttribute("role", "complementary");
    hote.setAttribute("aria-label", "Colonnes CRM");
    // L hote ne capte rien : ce sont ses enfants qui le font. Sans ca, un hote
    // plein ecran avalerait les clics destines a la page.
    hote.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    if (options && options.theme) hote.setAttribute("data-theme", options.theme);

    var ombre = hote.attachShadow({ mode: "open" });
    document.body.appendChild(hote);

    return Promise.all([texteRessource("shared/jetons.css"), texteRessource("content/panneau.css")])
      .then(function (feuilles) {
        var style = document.createElement("style");
        style.textContent = feuilles.join("\n");
        ombre.appendChild(style);

        var racine = document.createElement("div");
        racine.className = "racine";
        ombre.appendChild(racine);

        etat.hote = hote;
        etat.ombre = ombre;
        etat.racine = racine;
        etat.pool = new Map();
        return etat;
      })
      .catch(function (e) {
        if (J) J.erreur("montage du panneau", e && e.message);
        return etat;
      });
  }

  function demonter() {
    var h = document.getElementById(ID_HOTE);
    if (h && h.parentNode) h.parentNode.removeChild(h);
    etat.hote = null;
    etat.ombre = null;
    etat.racine = null;
    etat.rail = null;
    etat.corps = null;
    etat.pool = new Map();
  }

  /** Construit le rail, une fois. */
  function assurerRail(options) {
    if (etat.rail) return etat.rail;
    var rail = document.createElement("div");
    rail.className = "rail";
    rail.style.pointerEvents = "auto";

    var poignee = document.createElement("div");
    poignee.className = "poignee";
    rail.appendChild(poignee);
    brancherRedimensionnement(poignee, rail, options);

    var barre = document.createElement("div");
    barre.className = "barre";
    rail.appendChild(barre);

    var enteteMesures = document.createElement("div");
    enteteMesures.className = "entete-mesures";
    rail.appendChild(enteteMesures);

    var corps = document.createElement("div");
    corps.className = "corps";
    rail.appendChild(corps);

    etat.racine.appendChild(rail);
    etat.rail = rail;
    etat.barre = barre;
    etat.enteteMesures = enteteMesures;
    etat.corps = corps;
    return rail;
  }

  function brancherRedimensionnement(poignee, rail, options) {
    var depart = null;
    poignee.addEventListener("mousedown", function (e) {
      depart = { x: e.clientX, largeur: etat.largeur };
      e.preventDefault();
    });
    var bouger = function (e) {
      if (!depart) return;
      var neuve = Math.min(1100, Math.max(220, depart.largeur + (depart.x - e.clientX)));
      etat.largeur = neuve;
      rail.style.width = neuve + "px";
    };
    var relacher = function () {
      if (!depart) return;
      depart = null;
      if (options && options.surLargeur) options.surLargeur(etat.largeur);
    };
    window.addEventListener("mousemove", bouger, true);
    window.addEventListener("mouseup", relacher, true);
  }

  /**
   * Positionne le rail contre le bord droit du tableau.
   *
   * L ENVELOPPE DES LIGNES PRIME SUR LA GRILLE. La grille vient de selecteurs
   * qui peuvent designer un anctre trop large ou un mauvais element, et le
   * rail se retrouvait a flotter en haut a droite de l ecran, loin du tableau.
   * L enveloppe, elle, est mesuree sur les lignes REELLEMENT trouvees : c est
   * la ou le tableau est, par construction. La grille ne sert que de repli
   * quand aucune ligne n est encore mesuree.
   */
  function positionner(grille, enveloppe) {
    if (!etat.rail) return;
    var boite = null;
    if (enveloppe) {
      // Un peu d air au-dessus, pour que la barre de controle du rail ne
      // recouvre pas la premiere ligne.
      boite = { top: enveloppe.top - 8, bottom: enveloppe.bottom + 8 };
    } else if (grille) {
      try {
        boite = grille.getBoundingClientRect();
      } catch (e) {
        boite = null;
      }
    }
    var haut = boite ? Math.max(0, boite.top) : 0;
    var bas = boite ? Math.min(window.innerHeight, boite.bottom) : window.innerHeight;
    // EN MODE NATIF, la barre quitte le tableau. Ancree en haut du tableau,
    // elle recouvrait ses colonnes de droite (constate sur capture reelle : la
    // colonne « Cout par resultat » disparaissait dessous). Les donnees vivant
    // desormais DANS les lignes, la barre de controle n a plus besoin d etre
    // collee au tableau : une pastille en bas a droite, la ou l ecran est
    // vide. Sa largeur suit son contenu.
    if (etat.rail.getAttribute("data-natif") === "1") {
      etat.rail.style.top = "auto";
      etat.rail.style.bottom = "14px";
      etat.rail.style.right = "14px";
      etat.rail.style.height = "auto";
      etat.rail.style.width = "auto";
      etat.rail.style.maxWidth = "94vw";
      etat.rail.style.borderRadius = "10px";
      etat.rail.setAttribute("data-replie", "0");
      return;
    }
    etat.rail.style.top = haut + "px";
    etat.rail.style.bottom = "";
    etat.rail.style.maxWidth = "";
    etat.rail.style.borderRadius = "";
    etat.rail.style.height = Math.max(120, bas - haut) + "px";
    etat.rail.style.right = "0px";
    etat.rail.style.width = (etat.replie ? 28 : etat.largeur) + "px";
    etat.rail.setAttribute("data-replie", etat.replie ? "1" : "0");
  }

  /** Largeur de chaque colonne. Le nom prend ce qui reste. */
  function gabarit() {
    var mesures = etat.colonnes.length;
    var largeurMesure = 78;
    var largeurNom = etat.afficherNom
      ? Math.max(90, etat.largeur - mesures * largeurMesure - 8)
      : 0;
    return { largeurNom: largeurNom, largeurMesure: largeurMesure };
  }

  function rendreEntete() {
    if (!etat.enteteMesures) return;
    var g = gabarit();
    var html = "";
    if (etat.afficherNom) {
      html +=
        '<div class="cellule nom" style="width:' +
        g.largeurNom +
        'px" title="Le nom de la ligne que l’extension croit reconnaître. Un décalage se voit ici.">Ligne</div>';
    }
    for (var i = 0; i < etat.colonnes.length; i++) {
      var c = etat.colonnes[i];
      html +=
        '<div class="cellule" style="width:' +
        g.largeurMesure +
        'px" title="' +
        echapper(c.label + (c.aide ? " : " + c.aide : "")) +
        '">' +
        echapper(c.entete) +
        "</div>";
    }
    etat.enteteMesures.innerHTML = html;
  }

  function echapper(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Aligne les lignes du rail sur les boites mesurees.
   *
   * `mesures` est produit par l orchestrateur en PHASE DE LECTURE pure. Ici on
   * n ecrit que : aucun `getBoundingClientRect`, aucun `getComputedStyle`.
   * Melanger les deux provoque un « layout thrashing » qui fait tomber le
   * defilement a quinze images par seconde.
   *
   * Le pool est indexe par IDENTITE (ou, a defaut, par nom normalise) et non
   * par position : on repositionne des elements existants, on n en recree pas.
   */
  function aligner(mesures, options) {
    if (!etat.corps) return;

    // Le decalage du corps, et c etait UN VRAI BUG d alignement : les hauteurs
    // mesurees sont relatives a la fenetre, mais les lignes du rail vivent DANS
    // le corps, qui commence sous la barre de controle et les en-tetes. Sans
    // cette soustraction, chaque ligne du rail etait environ cent pixels trop
    // bas, en face de la mauvaise ligne du tableau. La mesure porte sur NOTRE
    // rail, pas sur le DOM de la page : pas de bascule lecture-ecriture croisee
    // avec leur tableau.
    remettreGlisse();
    var base = 0;
    try {
      base = etat.corps.getBoundingClientRect().top;
    } catch (e) {
      base = 0;
    }

    var g = gabarit();
    var vivants = new Set();

    for (var i = 0; i < mesures.length; i++) {
      var m = mesures[i];
      var cle = m.ligne.externalId || "nom:" + F.normaliserNom(m.ligne.nom) + ":" + m.ligne.ordinal;
      vivants.add(cle);

      var el = etat.pool.get(cle);
      if (!el) {
        el = document.createElement("div");
        el.className = "ligne";
        etat.corps.appendChild(el);
        etat.pool.set(cle, el);
      }
      el.style.transform = "translateY(" + Math.round(m.haut - base) + "px)";
      el.style.height = Math.round(m.hauteur) + "px";
      peindre(el, m.ligne, g, options);
    }

    // Retirer ce qui n est plus a l ecran plutot que le masquer : un pool qui
    // grossit sans fin sur une session longue finit par peser.
    etat.pool.forEach(function (el, cle) {
      if (!vivants.has(cle)) {
        if (el.parentNode) el.parentNode.removeChild(el);
        etat.pool.delete(cle);
      }
    });
  }

  /** Le defilement pur : une seule transform sur le corps, zero mesure. */
  function glisser(delta) {
    if (!etat.corps) return;
    var courant = Number(etat.corps.getAttribute("data-glisse") || 0) + delta;
    etat.corps.setAttribute("data-glisse", String(courant));
    etat.corps.style.transform = "translateY(" + Math.round(courant) + "px)";
  }

  function remettreGlisse() {
    if (!etat.corps) return;
    etat.corps.setAttribute("data-glisse", "0");
    etat.corps.style.transform = "";
  }

  var LIBELLE_ETAT = {
    inconnu: "ligne non identifiée",
    ambigu: "identifiants contradictoires",
    absent: "inconnue du serveur"
  };

  function peindre(el, ligne, g, options) {
    var etatLigne = ligne.etatAffichage;
    if (el.getAttribute("data-signature") === ligne.signature) return;
    el.setAttribute("data-signature", ligne.signature || "");
    el.setAttribute("data-etat", etatLigne);
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", ligne.nom || "ligne");

    var html = "";
    if (etat.afficherNom) {
      html +=
        '<div class="cellule nom" style="width:' +
        g.largeurNom +
        'px" title="' +
        echapper(ligne.nomCrm || ligne.nom) +
        '">' +
        echapper(ligne.nomCrm || ligne.nom || "-") +
        "</div>";
    }

    if (etatLigne !== "ok") {
      var libelle = LIBELLE_ETAT[etatLigne] || etatLigne;
      if (etatLigne === "ambigu" && ligne.detail && ligne.detail.nombre) {
        libelle = "nom ambigu (" + ligne.detail.nombre + " entites)";
      }
      // AUCUN CHIFFRE, pas meme un tiret : un tiret dans une colonne de leads
      // se lit comme un zero au bout de trois secondes.
      html +=
        '<div class="message"><span class="pastille"></span>' + echapper(libelle) + "</div>";
      el.innerHTML = html;
      return;
    }

    for (var i = 0; i < etat.colonnes.length; i++) {
      var c = etat.colonnes[i];
      var brut = ligne.mesures ? ligne.mesures[c.cle] : null;
      html +=
        '<div class="cellule chiffre" data-colonne="' +
        echapper(c.cle) +
        '" style="width:' +
        g.largeurMesure +
        'px" role="button" tabindex="-1" title="' +
        echapper(c.label + ", cliquer pour voir les personnes") +
        '">' +
        echapper(F.formater(c.format, brut === undefined ? null : brut)) +
        "</div>";
    }
    el.innerHTML = html;

    if (options && options.surClic) {
      el.addEventListener("click", function (ev) {
        var cible = ev.target.closest ? ev.target.closest(".cellule") : null;
        if (!cible) return;
        options.surClic(ligne, cible.getAttribute("data-colonne"));
      });
    }
  }

  function definirColonnes(colonnes) {
    etat.colonnes = colonnes || [];
    rendreEntete();
    // Les largeurs ont change : le pool doit se repeindre entierement.
    etat.pool.forEach(function (el) {
      el.removeAttribute("data-signature");
    });
  }

  function definirOptions(o) {
    if (o.largeur) etat.largeur = o.largeur;
    if (typeof o.afficherNom === "boolean") etat.afficherNom = o.afficherNom;
    if (typeof o.replie === "boolean") etat.replie = o.replie;
    if (o.theme && etat.hote) etat.hote.setAttribute("data-theme", o.theme);
  }

  /** Le rail en mode natif : reduit a sa barre de controle. */
  function modeNatif(actif) {
    if (etat.rail) etat.rail.setAttribute("data-natif", actif ? "1" : "0");
  }

  function actualisation(actif) {
    if (etat.rail) etat.rail.setAttribute("data-actualise", actif ? "1" : "0");
  }

  root.IMPULSION_PANNEAU = {
    ID_HOTE: ID_HOTE,
    etat: etat,
    monter: monter,
    demonter: demonter,
    assurerRail: assurerRail,
    positionner: positionner,
    aligner: aligner,
    glisser: glisser,
    remettreGlisse: remettreGlisse,
    definirColonnes: definirColonnes,
    definirOptions: definirOptions,
    actualisation: actualisation,
    modeNatif: modeNatif,
    echapper: echapper,
    icone: function (nom) {
      return ICONES ? ICONES.html(nom) : "";
    }
  };
})(typeof self !== "undefined" ? self : window);
