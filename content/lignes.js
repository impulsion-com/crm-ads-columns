// Trouver les lignes du tableau, et savoir QUI est chacune.
//
// C est le point dur de toute l extension. Ces interfaces sont des tableaux
// virtualises : les lignes se recyclent au defilement, les classes CSS sont
// obfusquees et changent sans preavis.
//
// LA CASCADE, du plus fiable au moins fiable :
//
//   1. DOM, identifiant explicite   -> confiance « exact »
//   2. Reseau, carte nom -> id      -> confiance « exact » si le nom est unique
//   3. CRM, index des noms          -> confiance « nom »
//   4. Echec                        -> « inconnu » ou « ambigu »
//
// ET LE DETAIL QUI VAUT LE DETOUR : quand 1 et 2 repondent tous les deux, ON
// COMPARE. Un desaccord n est jamais arbitre, il fait basculer la ligne en « a
// verifier » et entre dans le rapport de diagnostic. C est un auto-test gratuit
// qui signale un adaptateur casse des la premiere ligne, au lieu d afficher
// tranquillement les chiffres de la campagne d a cote.
//
// REGLE NON NEGOCIABLE : une ligne non identifiee n affiche AUCUN chiffre, pas
// meme un tiret qui pourrait passer pour zero. Un chiffre faux dans une
// decision de budget coute plus cher qu une case vide.

(function (root) {
  "use strict";

  var F = root.IMPULSION_FORMAT;
  var J = root.IMPULSION_JOURNAL;

  var CONFIANCE = {
    EXACT: "exact",
    NOM: "nom",
    AMBIGU: "ambigu",
    INCONNU: "inconnu"
  };

  /** Trouve le premier selecteur d une liste qui rend un resultat plausible.
   *  Rend aussi CELUI qui a servi, pour le rapport de diagnostic : savoir que
   *  c est le troisieme selecteur de repli qui fonctionne est le signe qu il
   *  faut mettre a jour l adaptateur avant qu il ne reste plus rien. */
  function premierQuiRend(racine, liste, adaptateur, minimum) {
    minimum = minimum || 1;
    for (var i = 0; i < liste.length; i++) {
      var trouves;
      try {
        trouves =
          typeof adaptateur.traverser === "function"
            ? adaptateur.traverser(racine, liste[i])
            : Array.prototype.slice.call(racine.querySelectorAll(liste[i]));
      } catch (e) {
        continue;
      }
      if (trouves && trouves.length >= minimum) {
        return { elements: trouves, selecteur: liste[i] };
      }
    }
    return { elements: [], selecteur: null };
  }

  /** Tous les candidats de tous les selecteurs, sans s arreter au premier. */
  function tousLesCandidats(racine, liste, adaptateur) {
    var sortie = [];
    for (var i = 0; i < liste.length; i++) {
      var trouves;
      try {
        trouves =
          typeof adaptateur.traverser === "function"
            ? adaptateur.traverser(racine, liste[i])
            : Array.prototype.slice.call(racine.querySelectorAll(liste[i]));
      } catch (e) {
        continue;
      }
      for (var j = 0; j < trouves.length; j++) {
        sortie.push({ element: trouves[j], selecteur: liste[i] });
      }
    }
    return sortie;
  }

  /**
   * La grille.
   *
   * ON NOTE TOUS LES CANDIDATS AU LIEU DE PRENDRE LE PREMIER, et ce n est pas
   * de la coquetterie : ces pages portent plusieurs elements qui repondent aux
   * memes selecteurs, dont des tableaux de filtres, des menus et des listes
   * deroulantes. Prendre le premier venu donnait une grille valide MAIS VIDE,
   * d ou « aucune ligne trouvee » alors que le vrai tableau etait deux noeuds
   * plus loin. Le bon candidat est celui qui contient le plus de lignes.
   */
  function trouverGrille(adaptateur) {
    var candidats = tousLesCandidats(document, adaptateur.selecteurs.grille, adaptateur);
    var meilleur = null;

    for (var i = 0; i < candidats.length; i++) {
      var el = candidats[i].element;
      var lignes = 0;
      try {
        lignes = compterLignesPlausibles(adaptateur, el);
      } catch (e) {
        lignes = 0;
      }
      var boite = null;
      try {
        boite = el.getBoundingClientRect();
      } catch (e) {
        /* rien */
      }
      // Une grille invisible ou minuscule n est pas celle qu on regarde.
      if (boite && (boite.height < 60 || boite.width < 200)) continue;
      if (!meilleur || lignes > meilleur.lignes) {
        meilleur = { element: el, selecteur: candidats[i].selecteur, lignes: lignes };
      }
    }

    if (meilleur && meilleur.lignes > 0) {
      return { element: meilleur.element, selecteur: meilleur.selecteur, lignes: meilleur.lignes };
    }

    // Aucun candidat ne porte de lignes reconnaissables. On rend quand meme le
    // meilleur : `decouvrir` tentera la detection structurelle dessus, et le
    // diagnostic aura un point de depart a raconter.
    if (meilleur) {
      return { element: meilleur.element, selecteur: meilleur.selecteur, lignes: 0 };
    }
    return { element: null, selecteur: null, lignes: 0 };
  }

  function compterLignesPlausibles(adaptateur, racine) {
    return meilleurQuiRend(racine, adaptateur.selecteurs.ligne, adaptateur).elements.length;
  }

  /**
   * Le conteneur qui defile.
   *
   * On remonte depuis une ligne jusqu au premier ancetre qui defile vraiment.
   * `overflow` seul ne suffit pas : beaucoup d elements sont declares
   * `overflow: auto` sans jamais deborder, et s accrocher a l un d eux ferait
   * ecouter un evenement qui n arrive jamais.
   */
  function trouverDefilement(depuis) {
    var el = depuis;
    var garde = 0;
    while (el && el !== document.body && garde++ < 30) {
      var s;
      try {
        s = getComputedStyle(el);
      } catch (e) {
        break;
      }
      var y = s.overflowY;
      if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Detection STRUCTURELLE, quand aucun selecteur declare ne trouve rien.
   *
   * POURQUOI ELLE EXISTE. Les selecteurs de `plateformes/*.js` sont des paris
   * sur les attributs ARIA. Quand le pari est perdu, l alternative n est pas de
   * deviner une classe obfusquee, qui changera au prochain deploiement de Meta :
   * c est de chercher ce qu une ligne de tableau EST, indepandamment de son
   * nommage. A savoir un element repete, entre freres, de meme forme et de
   * hauteur comparable.
   *
   * On groupe les enfants par (parent, empreinte de forme) et l on retient le
   * plus gros groupe d au moins trois membres visibles. C est la definition la
   * plus proche de « les lignes » qui ne depende d aucun nom.
   *
   * Ce n est PAS un repli silencieux : la methode retenue remonte dans le
   * rapport de diagnostic, et une detection structurelle qui gagne veut dire
   * qu il faut mettre l adaptateur a jour.
   */
  function detecterStructurellement(racine) {
    var groupes = new Map();
    var tous;
    try {
      tous = racine.querySelectorAll("*");
    } catch (e) {
      return { elements: [], selecteur: null };
    }

    for (var i = 0; i < tous.length && i < 6000; i++) {
      var el = tous[i];
      var parent = el.parentElement;
      if (!parent) continue;

      var boite;
      try {
        boite = el.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      // Une ligne de tableau est large, pas trop haute, et visible.
      if (boite.height < 18 || boite.height > 220) continue;
      if (boite.width < 250) continue;

      // Empreinte de forme : le nom de la balise, son role, et le nombre
      // d enfants directs. Deux lignes d un meme tableau la partagent ; une
      // ligne et un bouton, non. On ignore les CLASSES, qui sont obfusquees et
      // parfois differentes d une ligne a l autre (survol, selection).
      var empreinte =
        el.tagName +
        "|" +
        (el.getAttribute("role") || "") +
        "|" +
        el.children.length +
        "|" +
        Math.round(boite.height);

      var cle = empreinte;
      var groupe = groupes.get(cle);
      if (!groupe) {
        groupe = { parents: new Map(), empreinte: empreinte };
        groupes.set(cle, groupe);
      }
      var liste = groupe.parents.get(parent);
      if (!liste) groupe.parents.set(parent, [el]);
      else liste.push(el);
    }

    var meilleur = null;
    groupes.forEach(function (groupe) {
      groupe.parents.forEach(function (elements, parent) {
        // Trois membres en regle generale. MAIS un tableau reel peut n avoir
        // que DEUX lignes (constate sur un ecran d adsets a deux ensembles :
        // zero ligne trouvee, rail vide, alors que tout etait la). Deux
        // suffisent quand chacune porte un lien : sur les trois plateformes,
        // le nom d une entite est un lien, ce qu un separateur ou une paire
        // de boutons n a pas.
        var minimum = 3;
        if (elements.length === 2) {
          var avecLien = 0;
          for (var q = 0; q < elements.length; q++) {
            try {
              if (elements[q].querySelector("a[href]")) avecLien += 1;
            } catch (e) {
              /* rien */
            }
          }
          if (avecLien === 2) minimum = 2;
        }
        if (elements.length < minimum) return;
        // Le groupe doit porter du texte : une grille d icones ou de separateurs
        // a la meme forme qu un tableau, et n est pas un tableau.
        var avecTexte = 0;
        for (var k = 0; k < elements.length; k++) {
          if ((elements[k].innerText || "").trim().length > 3) avecTexte += 1;
        }
        if (avecTexte < minimum) return;
        var score = avecTexte;
        if (!meilleur || score > meilleur.score) {
          meilleur = {
            elements: elements,
            score: score,
            empreinte: groupe.empreinte,
            parent: parent
          };
        }
      });
    });

    if (!meilleur) return { elements: [], selecteur: null };
    return {
      elements: meilleur.elements,
      selecteur: "structure:" + meilleur.empreinte,
      structurel: true
    };
  }

  /**
   * Le selecteur le PLUS PRODUCTIF de la liste, et non le premier qui repond.
   *
   * `div[role="row"]` attrape parfois une unique ligne de menu ou de liste
   * deroulante. Avec « le premier qui rend au moins un resultat », elle gagnait
   * contre le vrai tableau et l on se retrouvait avec une ligne fantome au lieu
   * de trente. Le nombre departage mieux que l ordre.
   *
   * L ordre garde son role en cas d egalite : les selecteurs ARIA, plus
   * durables, restent en tete de liste.
   */
  function meilleurQuiRend(racine, liste, adaptateur) {
    var meilleur = { elements: [], selecteur: null };
    for (var i = 0; i < liste.length; i++) {
      var trouves;
      try {
        trouves =
          typeof adaptateur.traverser === "function"
            ? adaptateur.traverser(racine, liste[i])
            : Array.prototype.slice.call(racine.querySelectorAll(liste[i]));
      } catch (e) {
        continue;
      }
      if (trouves && trouves.length > meilleur.elements.length) {
        meilleur = { elements: trouves, selecteur: liste[i] };
      }
    }
    return meilleur;
  }

  /**
   * L ancrage par les NOMS : la detection qui renverse le probleme.
   *
   * Au lieu de chercher des lignes puis de les identifier, on cherche dans la
   * page les noms d entites que le CRM CONNAIT DEJA (l index est charge
   * d avance), et l on remonte de chaque nom trouve a sa ligne. Aucune classe,
   * aucun role, aucun selecteur : seulement du texte que l on connait. C est
   * la seule methode qui survit a n importe quelle refonte du DOM, parce que
   * la seule chose qu une interface publicitaire ne peut pas obfusquer, c est
   * le nom des campagnes qu elle affiche.
   *
   * Les noms sont cherches dans les LIENS d abord : sur les trois plateformes,
   * le nom d une entite est un lien cliquable. C est aussi ce qui rend la
   * recherche bon marche.
   *
   * La remontee : avec au moins deux noms trouves, leur premier anctre COMMUN
   * est le conteneur des lignes, et la ligne de chacun est son anctre situe
   * juste en dessous de ce conteneur. Avec un seul nom, on prend le plus haut
   * anctre qui a encore une forme de ligne (large, pas trop haut).
   */
  function detecterParNoms(nomsConnus, racine) {
    if (!nomsConnus || nomsConnus.size === 0) return { elements: [], selecteur: null };
    var base = racine || document.body;

    var candidats = [];
    var liens;
    try {
      liens = base.querySelectorAll("a");
    } catch (e) {
      return { elements: [], selecteur: null };
    }
    for (var i = 0; i < liens.length && i < 4000; i++) {
      var texte = (liens[i].innerText || "").trim();
      if (texte.length < 3) continue;
      if (nomsConnus.has(F.normaliserNom(texte))) {
        candidats.push({ element: liens[i], nom: texte });
      }
    }
    if (!candidats.length) return { elements: [], selecteur: null };

    var conteneur = null;
    if (candidats.length >= 2) {
      // Premier anctre du premier candidat qui contient AUSSI un autre
      // candidat : c est l anctre commun le plus profond, donc le conteneur.
      var e = candidats[0].element.parentElement;
      while (e && e !== document.body) {
        var contenus = 0;
        for (var k = 0; k < candidats.length; k++) {
          if (e.contains(candidats[k].element)) contenus += 1;
        }
        if (contenus >= 2) {
          conteneur = e;
          break;
        }
        e = e.parentElement;
      }
    }

    var lignes = [];
    var nomsParLigne = [];
    var dejaVues = [];
    for (var c = 0; c < candidats.length; c++) {
      var ligne = null;
      if (conteneur) {
        var m = candidats[c].element;
        while (m && m.parentElement !== conteneur) {
          m = m.parentElement;
          if (!m || m === document.body) break;
        }
        if (m && m.parentElement === conteneur) ligne = m;
      } else {
        // Un seul nom trouve : le plus haut anctre qui garde une forme de
        // ligne. S arreter au premier qui deborde en hauteur.
        var n = candidats[c].element;
        var retenu = n;
        while (n && n !== document.body) {
          var boite;
          try {
            boite = n.getBoundingClientRect();
          } catch (e2) {
            break;
          }
          if (boite.height > 220) break;
          if (boite.width >= 250) retenu = n;
          n = n.parentElement;
        }
        ligne = retenu;
      }
      if (!ligne || dejaVues.indexOf(ligne) !== -1) continue;
      dejaVues.push(ligne);
      lignes.push(ligne);
      nomsParLigne.push(candidats[c].nom);
    }

    if (!lignes.length) return { elements: [], selecteur: null };
    return {
      elements: lignes,
      noms: nomsParLigne,
      selecteur: "ancrage-noms (" + lignes.length + " sur " + candidats.length + " noms)",
      conteneur: conteneur
    };
  }

  /**
   * Les lignes de donnees.
   *
   * L en-tete porte le meme `role="row"` que les donnees : on l ecarte a la
   * presence d un `columnheader`. Le confondre avec une ligne decalerait TOUT
   * le rail d un cran, ce qui est exactement la defaillance invisible qu on
   * veut interdire.
   *
   * Quatre etages, dans cet ordre : les selecteurs declares de l adaptateur,
   * l ANCRAGE PAR LES NOMS que le CRM connait, la detection structurelle sous
   * la grille, puis la meme sur la page entiere. L ancrage passe avant le
   * structurel parce qu il identifie en meme temps qu il trouve.
   */
  function decouvrir(adaptateur, grille, nomsConnus) {
    var racine = grille || document;
    var r = meilleurQuiRend(racine, adaptateur.selecteurs.ligne, adaptateur);
    if (!r.elements.length) {
      r = detecterParNoms(nomsConnus, racine);
      if (!r.elements.length && grille) r = detecterParNoms(nomsConnus, document.body);
      if (r.elements.length && J) J.dire("lignes trouvées par", r.selecteur);
    }
    if (!r.elements.length) {
      r = detecterStructurellement(racine);
      // Le tableau est parfois plus loin que la grille reconnue. On elargit une
      // fois au document entier plutot que de rendre une liste vide.
      if (!r.elements.length && grille) r = detecterStructurellement(document.body);
      if (r.elements.length && J) {
        J.dire("lignes trouvées par détection structurelle :", r.selecteur);
      }
    }
    var sortie = [];
    for (var i = 0; i < r.elements.length; i++) {
      var el = r.elements[i];
      try {
        if (el.querySelector('[role="columnheader"], th')) continue;
      } catch (e) {
        /* rien */
      }
      // La ligne de totaux et consorts : une ligne du tableau qui n est pas
      // une entite. L afficher « non identifiee » serait un faux probleme.
      try {
        if (adaptateur.estLigneAExclure && adaptateur.estLigneAExclure(el)) continue;
      } catch (e) {
        /* rien */
      }
      var nom = "";
      // L ancrage connait deja le nom : c est lui qui a trouve la ligne. Le
      // reprendre evite de redemander a nomDeLigne, qui pourrait choisir un
      // autre texte de la meme ligne.
      if (r.noms && r.noms[i]) {
        nom = r.noms[i];
      } else {
        try {
          nom = adaptateur.nomDeLigne(el);
        } catch (e) {
          nom = "";
        }
      }
      sortie.push({ element: el, nom: nom, ordinal: sortie.length });
    }
    return { lignes: sortie, selecteur: r.selecteur, conteneur: r.conteneur || null };
  }

  function marquer(l, id, methode, confiance, detail) {
    return {
      element: l.element,
      nom: l.nom,
      ordinal: l.ordinal,
      externalId: id || null,
      methode: methode || null,
      confiance: confiance,
      detail: detail || null
    };
  }

  /**
   * Attribue une identite a chaque ligne.
   *
   * `carteReseau` et `indexCrm` sont des Map de nom normalise vers un tableau
   * d identifiants. Le tableau, et non une valeur unique, est ce qui permet de
   * DETECTER l ambiguite au lieu de la subir.
   */
  function resoudre(adaptateur, lignes, carteReseau, indexCrm) {
    var resultat = [];
    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i];
      var parDom = null;
      var methode = null;

      for (var k = 0; k < adaptateur.identifiants.length && !parDom; k++) {
        try {
          parDom = adaptateur.identifiants[k].trouver(l.element);
        } catch (e) {
          parDom = null;
        }
        if (parDom) methode = adaptateur.identifiants[k].methode;
      }
      if (parDom) parDom = adaptateur.normaliserId(parDom);

      var cleNom = F.normaliserNom(l.nom);
      var candidatsReseau = (cleNom && carteReseau && carteReseau.get(cleNom)) || [];
      var parReseau = candidatsReseau.length === 1 ? candidatsReseau[0] : null;

      // Le desaccord n est PAS arbitre. Choisir l un des deux afficherait les
      // chiffres d une autre entite avec l aplomb d une donnee verifiee.
      if (parDom && parReseau && parDom !== parReseau) {
        resultat.push(
          marquer(l, null, "desaccord", CONFIANCE.AMBIGU, { dom: parDom, reseau: parReseau })
        );
        continue;
      }
      if (parDom) {
        resultat.push(marquer(l, parDom, methode, CONFIANCE.EXACT));
        continue;
      }
      if (parReseau) {
        resultat.push(marquer(l, parReseau, "reseau", CONFIANCE.EXACT));
        continue;
      }
      if (candidatsReseau.length > 1) {
        resultat.push(
          marquer(l, null, "reseau", CONFIANCE.AMBIGU, { nombre: candidatsReseau.length })
        );
        continue;
      }

      var duCrm = (cleNom && indexCrm && indexCrm.get(cleNom)) || [];
      if (duCrm.length === 1) {
        resultat.push(marquer(l, duCrm[0], "nom-crm", CONFIANCE.NOM));
        continue;
      }
      if (duCrm.length > 1) {
        // Cas reel et frequent : les quinze publicites de la campagne Meta
        // « RDV » portent toutes le meme nom. Le rapprochement par nom DOIT
        // refuser de trancher.
        resultat.push(marquer(l, null, "nom-crm", CONFIANCE.AMBIGU, { nombre: duCrm.length }));
        continue;
      }

      resultat.push(marquer(l, null, null, CONFIANCE.INCONNU));
    }

    if (J) {
      var exacts = resultat.filter(function (r) {
        return r.confiance === CONFIANCE.EXACT;
      }).length;
      J.dire("lignes", resultat.length, "dont exactes", exacts);
    }
    return resultat;
  }

  /** Construit une Map nom normalise -> [identifiants], en ne gardant que le
   *  niveau demande. */
  function carte(entites, niveau) {
    var m = new Map();
    for (var i = 0; i < entites.length; i++) {
      var e = entites[i];
      if (niveau && e.niveau !== niveau) continue;
      var k = F.normaliserNom(e.nom);
      if (!k) continue;
      var liste = m.get(k);
      if (!liste) {
        m.set(k, [e.id || e.externalId]);
      } else if (liste.indexOf(e.id || e.externalId) === -1) {
        liste.push(e.id || e.externalId);
      }
    }
    return m;
  }

  /**
   * Sonde du DOM, pour le rapport de diagnostic.
   *
   * C EST LA PIECE QUI PERMET DE REPARER SANS ETRE DEVANT L ECRAN. Quand aucune
   * ligne n est trouvee, la question n est pas « quel selecteur ecrire », c est
   * « qu y a-t-il reellement dans cette page ». La sonde compte ce que chaque
   * selecteur declare attrape, puis decrit ce que porte le meilleur candidat :
   * ses roles, ses balises, la forme de ses enfants.
   *
   * Elle ne rend QUE des comptes, des noms de balise et des roles. Aucun texte
   * de campagne, aucune donnee client : un rapport doit pouvoir se coller dans
   * un message sans rien exfiltrer.
   */
  function sonder(adaptateur, indexCrm) {
    function compter(liste, racine) {
      var sortie = {};
      for (var i = 0; i < liste.length; i++) {
        var n = 0;
        try {
          n =
            typeof adaptateur.traverser === "function"
              ? adaptateur.traverser(racine, liste[i]).length
              : racine.querySelectorAll(liste[i]).length;
        } catch (e) {
          n = -1; // selecteur invalide dans ce navigateur
        }
        sortie[liste[i]] = n;
      }
      return sortie;
    }

    var g = trouverGrille(adaptateur);
    var rapport = {
      selecteursGrille: compter(adaptateur.selecteurs.grille, document),
      selecteursLigne: compter(adaptateur.selecteurs.ligne, g.element || document),
      selecteursCellule: compter(adaptateur.selecteurs.cellule, g.element || document),
      selecteursDates: compter(adaptateur.selecteurs.dates || [], document),
      dansUnIframe: window.top !== window,
      // Les cadres du document : si le tableau vit dans l un d eux, aucun
      // selecteur du parent ne le verra jamais, et c est la premiere chose a
      // lire dans ce rapport. Seules les origines sont donnees, pas les URL
      // completes.
      iframes: (function () {
        var sortie = [];
        try {
          var cadres = document.querySelectorAll("iframe");
          for (var f = 0; f < cadres.length && f < 12; f++) {
            var src = cadres[f].getAttribute("src") || "(sans src)";
            sortie.push(src.split("?")[0].slice(0, 80));
          }
        } catch (e) {
          /* rien */
        }
        return sortie;
      })(),
      shadowRootsOuverts: 0,
      rolesDuDocument: {},
      grille: null,
      structure: null
    };

    // Combien de shadow roots ouverts. Un total eleve chez Google explique une
    // recherche vide ; zero alors qu on en attend dit qu ils sont FERMES, et
    // c est definitif.
    try {
      var tous = document.querySelectorAll("*");
      for (var i = 0; i < tous.length && i < 8000; i++) {
        if (tous[i].shadowRoot) rapport.shadowRootsOuverts += 1;
        var role = tous[i].getAttribute && tous[i].getAttribute("role");
        if (role) {
          rapport.rolesDuDocument[role] = (rapport.rolesDuDocument[role] || 0) + 1;
        }
      }
    } catch (e) {
      /* rien */
    }

    if (g.element) {
      var boite = null;
      try {
        boite = g.element.getBoundingClientRect();
      } catch (e) {
        /* rien */
      }
      var enfants = {};
      for (var k = 0; k < g.element.children.length && k < 40; k++) {
        var c = g.element.children[k];
        var cle =
          c.tagName + (c.getAttribute("role") ? "[" + c.getAttribute("role") + "]" : "");
        enfants[cle] = (enfants[cle] || 0) + 1;
      }
      rapport.grille = {
        selecteur: g.selecteur,
        balise: g.element.tagName,
        role: g.element.getAttribute("role"),
        enfantsDirects: g.element.children.length,
        formeDesEnfants: enfants,
        taille: boite ? Math.round(boite.width) + "x" + Math.round(boite.height) : null
      };
    }

    // L ancrage par noms est la detection la plus fiable : la sonde dit
    // combien de noms connus du CRM sont reellement visibles dans la page.
    // Zero avec un index charge veut dire que le referentiel et l ecran ne
    // parlent pas des memes entites, et ce n est plus un probleme de DOM.
    var ancrage = detecterParNoms(indexCrm, document.body);
    rapport.ancrageNoms = {
      nomsDansLIndex: indexCrm ? indexCrm.size : 0,
      lignesTrouvees: ancrage.elements.length,
      detail: ancrage.selecteur
    };

    var s = detecterStructurellement(g.element || document.body);
    rapport.structure = {
      trouve: s.elements.length,
      empreinte: s.selecteur,
      // La forme des trois premieres, pour reconnaitre une vraie ligne d une
      // fausse : une ligne de tableau a plusieurs enfants et du texte.
      exemples: s.elements.slice(0, 3).map(function (el) {
        var b = { balise: el.tagName, role: el.getAttribute("role"), enfants: el.children.length };
        try {
          b.hauteur = Math.round(el.getBoundingClientRect().height);
        } catch (e) {
          /* rien */
        }
        return b;
      })
    };

    return rapport;
  }

  root.IMPULSION_LIGNES = {
    CONFIANCE: CONFIANCE,
    trouverGrille: trouverGrille,
    trouverDefilement: trouverDefilement,
    decouvrir: decouvrir,
    detecterParNoms: detecterParNoms,
    detecterStructurellement: detecterStructurellement,
    resoudre: resoudre,
    carte: carte,
    premierQuiRend: premierQuiRend,
    meilleurQuiRend: meilleurQuiRend,
    sonder: sonder
  };
})(typeof self !== "undefined" ? self : window);
