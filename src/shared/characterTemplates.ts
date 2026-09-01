import OBR, { Item, isImage } from "@owlbear-rodeo/sdk";
import { getPluginId } from "./pluginId";
import { CharacterSheetData } from "./types";

/**
 * Character data lives on a token's own item.metadata, so a brand new
 * token -- e.g. the same character's portrait dragged into a different
 * scene -- gets its own blank sheet: it's a different item id with no
 * metadata of its own. To carry a character's data across scenes, every
 * save also mirrors into room metadata (which, unlike scene items, isn't
 * scoped to one scene) keyed by the token's image url, and a fresh token
 * that shares that portrait but has no sheet data of its own falls back to
 * whatever's cached here.
 */
export const METADATA_KEY = getPluginId("character");
export const ROOM_TEMPLATES_KEY = getPluginId("character-templates");
export const ROOM_OWNERS_KEY = getPluginId("character-owners");

export type CharacterTemplates = Record<string, CharacterSheetData>;
/** Portrait image url -> last-known `createdUserId` (the token's "Owner"). */
export type CharacterOwners = Record<string, string>;

export function getTemplateKey(item: Item): string | null {
  return isImage(item) ? item.image.url : null;
}

export function readStoredCharacterData(item: Item): CharacterSheetData | undefined {
  const stored = item.metadata[METADATA_KEY];
  return stored && typeof stored === "object" ? (stored as CharacterSheetData) : undefined;
}

/**
 * Best-effort read-modify-write merge of one template entry into room
 * metadata. Never throws -- callers' own authoritative saves/reads must not
 * be affected if this fails (permissions, transient error, etc).
 */
export async function mirrorCharacterTemplate(
  templateKey: string,
  data: CharacterSheetData
): Promise<void> {
  try {
    const roomMetadata = await OBR.room.getMetadata();
    const templates = {
      ...(roomMetadata[ROOM_TEMPLATES_KEY] as CharacterTemplates | undefined),
    };
    templates[templateKey] = data;
    await OBR.room.setMetadata({ [ROOM_TEMPLATES_KEY]: templates });
  } catch {
    // best-effort; see doc comment above
  }
}

/**
 * Same idea as mirrorCharacterTemplate, but for a token's Owner
 * (`createdUserId`) instead of its sheet data. A token dropped onto a scene
 * always starts owned by whoever created it (usually the GM), so this is
 * what lets a fresh token for a character the GM has already handed off to
 * a player pick up that player as owner automatically instead of requiring
 * a manual "Owner" reassignment every time (see applyCachedOwners).
 */
export async function mirrorCharacterOwner(templateKey: string, ownerId: string): Promise<void> {
  try {
    const roomMetadata = await OBR.room.getMetadata();
    const owners = {
      ...(roomMetadata[ROOM_OWNERS_KEY] as CharacterOwners | undefined),
    };
    if (owners[templateKey] === ownerId) {
      return;
    }
    owners[templateKey] = ownerId;
    await OBR.room.setMetadata({ [ROOM_OWNERS_KEY]: owners });
  } catch {
    // best-effort; see doc comment above
  }
}
