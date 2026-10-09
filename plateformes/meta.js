// Adaptateur Meta Ads Manager.
//
// TOUT CE QUI EST PROPRE A META VIT ICI, et rien d autre n en sait quoi que ce
// soit. Quand Meta change son interface, on ouvre ce fichier, on corrige, on
// republie. Aucune chaine de selecteur ne doit apparaitre dans `content/`.
//
// CHAQUE SELECTEUR EST UNE LISTE, PAS UNE CHAINE. On essaie dans l ordre et
// l on retient le premier qui rend un compte plausible. Un ancien selecteur qui
// traine dans la liste ne coute rien et sauve la mise le jour ou Meta revient
// en arriere, ce qui arrive plus souvent qu on ne croit.
//
// CE QUI EST SUR ET CE QUI EST A OBSERVER. Les motifs d URL sont verifies. Les
// selecteurs de DOM sont des HYPOTHESES : ils partent des attributs ARIA, que
// Meta a des obligations legales de tenir et ne casse donc pas a la legere, la
// ou ses classes CSS sont obfusquees et changent chaque trimestre. Le mode
// diagnostic dira lequel a servi, et le rapport copiable permettra de corriger
// ce fichier sur des faits.

(function (root) {
  "use strict";

  var F = root.IMPULSION_FORMAT;

  /** Date de la derniere verification de ces selecteurs contre le vrai DOM.
   *  Affichee dans le bandeau degrade : « l interface a probablement changé
   *  depuis la version 2026-08-24 de l adaptateur » situe le probleme mieux
   *  qu un message generique. */
  var VERSION = "2026-08-26";

  function reconnait(url) {
    return (
      /^https:\/\/adsmanager\.facebook\.com\//.test(url) ||
      /^https:\/\/business\.facebook\.com\/.*adsmanager/.test(url) ||
      /^https:\/\/www\.facebook\.com\/adsmanager/.test(url)
    );
  }

  /** Le niveau se lit dans le chemin : /manage/campaigns, /manage/adsets,
   *  /manage/ads. C est stable depuis des annees. */
  function niveau(url) {
    if (/\/manage\/ads(\b|\/|\?|$)/.test(url)) return "pub";
    if (/\/manage\/adsets/.test(url)) return "adset";
    if (/\/manage\/campaigns/.test(url)) return "campagne";
    return null;
  }

  /** Le compte publicitaire, sous la forme que porte le referentiel du CRM
   *  (`act_<chiffres>`). Meta l ecrit `act=123` dans l URL. */
  function compte(url) {
    var m = /[?&]act=(\d+)/.exec(url);
    return m ? "act_" + m[1] : null;
  }

  /**
   * La periode.
   *
   * Meta ecrit `date=AAAA-MM-JJ_AAAA-MM-JJ`, parfois suivi d une virgule et
   * d un prereglage (`,last_30d`), qu on ignore : les deux bornes explicites
   * sont ce qui compte.
   *
   * PIEGE VECU AILLEURS, a garder en tete : Meta recharge son tableau a un
   * changement de filtre SANS changer l URL. L orchestrateur lit donc aussi le
   * libelle du selecteur de dates et compare. C est pour cela que cette
   * fonction rend `source` : l en-tete affiche d ou vient la periode, et un
   * desaccord se voit.
   */
  function jourIso(d) {
    var y = d.getFullYear();
    var mo = d.getMonth() + 1;
    var j = d.getDate();
    return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (j < 10 ? "0" : "") + j;
  }

  function ilYa(jours) {
    var d = new Date();
    d.setDate(d.getDate() - jours);
    return d;
  }

  /**
   * La periode, lue dans l URL.
   *
   * LE PIEGE, constate sur un rapport de diagnostic reel : l URL porte
   * `date=2026-08-01_2026-08-19,this_month` alors que l ecran affiche le mois
   * entier (1 au 26). Quand un PREREGLAGE suit la virgule, Meta ne remet pas
   * les dates brutes a jour : elles datent du jour ou le preset a ete pose.
   * La verite est le preset, et il se TRADUIT ; les dates brutes ne font foi
   * que quand il n y a pas de preset (plage personnalisee).
   */
  var PREREGLAGES = {
    today: function () { return { du: jourIso(new Date()), au: jourIso(new Date()) }; },
    yesterday: function () { return { du: jourIso(ilYa(1)), au: jourIso(ilYa(1)) }; },
    this_month: function () {
      var d = new Date();
      return { du: jourIso(new Date(d.getFullYear(), d.getMonth(), 1)), au: jourIso(d) };
    },
    last_month: function () {
      var d = new Date();
      return {
        du: jourIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        au: jourIso(new Date(d.getFullYear(), d.getMonth(), 0))
      };
    },
    last_7d: function () { return { du: jourIso(ilYa(6)), au: jourIso(new Date()) }; },
    last_14d: function () { return { du: jourIso(ilYa(13)), au: jourIso(new Date()) }; },
    last_30d: function () { return { du: jourIso(ilYa(29)), au: jourIso(new Date()) }; },
    last_90d: function () { return { du: jourIso(ilYa(89)), au: jourIso(new Date()) }; }
  };

  function periode(url) {
    var brut = /[?&]date=([^&#]+)/.exec(url);
    if (!brut) return null;
    var valeur = decodeURIComponent(brut[1]);
    var morceaux = valeur.split(",");

    var preset = morceaux[1] && PREREGLAGES[morceaux[1].trim()];
    if (preset) {
      var plage = preset();
      return { du: plage.du, au: plage.au, source: "url" };
    }
    // `lifetime` et `maximum` n ont pas de bornes traduisibles : on laisse la
    // main aux replis plutot que d inventer une plage.
    if (morceaux[1] && /^(lifetime|maximum)$/.test(morceaux[1].trim())) return null;

    var m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(morceaux[0].trim());
    if (!m) return null;
    return { du: m[1], au: m[2], source: "url" };
  }

  /** Le libelle du selecteur de dates, en repli. */
  var SELECTEUR_DATES = [
    '[aria-label*="Plage de dates"]',
    '[aria-label*="Date range"]',
    '[data-testid="date_picker_button"]',
    'div[role="button"][aria-haspopup="dialog"]'
  ];

  // LES CLASSES `fixedDataTable*` NE SONT PAS DES CLASSES OBFUSQUEES. Ads
  // Manager est bati sur la bibliotheque `fixed-data-table` de Facebook, dont
  // les noms de classe publics (`public_*`) font partie de son API et n ont pas
  // bouge depuis des annees, la ou les classes de style (`_1gd4`) changent a
  // chaque deploiement. Elles sont donc plus sures que le pari ARIA, pas moins.
  //
  // Les selecteurs ARIA restent en tete : quand ils fonctionnent, ils sont plus
  // durables encore. Et l on ne prend plus le PREMIER qui rend quelque chose,
  // mais celui qui en rend le PLUS : `div[role="row"]` attrape parfois une
  // seule ligne de menu, qui gagnerait contre le vrai tableau.
  var selecteurs = {
    /** La grille. `treegrid` d abord : Meta l emploie quand les lignes se
     *  deplient. */
    grille: [
      // Le conteneur des lignes, mesure sur le DOM reel.
      "._1gda",
      'div[role="treegrid"]',
      'div[role="grid"]',
      'div[role="table"]',
      ".public_fixedDataTable_main",
      ".fixedDataTable_main",
      '[data-testid*="ads-manager-table"]',
      '[data-testid*="AdsManagerTable"]'
    ],
    /** Les lignes de donnees. L en-tete porte le meme role, on l ecarte par sa
     *  position et par la presence de `columnheader`. */
    ligne: [
      // Posees par marquerLignes() (monde MAIN, fibre React) : exactes.
      "[data-impulsion-id]",
      // Les classes internes du tableau de Meta, mesurees sur le DOM reel le
      // 26 aout 2026 : la ligne fait 1748x46, une par entite plus les totaux.
      "._1gd4",
      'div[role="row"]',
      ".public_fixedDataTableRow_main",
      ".fixedDataTableRowLayout_rowWrapper",
      'div[role="listitem"][data-testid*="row"]',
      "[data-surface-wrapper] > div[data-testid]"
    ],
    entete: [
      'div[role="row"]:has([role="columnheader"])',
      ".public_fixedDataTable_header .public_fixedDataTableRow_main",
      ".fixedDataTableLayout_header .fixedDataTableRowLayout_rowWrapper",
      'div[role="rowgroup"]:first-child div[role="row"]'
    ],
    cellule: [
      // Lues dans l exempleLigne d un rapport de diagnostic reel : la cellule
      // est `._4lg0` (largeur et left poses en style inline par leur moteur),
      // son contenu `._1b33`.
      "._4lg0",
      "._1b33",
      'div[role="gridcell"]',
      'div[role="cell"]',
      ".public_fixedDataTableCell_cellContent",
      ".fixedDataTableCellLayout_wrap1"
    ],
    dates: SELECTEUR_DATES
  };

  /**
   * Comment lire l identifiant sur la ligne elle-meme.
   *
   * Ordre du plus fiable au moins fiable. Chaque entree est essayee et la
   * premiere qui rend quelque chose gagne, mais le resultat est RECOUPE avec ce
   * que l interception reseau a vu : un desaccord ne se tranche pas, il fait
   * basculer la ligne en « a verifier ».
   */
  var identifiants = [
    {
      // Posee par la fibre React (monde MAIN). C est la source EXACTE :
      // l objectID des props de Meta est l externalId du referentiel du CRM,
      // verifie sur le DOM reel.
      methode: "fibre",
      trouver: function (el) {
        return el.getAttribute("data-impulsion-id");
      }
    },
    {
      methode: "lien",
      trouver: function (el) {
        var liens = el.querySelectorAll("a[href]");
        for (var i = 0; i < liens.length; i++) {
          var h = liens[i].getAttribute("href") || "";
          var m =
            /selected_(?:campaign|adset|ad)_ids=(\d{6,})/.exec(h) ||
            /[?&](?:campaign|adset|ad)_id=(\d{6,})/.exec(h);
          if (m) return m[1];
        }
        return null;
      }
    },
    {
      methode: "case",
      trouver: function (el) {
        // Les cases a cocher de selection portent souvent l identifiant dans
        // leur `value`, leur `id` ou leur `aria-labelledby`.
        var champs = el.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
        for (var i = 0; i < champs.length; i++) {
          var brut =
            champs[i].getAttribute("value") ||
            champs[i].getAttribute("id") ||
            champs[i].getAttribute("data-id") ||
            "";
          var m = /(\d{12,})/.exec(brut);
          if (m) return m[1];
        }
        return null;
      }
    },
    {
      methode: "attribut",
      trouver: function (el) {
        var noms = ["data-id", "data-row-id", "data-ad-id", "data-adset-id", "data-campaign-id"];
        for (var i = 0; i < noms.length; i++) {
          var v = el.getAttribute(noms[i]);
          if (v && /^\d{6,}$/.test(v)) return v;
        }
        return null;
      }
    }
  ];

  /**
   * Normalise un identifiant.
   *
   * Relay encode parfois ses identifiants globaux en base64 sous la forme
   * `Type:123456`. On garde la partie numerique, sans quoi la meme entite
   * porterait deux identifiants differents selon qu elle vient du DOM ou du
   * reseau, et le recoupement declarerait un desaccord la ou il n y en a pas.
   */
  function normaliserId(brut) {
    if (!brut) return null;
    var s = String(brut).trim();
    if (/^\d+$/.test(s)) return s;
    try {
      var decode = atob(s);
      var m = /:(\d+)$/.exec(decode);
      if (m) return m[1];
    } catch (e) {
      /* pas du base64, tant mieux */
    }
    var n = /(\d{6,})/.exec(s);
    return n ? n[1] : null;
  }

  /** Le nom affiche sur une ligne. */
  function nomDeLigne(el) {
    var marque = el.getAttribute("data-impulsion-nom");
    if (marque) return marque;
    var cellules = el.querySelectorAll(selecteurs.cellule.join(","));
    for (var i = 0; i < cellules.length; i++) {
      var t = (cellules[i].innerText || "").trim();
      // On saute les cellules de controle : case a cocher, interrupteur,
      // chiffres seuls. Un nom de campagne fait plus de deux caracteres et
      // n est pas qu un nombre.
      if (t.length > 2 && !/^[\d\s.,%€$-]+$/.test(t)) {
        return t.split("\n")[0].trim();
      }
    }
    var brut = (el.innerText || "").trim();
    return brut ? brut.split("\n")[0].trim() : "";
  }

  // ── Le marquage par la fibre React ──────────────────────────────────────
  //
  // LA TECHNIQUE QUI MARCHE, verifiee le 26 aout 2026 sur le DOM reel via le
  // banc de test (scripts/banc.mjs) : Ads Manager n expose NI roles ARIA sur
  // ses lignes, NI liens sur ses noms. En revanche, chaque ligne
  // porte une fibre React dont les props contiennent `objectID`, l identifiant
  // natif de l entite, celui-la meme que le referentiel du CRM stocke en
  // `externalId`.
  //
  // Ce code tourne dans le MONDE MAIN (seul a voir les proprietes
  // `__reactFiber$...`), appele par reseau.js. Il ecrit le resultat dans des
  // ATTRIBUTS du DOM (`data-impulsion-id`, `data-impulsion-nom`) : les
  // attributs sont partages entre les mondes, les objets JavaScript non. Le
  // monde isole n a plus qu a lire `[data-impulsion-id]`, ce qui identifie la
  // ligne avec une exactitude que ni les selecteurs ni les noms n atteignent.
  //
  // `._1gd4` (la ligne) et `._1gda` (leur conteneur) sont les classes internes
  // du tableau de Meta. Elles sont obfusquees mais STABLES depuis des annees,
  // et le jour ou elles disparaissent, le repli est la detection structurelle
  // du monde isole. Mesure
  // sur l ecran adsets reel : 3 lignes de donnees avec objectID, la ligne
  // « Resultats de N ... » n en a pas, ce qui l ecarte d elle-meme.

  /**
   * Le marquage, en une fonction AUTONOME.
   *
   * Elle ne reference RIEN hors d elle-meme, et c est une contrainte dure :
   * le service worker la passe a `chrome.scripting.executeScript`, qui la
   * SERIALISE. Une fermeture sur une fonction voisine survivrait a la
   * relecture mais pas a la serialisation, et l appel echouerait dans la page.
   *
   * POURQUOI executeScript ET PAS l inscription en monde MAIN. Les deux
   * voies existent, et l inscription reste posee. Mais sur le DOM reel du
   * banc de test, les globals poses par l inscription MAIN disparaissaient
   * sans exception ni trace, la ou `executeScript({world: "MAIN"})` marque
   * 3 lignes sur 4 a tous les coups, erreurs visibles a l appelant. Entre un
   * mystere et un chemin observable, on cable le chemin observable.
   */
  function marquerLignes(doc) {
    function fibreDe(el) {
      var cles = Object.keys(el);
      for (var i = 0; i < cles.length; i++) {
        if (cles[i].indexOf("__reactFiber$") === 0) return el[cles[i]];
      }
      return null;
    }

    var d = doc || document;
    var lignes;
    try {
      lignes = d.querySelectorAll("._1gd4");
    } catch (e) {
      return { lignes: 0, marquees: 0 };
    }
    var marquees = 0;
    for (var i = 0; i < lignes.length; i++) {
      var ligne = lignes[i];
      var idTrouve = null;
      var porteurs = [ligne];
      var descendants;
      try {
        descendants = ligne.querySelectorAll("*");
      } catch (e) {
        descendants = [];
      }
      for (var j = 0; j < descendants.length && porteurs.length < 61; j++) {
        porteurs.push(descendants[j]);
      }
      for (var k = 0; k < porteurs.length && !idTrouve; k++) {
        var f = fibreDe(porteurs[k]);
        var prof = 0;
        while (f && prof < 50) {
          var mp = f.memoizedProps;
          if (mp && typeof mp === "object" && mp.objectID !== undefined) {
            var brut = String(mp.objectID);
            if (/^\d{6,}$/.test(brut)) {
              idTrouve = brut;
              break;
            }
          }
          f = f.return;
          prof += 1;
        }
      }
      if (idTrouve) {
        if (ligne.getAttribute("data-impulsion-id") !== idTrouve) {
          ligne.setAttribute("data-impulsion-id", idTrouve);
        }
        var nom = ((ligne.innerText || "").split("\n")[0] || "").trim();
        if (nom && ligne.getAttribute("data-impulsion-nom") !== nom) {
          ligne.setAttribute("data-impulsion-nom", nom);
        }
        marquees += 1;
      } else if (ligne.getAttribute("data-impulsion-exclue") !== "1") {
        // La ligne de totaux (« Resultats de N ... ») n a pas d objectID.
        ligne.setAttribute("data-impulsion-exclue", "1");
      }
    }
    return { lignes: lignes.length, marquees: marquees };
  }

  // ── Interception reseau ───────────────────────────────────────────────────

  var reseau = {
    urlInteressante: function (url) {
      return url.indexOf("/api/graphql") !== -1;
    },
    /** Prefixes anti-hijack. Facebook prefixe ses reponses de `for (;;);` pour
     *  qu un <script src> tiers ne puisse pas les lire. Un JSON.parse direct
     *  echoue dessus, et l on croit a un format inconnu. */
    prefixesAJeter: ["for (;;);", ")]}'"],
    /** Relay repond en @defer : plusieurs objets JSON separes par des sauts de
     *  ligne dans un meme corps. Un JSON.parse global echoue. */
    lignesJson: true,
    tailleMax: 8000000,

    /**
     * Reconnait une entite a sa FORME, pas a son emplacement.
     *
     * On ne suit deliberement aucun chemin du genre
     * `data.viewer.ad_account.campaigns.edges[].node` : Meta renomme ses
     * operations et reorganise ses reponses tous les trimestres, et un chemin
     * code en dur casse a chaque fois en silence. `__typename`, lui, ne bouge
     * pas : c est le signal le plus stable de toute la reponse.
     */
    estEntite: function (o) {
      var t = o.__typename;
      var niveauTrouve = null;
      if (t === "AdCampaignGroup" || t === "Campaign" || t === "AdCampaignGroupSet") {
        niveauTrouve = "campagne";
      } else if (t === "AdCampaign" || t === "AdSet") {
        // Piege de vocabulaire : chez Meta, `AdCampaign` designe l AD SET.
        // Le groupe de campagnes (`AdCampaignGroup`) est ce que l interface
        // appelle « campagne ». Inverser les deux melangerait deux niveaux.
        niveauTrouve = "adset";
      } else if (t === "Ad" || t === "AdCampaignAd") {
        niveauTrouve = "pub";
      }

      var id = o.id || o.ad_id || o.adgroup_id || o.campaign_group_id || o.campaign_id;
      var nom = o.name || o.ad_name || o.adset_name || o.campaign_name;
      if (!id || !nom || typeof nom !== "string") return null;

      if (!niveauTrouve) {
        // Repli sans __typename : deduire le niveau des cles voisines.
        if (o.ad_id) niveauTrouve = "pub";
        else if (o.adgroup_id || o.adset_id) niveauTrouve = "adset";
        else if (o.campaign_id || o.campaign_group_id) niveauTrouve = "campagne";
        else return null;
      }

      var normalise = normaliserId(id);
      if (!normalise) return null;
      return { id: normalise, nom: nom, niveau: niveauTrouve };
    }
  };

  root.IMPULSION_META = {
    cle: "meta",
    label: "Meta Ads",
    version: VERSION,
    reconnait: reconnait,
    niveau: niveau,
    compte: compte,
    periode: periode,
    /** Le lecteur du libelle du selecteur de dates, partage. Le garde existe
     *  parce que ce fichier est aussi charge dans le monde MAIN, sans
     *  format.js. */
    lirePlageFrancaise: function (texte) {
      var FMT = root.IMPULSION_FORMAT;
      return FMT && FMT.lirePlageFrancaise ? FMT.lirePlageFrancaise(texte) : null;
    },
    selecteurs: selecteurs,
    /** Vrai pour une ligne qui n est pas une entite : la ligne de totaux
     *  (« Resultats de N ... »), marquee par le monde MAIN faute d objectID. */
    estLigneAExclure: function (el) {
      return el.getAttribute("data-impulsion-exclue") === "1";
    },
    marquerLignes: marquerLignes,
    /** Les colonnes de Meta qui ont un equivalent CRM : la valeur CRM se pose
     *  DANS la cellule de cette colonne, sous la valeur de Meta. C est la
     *  comparaison que tout l outil existe pour permettre : Meta annonce 5
     *  resultats, le CRM en a mesure 7. Les libelles sont ceux des en-tetes
     *  (role=columnheader), en francais et en anglais, compares en minuscules
     *  par inclusion. */
    colonnesNatives: [
      { cle: "depense", entetes: ["montant depense", "montant d\u00e9pens\u00e9", "amount spent"] },
      { cle: "leads", entetes: ["r\u00e9sultats", "resultats", "results"] },
      { cle: "cpl", entetes: ["co\u00fbt par r\u00e9sultat", "cout par resultat", "cost per result"] }
    ],
    identifiants: identifiants,
    normaliserId: normaliserId,
    nomDeLigne: nomDeLigne,
    reseau: reseau,
    /** Ce que l extension dit quand elle ne reconnait plus rien. */
    aide:
      "Meta a probablement changé la structure de son tableau. Ouvrez le mode " +
      "diagnostic, copiez le rapport, et corrigez plateformes/meta.js."
  };
})(typeof self !== "undefined" ? self : window);
