// Le pont entre le monde MAIN et le monde isole.
//
// IL DOIT S ENREGISTRER EN PREMIER. `reseau.js` tourne dans le monde de la page
// et commence a poster des messages des les premieres reponses, qui arrivent
// dans les 200 ms. Si l ecouteur n est pas encore la, ces messages tombent dans
// le vide, DEFINITIVEMENT : il n y a pas de file d attente sur postMessage.
//
// Le symptome est retors : le panneau parait fonctionner, puisque les lignes du
// tableau sont bien trouvees et affichees. Seule l identification echoue, et on
// va la chercher du cote des selecteurs, qui n y sont pour rien. C est ce qui a
// coute une demi-journee sur l autre extension maison, et le CLAUDE.md de ce
// depot le redit pour la meme raison.
//
// Le protocole de verification, a rejouer a toute modification de l ordre
// d injection : comparer le NOMBRE d entites moissonnees avant et apres. Il ne
// doit pas baisser.

(function () {
  "use strict";

  var SOURCE = "IMPULSION_ADS_RESEAU";

  // Tampon : le pont peut etre pret avant l orchestrateur. Les entites vues
  // entre-temps sont gardees ici plutot que jetees.
  var tampon = [];
  var abonnes = [];

  function diffuser(message) {
    if (!abonnes.length) {
      tampon.push(message);
      if (tampon.length > 400) tampon.shift();
      return;
    }
    for (var i = 0; i < abonnes.length; i++) {
      try {
        abonnes[i](message);
      } catch (e) {
        /* un abonne casse ne doit pas priver les autres */
      }
    }
  }

  window.addEventListener(
    "message",
    function (event) {
      // Filtrage strict : `event.source !== window` ecarte les iframes, et le
      // controle de `source` ecarte tout ce que la page envoie pour son propre
      // compte. Sans ces deux gardes, n importe quel script de la page pourrait
      // nous faire afficher ce qu il veut.
      if (event.source !== window) return;
      var d = event.data;
      if (!d || d.source !== SOURCE) return;
      diffuser(d);
    },
    false
  );

  window.IMPULSION_PONT = {
    /** S abonner. Rend d abord tout ce qui a ete vu avant l abonnement. */
    abonner: function (rappel) {
      abonnes.push(rappel);
      var enAttente = tampon;
      tampon = [];
      for (var i = 0; i < enAttente.length; i++) {
        try {
          rappel(enAttente[i]);
        } catch (e) {
          /* rien */
        }
      }
    },
    /** Nombre de messages recus, pour le rapport de diagnostic. */
    enAttente: function () {
      return tampon.length;
    }
  };
})();
