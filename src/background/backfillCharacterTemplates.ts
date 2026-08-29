import OBR from "@owlbear-rodeo/sdk";
import {
  CharacterTemplates,
  ROOM_TEMPLATES_KEY,
  getTemplateKey,
  mirrorCharacterTemplate,
  readStoredCharacterData,
} from "../shared/characterTemplates";

/**
 * Seeds the cross-scene template cache (see shared/characterTemplates.ts)
 * from every already-filled character sheet in the current scene. This is
 * what makes existing characters -- filled in before this cache existed, or
 * in a scene nobody has re-saved since -- pick up automatically, instead of
 * requiring someone to open and re-save each one by hand for a new token
 * elsewhere to find it.
 */
export async function backfillCharacterTemplates() {
  try {
    const [items, roomMetadata] = await Promise.all([
      OBR.scene.items.getItems((item) => item.layer === "CHARACTER"),
      OBR.room.getMetadata(),
    ]);
    const templates = roomMetadata[ROOM_TEMPLATES_KEY] as CharacterTemplates | undefined;

    for (const item of items) {
      const templateKey = getTemplateKey(item);
      if (!templateKey) {
        continue;
      }
      const stored = readStoredCharacterData(item);
      if (!stored) {
        continue;
      }
      if (JSON.stringify(templates?.[templateKey]) === JSON.stringify(stored)) {
        continue;
      }
      await mirrorCharacterTemplate(templateKey, stored);
    }
  } catch {
    // best-effort; a failed scan just means the cache stays as it was
  }
}
