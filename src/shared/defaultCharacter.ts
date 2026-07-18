import { AbilityScore, CharacterSheetData } from "./types";

const AETHER_LABELS = [
  "Noble 9",
  "Noble 8",
  "Noble 7",
  "Neutral 6",
  "Neutral 5",
  "Neutral 4",
  "Evil 3",
  "Evil 2",
  "Evil 1",
];

function blankAbility(): AbilityScore {
  return { score: "", mod: "" };
}

export function createDefaultCharacter(): CharacterSheetData {
  return {
    name: "",
    species: "",
    class: "",
    level: "",
    xp: { current: "", max: "" },
    hp: "",
    ac: "",
    alignment: "",
    abilities: {
      str: blankAbility(),
      int: blankAbility(),
      dex: blankAbility(),
      wis: blankAbility(),
      con: blankAbility(),
      cha: blankAbility(),
    },
    attacks: "",
    talentsAether: "",
    gear: Array.from({ length: 20 }, () => ""),
    freeToCarry: "",
    creds: "",
    aetherSlider: AETHER_LABELS.map((label) => ({
      label,
      boxes: [false, false],
    })),
  };
}
