// Point d entree de l extension.
//
// Il fait trois choses : enregistrer les scripts de contenu quand la permission
// d une plateforme est accordee, porter la cle d API, et parler au CRM. Rien
// d autre ne sort d ici.

"use strict";

importScripts(
  "../shared/journal.js",
  "../shared/format.js",
  "../shared/palette.js",
  // Les adaptateurs sont PURS (aucun chrome.*, aucun DOM a l evaluation) :
  // le service worker peut les charger pour recuperer leurs fonctions de
  // marquage autonomes, a passer a executeScript.
  "../plateformes/meta.js",
  "../plateformes/google.js",
  "../plateformes/tiktok.js",
  "./reglages.js",
  "./api-crm.js",
  "./cache.js"
);

var J = self.IMPULSION_JOURNAL;
var API = self.IMPULSION_API;
var CACHE = self.IMPULSION_CACHE;
var REGLAGES = self.IMPULSION_REGLAGES;

// ── Les plateformes ─────────────────────────────────────────────────────────
//
// `origines` est ce qu on demande a l utilisateur, `motifs` est ou l on
// s execute reellement.
//
// PIEGE DE MATCH PATTERN : `chrome.permissions.request` IGNORE le chemin.
// Demander https://www.facebook.com/adsmanager/* accorde en realite
// https://www.facebook.com/*, et Chrome l annoncera ainsi a l utilisateur.
// Autant l ecrire honnetement dans le manifeste et dans le texte du popup.
// L enregistrement du script, lui, reste borne au chemin : on ne s execute pas
// sur le fil d actualite.

var PLATEFORMES = {
  meta: {
    label: "Meta Ads Manager",
    origines: [
      "https://adsmanager.facebook.com/*",
      "https://business.facebook.com/*",
      "https://www.facebook.com/*"
    ],
    motifs: [
      "https://adsmanager.facebook.com/*",
      "https://business.facebook.com/*",
      "https://www.facebook.com/adsmanager*"
    ],
    fichier: "plateformes/meta.js"
  },
  google: {
    label: "Google Ads",
    origines: ["https://ads.google.com/*"],
    motifs: ["https://ads.google.com/aw/*"],
    fichier: "plateformes/google.js"
  },
  tiktok: {
    label: "TikTok Ads Manager",
    origines: ["https://ads.tiktok.com/*"],
    motifs: ["https://ads.tiktok.com/i18n/*"],
    fichier: "plateformes/tiktok.js"
  }
};

var COMMUNS = [
  "shared/journal.js",
  "shared/format.js",
  "shared/palette.js",
  "shared/icons.js"
];

// L ordre est celui des dependances, et il n est pas negociable : chaque
// module se pose sur `window` et le suivant y lit. `orchestrateur.js` est
// toujours dernier, il les appelle tous.
var ISOLE = [
  "content/pont.js",
  "content/lignes.js",
  "content/panneau.js",
  "content/rendu-natif.js",
  "content/entete.js",
  "content/tiroir.js",
  "content/diagnostic.js",
  "content/orchestrateur.js"
];

function idsDe(cle) {
  return ["impulsion-" + cle + "-isole", "impulsion-" + cle + "-page"];
}

async function enregistrer(cle) {
  var p = PLATEFORMES[cle];

  // IDEMPOTENT PAR CONSTRUCTION : on retire d abord, on pose ensuite.
  //
  // Deux raisons, et la seconde est la plus vicieuse.
  //
  // 1. `registerContentScripts` jette « Duplicate script ID » si l identifiant
  //    existe deja. Comme `reconcilier()` peut etre appelee par quatre
  //    evenements, un enregistrement concurrent suffit a la faire echouer.
  // 2. `persistAcrossSessions: true` fait SURVIVRE l enregistrement, avec sa
  //    LISTE DE FICHIERS D ORIGINE. Recharger l extension apres avoir ajoute un
  //    fichier laisse donc tourner l ancienne liste : le nouveau module n est
  //    jamais charge, et l on cherche l erreur dans son code alors qu il n a
  //    simplement jamais ete injecte. Retirer avant de poser garantit que ce
  //    qui tourne est ce qui est ecrit ici.
  await desenregistrer(cle);

  var entrees = [
    {
      // L ORDRE COMPTE, et il a deja coute une demi-journee sur l autre
      // extension maison. `pont.js` installe l ecouteur de postMessage.
      // Enregistre APRES `reseau.js`, les premieres reponses de la page, qui
      // arrivent dans les 200 ms, tombent dans le vide : le panneau parait
      // fonctionner puisque les lignes sont trouvees, mais aucune n est
      // identifiee, et l on cherche le defaut ailleurs pendant longtemps.
      id: idsDe(cle)[0],
      matches: p.motifs,
      js: COMMUNS.concat([p.fichier, "plateformes/registre.js"]).concat(ISOLE),
      // Le CSS passe par le champ `css` du registre et NON par une balise
      // <style> posee dans la page : une feuille injectee par `scripting`
      // echappe a la CSP de la page, alors qu une balise <style> y est soumise
      // pour ses sous-ressources. La CSP de facebook.com bloquerait le
      // chargement des .woff2. On n y met donc que les @font-face, le reste
      // vit dans le shadow root.
      css: ["content/polices.css"],
      runAt: "document_start",
      // `allFrames: true`, et c est le correctif du 26 aout au soir : Ads
      // Manager est souvent rendu dans un IFRAME interne (business.facebook.com
      // charge adsmanager.facebook.com dans un cadre). Avec `false`, les
      // scripts tournaient dans le document PARENT, ou le tableau n existe
      // pas : zero ligne, zero donnee, rail flottant en haut de l ecran, et
      // aucun selecteur au monde n y pouvait rien. Les `matches` bornent
      // l injection aux cadres dont l URL est celle d Ads Manager, et
      // l orchestrateur s abstient dans un parent qui contient un cadre
      // adsmanager : un seul exemplaire tourne, le bon.
      allFrames: true,
      persistAcrossSessions: true
    },
    {
      id: idsDe(cle)[1],
      matches: p.motifs,
      js: [p.fichier, "plateformes/registre.js", "content/reseau.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      persistAcrossSessions: true
    }
  ];

  try {
    await chrome.scripting.registerContentScripts(entrees);
  } catch (e) {
    // Un « Duplicate script ID » ici veut dire qu un enregistrement persiste a
    // echappe au retrait. On nettoie une seconde fois, id par id, et l on
    // repose UNE fois. Si ca echoue encore, l erreur remonte a reconcilier(),
    // qui la journalise : s acharner en boucle est pire qu echouer visiblement.
    await desenregistrer(cle);
    await chrome.scripting.registerContentScripts(entrees);
  }
  if (J) J.dire("scripts enregistrés pour", cle);
}

async function desenregistrer(cle) {
  var voulus = idsDe(cle);
  var presents = voulus;
  try {
    var courants = await chrome.scripting.getRegisteredContentScripts();
    var ids = courants.map(function (s) {
      return s.id;
    });
    presents = voulus.filter(function (id) {
      return ids.indexOf(id) !== -1;
    });
  } catch (e) {
    /* la liste est illisible : on tentera les deux */
  }

  // UN PAR UN, et c est le coeur du correctif du 26 aout. Passer a
  // `unregisterContentScripts` une liste dont UN SEUL id n existe pas fait
  // echouer l appel ENTIER (« Nonexistent script ID ») et Chrome ne retire
  // alors RIEN, pas meme ceux qui existent.
  //
  // Avec un etat a moitie enregistre, persiste d une session precedente
  // (l isole present, le MAIN absent), l ancien code ne nettoyait donc JAMAIS :
  // le retrait echouait en silence dans son catch, la pose butait sur
  // « Duplicate script ID », et la boucle etait eternelle. C est l erreur qui
  // revenait a chaque rechargement.
  for (var i = 0; i < presents.length; i++) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [presents[i]] });
    } catch (e) {
      /* deja absent */
    }
  }
}

/** Version des scripts actuellement enregistres. Comparee a celle du manifeste
 *  pour savoir s il faut reposer les enregistrements persistes. */
var CLE_VERSION_SCRIPTS = "versionScriptsEnregistres";

async function reconcilierVraiment() {
  var manifeste = chrome.runtime.getManifest();
  var versionCourante = manifeste.version;

  var range = {};
  try {
    range = await chrome.storage.local.get(CLE_VERSION_SCRIPTS);
  } catch (e) {
    range = {};
  }
  // Une version differente veut dire que les fichiers ont pu changer, et les
  // enregistrements persistes portent encore l ANCIENNE liste.
  var forcer = range[CLE_VERSION_SCRIPTS] !== versionCourante;

  if (forcer) {
    // Table rase. Les enregistrements persistes portent la liste de fichiers
    // d une AUTRE version de l extension. Sans argument, l appel retire TOUS
    // les scripts dynamiques de cette extension, et de personne d autre :
    // c est exactement la portee qu on veut a un changement de version, et ca
    // ne peut pas echouer sur un id fantome puisqu il n y a pas de liste.
    try {
      await chrome.scripting.unregisterContentScripts();
    } catch (e) {
      /* rien a retirer */
    }
    // ET LE CACHE AUSSI, lecon du 27 aout : `storage.session` survit au
    // rechargement de l extension (il est lie a la session du NAVIGATEUR).
    // Apres une mise a jour, les vieilles reponses continuaient d etre servies
    // en perime-tolere, et un correctif du CRM restait invisible a l ecran
    // (« non synchronisee » sur des pubs que le serveur connaissait tres
    // bien). Une nouvelle version repart sur un cache vide.
    try {
      await CACHE.vider();
    } catch (e) {
      /* rien */
    }
  }

  var enregistres = [];
  try {
    enregistres = await chrome.scripting.getRegisteredContentScripts();
  } catch (e) {
    /* premiere fois */
  }
  var presents = new Set(
    enregistres.map(function (s) {
      return s.id;
    })
  );

  for (var cle in PLATEFORMES) {
    var accorde = false;
    try {
      accorde = await chrome.permissions.contains({ origins: PLATEFORMES[cle].origines });
    } catch (e) {
      accorde = false;
    }
    var ids = idsDe(cle);
    // Les DEUX mondes doivent etre la. Un seul des deux enregistre est un etat
    // casse : le pont sans l interception, ou l inverse.
    var complet = presents.has(ids[0]) && presents.has(ids[1]);

    if (accorde && (!complet || forcer)) {
      await enregistrer(cle);
    } else if (!accorde && (presents.has(ids[0]) || presents.has(ids[1]))) {
      await desenregistrer(cle);
    }
  }

  try {
    var maj = {};
    maj[CLE_VERSION_SCRIPTS] = versionCourante;
    await chrome.storage.local.set(maj);
  } catch (e) {
    /* rien */
  }
}

/**
 * Aligne l etat reel des scripts sur les permissions accordees.
 *
 * Point d entree UNIQUE, branche sur les quatre evenements qui peuvent changer
 * cet etat. Un enregistrement dissemine dans quatre gestionnaires finit
 * toujours par diverger de la realite dans un des quatre.
 *
 * SERIALISEE, et ce n est pas une precaution theorique. Au rechargement de
 * l extension, `onInstalled` se declenche pendant que l appel de fin de fichier
 * tourne deja : les deux lisent `getRegisteredContentScripts()` avant que l un
 * ou l autre n ait enregistre, concluent tous les deux « il n y a rien », et le
 * second echoue sur « Duplicate script ID 'impulsion-meta-isole' ».
 *
 * Une file d une seule voie coute une ligne et supprime toute la classe de
 * course. Les appels s empilent au lieu de se croiser.
 */
var file = Promise.resolve();

function reconcilier() {
  file = file.then(reconcilierVraiment).catch(function (e) {
    // La console du service worker est celle de l EXTENSION, pas celle de la
    // page : on peut y parler sans polluer Ads Manager. Et il le faut : une
    // erreur d enregistrement avalee par le journal silencieux, c est une
    // extension qui ne s injecte plus sans que rien ne le dise nulle part.
    console.error("[colonnes-crm] reconciliation :", e && e.message ? e.message : e);
    if (J) J.erreur("reconciliation", e && e.message);
  });
  return file;
}

chrome.runtime.onStartup.addListener(reconcilier);
chrome.runtime.onInstalled.addListener(reconcilier);
chrome.permissions.onAdded.addListener(reconcilier);
chrome.permissions.onRemoved.addListener(reconcilier);

// ── L interrupteur maitre ───────────────────────────────────────────────────
//
// Couper l affichage partout, immediatement, sans passer par
// chrome://extensions. L etat vit dans SA PROPRE cle de stockage (`actif`),
// hors de l objet des reglages, et ce n est pas du rangement : les scripts de
// contenu ecoutent `chrome.storage.onChanged` pour reagir sans rechargement.
// Sur la cle des reglages, l evenement transporterait l objet ENTIER, cle
// d API comprise, jusque dans le processus de la page. Sur une cle a part, il
// ne transporte qu un booleen.

var PALETTE = self.IMPULSION_PALETTE;

function majBadge() {
  chrome.storage.local
    .get("actif")
    .then(function (o) {
      var coupe = o && o.actif === false;
      if (!chrome.action || !chrome.action.setBadgeText) return;
      chrome.action.setBadgeText({ text: coupe ? "off" : "" });
      if (coupe && chrome.action.setBadgeBackgroundColor) {
        chrome.action.setBadgeBackgroundColor({ color: PALETTE.ochre });
      }
    })
    .catch(function () {});
}

chrome.storage.onChanged.addListener(function (changes, zone) {
  if (zone === "local" && changes.actif) majBadge();
});

majBadge();

// ── Deduplication des requetes ──────────────────────────────────────────────
//
// Une seule requete en vol par cle. Deux onglets Ads Manager ouverts sur le
// meme compte partagent la promesse au lieu de faire travailler le CRM deux
// fois pour le meme resultat.

var enVol = new Map();
var dernierMarquage = new Map();

function unSeulEnVol(cle, produire) {
  if (enVol.has(cle)) return enVol.get(cle);
  var p = produire().finally(function () {
    enVol.delete(cle);
  });
  enVol.set(cle, p);
  return p;
}

// ── Le routeur de messages ──────────────────────────────────────────────────

var ROUTES = {
  ping: function (msg, reglages) {
    return API.ping(msg.reglagesTest || reglages, msg.params);
  },

  metrics: function (msg, reglages) {
    var p = Object.assign({}, msg.params, {
      modele: msg.params.modele || reglages.modele,
      fenetre: msg.params.fenetre || reglages.fenetre
    });
    var cleCache = {
      crmUrl: reglages.crmUrl,
      plateforme: p.plateforme,
      compte: p.compte,
      niveau: p.niveau,
      du: p.du,
      au: p.au,
      modele: p.modele,
      fenetre: p.fenetre
    };
    return CACHE.avec(cleCache, function () {
      return unSeulEnVol("metrics|" + CACHE.cle(cleCache), function () {
        return API.metrics(reglages, p);
      });
    }).then(function (r) {
      r.valeur.__perimee = r.perimee;
      return r.valeur;
    });
  },

  index: function (msg, reglages) {
    var cleCache = {
      crmUrl: reglages.crmUrl,
      plateforme: msg.params.plateforme,
      // Un index par compte : deux annonceurs n ont pas le meme referentiel.
      compte: "index|" + (msg.params.compte || ""),
      niveau: msg.params.niveau || "tout",
      du: "-",
      au: "-",
      modele: "-",
      fenetre: "-"
    };
    return CACHE.avec(cleCache, function () {
      return unSeulEnVol("index|" + CACHE.cle(cleCache), function () {
        return API.index(reglages, msg.params);
      });
    }).then(function (r) {
      return r.valeur;
    });
  },

  // Les listes de prospects restent EN MEMOIRE DE REQUETE seulement :
  // volumineuses, peu reutilisees, elles n ont rien a faire dans `session`.
  prospects: function (msg, reglages) {
    var p = Object.assign({}, msg.params, {
      modele: msg.params.modele || reglages.modele,
      fenetre: msg.params.fenetre || reglages.fenetre
    });
    return API.prospects(reglages, p);
  },

  /**
   * Les reglages.
   *
   * LA CLE D API EST RETIREE pour tout appelant qui vit dans un onglet.
   *
   * Un script de contenu tourne dans un monde isole, mais dans le PROCESSUS de
   * la page : il n a aucun besoin du secret, il ne fait jamais d appel HTTP
   * lui-meme, et l y envoyer serait le promener dans un contexte hostile pour
   * rien. Le popup, lui, n a pas d onglet et doit pouvoir afficher et modifier
   * la cle.
   *
   * C est `expediteur.tab` qui departage, et c est fiable : le service worker
   * le renseigne lui-meme, une page ne peut pas le falsifier.
   */
  reglages: function (msg, reglages, expediteur) {
    if (expediteur && expediteur.tab) {
      var sansSecret = Object.assign({}, reglages);
      delete sansSecret.cleApi;
      sansSecret.cleApiPresente = Boolean(reglages.cleApi);
      return Promise.resolve(sansSecret);
    }
    return Promise.resolve(reglages);
  },

  enregistrerReglages: function (msg) {
    return REGLAGES.ecrire(msg.reglages).then(function (r) {
      // Un changement de modele ou de periode change la cle de cache, donc rien
      // a purger. Un changement d URL de CRM, si : les anciennes entrees
      // porteraient les chiffres d une autre instance.
      if (msg.reglages && msg.reglages.crmUrl) return CACHE.vider().then(function () {
        return r;
      });
      return r;
    });
  },

  viderCache: function () {
    return CACHE.vider().then(function () {
      return { ok: true };
    });
  },

  /**
   * Marquer les lignes du tableau de l expediteur, dans le monde MAIN.
   *
   * POURQUOI PAR ICI ET PAS PAR L INSCRIPTION MAIN. Les deux existent. Mais
   * sur le DOM reel, les globals poses par l inscription disparaissaient sans
   * exception ni trace ; `executeScript` marche a tous les coups et rend ses
   * erreurs a l appelant. La fonction voyage SERIALISEE : elle vit dans
   * l adaptateur, autonome, sans fermeture.
   *
   * Throttle par onglet : le tableau se re-rend sans arret, marquer plus
   * d une fois par 700 ms n apporte rien.
   */
  marquer: function (msg, reglages, expediteur) {
    if (!expediteur || !expediteur.tab) {
      return Promise.resolve({ lignes: 0, marquees: 0, refus: "pas d’onglet" });
    }
    var adaptateurs = {
      meta: self.IMPULSION_META,
      google: self.IMPULSION_GOOGLE,
      tiktok: self.IMPULSION_TIKTOK
    };
    var a = adaptateurs[msg.plateforme];
    if (!a || typeof a.marquerLignes !== "function") {
      return Promise.resolve({ lignes: 0, marquees: 0, refus: "pas de marqueur" });
    }
    var cleThrottle = expediteur.tab.id + ":" + (expediteur.frameId || 0);
    var maintenant = Date.now();
    var dernier = dernierMarquage.get(cleThrottle) || 0;
    if (maintenant - dernier < 700) {
      return Promise.resolve({ lignes: -1, marquees: -1, throttle: true });
    }
    dernierMarquage.set(cleThrottle, maintenant);
    return chrome.scripting
      .executeScript({
        target: {
          tabId: expediteur.tab.id,
          frameIds: [expediteur.frameId || 0]
        },
        world: "MAIN",
        func: a.marquerLignes
      })
      .then(function (resultats) {
        return (resultats && resultats[0] && resultats[0].result) || { lignes: 0, marquees: 0 };
      });
  },

  plateformes: function () {
    var sortie = [];
    var taches = Object.keys(PLATEFORMES).map(function (cle) {
      return chrome.permissions
        .contains({ origins: PLATEFORMES[cle].origines })
        .catch(function () {
          return false;
        })
        .then(function (accorde) {
          sortie.push({
            cle: cle,
            label: PLATEFORMES[cle].label,
            origines: PLATEFORMES[cle].origines,
            accorde: accorde
          });
        });
    });
    return Promise.all(taches).then(function () {
      var ordre = Object.keys(PLATEFORMES);
      sortie.sort(function (a, b) {
        return ordre.indexOf(a.cle) - ordre.indexOf(b.cle);
      });
      return sortie;
    });
  }
};

chrome.runtime.onMessage.addListener(function (msg, expediteur, repondre) {
  var route = msg && ROUTES[msg.type];
  if (!route) return false;

  REGLAGES.lire()
    .then(function (reglages) {
      return route(msg, reglages, expediteur);
    })
    .then(function (donnees) {
      repondre({ ok: true, donnees: donnees });
    })
    .catch(function (err) {
      if (J) J.erreur(msg.type, err && err.message);
      repondre({
        ok: false,
        erreur: {
          code: (err && err.code) || "inattendu",
          message: (err && err.message) || String(err),
          statut: (err && err.statut) || 0
        }
      });
    });

  // `true` garde le canal ouvert pour la reponse asynchrone. Sans lui, la
  // promesse se resout dans le vide et l appelant attend indefiniment.
  return true;
});

reconcilier();
