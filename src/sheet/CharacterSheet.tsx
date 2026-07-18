import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OBR, { Item } from "@owlbear-rodeo/sdk";
import { getPluginId } from "../shared/pluginId";
import { createDefaultCharacter } from "../shared/defaultCharacter";
import { AbilityScore, CharacterSheetData } from "../shared/types";

const METADATA_KEY = getPluginId("character");
const SAVE_DEBOUNCE_MS = 300;

function getItemIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("itemId");
}

function readCharacterData(item: Item): CharacterSheetData {
  const stored = item.metadata[METADATA_KEY];
  if (stored && typeof stored === "object") {
    return {
      ...createDefaultCharacter(),
      ...(stored as Partial<CharacterSheetData>),
    };
  }
  return createDefaultCharacter();
}

export function CharacterSheet() {
  const itemId = useMemo(getItemIdFromUrl, []);
  const [data, setData] = useState<CharacterSheetData | null>(null);
  const dataRef = useRef<CharacterSheetData | null>(null);
  const saveTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!itemId) {
      return;
    }
    let mounted = true;

    OBR.scene.items.getItems([itemId]).then((items) => {
      if (mounted && items[0]) {
        const loaded = readCharacterData(items[0]);
        dataRef.current = loaded;
        setData(loaded);
      }
    });

    const unsubscribe = OBR.scene.items.onChange((items) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (item && mounted) {
        const loaded = readCharacterData(item);
        dataRef.current = loaded;
        setData(loaded);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
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

  if (!itemId) {
    return (
      <div className="sheet-message">
        No character token selected. Right-click a token and choose
        &ldquo;Character Sheet&rdquo; to open it here.
      </div>
    );
  }

  if (!data) {
    return <div className="sheet-message">Loading character sheet…</div>;
  }

  return (
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
            <div className="box free-to-carry">
              <span className="field-label">Free to Carry</span>
            </div>
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
