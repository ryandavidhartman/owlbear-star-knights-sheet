export interface AbilityScore {
  score: string;
  mod: string;
}

export interface AbilityScores {
  str: AbilityScore;
  int: AbilityScore;
  dex: AbilityScore;
  wis: AbilityScore;
  con: AbilityScore;
  cha: AbilityScore;
}

/** One segment of the Aether Slider track, e.g. "Noble 9" or "Evil 1" */
export interface AetherSegment {
  label: string;
  boxes: [boolean, boolean];
}

export interface CharacterSheetData {
  name: string;
  species: string;
  class: string;
  level: string;
  xp: {
    current: string;
    max: string;
  };
  hp: string;
  ac: string;
  alignment: string;
  abilities: AbilityScores;
  attacks: string;
  talentsAether: string;
  /** 20 numbered gear slots, rendered as two 10-item columns */
  gear: string[];
  freeToCarry: string;
  creds: string;
  aetherSlider: AetherSegment[];
}
