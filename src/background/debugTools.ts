import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { CHARACTER_ID_KEY, listKnownCharacters, readStoredCharacterId } from "../shared/characterTemplates";

const TEMPLATE_KEY_PREFIX = getPluginId("character-template/");
const PORTRAIT_KEY_PREFIX = getPluginId("character-portrait/");

function templateKey(id: string): string {
  return `${TEMPLATE_KEY_PREFIX}${id}`;
}

function ownerKey(id: string): string {
  return getPluginId(`character-owner/${id}`);
}

/**
 * TEMPORARY console-only tool for merging two characterIds that both ended
 * up representing the same character. This can happen even with identical
 * portraits: resolveOrAssignCharacterId's portrait-based reconciliation
 * (see shared/characterTemplates.ts) only runs for a token that doesn't yet
 * have its own id stamped, so two sibling tokens minted in the same
 * backfill race window never converge afterward -- each keeps its own id
 * forever, and both show up under the same name in the "link to an
 * existing character" picker.
 *
 * Not wired into any UI. Run from devtools against the background iframe:
 *   __charDebug.listDuplicates("Rio")
 *   __charDebug.mergeCharacters("<loserId>", "<keeperId>")
 * Re-run mergeCharacters after switching to any other scene the character
 * has a token in, so that scene's token gets re-stamped too.
 *
 * Remove this file (and its call in background/main.ts) once the room's
 * known duplicates are cleaned up.
 */
async function listDuplicates(name: string) {
  const roomMetadata = await OBR.room.getMetadata();
  const matches = listKnownCharacters(roomMetadata).filter(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  console.table(
    matches.map((c) => ({
      characterId: c.characterId,
      name: c.name,
      updatedAt: (roomMetadata[templateKey(c.characterId)] as { updatedAt?: number } | undefined)?.updatedAt,
    }))
  );
  return matches;
}

/**
 * Owlbear Rodeo caps total room metadata at 16 kB (enforced server-side,
 * see the "over size limit of 16 kB" error thrown from OBR's own bundle on
 * a setMetadata call that would exceed it). This app's cross-scene cache
 * stores one full CharacterSheetData per character under room metadata, so
 * a handful of characters can approach that ceiling on its own -- and every
 * write that mirrors into it is wrapped in a best-effort try/catch, so a
 * rejection here has been failing silently. Run this first to see how much
 * headroom the room actually has and what's using it.
 */
async function roomMetadataSize() {
  const roomMetadata = await OBR.room.getMetadata();
  const rows = Object.keys(roomMetadata)
    .map((key) => ({ key, bytes: new Blob([JSON.stringify(roomMetadata[key])]).size }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`Total room metadata: ${total} bytes / 16384 byte limit (${rows.length} keys)`);
  console.table(rows);
  return { total, rows };
}

/**
 * Deletion first, in its own setMetadata call, so a room sitting right at
 * the 16 kB ceiling has the best chance of the merge fitting at all --
 * shrinking the loser's entries before adding the (much smaller) portrait
 * repoints and owner copy in a second call.
 */
async function mergeCharacters(loserId: string, keeperId: string) {
  const roomMetadata = await OBR.room.getMetadata();

  await OBR.room.setMetadata({
    [templateKey(loserId)]: undefined,
    [ownerKey(loserId)]: undefined,
  });
  console.log(`Deleted loser entries for ${loserId}.`);

  const additions: Record<string, unknown> = {};
  for (const key of Object.keys(roomMetadata)) {
    if (key.startsWith(PORTRAIT_KEY_PREFIX) && roomMetadata[key] === loserId) {
      additions[key] = keeperId;
    }
  }
  if (roomMetadata[ownerKey(keeperId)] === undefined && roomMetadata[ownerKey(loserId)] !== undefined) {
    additions[ownerKey(keeperId)] = roomMetadata[ownerKey(loserId)];
  }
  if (Object.keys(additions).length > 0) {
    await OBR.room.setMetadata(additions);
    console.log("Repointed portrait/owner lookups to keeper.");
  }

  const items = await OBR.scene.items.getItems(
    (item) => item.layer === "CHARACTER" && readStoredCharacterId(item) === loserId
  );
  if (items.length > 0) {
    await OBR.scene.items.updateItems(
      items.map((i) => i.id),
      (drafts) => {
        for (const draft of drafts) {
          draft.metadata[CHARACTER_ID_KEY] = keeperId;
        }
      }
    );
  }
  console.log(`Merged ${loserId} -> ${keeperId}; restamped ${items.length} token(s) in current scene.`);
}

export function installDebugTools() {
  (window as unknown as { __charDebug: unknown }).__charDebug = {
    listDuplicates,
    mergeCharacters,
    roomMetadataSize,
  };
}
