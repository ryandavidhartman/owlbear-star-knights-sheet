import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { isImage, Item, Metadata } from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { SELECTED_ITEM_CHANNEL, SELECTED_ITEM_STORAGE_KEY } from "../shared/selection";
import { createDefaultCharacter } from "../shared/defaultCharacter";
import { AbilityScore, CharacterSheetData } from "../shared/types";
import { FloatingWindow } from "./FloatingWindow";

const METADATA_KEY = getPluginId("character");
const SAVE_DEBOUNCE_MS = 300;
const WINDOW_SIZE_STORAGE_KEY = "sotsk-character-sheet-window-size";

/**
 * Character data lives on the token's own item.metadata, so a brand new
 * token -- e.g. the same character's portrait dragged into a different
 * scene -- gets its own blank sheet: it's a different item id with no
 * metadata of its own. To carry a character's data across scenes, we mirror
 * each save into room metadata (which, unlike scene items, isn't scoped to
 * one scene) keyed by the token's image url, and use it to pre-fill a fresh
 * token that shares that portrait but has no sheet data of its own yet.
 */
const ROOM_TEMPLATES_KEY = getPluginId("character-templates");

type CharacterTemplates = Record<string, CharacterSheetData>;

function getTemplateKey(item: Item): string | null {
  return isImage(item) ? item.image.url : null;
}

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
  const saveTimeout = useRef<number | undefined>(undefined);
  const resizeFrame = useRef<number | undefined>(undefined);
  // Which cross-scene template (keyed by portrait image url) this token's
  // data should be mirrored to on save, if any.
  const templateKeyRef = useRef<string | null>(null);

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
    templateKeyRef.current = null;

    Promise.all([
      OBR.scene.items.getItems([itemId]),
      // Best-effort: the cross-scene template cache is a nice-to-have. If
      // it's unavailable for any reason, fall back to an empty object so a
      // token's own already-saved metadata still loads normally.
      OBR.room.getMetadata().catch((): Metadata => ({})),
    ]).then(([items, roomMetadata]) => {
      const item = items[0];
      if (!mounted || !item) {
        return;
      }
      const templateKey = getTemplateKey(item);
      templateKeyRef.current = templateKey;
      const templates = roomMetadata[ROOM_TEMPLATES_KEY] as CharacterTemplates | undefined;
      const template = templateKey ? templates?.[templateKey] : undefined;
      const loaded = readCharacterData(item, template);
      dataRef.current = loaded;
      setData(loaded);
    });

    const unsubscribe = OBR.scene.items.onChange((items) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (item && mounted) {
        const loaded = readCharacterData(item);
        if (JSON.stringify(loaded) === JSON.stringify(dataRef.current)) {
          // onChange fires for every scene mutation (token drags, drawings,
          // fog, etc.), not just edits to this item's metadata. Skip the
          // re-render when nothing actually changed so unrelated scene
          // activity doesn't stomp on in-progress typing.
          return;
        }
        dataRef.current = loaded;
        setData(loaded);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
      // Cancel any pending debounced save for the character we're
      // switching away from -- otherwise it could fire after `dataRef`
      // has moved on to the newly-selected character's data and write
      // the wrong data to the wrong item.
      window.clearTimeout(saveTimeout.current);
    };
  }, [itemId]);

  const scheduleSave = useCallback(() => {
    if (!itemId) {
      return;
    }
    window.clearTimeout(saveTimeout.current);
    saveTimeout.current = window.setTimeout(() => {
      const current = dataRef.current;
      if (!current) {
        return;
      }
      OBR.scene.items.updateItems([itemId], (items) => {
        const item = items[0];
        if (item) {
          item.metadata[METADATA_KEY] = current;
        }
      });

      const templateKey = templateKeyRef.current;
      if (templateKey) {
        // Best-effort mirror into the cross-scene template cache; the
        // token's own metadata above is the authoritative save and must
        // not be affected if this fails (e.g. permissions, transient error).
        OBR.room
          .getMetadata()
          .then((roomMetadata) => {
            const templates = {
              ...(roomMetadata[ROOM_TEMPLATES_KEY] as CharacterTemplates | undefined),
            };
            templates[templateKey] = current;
            return OBR.room.setMetadata({ [ROOM_TEMPLATES_KEY]: templates });
          })
          .catch(() => {
            // best-effort; the per-token save above already succeeded
          });
      }
    }, SAVE_DEBOUNCE_MS);
  }, [itemId]);

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
