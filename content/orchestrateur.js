// Le chef d orchestre : cycle de vie, observateurs, et la boucle de rendu.
//
// LA REGLE QUI TIENT TOUT LE FICHIER : lecture et ecriture sont strictement
// separees. On mesure TOUT d abord (`getBoundingClientRect`), puis on ecrit
// TOUT ensuite. Melanger les deux provoque un « layout thrashing » : le
// navigateur recalcule la mise en page a chaque alternance, et le defilement
// tombe a quinze images par seconde sur un tableau de trente lignes.
//
// LA VOIE RAPIDE. Un defilement pur deplace toutes les lignes du MEME delta.
// Une seule `transform` sur le corps du rail suffit alors, sans une seule
// mesure. C est la difference entre « ca suit » et « ca traine », et c est ce
// qui rend le rail utilisable.

(function (root) {
  "use strict";

  var J = root.IMPULSION_JOURNAL;
  var F = root.IMPULSION_FORMAT;
  var L = root.IMPULSION_LIGNES;
  var P = root.IMPULSION_PANNEAU;
  var NATIF = root.IMPULSION_RENDU_NATIF;
  var ENTETE = root.IMPULSION_ENTETE;
  var TIROIR = root.IMPULSION_TIROIR;
  var DIAG = root.IMPULSION_DIAGNOSTIC;
  var REGISTRE = root.IMPULSION_REGISTRE;

  /** Doit suivre le manifeste : elle sert a situer un rapport de diagnostic. */
  var VERSION = "0.9.0";

  var adaptateur = REGISTRE && REGISTRE.pour(location.href);
  if (!adaptateur) return;

  /**
   * Un AUTRE cadre porte-t-il le tableau ?
   *
   * Ads Manager est souvent rendu dans un IFRAME interne (business.facebook.com
   * charge adsmanager.facebook.com dans un cadre). Les scripts s injectent
   * desormais dans tous les cadres dont l URL correspond ; ce garde fait qu UN
   * SEUL exemplaire s affiche, le bon :
   *   - dans le cadre interne, on tourne (window.top !== window) ;
   *   - dans le parent, on s abstient DES QU un cadre adsmanager existe, meme
   *     apparu apres notre demarrage (le cycle re-verifie).
   */
  function autreCadrePorteLeTableau() {
    if (window.top !== window) return false;
    try {
      return Boolean(document.querySelector('iframe[src*="adsmanager"]'));
    } catch (e) {
      return false;
    }
  }

  var etat = {
    reglages: null,
    capacites: null,
    colonnes: [],
    niveau: null,
    compte: null,
    periode: null,
    periodeForcee: null,
    modele: null,
    fenetre: null,
    grille: null,
    selecteurGrille: null,
    selecteurLigne: null,
    conteneurDefilement: null,
    dernierScroll: null,
    lignes: [],
    donnees: null,
    absentes: [],
    carteReseau: new Map(),
    indexCrm: new Map(),
    nomsAmbigus: new Set(),
    mode: "natif",
    raisonNatif: null,
    masque: false,
    diagnostic: false,
    compteursReseau: null,
    derniereErreur: null,
    dernierCode: null,
    signaturePrecedente: "",
    repetitions: 0,
    delaiPlancher: 0
  };

  // ── Dialogue avec le service worker ───────────────────────────────────────

  function demander(type, charge) {
    return new Promise(function (resoudre, rejeter) {
      var msg = Object.assign({ type: type }, charge || {});
      try {
        chrome.runtime.sendMessage(msg, function (reponse) {
          // « Extension context invalidated » arrive des qu on recharge
          // l extension sans recharger la page. Sans ce garde, chaque cycle
          // jetterait dans la console de la plateforme.
          if (chrome.runtime.lastError) {
            rejeter({ code: "contexte", message: "Extension rechargée. Actualisez la page." });
            return;
          }
          if (!reponse) {
            rejeter({ code: "vide", message: "Aucune réponse de l’extension." });
            return;
          }
          if (!reponse.ok) {
            rejeter(reponse.erreur);
            return;
          }
          resoudre(reponse.donnees);
        });
      } catch (e) {
        rejeter({ code: "contexte", message: "Extension rechargée. Actualisez la page." });
      }
    });
  }

  // ── Periode, niveau, compte ───────────────────────────────────────────────

  function libelleSelecteurDates() {
    var r = L.premierQuiRend(document, adaptateur.selecteurs.dates || [], adaptateur, 1);
    var el = r.elements[0];
    if (!el) return null;
    var texte = (el.innerText || el.getAttribute("aria-label") || "").trim();
    if (!texte) return null;
    if (typeof adaptateur.lirePlageFrancaise === "function") {
      return adaptateur.lirePlageFrancaise(texte);
    }
    return null;
  }

  function resoudrePeriode() {
    if (etat.periodeForcee) {
      return Object.assign({}, etat.periodeForcee, { source: "extension" });
    }
    var parUrl = null;
    try {
      parUrl = adaptateur.periode(location.href);
    } catch (e) {
      parUrl = null;
    }
    var parLibelle = libelleSelecteurDates();

    // Le LIBELLE prime quand il contredit l URL, et c est un piege constate :
    // Meta recharge son tableau a un changement de dates SANS reecrire l URL,
    // qui peut porter la plage d une session precedente (vu en vrai : URL au
    // 19 aout, selecteur au 26). Le selecteur dit ce que le tableau affiche
    // MAINTENANT ; l URL ne sert que quand le libelle est illisible.
    if (parLibelle && parUrl && (parLibelle.du !== parUrl.du || parLibelle.au !== parUrl.au)) {
      return parLibelle;
    }
    if (parUrl) return parUrl;
    if (parLibelle) return parLibelle;

    if (etat.periodeVueDansUneRequete) return etat.periodeVueDansUneRequete;

    var fin = new Date();
    var debut = new Date(fin.getTime() - 29 * 86400000);
    var iso = function (d) {
      return d.toISOString().slice(0, 10);
    };
    return { du: iso(debut), au: iso(fin), source: "defaut" };
  }

  // ── Chargement des donnees ────────────────────────────────────────────────

  var chargementEnCours = false;

  function chargerDonnees(forcer) {
    if (chargementEnCours && !forcer) return Promise.resolve();
    var niveau = etat.niveau;
    var periode = etat.periode;
    if (!niveau || !periode) return Promise.resolve();

    chargementEnCours = true;
    P.actualisation(true);

    return demander("metrics", {
      params: {
        plateforme: adaptateur.cle,
        niveau: niveau,
        compte: etat.compte,
        perso: true,
        du: periode.du,
        au: periode.au,
        modele: etat.modele,
        fenetre: etat.fenetre
      }
    })
      .then(function (d) {
        etat.donnees = d;
        etat.dernierCode = 200;
        etat.derniereErreur = null;
        // Le cache sert les valeurs perimees immediatement et revalide en
        // arriere-plan (stale-while-revalidate). Mais la revalidation met a
        // jour LE CACHE, pas l ecran : sans cette redemande unique, l ecran
        // garderait l ancienne reponse jusqu au prochain changement de filtre.
        if (d.__perimee && !etat.redemandePrevue) {
          etat.redemandePrevue = true;
          setTimeout(function () {
            etat.redemandePrevue = false;
            chargerDonnees(true);
          }, 2500);
        }
        // La reponse declare la periode et la fenetre REELLEMENT utilisees, qui
        // peuvent differer de celles demandees. On affiche ce qui est renvoye.
        if (d.fenetreEffective && d.fenetreEffective !== etat.fenetre) {
          etat.fenetreEffective = d.fenetreEffective;
        } else {
          etat.fenetreEffective = null;
        }
        return chargerIndex(niveau);
      })
      .catch(function (err) {
        etat.derniereErreur = err;
        etat.dernierCode = err && err.statut;
        if (J) J.erreur("metrics", err && err.message);
      })
      .finally(function () {
        chargementEnCours = false;
        P.actualisation(false);
        planifier("donnees");
      });
  }

  function chargerIndex(niveau) {
    // L index des noms ne sert QUE de dernier recours. On le charge quand meme
    // d avance : le demander au moment ou une ligne resiste ferait clignoter le
    // rail au pire moment.
    return demander("index", { params: { plateforme: adaptateur.cle, niveau: niveau, compte: etat.compte } })
      .then(function (d) {
        var m = new Map();
        (d.entites || []).forEach(function (e) {
          var k = F.normaliserNom(e.nom);
          if (!k) return;
          var liste = m.get(k);
          if (!liste) m.set(k, [e.externalId]);
          else if (liste.indexOf(e.externalId) === -1) liste.push(e.externalId);
        });
        etat.indexCrm = m;
        etat.nomsAmbigus = new Set(d.nomsAmbigus || []);
      })
      .catch(function () {
        // Un index absent n est pas bloquant : on perd le dernier repli.
        etat.indexCrm = new Map();
      });
  }

  // ── Le cycle ──────────────────────────────────────────────────────────────

  var enAttente = false;

  function planifier(raison) {
    if (enAttente || etat.masque) return;
    enAttente = true;
    requestAnimationFrame(function () {
      enAttente = false;
      try {
        cycle(raison);
      } catch (e) {
        if (J) J.erreur("cycle", e && e.message);
      }
    });
  }

  var reposMinuteur = null;
  function planifierRepos() {
    if (reposMinuteur) clearTimeout(reposMinuteur);
    reposMinuteur = setTimeout(function () {
      reposMinuteur = null;
      planifier("repos");
    }, 120);
  }

  function ralentir(ms) {
    etat.delaiPlancher = ms;
    setTimeout(function () {
      etat.delaiPlancher = 0;
      etat.repetitions = 0;
    }, 2000);
  }

  function cycle(raison) {
    if (etat.masque) return;
    if (document.hidden) return;

    // L iframe d Ads Manager peut apparaitre APRES notre demarrage : le parent
    // cede alors la place a l exemplaire qui tourne dedans, sinon deux rails
    // s affichent, dont un vide.
    if (autreCadrePorteLeTableau()) {
      couper();
      return;
    }

    // Voie rapide : defilement pur, une seule transform, zero mesure.
    var conteneur = etat.conteneurDefilement;
    if (raison === "defilement" && conteneur && etat.dernierScroll !== null && etat.mode === "rail") {
      var delta = conteneur.scrollTop - etat.dernierScroll;
      etat.dernierScroll = conteneur.scrollTop;
      if (delta !== 0) {
        P.glisser(-delta);
        planifierRepos();
        return;
      }
    }

    if (etat.delaiPlancher) return;

    // Le marquage par la fibre React, execute par le service worker dans le
    // monde MAIN. Fire-and-forget avec re-planification : le cycle COURANT lit
    // les marques posees au tour precedent, et la reponse declenche le tour
    // suivant. Convergence en un cycle, sans bloquer celui-ci. Le service
    // worker tient le throttle (700 ms par cadre).
    demander("marquer", { plateforme: adaptateur.cle })
      .then(function (r) {
        if (r && r.marquees > 0) planifier("marquage");
      })
      .catch(function () {
        /* le SW renait peut-etre : le prochain cycle redemandera */
      });

    // ── PHASE LECTURE, aucune ecriture ──────────────────────────────────────
    var g = L.trouverGrille(adaptateur);
    etat.grille = g.element;
    etat.selecteurGrille = g.selecteur;
    if (!etat.grille) {
      afficherBandeaux([
        {
          ton: "alerte",
          texte:
            "Aucun tableau reconnu sur cette page. " + (adaptateur.aide || ""),
          actions: [{ libelle: "Diagnostic", faire: basculerDiagnostic }]
        }
      ]);
      return;
    }

    // L index des noms passe a la decouverte : c est lui qui permet l ancrage
    // par les noms que le CRM connait, la seule detection qui survive a
    // n importe quelle refonte du DOM.
    var d = L.decouvrir(adaptateur, etat.grille, etat.indexCrm);
    etat.selecteurLigne = d.selecteur;

    // L ancrage a trouve le conteneur des lignes : c est une bien meilleure
    // « grille » que ce que les selecteurs avaient designe, et c est lui qui
    // donne au rail sa position et son conteneur de defilement.
    if (d.conteneur && (!etat.grille || !etat.grille.contains(d.conteneur))) {
      etat.grille = d.conteneur;
    }

    if (!etat.conteneurDefilement && d.lignes.length) {
      etat.conteneurDefilement = L.trouverDefilement(d.lignes[0].element);
      if (etat.conteneurDefilement) {
        etat.dernierScroll = etat.conteneurDefilement.scrollTop;
        etat.conteneurDefilement.addEventListener(
          "scroll",
          function () {
            planifier("defilement");
          },
          { passive: true }
        );
      }
    }

    var resolues = L.resoudre(adaptateur, d.lignes, etat.carteReseau, etat.indexCrm);
    etat.lignes = resolues;

    var enrichies = enrichir(resolues);

    var boiteHote = { top: 0 };
    var mesures = [];
    if (etat.mode === "rail") {
      for (var i = 0; i < enrichies.length; i++) {
        var r;
        try {
          r = enrichies[i].element.getBoundingClientRect();
        } catch (e) {
          continue;
        }
        if (r.height === 0) continue;
        // Marge de 200 px de part et d autre : sans elle, les lignes
        // apparaissent et disparaissent au bord de l ecran, ce qui donne un
        // clignotement desagreable au defilement.
        if (r.bottom < -200) continue;
        if (r.top > window.innerHeight + 200) continue;
        mesures.push({
          ligne: enrichies[i],
          haut: r.top - boiteHote.top,
          hauteur: r.height
        });
      }
    }

    // ── Garde-fou anti-emballement ──────────────────────────────────────────
    // Certaines pages se re-rendent en boucle. Sans ce compteur, on les suivrait
    // a 60 Hz pour rien et l onglet chaufferait.
    var signature =
      enrichies.length +
      "|" +
      (enrichies[0] && enrichies[0].nom) +
      "|" +
      (mesures[0] && Math.round(mesures[0].haut));
    if (signature === etat.signaturePrecedente) {
      etat.repetitions += 1;
      if (etat.repetitions > 30) {
        if (J) J.erreur("page en re-rendu continu, on ralentit");
        ralentir(250);
        return;
      }
    } else {
      etat.repetitions = 0;
      etat.signaturePrecedente = signature;
    }

    // L enveloppe des lignes mesurees : la ou le tableau EST, independamment
    // de ce que les selecteurs de grille ont designe. C est elle qui positionne
    // le rail quand elle existe, et c est ce qui l empeche de flotter en haut a
    // droite de l ecran quand la grille est douteuse.
    var enveloppe = null;
    for (var e2 = 0; e2 < mesures.length; e2++) {
      var h1 = mesures[e2].haut;
      var h2 = h1 + mesures[e2].hauteur;
      if (!enveloppe) enveloppe = { top: h1, bottom: h2 };
      else {
        if (h1 < enveloppe.top) enveloppe.top = h1;
        if (h2 > enveloppe.bottom) enveloppe.bottom = h2;
      }
    }

    // ── PHASE ECRITURE ──────────────────────────────────────────────────────
    ecrire(enrichies, mesures, enveloppe);
    if (etat.conteneurDefilement) etat.dernierScroll = etat.conteneurDefilement.scrollTop;
  }

  /** Croise les lignes du tableau avec les donnees du CRM. */
  function enrichir(lignes) {
    var entites = (etat.donnees && etat.donnees.entites) || {};
    etat.absentes = [];
    return lignes.map(function (l) {
      var sortie = Object.assign({}, l, {
        niveau: etat.niveau,
        mesures: null,
        nomCrm: null,
        etatAffichage: "inconnu",
        signature: ""
      });

      if (!l.externalId) {
        sortie.etatAffichage = l.confiance === L.CONFIANCE.AMBIGU ? "ambigu" : "inconnu";
        sortie.signature = sortie.etatAffichage + "|" + l.nom;
        return sortie;
      }

      var cle = adaptateur.cle + ":" + etat.niveau + ":" + l.externalId;
      var e = entites[cle];
      if (!e) {
        // Le CRM ne connait pas cette entite. C est DIFFERENT de « zero lead »,
        // et c est exactement la distinction qui evite une mauvaise decision de
        // budget : une campagne a zero lead a ete mesuree, une campagne
        // inconnue ne l a pas ete.
        sortie.etatAffichage = "absent";
        sortie.signature = "absent|" + l.externalId;
        etat.absentes.push(l.nom || l.externalId);
        return sortie;
      }

      sortie.mesures = e.m;
      sortie.nomCrm = e.nom;
      sortie.etatAffichage = "ok";
      sortie.signature =
        "ok|" +
        l.externalId +
        "|" +
        etat.modele +
        "|" +
        etat.fenetre +
        "|" +
        (etat.periode ? etat.periode.du + etat.periode.au : "") +
        "|" +
        (e.m ? e.m.depense + ":" + e.m.leads + ":" + e.m.caSigne : "");
      return sortie;
    });
  }

  function ecrire(enrichies, mesures, enveloppe) {
    P.assurerRail({
      surLargeur: function (largeur) {
        demander("enregistrerReglages", { reglages: { largeurRail: largeur } });
      }
    });
    P.positionner(etat.grille, enveloppe);

    var options = { surClic: ouvrirTiroir };

    // LE RAIL-TABLEAU N EXISTE PLUS. C etait le filet quand l injection native
    // echouait, et il a fait plus de mal que de bien : jamais fiabilise, il
    // s affichait decale et illisible au moindre passage a vide du natif, qui
    // lui n avait besoin que de quelques secondes pour se re-poser. Le natif
    // est desormais le seul rendu ; quand il ne peut pas, une PHRASE le dit
    // (bandeau, avec le diagnostic a portee), pas un tableau casse. La
    // pastille de controle reste en bas a droite dans tous les cas.
    var verdict = NATIF.rendre(adaptateur, etat.grille, enrichies, options);
    etat.raisonNatif = verdict.viable ? null : verdict.raison;
    P.modeNatif(true);

    rendreEntete(enrichies);
    if (etat.diagnostic) {
      DIAG.surligner(P.etat.racine, etat.lignes);
    }
  }

  /** Vestige du rail-tableau, conserve pour le jour ou un filet aligne
   *  fiabilise reviendrait. Plus jamais appele : le natif persevere. */
  function basculerSurRail(raison) {
    etat.raisonNatif = raison;
  }

  function rendreEntete(enrichies) {
    var identifiees = enrichies.filter(function (l) {
      return l.etatAffichage === "ok";
    }).length;

    ENTETE.rendre(
      P.etat.barre,
      {
        totaux: etat.donnees ? etat.donnees.totaux : null,
        periode: etat.periode,
        modele: etat.modele,
        modeles: (etat.capacites && etat.capacites.modeles) || [],
        fenetre: etat.fenetre,
        fenetreMax: (etat.capacites && etat.capacites.fenetreMaximale) || 90,
        identifiees: identifiees,
        total: enrichies.length
      },
      {
        surModele: function (v) {
          etat.modele = v;
          demander("enregistrerReglages", { reglages: { modele: v } });
          chargerDonnees(true);
        },
        surFenetre: function (v) {
          etat.fenetre = v;
          demander("enregistrerReglages", { reglages: { fenetre: v } });
          chargerDonnees(true);
        },
        surActualiser: function () {
          demander("viderCache").then(function () {
            chargerDonnees(true);
          });
        },
        surDiagnostic: basculerDiagnostic,
        surReplier: function () {
          P.definirOptions({ replie: !P.etat.replie });
          P.positionner(etat.grille);
        }
      }
    );

    afficherBandeaux(construireBandeaux(enrichies, identifiees));
  }

  function construireBandeaux(enrichies, identifiees) {
    var liste = [];

    if (etat.derniereErreur) {
      liste.push({
        ton: "erreur",
        texte: etat.derniereErreur.message,
        actions: [
          {
            libelle: "Réessayer",
            faire: function () {
              etat.derniereErreur = null;
              chargerDonnees(true);
            }
          }
        ]
      });
    }

    if (etat.horsPerimetre) {
      liste.push({
        ton: "alerte",
        texte:
          "Ce compte publicitaire est inconnu de votre serveur. " +
          "L’extension n’a rien à en dire, et préfère se taire plutôt que " +
          "d’afficher des zéros."
      });
    }

    if (etat.raisonNatif) {
      // L injection ne se fait pas et l ecran n a donc RIEN : le dire en une
      // phrase vaut mieux qu un tableau de repli casse. Le natif reessaie
      // toutes les trois secondes tout seul.
      liste.push({
        ton: "alerte",
        texte:
          "Les chiffres ne peuvent pas s’afficher dans ce tableau pour " +
          "l instant : " + etat.raisonNatif + " Nouvel essai toutes les 3 s.",
        actions: [{ libelle: "Copier le diagnostic", faire: basculerDiagnostic }]
      });
    }

    if (!etat.raisonNatif && enrichies.length === 0 && etat.donnees) {
      liste.push({
        ton: "alerte",
        texte:
          "Aucune ligne reconnue dans ce tableau. Les sélecteurs de " +
          adaptateur.label +
          " (version " +
          adaptateur.version +
          ") ne correspondent pas à cette page. Le diagnostic dit ce qu’elle " +
          "contient réellement.",
        actions: [
          { libelle: "Copier le diagnostic", faire: basculerDiagnostic },
          { libelle: "Masquer", faire: masquer }
        ]
      });
    }

    var total = enrichies.length;
    if (total > 0 && identifiees / total < 0.7) {
      liste.push({
        ton: "alerte",
        texte:
          "L’extension ne reconnaît plus les lignes de " +
          adaptateur.label +
          " (" +
          identifiees +
          " sur " +
          total +
          "). L’interface a probablement changé depuis la version " +
          adaptateur.version +
          " de l’adaptateur.",
        actions: [
          { libelle: "Diagnostic", faire: basculerDiagnostic },
          { libelle: "Masquer", faire: masquer }
        ]
      });
    }

    if (etat.fenetreEffective) {
      liste.push({
        ton: "alerte",
        texte:
          "Fenêtre ramenée à " +
          etat.fenetreEffective +
          " jours : c’est le maximum que le serveur sait calculer."
      });
    }

    var parLibelle = libelleSelecteurDates();
    if (parLibelle && etat.periode && (parLibelle.du !== etat.periode.du || parLibelle.au !== etat.periode.au)) {
      liste.push({
        ton: "alerte",
        texte:
          "La période affichée par " +
          adaptateur.label +
          " (" +
          F.jourCourt(parLibelle.du) +
          " au " +
          F.jourCourt(parLibelle.au) +
          ") ne correspond pas à la période interrogée.",
        actions: [
          {
            libelle: "Aligner",
            faire: function () {
              etat.periodeForcee = { du: parLibelle.du, au: parLibelle.au };
              etat.periode = resoudrePeriode();
              chargerDonnees(true);
            }
          }
        ]
      });
    }

    return liste;
  }

  function afficherBandeaux(liste) {
    if (P.etat.rail && P.etat.barre) ENTETE.bandeaux(P.etat.rail, P.etat.barre, liste);
  }

  function masquer() {
    etat.masque = true;
    NATIF.nettoyer();
    P.demonter();
  }

  function basculerDiagnostic() {
    etat.diagnostic = !etat.diagnostic;
    if (J) J.activer(etat.diagnostic);
    if (!etat.diagnostic) {
      DIAG.effacer();
      return;
    }
    // Demander au monde MAIN ce que l interception a reellement vu :
    // « aucune reponse utile » et « selecteurs mauvais » ne se soignent pas
    // pareil.
    try {
      window.postMessage({ source: "IMPULSION_ADS_DEMANDE", type: "compteurs" }, "*");
    } catch (e) {
      /* rien */
    }
    setTimeout(function () {
      var r = DIAG.rapport({
        version: VERSION,
        adaptateur: adaptateur,
        niveau: etat.niveau,
        compte: etat.compte,
        periode: etat.periode,
        modele: etat.modele,
        fenetre: etat.fenetre,
        mode: etat.mode,
        natifViable: NATIF.etat.viable,
        raisonNatif: etat.raisonNatif,
        sonde: (function () {
          try {
            return L.sonder(adaptateur, etat.indexCrm);
          } catch (e) {
            return { erreur: e && e.message };
          }
        })(),
        grille: etat.grille,
        selecteurGrille: etat.selecteurGrille,
        selecteurLigne: etat.selecteurLigne,
        conteneurDefilement: etat.conteneurDefilement
          ? etat.conteneurDefilement.tagName +
            "." +
            String(etat.conteneurDefilement.className).split(" ")[0]
          : null,
        hauteurDefilable: etat.conteneurDefilement ? etat.conteneurDefilement.scrollHeight : null,
        lignes: etat.lignes,
        compteursReseau: etat.compteursReseau,
        entitesRecues: etat.donnees ? Object.keys(etat.donnees.entites || {}).length : 0,
        absentes: etat.absentes,
        dernierCode: etat.dernierCode,
        derniereErreur: etat.derniereErreur
      });
      DIAG.table(etat.lignes);
      var texte = JSON.stringify(r, null, 2);
      console.log("%c[colonnes-crm] rapport de diagnostic", "font-weight:bold");
      console.log(texte);
      DIAG.copier(texte).then(function (ok) {
        if (J) J.dire(ok ? "rapport copié dans le presse-papier" : "copie impossible, voir la console");
      });
      planifier("diagnostic");
    }, 250);
  }

  // ── Le tiroir ─────────────────────────────────────────────────────────────

  function ouvrirTiroir(ligne) {
    if (!ligne.externalId || ligne.etatAffichage !== "ok") return;
    var ctx = {
      periode: etat.periode,
      modele: etat.modele,
      modeleLabel: libelleModele(etat.modele),
      fenetre: etat.fenetre
    };
    var cle = TIROIR.ouvrir(P.etat.racine, ligne, ctx);

    var lancer = function () {
      demander("prospects", {
        params: {
          plateforme: adaptateur.cle,
          niveau: etat.niveau,
          compte: etat.compte,
          externalId: ligne.externalId,
          perso: true,
          du: etat.periode.du,
          au: etat.periode.au,
          modele: etat.modele,
          fenetre: etat.fenetre
        }
      })
        .then(function (d) {
          TIROIR.remplir(d, ctx, cle);
        })
        .catch(function (err) {
          TIROIR.echouer(err, cle, lancer);
        });
    };
    lancer();
  }

  function libelleModele(cle) {
    var liste = (etat.capacites && etat.capacites.modeles) || [];
    for (var i = 0; i < liste.length; i++) {
      if (liste[i].cle === cle) return liste[i].label;
    }
    return cle;
  }

  // ── Observateurs ──────────────────────────────────────────────────────────

  function observer() {
    var mo = new MutationObserver(function (enregistrements) {
      // Ceinture, en plus de la bretelle structurelle : meme si un noeud a nous
      // se retrouvait dans leur sous-arbre (mode natif), on ne se reobserve pas.
      for (var i = 0; i < enregistrements.length; i++) {
        var t = enregistrements[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest("[" + NATIF.MARQUE + "]")) return;
      }
      planifier("mutation");
    });

    // PAS de `attributes: true`. Ces interfaces reecrivent les styles inline a
    // chaque image de defilement ; on se reveillerait a 60 Hz pour rien.
    // `childList` + `subtree` attrape le recyclage des lignes, `characterData`
    // attrape un chiffre qui change sur place.
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        planifier("taille");
      });
      try {
        ro.observe(document.documentElement);
      } catch (e) {
        /* rien */
      }
    }

    window.addEventListener(
      "resize",
      function () {
        planifier("taille");
      },
      { passive: true }
    );
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) planifier("visible");
    });

    // L hote peut disparaitre quand la SPA change de route et vide le body.
    new MutationObserver(function () {
      // Le garde `masque` d abord : sans lui, couper l extension (ou masquer le
      // panneau) declencherait ce meme observateur, qui remonterait l hote
      // qu on vient de retirer. La coupure serait defaite dans la seconde.
      if (etat.masque) return;
      if (document.getElementById(P.ID_HOTE)) return;
      P.monter({ theme: theme() }).then(function () {
        planifier("remontage");
      });
    }).observe(document.body, { childList: true });
  }

  function theme() {
    var t = (etat.reglages && etat.reglages.theme) || "auto";
    if (t !== "auto") return t;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "sombre" : "clair";
    } catch (e) {
      return "clair";
    }
  }

  // ── Changement de niveau ou de page ───────────────────────────────────────

  function relireContexte() {
    var niveauNeuf = adaptateur.niveau(location.href);
    var compteNeuf = adaptateur.compte(location.href);
    var periodeNeuve = resoudrePeriode();

    var compteChange = compteNeuf !== etat.compte;
    var change =
      niveauNeuf !== etat.niveau ||
      compteNeuf !== etat.compte ||
      !etat.periode ||
      periodeNeuve.du !== etat.periode.du ||
      periodeNeuve.au !== etat.periode.au;

    etat.niveau = niveauNeuf;
    etat.compte = compteNeuf;
    etat.periode = periodeNeuve;

    if (change) {
      // Un ecran peut se preter a l injection quand un autre ne s y prete pas :
      // on redonne sa chance au mode natif a chaque changement de niveau.
      NATIF.reinitialiser();
      etat.mode = "natif";
      etat.raisonNatif = null;
      etat.conteneurDefilement = null;
      etat.dernierScroll = null;
      P.remettreGlisse();
      // Un autre compte publicitaire peut etre un autre annonceur, donc un
      // autre entonnoir : le catalogue des colonnes se redemande avant de
      // charger les chiffres.
      if (compteChange && etat.capacites) {
        annoncer()
          .then(function (capacites) {
            etat.capacites = capacites;
            accorderModele();
          })
          .catch(function () {
            /* on garde les capacites precedentes */
          })
          .then(function () {
            appliquerColonnes();
            verifierPerimetre();
            chargerDonnees(true);
          });
      } else {
        appliquerColonnes();
        verifierPerimetre();
        chargerDonnees(true);
      }
    }
    return change;
  }

  /** Le ping, avec le compte ouvert dans la page. */
  function annoncer() {
    return demander("ping", {
      params: { compte: adaptateur.compte(location.href), plateforme: adaptateur.cle }
    });
  }

  /** Chaque serveur annonce SES modeles. Un modele retenu chez un autre (ou
   *  retire depuis) retombe sur celui que le serveur marque par defaut, plutot
   *  que de laisser le menu sur une valeur que rien n explique. */
  function accorderModele() {
    var liste = (etat.capacites && etat.capacites.modeles) || [];
    if (!liste.length) return;
    var connu = liste.some(function (m) {
      return m.cle === etat.modele;
    });
    if (connu) return;
    var defaut = liste.filter(function (m) {
      return m.defaut;
    })[0];
    etat.modele = (defaut || liste[0]).cle;
  }

  /** Le compte est-il suivi par le CRM ? Sinon, on se tait. */
  function verifierPerimetre() {
    if (!etat.capacites || !etat.compte) {
      etat.horsPerimetre = false;
      return;
    }
    var connus = (etat.capacites.comptes || []).filter(function (c) {
      return c.plateforme === adaptateur.cle;
    });
    if (!connus.length) {
      etat.horsPerimetre = false;
      return;
    }
    etat.horsPerimetre = !connus.some(function (c) {
      return c.externalId === etat.compte;
    });
  }

  function appliquerColonnes() {
    var catalogue = (etat.capacites && etat.capacites.colonnes) || [];
    var choix =
      (etat.reglages && etat.reglages.colonnes && etat.reglages.colonnes[etat.niveau]) || [];
    var retenues;
    if (choix.length) {
      retenues = choix
        .map(function (cle) {
          return catalogue.filter(function (c) {
            return c.cle === cle;
          })[0];
        })
        .filter(Boolean);
    } else {
      retenues = catalogue.filter(function (c) {
        return c.parDefaut;
      });
    }
    etat.colonnes = retenues;
    P.definirColonnes(retenues);
    NATIF.definirColonnes(retenues);
  }

  // ── Demarrage ─────────────────────────────────────────────────────────────

  function brancherPont() {
    if (!window.IMPULSION_PONT) return;
    window.IMPULSION_PONT.abonner(function (msg) {
      if (msg.type === "entites") {
        for (var i = 0; i < msg.data.length; i++) {
          var e = msg.data[i];
          if (etat.niveau && e.niveau !== etat.niveau) continue;
          var k = F.normaliserNom(e.nom);
          if (!k) continue;
          var liste = etat.carteReseau.get(k);
          if (!liste) etat.carteReseau.set(k, [e.id]);
          else if (liste.indexOf(e.id) === -1) liste.push(e.id);
        }
        planifier("reseau");
      } else if (msg.type === "url") {
        relireContexte();
        planifier("navigation");
      } else if (msg.type === "periode") {
        etat.periodeVueDansUneRequete = msg.data;
      } else if (msg.type === "compteurs") {
        etat.compteursReseau = msg.data;
      }
    });
  }

  var initialise = false;

  function demarrer() {
    initialise = true;
    brancherPont();

    demander("reglages")
      .then(function (r) {
        etat.reglages = r;
        etat.modele = r.modele;
        etat.fenetre = r.fenetre;
        etat.diagnostic = Boolean(r.diagnostic);
        if (J) J.activer(etat.diagnostic);
        P.definirOptions({
          largeur: r.largeurRail,
          afficherNom: r.afficherNomControle,
          theme: theme()
        });
        // `cleApiPresente` et non la cle elle-meme : le service worker la
        // retire pour tout appelant qui vit dans un onglet. Le script de
        // contenu n en a aucun besoin, il ne fait jamais d appel HTTP.
        if (!r.cleApiPresente) {
          return Promise.reject({
            code: "cle_absente",
            message:
              "Aucune clé d’API. Ouvrez les réglages de l’extension et collez la vôtre."
          });
        }
        return annoncer();
      })
      .then(function (capacites) {
        etat.capacites = capacites;
        accorderModele();
        return P.monter({ theme: theme() });
      })
      .then(function () {
        P.assurerRail({});
        appliquerColonnes();
        relireContexte();
        observer();
        planifier("demarrage");
      })
      .catch(function (err) {
        etat.derniereErreur = err;
        // Meme sans cle, on monte le rail : c est le seul endroit ou l on peut
        // DIRE qu il manque une cle. Un panneau absent se lit comme une
        // extension cassee.
        P.monter({ theme: theme() }).then(function () {
          P.assurerRail({});
          P.positionner(null);
          afficherBandeaux([
            {
              ton: "erreur",
              texte: (err && err.message) || "L’extension n’a pas pu démarrer.",
              actions: []
            }
          ]);
        });
      });
  }

  // ── L interrupteur maitre ─────────────────────────────────────────────────
  //
  // Couper l affichage sans toucher a chrome://extensions. L etat vit dans la
  // cle de stockage `actif`, SEPAREE des reglages, et cette separation est une
  // regle de securite : sur la cle des reglages, l evenement `onChanged`
  // transporterait l objet entier, cle d API comprise, jusque dans le
  // processus de cette page. Sur une cle a part, il ne transporte qu un
  // booleen. Le verificateur y veille.

  function couper() {
    etat.masque = true;
    NATIF.nettoyer();
    DIAG.effacer();
    P.demonter();
  }

  function reactiver() {
    etat.masque = false;
    if (!initialise) {
      demarrer();
      return;
    }
    P.monter({ theme: theme() }).then(function () {
      P.assurerRail({});
      appliquerColonnes();
      relireContexte();
      planifier("reactivation");
    });
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, zone) {
      if (zone !== "local" || !changes.actif) return;
      if (changes.actif.newValue === false) couper();
      else reactiver();
    });
  } catch (e) {
    /* extension rechargee : la page suivante reprendra */
  }

  function demarrerSelonInterrupteur() {
    var lancer = function (coupe) {
      if (!coupe && autreCadrePorteLeTableau()) {
        // Le tableau vit dans un cadre interne, qui a son propre exemplaire de
        // ces scripts : celui-ci n affiche rien, et le cycle re-verifiera si
        // le cadre disparait un jour.
        coupe = true;
      }
      if (coupe) {
        // Volontairement RIEN a l ecran : couper, c est couper. Le badge
        // « off » sur l icone de l extension dit ou le retablir, et la bascule
        // ci-dessus reactive sans recharger la page.
        etat.masque = true;
        return;
      }
      demarrer();
    };
    try {
      chrome.storage.local
        .get("actif")
        .then(function (o) {
          lancer(Boolean(o && o.actif === false));
        })
        .catch(function () {
          lancer(false);
        });
    } catch (e) {
      lancer(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrerSelonInterrupteur);
  } else {
    demarrerSelonInterrupteur();
  }
})(typeof self !== "undefined" ? self : window);
