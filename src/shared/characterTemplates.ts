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
 *
 * Each character's cache entry (template and owner) lives under its own
 * top-level room metadata key, keyed by portrait url, rather than nested
 * inside one shared dict. OBR.room.setMetadata merges at the top level --
 * only the keys you pass are touched, everything else is left alone -- so
 * one character's write can never race with a concurrent write for a
 * *different* character. A shared dict would need a local read-merge-write
 * of the whole thing on every save, and with several players saving
 * different characters around the same moment, one save's merge could be
 * built from a read that predates another save's write, silently dropping
 * it when both write back.
 */
export const METADATA_KEY = getPluginId("character");
export const TIMESTAMP_KEY = getPluginId("character-updated-at");

export interface CharacterTemplateEntry {
  data: CharacterSheetData;
  /** `Date.now()` at the time this data was saved on its source token. */
  updatedAt: number;
}

function templateMetadataKey(templateKey: string): string {
  return getPluginId(`character-template/${templateKey}`);
}

function ownerMetadataKey(templateKey: string): string {
  return getPluginId(`character-owner/${templateKey}`);
}

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
  return normalizeTemplateEntry(roomMetadata[templateMetadataKey(templateKey)]);
}

/** Portrait image url -> last-known `createdUserId` (the token's "Owner"). */
export function readCachedOwner(
  roomMetadata: Record<string, unknown>,
  templateKey: string
): string | undefined {
  const owner = roomMetadata[ownerMetadataKey(templateKey)];
  return typeof owner === "string" ? owner : undefined;
}

/**
 * Best-effort write of one character's template entry into room metadata --
 * but only if `updatedAt` is newer than (or there's no) existing entry for
 * this portrait, so a stale scan/load can never clobber a more recently-
 * edited version elsewhere. Writes only this character's own metadata key
 * (see file-level doc comment), so it can't race with a concurrent save of
 * a different character. Never throws -- callers' own authoritative
 * saves/reads must not be affected if this fails (permissions, transient
 * error, etc).
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
    const entry: CharacterTemplateEntry = { data, updatedAt };
    await OBR.room.setMetadata({ [templateMetadataKey(templateKey)]: entry });
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
    if (readCachedOwner(roomMetadata, templateKey) === ownerId) {
      return;
    }
    await OBR.room.setMetadata({ [ownerMetadataKey(templateKey)]: ownerId });
  } catch {
    // best-effort; see doc comment above
  }
}
