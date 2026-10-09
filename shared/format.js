// Ecrire un nombre a la francaise.
//
// PORTAGE DELIBERE de src/components/attribution/campagnes-format.ts du CRM.
// Le catalogue des colonnes, lui, n est PAS recopie : il vient de l API, ce qui
// fait qu une colonne ajoutee au CRM apparait ici sans qu on touche a
// l extension. Seules ces six fonctions vivent des deux cotes, parce qu elles
// doivent tourner sans reseau.
//
// Si le CRM change une regle d arrondi, elle doit changer ici aussi : deux
// endroits qui formatent les memes euros finissent par ne plus les arrondir
// pareil, et un ecart de recette se met a dependre de qui arrondit.

(function (root) {
  "use strict";

  /** Cellule sans valeur.
   *
   *  `ratio()` du CRM rend `null` plutot que l infini, et c est delibere : un
   *  CAC sur zero vente n est pas « infini » et n est pas « 0 », il n existe
   *  pas. Un zero affiche la se lirait comme une acquisition gratuite. */
  var VIDE = "-";

  var EUROS_RONDS = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  });
  var EUROS_FINS = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  var ENTIERS = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var UNE_DECIMALE = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  var POURCENTS = new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: 1
  });
  var POURCENTS_SIGNES = new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero"
  });

  /** Un montant. Sous dix euros on garde les centimes : un CPC de 0,79 EUR
   *  arrondi a l euro afficherait « 1 € » et rendrait la colonne inutilisable. */
  function euros(v) {
    if (v === null || v === undefined) return VIDE;
    return Math.abs(v) < 10 && v !== 0 ? EUROS_FINS.format(v) : EUROS_RONDS.format(v);
  }

  /** Un compte.
   *
   *  ATTENTION, ce ne sont PAS toujours des entiers. `leads`, `ventes` et
   *  consorts sont des sommes de POIDS d attribution : sous un modele lineaire
   *  une vente vaut 0,4 sur une ligne et 0,6 sur une autre. Arrondir sans
   *  regarder afficherait « 0 vente » en face de 4 500 EUR de chiffre
   *  d affaires, sur la ligne meme qui a produit la vente. */
  function nombre(v) {
    if (v === null || v === undefined) return VIDE;
    return Number.isInteger(v) ? ENTIERS.format(v) : UNE_DECIMALE.format(v);
  }

  /** Un taux, recu entre 0 et 1. */
  function pourcentage(v) {
    return v === null || v === undefined ? VIDE : POURCENTS.format(v);
  }

  /** Un ecart relatif, avec son signe : le sens compte autant que l ampleur. */
  function ecart(v) {
    return v === null || v === undefined ? VIDE : POURCENTS_SIGNES.format(v);
  }

  /** Un ROAS. « 5,6x » se lit d un coup d oeil, « 560 % » demande une
   *  conversion mentale. */
  function multiple(v) {
    return v === null || v === undefined ? VIDE : UNE_DECIMALE.format(v) + "x";
  }

  function jours(v) {
    if (v === null || v === undefined) return VIDE;
    return (Number.isInteger(v) ? ENTIERS.format(v) : UNE_DECIMALE.format(v)) + " j";
  }

  /** Le format demande par le catalogue de l API. Les noms sont ceux de
   *  `FormatColonne` cote CRM : un format inconnu rend la valeur brute plutot
   *  que de casser la ligne entiere. */
  function formater(format, valeur) {
    switch (format) {
      case "euros":
        return euros(valeur);
      case "nombre":
        return nombre(valeur);
      case "pourcentage":
        return pourcentage(valeur);
      case "multiple":
        return multiple(valeur);
      case "jours":
        return jours(valeur);
      case "ecart":
        return ecart(valeur);
      default:
        return valeur === null || valeur === undefined ? VIDE : String(valeur);
    }
  }

  /** Une date « AAAA-MM-JJ » en francais court. */
  function jourCourt(iso) {
    if (!iso) return VIDE;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var MOIS = [
      "janv.", "fevr.", "mars", "avr.", "mai", "juin",
      "juil.", "aout", "sept.", "oct.", "nov.", "dec."
    ];
    return Number(m[3]) + " " + MOIS[Number(m[2]) - 1];
  }

  /** Normalisation d un nom, pour le rapprochement de dernier recours.
   *
   *  Les accents sont CONSERVES : deux campagnes qui ne different que par un
   *  accent sont deux campagnes. On retire en revanche les espaces insecables
   *  et les marques de direction que Meta glisse dans ses <span dir="auto">,
   *  invisibles a l oeil et fatales a une comparaison de chaines. */
  function normaliserNom(s) {
    if (!s) return "";
    return String(s)
      .replace(/[‎‏‪-‮⁦-⁩]/g, "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  var MOIS_FR = {
    janv: 1, jan: 1, janvier: 1,
    "f\u00e9vr": 2, fevr: 2, fev: 2, "f\u00e9vrier": 2, fevrier: 2,
    mars: 3,
    avr: 4, avril: 4,
    mai: 5,
    juin: 6,
    juil: 7, juillet: 7,
    "ao\u00fbt": 8, aout: 8,
    sept: 9, septembre: 9,
    oct: 10, octobre: 10,
    nov: 11, novembre: 11,
    "d\u00e9c": 12, dec: 12, "d\u00e9cembre": 12, decembre: 12
  };

  function deuxChiffres(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /**
   * Lit une plage de dates ecrite en francais, comme les selecteurs de dates
   * l affichent : « 1 aout 2026 - 24 aout 2026 », parfois precedee d un
   * prereglage (« Ce mois-ci : ... »), parfois sans repeter l annee.
   *
   * Partagee entre les adaptateurs : Meta, Google et TikTok affichent tous
   * leur plage dans un bouton, et c est souvent une source plus fraiche que
   * l URL, qui peut porter la plage d une session precedente.
   *
   * Rend null plutot que de deviner quand le format ne correspond a rien de
   * connu : une periode fausse est pire qu une periode absente, parce qu elle
   * produit des chiffres qui ont l air bons.
   */
  function lirePlageFrancaise(texte) {
    if (!texte) return null;
    var t = String(texte).replace(/\u00a0/g, " ").trim();
    // verifier: tiret-cadratin-autorise. Le cadratin est ici une DONNEE a
    // reconnaitre, pas du texte produit : les plateformes ecrivent leurs
    // plages de dates avec.
    var re =
      /(\d{1,2})\s+([a-zA-Z\u00e9\u00e8\u00ea\u00fb\u00f4\u00e0]+)\.?\s*(\d{4})?\s*[\u2013\-\u2014]\s*(\d{1,2})\s+([a-zA-Z\u00e9\u00e8\u00ea\u00fb\u00f4\u00e0]+)\.?\s*(\d{4})?/;
    var m = re.exec(t);
    if (!m) return null;
    var moisA = MOIS_FR[m[2].toLowerCase().replace(/\.$/, "")];
    var moisB = MOIS_FR[m[5].toLowerCase().replace(/\.$/, "")];
    if (!moisA || !moisB) return null;
    var anneeB = m[6] || m[3];
    var anneeA = m[3] || anneeB;
    if (!anneeA || !anneeB) return null;
    return {
      du: anneeA + "-" + deuxChiffres(moisA) + "-" + deuxChiffres(Number(m[1])),
      au: anneeB + "-" + deuxChiffres(moisB) + "-" + deuxChiffres(Number(m[4])),
      source: "selecteur"
    };
  }

  root.IMPULSION_FORMAT = {
    VIDE: VIDE,
    euros: euros,
    nombre: nombre,
    pourcentage: pourcentage,
    ecart: ecart,
    multiple: multiple,
    jours: jours,
    formater: formater,
    jourCourt: jourCourt,
    normaliserNom: normaliserNom,
    lirePlageFrancaise: lirePlageFrancaise
  };
})(typeof self !== "undefined" ? self : window);
