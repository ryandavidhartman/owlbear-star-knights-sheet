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
 *
 * Each token also stamps its own metadata with the time of its last save
 * (TIMESTAMP_KEY). Both the token-mirroring in CharacterSheet.tsx and the
 * background scan in backfillCharacterTemplates.ts only ever let a *newer*
 * save overwrite the shared cache -- otherwise, whichever scene happened to
 * load or get scanned most recently would always win regardless of which
 * token was actually edited more recently, silently erasing older-but-still
 * different data elsewhere with no way to tell the two had ever diverged.
 */
export const METADATA_KEY = getPluginId("character");
export const TIMESTAMP_KEY = getPluginId("character-updated-at");
export const ROOM_TEMPLATES_KEY = getPluginId("character-templates");
export const ROOM_OWNERS_KEY = getPluginId("character-owners");

export interface CharacterTemplateEntry {
  data: CharacterSheetData;
  /** `Date.now()` at the time this data was saved on its source token. */
  updatedAt: number;
}
export type CharacterTemplates = Record<string, CharacterTemplateEntry>;
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
  templateKey: string
): CharacterTemplateEntry | undefined {
  const templates = roomMetadata[ROOM_TEMPLATES_KEY] as
    | Record<string, unknown>
    | undefined;
  return templates ? normalizeTemplateEntry(templates[templateKey]) : undefined;
}

/**
 * Best-effort read-modify-write merge of one template entry into room
 * metadata -- but only if `updatedAt` is newer than (or there's no) existing
 * entry for this portrait, so a stale scan/load can never clobber a more
 * recently-edited version elsewhere. Never throws -- callers' own
 * authoritative saves/reads must not be affected if this fails (permissions,
 * transient error, etc).
 */
export async function mirrorCharacterTemplateIfNewer(
  templateKey: string,
  data: CharacterSheetData,
  updatedAt: number
): Promise<void> {
  try {
    const roomMetadata = await OBR.room.getMetadata();
    const existing = readCachedTemplate(roomMetadata, templateKey);
    if (existing && existing.updatedAt >= updatedAt) {
      return;
    }
    const templates: Record<string, CharacterTemplateEntry> = {
      ...(roomMetadata[ROOM_TEMPLATES_KEY] as CharacterTemplates | undefined),
    };
    templates[templateKey] = { data, updatedAt };
    await OBR.room.setMetadata({ [ROOM_TEMPLATES_KEY]: templates });
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
