import OBR from "@owlbear-rodeo/sdk";
import {
  CharacterOwners,
  ROOM_OWNERS_KEY,
  getTemplateKey,
  mirrorCharacterOwner,
  mirrorCharacterTemplateIfNewer,
  readCachedTemplate,
  readStoredCharacterData,
  readStoredUpdatedAt,
} from "../shared/characterTemplates";

/**
 * Seeds the cross-scene template cache (see shared/characterTemplates.ts)
 * from every already-filled character sheet in the current scene, and
 * applies the cached Owner back onto any fresh token of a character the GM
 * has already assigned an owner for elsewhere -- see applyCachedOwners.
 * This is what makes existing characters -- filled in before this cache
 * existed, or in a scene nobody has re-saved since -- pick up
 * automatically, instead of requiring someone to open and re-save each one
 * by hand (or reassign Owner by hand) for a new token elsewhere to find it.
 */
export async function backfillCharacterTemplates() {
  try {
    const [items, roomMetadata, role] = await Promise.all([
      OBR.scene.items.getItems((item) => item.layer === "CHARACTER"),
      OBR.room.getMetadata(),
      OBR.player.getRole(),
    ]);
    const owners = roomMetadata[ROOM_OWNERS_KEY] as CharacterOwners | undefined;
    // Only the GM's client attempts to reassign Owner -- players generally
    // lack permission to change ownership on tokens they don't already own,
    // and there's no reason for every connected client to race to do it.
    const canReassignOwner = role === "GM";

    for (const item of items) {
      const templateKey = getTemplateKey(item);
      if (!templateKey) {
        continue;
      }
      const stored = readStoredCharacterData(item);
      if (stored) {
        // This token has its own filled-in sheet. Only push it into the
        // cross-scene cache if it's actually newer than what's cached --
        // otherwise the mere act of loading/scanning whatever scene this
        // token happens to sit in would clobber a more recently-edited
        // version of the same character saved elsewhere.
        const updatedAt = readStoredUpdatedAt(item);
        const cached = readCachedTemplate(roomMetadata, templateKey);
        if (!cached || cached.updatedAt < updatedAt) {
          await mirrorCharacterTemplateIfNewer(templateKey, stored, updatedAt);
        }
        if (item.createdUserId && owners?.[templateKey] !== item.createdUserId) {
          await mirrorCharacterOwner(templateKey, item.createdUserId);
        }
        continue;
      }

      // No sheet of its own yet -- a fresh token. If this portrait has a
      // known Owner from elsewhere, pull it onto this token instead of
      // making someone reassign it by hand.
      const cachedOwner = owners?.[templateKey];
      if (canReassignOwner && cachedOwner && item.createdUserId !== cachedOwner) {
        await OBR.scene.items.updateItems([item.id], (draft) => {
          const target = draft[0];
          if (target) {
            target.createdUserId = cachedOwner;
          }
        });
      }
    }
  } catch {
    // best-effort; a failed scan just means the cache stays as it was
  }
}
