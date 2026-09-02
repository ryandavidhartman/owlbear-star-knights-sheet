import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Item, Metadata } from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { SELECTED_ITEM_CHANNEL, SELECTED_ITEM_STORAGE_KEY } from "../shared/selection";
import { createDefaultCharacter } from "../shared/defaultCharacter";
import {
  CHARACTER_ID_KEY,
  KnownCharacter,
  METADATA_KEY,
  TIMESTAMP_KEY,
  getPortraitUrl,
  listKnownCharacters,
  mirrorCharacterTemplateIfNewer,
  readCachedTemplate,
  readStoredCharacterData,
  readStoredUpdatedAt,
  resolveOrAssignCharacterId,
} from "../shared/characterTemplates";
import { AbilityScore, CharacterSheetData } from "../shared/types";
import { FloatingWindow } from "./FloatingWindow";

const SAVE_DEBOUNCE_MS = 300;
const WINDOW_SIZE_STORAGE_KEY = "sotsk-character-sheet-window-size";

function loadSavedWindowSize(): { width: number; height: number } | null {
  try {
    const raw = window.localStorage.getItem(WINDOW_SIZE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<{ width: number; height: number }>;
    if (typeof parsed.width === "number" && typeof parsed.height === "number") {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {
    // per-viewer convenience only; ignore malformed/inaccessible storage
  }
  return null;
}

function getItemIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("itemId");
}

/**
 * The action panel's URL is fixed (declared once in manifest.json), so it
 * can't carry a per-click `itemId` query param the way the old Modal/Popover
 * URLs did. Fall back to whatever token was most recently right-clicked
 * (see src/shared/selection.ts), so reopening the panel shows the last
 * character you were viewing.
 */
function getInitialItemId(): string | null {
  const fromUrl = getItemIdFromUrl();
  if (fromUrl) {
    return fromUrl;
  }
  try {
    return window.localStorage.getItem(SELECTED_ITEM_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readCharacterData(item: Item, template?: CharacterSheetData): CharacterSheetData {
  const stored = item.metadata[METADATA_KEY];
  if (stored && typeof stored === "object") {
    return {
      ...createDefaultCharacter(),
      ...(stored as Partial<CharacterSheetData>),
    };
  }
  if (template) {
    return {
      ...createDefaultCharacter(),
      ...template,
    };
  }
  return createDefaultCharacter();
}

export function CharacterSheet() {
  const [itemId, setItemId] = useState<string | null>(getInitialItemId);
  const [data, setData] = useState<CharacterSheetData | null>(null);
  const dataRef = useRef<CharacterSheetData | null>(null);
  // What we last confirmed is (or, for a template-prefilled token that
  // hasn't saved yet, deterministically resolves to) actually stored on the
  // item -- distinct from dataRef, which also holds keystrokes typed since
  // the last debounced save. onChange fires on every scene mutation, not
  // just edits to this item, so it must diff against "what's stored" here,
  // not against the in-progress edit buffer -- otherwise any unrelated scene
  // activity (another player's token move, a drawing, our own save echoing
  // back) that lands while a keystroke is still unsaved looks like an
  // external change and reverts the buffer, discarding that keystroke.
  const lastSyncedRef = useRef<CharacterSheetData | null>(null);
  // True from the moment an edit is scheduled until performSave actually
  // runs -- lets the unmount/switch cleanup below flush a pending debounced
  // save instead of just cancelling it and losing the edit.
  const dirtyRef = useRef(false);
  const saveTimeout = useRef<number | undefined>(undefined);
  const resizeFrame = useRef<number | undefined>(undefined);
  // This token's own portrait image url -- used to resolve/adopt a
  // characterId on load, and re-registered against that id on every save
  // (see mirrorCharacterTemplateIfNewer) so the cache keeps learning which
  // portraits belong to which character even as art changes over time.
  const portraitUrlRef = useRef<string | null>(null);
  // The stable id this token's data is mirrored to in the cross-scene cache,
  // if one has been resolved yet. Null means this token is blank and
  // unlinked -- no id of its own, no portrait match -- in which case the
  // "link to an existing character" picker is offered, and a fresh id is
  // minted the moment this token is actually saved (see performSave).
  const characterIdRef = useRef<string | null>(null);
  // The template data itself, so the onChange listener below can fall back
  // to it the same way the initial load does -- otherwise any unrelated
  // scene mutation (another token moving, a drawing, etc.) on a token that
  // hasn't had its own metadata saved yet would blank the sheet back out.
  const cachedTemplateRef = useRef<CharacterSheetData | undefined>(undefined);
  // Cross-scene template as it stood at load time, captured whenever this
  // token already had its own data that plainly differs from it -- i.e.
  // some other token sharing this portrait was saved with different data.
  // Drives the "differs from another scene" banner. We never auto-apply
  // this over the token's own data (see the "warn, don't overwrite"
  // decision) -- only an explicit click on the banner's sync button does.
  const [templateMismatch, setTemplateMismatch] = useState<CharacterSheetData | null>(null);
  // Populated only for a genuinely blank, unlinked token (no own data, no
  // characterId, no portrait match) -- lets the player pick an existing
  // character by name instead of retyping it or needing a copy/pasted
  // token. See linkToCharacter.
  const [knownCharacters, setKnownCharacters] = useState<KnownCharacter[]>([]);

  const performSave = useCallback((targetItemId: string) => {
    const current = dataRef.current;
    if (!current) {
      return;
    }
    dirtyRef.current = false;
    // A fresh, explicit save from this client is always the newest version
    // of this token's data -- stamp it so cross-scene comparisons (here and
    // in the background scan) can tell it apart from an older save
    // elsewhere sharing the same portrait.
    const updatedAt = Date.now();
    // Record what we're about to write as "known stored" before the write
    // round-trips back through onChange -- otherwise its own echo would
    // look like an external change if more typing has moved dataRef on by
    // the time it arrives (see the onChange comment below).
    lastSyncedRef.current = current;

    // A blank, unlinked token (no id of its own, no portrait match, and
    // nobody used the "link to an existing character" picker) being saved
    // for the first time is a brand new character -- mint it a stable id
    // now rather than leaving it permanently unresolved.
    if (!characterIdRef.current) {
      characterIdRef.current = crypto.randomUUID();
    }
    const characterId = characterIdRef.current;

    OBR.scene.items.updateItems([targetItemId], (items) => {
      const item = items[0];
      if (item) {
        item.metadata[METADATA_KEY] = current;
        item.metadata[TIMESTAMP_KEY] = updatedAt;
        item.metadata[CHARACTER_ID_KEY] = characterId;
      }
    });

    mirrorCharacterTemplateIfNewer(characterId, portraitUrlRef.current, current, updatedAt);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const channel = new BroadcastChannel(SELECTED_ITEM_CHANNEL);
    channel.onmessage = (e) => {
      if (typeof e.data === "string") {
        setItemId(e.data);
      }
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    const saved = loadSavedWindowSize();
    if (saved) {
      OBR.action.setWidth(saved.width);
      OBR.action.setHeight(saved.height);
    }
  }, []);

  const handleResize = useCallback((width: number, height: number) => {
    if (resizeFrame.current !== undefined) {
      cancelAnimationFrame(resizeFrame.current);
    }
    resizeFrame.current = requestAnimationFrame(() => {
      OBR.action.setWidth(width);
      OBR.action.setHeight(height);
      try {
        window.localStorage.setItem(
          WINDOW_SIZE_STORAGE_KEY,
          JSON.stringify({ width, height })
        );
      } catch {
        // per-viewer convenience only; ignore storage failures
      }
    });
  }, []);

  useEffect(() => {
    if (!itemId) {
      return;
    }
    let mounted = true;
    // Switching characters (via a fresh right-click while the panel is
    // already open) should show a loading state, not the previous
    // character's data, while the new one loads.
    setData(null);
    dataRef.current = null;
    lastSyncedRef.current = null;
    dirtyRef.current = false;
    portraitUrlRef.current = null;
    characterIdRef.current = null;
    cachedTemplateRef.current = undefined;
    setTemplateMismatch(null);
    setKnownCharacters([]);

    Promise.all([
      OBR.scene.items.getItems([itemId]),
      // Best-effort: the cross-scene template cache is a nice-to-have. If
      // it's unavailable for any reason, fall back to an empty object so a
      // token's own already-saved metadata still loads normally.
      OBR.room.getMetadata().catch((): Metadata => ({})),
    ]).then(async ([items, roomMetadata]) => {
      const item = items[0];
      if (!mounted || !item) {
        return;
      }
      const portraitUrl = getPortraitUrl(item);
      portraitUrlRef.current = portraitUrl;

      const characterId = await resolveOrAssignCharacterId(item, roomMetadata);
      if (!mounted) {
        return;
      }
      characterIdRef.current = characterId;

      const cachedTemplate = characterId ? readCachedTemplate(roomMetadata, characterId) : undefined;
      cachedTemplateRef.current = cachedTemplate?.data;
      const loaded = readCharacterData(item, cachedTemplate?.data);
      dataRef.current = loaded;
      lastSyncedRef.current = loaded;
      setData(loaded);

      // This token already has its own saved data (not the template
      // fallback). Compare it against the cross-scene cache:
      //  - if they plainly differ, surface the banner regardless of which
      //    is newer, so the user finds out instead of it being silently
      //    resolved one way or the other.
      //  - separately (and independent of the banner), only let this
      //    token's data become the new shared cache if it's actually the
      //    newer save -- otherwise merely opening/scanning an older scene
      //    would clobber a more recently-edited version saved elsewhere.
      const ownData = readStoredCharacterData(item);
      if (ownData && characterId) {
        if (cachedTemplate && JSON.stringify(cachedTemplate.data) !== JSON.stringify(ownData)) {
          setTemplateMismatch(cachedTemplate.data);
        }
        mirrorCharacterTemplateIfNewer(characterId, portraitUrl, ownData, readStoredUpdatedAt(item));
      } else if (!ownData && !characterId) {
        // Genuinely blank and unlinked -- no id, no portrait match. Offer
        // to link to an existing character instead of leaving the player
        // to type everything from scratch.
        setKnownCharacters(listKnownCharacters(roomMetadata));
      }
    });

    const unsubscribe = OBR.scene.items.onChange((items) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (item && mounted) {
        const loaded = readCharacterData(item, cachedTemplateRef.current);
        if (JSON.stringify(loaded) === JSON.stringify(lastSyncedRef.current)) {
          // onChange fires for every scene mutation (token drags, drawings,
          // fog, another player's unrelated edit, our own save echoing
          // back, etc.), not just edits to this item's metadata. Skip the
          // re-render when what's stored hasn't actually moved from what we
          // last observed, so unrelated scene activity -- or our own write
          // round-tripping back after further typing has already moved the
          // buffer on -- doesn't stomp in-progress edits.
          return;
        }
        lastSyncedRef.current = loaded;
        dataRef.current = loaded;
        setData(loaded);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
      window.clearTimeout(saveTimeout.current);
      // Flush rather than drop a save that was scheduled but hasn't fired
      // yet for the character we're switching away from -- otherwise those
      // last keystrokes are silently lost instead of written.
      if (dirtyRef.current) {
        performSave(itemId);
      }
    };
  }, [itemId, performSave]);

  const scheduleSave = useCallback(() => {
    if (!itemId) {
      return;
    }
    dirtyRef.current = true;
    window.clearTimeout(saveTimeout.current);
    saveTimeout.current = window.setTimeout(() => {
      performSave(itemId);
    }, SAVE_DEBOUNCE_MS);
  }, [itemId, performSave]);

  const update = useCallback(
    (updater: (draft: CharacterSheetData) => CharacterSheetData) => {
      setData((prev) => {
        if (!prev) {
          return prev;
        }
        const next = updater(prev);
        dataRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  const setField = useCallback(
    <K extends keyof CharacterSheetData>(key: K, value: CharacterSheetData[K]) => {
      update((prev) => ({ ...prev, [key]: value }));
    },
    [update]
  );

  const setAbility = useCallback(
    (ability: keyof CharacterSheetData["abilities"], value: AbilityScore) => {
      update((prev) => ({
        ...prev,
        abilities: { ...prev.abilities, [ability]: value },
      }));
    },
    [update]
  );

  const setGearSlot = useCallback(
    (index: number, value: string) => {
      update((prev) => {
        const gear = [...prev.gear];
        gear[index] = value;
        return { ...prev, gear };
      });
    },
    [update]
  );

  const toggleAetherBox = useCallback(
    (segmentIndex: number, boxIndex: 0 | 1) => {
      update((prev) => {
        const aetherSlider = prev.aetherSlider.map((segment, i) => {
          if (i !== segmentIndex) {
            return segment;
          }
          const boxes: [boolean, boolean] = [...segment.boxes] as [boolean, boolean];
          boxes[boxIndex] = !boxes[boxIndex];
          return { ...segment, boxes };
        });
        return { ...prev, aetherSlider };
      });
    },
    [update]
  );

  const closeWindow = useCallback(() => {
    OBR.action.close();
  }, []);

  const syncFromTemplate = useCallback(() => {
    if (!templateMismatch) {
      return;
    }
    const other = templateMismatch;
    update(() => ({ ...other }));
    setTemplateMismatch(null);
  }, [templateMismatch, update]);

  const dismissMismatch = useCallback(() => {
    setTemplateMismatch(null);
  }, []);

  const linkToCharacter = useCallback(
    (characterId: string) => {
      const chosen = knownCharacters.find((c) => c.characterId === characterId);
      if (!chosen) {
        return;
      }
      characterIdRef.current = chosen.characterId;
      cachedTemplateRef.current = chosen.data;
      setKnownCharacters([]);
      update(() => ({ ...chosen.data }));
    },
    [knownCharacters, update]
  );

  const dismissLinkPicker = useCallback(() => {
    setKnownCharacters([]);
  }, []);

  if (!itemId) {
    return (
      <FloatingWindow title="Character Sheet" onClose={closeWindow} onResize={handleResize}>
        <div className="sheet-message">
          No character token selected. Right-click a token and choose
          &ldquo;Character Sheet&rdquo; to open it here.
        </div>
      </FloatingWindow>
    );
  }

  if (!data) {
    return (
      <FloatingWindow title="Character Sheet" onClose={closeWindow} onResize={handleResize}>
        <div className="sheet-message">Loading character sheet…</div>
      </FloatingWindow>
    );
  }

  return (
    <FloatingWindow
      title={data.name || "Character Sheet"}
      onClose={closeWindow}
      onResize={handleResize}
    >
    <>
    {templateMismatch && (
      <div className="sheet-mismatch-banner">
        <span>
          This token&rsquo;s data differs from another scene&rsquo;s version of this
          character (same portrait).
        </span>
        <div className="sheet-mismatch-actions">
          <button type="button" onClick={syncFromTemplate}>
            Load other version
          </button>
          <button type="button" onClick={dismissMismatch}>
            Dismiss
          </button>
        </div>
      </div>
    )}
    {knownCharacters.length > 0 && (
      <div className="sheet-link-banner">
        <span>
          New token, no character linked yet. If this is an existing character,
          pick it below to load their sheet instead of starting blank.
        </span>
        <div className="sheet-link-actions">
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                linkToCharacter(e.target.value);
              }
            }}
          >
            <option value="" disabled>
              Choose a character…
            </option>
            {knownCharacters.map((c) => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={dismissLinkPicker}>
            Dismiss
          </button>
        </div>
      </div>
    )}
    <div className="sheet">
      <section className="sheet-header">
        <h1 className="sheet-title">
          Shadows of the
          <br />
          Star Knights
        </h1>
        <TextField
          label="Name"
          value={data.name}
          onChange={(v) => setField("name", v)}
          className="name-field"
        />
      </section>

      <section className="sheet-stats">
        <AbilityBox label="Str" ability={data.abilities.str} onChange={(v) => setAbility("str", v)} className="area-str" />
        <AbilityBox label="Int" ability={data.abilities.int} onChange={(v) => setAbility("int", v)} className="area-int" />
        <TextField label="Species" value={data.species} onChange={(v) => setField("species", v)} className="area-species" />

        <AbilityBox label="Dex" ability={data.abilities.dex} onChange={(v) => setAbility("dex", v)} className="area-dex" />
        <AbilityBox label="Wis" ability={data.abilities.wis} onChange={(v) => setAbility("wis", v)} className="area-wis" />
        <TextField label="Class" value={data.class} onChange={(v) => setField("class", v)} className="area-class" />

        <AbilityBox label="Con" ability={data.abilities.con} onChange={(v) => setAbility("con", v)} className="area-con" />
        <AbilityBox label="Cha" ability={data.abilities.cha} onChange={(v) => setAbility("cha", v)} className="area-cha" />
        <TextField label="Level" value={data.level} onChange={(v) => setField("level", v)} className="area-level" />
        <FractionField
          label="XP"
          current={data.xp.current}
          max={data.xp.max}
          onChangeCurrent={(v) => setField("xp", { ...data.xp, current: v })}
          onChangeMax={(v) => setField("xp", { ...data.xp, max: v })}
          className="area-xp"
        />

        <TextField label="HP" value={data.hp} onChange={(v) => setField("hp", v)} className="area-hp box-square" />
        <TextField label="AC" value={data.ac} onChange={(v) => setField("ac", v)} className="area-ac box-square" />
        <TextAreaField label="Attacks" value={data.attacks} onChange={(v) => setField("attacks", v)} className="area-attacks" />

        <TextAreaField label="Alignment" value={data.alignment} onChange={(v) => setField("alignment", v)} className="area-align" rows={2} />
      </section>

      <section className="sheet-talents">
        <TextAreaField
          label="Talents/Aether"
          value={data.talentsAether}
          onChange={(v) => setField("talentsAether", v)}
          className="fill-box"
          rows={16}
        />
      </section>

      <section className="sheet-gear">
        <div className="box gear-box">
          <div className="gear-box-header">
            <span className="field-label">Gear</span>
            <label className="creds-field">
              <span className="creds-label">Creds</span>
              <input value={data.creds} onChange={(e) => setField("creds", e.target.value)} />
            </label>
          </div>
          <div className="gear-body">
            <ol className="gear-list" start={1}>
              {data.gear.slice(0, 10).map((value, i) => (
                <GearRow key={i} index={i} value={value} onChange={setGearSlot} />
              ))}
            </ol>
            <ol className="gear-list" start={11}>
              {data.gear.slice(10, 20).map((value, i) => (
                <GearRow key={i + 10} index={i + 10} value={value} onChange={setGearSlot} />
              ))}
            </ol>
            <TextAreaField
              label="Free to Carry"
              value={data.freeToCarry}
              onChange={(v) => setField("freeToCarry", v)}
              className="free-to-carry"
              rows={10}
            />
          </div>
        </div>
      </section>

      <section className="sheet-slider">
        <span className="field-label slider-title">Aether Slider</span>
        <div className="aether-track">
          {data.aetherSlider.map((segment, i) => (
            <div className="aether-segment" key={segment.label}>
              <div className="aether-segment-label">{segment.label}</div>
              <div className="aether-segment-boxes">
                <button
                  type="button"
                  className={`aether-box ${segment.boxes[0] ? "checked" : ""}`}
                  onClick={() => toggleAetherBox(i, 0)}
                  aria-label={`${segment.label} box 1`}
                />
                <button
                  type="button"
                  className={`aether-box ${segment.boxes[1] ? "checked" : ""}`}
                  onClick={() => toggleAetherBox(i, 1)}
                  aria-label={`${segment.label} box 2`}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
    </>
    </FloatingWindow>
  );
}

function TextField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`box text-field ${className ?? ""}`}>
      <span className="field-label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  className,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  rows?: number;
}) {
  return (
    <label className={`box text-area-field ${className ?? ""}`}>
      <span className="field-label">{label}</span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function AbilityBox({
  label,
  ability,
  onChange,
  className,
}: {
  label: string;
  ability: AbilityScore;
  onChange: (value: AbilityScore) => void;
  className?: string;
}) {
  return (
    <div className={`box ability-box ${className ?? ""}`}>
      <span className="field-label">{label}</span>
      <div className="ability-inputs">
        <input
          className="ability-score"
          value={ability.score}
          onChange={(e) => onChange({ ...ability, score: e.target.value })}
        />
        <span className="ability-slash">/</span>
        <input
          className="ability-mod"
          value={ability.mod}
          onChange={(e) => onChange({ ...ability, mod: e.target.value })}
        />
      </div>
    </div>
  );
}

function FractionField({
  label,
  current,
  max,
  onChangeCurrent,
  onChangeMax,
  className,
}: {
  label: string;
  current: string;
  max: string;
  onChangeCurrent: (value: string) => void;
  onChangeMax: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`box ability-box ${className ?? ""}`}>
      <span className="field-label">{label}</span>
      <div className="ability-inputs">
        <input className="ability-score" value={current} onChange={(e) => onChangeCurrent(e.target.value)} />
        <span className="ability-slash">/</span>
        <input className="ability-mod" value={max} onChange={(e) => onChangeMax(e.target.value)} />
      </div>
    </div>
  );
}

function GearRow({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (index: number, value: string) => void;
}) {
  return (
    <li className="gear-row">
      <input value={value} onChange={(e) => onChange(index, e.target.value)} />
    </li>
  );
}
