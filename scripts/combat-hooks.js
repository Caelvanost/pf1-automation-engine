/**
 * PF1 - Automatisation des combats | Foundry VTT v13
 *
 * Compatible avec le flag de la macro Accumulation de pouvoir :
 * flags.world.kineticistGatherPower = {
 *   active: true, reduction: 1|2, typeAction: "mouvement"|"complexe",
 *   roundActivation: number, roundUtilisation: number,
 *   combatId: string, timestamp: number
 * }
 *
 * Cette surveillance supprime le flag à la fin du tour concerné.
 * Elle ne consomme pas automatiquement de brûlure et n'applique pas de réduction :
 * cela appartient au script d'utilisation de l'explosion cinétique.
 */

const FLAG_SCOPE = "world";
const FLAG_KEY = "kineticistGatherPower";
const LOG_PREFIX = "PF1 Combat Automation";

function isPrimaryGM() {
  const gms = game.users
    .filter(user => user.active && user.isGM)
    .sort((a, b) => a.id.localeCompare(b.id));
  return gms[0]?.id === game.user.id;
}

function isForwardMovement(prior, current) {
  const beforeRound = Number(prior?.round);
  const afterRound = Number(current?.round);
  if (!Number.isFinite(beforeRound) || !Number.isFinite(afterRound)) return false;
  if (afterRound > beforeRound) return true;
  if (afterRound < beforeRound) return false;
  return Number(current?.turn) > Number(prior?.turn);
}

Hooks.once("ready", () => {
  console.info(`${LOG_PREFIX} | Surveillance des tours activée (v1.0.0).`);
});

Hooks.on("combatTurnChange", async (combat, prior, current) => {
  if (!isPrimaryGM() || !isForwardMovement(prior, current)) return;

  // Le Hook indique le combattant dont le tour vient de se terminer.
  // L'identifiant est plus robuste qu'un index en cas de reclassement d'initiative.
  const priorCombatantId = prior?.combatantId;
  if (!priorCombatantId) return;

  const combatant = combat.combatants.get(priorCombatantId);
  const actor = combatant?.actor;
  if (!actor) return;

  const flag = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!flag?.active || flag.combatId !== combat.id) return;

  // Ne jamais expirer un état créé pour un autre combattant partageant l'Actor.
  // Les anciens flags sans combatantId restent compatibles.
  if (flag.combatantId && flag.combatantId !== priorCombatantId) return;

  const activationRound = Number(flag.roundActivation);
  if (!Number.isInteger(activationRound) || activationRound < 0) {
    console.warn(`${LOG_PREFIX} | Round d'activation invalide pour ${actor.name}.`);
    return;
  }

  // Action complexe : bénéfice utilisable au tour du round suivant.
  // Action mouvement : bénéfice utilisable jusqu'à la fin du tour actuel.
  const expiryRound = flag.typeAction === "complexe"
    ? activationRound + 1
    : activationRound;

  if (Number(prior.round) < expiryRound) return;

  // Protection simple contre une modification du flag pendant l'attente.
  const latest = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!latest?.active || latest.combatId !== combat.id || latest.timestamp !== flag.timestamp) return;

  try {
    await actor.unsetFlag(FLAG_SCOPE, FLAG_KEY);
    console.info(`${LOG_PREFIX} | Accumulation de pouvoir expirée : ${actor.name}.`);
    // Uniquement console : ne pas spammer les joueurs ni révéler des informations de MJ.
  } catch (err) {
    console.error(`${LOG_PREFIX} | Impossible de supprimer le flag de ${actor.name}.`, err);
  }
});
