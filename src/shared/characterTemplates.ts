import OBR, { Item, isImage } from "@owlbear-rodeo/sdk";
import { getPluginId } from "./pluginId";
import { CharacterSheetData } from "./types";

/**
 * Character data lives on a token's own item.metadata, so a brand new
 * token -- e.g. the same character's portrait dragged into a different
 * scene -- gets its own blank sheet: it's a different item id with no
 * metadata of its own. To carry a character's data across scenes, every
 * save also mirrors into room metadata (which, unlike scene items, isn't
 * scoped to one scene), and a fresh token with no sheet of its own falls
 * back to whatever's cached there.
 *
 * The cache is keyed by a stable per-character id (CHARACTER_ID_KEY),
 * stamped once into a token's own metadata, rather than by portrait image
 * url. Two things would go wrong keying directly on url: (1) if a
 * character's art is later swapped (e.g. a "wounded" variant), the mirror
 * would silently start writing to a new url-keyed slot, orphaning the old
 * one and breaking any other scene's token still on the old art; (2) there
 * is no way to migrate -- the id is what makes a character's identity
 * survive an art change at all.
 *
 * The id itself still has to come from *somewhere* the first time a token
 * is seen, though -- there's no id in the OBR SDK for "this image is the
 * same asset as that image" beyond the url itself. So a `portraitUrl ->
 * characterId` lookup table is built up over time (see
 * readCharacterIdForPortrait / mirrorCharacterTemplateIfNewer): the first
 * time a given portrait is saved under a character, that association is
 * recorded, and any later token sharing that exact portrait resolves to the
 * same character automatically. A token whose portrait has genuinely never
 * been seen before -- new art, no prior save under it anywhere -- can't be
 * resolved automatically at all; see resolveOrAssignCharacterId and the
 * "link to an existing character" picker in CharacterSheet.tsx for how that
 * case is handled.
 *
 * Each token also stamps its own metadata with the time of its last save
 * (TIMESTAMP_KEY). Both the token-mirroring in CharacterSheet.tsx and the
 * background scan in backfillCharacterTemplates.ts only ever let a *newer*
 * save overwrite the shared cache -- otherwise, whichever scene happened to
 * load or get scanned most recently would always win regardless of which
 * token was actually edited more recently, silently erasing older-but-still
 * different data elsewhere with no way to tell the two had ever diverged.
 *
 * Each character's cache entry (template and owner) lives under its own
 * top-level room metadata key, keyed by characterId, and each known
 * portrait similarly gets its own top-level lookup key. OBR.room.setMetadata
 * merges at the top level -- only the keys you pass are touched, everything
 * else is left alone -- so one character's write can never race with a
 * concurrent write for a *different* character. A shared dict would need a
 * local read-merge-write of the whole thing on every save, and with several
 * players saving different characters around the same moment, one save's
 * merge could be built from a read that predates another save's write,
 * silently dropping it when both write back.
 */
export const METADATA_KEY = getPluginId("character");
export const TIMESTAMP_KEY = getPluginId("character-updated-at");
export const CHARACTER_ID_KEY = getPluginId("character-id");

export interface CharacterTemplateEntry {
  data: CharacterSheetData;
  /** `Date.now()` at the time this data was saved on its source token. */
  updatedAt: number;
}

export interface KnownCharacter {
  characterId: string;
  name: string;
  data: CharacterSheetData;
}

const TEMPLATE_KEY_PREFIX = getPluginId("character-template/");

function templateMetadataKey(characterId: string): string {
  return `${TEMPLATE_KEY_PREFIX}${characterId}`;
}

function ownerMetadataKey(characterId: string): string {
  return getPluginId(`character-owner/${characterId}`);
}

function portraitLookupKey(portraitUrl: string): string {
  return getPluginId(`character-portrait/${portraitUrl}`);
}

export function getPortraitUrl(item: Item): string | null {
  return isImage(item) ? item.image.url : null;
}

export function readStoredCharacterData(item: Item): CharacterSheetData | undefined {
  const stored = item.metadata[METADATA_KEY];
  return stored && typeof stored === "object" ? (stored as CharacterSheetData) : undefined;
}

export function readStoredCharacterId(item: Item): string | null {
  const stored = item.metadata[CHARACTER_ID_KEY];
  return typeof stored === "string" ? stored : null;
}

/**
 * A token saved before TIMESTAMP_KEY existed has no timestamp of its own --
 * treat it as the oldest possible save (0) so any genuinely-timestamped
 * data elsewhere is preferred, without needing a special-cased migration.
 */
export function readStoredUpdatedAt(item: Item): number {
  const stored = item.metadata[TIMESTAMP_KEY];
  return typeof stored === "number" ? stored : 0;
}

/**
 * Templates written before this entry shape existed are a bare
 * CharacterSheetData, not `{ data, updatedAt }`. Normalize those to the new
 * shape with `updatedAt: 0` (oldest), same reasoning as readStoredUpdatedAt.
 */
function normalizeTemplateEntry(raw: unknown): CharacterTemplateEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if ("data" in raw && "updatedAt" in raw) {
    return raw as CharacterTemplateEntry;
  }
  return { data: raw as CharacterSheetData, updatedAt: 0 };
}

export function readCachedTemplate(
  roomMetadata: Record<string, unknown>,
  characterId: string
): CharacterTemplateEntry | undefined {
  return normalizeTemplateEntry(roomMetadata[templateMetadataKey(characterId)]);
}

/** Last-known `createdUserId` (the token's "Owner") for a character. */
export function readCachedOwner(
  roomMetadata: Record<string, unknown>,
  characterId: string
): string | undefined {
  const owner = roomMetadata[ownerMetadataKey(characterId)];
  return typeof owner === "string" ? owner : undefined;
}

export function readCharacterIdForPortrait(
  roomMetadata: Record<string, unknown>,
  portraitUrl: string
): string | undefined {
  const id = roomMetadata[portraitLookupKey(portraitUrl)];
  return typeof id === "string" ? id : undefined;
}

/** Every character with a cache entry, for the "link to an existing character" picker. */
export function listKnownCharacters(roomMetadata: Record<string, unknown>): KnownCharacter[] {
  const results: KnownCharacter[] = [];
  for (const key of Object.keys(roomMetadata)) {
    if (!key.startsWith(TEMPLATE_KEY_PREFIX)) {
      continue;
    }
    const entry = normalizeTemplateEntry(roomMetadata[key]);
    if (entry) {
      results.push({
        characterId: key.slice(TEMPLATE_KEY_PREFIX.length),
        name: entry.data.name || "(unnamed)",
        data: entry.data,
      });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function stampCharacterId(itemId: string, characterId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (items) => {
      const item = items[0];
      // Guard against a concurrent resolve already having stamped this --
      // never let a second resolution overwrite an id that's already set.
      if (item && !item.metadata[CHARACTER_ID_KEY]) {
        item.metadata[CHARACTER_ID_KEY] = characterId;
      }
    });
  } catch {
    // best-effort; see file-level doc comment
  }
}

/**
 * Finds (or, for an already-filled but not-yet-migrated token, mints) the
 * stable characterId for an item, in this order:
 *  1. Already stamped on this item -- use it.
 *  2. Its portrait is already linked to a known character -- adopt that id
 *     and stamp it, so this token no longer depends on the lookup surviving.
 *  3. It already has its own sheet data (a pre-existing character that
 *     predates characterId, or whose portrait diverged from its siblings)
 *     -- mint a fresh id now so it has a stable identity going forward, and
 *     register its portrait so any sibling scanned later converges onto it.
 *  4. Otherwise it's a genuinely blank, unlinked token -- return null. The
 *     caller can offer manual linking (see CharacterSheet.tsx); a fresh id
 *     is minted the first time it's actually saved.
 *
 * Never throws -- callers' own authoritative saves/reads must not be
 * affected if the write side of this fails.
 */
export async function resolveOrAssignCharacterId(
  item: Item,
  roomMetadata: Record<string, unknown>
): Promise<string | null> {
  const own = readStoredCharacterId(item);
  if (own) {
    return own;
  }

  const portraitUrl = getPortraitUrl(item);
  const fromPortrait = portraitUrl ? readCharacterIdForPortrait(roomMetadata, portraitUrl) : undefined;
  if (fromPortrait) {
    await stampCharacterId(item.id, fromPortrait);
    return fromPortrait;
  }

  if (!readStoredCharacterData(item)) {
    return null;
  }

  const characterId = crypto.randomUUID();
  await stampCharacterId(item.id, characterId);
  if (portraitUrl) {
    try {
      await OBR.room.setMetadata({ [portraitLookupKey(portraitUrl)]: characterId });
    } catch {
      // best-effort; see file-level doc comment
    }
  }
  return characterId;
}

/**
 * Best-effort write of one character's template entry into room metadata --
 * but only if `updatedAt` is newer than (or there's no) existing entry for
 * this character, so a stale scan/load can never clobber a more recently-
 * edited version elsewhere. Also (re-)registers this portrait as belonging
 * to this character, regardless of the updatedAt check -- so a portrait
 * that's new to this character (e.g. after an art swap) becomes resolvable
 * for future tokens even from an otherwise-stale save. Writes only this
 * character's own metadata keys (see file-level doc comment), so it can't
 * race with a concurrent save of a different character.
 */
export async function mirrorCharacterTemplateIfNewer(
  characterId: string,
  portraitUrl: string | null,
  data: CharacterSheetData,
  updatedAt: number
): Promise<void> {
  try {
    const roomMetadata = await OBR.room.getMetadata();
    const update: Record<string, unknown> = {};

    const existing = readCachedTemplate(roomMetadata, characterId);
    if (!existing || existing.updatedAt < updatedAt) {
      update[templateMetadataKey(characterId)] = { data, updatedAt } satisfies CharacterTemplateEntry;
    }
    if (portraitUrl && readCharacterIdForPortrait(roomMetadata, portraitUrl) !== characterId) {
      update[portraitLookupKey(portraitUrl)] = characterId;
    }
    if (Object.keys(update).length > 0) {
      await OBR.room.setMetadata(update);
    }
  } catch {
    // best-effort; see doc comment above
  }
}

/**
 * Same idea as mirrorCharacterTemplateIfNewer, but for a token's Owner
 * (`createdUserId`) instead of its sheet data. A token dropped onto a scene
 * always starts owned by whoever created it (usually the GM), so this is
 * what lets a fresh token for a character the GM has already handed off to
 * a player pick up that player as owner automatically instead of requiring
 * a manual "Owner" reassignment every time (see backfillCharacterTemplates).
 */
export async function mirrorCharacterOwner(characterId: string, ownerId: string): Promise<void> {
  try {
    const roomMetadata = await OBR.room.getMetadata();
    if (readCachedOwner(roomMetadata, characterId) === ownerId) {
      return;
    }
    await OBR.room.setMetadata({ [ownerMetadataKey(characterId)]: ownerId });
  } catch {
    // best-effort; see doc comment above
  }
}
