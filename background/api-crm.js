// Client HTTP du serveur de tracking (une instance Agence OS, ou le CRM d Impulsion).
//
// IL NE TOURNE QUE DANS LE SERVICE WORKER, et ce n est pas un detail de rangement.
//
// Un `fetch` emis depuis le service worker d une extension MV3 dont les
// permissions d hote ACCORDEES couvrent le serveur est EXEMPTE de CORS, preflight
// compris. Le meme `fetch` emis depuis un content script ne l est pas : depuis
// Chrome 73 il part avec l origine de la PAGE, donc adsmanager.facebook.com, et
// se heurte a un mur.
//
// Le corollaire vaut mieux que la regle : la cle d API ne transite jamais dans
// le contexte d une page tierce. Un script de Facebook ne peut pas la lire, ni
// meme constater qu elle existe.
//
// Le jour ou une erreur CORS apparait, c est le symptome d un fetch mal place.
// La correction est de le deplacer ici, jamais d ouvrir CORS cote CRM.

(function (root) {
  "use strict";

  var J = root.IMPULSION_JOURNAL;

  /** Erreurs typees plutot qu un message a lire. L interface doit pouvoir dire
   *  QUOI FAIRE, ce qu un « Failed to fetch » ne permet pas. */
  function Echec(code, message, statut) {
    this.code = code;
    this.message = message;
    this.statut = statut || 0;
  }
  Echec.prototype = Object.create(Error.prototype);
  Echec.prototype.name = "EchecApi";

  function diagnostiquer(statut, corps) {
    switch (statut) {
      case 401:
        return new Echec(
          "cle_refusee",
          (corps && corps.code === "cle_revoquee"
            ? "Cette clé d’API a été révoquée. "
            : "Clé d’API refusée. ") +
            "Créez-en une sur votre serveur, puis collez-la dans les réglages.",
          401
        );
      case 403:
        return new Echec(
          "portee",
          "Cette clé n’a pas le droit de lecture attribution. Vérifiez sa portée.",
          403
        );
      case 404:
        return new Echec(
          "api_absente",
          "L’API d’attribution n’est pas déployée sur cette instance. Attendu : /api/ext/v1/ping.",
          404
        );
      case 409:
        return new Echec(
          "ambigu",
          (corps && corps.message) || "Plusieurs entités portent cet identifiant.",
          409
        );
      case 429:
        return new Echec("debit", (corps && corps.message) || "Trop d’appels.", 429);
      default:
        if (statut >= 500) {
          return new Echec("serveur", "Le serveur a répondu " + statut + ".", statut);
        }
        return new Echec(
          "inattendu",
          (corps && corps.message) || "Réponse inattendue du serveur (" + statut + ").",
          statut
        );
    }
  }

  /** Version du contrat que ce code sait lire. Une extension installee n est
   *  pas une page qu on recharge : si le CRM passe a la v2 sans nous, il vaut
   *  mieux le dire que d afficher des colonnes vides. */
  var API_ATTENDUE = 1;

  function appeler(reglages, chemin, params) {
    if (!reglages.cleApi) {
      return Promise.reject(
        new Echec("cle_absente", "Aucune clé d’API. Ouvrez les réglages de l’extension.")
      );
    }
    var base = String(reglages.crmUrl || "").replace(/\/$/, "");
    var url = base + "/api/ext/v1/" + chemin;
    var qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    });
    if (qs.toString()) url += "?" + qs.toString();

    var depart = Date.now();
    return fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + reglages.cleApi, Accept: "application/json" },
      // La reponse ne doit jamais venir du cache HTTP : les chiffres bougent, et
      // c est notre propre memo qui decide de la fraicheur.
      cache: "no-store"
    })
      .catch(function () {
        // Sans permission d hote pour ce serveur, le `fetch` echoue comme une
        // panne reseau. L adresse est libre depuis la 0.8.0 : la permission se
        // demande au clic sur « Tester la connexion », et il faut le dire.
        return chrome.permissions
          .contains({ origins: [new URL(base).protocol + "//" + new URL(base).hostname + "/*"] })
          .catch(function () {
            return true;
          })
          .then(function (accorde) {
            if (!accorde) {
              throw new Echec(
                "permission",
                "L’extension n’a pas encore l’accès à " + base + ". Ouvrez ses réglages et cliquez sur « Tester la connexion »."
              );
            }
            // Panne reseau, DNS, serveur eteint. Distinguer ce cas d un 500
            // change ce qu on conseille a l utilisateur.
            throw new Echec(
              "reseau",
              "Le serveur ne répond pas. Vérifiez qu’il est en ligne et que l’adresse est correcte."
            );
          });
      })
      .then(function (r) {
        var latence = Date.now() - depart;
        return r
          .json()
          .catch(function () {
            return null;
          })
          .then(function (corps) {
            if (!r.ok) throw diagnostiquer(r.status, corps);
            if (!corps || corps.ok !== true) {
              throw new Echec("inattendu", "Le serveur a répondu sans « ok ».", r.status);
            }
            if (corps.api !== API_ATTENDUE) {
              throw new Echec(
                "version",
                "Le serveur parle la version " +
                  corps.api +
                  " du contrat, l’extension attend la " +
                  API_ATTENDUE +
                  ". Mettez l’extension à jour.",
                r.status
              );
            }
            corps.__latence = latence;
            corps.__cache = r.headers.get("x-cache") || "";
            corps.__calcul = r.headers.get("x-temps-calcul") || "";
            if (J) J.dire("api", chemin, r.status, latence + " ms", corps.__cache);
            return corps;
          });
      });
  }

  root.IMPULSION_API = {
    Echec: Echec,
    API_ATTENDUE: API_ATTENDUE,
    // `compte` : le compte publicitaire ouvert dans la page. Un serveur qui suit
    // plusieurs annonceurs (Agence OS) s en sert pour choisir le site, donc
    // l entonnoir et le catalogue des colonnes. Le CRM d Impulsion l ignore.
    ping: function (reglages, p) {
      p = p || {};
      return appeler(reglages, "ping", { compte: p.compte, plateforme: p.compte ? p.plateforme : "" });
    },
    metrics: function (reglages, p) {
      return appeler(reglages, "metrics", {
        plateforme: p.plateforme,
        niveau: p.niveau,
        compte: p.compte,
        p: p.perso ? "perso" : p.preset,
        du: p.du,
        au: p.au,
        m: p.modele,
        f: p.fenetre,
        ids: p.ids && p.ids.length ? p.ids.join(",") : ""
      });
    },
    prospects: function (reglages, p) {
      return appeler(reglages, "prospects", {
        plateforme: p.plateforme,
        niveau: p.niveau,
        compte: p.compte,
        id: p.externalId,
        p: p.perso ? "perso" : p.preset,
        du: p.du,
        au: p.au,
        m: p.modele,
        f: p.fenetre
      });
    },
    index: function (reglages, p) {
      return appeler(reglages, "index", { plateforme: p.plateforme, niveau: p.niveau, compte: p.compte });
    }
  };
})(typeof self !== "undefined" ? self : window);
