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

async function mergeCharacters(loserId: string, keeperId: string) {
  const roomMetadata = await OBR.room.getMetadata();
  const update: Record<string, unknown> = {};

  for (const key of Object.keys(roomMetadata)) {
    if (key.startsWith(PORTRAIT_KEY_PREFIX) && roomMetadata[key] === loserId) {
      update[key] = keeperId;
    }
  }

  if (roomMetadata[ownerKey(keeperId)] === undefined && roomMetadata[ownerKey(loserId)] !== undefined) {
    update[ownerKey(keeperId)] = roomMetadata[ownerKey(loserId)];
  }

  update[templateKey(loserId)] = undefined;
  update[ownerKey(loserId)] = undefined;

  await OBR.room.setMetadata(update);

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
  (window as unknown as { __charDebug: unknown }).__charDebug = { listDuplicates, mergeCharacters };
}
