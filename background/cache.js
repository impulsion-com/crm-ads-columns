// Cache des reponses du CRM.
//
// LA DECISION QUI REGLE LE PROBLEME AVANT QU IL SE POSE : l unite de
// recuperation est le NIVEAU, pas la ligne. Une requete rend le dictionnaire
// complet des campagnes (ou des adsets, ou des pubs) pour la periode. Le
// defilement ne coute alors strictement rien, puisqu il ne declenche aucune
// requete. C est plus simple ET plus rapide qu un lot par fenetre visible, et
// ca supprime d un coup la question du martelement.
//
// Deux etages :
//   L1, une Map dans le service worker, instantanee ;
//   L2, un miroir dans chrome.storage.session, parce que le service worker MV3
//       MEURT apres trente secondes d inactivite. Sans ce miroir, chaque reveil
//       repartirait de zero et l utilisateur verrait un chargement complet en
//       revenant sur son onglet.
//
// JAMAIS storage.local pour des donnees : quota 10 Mo, et le depassement est
// silencieux. `session` meurt avec le navigateur, ce qui est exactement ce
// qu on veut.

(function (root) {
  "use strict";

  var J = root.IMPULSION_JOURNAL;
  var memoire = new Map();
  var MAX_ENTREES = 12;
  var PREFIXE = "cache:";

  /** Une entree perimee reste servie pendant dix fois son TTL, le temps que la
   *  revalidation revienne. Au-dela, elle est morte : mieux vaut un chargement
   *  visible qu un chiffre d il y a deux jours. */
  var FACTEUR_DUR = 10;

  /**
   * Duree de vie, selon l anciennete de la periode demandee.
   *
   * Une periode qui touche aujourd hui bouge encore. Une periode close depuis
   * une semaine ne bougera plus, sauf recalcul d attribution.
   */
  function ttlMs(jourFin) {
    var aujourdhui = new Date().toISOString().slice(0, 10);
    if (!jourFin || jourFin >= aujourdhui) return 5 * 60 * 1000;
    var ecart = (Date.parse(aujourdhui) - Date.parse(jourFin)) / 86400000;
    if (ecart <= 3) return 30 * 60 * 1000;
    return 12 * 60 * 60 * 1000;
  }

  /** La cle ne contient DELIBEREMENT aucune notion de lignes visibles : c est
   *  ce qui rend le defilement gratuit. */
  function cle(p) {
    return [
      p.crmUrl,
      p.plateforme,
      p.compte || "-",
      p.niveau,
      p.du,
      p.au,
      p.modele,
      p.fenetre
    ].join("|");
  }

  function ranger(k, valeur, finPeriode) {
    var e = { valeur: valeur, posee: Date.now(), ttl: ttlMs(finPeriode) };
    memoire.set(k, e);
    if (memoire.size > MAX_ENTREES) {
      var plusVieille = null;
      var quand = Infinity;
      memoire.forEach(function (v, cleCourante) {
        if (v.posee < quand) {
          quand = v.posee;
          plusVieille = cleCourante;
        }
      });
      if (plusVieille && plusVieille !== k) memoire.delete(plusVieille);
    }
    // Le miroir peut echouer (quota, session fermee) sans que ce soit grave :
    // on perd un reveil rapide, pas une donnee.
    try {
      var o = {};
      o[PREFIXE + k] = e;
      chrome.storage.session.set(o).catch(function () {});
    } catch (err) {
      /* rien */
    }
  }

  function relire(k) {
    if (memoire.has(k)) return Promise.resolve(memoire.get(k));
    return chrome.storage.session
      .get(PREFIXE + k)
      .then(function (o) {
        var e = o && o[PREFIXE + k];
        if (e) memoire.set(k, e);
        return e || null;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Sert la valeur, en revalidant en arriere-plan si elle a vieilli.
   *
   * `perimee` dit a l appelant d afficher un liseré d actualisation plutot
   * qu un ecran de chargement : le rail garde ses chiffres pendant que la
   * requete part, et se met a jour sans clignoter.
   */
  function avec(p, produire) {
    var k = cle(p);
    return relire(k).then(function (e) {
      var maintenant = Date.now();
      if (e) {
        var age = maintenant - e.posee;
        if (age < e.ttl) {
          return { valeur: e.valeur, perimee: false, age: age };
        }
        if (age < e.ttl * FACTEUR_DUR) {
          // Perimee mais servable : on rend tout de suite, on revalide derriere.
          produire()
            .then(function (v) {
              ranger(k, v, p.au);
            })
            .catch(function (err) {
              if (J) J.erreur("revalidation", err && err.message);
            });
          return { valeur: e.valeur, perimee: true, age: age };
        }
      }
      return produire().then(function (v) {
        ranger(k, v, p.au);
        return { valeur: v, perimee: false, age: 0 };
      });
    });
  }

  function vider() {
    memoire.clear();
    return chrome.storage.session.get(null).then(function (tout) {
      var aJeter = Object.keys(tout || {}).filter(function (k) {
        return k.indexOf(PREFIXE) === 0;
      });
      return aJeter.length ? chrome.storage.session.remove(aJeter) : null;
    });
  }

  root.IMPULSION_CACHE = { avec: avec, vider: vider, cle: cle, ttlMs: ttlMs };
})(typeof self !== "undefined" ? self : window);
