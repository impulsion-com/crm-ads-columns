// Injection de VRAIES cellules dans le tableau de la plateforme.
//
// C est le rendu demande, et c est le plus exigeant. Ce fichier existe pour
// tenir une promesse difficile sans mentir sur sa difficulte.
//
// CE QUI REND CE MODE FRAGILE, en clair, parce que le savoir change la facon de
// lire les symptomes :
//
//   1. React retire au rendu suivant les enfants qu il n a pas produits. Le
//      MutationObserver les remet. C est LA boucle infinie, et ce n est pas
//      theorique : c est le mode d echec standard de cette approche. La parade
//      n est pas d etre plus malin, c est de COMPTER. Au-dela de
//      REINJECTIONS_MAX arrachages dans la fenetre, on declare le mode natif
//      non viable pour cette session et l orchestrateur bascule sur le rail.
//      L extension le dit, elle ne s acharne pas.
//   2. Meta virtualise aussi ses COLONNES : seules celles a l ecran sont dans
//      le DOM, et leurs largeurs sont posees en style inline par son propre
//      moteur. Une cellule ajoutee a une largeur qu il ignore.
//   3. Renumeroter `aria-colindex` casserait la restitution aux lecteurs
//      d ecran, et se recasserait a chaque re-rendu. On ne le fait donc PAS :
//      nos cellules portent `aria-hidden` et le rail reste l interface
//      accessible. C est un compromis assume, pas un oubli.
//
// Le mode natif n est jamais « repare » en s entetant. Il reussit, ou il cede
// la place proprement.

(function (root) {
  "use strict";

  var J = root.IMPULSION_JOURNAL;
  var F = root.IMPULSION_FORMAT;
  var P = root.IMPULSION_PANNEAU;
  var COULEURS = root.IMPULSION_PALETTE;

  var MARQUE = "data-impulsion-cellule";
  var MARQUE_ENTETE = "data-impulsion-entete";

  /**
   * Le seuil d emballement, releve de 12 a 80 apres un constat d ecran reel :
   * Meta re-rend ses lignes EN PERMANENCE (survol, defilement, actualisation
   * des chiffres), et chaque re-rendu arrache nos pastilles. C est son
   * fonctionnement normal, pas un rejet : la re-pose est idempotente et coute
   * moins d une milliseconde par ligne. A douze, l extension abandonnait au
   * bout de quelques secondes d usage reel et l ecran se vidait. Le seuil ne
   * sert plus qu a attraper un VRAI emballement (une boucle a soixante
   * arrachages par seconde), pas la vie normale du tableau.
   */
  var REINJECTIONS_MAX = 80;
  var FENETRE_MS = 4000;

  var etat = {
    viable: null, // null = pas encore tranche
    arrachages: [],
    raison: null,
    colonnes: [],
    largeurCellule: 78
  };

  function nettoyer(racine) {
    var cible = racine || document;
    var poses = cible.querySelectorAll("[" + MARQUE + "], [" + MARQUE_ENTETE + "]");
    for (var i = 0; i < poses.length; i++) {
      if (poses[i].parentNode) poses[i].parentNode.removeChild(poses[i]);
    }
  }

  function noterArrachage() {
    var maintenant = Date.now();
    etat.arrachages.push(maintenant);
    etat.arrachages = etat.arrachages.filter(function (t) {
      return maintenant - t < FENETRE_MS;
    });
    if (etat.arrachages.length > REINJECTIONS_MAX) {
      etat.dernierEchec = Date.now();
      etat.viable = false;
      etat.raison =
        "Le tableau retire les cellules ajoutées aussi vite qu’on les pose (" +
        etat.arrachages.length +
        " fois en " +
        Math.round(FENETRE_MS / 1000) +
        " s). C’est le comportement normal de React face à un enfant qu’il n’a pas produit.";
      if (J) J.erreur("rendu natif abandonné", etat.raison);
      nettoyer();
      return false;
    }
    return true;
  }

  /**
   * Verifie que le tableau se prete a l injection, AVANT d y toucher.
   *
   * Les deux mesures qui decident, et elles se font en lecture pure :
   *   - les lignes ont-elles une structure de cellules reconnaissable ;
   *   - les largeurs sont-elles posees en style inline par leur moteur, auquel
   *     cas nos cellules deriveraient au defilement horizontal.
   */
  function evaluer(adaptateur, grille, lignes) {
    if (!grille || !lignes || lignes.length === 0) {
      return { viable: false, raison: "Aucune ligne trouvée dans le tableau." };
    }

    var exemple = lignes[0].element;
    var cellules;
    try {
      cellules = exemple.querySelectorAll(adaptateur.selecteurs.cellule.join(","));
    } catch (e) {
      cellules = [];
    }
    if (cellules.length < 2) {
      return {
        viable: false,
        raison:
          "Les lignes n’ont pas de structure de cellules lisible : rien à quoi " +
          "ajouter une colonne."
      };
    }

    // LE CRITERE DES LARGEURS INLINE A ETE RETIRE, et c est un bug d ecran
    // reel qui l a condamne : au survol d une ligne, Meta re-rend et la
    // reevaluation retombait sur ce test, qui declarait le rendu non viable
    // et VIDAIT l ecran, definitivement. Or ce critere datait de l ancien
    // rendu, qui AJOUTAIT des colonnes au tableau et pour qui des largeurs
    // posees en inline par le moteur de Meta etaient fatales. Le rendu
    // actuel pose ses pastilles A L INTERIEUR des cellules existantes : il
    // s appuie sur ces largeurs, il n en souffre pas. Le seul prerequis qui
    // reste est d avoir des cellules reconnaissables.
    return { viable: true, raison: null, cellulesParLigne: cellules.length };
  }

  /**
   * La bande de donnees, posee DANS la ligne du tableau, sous le nom.
   *
   * UNE bande par ligne et non une cellule par colonne, et c est un choix
   * appris du DOM reel : les colonnes de Meta sont positionnees en absolu avec
   * des largeurs posees en inline par leur moteur, s aligner sur elles est un
   * combat perdu d avance. Une bande unique en bas de la ligne (46 px de haut,
   * le nom occupe le haut) ne se bat avec rien : des petites valeurs sous le
   * nom.
   *
   * Position : a droite du bloc de selection (~118 px), au bas de la ligne.
   * `pointer-events: auto` : un clic sur la bande ouvre le tiroir des
   * prospects, comme sur le rail.
   */
  /**
   * Le rendu ancre aux COLONNES, appris de deux captures reelles.
   *
   * La bande qui traversait toute la ligne mettait chaque chiffre sous une
   * colonne qui n avait rien a voir (« Ventes 0 » sous « Resultats »...).
   * L oeil lit un tableau en colonnes verticales : un chiffre pose hors de sa
   * colonne se lit comme un decalage, meme exact.
   *
   * D ou deux emplacements, et rien d autre :
   *   - les mesures qui ont une colonne Meta equivalente (declaration
   *     `colonnesNatives` de l adaptateur) se posent DANS la cellule de cette
   *     colonne, sous la valeur de Meta : « Resultats 5 » et juste dessous, en
   *     petrole, le chiffre du CRM. C est la comparaison que l outil existe
   *     pour permettre, et l element vit DANS la cellule, donc il suit le
   *     defilement horizontal nativement ;
   *   - le reste (RDV, presence, ventes, CA, ROAS...) se pose au bas de la
   *     CELLULE DU NOM, la plus large, en petit. Une seule cellule, pas de
   *     traversee.
   */

  /** Les en-tetes de colonnes presentes a l ecran, appariees aux mesures CRM.
   *  Recalcule a chaque rendu : l utilisateur peut changer ses colonnes Meta. */
  function entetesCibles(adaptateur) {
    var sortie = [];
    if (!adaptateur.colonnesNatives) return sortie;
    var enTetes;
    try {
      enTetes = document.querySelectorAll('[role="columnheader"]');
    } catch (e) {
      return sortie;
    }
    for (var m = 0; m < adaptateur.colonnesNatives.length; m++) {
      var carte = adaptateur.colonnesNatives[m];
      for (var h = 0; h < enTetes.length; h++) {
        var texte = (enTetes[h].innerText || "").trim().toLowerCase();
        if (!texte) continue;
        var trouve = false;
        for (var e = 0; e < carte.entetes.length; e++) {
          if (texte.indexOf(carte.entetes[e]) !== -1) {
            trouve = true;
            break;
          }
        }
        if (trouve) {
          var boite;
          try {
            boite = enTetes[h].getBoundingClientRect();
          } catch (err) {
            continue;
          }
          if (boite.width > 0) {
            sortie.push({ cle: carte.cle, centreX: boite.left + boite.width / 2 });
          }
          break;
        }
      }
    }
    return sortie;
  }

  /** Les cellules d une ligne : les elements de niveau cellule (hauteur de la
   *  ligne), pas leur contenu interne. */
  function cellulesDeLigne(ligne, adaptateur) {
    var brutes;
    try {
      brutes = ligne.querySelectorAll(adaptateur.selecteurs.cellule.join(","));
    } catch (e) {
      return [];
    }
    var sortie = [];
    for (var i = 0; i < brutes.length; i++) {
      var boite;
      try {
        boite = brutes[i].getBoundingClientRect();
      } catch (e2) {
        continue;
      }
      // Une cellule fait la hauteur de la ligne. Son contenu interne, non :
      // c est ce qui ecarte les ._1b33 imbriques dans les ._4lg0.
      if (boite.height >= 38 && boite.width >= 28) {
        sortie.push({ element: brutes[i], gauche: boite.left, droite: boite.right, largeur: boite.width });
      }
    }
    return sortie;
  }

  var POLICE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  function styleValeurEnCellule() {
    // UNE PASTILLE OPAQUE, lecon de la vue campagnes : posee nue, la valeur se
    // melangeait aux sous-textes de Meta (« Par ajout au calend... ») et ne se
    // lisait pas. Le fond creme la detache, le lisere la rattache a la charte.
    return (
      "position:absolute;right:6px;bottom:2px;z-index:3;" +
      "padding:1px 6px;border-radius:3px;" +
      "background:" + COULEURS.cream + ";" +
      "border:1px solid " + COULEURS.creamDark + ";" +
      "font:600 11px/1.3 " + POLICE + ";font-variant-numeric:tabular-nums;" +
      "color:" + COULEURS.petrol + ";white-space:nowrap;pointer-events:auto;cursor:pointer;"
    );
  }

  /** Hauteur de la bande. Un adaptateur dont les noms passent a la ligne
   *  (Google Ads) reserve cette place sous le nom, voir `reserverSousLeNom`. */
  var HAUTEUR_BANDE = 18;

  function styleBandeauNom() {
    return (
      "position:absolute;left:6px;right:4px;bottom:2px;height:" + HAUTEUR_BANDE + "px;z-index:3;" +
      "display:flex;align-items:center;gap:10px;overflow:hidden;" +
      "padding:0 7px;border-radius:4px;" +
      "background:" + COULEURS.cream + ";" +
      "font:11px/1.2 " + POLICE + ";font-variant-numeric:tabular-nums;" +
      "white-space:nowrap;pointer-events:auto;cursor:pointer;"
    );
  }

  /** Une valeur nulle ou vide s efface : dans une bande de six chiffres, l oeil
   *  doit tomber sur ceux qui valent quelque chose. */
  function estCreux(v) {
    return v === null || v === undefined || v === 0;
  }

  /**
   * Fait de la place sous le nom, pour les regies dont les noms passent a la
   * ligne (Google Ads) : sans elle, la bande recouvre la deuxieme ligne du nom.
   * Une marge interne, et une seule fois par cellule.
   */
  function reserverSousLeNom(cellule, adaptateur) {
    if (!adaptateur || !adaptateur.reserveSousLeNom) return;
    if (cellule.getAttribute("data-impulsion-reserve") === "1") return;
    cellule.setAttribute("data-impulsion-reserve", "1");
    // Mesure sur l ecran reel de Google Ads : la ligne prend la hauteur de sa
    // cellule la plus haute, donc une marge sous le NOM suffit a l agrandir.
    cellule.style.paddingBottom = HAUTEUR_BANDE + 6 + "px";
  }

  /**
   * Pose ou met a jour les valeurs d une ligne.
   *
   * Rend `false` quand la ligne avait deja ete servie et que ses valeurs ont
   * disparu : c est un arrachage, et c est ce qui alimente le compteur.
   */
  function poserLigne(ligne, options, cibles, adaptateur) {
    var el = ligne.element;
    var deja = el.querySelectorAll("[" + MARQUE + "]");

    if (deja.length > 0 && el.getAttribute("data-impulsion-signature") === ligne.signature) {
      return true;
    }
    var etaitServie = el.hasAttribute("data-impulsion-signature");
    if (etaitServie && deja.length === 0) {
      if (!noterArrachage()) return false;
    }

    for (var i = 0; i < deja.length; i++) {
      if (deja[i].parentNode) deja[i].parentNode.removeChild(deja[i]);
    }
    el.setAttribute("data-impulsion-signature", ligne.signature || "");

    var cellules = cellulesDeLigne(el, adaptateur);
    if (!cellules.length) return true;

    // La cellule du nom : celle que l adaptateur designe, sinon la plus large
    // de la ligne. Chez Google la plus large est la colonne d etat, pas le nom.
    var celluleNom = cellules[0];
    for (var n = 1; n < cellules.length; n++) {
      if (cellules[n].largeur > celluleNom.largeur) celluleNom = cellules[n];
    }
    var designee = adaptateur && adaptateur.celluleDuNom ? adaptateur.celluleDuNom(el) : null;
    if (designee) {
      for (var d = 0; d < cellules.length; d++) {
        if (cellules[d].element === designee) celluleNom = cellules[d];
      }
    }

    var surClic = function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      if (options && options.surClic) options.surClic(ligne, null);
    };

    if (ligne.etatAffichage !== "ok") {
      var avert = document.createElement("div");
      avert.setAttribute(MARQUE, "1");
      avert.setAttribute("aria-hidden", "true");
      avert.style.cssText = styleBandeauNom() + "cursor:default;color:" + COULEURS.ochre + ";";
      avert.textContent =
        ligne.etatAffichage === "absent" ? "Campagne inconnue du serveur" : "Ligne non identifiée";
      avert.title =
        ligne.etatAffichage === "absent"
          ? "Le serveur ne connaît pas cette ligne : sa synchronisation avec la régie est peut-être en retard."
          : "L’extension n’a pas su dire à quelle campagne correspond cette ligne. Aucun chiffre plutôt qu’un chiffre faux.";
      reserverSousLeNom(celluleNom.element, adaptateur);
      celluleNom.element.appendChild(avert);
      return true;
    }

    // 1. Les valeurs DANS les colonnes correspondantes.
    var posees = {};
    for (var c = 0; c < cibles.length; c++) {
      var cible = cibles[c];
      var cellule = null;
      for (var k = 0; k < cellules.length; k++) {
        if (cellules[k].gauche <= cible.centreX && cible.centreX <= cellules[k].droite) {
          cellule = cellules[k];
          break;
        }
      }
      if (!cellule || cellule === celluleNom) continue;
      var colonne = null;
      for (var cc = 0; cc < etat.colonnes.length; cc++) {
        if (etat.colonnes[cc].cle === cible.cle) colonne = etat.colonnes[cc];
      }
      if (!colonne) continue;
      var brut = ligne.mesures ? ligne.mesures[cible.cle] : null;
      var valeur = document.createElement("div");
      valeur.setAttribute(MARQUE, "1");
      valeur.setAttribute("aria-hidden", "true");
      valeur.style.cssText = styleValeurEnCellule() + (estCreux(brut) ? "opacity:.55;font-weight:500;" : "");
      valeur.textContent = F.formater(colonne.format, brut === undefined ? null : brut);
      valeur.title = colonne.label + " d’après votre tracking. Cliquer pour voir les personnes.";
      valeur.addEventListener("click", surClic);
      cellule.element.appendChild(valeur);
      posees[cible.cle] = true;
    }

    // 2. Le reste, au bas de la cellule du nom.
    var bandeau = document.createElement("div");
    bandeau.setAttribute(MARQUE, "1");
    bandeau.setAttribute("aria-hidden", "true");
    bandeau.style.cssText = styleBandeauNom();
    var morceaux = [];
    for (var r = 0; r < etat.colonnes.length; r++) {
      var col = etat.colonnes[r];
      if (posees[col.cle]) continue;
      var v = ligne.mesures ? ligne.mesures[col.cle] : null;
      var creux = estCreux(v);
      morceaux.push(
        '<span style="display:inline-flex;align-items:baseline;gap:4px' + (creux ? ";opacity:.5" : "") + '">' +
        '<span style="color:' + COULEURS.gray + '">' + col.entete + "</span>" +
        '<span style="color:' + COULEURS.navy + ";font-weight:" + (creux ? 500 : 650) + '">' +
        F.formater(col.format, v === undefined ? null : v) + "</span></span>"
      );
    }
    bandeau.innerHTML = morceaux.join("");
    bandeau.title = "D’après votre tracking. Cliquer pour voir les personnes derrière cette ligne.";
    bandeau.addEventListener("click", surClic);
    reserverSousLeNom(celluleNom.element, adaptateur);
    celluleNom.element.appendChild(bandeau);
    return true;
  }

  /**
   * Un passage complet.
   *
   * Rend l etat de viabilite : l orchestrateur bascule sur le rail des qu il
   * vaut `false`, et n y revient pas de la session. Reessayer en boucle un mode
   * qui ne marche pas est exactement ce qui fait ramer un onglet.
   */
  function rendre(adaptateur, grille, lignes, options) {
    // UN ECHEC N EST PLUS DEFINITIF. La page bouge : des cellules absentes au
    // chargement apparaissent deux secondes plus tard. Se declarer non viable
    // pour la session entiere transformait un instant de transition en panne
    // permanente. On reessaie toutes les trois secondes.
    if (etat.viable === false) {
      if (Date.now() - (etat.dernierEchec || 0) < 3000) {
        return { viable: false, raison: etat.raison };
      }
      etat.viable = null;
    }

    if (etat.viable === null) {
      var verdict = evaluer(adaptateur, grille, lignes);
      etat.viable = verdict.viable;
      etat.raison = verdict.raison;
      if (J) J.dire("rendu natif", verdict.viable ? "viable" : "non viable", verdict.raison || "");
      if (!verdict.viable) {
        etat.dernierEchec = Date.now();
        return { viable: false, raison: verdict.raison };
      }
    }

    var cibles = entetesCibles(adaptateur);
    for (var i = 0; i < lignes.length; i++) {
      if (!poserLigne(lignes[i], options, cibles, adaptateur)) {
        return { viable: false, raison: etat.raison };
      }
    }

    // La ligne de totaux peut avoir recu une bande AVANT que le marquage ne
    // l exclue (le premier rendu court plus vite que le service worker). Une
    // fois exclue, decouvrir() la saute et sa bande orpheline resterait la,
    // affichant « non identifiee » sur une ligne qui n est pas une entite.
    try {
      var orphelines = document.querySelectorAll(
        "[data-impulsion-exclue] [" + MARQUE + "]"
      );
      for (var o = 0; o < orphelines.length; o++) {
        if (orphelines[o].parentNode) orphelines[o].parentNode.removeChild(orphelines[o]);
      }
    } catch (e) {
      /* rien */
    }
    return { viable: true, raison: null };
  }

  function definirColonnes(colonnes) {
    etat.colonnes = colonnes || [];
    nettoyer();
  }

  /** Remet le verdict a zero. Appele au changement de niveau ou de page : un
   *  ecran peut se preter a l injection quand un autre ne s y prete pas. */
  function reinitialiser() {
    etat.viable = null;
    etat.arrachages = [];
    etat.raison = null;
    nettoyer();
  }

  root.IMPULSION_RENDU_NATIF = {
    MARQUE: MARQUE,
    etat: etat,
    rendre: rendre,
    nettoyer: nettoyer,
    definirColonnes: definirColonnes,
    reinitialiser: reinitialiser,
    evaluer: evaluer
  };
})(typeof self !== "undefined" ? self : window);
