import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, doc, getDoc, setDoc, updateDoc,
  addDoc, collection, query, where, onSnapshot, serverTimestamp,
  creerCompteSecondaire, changerMotDePasse, supprimerCompteCourant,
} from "./firebase-config.js";

import { genererCode, formatDate, notifier } from "./utils.js";
import { reinitialiserToutesLesDonnees } from "./reinitialisation.js";

const state = {
  currentUser: null,
  coordinationId: null,
  coordination: null,
  associations: [],
  reaffectations: [],
  unsubscribers: [],
};
let creationEnCours = false;
let coordinationEnCoursDeCreation = null;

const screens = ["screen-loading", "screen-login", "screen-onboarding-coordination", "screen-onboarding-coordinateur", "screen-dashboard"];
function showScreen(id) {
  screens.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
}

function demarrer() {
  showScreen("screen-loading");
  onAuthStateChanged(auth, async (user) => {
    if (creationEnCours) return;
    if (user) {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists() && userSnap.data().role === "coordinateur") {
        state.currentUser = { uid: user.uid, ...userSnap.data() };
        state.coordinationId = userSnap.data().coordination_id;
        await lancerDashboard();
        return;
      } else {
        await signOut(auth);
      }
    }
    showScreen("screen-login");
  });
}

document.getElementById("lien-vers-creation").addEventListener("click", () => {
  showScreen("screen-onboarding-coordination");
});
document.getElementById("lien-retour-login-1").addEventListener("click", () => {
  showScreen("screen-login");
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await signInWithEmailAndPassword(auth, fd.get("email").trim(), fd.get("password"));
  } catch (err) {
    notifier("Identifiants incorrects.", "erreur");
  }
});

document.getElementById("form-coordination").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  coordinationEnCoursDeCreation = {
    village: fd.get("village").trim(),
    nom: fd.get("nom").trim(),
  };
  showScreen("screen-onboarding-coordinateur");
});

document.getElementById("form-coordinateur").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get("email").trim();
  const password = fd.get("password");
  const nom = fd.get("nom").trim();
  const telephone = fd.get("telephone").trim();
  const residence = fd.get("residence").trim();

  creationEnCours = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    const coordRef = await addDoc(collection(db, "coordinations"), {
      village: coordinationEnCoursDeCreation.village,
      nom: coordinationEnCoursDeCreation.nom,
      date_creation: serverTimestamp(),
    });

    const userData = {
      role: "coordinateur",
      nom, telephone, email, residence,
      coordination_id: coordRef.id,
      statut: "actif",
      date_creation: serverTimestamp(),
    };
    await setDoc(doc(db, "users", cred.user.uid), userData);

    notifier("Coordination créée avec succès.", "succes");
    state.currentUser = { uid: cred.user.uid, ...userData };
    state.coordinationId = coordRef.id;
    creationEnCours = false;
    await lancerDashboard();
  } catch (err) {
    notifier("Erreur : " + err.message, "erreur");
    if (auth.currentUser) {
      try { await auth.currentUser.delete(); } catch (e2) { /* ignore */ }
      try { await signOut(auth); } catch (e3) { /* ignore */ }
    }
    creationEnCours = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  state.unsubscribers.forEach((u) => u());
  state.unsubscribers = [];
  await signOut(auth);
  showScreen("screen-login");
});

document.getElementById("btn-changer-mdp").addEventListener("click", () => {
  ouvrirModal(`
    <h2>Changer mon mot de passe</h2>
    <p class="subtitle-sm">Confirmez votre mot de passe actuel puis saisissez le nouveau.</p>
    <form id="form-changer-mdp">
      <div class="field-row">
        <label>Mot de passe actuel</label>
        <input type="password" name="ancien" required />
      </div>
      <div class="field-row">
        <label>Nouveau mot de passe (6 caractères min)</label>
        <input type="password" name="nouveau" minlength="6" required />
      </div>
      <div class="field-row">
        <label>Confirmer le nouveau mot de passe</label>
        <input type="password" name="confirmation" minlength="6" required />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost-sm" id="modal-annuler" style="flex:1;">Annuler</button>
        <button type="submit" class="btn btn-primary" style="flex:1;">Confirmer</button>
      </div>
    </form>
  `);
  document.getElementById("modal-annuler").addEventListener("click", fermerModal);
  document.getElementById("form-changer-mdp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ancien = fd.get("ancien");
    const nouveau = fd.get("nouveau");
    const confirmation = fd.get("confirmation");
    if (nouveau !== confirmation) {
      notifier("Les deux mots de passe ne correspondent pas.", "erreur");
      return;
    }
    try {
      await changerMotDePasse(state.currentUser.email, ancien, nouveau);
      notifier("Mot de passe modifié avec succès.", "succes");
      fermerModal();
    } catch (err) {
      notifier("Mot de passe actuel incorrect ou erreur : " + err.message, "erreur");
    }
  });
});

async function lancerDashboard() {
  showScreen("screen-dashboard");
  const coordSnap = await getDoc(doc(db, "coordinations", state.coordinationId));
  if (coordSnap.exists()) {
    state.coordination = coordSnap.data();
    document.getElementById("db-village-nom").textContent = state.coordination.nom;
  }
  document.getElementById("db-coordinateur-nom").textContent = state.currentUser.nom;

  const unsubAssociations = onSnapshot(
    query(collection(db, "associations"), where("coordination_id", "==", state.coordinationId)),
    (snap) => {
      state.associations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }
  );
  const unsubMembres = onSnapshot(
    query(collection(db, "users"), where("coordination_id", "==", state.coordinationId), where("role", "==", "membre")),
    (snap) => {
      document.getElementById("stat-nb-membres").textContent = snap.size;
    }
  );
  const unsubReaffectations = onSnapshot(
    query(collection(db, "reaffectations"), where("coordination_id", "==", state.coordinationId)),
    (snap) => {
      state.reaffectations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }
  );
  state.unsubscribers.push(unsubAssociations, unsubMembres, unsubReaffectations);
}

function render() {
  document.getElementById("stat-nb-associations").textContent = state.associations.length;
  renderAssociations();
  renderReaffectations();
}

// ---------- ASSOCIATIONS ----------

function renderAssociations() {
  const container = document.getElementById("liste-associations");
  if (state.associations.length === 0) {
    container.innerHTML = `<p class="empty-state">Aucune association enregistrée pour l'instant. Générez un code pour inviter la première association.</p>`;
    return;
  }
  container.innerHTML = state.associations.map((a) => `
    <div class="entity-card">
      <div class="entity-card-top">
        <div>
          <p class="entity-nom">${a.nom}</p>
          <p class="entity-sub">${a.ville || ""}</p>
        </div>
        <span class="badge badge-actif">${a.statut || "actif"}</span>
      </div>
    </div>
  `).join("");
}

document.getElementById("btn-nouveau-code-bureau").addEventListener("click", async () => {
  const code = genererCode("BUR");
  try {
    await setDoc(doc(db, "codes_parrainage", code), {
      type: "bureau",
      coordination_id: state.coordinationId,
      proprietaire_id: state.currentUser.uid,
      actif: true,
      date_creation: serverTimestamp(),
    });
    ouvrirModal(`
      <h2>Code généré</h2>
      <p class="subtitle-sm">Transmettez ce code au bureau de la nouvelle association. Il devra le saisir lors de son inscription sur l'application Bureau.</p>
      <div class="code-display">${code}</div>
      <div class="modal-actions"><button class="btn btn-primary" id="modal-fermer-code" style="flex:1;">Terminé</button></div>
    `);
    document.getElementById("modal-fermer-code").addEventListener("click", fermerModal);
  } catch (err) {
    notifier("Erreur : " + err.message, "erreur");
  }
});

// ---------- RÉAFFECTATIONS ----------

const libellesMotif = {
  voyage: "Voyage",
  demenagement: "Déménagement définitif",
};
const libellesStatut = {
  en_attente: "En attente de traitement",
  transmis: "Transmis à l'association d'accueil",
  traite: "Traité",
};

function renderReaffectations() {
  const enAttente = state.reaffectations.filter((r) => r.statut === "en_attente");
  document.getElementById("stat-nb-reaffectations").textContent = enAttente.length;

  const badge = document.getElementById("badge-reaffectations");
  if (enAttente.length > 0) {
    badge.textContent = enAttente.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  const container = document.getElementById("liste-reaffectations");
  if (state.reaffectations.length === 0) {
    container.innerHTML = `<p class="empty-state">Aucun dossier de réaffectation pour l'instant.</p>`;
    return;
  }

  const tri = [...state.reaffectations].sort((a, b) => (b.date_creation?.toMillis?.() || 0) - (a.date_creation?.toMillis?.() || 0));
  container.innerHTML = tri.map((r) => `
    <div class="entity-card" data-reaffectation-id="${r.id}" style="cursor:pointer;">
      <div class="entity-card-top">
        <div>
          <p class="entity-nom">${r.nom}</p>
          <p class="entity-sub">${r.association_origine_nom || "—"} → ${r.ville_destination || "—"} · ${libellesMotif[r.motif] || r.motif}</p>
        </div>
        <span class="badge ${r.statut === "en_attente" ? "badge-erreur" : "badge-actif"}">${libellesStatut[r.statut] || r.statut}</span>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-reaffectation-id]").forEach((card) => {
    card.addEventListener("click", () => ouvrirModalReaffectation(card.dataset.reaffectationId));
  });
}

function ouvrirModalReaffectation(reaffectationId) {
  const r = state.reaffectations.find((x) => x.id === reaffectationId);
  if (!r) return;

  const h = r.historique_estime || {};
  const associationsAccueil = state.associations.filter((a) => a.id !== r.association_origine_id);

  ouvrirModal(`
    <h2>${r.nom}</h2>
    <p class="subtitle-sm">Dossier transmis par : ${r.association_origine_nom || "—"}</p>

    <div style="margin:14px 0;">
      <div class="field-row"><label>Motif</label><p>${libellesMotif[r.motif] || r.motif}</p></div>
      <div class="field-row"><label>Ville de destination déclarée</label><p>${r.ville_destination || "—"}</p></div>
      <div class="field-row"><label>Date de naissance</label><p>${r.date_naissance || "—"}</p></div>
      <div class="field-row"><label>Sexe</label><p>${r.sexe === "M" ? "Masculin" : r.sexe === "F" ? "Féminin" : "—"}</p></div>
      <div class="field-row"><label>Situation matrimoniale</label><p>${r.situation_matrimoniale === "marie" ? "Marié(e)" : "Célibataire"}</p></div>
      <hr style="margin:10px 0; border:none; border-top:1px solid #eee;" />
      <div class="field-row"><label>Retard de paiement estimé (famille d'origine)</label><p>${h.taux_retard_paiement_famille_pourcent != null ? h.taux_retard_paiement_famille_pourcent + " %" : "—"}</p></div>
      <div class="field-row"><label>Fréquentation des cas sociaux</label><p>${h.frequentation_cas_sociaux_pourcent != null ? h.frequentation_cas_sociaux_pourcent + " %" : "Non disponible (module à venir)"}</p></div>
    </div>

    <p class="subtitle-sm" style="font-weight:600;">Statut actuel : ${libellesStatut[r.statut] || r.statut}</p>

    ${r.statut === "en_attente" ? `
      <hr style="margin:16px 0; border:none; border-top:1px solid #eee;" />
      <form id="form-transmettre-reaffectation">
        <div class="field-row">
          <label>Association d'accueil</label>
          <select name="association_id" required>
            <option value="">— Choisir —</option>
            ${associationsAccueil.map((a) => `<option value="${a.id}">${a.nom} (${a.ville || "ville inconnue"})</option>`).join("")}
          </select>
        </div>
        <p class="subtitle-sm">L'association choisie recevra ce dossier avec l'historique ci-dessus pour appréciation.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost-sm" id="modal-annuler" style="flex:1;">Fermer</button>
          <button type="submit" class="btn btn-primary" style="flex:1;">Transmettre</button>
        </div>
      </form>
    ` : r.statut === "transmis" ? `
      <p class="subtitle-sm">Transmis à : ${r.association_destination_nom || "—"}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost-sm" id="modal-annuler" style="flex:1;">Fermer</button>
        <button type="button" class="btn btn-primary" id="btn-marquer-traite" style="flex:1;">Marquer comme traité</button>
      </div>
    ` : `
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost-sm" id="modal-annuler" style="flex:1;">Fermer</button>
      </div>
    `}
  `);

  document.getElementById("modal-annuler").addEventListener("click", fermerModal);

  const formTransmettre = document.getElementById("form-transmettre-reaffectation");
  if (formTransmettre) {
    formTransmettre.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const associationId = fd.get("association_id");
      const association = state.associations.find((a) => a.id === associationId);
      try {
        await updateDoc(doc(db, "reaffectations", reaffectationId), {
          statut: "transmis",
          association_destination_id: associationId,
          association_destination_nom: association ? association.nom : "",
          date_transmission: serverTimestamp(),
        });
        notifier("Dossier transmis à l'association d'accueil.", "succes");
        fermerModal();
      } catch (err) {
        notifier("Erreur : " + err.message, "erreur");
      }
    });
  }

  const btnTraite = document.getElementById("btn-marquer-traite");
  if (btnTraite) {
    btnTraite.addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "reaffectations", reaffectationId), {
          statut: "traite",
          date_traitement: serverTimestamp(),
        });
        notifier("Dossier marqué comme traité.", "succes");
        fermerModal();
      } catch (err) {
        notifier("Erreur : " + err.message, "erreur");
      }
    });
  }
}

// ---------- RÉINITIALISATION TOTALE ----------

document.getElementById("lien-reinitialisation").addEventListener("click", () => {
  ouvrirModal(`
    <h2 style="color:#a94442;">Réinitialisation totale</h2>
    <p class="subtitle-sm">Cette action supprime <strong>toutes</strong> les données des 3 applications BÖTAYE (coordinations, associations, membres, familles, cotisations, cas sociaux, réaffectations) de façon <strong>irréversible</strong>. Les comptes de connexion existants deviendront inutilisables.</p>
    <p class="subtitle-sm">Connectez-vous avec un compte existant pour autoriser l'opération.</p>
    <form id="form-reinitialisation">
      <div class="field-row">
        <label>E-mail d'un compte existant (coordinateur ou bureau)</label>
        <input type="email" name="email" required />
      </div>
      <div class="field-row">
        <label>Mot de passe</label>
        <input type="password" name="password" required />
      </div>
      <div class="field-row">
        <label>Tapez SUPPRIMER pour confirmer</label>
        <input type="text" name="confirmation" required placeholder="SUPPRIMER" />
      </div>
      <p id="reinitError" style="color:#c0392b; font-size:13px;"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost-sm" id="modal-annuler" style="flex:1;">Annuler</button>
        <button type="submit" class="btn btn-primary" style="flex:1; background:#a94442;">Tout réinitialiser</button>
      </div>
    </form>
  `);
  document.getElementById("modal-annuler").addEventListener("click", fermerModal);
  document.getElementById("form-reinitialisation").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("reinitError");
    errEl.textContent = "";
    const fd = new FormData(e.target);
    const email = fd.get("email").trim();
    const password = fd.get("password");
    const confirmation = fd.get("confirmation").trim();

    if (confirmation !== "SUPPRIMER") {
      errEl.textContent = "Veuillez taper exactement SUPPRIMER pour confirmer.";
      return;
    }

    creationEnCours = true; // empêche onAuthStateChanged de réagir pendant l'opération
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      errEl.textContent = "Identifiants incorrects.";
      creationEnCours = false;
      return;
    }

    document.getElementById("modal-content").innerHTML = `
      <h2>Réinitialisation en cours…</h2>
      <p class="subtitle-sm" id="reinit-progression">Démarrage…</p>
    `;

    try {
      await reinitialiserToutesLesDonnees((nomCollection, nb) => {
        const p = document.getElementById("reinit-progression");
        if (p) p.textContent = `Collection "${nomCollection}" vidée (${nb} document(s)).`;
      });

      try { await supprimerCompteCourant(); } catch (e2) { /* le compte est peut-être déjà orphelin, on ignore */ }

      state.unsubscribers.forEach((u) => u());
      state.unsubscribers = [];
      try { await signOut(auth); } catch (e3) { /* ignore */ }

      creationEnCours = false;
      fermerModal();
      notifier("Application réinitialisée. Vous pouvez créer une nouvelle coordination.", "succes");
      showScreen("screen-onboarding-coordination");
    } catch (err) {
      creationEnCours = false;
      notifier("Erreur pendant la réinitialisation : " + err.message, "erreur");
    }
  });
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

function ouvrirModal(html) {
  document.getElementById("modal-content").innerHTML = html;
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";
}
function fermerModal() {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("hidden");
  overlay.style.display = "none";
  document.getElementById("modal-content").innerHTML = "";
}
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") fermerModal();
});

demarrer();
