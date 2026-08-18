import { db, collection, getDocs, deleteDoc, doc } from "./firebase-config.js";

// Liste exhaustive des collections utilisées par les 3 applications BÖTAYE.
// À tenir à jour si de nouvelles collections sont ajoutées.
const COLLECTIONS_A_VIDER = [
  "coordinations",
  "associations",
  "users",
  "codes_parrainage",
  "cotisations",
  "families",
  "family_members",
  "contribution_rules",
  "reaffectations",
  "social_cases",
];

// Supprime tous les documents de toutes les collections BÖTAYE.
// onProgression(nomCollection, nombreSupprime) est appelé après chaque collection vidée.
async function reinitialiserToutesLesDonnees(onProgression) {
  for (const nomCollection of COLLECTIONS_A_VIDER) {
    const snap = await getDocs(collection(db, nomCollection));
    const suppressions = snap.docs.map((d) => deleteDoc(doc(db, nomCollection, d.id)));
    await Promise.all(suppressions);
    if (onProgression) onProgression(nomCollection, snap.docs.length);
  }
}

export { reinitialiserToutesLesDonnees, COLLECTIONS_A_VIDER };
