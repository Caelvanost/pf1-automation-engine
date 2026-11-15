# PF1AE Chat Actions — API v1.27.0

Foundry VTT **13.351**, Pathfinder 1e **11.11**.
All capabilities remain in Item Script Calls, never in the PF1AE module.

## Security model

A Chat Action is a GM-authored ChatMessage with immutable-to-players
\`flags["pf1-automation-engine"].chatActions\`. The card contains **no
JavaScript**. Its button only references a stable handler key.

Players can request a card or click a button by setting a flag on an Actor
they own. Foundry's database layer authenticates Actor updates, and the
\`updateActor\` hook provides the actual requesting \`userId\`. PF1AE does not
trust any user ID in flags or socket payloads. The elected active GM (lowest
ID) performs the authoritative operation, verifies all requested permissions,
and updates the message's shared flags.

The GM must have explicitly registered the handler **on the GM client**.
Bootstrap scripts run on their elected owning client. To make a handler
available on the GM after F5, put its \`PF1AE:bootstrap\` Script Call on a
**GM-owned Actor/Item** (or an individually approved, GM-executed fallback).
A bootstrap running solely on a player client cannot grant a GM handler.

**Do not enable Trusted Table Mode or approve untrusted code just to remove an
error.** The configured GM handler may mutate Actor documents only after
server-authenticated requester ownership and handler-source binding have been
validated. Handler code is never shipped over a socket.

## Public API

\`\`\`js
const chatActions=game.modules.get("pf1-automation-engine")?.api?.chatActions;
\`\`\`

### create(options)

\`\`\`js
const result=await chatActions.create({
  actor,                        // source ActorPF
  sourceItem: item,             // must belong to actor
  title:"A generic ability",
  content:"Select a target, then click.",
  buttons:[{
    id:"apply",
    label:"Apply",
    icon:"fa-solid fa-check",
    handlerKey:"my-module.apply", // stable GM-registered handler
    once:true,                  // optional, default true
    targetMode:"controlled",    // controlled (click) | targeted (T)
    permission:"OWNER",         // OWNER | GM
    exactOne:true               // optional, default true; false allows 1..10
  }]
});
// Returns a ChatMessage on GM, or {id,uuid} via GM acknowledgement on player.
\`\`\`

Players may create cards even without permission to edit GM chat messages:
PF1AE asks the elected GM through an authenticated source-Actor document
update, then the GM creates the message. An active GM is required.

### registerHandler(key, fn, {sourceItemUuid})

Register only on the GM client, from a trusted module or a GM-owned/bootstrap
script that is restored at startup:

\`\`\`js
const unregister=chatActions.registerHandler(
  "my-module.apply",
  async ({actor,token,targets,sourceActor,sourceItem,requester,message,button}) => {
    // Recheck capability-specific prerequisites before any mutation.
    if (!actor.system?.something) return {ok:false,reason:"Not applicable"};
    await actor.update({"system.something":false});
    return {ok:true,confirmation:"Effect applied"};
  },
  {sourceItemUuid:item.uuid}
);
bootstrap.onCleanup(unregister); // only in a PF1AE:bootstrap Script Call
\`\`\`

The handler is required on the elected GM **at the moment of card creation
and click**. Its binding to the exact source Item prevents an unrelated item
from triggering it. Never register arbitrary code from message flags.

### click(messageId, buttonId)

Select/target the appropriate token(s) on your own canvas, then call
\`await chatActions.click(messageId,buttonId)\`. Buttons invoke this
automatically. For OWNER buttons, the client must own the selected Actor.
The GM checks authenticated ownership again at execution time.

### getState(messageId)

Reads the persisted ChatMessage flags, including each button's
\`status\` (\`ready\` | \`pending\` | \`used\`), \`uses\`,
\`claimedAt\`, \`claimedBy\` and \`usedAt\`.

### reset({messageId, buttonId})

**GM only**. Manually resets a **pending** button after checking whether a
handler already partially applied its effects. Unexpected exceptions leave
the claim pending to prevent accidental repeated mutations.

## Usage and failure semantics

- Each ChatMessage's state is durable and visible to all connected clients.
  Buttons render through Foundry 13's \`renderChatMessageHTML\` hook (no
  browser-local listeners from item scripts).
- \`once:true\`: the elected GM first persists \`pending\`, then runs the
  trusted handler, then persists \`used\` after success. Concurrent clicks
  cannot cause duplicate handler execution.
- \`once:false\`: a successful handler increments \`uses\` and restores
  \`ready\`.
- \`{ok:false,reason:"..."}\` signals a **safe, unconsumed refusal**. Use it
  for failed preconditions, BEFORE making changes to Foundry documents.
- Exceptions might occur after a mutation. PF1AE leaves the button pending,
  requiring manual GM review and \`reset\`; this is intentional fail-closed
  behavior, not an automatic retry.
- No token, multiple tokens with \`exactOne:true\`, lack of OWNER, missing
  handler, unavailable GM or stale Actor all produce an explicit refusal.
- Changing scenes or F5 does not select a stale target; selection is read
  afresh from the **clicking user's** controlled or targeted tokens.
- Token position/range constraints are **not enforced** by the generic API.
  Add all capability-specific checks in your GM handler.
- Messages authored before this feature do not automatically acquire buttons.

## Foundry note

The documented PF1 native \`ActorPF.setCondition("bleed",false)\` removes the
system condition. A capability may use it inside its registered handler,
but PF1AE's generic core contains no references to Bleed or Utility Shot.

## Utility Shot example

See [Utility Shot — Stop Bleeding](examples/utility-shot-stop-bleeding.md).
It demonstrates a GM-owned \`PF1AE:bootstrap\` handler and a separate
\`PF1AE:attack:resolved\` call that publishes a button after a native attack.
This example does not override PF1FR ammunition handling. The script already
used by Zéphir to prepare Utility Shot can remain unchanged; integrate the
example with existing attack-resolved logic to avoid duplicate announcements.
