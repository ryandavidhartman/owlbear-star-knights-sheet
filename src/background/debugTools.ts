import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { CHARACTER_ID_KEY, listKnownCharacters, readStoredCharacterId } from "../shared/characterTemplates";

const TEMPLATE_KEY_PREFIX = getPluginId("character-template/");
const PORTRAIT_KEY_PREFIX = getPluginId("character-portrait/");
// Dead top-level keys from the pre-e443158 shared-dict cache scheme --
// nothing in current source references these constants at all anymore.
const LEGACY_TEMPLATES_DICT_KEY = getPluginId("character-templates");
const LEGACY_OWNERS_DICT_KEY = getPluginId("character-owners");
// character-template/* and character-owner/* suffixes are always a
// crypto.randomUUID() in current code (see resolveOrAssignCharacterId).
// Between e443158 and bb78804 the same two prefixes were keyed by portrait
// *url* instead -- any such entry is a leftover from that intermediate
// scheme that current code never reads or writes again.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Prints every character-template/* and character-owner/* entry with its
 * full (untruncated) key, whether its suffix is a current-scheme UUID or a
 * leftover portrait-url from the intermediate scheme, its data's name (for
 * template entries), and its byte size -- so leftover entries from old
 * schema versions (see the LEGACY_* comment above) can be told apart from
 * live ones before deleting anything.
 */
async function auditTemplateKeys() {
  const roomMetadata = await OBR.room.getMetadata();
  const rows: Array<{ shape: string; name: string; bytes: number; key: string }> = [];

  for (const key of Object.keys(roomMetadata)) {
    if (key.startsWith(TEMPLATE_KEY_PREFIX)) {
      const suffix = key.slice(TEMPLATE_KEY_PREFIX.length);
      const value = roomMetadata[key] as { data?: { name?: string }; name?: string } | undefined;
      rows.push({
        shape: UUID_RE.test(suffix) ? "LIVE (characterId)" : "STALE (old portrait-url key)",
        name: value?.data?.name ?? value?.name ?? "(no name)",
        bytes: new Blob([JSON.stringify(value)]).size,
        key,
      });
    }
  }
  for (const legacyKey of [LEGACY_TEMPLATES_DICT_KEY, LEGACY_OWNERS_DICT_KEY]) {
    if (roomMetadata[legacyKey] !== undefined) {
      rows.push({
        shape: "STALE (dead shared-dict key)",
        name: "(whole dict, pre-e443158 scheme)",
        bytes: new Blob([JSON.stringify(roomMetadata[legacyKey])]).size,
        key: legacyKey,
      });
    }
  }

  for (const row of rows) {
    console.log(`${row.shape}  bytes=${row.bytes}  name="${row.name}"  key=${row.key}`);
  }
  return rows;
}

/**
 * Deletes every confirmed-dead legacy key: the two pre-e443158 shared-dict
 * keys, plus any character-template/* or character-owner/* entry whose
 * suffix isn't a UUID (leftover from the intermediate portrait-url-keyed
 * scheme). None of these are read or written by any code still in this
 * repo -- see the LEGACY_* / UUID_RE comment above. Safe to run repeatedly;
 * a second run just finds nothing left to delete.
 */
async function cleanupLegacyKeys() {
  const roomMetadata = await OBR.room.getMetadata();
  const update: Record<string, unknown> = {};

  for (const legacyKey of [LEGACY_TEMPLATES_DICT_KEY, LEGACY_OWNERS_DICT_KEY]) {
    if (roomMetadata[legacyKey] !== undefined) {
      update[legacyKey] = undefined;
    }
  }
  for (const key of Object.keys(roomMetadata)) {
    const prefix = key.startsWith(TEMPLATE_KEY_PREFIX)
      ? TEMPLATE_KEY_PREFIX
      : key.startsWith(getPluginId("character-owner/"))
        ? getPluginId("character-owner/")
        : null;
    if (prefix && !UUID_RE.test(key.slice(prefix.length))) {
      update[key] = undefined;
    }
  }

  const freedBytes = Object.keys(update).reduce(
    (sum, key) => sum + new Blob([JSON.stringify(roomMetadata[key])]).size,
    0
  );
  if (Object.keys(update).length === 0) {
    console.log("Nothing legacy left to delete.");
    return;
  }
  await OBR.room.setMetadata(update);
  console.log(`Deleted ${Object.keys(update).length} legacy key(s), freeing ~${freedBytes} bytes.`);
}

export function installDebugTools() {
  (window as unknown as { __charDebug: unknown }).__charDebug = {
    listDuplicates,
    mergeCharacters,
    roomMetadataSize,
    auditTemplateKeys,
    cleanupLegacyKeys,
  };
}
