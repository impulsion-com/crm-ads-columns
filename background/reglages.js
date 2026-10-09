// Preferences de l extension.
//
// `chrome.storage.local` et JAMAIS `sync`. La cle d API est ici : `sync` la
// recopierait chez Google et la diffuserait vers tous les profils Chrome de
// l utilisateur, y compris ceux d une machine partagee. Le gain (retrouver ses
// reglages ailleurs) ne vaut pas ce prix pour un secret.
//
// Les DONNEES, elles, ne passent jamais par `local` : quota de 10 Mo, et le
// depassement est SILENCIEUX. Elles vivent en `storage.session`, qui meurt avec
// le navigateur, ce qui est exactement ce qu on veut d un cache.

(function (root) {
  "use strict";

  var CLE = "reglages";

  var DEFAUTS = {
    /** Version du schema de reglages. Une preference renommee plus tard doit
     *  pouvoir etre migree, pas perdue en silence. */
    version: 1,
    /** Adresse du serveur : une instance Agence OS, ou le CRM d Impulsion.
     *  Vide a l installation, la permission d hote se demande a la saisie. */
    crmUrl: "",
    cleApi: "",
    modele: "first_paid_click",
    fenetre: 90,
    /** Colonnes visibles PAR NIVEAU : au niveau campagne on regarde l argent,
     *  au niveau publicite on regarde la crea. Ce ne sont pas les memes.
     *  Vide = on prend celles que l API annonce « par defaut ». */
    colonnes: { campagne: [], adset: [], pub: [] },
    theme: "auto",
    largeurRail: 560,
    /** Le nom de l entite dans chaque ligne du rail. Actif par defaut, et il
     *  faut y reflechir avant de le couper : c est LUI qui rend visible un
     *  desalignement, sans quoi le bon chiffre en face de la mauvaise ligne
     *  passerait inapercu. */
    afficherNomControle: true,
    diagnostic: false
  };

  function migrer(brut) {
    var r = Object.assign({}, DEFAUTS, brut || {});
    // Les objets imbriques ne se fusionnent pas tout seuls.
    r.colonnes = Object.assign({}, DEFAUTS.colonnes, (brut && brut.colonnes) || {});
    r.version = DEFAUTS.version;
    return r;
  }

  function lire() {
    return chrome.storage.local.get(CLE).then(function (o) {
      return migrer(o && o[CLE]);
    });
  }

  function ecrire(partiel) {
    return lire().then(function (actuels) {
      var neufs = migrer(Object.assign({}, actuels, partiel));
      return chrome.storage.local.set({ reglages: neufs }).then(function () {
        return neufs;
      });
    });
  }

  root.IMPULSION_REGLAGES = { DEFAUTS: DEFAUTS, CLE: CLE, lire: lire, ecrire: ecrire };
})(typeof self !== "undefined" ? self : window);
