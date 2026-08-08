import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, doc, getDoc, setDoc, updateDoc,
  addDoc, collection, query, where, onSnapshot, serverTimestamp,
  getDocs, deleteDoc,
  creerCompteSecondaire, changerMotDePasse,
} from "./firebase-config.js";

import { genererCode, formatDate, notifier } from "./utils.js";

const state = {
  currentUser: null,
  coordinationId: null,
  coordination: null,
  associations: [],
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
    const coordRef = await addDoc(collection(db, "coordinations"), {
      village: coordinationEnCoursDeCreation.village,
      nom: coordinationEnCoursDeCreation.nom,
      date_creation: serverTimestamp(),
    });

    const cred = await createUserWithEmailAndPassword(auth, email, password);
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

// --- Changement de mot de passe ---
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
  state.unsubscribers.push(unsubAssociations, unsubMembres);
}

function render() {
  document.getElementById("stat-nb-associations").textContent = state.associations.length;

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
