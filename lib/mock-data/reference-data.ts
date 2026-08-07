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

// Provinces discovered in the real FINAL_PATIENTS DATABASE that weren't in the
// original curated set above (see DATA/clean/reference-data-delta.json).
provinces.push(
  { id: "prov-agusan", name: "Agusan", region: "" },
  { id: "prov-albay", name: "Albay", region: "" },
  { id: "prov-mindoro", name: "Mindoro", region: "" },
  { id: "prov-catanduanes", name: "Catanduanes", region: "" },
  { id: "prov-marinduque", name: "Marinduque", region: "" },
  { id: "prov-camarines-norte", name: "Camarines Norte", region: "" },
  { id: "prov-camarines-sur", name: "Camarines Sur", region: "" },
  { id: "prov-bataan", name: "Bataan", region: "" },
  { id: "prov-cebu", name: "Cebu", region: "" },
  { id: "prov-manila", name: "Manila", region: "" },
  { id: "prov-masbate", name: "Masbate", region: "" },
  { id: "prov-negros-occidental", name: "Negros Occidental", region: "" },
  { id: "prov-zambales", name: "Zambales", region: "" },
  { id: "prov-western-samar", name: "Western Samar", region: "" },
  { id: "prov-northern-samar", name: "Northern Samar", region: "" },
  { id: "prov-eastern-samar", name: "Eastern Samar", region: "" },
  { id: "prov-muntinlupa", name: "Muntinlupa", region: "" },
  { id: "prov-para-aque", name: "Parañaque", region: "" }
);

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

// Diagnoses discovered in the real FINAL_PATIENTS DATABASE that weren't in the
// original curated set above (see DATA/clean/reference-data-delta.json).
// `category` is a mechanical keyword guess -- treat as a starting point, not authoritative.
diagnoses.push(
  { id: "dx-pure-red-cell-aplasia", name: "Pure Red Cell Aplasia", category: "other" },
  { id: "dx-acute-promyelocytic-leukemia", name: "Acute Promyelocytic Leukemia", category: "cancer" },
  { id: "dx-beta-thalassemia", name: "Beta Thalassemia", category: "thalassemia" },
  { id: "dx-hereditary-spherocytosis", name: "Hereditary Spherocytosis", category: "other" },
  { id: "dx-hemophilia", name: "Hemophilia", category: "other" },
  { id: "dx-hemoglobin-h-disease", name: "Hemoglobin H  Disease", category: "other" },
  { id: "dx-spindle-cell-sarcoma", name: "Spindle Cell Sarcoma", category: "cancer" },
  { id: "dx-alpha-thalassemia", name: "Alpha Thalassemia", category: "thalassemia" },
  { id: "dx-multisystemic-langerhans-cell-histiocytosis", name: "Multisystemic Langerhans Cell Histiocytosis", category: "other" },
  { id: "dx-anaplastic-large-cell-lymphoma", name: "Anaplastic Large Cell Lymphoma", category: "cancer" },
  { id: "dx-infected-embryonal-rhabdomyosarcoma", name: "Infected Embryonal Rhabdomyosarcoma", category: "cancer" },
  { id: "dx-mucinous-adenoma", name: "Mucinous Adenoma", category: "other" },
  { id: "dx-langerhans-s-cell-histiosis", name: "Langerhans's Cell Histiosis", category: "other" },
  { id: "dx-apde", name: "APDE", category: "other" },
  { id: "dx-tetralogy-of-fallot", name: "Tetralogy of Fallot", category: "other" },
  { id: "dx-secundum-atrial-septal-defect-asd", name: "Secundum Atrial Septal Defect (ASD)", category: "other" },
  { id: "dx-synovial-sarcoma-3", name: "Synovial Sarcoma 3", category: "cancer" },
  { id: "dx-retinoblastoma-bilateral", name: "Retinoblastoma Bilateral", category: "cancer" },
  { id: "dx-aplastic-anemia-severe", name: "Aplastic Anemia Severe", category: "other" },
  { id: "dx-hemophilia-a-severe", name: "Hemophilia A, Severe", category: "other" },
  { id: "dx-mixed-phenotype-acute-leukemia", name: "Mixed Phenotype Acute Leukemia", category: "cancer" },
  { id: "dx-ventricular-septal-disease", name: "Ventricular Septal Disease", category: "other" },
  { id: "dx-aplastic-anemia", name: "Aplastic Anemia", category: "other" },
  { id: "dx-rhabdomyosarcoma", name: "Rhabdomyosarcoma", category: "cancer" },
  { id: "dx-chronic-itp", name: "Chronic ITP", category: "other" },
  { id: "dx-mucinous-adenocinoma-stage-lllb", name: "Mucinous Adenocinoma Stage lllB", category: "other" },
  { id: "dx-sarcoma-cancer", name: "Sarcoma Cancer", category: "cancer" },
  { id: "dx-leukemia", name: "Leukemia", category: "cancer" },
  { id: "dx-hepatoblastoma", name: "Hepatoblastoma", category: "cancer" },
  { id: "dx-normal", name: "Normal", category: "other" },
  { id: "dx-yolk-sac-tumor", name: "Yolk Sac Tumor", category: "cancer" },
  { id: "dx-b-cell-lymphoma", name: "B-cell Lymphoma", category: "cancer" },
  { id: "dx-nephrotic-syndrome", name: "Nephrotic syndrome", category: "other" },
  { id: "dx-t-c-intra-abdominal-mass-w-o-malignancy", name: "T/C Intra-abdominal mass w/o malignancy", category: "cancer" },
  { id: "dx-imperforate-anus", name: "Imperforate anus", category: "other" },
  { id: "dx-neuroblastoma-stage-4", name: "Neuroblastoma Stage 4", category: "cancer" }
);

export const treatmentPhases: TreatmentPhase[] = [
  { id: "phase-diagnosis", name: "Diagnostic Workup" },
  { id: "phase-induction", name: "Induction Chemotherapy" },
  { id: "phase-consolidation", name: "Consolidation" },
  { id: "phase-maintenance", name: "Maintenance" },
  { id: "phase-transfusion", name: "Regular Transfusion" },
  { id: "phase-surveillance", name: "Post-Treatment Surveillance" },
  { id: "phase-palliative", name: "Palliative / Comfort Care" },
];

// Treatment phases discovered in the real FINAL_PATIENTS DATABASE that weren't
// in the original curated set above (see DATA/clean/reference-data-delta.json).
// "Expired" here is a status value that leaked into the source spreadsheet's
// TREATMENT PHASE column for deceased patients, not a real treatment phase --
// kept verbatim rather than silently reinterpreted.
treatmentPhases.push(
  { id: "phase-expired", name: "Expired" },
  { id: "phase-blood-transfusion", name: "Blood Transfusion" },
  { id: "phase-induction-2", name: "Induction" },
  { id: "phase-intensification", name: "Intensification" },
  { id: "phase-continuation", name: "Continuation" },
  { id: "phase-surveillance-2", name: "Surveillance" },
  { id: "phase-monitoring", name: "Monitoring" },
  { id: "phase-chemotherapy", name: "Chemotherapy" },
  { id: "phase-factor-viii-iv-push", name: "Factor VIII (IV PUSH)" },
  { id: "phase-operation-done", name: "Operation Done" },
  { id: "phase-reinduction", name: "Reinduction" },
  { id: "phase-diagnosis-for-determining", name: "Diagnosis/For Determining" },
  { id: "phase-surgery", name: "Surgery" },
  { id: "phase-delayed-intensification", name: "Delayed Intensification" },
  { id: "phase-ct-scan", name: "CT Scan" }
);

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
