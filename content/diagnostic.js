// Mode diagnostic.
//
// C EST LA PIECE QUI PERMET DE REPARER L EXTENSION SANS ETRE DEVANT L ECRAN.
// Ces interfaces ne sont pas observables depuis un poste de developpement :
// elles exigent une session connectee sur un compte publicitaire reel. Le
// rapport copiable est donc le seul pont entre « ca ne marche plus » et une
// correction fondee sur des faits.
//
// CE QU IL NE CONTIENT PAS, VOLONTAIREMENT : aucune valeur issue des reponses
// reseau, seulement des CHEMINS de cles et des comptes. Un rapport doit pouvoir
// se coller dans un message sans exfiltrer de donnees clients.

(function (root) {
  "use strict";

  var P = root.IMPULSION_PANNEAU;
  var J = root.IMPULSION_JOURNAL;
  var L = root.IMPULSION_LIGNES;

  var contours = [];

  function effacer() {
    for (var i = 0; i < contours.length; i++) {
      if (contours[i].parentNode) contours[i].parentNode.removeChild(contours[i]);
    }
    contours = [];
  }

  /** Un contour par ligne detectee, avec sa methode de resolution. */
  function surligner(racine, lignes) {
    effacer();
    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i];
      var b;
      try {
        b = l.element.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      if (b.height === 0) continue;
      var d = document.createElement("div");
      d.className = "contour-diagnostic";
      d.style.left = b.left + "px";
      d.style.top = b.top + "px";
      d.style.width = b.width + "px";
      d.style.height = b.height + "px";
      d.innerHTML =
        "<span>" +
        P.echapper((l.methode || "aucune") + " · " + l.confiance + " · " + (l.externalId || "?")) +
        "</span>";
      racine.appendChild(d);
      contours.push(d);
    }
  }

  function table(lignes) {
    if (!console.table) return;
    console.table(
      lignes.map(function (l) {
        return {
          nom: (l.nom || "").slice(0, 42),
          identifiant: l.externalId || "",
          methode: l.methode || "",
          confiance: l.confiance
        };
      })
    );
  }

  /**
   * Le rapport, en JSON collable.
   *
   * Ce qu il doit permettre de trancher, dans l ordre : la grille a-t-elle ete
   * trouvee, les lignes aussi, par quel selecteur, combien sont identifiees et
   * par quelle methode, et l interception reseau a-t-elle vu passer quoi que ce
   * soit. Ces quatre reponses suffisent a savoir quel etage de la cascade
   * reparer.
   */
  function rapport(ctx) {
    var parMethode = {};
    var nonResolues = [];
    var desaccords = [];
    (ctx.lignes || []).forEach(function (l) {
      var m = l.methode || "aucune";
      parMethode[m] = (parMethode[m] || 0) + 1;
      if (l.confiance === L.CONFIANCE.INCONNU) nonResolues.push((l.nom || "").slice(0, 60));
      if (l.methode === "desaccord") {
        desaccords.push({
          nom: (l.nom || "").slice(0, 60),
          dom: l.detail && l.detail.dom,
          reseau: l.detail && l.detail.reseau
        });
      }
    });

    var exemple = "";
    try {
      if (ctx.lignes && ctx.lignes[0]) {
        exemple = ctx.lignes[0].element.outerHTML.slice(0, 3000);
      }
    } catch (e) {
      exemple = "(illisible)";
    }

    return {
      extension: ctx.version || "0.1.0",
      adaptateur: { cle: ctx.adaptateur.cle, version: ctx.adaptateur.version },
      url: location.href,
      niveau: ctx.niveau,
      compte: ctx.compte,
      periode: ctx.periode,
      modele: ctx.modele,
      fenetre: ctx.fenetre,
      rendu: {
        mode: ctx.mode,
        natifViable: ctx.natifViable,
        raisonNatif: ctx.raisonNatif
      },
      // La sonde est ce qui permet de reparer sans etre devant l ecran : elle
      // dit ce que chaque selecteur attrape reellement, et ce que porte la page.
      sonde: ctx.sonde || null,
      grille: {
        trouvee: Boolean(ctx.grille),
        selecteurGrille: ctx.selecteurGrille,
        selecteurLigne: ctx.selecteurLigne,
        conteneurDefilement: ctx.conteneurDefilement,
        hauteurDefilable: ctx.hauteurDefilable
      },
      lignes: {
        vues: (ctx.lignes || []).length,
        resolues: (ctx.lignes || []).filter(function (l) {
          return Boolean(l.externalId);
        }).length,
        parMethode: parMethode,
        nonResolues: nonResolues.slice(0, 20)
      },
      desaccords: desaccords.slice(0, 10),
      reseau: ctx.compteursReseau || null,
      crm: {
        entitesRecues: ctx.entitesRecues || 0,
        absentesDuCrm: (ctx.absentes || []).slice(0, 20),
        dernierCode: ctx.dernierCode,
        derniereErreur: ctx.derniereErreur || null
      },
      exempleLigne: exemple,
      journal: (J && J.historique ? J.historique() : []).slice(-15)
    };
  }

  function copier(texte) {
    // `navigator.clipboard` echoue hors d un geste utilisateur ou sans
    // permission. Le repli par textarea marche partout, et c est le seul qui
    // marche a coup sur dans une page tierce.
    return new Promise(function (resoudre) {
      try {
        var ta = document.createElement("textarea");
        ta.value = texte;
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        resoudre(ok);
      } catch (e) {
        resoudre(false);
      }
    });
  }

  root.IMPULSION_DIAGNOSTIC = {
    surligner: surligner,
    effacer: effacer,
    table: table,
    rapport: rapport,
    copier: copier
  };
})(typeof self !== "undefined" ? self : window);
