// Adaptateur TikTok Ads Manager.
//
// PRESENT MAIS INERTE tant que le CRM n a pas de connecteur TikTok. Il ne
// manque au CRM que la synchronisation de la depense et du referentiel : le
// reste du chemin connait deja le mot « tiktok » (`ttclid` est capte a la
// collecte, `paid_tiktok` existe comme canal). Le jour ou la premiere ligne de
// depense atterrit dans `AdSpendDaily`, cet adaptateur se reveille sans qu on
// touche a une ligne d ici.
//
// C EST LE TEST DE L ABSTRACTION. Si activer TikTok demande de modifier autre
// chose que ce fichier et le manifeste, l abstraction est fausse, et il vaut
// mieux le decouvrir maintenant que dans six mois.
//
// TikTok est probablement le plus simple des trois : l interface est en React
// avec `rc-table`, dont les lignes portent `data-row-key`. Reste a verifier si
// cette cle est l identifiant de l entite ou un indice synthetique. C est la
// question a une minute qui decide de la difficulte de tout l adaptateur.

(function (root) {
  "use strict";

  var VERSION = "2026-08-24";

  function reconnait(url) {
    return /^https:\/\/ads\.tiktok\.com\/i18n\//.test(url);
  }

  function niveau(url) {
    if (/\/perf\/ad(\b|\/|\?|$)/.test(url) || /creative/.test(url)) return "pub";
    if (/\/perf\/adgroup/.test(url)) return "adset";
    if (/\/perf\/campaign/.test(url)) return "campagne";
    return null;
  }

  function compte(url) {
    var m = /[?&]aadvid=(\d+)/.exec(url);
    return m ? m[1] : null;
  }

  function periode(url) {
    var m =
      /[?&]start_time=(\d{4}-\d{2}-\d{2})[^&]*&end_time=(\d{4}-\d{2}-\d{2})/.exec(url) ||
      /[?&]from=(\d{4}-\d{2}-\d{2})[^&]*&to=(\d{4}-\d{2}-\d{2})/.exec(url);
    if (!m) return null;
    return { du: m[1], au: m[2], source: "url" };
  }

  var selecteurs = {
    grille: [".rc-table", 'div[role="grid"]', "table"],
    ligne: ["tr[data-row-key]", "tr.rc-table-row", 'div[role="row"]'],
    entete: ["thead tr", 'div[role="row"]:has([role="columnheader"])'],
    cellule: ["td", 'div[role="gridcell"]'],
    dates: ['[data-tid="date_picker"]', '[class*="DatePicker"]', '[aria-label*="date"]']
  };

  var identifiants = [
    {
      methode: "cle-ligne",
      trouver: function (el) {
        var v = el.getAttribute("data-row-key");
        // Un `data-row-key` purement numerique et long EST vraisemblablement
        // l identifiant. Court, c est un indice de ligne : le prendre pour un
        // identifiant ferait afficher les chiffres de la premiere campagne sur
        // toutes les lignes.
        return v && /^\d{10,}$/.test(v) ? v : null;
      }
    },
    {
      methode: "lien",
      trouver: function (el) {
        var liens = el.querySelectorAll("a[href]");
        for (var i = 0; i < liens.length; i++) {
          var m = /[?&](?:campaign_id|adgroup_id|ad_id)=(\d{8,})/.exec(
            liens[i].getAttribute("href") || ""
          );
          if (m) return m[1];
        }
        return null;
      }
    }
  ];

  function normaliserId(brut) {
    if (!brut) return null;
    var m = /(\d{8,})/.exec(String(brut));
    return m ? m[1] : null;
  }

  function nomDeLigne(el) {
    var cellules = el.querySelectorAll(selecteurs.cellule.join(","));
    for (var i = 0; i < cellules.length; i++) {
      var t = (cellules[i].innerText || "").trim();
      if (t.length > 2 && !/^[\d\s.,%€$-]+$/.test(t)) return t.split("\n")[0].trim();
    }
    return (el.innerText || "").trim().split("\n")[0].trim();
  }

  var reseau = {
    urlInteressante: function (url) {
      return url.indexOf("/api/v") !== -1 || url.indexOf("/open_api/") !== -1;
    },
    prefixesAJeter: [],
    lignesJson: false,
    tailleMax: 4000000,
    estEntite: function (o) {
      // TikTok rend du JSON REST lisible, avec des noms de champ explicites.
      // C est le cas le plus simple des trois.
      var paires = [
        ["campaign_id", "campaign_name", "campagne"],
        ["adgroup_id", "adgroup_name", "adset"],
        ["ad_id", "ad_name", "pub"]
      ];
      for (var i = 0; i < paires.length; i++) {
        var id = o[paires[i][0]];
        var nom = o[paires[i][1]];
        if (id && nom && typeof nom === "string") {
          var n = normaliserId(id);
          if (n) return { id: n, nom: nom, niveau: paires[i][2] };
        }
      }
      return null;
    }
  };

  root.IMPULSION_TIKTOK = {
    cle: "tiktok",
    label: "TikTok Ads",
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
    identifiants: identifiants,
    normaliserId: normaliserId,
    nomDeLigne: nomDeLigne,
    reseau: reseau,
    /** Message affiche tant que le CRM ne connait aucun compte TikTok. */
    inactifSansConnecteur:
      "Aucun serveur ne synchronise encore TikTok : ni référentiel de campagnes, " +
      "ni dépense. Les colonnes resteront vides tant qu’il n’existe pas.",
    aide:
      "Vérifiez d’abord si data-row-key porte l’identifiant de l’entité ou un " +
      "simple indice de ligne : c’est ce qui décide de tout l’adaptateur."
  };
})(typeof self !== "undefined" ? self : window);
