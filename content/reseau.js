// Interception des appels que la page fait pour son propre compte.
//
// MONDE MAIN. C est la seule facon d obtenir le CORPS des reponses :
// `chrome.webRequest` ne le donne pas en MV3, il ne donne que les en-tetes.
//
// TROIS PIEGES TUENT NAIVEMENT CETTE TECHNIQUE, et les trois sont traites ici :
//
//   1. Alterer la promesse rendue a l application. Rendre `promesse.then(...)`
//      au lieu de la promesse d origine ajoute un tour de micro-tache et, si
//      notre code jette, casse l application hote. On rend donc TOUJOURS la
//      promesse originale et l on s abonne a cote.
//   2. Cloner sans consommer. `response.clone()` cree un flux tee dont le
//      tampon grossit indefiniment tant qu il n est pas lu. On le lit tout de
//      suite, sans quoi Chrome finit par avertir et la memoire par gonfler.
//   3. Parser du JSON qui n en est pas. Facebook prefixe ses reponses de
//      `for (;;);` et Google de `)]}'` pour qu un <script src> tiers ne puisse
//      pas les lire. Un JSON.parse direct echoue, et l on conclut a tort que
//      le format a change.
//
// ET UN QUATRIEME, propre a l autre extension maison : ne JAMAIS differer
// l enveloppe par un `setTimeout(0)`. Une page enchaine ses appels de facon
// synchrone ; le temps que le timer se declenche, les premiers sont deja
// partis. L enveloppe se pose ici, tout de suite, ou pas du tout.

(function () {
  "use strict";

  if (window.__IMPULSION_RESEAU__) return;
  window.__IMPULSION_RESEAU__ = true;

  var SOURCE = "IMPULSION_ADS_RESEAU";
  var registre = window.IMPULSION_REGISTRE;
  var adaptateur = registre && registre.pour(location.href);
  if (!adaptateur || !adaptateur.reseau) return;
  var R = adaptateur.reseau;

  var vus = Object.create(null);
  var compteurs = { reponses: 0, utiles: 0, octets: 0, entites: 0 };

  function poster(type, donnees) {
    try {
      window.postMessage({ source: SOURCE, type: type, data: donnees }, "*");
    } catch (e) {
      /* structuredClone impossible : on laisse tomber ce message */
    }
  }

  function emettre(entites) {
    var neuves = [];
    for (var i = 0; i < entites.length; i++) {
      var c = entites[i].niveau + ":" + entites[i].id;
      if (vus[c]) continue;
      vus[c] = 1;
      neuves.push(entites[i]);
      // Garde-fou de volume : au-dela, on ne rend plus service, on inonde.
      if (neuves.length >= 2000) break;
    }
    if (!neuves.length) return;
    compteurs.entites += neuves.length;
    poster("entites", neuves);
  }

  function objetsDuTexte(texte) {
    var t = texte;
    for (var i = 0; i < R.prefixesAJeter.length; i++) {
      var p = R.prefixesAJeter[i];
      if (t.lastIndexOf(p, 0) === 0) t = t.slice(p.length);
    }
    if (!R.lignesJson) {
      try {
        return [JSON.parse(t)];
      } catch (e) {
        return [];
      }
    }
    // Reponses @defer de Relay : plusieurs objets JSON separes par des sauts
    // de ligne dans un meme corps. Un JSON.parse global echoue.
    var sorties = [];
    var morceaux = t.split("\n");
    for (var j = 0; j < morceaux.length; j++) {
      var m = morceaux[j];
      if (!m || m.charCodeAt(0) !== 123 /* { */) continue;
      try {
        sorties.push(JSON.parse(m));
      } catch (e) {
        /* fragment incomplet, on passe */
      }
    }
    return sorties;
  }

  /**
   * Moisson AGNOSTIQUE DU SCHEMA.
   *
   * On ne suit aucun chemin du genre
   * `data.viewer.ad_account.campaigns.edges[].node` : Meta renomme ses
   * operations chaque trimestre et un chemin code en dur casse en silence. On
   * parcourt l arbre et l on retient tout objet dont la FORME correspond au
   * predicat declare dans l adaptateur.
   *
   * Le budget de noeuds evite qu une reponse pathologique fasse geler l onglet.
   */
  function moissonner(racine) {
    var trouves = [];
    var pile = [racine];
    var budget = 60000;
    while (pile.length && budget-- > 0) {
      var n = pile.pop();
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (var a = 0; a < n.length; a++) pile.push(n[a]);
        continue;
      }
      var e = null;
      try {
        e = R.estEntite(n);
      } catch (err) {
        /* predicat casse : on continue le parcours */
      }
      if (e) trouves.push(e);
      for (var k in n) {
        var v = n[k];
        if (v && typeof v === "object") pile.push(v);
      }
    }
    return trouves;
  }

  function traiter(url, texte) {
    try {
      compteurs.reponses += 1;
      if (!texte) return;
      compteurs.octets += texte.length;
      if (texte.length > R.tailleMax) return;
      if (!R.urlInteressante(url)) return;

      // Google : la seule chose utile est la plage de dates.
      if (typeof R.periodeDansTexte === "function") {
        var p = R.periodeDansTexte(texte);
        if (p) poster("periode", p);
      }

      var objets = objetsDuTexte(texte);
      var tout = [];
      for (var i = 0; i < objets.length; i++) {
        tout = tout.concat(moissonner(objets[i]));
      }
      if (tout.length) {
        compteurs.utiles += 1;
        emettre(tout);
      }
    } catch (e) {
      /* jamais rien casser dans la page hote */
    }
  }

  // ── fetch ─────────────────────────────────────────────────────────────────

  var fetchOriginal = window.fetch;
  window.fetch = function (entree, options) {
    var url = "";
    try {
      url = typeof entree === "string" ? entree : (entree && entree.url) || "";
    } catch (e) {
      /* Request exotique */
    }
    var promesse = fetchOriginal.apply(this, arguments);
    try {
      if (url && R.urlInteressante(url)) {
        // On rend la promesse ORIGINALE, jamais une derivee.
        promesse.then(
          function (reponse) {
            try {
              reponse
                .clone()
                .text()
                .then(function (t) {
                  traiter(url, t);
                })
                .catch(function () {});
            } catch (e) {
              /* corps deja consomme */
            }
          },
          function () {}
        );
      }
    } catch (e) {
      /* rien */
    }
    return promesse;
  };

  // ── XMLHttpRequest ────────────────────────────────────────────────────────

  var ouvrirOriginal = XMLHttpRequest.prototype.open;
  var envoyerOriginal = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (methode, url) {
    try {
      this.__impulsionUrl = String(url || "");
    } catch (e) {
      /* rien */
    }
    return ouvrirOriginal.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    try {
      var xhr = this;
      if (xhr.__impulsionUrl && R.urlInteressante(xhr.__impulsionUrl)) {
        xhr.addEventListener("load", function () {
          try {
            // Lire `responseText` quand `responseType` vaut « blob » ou
            // « arraybuffer » JETTE. Le try l attrape, mais le garde evite le
            // cout et le bruit.
            var rt = xhr.responseType;
            if (rt && rt !== "text" && rt !== "json") return;
            var texte = rt === "json" ? JSON.stringify(xhr.response) : xhr.responseText;
            traiter(xhr.__impulsionUrl, texte);
          } catch (e) {
            /* rien */
          }
        });
      }
    } catch (e) {
      /* rien */
    }
    return envoyerOriginal.apply(this, arguments);
  };

  // ── Le marquage des lignes par la fibre React ─────────────────────────────
  //
  // Seul le monde MAIN voit les proprietes `__reactFiber$...` des elements.
  // Quand l adaptateur sait marquer (Meta aujourd hui), on le fait tourner en
  // boucle courte : le tableau se re-rend au defilement et au changement de
  // page, et les marques doivent suivre. L appel est idempotent et borne
  // (quelques lignes, ~60 descendants chacune) : moins d une milliseconde
  // mesuree, toutes les 700 ms.
  if (typeof adaptateur.marquerLignes === "function") {
    var marquerSansCasser = function () {
      try {
        adaptateur.marquerLignes(document);
      } catch (e) {
        /* jamais rien casser dans la page hote */
      }
    };
    marquerSansCasser();
    setInterval(marquerSansCasser, 700);
  }

  // ── Navigation interne ────────────────────────────────────────────────────
  //
  // Ces interfaces changent de niveau sans recharger la page. Sans ces trois
  // signaux, le panneau resterait sur les campagnes alors que l ecran affiche
  // les publicites : le pire des cas, des chiffres justes en face des mauvaises
  // lignes.

  ["pushState", "replaceState"].forEach(function (nom) {
    var original = history[nom];
    history[nom] = function () {
      var r = original.apply(this, arguments);
      poster("url", location.href);
      return r;
    };
  });
  window.addEventListener("popstate", function () {
    poster("url", location.href);
  });

  // Le diagnostic a besoin de savoir ce que l interception a reellement vu :
  // « aucune reponse utile » et « selecteurs mauvais » se soignent
  // differemment.
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "IMPULSION_ADS_DEMANDE") return;
    if (event.data.type === "compteurs") poster("compteurs", compteurs);
  });
})();
