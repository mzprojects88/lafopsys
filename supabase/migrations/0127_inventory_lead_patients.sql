-- 0127: the Inventory Lead reads the House Sheet and nothing else in Patients.
-- 0093 copied the role's old module level (patients = edit) onto every Patients page; writing the
-- role manual (5 Nov 2026) showed the role could admit, reserve beds and edit records. The trigger
-- sync_module_from_pages brings shared.module_access down to 'view' by itself.
update shared.role_page_access
   set level = case when page = 'patients.house_sheet' then 'view' else 'none' end
 where role = 'inventory_lead' and page like 'patients.%';

-- A bed exception is a Patients edit; the role no longer edits Patients.
delete from shared.role_powers where role = 'inventory_lead' and power = 'bed_exception';
