import type { City, Diagnosis, Program, Province, TreatmentPhase, UnitOfMeasure } from "@/lib/types/reference";

export const provinces: Province[] = [
  { id: "prov-ncr", name: "Metro Manila", region: "NCR" },
  { id: "prov-cavite", name: "Cavite", region: "Region IV-A" },
  { id: "prov-laguna", name: "Laguna", region: "Region IV-A" },
  { id: "prov-bulacan", name: "Bulacan", region: "Region III" },
  { id: "prov-rizal", name: "Rizal", region: "Region IV-A" },
  { id: "prov-batangas", name: "Batangas", region: "Region IV-A" },
  { id: "prov-pampanga", name: "Pampanga", region: "Region III" },
  { id: "prov-quezon", name: "Quezon", region: "Region IV-A" },
];

export const cities: City[] = [
  { id: "city-manila", provinceId: "prov-ncr", name: "Manila" },
  { id: "city-muntinlupa", provinceId: "prov-ncr", name: "Muntinlupa" },
  { id: "city-quezoncity", provinceId: "prov-ncr", name: "Quezon City" },
  { id: "city-pasay", provinceId: "prov-ncr", name: "Pasay" },
  { id: "city-dasmarinas", provinceId: "prov-cavite", name: "Dasmariñas" },
  { id: "city-santarosa", provinceId: "prov-laguna", name: "Santa Rosa" },
  { id: "city-malolos", provinceId: "prov-bulacan", name: "Malolos" },
  { id: "city-antipolo", provinceId: "prov-rizal", name: "Antipolo" },
  { id: "city-batangascity", provinceId: "prov-batangas", name: "Batangas City" },
  { id: "city-angeles", provinceId: "prov-pampanga", name: "Angeles" },
  { id: "city-lucena", provinceId: "prov-quezon", name: "Lucena" },
];

export const diagnoses: Diagnosis[] = [
  { id: "dx-all", name: "Acute Lymphoblastic Leukemia", category: "cancer" },
  { id: "dx-aml", name: "Acute Myeloid Leukemia", category: "cancer" },
  { id: "dx-wilms", name: "Wilms Tumor", category: "cancer" },
  { id: "dx-osteo", name: "Osteosarcoma", category: "cancer" },
  { id: "dx-neuro", name: "Neuroblastoma", category: "cancer" },
  { id: "dx-retino", name: "Retinoblastoma", category: "cancer" },
  { id: "dx-lymphoma", name: "Hodgkin Lymphoma", category: "cancer" },
  { id: "dx-thal-major", name: "Thalassemia Major", category: "thalassemia" },
  { id: "dx-thal-inter", name: "Thalassemia Intermedia", category: "thalassemia" },
  { id: "dx-other", name: "Other Chronic Illness", category: "other" },
];

export const treatmentPhases: TreatmentPhase[] = [
  { id: "phase-diagnosis", name: "Diagnostic Workup" },
  { id: "phase-induction", name: "Induction Chemotherapy" },
  { id: "phase-consolidation", name: "Consolidation" },
  { id: "phase-maintenance", name: "Maintenance" },
  { id: "phase-transfusion", name: "Regular Transfusion" },
  { id: "phase-surveillance", name: "Post-Treatment Surveillance" },
  { id: "phase-palliative", name: "Palliative / Comfort Care" },
];

export const programs: Program[] = [
  { id: "prog-housing", name: "Housing", description: "Bed nights, accommodation, utilities at LAF House" },
  { id: "prog-meals", name: "Meals", description: "Breakfast, lunch, dinner for resident families" },
  { id: "prog-carecart", name: "Care Cart", description: "Snack and comfort rounds at NCH" },
  { id: "prog-transport", name: "Transportation", description: "Hospital trips, errands, fuel and vehicle upkeep" },
  { id: "prog-activities", name: "Activities", description: "Activity Center sessions at NCH" },
  { id: "prog-spiritual", name: "Spiritual Care", description: "Chaplaincy, counseling, Farewell with Dignity" },
];

export const unitsOfMeasure: UnitOfMeasure[] = [
  { id: "uom-pc", code: "PC", name: "Piece" },
  { id: "uom-tray", code: "TRAY", name: "Tray (30 pc)", baseUnitCode: "PC", conversionFactor: 30 },
  { id: "uom-kg", code: "KG", name: "Kilogram" },
  { id: "uom-pack", code: "PACK", name: "Pack" },
  { id: "uom-can", code: "CAN", name: "Can" },
  { id: "uom-box", code: "BOX", name: "Box" },
  { id: "uom-liter", code: "L", name: "Liter" },
  { id: "uom-sack", code: "SACK", name: "Sack (25 kg)", baseUnitCode: "KG", conversionFactor: 25 },
];
