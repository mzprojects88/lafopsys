export interface Hospital {
  id: string;
  name: string;
  code: string;
  address?: string;
}

export interface HospitalNurse {
  id: string;
  hospitalId: string;
  firstName: string;
  lastName: string;
  position?: string;
  active: boolean;
}
