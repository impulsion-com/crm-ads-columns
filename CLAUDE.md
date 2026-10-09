# Colonnes CRM pour Ads Manager

Extension Chrome qui injecte les colonnes de ton tracking dans Meta Ads Manager
et Google Ads : leads reels, rendez-vous honores, ventes, chiffre d affaires
signe, ROAS reel. Le serveur est une instance Agence OS (module Tracking OS) ou
tout serveur qui sert le meme contrat `/api/ext/v1`. Un clic sur une cellule ouvre la liste des personnes que la
ligne a produites, chacune cliquable vers sa fiche.

Manifest V3, **aucun build**, JavaScript vanilla, francais partout.

## Pourquoi cette extension existe

Le serveur contient deja le moteur d attribution : graphe d identite, collecte
first-party, modeles, referentiel publicitaire synchronise avec Meta et Google.

Ce qui manquait n etait pas la donnee, c etait sa PLACE. Elle vivait dans un
tableau de bord, alors que les decisions de budget se prennent dans Ads Manager. Cette extension fait le dernier metre, et rien d autre : elle
n invente aucun calcul.

## La chaine, de bout en bout

```
Ads Manager
   |  content script : lit la table, identifie chaque ligne, rend les colonnes
   v
Extension (ce depot)
   |  le SERVICE WORKER appelle, jamais un content script
   |  permission d hote accordee pour le serveur saisi => exempte de CORS
   v
Serveur  GET /api/ext/v1/{ping,metrics,prospects,index}
```

Le contrat d API est documente dans le depot `impulsion-com/agence-os`,
`docs/tracking.md`, section « Extension Chrome ».

## Architecture

| Dossier | Role |
| --- | --- |
| `background/` | Service worker : enregistrement des scripts, cle d API, appels au CRM, cache |
| `content/` | Scripts de page. `pont.js` et `reseau.js` sont les deux mondes, le reste est l interface |
| `plateformes/` | **Un fichier par regie.** Selecteurs, motifs d URL, predicats. Ne touche jamais `chrome.*` |
| `shared/` | Jetons, palette, formatage francais, icones, journal |
| `popup/` | Reglages, permissions, colonnes |
| `scripts/verifier.py` | Les regles maison, tenues par un script plutot que par une relecture |

### La regle de decoupage qui porte tout le reste

`plateformes/*.js` ne contient que des selecteurs, des expressions regulieres et
des fonctions pures. Ces fichiers sont charges **dans les deux mondes** (le monde
MAIN a besoin du predicat de moisson reseau), et il n y a pas d API d extension
dans le monde MAIN.

Toute la logique generique vit dans `content/`. Quand Meta change son interface,
on ouvre **un** fichier.

Et **chaque selecteur est une liste, pas une chaine**. On essaie dans l ordre, on
retient le premier qui rend un compte plausible, et le diagnostic dit lequel a
servi. Un ancien selecteur qui traine dans la liste ne coute rien et sauve la
mise le jour ou Meta revient en arriere, ce qui arrive plus souvent qu on ne
croit.

## Les pieges deja payes

### L ordre d enregistrement des deux mondes

`pont.js` (monde isole) doit etre enregistre **avant** `reseau.js` (monde MAIN).
Ce dernier commence a poster des messages des les premieres reponses de la page,
qui arrivent dans les 200 ms. Sans ecouteur en place, ces messages tombent dans
le vide **definitivement** : `postMessage` n a pas de file d attente.

Le symptome est retors : le panneau parait fonctionner, puisque les lignes sont
trouvees et affichees. Seule l identification echoue, et on va la chercher du
cote des selecteurs, qui n y sont pour rien.

**Protocole de verification**, a rejouer a toute modification de l ordre
d injection : comparer le NOMBRE d entites moissonnees avant et apres, dans le
rapport de diagnostic. Il ne doit pas baisser.

### Ne jamais differer l enveloppe de `fetch`

Une page enchaine ses appels de facon synchrone. Un `setTimeout(0)` avant de
poser le piege, et les premiers sont deja partis. L enveloppe se pose tout de
suite, ou pas du tout.

### Trois pieges qui tuent naivement l interception

1. **Alterer la promesse rendue a l application.** Rendre `promesse.then(...)`
   ajoute un tour de micro-tache et, si notre code jette, casse l application
   hote. On rend TOUJOURS la promesse originale et l on s abonne a cote.
2. **Cloner sans consommer.** `response.clone()` cree un flux tee dont le tampon
   grossit indefiniment tant qu il n est pas lu.
3. **Parser du JSON qui n en est pas.** Facebook prefixe ses reponses de
   `for (;;);`, Google de `)]}'`. Un `JSON.parse` direct echoue, et l on conclut
   a tort que le format a change. Meta repond aussi en `@defer` : plusieurs
   objets JSON separes par des sauts de ligne dans un meme corps.

### La moisson est agnostique du schema

On ne suit **aucun** chemin du genre `data.viewer.ad_account.campaigns.edges`.
Meta renomme ses operations chaque trimestre et un chemin code en dur casse en
silence. On parcourt l arbre et l on retient tout objet dont la FORME correspond
au predicat. `__typename` ne bouge pas ; le nom de l operation, si.

**Piege de vocabulaire Meta** : `AdCampaignGroup` designe ce que l interface
appelle « campagne », et `AdCampaign` designe l AD SET. Inverser les deux
melangerait deux niveaux sans que rien ne le signale.

### Le rendu natif cede la place, il ne s entete pas

React retire au rendu suivant les enfants qu il n a pas produits. Le
MutationObserver les remet. C est LA boucle infinie, et c est le mode d echec
standard de l injection de cellules.

La parade n est pas d etre plus malin, c est de **compter**. Au-dela de douze
arrachages en quatre secondes, `rendu-natif.js` se declare non viable pour la
session, l orchestrateur bascule sur le rail, et l extension le DIT. Un mode qui
ne marche pas et qu on reessaie en boucle fait ramer l onglet.

Le rail, lui, ne peut pas boucler sur lui-meme : le MutationObserver surveille
LEUR tableau, nos noeuds vivent sous `document.body`, hors de cette cible. Les
deux cibles sont disjointes **par construction**.

### Lecture et ecriture, jamais melangees

L orchestrateur mesure TOUT d abord, puis ecrit TOUT ensuite. Melanger provoque
un « layout thrashing » : le navigateur recalcule la mise en page a chaque
alternance, et le defilement tombe a quinze images par seconde sur trente lignes.

La **voie rapide** est ce qui rend le rail utilisable : un defilement pur deplace
toutes les lignes du meme delta, donc une seule `transform` suffit, sans une
seule mesure.

### Le CSS des polices passe par le registre, pas par une balise

Une feuille injectee par le champ `css` de `registerContentScripts` est chargee
par l EXTENSION et echappe a la CSP de la page. Une balise `<style>` posee dans
le DOM de facebook.com y est soumise pour ses sous-ressources : les `.woff2`
seraient bloquees en silence.

D ou `content/polices.css`, qui ne contient QUE les `@font-face`. Tout le reste
vit dans le shadow root.

### La cle d API ne descend jamais dans un onglet

Le service worker retire `cleApi` des reglages pour tout appelant qui porte un
`sender.tab`, et ne laisse passer qu un booleen `cleApiPresente`. Un content
script n en a aucun besoin : il ne fait jamais d appel HTTP lui-meme.

C est aussi pourquoi tous les appels partent du service worker. Depuis
Chrome 73, un `fetch` emis par un content script part avec l origine de la PAGE
et se heurte a CORS. Le jour ou une erreur CORS apparait, c est le symptome d un
`fetch` mal place : la correction est de le deplacer, **jamais** d ouvrir CORS
cote CRM.

### Permissions

`chrome.permissions.request` doit etre appele dans le gestionnaire de clic,
**sans aucun `await` avant lui** : Chrome exige un geste utilisateur encore
« chaud » et refuse silencieusement sinon.

Il **ignore aussi le chemin** : demander `https://www.facebook.com/adsmanager/*`
accorde en realite `https://www.facebook.com/*`, et Chrome l annoncera ainsi.
Autant l ecrire honnetement. L enregistrement du script, lui, reste borne au
chemin.

Apres l octroi, il faut **recharger l onglet courant** : les scripts viennent
d etre enregistres, mais la page ouverte n en a pas beneficie, et l utilisateur
voit un ecran inchange qu il lira comme une panne.

### Stockage

- `chrome.storage.local` : preferences SEULEMENT, et la cle d API. Jamais `sync`,
  qui la recopierait chez Google vers tous les profils Chrome.
- `chrome.storage.session` : le cache. Il meurt avec le navigateur, ce qui est
  exactement ce qu on veut.
- **Jamais de donnees en `local`** : quota de 10 Mo, et le depassement est
  silencieux.

## La regle qui prime sur toutes les autres

**Une ligne non identifiee n affiche AUCUN chiffre.** Pas meme un tiret, qui se
lit comme un zero au bout de trois secondes. Une pastille ocre et un libelle.

Un chiffre faux dans une decision de budget coute plus cher qu une case vide.

Le corollaire : quand le DOM et l interception reseau repondent tous les deux, on
**compare**. Un desaccord n est jamais arbitre, il fait basculer la ligne en « a
verifier ». C est un auto-test gratuit qui signale un adaptateur casse des la
premiere ligne, au lieu d afficher tranquillement les chiffres de la campagne
d a cote.

Et le rapprochement par nom refuse de trancher : les quinze publicites de la
campagne Meta « RDV » portent toutes le meme nom.

## Charte graphique

La charte est celle d Impulsion ; ses jetons vivent dans `shared/jetons.css`.

Les regles qui coutent cher a enfreindre, parce qu elles sont invisibles en revue
de code :

- **Jamais d emoticone.** Les icones sont des traces SVG `stroke-width="1.7"` sur
  grille 24, dans `shared/icons.js`, declarees par `data-icone`.
- **Aucune couleur en dur.** `shared/jetons.css` fait autorite.
  `shared/palette.js` existe uniquement parce que le rendu natif ecrit des styles
  inline hors du shadow root, ou les jetons ne sont pas herites. Chaque valeur de
  `palette.js` doit exister dans `jetons.css`, et le verificateur l exige.
- **Jamais de tiret cadratin.** Une exemption est possible quand le cadratin est
  une DONNEE a reconnaitre (Google ecrit ses plages de dates avec) : elle se
  declare par `verifier: tiret-cadratin-autorise` dans le commentaire qui
  precede, et ne court que jusqu a la fin de l instruction.
- Petrole `#1F4D5C` comme accent **unique** : une seule couleur porte l action.
  L ocre est le seul ton hors charte, reserve au statut « a verifier », c est a
  dire exactement aux lignes non identifiees.
- Rayons 12 px cartes, 7 px boutons, 3 px pastilles. Mouvement 0,55 s sur
  `cubic-bezier(.16, 1, .3, 1)`. Lent, jamais vif.
- La serif ne touche que les nombres isoles.

## Verification

```bash
python3 scripts/verifier.py    # 40 regles maison, aucune dependance
node scripts/charger.js        # assemblage des modules, dans l ordre reel
```

`charger.js` evalue chaque module dans un faux navigateur, dans l ordre exact
qu emploie le service worker, et verifie qu il pose bien le global que les
suivants attendent. `node --check` verifie la syntaxe, pas l assemblage : une
faute de frappe dans un nom de global passe la syntaxe, passe la relecture, et
ne se voit qu au chargement dans Chrome, sur une page ou l on ne peut pas poser
de point d arret facilement.

Le verificateur, lui, tient ce qu une relecture ne voit pas : fichiers cites mais
absents, ordre d enregistrement des deux mondes, emoticones, couleurs en dur,
cadratins, cle d API dans un script de contenu, selecteurs de plateforme
echappes hors de `plateformes/`.

## Installation

Non empaquetee, `chrome://extensions`, mode developpeur, « Charger l extension
non empaquetee ».

Elle n est pas sur le Web Store : elle porte une cle d API personnelle et se
charge depuis ce dossier.

Premier demarrage : ouvrir le popup, coller l adresse du serveur et la cle d API,
tester la connexion (Chrome demande alors l acces a cette adresse), puis
autoriser Meta et Google.

Avec Agence OS, la cle se cree dans Reglages > API et MCP > nouveau jeton
« Extension Chrome ». Elle n est affichee **qu une fois**.

## Etat

| Plateforme | Etat |
| --- | --- |
| Meta Ads | valide sur ecran reel (banc Chrome) : 0.7.0 contre le CRM d Impulsion le 27 aout 2026, 0.8.0 contre une instance Agence OS le 9 octobre 2026 (13 campagnes sur 13 identifiees, tiroir des personnes) |
| Google Ads | valide sur ecran reel (banc Chrome) le 9 octobre 2026, 0.9.0 contre Agence OS : aucun identifiant dans le DOM (le lien du nom n a pas de href), les lignes se rapprochent par leur NOM via l index ; le numero client se lit dans `__e` ou dans le fil d Ariane, `__c` et `ocid` sont des identifiants internes ; la bande se pose sous le nom, dans `ess-cell[essfield=name]` |
| TikTok Ads | adaptateur present mais **inerte** : aucun serveur ne synchronise TikTok |

Depuis la 0.8.0 l extension parle a n importe quel serveur qui sert `/api/ext/v1` :
une instance Agence OS (module Tracking OS, depot `impulsion-com/agence-os`) ou le
CRM d Impulsion. L adresse se saisit dans le popup, sa permission d hote se demande
au clic sur « Tester la connexion ». Le compte publicitaire ouvert est envoye a
chaque appel, pour qu un serveur multi-annonceurs choisisse le site.

Reste a faire, Meta et Google : lire la periode affichee quand l URL ne la porte
pas (la barre dit alors « periode par defaut »).

Les textes de l interface portent accents et apostrophes typographiques (’) : ne
jamais ecrire une chaine visible en ASCII. Les commentaires du code, eux, sont
restes sans accents.

Banc Chrome : recharger l extension par `chrome.runtime.reload()` depuis sa page de
reglages. `Extensions.loadUnpacked` par CDP la reinstalle et lui fait perdre ses
permissions d hote au redemarrage suivant, qu un humain doit alors revalider.

Le depot est public : jamais de cle, d adresse interne ni de donnee de prospect dans
un commit, un test ou une capture.
