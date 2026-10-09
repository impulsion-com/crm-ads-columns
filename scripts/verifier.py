#!/usr/bin/env python3
"""Verifications qui ne se voient pas en relecture.

    python3 scripts/verifier.py

Les regles de charte sont invisibles en revue de code : un emoji passe une
relecture, une couleur en dur aussi, et un fichier oublie dans le manifeste ne
se remarque qu au chargement. Ce script les tient a notre place.

Aucune dependance, aucune ecriture. Sort en 1 des qu une regle est enfreinte.
"""

import json
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
echecs = []
verifications = 0


def verifie(intitule, condition, detail=""):
    global verifications
    verifications += 1
    if condition:
        print(f"  ok    {intitule}")
    else:
        print(f"  ECHEC {intitule}" + (f" -> {detail}" if detail else ""))
        echecs.append(intitule)


def lire(chemin):
    return (RACINE / chemin).read_text(encoding="utf-8")


def fichiers(motif, exclure=()):
    return [
        p
        for p in sorted(RACINE.rglob(motif))
        if ".git" not in p.parts and not any(e in str(p) for e in exclure)
    ]


print("\nVerification de l extension\n")

# ── 1. Le manifeste et les fichiers qu il designe ───────────────────────────
print("Manifeste")
manifeste = json.loads(lire("manifest.json"))

verifie("manifest_version vaut 3", manifeste.get("manifest_version") == 3)
verifie(
    "aucun content_scripts statique : l enregistrement est dynamique, derriere une permission",
    "content_scripts" not in manifeste,
)
verifie(
    "les plateformes sont en permissions OPTIONNELLES, pas obligatoires",
    all(
        "facebook" not in h and "google.com/aw" not in h and "tiktok" not in h
        for h in manifeste.get("host_permissions", [])
    ),
    str(manifeste.get("host_permissions")),
)
# Depuis la 0.8.0 l adresse du serveur est libre (Agence OS chez chaque membre, ou le
# CRM d Impulsion). L exemption de CORS du service worker tient a une permission
# d hote ACCORDEE, obligatoire ou optionnelle : elle est donc optionnelle, large, et
# demandee pour la seule origine saisie, au clic sur « Tester la connexion ».
verifie(
    "aucun serveur en dur : l adresse est libre, sa permission d hote est optionnelle",
    manifeste.get("host_permissions", []) == []
    and "https://*/*" in manifeste.get("optional_host_permissions", []),
    str(manifeste.get("host_permissions")),
)
verifie(
    "le popup demande la permission du serveur saisi, avant d enregistrer l adresse",
    (lambda t: "chrome.permissions.request({ origins: [motif] }" in t and t.index("chrome.permissions.request({ origins: [motif] }") < t.index("enregistrer({ crmUrl: origine"))(
        (RACINE / "popup" / "popup.js").read_text(encoding="utf-8")
    ),
)
verifie(
    "aucune adresse du CRM d Impulsion dans le code livre",
    all("crm.impulsion.com" not in f.read_text(encoding="utf-8") for d in ("background", "content", "popup", "plateformes", "shared") for f in (RACINE / d).rglob("*") if f.suffix in (".js", ".html", ".css")),
)

designes = [manifeste["background"]["service_worker"], manifeste["action"]["default_popup"]]
designes += list(manifeste["icons"].values())
for bloc in manifeste.get("web_accessible_resources", []):
    designes += bloc.get("resources", [])

manquants = [d for d in designes if not (RACINE / d).exists()]
verifie("tous les fichiers cites par le manifeste existent", not manquants, ", ".join(manquants))

# ── 2. Les fichiers cites par le service worker ─────────────────────────────
print("\nEnregistrement des scripts")
sw = lire("background/service-worker.js")
cites = set(re.findall(r'"((?:shared|content|plateformes)/[\w.-]+\.(?:js|css))"', sw))
cites |= set(re.findall(r'"(\.\./(?:shared|background|plateformes)/[\w.-]+\.js)"', sw))
absents = [
    c
    for c in cites
    if not (RACINE / "background" / c).resolve().exists() and not (RACINE / c).exists()
]
verifie(
    "tous les scripts enregistres ou importes existent",
    not absents,
    ", ".join(sorted(absents)),
)

verifie(
    "le script ISOLE est enregistre AVANT le script MAIN (pont.js doit ecouter en premier)",
    sw.index("id: idsDe(cle)[0]") < sw.index("id: idsDe(cle)[1]"),
)
verifie(
    "pont.js est le premier des scripts isoles",
    re.search(r"var ISOLE = \[\s*(?://[^\n]*\n\s*)*\"content/pont\.js\"", sw) is not None,
)
verifie(
    "orchestrateur.js est le dernier : il appelle tous les autres",
    sw.index("content/orchestrateur.js") > sw.index("content/tiroir.js"),
)

# `registerContentScripts` jette sur un identifiant deja pris, et quatre
# evenements peuvent appeler reconcilier(). Sans ces deux gardes, un simple
# rechargement de l extension produit « Duplicate script ID ».
verifie(
    "l enregistrement retire avant de poser : idempotent, et il repose la liste de fichiers a jour",
    sw.index("await desenregistrer(cle);") < sw.index("chrome.scripting.registerContentScripts"),
)
verifie(
    "reconcilier() est serialisee : quatre evenements peuvent l appeler en meme temps",
    "file = file.then(reconcilierVraiment)" in sw,
)

# Un enregistrement persiste survit avec SA liste de fichiers. Sans comparaison
# de version, un fichier ajoute n est jamais injecte, et l on cherche l erreur
# dans son code alors qu il n a jamais tourne.
verifie(
    "les enregistrements persistes sont reposes quand la version du manifeste change",
    "CLE_VERSION_SCRIPTS" in sw and "getManifest()" in sw,
)

version_manifeste = manifeste["version"]
verifie(
    "la version du manifeste et celle du rapport de diagnostic concordent",
    ('var VERSION = "' + version_manifeste + '";') in lire("content/orchestrateur.js"),
    version_manifeste,
)

# `unregisterContentScripts` avec une liste dont UN id n existe pas echoue en
# ENTIER et ne retire rien. Avec un etat a moitie enregistre, un retrait par
# liste ne nettoie donc jamais, et la pose bute sur « Duplicate script ID »
# pour toujours. C est le bug du 26 aout, et il ne doit pas revenir.
verifie(
    "le retrait des scripts se fait id par id, jamais par liste",
    "unregisterContentScripts({ ids: [presents[i]] })" in sw
    and "unregisterContentScripts({ ids: idsDe" not in sw,
)
# Ads Manager est souvent rendu dans un iframe interne. Avec allFrames a
# false, les scripts tournaient dans le parent, ou le tableau n existe pas :
# zero ligne quels que soient les selecteurs.
verifie(
    "les scripts s injectent dans les cadres : Ads Manager vit parfois dans un iframe",
    "allFrames: true" in sw and "allFrames: false" not in sw,
)

verifie(
    "au changement de version, table rase des enregistrements persistes",
    "await chrome.scripting.unregisterContentScripts();" in sw,
)

# L interrupteur maitre vit dans SA cle de stockage. Sur la cle des reglages,
# l evenement onChanged transporterait l objet entier, cle d API comprise,
# jusque dans le processus de la page.
verifie(
    "l interrupteur maitre a sa propre cle de stockage, hors de l objet des reglages",
    '"actif"' in sw and "actif" not in lire("background/reglages.js"),
)
verifie(
    "le popup porte l interrupteur maitre",
    'id="actif"' in lire("popup/popup.html"),
)
orchestrateur_src = lire("content/orchestrateur.js")
verifie(
    "la page reagit au basculement sans rechargement",
    "chrome.storage.onChanged.addListener" in orchestrateur_src,
)
verifie(
    "le remontage automatique de l hote respecte la coupure",
    "if (etat.masque) return;\n      if (document.getElementById(P.ID_HOTE)) return;" in orchestrateur_src,
)

# ── 3. La charte ────────────────────────────────────────────────────────────
print("\nCharte")

EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF⬀-⯿️]"
)
avec_emoji = []
for p in fichiers("*.js") + fichiers("*.html") + fichiers("*.css") + fichiers("*.md"):
    if EMOJI.search(p.read_text(encoding="utf-8")):
        avec_emoji.append(str(p.relative_to(RACINE)))
verifie(
    "aucune emoticone : les icones sont des traces SVG de shared/icons.js",
    not avec_emoji,
    ", ".join(avec_emoji),
)

# Une ligne peut porter un cadratin quand c est une DONNEE a reconnaitre et non
# du texte produit : Google ecrit ses plages de dates avec, et il faut bien le
# faire correspondre. L exemption se declare alors dans le commentaire qui
# precede, ce qui la rend visible en relecture au lieu de la cacher.
MARQUEUR = "verifier: tiret-cadratin-autorise"
avec_cadratin = []
for p in fichiers("*.js") + fichiers("*.html") + fichiers("*.css") + fichiers("*.md") + fichiers("*.json"):
    exempte = False
    for n, ligne in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if MARQUEUR in ligne:
            exempte = True
            continue
        if "—" in ligne and not exempte:
            avec_cadratin.append(f"{p.relative_to(RACINE)}:{n}")
        # L exemption court jusqu a la fin de l instruction qui suit le
        # marqueur, et pas plus loin : elle ne doit jamais couvrir un fichier
        # entier, sinon elle cesse d etre une exception et devient une porte.
        if exempte and ";" in ligne:
            exempte = False

verifie(
    "aucun tiret cadratin produit par l extension",
    not avec_cadratin,
    ", ".join(avec_cadratin),
)

# Couleurs en dur. Seuls jetons.css et le logo ont le droit d en porter.
COULEUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(")
en_dur = []
for p in fichiers("*.css"):
    rel = str(p.relative_to(RACINE))
    if rel.endswith("jetons.css"):
        continue
    for n, ligne in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        nu = ligne.split("/*")[0]
        if COULEUR.search(nu):
            en_dur.append(f"{rel}:{n}")
# Le JS aussi : le rendu natif ecrit des styles inline hors du shadow root, ou
# les jetons ne sont pas herites. Seul shared/palette.js a le droit d en porter,
# et ses valeurs sont verifiees contre jetons.css juste apres.
for p in fichiers("*.js", exclure=("scripts/",)):
    rel = str(p.relative_to(RACINE))
    if rel.endswith("palette.js"):
        continue
    for n, ligne in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        nu = ligne.split("//")[0]
        if re.search(r"#[0-9a-fA-F]{6}\b", nu):
            en_dur.append(f"{rel}:{n}")

verifie(
    "aucune couleur en dur hors jetons.css et palette.js",
    not en_dur,
    ", ".join(en_dur[:6]),
)

jetons = lire("shared/jetons.css")
palette = lire("shared/palette.js")
valeurs = re.findall(r'"(#[0-9a-fA-F]{6})"', palette)
absentes = [v for v in valeurs if v.lower() not in jetons.lower()]
verifie(
    "chaque couleur de palette.js existe dans jetons.css : une seule source, deux formes",
    not absentes,
    ", ".join(absentes),
)

# ── 4. Le cloisonnement du secret ───────────────────────────────────────────
print("\nCloisonnement")

for chemin in ["content/orchestrateur.js", "content/panneau.js", "content/reseau.js",
               "content/lignes.js", "content/tiroir.js", "content/entete.js",
               "content/diagnostic.js", "content/rendu-natif.js", "content/pont.js"]:
    texte = lire(chemin)
    # `cleApiPresente` est un BOOLEEN, pas un secret : c est ce que le service
    # worker laisse passer vers un onglet pour que le rail puisse dire « aucune
    # cle ». Tout autre usage de `cleApi` dans un script de contenu serait le
    # secret lui-meme.
    porte_la_cle = re.search(r"cleApi(?!Presente)", texte) is not None
    verifie(
        f"{chemin} ne porte aucune cle d API",
        not porte_la_cle and "Authorization" not in texte,
    )

verifie(
    "aucun fetch vers le CRM depuis un script de contenu : il partirait avec l origine de la page",
    all(
        "fetch(" not in lire(c) or "chrome.runtime.getURL" in lire(c)
        for c in ["content/orchestrateur.js", "content/lignes.js", "content/panneau.js"]
    ),
)

verifie(
    "la cle vit en storage.local et jamais en storage.sync",
    "storage.sync" not in lire("background/reglages.js"),
)

verifie(
    "les reglages envoyes a un onglet sont prives de la cle d API",
    "delete sansSecret.cleApi" in lire("background/service-worker.js"),
)

cache_code = "\n".join(
    l.split("//")[0] for l in lire("background/cache.js").splitlines()
)
verifie(
    "aucune donnee volumineuse en storage.local : le quota de 10 Mo deborde en silence",
    "storage.local" not in cache_code,
)

# ── 5. Les plateformes ──────────────────────────────────────────────────────
print("\nAdaptateurs")

def sans_commentaires(texte):
    """Le CODE, sans les commentaires : une regle qui interdirait d ECRIRE le
    mot chrome dans une explication serait absurde. On retire les blocs et les
    fins de ligne, betement mais suffisamment pour ce depot."""
    texte = re.sub(r"/\*.*?\*/", "", texte, flags=re.S)
    return "\n".join(l.split("//")[0] for l in texte.splitlines())


for cle in ["meta", "google", "tiktok"]:
    texte = lire(f"plateformes/{cle}.js")
    verifie(f"{cle} : ne touche jamais chrome.*", "chrome." not in sans_commentaires(texte))
    verifie(
        f"{cle} : ses selecteurs sont des LISTES, pas des chaines",
        re.search(r"grille:\s*\[", texte) is not None,
    )
    verifie(f"{cle} : porte une version datee", re.search(r'VERSION = "\d{4}-\d{2}-\d{2}"', texte) is not None)

verifie(
    "aucun selecteur CSS de plateforme hors de plateformes/",
    not [
        p
        for p in fichiers("*.js", exclure=("plateformes/", "scripts/"))
        if re.search(r'"\[role="?(row|grid|gridcell)', p.read_text(encoding="utf-8"))
    ],
)

# ── 6. CSS bien forme ───────────────────────────────────────────────────────
print("\nFeuilles de style")
for p in fichiers("*.css"):
    texte = p.read_text(encoding="utf-8")
    sans_commentaires = re.sub(r"/\*.*?\*/", "", texte, flags=re.S)
    verifie(
        f"{p.relative_to(RACINE)} : accolades equilibrees",
        sans_commentaires.count("{") == sans_commentaires.count("}"),
        f"{sans_commentaires.count('{')} ouvrantes, {sans_commentaires.count('}')} fermantes",
    )

# ── Fin ─────────────────────────────────────────────────────────────────────
print(f"\n{verifications - len(echecs)} verifications au vert, {len(echecs)} en echec.\n")
sys.exit(1 if echecs else 0)
