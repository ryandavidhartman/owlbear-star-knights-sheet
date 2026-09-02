import OBR from "@owlbear-rodeo/sdk";
import {
  getPortraitUrl,
  mirrorCharacterOwner,
  mirrorCharacterTemplateIfNewer,
  readCachedOwner,
  readCachedTemplate,
  readCharacterIdForPortrait,
  readStoredCharacterData,
  readStoredUpdatedAt,
  resolveOrAssignCharacterId,
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
 *
 * This is also what migrates characters saved before characterId existed:
 * resolveOrAssignCharacterId mints an id the first time an already-filled
 * token without one is scanned. If that character has sibling tokens with
 * the same portrait in other scenes, they'll pick up the same id (via the
 * portrait lookup this registers) the next time *they're* scanned --
 * scenes converge on one id per character over a backfill pass or two as
 * the GM cycles through them, with no retyping required. Two sibling
 * tokens scanned in the very same pass, before either write lands, can
 * briefly mint two different ids for one character; a subsequent pass
 * (this runs on every scene change) reconciles it once the first write is
 * visible.
 */
export async function backfillCharacterTemplates() {
  try {
    const [items, roomMetadata, role] = await Promise.all([
      OBR.scene.items.getItems((item) => item.layer === "CHARACTER"),
      OBR.room.getMetadata(),
      OBR.player.getRole(),
    ]);
    // Only the GM's client attempts to reassign Owner -- players generally
    // lack permission to change ownership on tokens they don't already own,
    // and there's no reason for every connected client to race to do it.
    const canReassignOwner = role === "GM";

    for (const item of items) {
      const stored = readStoredCharacterData(item);
      if (stored) {
        // This token has its own filled-in sheet. Resolve (or, if it
        // predates characterId, mint) its stable id, then only push it
        // into the cross-scene cache if it's actually newer than what's
        // cached -- otherwise the mere act of loading/scanning whatever
        // scene this token happens to sit in would clobber a more
        // recently-edited version of the same character saved elsewhere.
        const characterId = await resolveOrAssignCharacterId(item, roomMetadata);
        if (!characterId) {
          continue;
        }
        const updatedAt = readStoredUpdatedAt(item);
        const cached = readCachedTemplate(roomMetadata, characterId);
        if (!cached || cached.updatedAt < updatedAt) {
          await mirrorCharacterTemplateIfNewer(characterId, getPortraitUrl(item), stored, updatedAt);
        }
        if (item.createdUserId && readCachedOwner(roomMetadata, characterId) !== item.createdUserId) {
          await mirrorCharacterOwner(characterId, item.createdUserId);
        }
        continue;
      }

      // No sheet of its own yet -- a fresh/blank token. Don't mint an id
      // for it here (that's only for tokens that actually have data, or
      // the moment a blank one is first saved) -- just check whether its
      // portrait already resolves to a known character, and if so, pull
      // that character's cached Owner onto it instead of making someone
      // reassign it by hand.
      const portraitUrl = getPortraitUrl(item);
      const characterId = portraitUrl ? readCharacterIdForPortrait(roomMetadata, portraitUrl) : undefined;
      const cachedOwner = characterId ? readCachedOwner(roomMetadata, characterId) : undefined;
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
