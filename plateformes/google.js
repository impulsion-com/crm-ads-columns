// Adaptateur Google Ads.
//
// LE PLUS DIFFICILE DES TROIS, et c est pourquoi il vient apres Meta.
//
// Trois difficultes propres a Google, qui ne se contournent pas de la meme
// facon :
//
//   1. L interface est batie sur Closure et emploie du shadow DOM. Un shadow
//      root FERME rendrait la lecture du DOM impossible ; ouvert, il faut le
//      traverser, ce que fait `traverser()` plus bas.
//   2. La plage de dates n est pas garantie d etre dans l URL. Google la garde
//      longtemps dans un etat applicatif persiste cote serveur. Le repli est le
//      libelle du bouton, en francais, d ou l analyseur de dates ci-dessous.
//   3. L interception reseau ne sert PAS a identifier les lignes : les reponses
//      RPC de Google sont des tableaux positionnels sans nom de champ, donc
//      illisibles sans schema. Elle sert en revanche a lire la plage de dates,
//      qui figure dans le corps de la requete, et c est ce qui sauve le point 2.
//
// Et un quatrieme point, constate sur l ecran reel le 9 octobre 2026 : les
// cellules de nom ne portent plus `campaignId=` dans leur lien (il n a pas de
// href du tout). Aucun identifiant ne se lit dans le DOM : les lignes se
// rapprochent par leur NOM, via l index du serveur, et un nom porte par deux
// campagnes laisse la ligne « non identifiee ».

(function (root) {
  "use strict";

  var VERSION = "2026-10-09";

  function reconnait(url) {
    return /^https:\/\/ads\.google\.com\/aw\//.test(url);
  }

  function niveau(url) {
    if (/\/aw\/ads(\b|\/|\?|$)/.test(url)) return "pub";
    if (/\/aw\/adgroups/.test(url)) return "adset";
    if (/\/aw\/campaigns/.test(url)) return "campagne";
    // Performance Max a ses propres ecrans, qui s arretent a la campagne.
    if (/\/aw\/performancemax/.test(url)) return "campagne";
    return null;
  }

  /** Le compte, sans tirets : c est la forme du referentiel du serveur.
   *
   *  Verifie sur l ecran reel le 9 octobre 2026 : `__c`, `ocid` et `ascid` sont
   *  des identifiants INTERNES de Google, jamais le numero client a dix
   *  chiffres. Celui-ci n est dans l URL que sous `__e`, et pas toujours. Le
   *  repli est le fil d Ariane des comptes, qui l affiche pour le compte en
   *  cours (et lui seul : le MCC de connexion est ailleurs dans la barre). */
  function compte(url) {
    var m = /[?&]__e=(\d{6,})/.exec(url);
    if (m) return m[1];
    if (typeof document === "undefined") return null;
    var el = document.querySelector("mcc-nav-breadcrumb .operating-customer .id");
    var t = el ? (el.textContent || "").replace(/\D/g, "") : "";
    return /^\d{10}$/.test(t) ? t : null;
  }

  /** Deleguee a shared/format.js : Meta et TikTok affichent aussi leur plage
   *  dans un bouton, l analyseur est commun. Le garde existe parce que ce
   *  fichier est aussi charge dans le monde MAIN, sans format.js. */
  function lirePlageFrancaise(texte) {
    var F = root.IMPULSION_FORMAT;
    return F && F.lirePlageFrancaise ? F.lirePlageFrancaise(texte) : null;
  }

  function periode(url) {
    // Certaines vues portent bien la plage dans le fragment.
    var m = /[?&#]date[s]?=(\d{4}-\d{2}-\d{2})[,_](\d{4}-\d{2}-\d{2})/.exec(url);
    if (m) return { du: m[1], au: m[2], source: "url" };
    return null;
  }

  var selecteurs = {
    grille: [
      "material-datatable",
      'ess-table',
      'div[role="grid"]',
      'div[role="table"]',
      "table.particle-table"
    ],
    ligne: ['ess-table .particle-table-row[role="row"]', 'ess-cell-container', 'div[role="row"]', "tr.particle-table-row"],
    entete: ['div[role="row"]:has([role="columnheader"])', "thead tr"],
    cellule: ['ess-cell[role="gridcell"]', 'div[role="gridcell"]', 'div[role="cell"]', "td"],
    dates: [
      'material-date-range-picker',
      '[aria-label*="Période"]',
      '[aria-label*="Date"]',
      "#dateRangeText"
    ]
  };

  /**
   * Traverse les shadow roots OUVERTS pour trouver les elements.
   *
   * Google en pose beaucoup. `querySelectorAll` s arrete a la frontiere : sans
   * cette descente, on ne trouverait rien du tout et l on conclurait a tort que
   * les selecteurs sont mauvais. Un shadow root FERME, lui, est definitivement
   * hors d atteinte ; le diagnostic le dira en comptant ce qu il rencontre.
   */
  function traverser(racine, selecteur, sortie, profondeur) {
    sortie = sortie || [];
    profondeur = profondeur || 0;
    if (profondeur > 12) return sortie;
    try {
      var directs = racine.querySelectorAll(selecteur);
      for (var i = 0; i < directs.length; i++) sortie.push(directs[i]);
    } catch (e) {
      /* selecteur invalide dans ce contexte */
    }
    var tous = racine.querySelectorAll("*");
    for (var j = 0; j < tous.length; j++) {
      if (tous[j].shadowRoot) traverser(tous[j].shadowRoot, selecteur, sortie, profondeur + 1);
    }
    return sortie;
  }

  var identifiants = [
    {
      methode: "lien",
      trouver: function (el) {
        var liens = el.querySelectorAll("a[href]");
        for (var i = 0; i < liens.length; i++) {
          var h = liens[i].getAttribute("href") || "";
          var m = /[?&#](?:campaignId|adGroupId|adId)=(\d{6,})/.exec(h);
          if (m) return m[1];
        }
        return null;
      }
    },
    {
      methode: "attribut",
      trouver: function (el) {
        var noms = ["data-campaign-id", "data-ad-group-id", "data-row-id", "data-id"];
        for (var i = 0; i < noms.length; i++) {
          var v = el.getAttribute(noms[i]);
          if (v && /^\d{6,}$/.test(v)) return v;
        }
        return null;
      }
    }
  ];

  function normaliserId(brut) {
    if (!brut) return null;
    var m = /(\d{6,})/.exec(String(brut));
    return m ? m[1] : null;
  }

  function nomDeLigne(el) {
    // La cellule du nom porte `essfield="name"`. Son lien n a PAS de href
    // (constate le 9 octobre 2026) : aucun identifiant ne se lit dans le DOM de
    // Google Ads, le rapprochement passe donc par le nom, via l index du serveur.
    var nom = el.querySelector('ess-cell[essfield="name"] a, ess-cell[essfield="name"]');
    if (nom) {
      var texte = (nom.innerText || "").trim().split("\n")[0].trim();
      if (texte) return texte;
    }
    var cellules = el.querySelectorAll(selecteurs.cellule.join(","));
    for (var i = 0; i < cellules.length; i++) {
      var t = (cellules[i].innerText || "").trim();
      if (t.length > 2 && !/^[\d\s.,%€$-]+$/.test(t)) return t.split("\n")[0].trim();
    }
    var brut = (el.innerText || "").trim();
    return brut ? brut.split("\n")[0].trim() : "";
  }

  // ── Interception reseau ───────────────────────────────────────────────────
  //
  // Elle ne cherche PAS d entites : les reponses RPC de Google sont des
  // tableaux positionnels sans nom de champ, illisibles sans schema, et
  // deviner des positions serait la pire facon de se tromper en silence.
  //
  // Elle cherche UNE SEULE chose, la plage de dates, qui apparait en clair dans
  // les corps de requete sous forme de dates ISO. C est le troisieme repli de
  // la periode, et sur Google c est souvent le seul qui fonctionne.

  var reseau = {
    urlInteressante: function (url) {
      return /ads\.google\.com\/.*\/(_\/rpc|aw_frontend|OneAdsService)/.test(url);
    },
    prefixesAJeter: [")]}'", ")]}'\n"],
    lignesJson: false,
    tailleMax: 4000000,
    /** Aucun rapprochement d entite par le reseau chez Google. */
    estEntite: function () {
      return null;
    },
    /** Mais la plage de dates, oui. */
    periodeDansTexte: function (texte) {
      var m = /"(\d{4}-\d{2}-\d{2})"\s*,\s*"(\d{4}-\d{2}-\d{2})"/.exec(texte);
      if (!m) return null;
      return { du: m[1], au: m[2], source: "reseau" };
    }
  };

  root.IMPULSION_GOOGLE = {
    cle: "google",
    label: "Google Ads",
    version: VERSION,
    reconnait: reconnait,
    niveau: niveau,
    compte: compte,
    periode: periode,
    lirePlageFrancaise: lirePlageFrancaise,
    selecteurs: selecteurs,
    traverser: traverser,
    identifiants: identifiants,
    normaliserId: normaliserId,
    nomDeLigne: nomDeLigne,
    /** Vrai pour une ligne qui n est pas une entite : les totaux et le rappel
     *  des brouillons, que Google range dans le meme tableau. */
    /** Les noms de campagne passent a la ligne chez Google : la bande de
     *  chiffres a besoin de sa place sous le nom, sinon elle le recouvre. */
    reserveSousLeNom: true,
    celluleDuNom: function (el) {
      return el.querySelector('ess-cell[essfield="name"]');
    },
    estLigneAExclure: function (el) {
      return /summary/.test(el.className || "") || !el.querySelector('ess-cell[essfield="name"]');
    },
    reseau: reseau,
    /** Performance Max ne descend pas sous la campagne : `{adgroupid}` et
     *  `{creative}` sont vides cote Google. Ce n est pas un defaut de synchro,
     *  et l extension doit l ECRIRE sur ces lignes plutot qu afficher zero. */
    noteNiveau: {
      adset: "Performance Max ne descend pas sous la campagne : ces niveaux sont vides chez Google.",
      pub: "Performance Max ne descend pas sous la campagne : ces niveaux sont vides chez Google."
    },
    aide:
      "Google Ads emploie du shadow DOM et garde parfois sa plage de dates hors " +
      "de l’URL. Ouvrez le mode diagnostic : il dira si les lignes ont été " +
      "trouvées et d’où vient la période."
  };
})(typeof self !== "undefined" ? self : window);
