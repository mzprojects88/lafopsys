-- Seeds ops.* reference/structural tables from the existing curated mock data
-- (lib/mock-data/reference-data.ts, hospitals.ts, house-ops.ts) so the real
-- referral/admission flow being built has real foreign keys to point at.
--
-- IMPORTANT caveat on house structure: lib/mock-data/house-ops.ts's own
-- comment admits the room/unit distribution (5/4/4 across 3 rooms) is "an
-- inference... should be confirmed before this screen is treated as
-- pixel-faithful," and Unit.status/sharedUnit there are randomly generated
-- (`rng.pick`/`rng.bool`), not real data. Migrating that randomness into
-- Supabase and presenting it as fact would be exactly the kind of fabricated-
-- looking-real data this project has been careful to avoid. So: room/unit/bed
-- IDs and codes (B1-B13, A-D) are seeded as real structural facts (they're
-- referenced throughout the app), but every unit's status is seeded as the
-- neutral 'available' and shared_unit as false -- real occupied/available
-- state should be derived from ops.stays at query time (the app already does
-- this in components/modules/patients/confirm-arrival-dialog.tsx), not
-- stored as a static flag. shared_unit (which beds are configured for
-- multiple occupants) is a real physical-layout fact only the org can
-- confirm -- flagged in integrate.md's follow-up plan, not guessed here.

insert into ops.rooms (id, name) values
  ('room-1', 'Room 1'),
  ('room-2', 'Room 2'),
  ('room-3', 'Room 3');

insert into ops.units (id, code, room_id, status, shared_unit) values
  ('unit-B1', 'B1', 'room-1', 'available', false),
  ('unit-B2', 'B2', 'room-1', 'available', false),
  ('unit-B3', 'B3', 'room-1', 'available', false),
  ('unit-B4', 'B4', 'room-1', 'available', false),
  ('unit-B5', 'B5', 'room-1', 'available', false),
  ('unit-B6', 'B6', 'room-2', 'available', false),
  ('unit-B7', 'B7', 'room-2', 'available', false),
  ('unit-B8', 'B8', 'room-2', 'available', false),
  ('unit-B9', 'B9', 'room-2', 'available', false),
  ('unit-B10', 'B10', 'room-3', 'available', false),
  ('unit-B11', 'B11', 'room-3', 'available', false),
  ('unit-B12', 'B12', 'room-3', 'available', false),
  ('unit-B13', 'B13', 'room-3', 'available', false);

insert into ops.bed_positions (id, unit_id, label)
select 'unit-' || code || '-' || label, 'unit-' || code, label
from (values ('B1'), ('B2'), ('B3'), ('B4'), ('B5'), ('B6'), ('B7'), ('B8'), ('B9'), ('B10'), ('B11'), ('B12'), ('B13')) as u(code)
cross join (values ('A'), ('B'), ('C'), ('D')) as l(label);

insert into ops.hospitals (id, name, code, address) values
  ('hosp-nch', 'National Children''s Hospital', 'NCH', 'Banawe, Quezon City'),
  ('hosp-pgh', 'Philippine General Hospital', 'PGH', 'Taft Ave, Manila');

insert into ops.hospital_nurses (id, hospital_id, first_name, last_name, position, active) values
  ('nurse-1', 'hosp-nch', 'Liza', 'Marquez', 'Pediatric Oncology Nurse', true),
  ('nurse-2', 'hosp-nch', 'Ramil', 'Cortez', 'Medical Social Worker', true),
  ('nurse-3', 'hosp-nch', 'Divina', 'Ocampo', 'Pediatric Hematology Nurse', true),
  ('nurse-4', 'hosp-pgh', 'Arnel', 'Suarez', 'Pediatric Oncology Nurse', true),
  ('nurse-5', 'hosp-pgh', 'Feliza', 'Ramos', 'Medical Social Worker', true);

insert into ops.provinces (id, name, region) values
  ('prov-ncr', 'Metro Manila', 'NCR'),
  ('prov-cavite', 'Cavite', 'Region IV-A'),
  ('prov-laguna', 'Laguna', 'Region IV-A'),
  ('prov-bulacan', 'Bulacan', 'Region III'),
  ('prov-rizal', 'Rizal', 'Region IV-A'),
  ('prov-batangas', 'Batangas', 'Region IV-A'),
  ('prov-pampanga', 'Pampanga', 'Region III'),
  ('prov-quezon', 'Quezon', 'Region IV-A'),
  ('prov-agusan', 'Agusan', null),
  ('prov-albay', 'Albay', null),
  ('prov-mindoro', 'Mindoro', null),
  ('prov-catanduanes', 'Catanduanes', null),
  ('prov-marinduque', 'Marinduque', null),
  ('prov-camarines-norte', 'Camarines Norte', null),
  ('prov-camarines-sur', 'Camarines Sur', null),
  ('prov-bataan', 'Bataan', null),
  ('prov-cebu', 'Cebu', null),
  ('prov-manila', 'Manila', null),
  ('prov-masbate', 'Masbate', null),
  ('prov-negros-occidental', 'Negros Occidental', null),
  ('prov-zambales', 'Zambales', null),
  ('prov-western-samar', 'Western Samar', null),
  ('prov-northern-samar', 'Northern Samar', null),
  ('prov-eastern-samar', 'Eastern Samar', null),
  ('prov-muntinlupa', 'Muntinlupa', null),
  ('prov-para-aque', 'Parañaque', null);

insert into ops.cities (id, province_id, name) values
  ('city-manila', 'prov-ncr', 'Manila'),
  ('city-muntinlupa', 'prov-ncr', 'Muntinlupa'),
  ('city-quezoncity', 'prov-ncr', 'Quezon City'),
  ('city-pasay', 'prov-ncr', 'Pasay'),
  ('city-dasmarinas', 'prov-cavite', 'Dasmariñas'),
  ('city-santarosa', 'prov-laguna', 'Santa Rosa'),
  ('city-malolos', 'prov-bulacan', 'Malolos'),
  ('city-antipolo', 'prov-rizal', 'Antipolo'),
  ('city-batangascity', 'prov-batangas', 'Batangas City'),
  ('city-angeles', 'prov-pampanga', 'Angeles'),
  ('city-lucena', 'prov-quezon', 'Lucena');

insert into ops.diagnoses (id, name, category) values
  ('dx-all', 'Acute Lymphoblastic Leukemia', 'cancer'),
  ('dx-aml', 'Acute Myeloid Leukemia', 'cancer'),
  ('dx-wilms', 'Wilms Tumor', 'cancer'),
  ('dx-osteo', 'Osteosarcoma', 'cancer'),
  ('dx-neuro', 'Neuroblastoma', 'cancer'),
  ('dx-retino', 'Retinoblastoma', 'cancer'),
  ('dx-lymphoma', 'Hodgkin Lymphoma', 'cancer'),
  ('dx-thal-major', 'Thalassemia Major', 'thalassemia'),
  ('dx-thal-inter', 'Thalassemia Intermedia', 'thalassemia'),
  ('dx-other', 'Other Chronic Illness', 'other'),
  ('dx-pure-red-cell-aplasia', 'Pure Red Cell Aplasia', 'other'),
  ('dx-acute-promyelocytic-leukemia', 'Acute Promyelocytic Leukemia', 'cancer'),
  ('dx-beta-thalassemia', 'Beta Thalassemia', 'thalassemia'),
  ('dx-hereditary-spherocytosis', 'Hereditary Spherocytosis', 'other'),
  ('dx-hemophilia', 'Hemophilia', 'other'),
  ('dx-hemoglobin-h-disease', 'Hemoglobin H  Disease', 'other'),
  ('dx-spindle-cell-sarcoma', 'Spindle Cell Sarcoma', 'cancer'),
  ('dx-alpha-thalassemia', 'Alpha Thalassemia', 'thalassemia'),
  ('dx-multisystemic-langerhans-cell-histiocytosis', 'Multisystemic Langerhans Cell Histiocytosis', 'other'),
  ('dx-anaplastic-large-cell-lymphoma', 'Anaplastic Large Cell Lymphoma', 'cancer'),
  ('dx-infected-embryonal-rhabdomyosarcoma', 'Infected Embryonal Rhabdomyosarcoma', 'cancer'),
  ('dx-mucinous-adenoma', 'Mucinous Adenoma', 'other'),
  ('dx-langerhans-s-cell-histiosis', 'Langerhans''s Cell Histiosis', 'other'),
  ('dx-apde', 'APDE', 'other'),
  ('dx-tetralogy-of-fallot', 'Tetralogy of Fallot', 'other'),
  ('dx-secundum-atrial-septal-defect-asd', 'Secundum Atrial Septal Defect (ASD)', 'other'),
  ('dx-synovial-sarcoma-3', 'Synovial Sarcoma 3', 'cancer'),
  ('dx-retinoblastoma-bilateral', 'Retinoblastoma Bilateral', 'cancer'),
  ('dx-aplastic-anemia-severe', 'Aplastic Anemia Severe', 'other'),
  ('dx-hemophilia-a-severe', 'Hemophilia A, Severe', 'other'),
  ('dx-mixed-phenotype-acute-leukemia', 'Mixed Phenotype Acute Leukemia', 'cancer'),
  ('dx-ventricular-septal-disease', 'Ventricular Septal Disease', 'other'),
  ('dx-aplastic-anemia', 'Aplastic Anemia', 'other'),
  ('dx-rhabdomyosarcoma', 'Rhabdomyosarcoma', 'cancer'),
  ('dx-chronic-itp', 'Chronic ITP', 'other'),
  ('dx-mucinous-adenocinoma-stage-lllb', 'Mucinous Adenocinoma Stage lllB', 'other'),
  ('dx-sarcoma-cancer', 'Sarcoma Cancer', 'cancer'),
  ('dx-leukemia', 'Leukemia', 'cancer'),
  ('dx-hepatoblastoma', 'Hepatoblastoma', 'cancer'),
  ('dx-normal', 'Normal', 'other'),
  ('dx-yolk-sac-tumor', 'Yolk Sac Tumor', 'cancer'),
  ('dx-b-cell-lymphoma', 'B-cell Lymphoma', 'cancer'),
  ('dx-nephrotic-syndrome', 'Nephrotic syndrome', 'other'),
  ('dx-t-c-intra-abdominal-mass-w-o-malignancy', 'T/C Intra-abdominal mass w/o malignancy', 'cancer'),
  ('dx-imperforate-anus', 'Imperforate anus', 'other'),
  ('dx-neuroblastoma-stage-4', 'Neuroblastoma Stage 4', 'cancer');

insert into ops.treatment_phases (id, name) values
  ('phase-diagnosis', 'Diagnostic Workup'),
  ('phase-induction', 'Induction Chemotherapy'),
  ('phase-consolidation', 'Consolidation'),
  ('phase-maintenance', 'Maintenance'),
  ('phase-transfusion', 'Regular Transfusion'),
  ('phase-surveillance', 'Post-Treatment Surveillance'),
  ('phase-palliative', 'Palliative / Comfort Care'),
  ('phase-expired', 'Expired'),
  ('phase-blood-transfusion', 'Blood Transfusion'),
  ('phase-induction-2', 'Induction'),
  ('phase-intensification', 'Intensification'),
  ('phase-continuation', 'Continuation'),
  ('phase-surveillance-2', 'Surveillance'),
  ('phase-monitoring', 'Monitoring'),
  ('phase-chemotherapy', 'Chemotherapy'),
  ('phase-factor-viii-iv-push', 'Factor VIII (IV PUSH)'),
  ('phase-operation-done', 'Operation Done'),
  ('phase-reinduction', 'Reinduction'),
  ('phase-diagnosis-for-determining', 'Diagnosis/For Determining'),
  ('phase-surgery', 'Surgery'),
  ('phase-delayed-intensification', 'Delayed Intensification'),
  ('phase-ct-scan', 'CT Scan');
