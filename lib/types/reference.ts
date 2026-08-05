export interface Province {
  id: string;
  name: string;
  region: string;
}

export interface City {
  id: string;
  provinceId: string;
  name: string;
}

export interface Diagnosis {
  id: string;
  name: string;
  category: "cancer" | "thalassemia" | "other";
}

export interface TreatmentPhase {
  id: string;
  name: string;
}

export type ProgramTag =
  | "Housing"
  | "Meals"
  | "Care Cart"
  | "Transportation"
  | "Activities"
  | "Spiritual Care";

export interface Program {
  id: string;
  name: ProgramTag;
  description: string;
}

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  /** how many base units one of this UoM converts to, e.g. 1 TRAY (egg) = 30 PCS */
  baseUnitCode?: string;
  conversionFactor?: number;
}
