"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { EmergencyContact, Employee, EmploymentStatus, EmploymentType, Sex } from "@/lib/types/hr";

interface EmployeeRow {
  id: string;
  employee_code: string;
  staff_id: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  position: string;
  department: string | null;
  employment_type: EmploymentType;
  status: EmploymentStatus;
  hire_date: string;
  regularization_date: string | null;
  separation_date: string | null;
  birthdate: string | null;
  sex: Sex | null;
  civil_status: string | null;
  contact_number: string | null;
  email: string | null;
  address: string | null;
  emergency_contact: EmergencyContact | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    staffId: row.staff_id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    position: row.position,
    department: row.department,
    employmentType: row.employment_type,
    status: row.status,
    hireDate: row.hire_date,
    regularizationDate: row.regularization_date,
    separationDate: row.separation_date,
    birthdate: row.birthdate,
    sex: row.sex,
    civilStatus: row.civil_status,
    contactNumber: row.contact_number,
    email: row.email,
    address: row.address,
    emergencyContact: row.emergency_contact ?? {},
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The employee master (hr.employees, 0036). RLS returns every row to HR and
 * only the caller's own row to anyone else, so the same store serves the
 * Employees list and "my record". Government IDs and bank details are a
 * different table on purpose and are never part of this select.
 */
export const employeesStore = createCollection<Employee[]>({
  key: "hr.employees",
  empty: [],
  tables: [{ schema: "hr", table: "employees" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("hr")
      .from("employees")
      .select("*")
      .order("last_name")
      .order("first_name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as EmployeeRow[]).map(toEmployee);
  },
});

export function useEmployees() {
  const { data: employees, loading, error } = useCollection(employeesStore);
  return { employees, loading, error, refetch: employeesStore.refetch };
}
