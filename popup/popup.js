// Le popup de reglages.
//
// Il porte trois choses et rien d autre : la connexion au CRM, les permissions
// par plateforme, et les VALEURS PAR DEFAUT. Le modele d attribution se change
// depuis le bandeau dans Ads Manager, pas d ici : on compare des modeles dix
// fois par minute, et ouvrir un popup a chaque fois tuerait l usage.

(function () {
  "use strict";

  var ICONES = window.IMPULSION_ICONES;
  var $ = function (id) {
    return document.getElementById(id);
  };

  var reglages = null;
  var capacites = null;
  var niveauCourant = "campagne";

  var LIBELLE_NIVEAU = { campagne: "Campagnes", adset: "Ensembles", pub: "Publicités" };

  function demander(type, charge) {
    return new Promise(function (resoudre, rejeter) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, charge || {}), function (r) {
        if (chrome.runtime.lastError) {
          rejeter({ code: "contexte", message: chrome.runtime.lastError.message });
          return;
        }
        if (!r) {
          rejeter({ code: "vide", message: "Aucune réponse." });
          return;
        }
        if (!r.ok) {
          rejeter(r.erreur);
          return;
        }
        resoudre(r.donnees);
      });
    });
  }

  function enregistrer(partiel) {
    return demander("enregistrerReglages", { reglages: partiel }).then(function (r) {
      reglages = r;
      return r;
    });
  }

  function etat(texte, ton) {
    var el = $("etatConnexion");
    el.textContent = texte;
    el.setAttribute("data-ton", ton || "");
  }

  // ── Connexion ─────────────────────────────────────────────────────────────

  /** `parClic` : vrai quand l utilisateur a clique, seul cas ou une permission peut se demander. */
  function tester(parClic) {
    var url = $("crmUrl").value.trim();
    var cle = $("cleApi").value.trim();
    if (!url || !cle) {
      etat("Renseignez l’adresse du serveur et la clé d’API.", "erreur");
      return;
    }
    var origine;
    var motif;
    try {
      var u = new URL(url);
      origine = u.origin;
      // Un motif d hote ne porte pas de port : http://localhost:3000 se demande
      // sous la forme http://localhost/*.
      motif = u.protocol + "//" + u.hostname + "/*";
    } catch (e) {
      etat("Adresse invalide. Exemple : https://mon-app.vercel.app", "erreur");
      return;
    }
    etat("Connexion…", "attente");
    // L adresse du serveur est libre : sa permission d hote se demande ICI, dans
    // le gestionnaire de clic et avant tout appel asynchrone, sans quoi Chrome
    // la refuse en silence. Deja accordee, la demande passe sans fenetre.
    //
    // A l ouverture du popup, la verification part SANS clic : demander une
    // permission hors geste utilisateur leve une erreur. On se contente alors
    // de constater si l acces existe deja.
    new Promise(function (resoudre) {
      var conclure = function (accorde) {
        resoudre(Boolean(accorde) && !chrome.runtime.lastError);
      };
      if (parClic) chrome.permissions.request({ origins: [motif] }, conclure);
      else chrome.permissions.contains({ origins: [motif] }, conclure);
    })
      .then(function (accorde) {
        if (!accorde) {
          return Promise.reject({
            message: parClic
              ? "Accès à " + origine + " refusé : sans lui, l’extension ne peut pas lire les chiffres."
              : "Cliquez sur « Tester la connexion » pour autoriser l’accès à " + origine + "."
          });
        }
        return enregistrer({ crmUrl: origine, cleApi: cle });
      })
      .then(function () {
        return demander("ping");
      })
      .then(function (d) {
        capacites = d;
        var e = d.entites || {};
        var comptes = (d.comptes || []).length;
        // Un serveur multi-annonceurs ne compte les entites que du site par
        // defaut : le nombre de comptes suivis, lui, vaut pour tout l espace.
        etat(
          "Connecté" +
            (d.cle && d.cle.espace ? " à " + d.cle.espace : "") +
            " · " +
            comptes +
            (comptes > 1 ? " comptes publicitaires suivis" : " compte publicitaire suivi"),
          "ok"
        );
        remplirModeles();
        remplirColonnes();
        fraicheur(d);
      })
      .catch(function (err) {
        // Chaque cas dit QUOI FAIRE. « Erreur » tout court renvoie l utilisateur
        // vers une console qu il n ouvrira pas.
        etat(err && err.message ? err.message : "Le serveur n’a pas répondu.", "erreur");
      });
  }

  function fraicheur(d) {
    var F = window.IMPULSION_FORMAT;
    var jour = function (iso) {
      return F && F.jourCourt ? F.jourCourt(iso) : iso;
    };
    var lignes = (d.plateformes || []).map(function (p) {
      return p.label + " : " + (p.dernierJourDepense ? "dépense jusqu’au " + jour(p.dernierJourDepense) : "jamais synchronisée");
    });
    var bloc = $("etatConnexion").parentNode;
    var ancienne = bloc.querySelector(".note-fraicheur");
    if (ancienne) ancienne.remove();
    if (!lignes.length) return;
    var note = document.createElement("p");
    note.className = "note note-fraicheur";
    note.textContent = lignes.join(" · ");
    $("etatConnexion").insertAdjacentElement("afterend", note);
  }

  // ── Plateformes ───────────────────────────────────────────────────────────

  function rendrePlateformes() {
    return demander("plateformes").then(function (liste) {
      var hote = $("plateformes");
      hote.innerHTML = "";
      liste.forEach(function (p) {
        var ligne = document.createElement("div");
        ligne.className = "plateforme";
        ligne.innerHTML =
          '<span class="nom">' +
          p.label +
          '</span><span class="statut" data-accorde="' +
          (p.accorde ? "1" : "0") +
          '">' +
          (p.accorde ? "Autorisé" : "À autoriser") +
          "</span>";
        var b = document.createElement("button");
        b.className = p.accorde ? "bouton discret" : "bouton";
        b.textContent = p.accorde ? "Retirer" : "Autoriser";
        // `chrome.permissions.request` DOIT etre appele dans le gestionnaire de
        // clic, SANS aucun `await` avant lui : Chrome exige un geste utilisateur
        // encore « chaud », et refuse silencieusement sinon.
        b.addEventListener("click", function () {
          if (p.accorde) {
            chrome.permissions.remove({ origins: p.origines }, function () {
              rendrePlateformes();
            });
          } else {
            chrome.permissions.request({ origins: p.origines }, function (accorde) {
              rendrePlateformes();
              // Sans rechargement, l utilisateur voit un ecran inchange et croit
              // a une panne : les scripts viennent d etre enregistres, mais la
              // page ouverte n en a pas beneficie.
              if (accorde) rechargerOngletSiConcerne(p.origines);
            });
          }
        });
        ligne.appendChild(b);
        hote.appendChild(ligne);
      });
    });
  }

  function rechargerOngletSiConcerne(origines) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (onglets) {
      var t = onglets && onglets[0];
      if (!t || !t.url) return;
      var concerne = origines.some(function (o) {
        var hote = o.replace(/^https:\/\//, "").replace(/\/\*$/, "");
        return t.url.indexOf("https://" + hote) === 0;
      });
      if (concerne) chrome.tabs.reload(t.id);
    });
  }

  // ── Attribution ───────────────────────────────────────────────────────────

  function remplirModeles() {
    var sel = $("modele");
    var modeles = (capacites && capacites.modeles) || [];
    if (!modeles.length) {
      sel.innerHTML = '<option value="first_paid_click">Premier clic payant</option>';
      sel.value = reglages.modele;
      return;
    }
    sel.innerHTML = modeles
      .map(function (m) {
        return (
          '<option value="' +
          m.cle +
          '"' +
          (m.cle === reglages.modele ? " selected" : "") +
          ">" +
          m.label +
          (m.defaut ? " (par défaut)" : "") +
          "</option>"
        );
      })
      .join("");
    if (capacites.fenetreMaximale) $("fenetre").max = String(capacites.fenetreMaximale);
  }

  // ── Colonnes ──────────────────────────────────────────────────────────────

  function rendreOnglets() {
    var hote = $("ongletsNiveau");
    hote.innerHTML = "";
    ["campagne", "adset", "pub"].forEach(function (n) {
      var b = document.createElement("button");
      b.textContent = LIBELLE_NIVEAU[n];
      b.setAttribute("aria-selected", n === niveauCourant ? "true" : "false");
      b.addEventListener("click", function () {
        niveauCourant = n;
        rendreOnglets();
        remplirColonnes();
      });
      hote.appendChild(b);
    });
  }

  function remplirColonnes() {
    var hote = $("colonnes");
    var catalogue = (capacites && capacites.colonnes) || [];
    if (!catalogue.length) {
      hote.innerHTML =
        '<p class="note" style="grid-column:1/-1">Testez la connexion : la liste des colonnes vient du serveur.</p>';
      return;
    }
    var choix = (reglages.colonnes && reglages.colonnes[niveauCourant]) || [];
    var actives = choix.length
      ? choix
      : catalogue
          .filter(function (c) {
            return c.parDefaut;
          })
          .map(function (c) {
            return c.cle;
          });

    hote.innerHTML = "";
    catalogue.forEach(function (c) {
      var l = document.createElement("label");
      l.title = c.aide || c.label;
      var i = document.createElement("input");
      i.type = "checkbox";
      i.checked = actives.indexOf(c.cle) !== -1;
      i.addEventListener("change", function () {
        var courantes = Array.prototype.slice
          .call(hote.querySelectorAll("input"))
          .map(function (inp, indice) {
            return inp.checked ? catalogue[indice].cle : null;
          })
          .filter(Boolean);
        var neuf = Object.assign({}, reglages.colonnes);
        neuf[niveauCourant] = courantes;
        enregistrer({ colonnes: neuf });
      });
      l.appendChild(i);
      l.appendChild(document.createTextNode(" " + c.label));
      hote.appendChild(l);
    });
  }

  // ── Demarrage ─────────────────────────────────────────────────────────────

  function noteNom() {
    $("noteNom").textContent = $("afficherNom").checked
      ? "Recommandé : c’est lui qui rend visible un décalage entre les chiffres et le tableau."
      : "Sans lui, un décalage d’une ligne mettrait le bon chiffre en face de la mauvaise campagne, sans rien signaler.";
  }

  function init() {
    if (ICONES) ICONES.remplir(document);
    $("version").textContent = "v" + chrome.runtime.getManifest().version;

    demander("reglages").then(function (r) {
      reglages = r;
      $("crmUrl").value = r.crmUrl;
      $("cleApi").value = r.cleApi;
      $("fenetre").value = String(r.fenetre);
      $("afficherNom").checked = Boolean(r.afficherNomControle);
      $("diagnostic").checked = Boolean(r.diagnostic);
      document.documentElement.setAttribute(
        "data-theme",
        r.theme === "auto" ? "" : r.theme
      );
      noteNom();
      remplirModeles();
      rendreOnglets();
      remplirColonnes();
      rendrePlateformes();
      // Une cle deja posee : on verifie tout de suite, sans attendre un clic.
      if (r.cleApi) tester(false);
    });

    // L interrupteur maitre. Lecture et ecriture DIRECTES de la cle `actif` :
    // pas de route, pour que la bascule reste vivante meme si le service worker
    // est en train de renaitre. `absent` vaut `actif` : l extension marche des
    // l installation, l interrupteur ne sert qu a couper.
    try {
      chrome.storage.local.get("actif").then(function (o) {
        $("actif").checked = !(o && o.actif === false);
      });
    } catch (e) {
      /* rien */
    }
    $("actif").addEventListener("change", function () {
      chrome.storage.local.set({ actif: $("actif").checked });
    });

    $("tester").addEventListener("click", function () {
      tester(true);
    });
    $("voir").addEventListener("click", function () {
      var champ = $("cleApi");
      var cache = champ.type === "password";
      champ.type = cache ? "text" : "password";
      $("voir").textContent = cache ? "Masquer" : "Afficher";
    });
    $("modele").addEventListener("change", function () {
      enregistrer({ modele: $("modele").value });
    });
    $("fenetre").addEventListener("change", function () {
      var max = (capacites && capacites.fenetreMaximale) || 90;
      var v = Math.max(1, Math.min(max, Number($("fenetre").value) || 90));
      $("fenetre").value = String(v);
      enregistrer({ fenetre: v });
    });
    $("afficherNom").addEventListener("change", function () {
      enregistrer({ afficherNomControle: $("afficherNom").checked });
      noteNom();
    });
    $("diagnostic").addEventListener("change", function () {
      enregistrer({ diagnostic: $("diagnostic").checked });
    });
    $("viderCache").addEventListener("click", function () {
      demander("viderCache").then(function () {
        $("viderCache").textContent = "Cache vidé";
        setTimeout(function () {
          $("viderCache").textContent = "Vider le cache";
        }, 1500);
      });
    });
    $("theme").addEventListener("click", function () {
      var ordre = ["auto", "clair", "sombre"];
      var suivant = ordre[(ordre.indexOf(reglages.theme) + 1) % ordre.length];
      enregistrer({ theme: suivant }).then(function () {
        document.documentElement.setAttribute(
          "data-theme",
          suivant === "auto" ? "" : suivant
        );
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
