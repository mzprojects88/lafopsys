/**
 * The social worker's case forms (0124), written once from LAF's paper case folder ("NEW LAF Case
 * Management Forms", the P139 folder set). One definition drives the form on screen and its PDF.
 * The child's name, birth date, sex, address and diagnosis come from the patient record; a form
 * holds only what the paper adds. Wording of the checklists is the paper's.
 */

export type FormId =
  | "intake" | "progress_note" | "casework" | "counseling" | "home_visit" | "monitoring"
  | "case_study" | "intervention_plan"
  | "discharge_slip" | "closing_summary" | "transfer_summary" | "aftercare_plan" | "pre_discharge_plan"
  | "referral_letter" | "dswd_case_summary";

export type Field =
  | { key: string; label: string; type: "section" }
  | { key: string; label: string; type: "text" | "textarea" | "date" | "time" | "number"; hint?: string; prefill?: string }
  | { key: string; label: string; type: "choice"; options: readonly string[] }
  | { key: string; label: string; type: "checks"; options: readonly string[] }
  | { key: string; label: string; type: "table"; columns: readonly { key: string; label: string }[]; rows?: readonly string[] }
  | { key: string; label: string; type: "ratings"; rows: readonly string[]; options: readonly string[] };

export interface CaseForm {
  id: FormId;
  title: string;
  /** A session with the child and carer: it can be booked ahead, and has a venue. */
  session: boolean;
  /** The parent or carer signs the paper ("Conforme"). */
  conforme: boolean;
  /** A date field that proposes the next session. */
  nextSessionKey?: string;
  /** Printed as a letter: the values as paragraphs, no field labels (0126). */
  letter?: boolean;
  /** A new record starts from the last approved one of this form (the plan is reviewed, not rewritten). */
  carryOver?: boolean;
  /** Signature lines the paper adds beyond the social worker, the CEO and the carer. */
  extraSigners?: readonly string[];
  fields: readonly Field[];
}

const sec = (key: string, label: string): Field => ({ key, label, type: "section" });
const text = (key: string, label: string, extra: { hint?: string; prefill?: string } = {}): Field => ({ key, label, type: "text", ...extra });
const area = (key: string, label: string, extra: { hint?: string; prefill?: string } = {}): Field => ({ key, label, type: "textarea", ...extra });
const choice = (key: string, label: string, options: readonly string[]): Field => ({ key, label, type: "choice", options });
const checks = (key: string, label: string, options: readonly string[]): Field => ({ key, label, type: "checks", options });

const FAMILY_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "age_sex", label: "Age/Sex" },
  { key: "relationship", label: "Relationship to Client" },
  { key: "civil_status", label: "Civil Status" },
  { key: "education", label: "Educational Attainment" },
  { key: "occupation", label: "Occupation" },
  { key: "income", label: "Income" },
] as const;

export const FORMS: Record<FormId, CaseForm> = {
  intake: {
    id: "intake",
    title: "Client Intake Sheet",
    session: false,
    conforme: true,
    fields: [
      text("referred_by", "Referred by", { prefill: "National Children's Hospital" }),
      { key: "referral_date", label: "Date of Referral", type: "date" },
      sec("a", "A. Client's identifying information"),
      text("religion", "Religion", { prefill: "religion" }),
      text("place_of_birth", "Place of Birth", { prefill: "placeOfBirth" }),
      sec("b", "B. Carer's identifying information"),
      choice("carer_civil_status", "Civil Status", ["Single", "Married", "Widowed", "Separated", "Live-in"]),
      text("carer_education", "Educational Attainment", { prefill: "parentEducation" }),
      text("carer_occupation", "Occupation & Status (Regular, Irregular, Contractual, Jobless)", { prefill: "parentOccupation" }),
      text("carer_income", "Estimated Monthly Income", { prefill: "householdIncome" }),
      sec("c", "C. Problem presented"),
      area("problem_presented", "Problem presented", { prefill: "reasonForReferral" }),
      checks("services_requested", "Services requested", ["Housing Accommodation", "Transportation Support", "Meal Assistance", "Financial Assistance", "Psychosocial Support"]),
      text("services_other", "Others"),
      sec("d", "D. Medical information"),
      text("treatment_phase", "Treatment Phase"),
      text("attending_physician", "Attending Physician", { prefill: "attendingPhysician" }),
      choice("medical_priority", "Client Medical Prioritization", ["Priority A: Chemotherapy", "Priority B: Blood Transfusion", "Priority C: Scheduled Procedure", "Priority D: Follow-up Consultation"]),
      sec("e", "E. Family composition"),
      { key: "family", label: "Family members", type: "table", columns: FAMILY_COLUMNS },
      choice("housing_type", "Type of Housing", ["Owned", "Rented", "Temporary", "Caretaker"]),
      choice("light_source", "Source of Light", ["Electric", "Lamp/Candle"]),
      text("light_cost", "Monthly cost of light"),
      choice("water_source", "Source of Water", ["Nawasa", "Deep Well", "Spring", "Maynilad"]),
      sec("f", "F. Social worker psychosocial assessment"),
      checks("emotional_status", "Emotional Status", ["Calm", "Hopeful", "Anxious", "Fearful", "Sad or withdrawn", "Irritable"]),
      checks("support_system", "Support System", ["Strong family support", "Support from relatives or friends", "Community or organizational support", "Limited support system", "Family conflict", "Caregiver stress or fatigue"]),
      checks("coping", "Coping and Functioning", ["Coping adequately", "Cooperative with treatment", "Difficulty adjusting to illness or treatment", "Requires psychosocial support", "Requires close monitoring"]),
      area("narrative", "Brief narrative assessment"),
      sec("g", "G. Recommendation"),
      area("recommendation", "Recommendation"),
      { key: "consent_signed_on", label: "Carer signed the consent on", type: "date" },
    ],
  },

  progress_note: {
    id: "progress_note",
    title: "Client Progress Note",
    session: false,
    conforme: false,
    fields: [area("concern", "Concern"), area("services_rendered", "Activities / services rendered")],
  },

  casework: {
    id: "casework",
    title: "Casework Activity Report",
    session: true,
    conforme: false,
    fields: [
      text("facilitated_by", "Facilitated by"),
      area("purpose", "Purpose of the Session", {
        prefill:
          "The casework session was conducted to orient the beneficiary and parent/caregiver regarding the beneficiary's situation, identified needs, available services, and responsibilities. It also aimed to identify the beneficiary's strengths, difficulties, coping capacity, and support system to assist in the development of appropriate interventions.",
      }),
      area("summary", "Summary of Discussion", {
        prefill: "The beneficiary's medical condition, family situation, financial concerns, treatment-related needs, and other circumstances affecting his/her well-being and social functioning were discussed.",
      }),
      checks("concerns", "Key concerns identified", [
        "Temporary accommodation near the hospital",
        "Transportation to and from the hospital",
        "Food and daily meal needs",
        "Medical or treatment-related expenses",
        "Financial difficulty or insufficient family income",
        "Emotional distress, fear, or anxiety",
        "Difficulty coping with illness or treatment",
        "Disruption in schooling or education",
        "Limited family or caregiver support",
        "Difficulty accessing medicines, laboratory tests, or medical services",
        "Family relationship or caregiving concerns",
        "Need for referral to another agency or service provider",
      ]),
      checks("strengths", "Strengths and available support", [
        "Beneficiary is cooperative and responsive",
        "Beneficiary demonstrates a positive attitude toward treatment",
        "Beneficiary is able to express feelings and concerns",
        "Beneficiary has appropriate coping skills",
        "Parent/caregiver is attentive and supportive",
        "Family is committed to continuing treatment",
        "Extended family members provide support",
        "Family has support from relatives, friends, or the community",
        "Beneficiary has access to hospital-based assistance",
        "Beneficiary receives assistance from government agencies or NGOs",
        "Beneficiary shows interest in educational, recreational, or creative activities",
        "Family is willing to participate in the intervention plan",
      ]),
      checks("interventions", "Interventions or assistance discussed/provided", [
        "Orientation on Little Ark Foundation services and house rules",
        "Intake interview and assessment",
        "Temporary accommodation",
        "Meal assistance",
        "Transportation assistance",
        "Transportation fare reimbursement",
        "Psychosocial support or supportive counseling",
        "Child-friendly recreational or developmental activities",
        "Spiritual care or prayer support",
        "Coordination with the National Children's Hospital",
        "Assistance in accessing medicines, tests, or treatment",
        "Referral to government agencies, NGOs, or other service providers",
        "Financial or material assistance",
        "Family or caregiver guidance",
        "Development or review of the intervention plan",
        "Follow-up monitoring and case management",
      ]),
      checks("attached", "Supporting documents attached", ["Intake and Assessment Form", "Admission Slip", "Initial Intervention Plan"]),
      area("findings", "Social worker's findings and comments"),
    ],
  },

  counseling: {
    id: "counseling",
    title: "Counseling Process Recording",
    session: true,
    conforme: false,
    nextSessionKey: "next_session",
    fields: [
      text("session_no", "Session No."),
      text("duration", "Duration"),
      checks("purpose", "I. Purpose of the Session", ["Initial Counseling", "Follow-up Counseling", "Individual Counseling", "Family Counseling", "Supportive Counseling", "Crisis Intervention"]),
      checks("concern", "II. Presenting Concern", [
        "Medical condition or treatment", "Emotional distress", "Anxiety or fear", "Sadness or grief", "Family concern or conflict", "Financial difficulty",
        "Housing or accommodation concern", "Transportation difficulty", "School-related concern", "Caregiving difficulty", "Adjustment to illness or treatment", "Treatment compliance",
      ]),
      sec("process", "III. Counseling Process"),
      area("focus", "Focus of discussion"),
      area("statements", "Client's statements / behavior"),
      area("response", "Social worker's response / intervention"),
      area("observations", "Observations"),
      checks("assessment", "IV. Assessment: emotional condition and response during the session", [
        "Calm", "Cooperative", "Hopeful", "Anxious", "Fearful", "Sad or tearful", "Withdrawn", "Irritable", "Confused", "Reluctant to communicate",
        "Engaged and responsive", "Expressed thoughts and feelings", "Became calmer", "Showed improved understanding", "Identified possible solutions",
        "Agreed with the recommended plan", "Remained distressed", "Was hesitant or minimally responsive", "Required further assessment",
      ]),
      area("assessment_note", "Social worker's assessment"),
      checks("plan", "V. Plan / Next Steps", [
        "Continue counseling as necessary", "Schedule a follow-up session", "Monitor emotional and behavioral condition", "Coordinate with the caregiver or family",
        "Coordinate with the medical team", "Refer to an appropriate agency or professional", "Provide financial or resource assistance",
        "Review progress during the next session", "Close counseling intervention",
      ]),
      { key: "next_session", label: "Next Session Date, if applicable", type: "date" },
      area("findings", "Social worker's findings and comments"),
    ],
  },

  home_visit: {
    id: "home_visit",
    title: "Home Visit Monitoring Form",
    session: true,
    conforme: true,
    nextSessionKey: "next_follow_up",
    fields: [
      sec("i", "I. Visit information"),
      { key: "time_started", label: "Time Started", type: "time" },
      { key: "time_ended", label: "Time Ended", type: "time" },
      text("others_present", "Other Person/s Present"),
      checks("visit_type", "Type of Visit", ["Initial Follow-up", "Regular Monitoring", "Aftercare Monitoring", "Crisis/Emergency Visit", "Case Closure Preparation", "Verification Visit"]),
      checks("visit_purpose", "Purpose of Visit", [
        "Monitor medical treatment", "Assess beneficiary's current condition", "Monitor family and caregiving situation", "Assess home and environmental conditions",
        "Verify information or documents", "Follow up referrals and interventions", "Address an identified concern",
      ]),
      sec("ii", "II. Beneficiary's current condition"),
      choice("treatment_status", "Treatment status", ["Ongoing treatment", "Maintenance", "Follow-up monitoring", "Treatment completed", "Treatment temporarily interrupted", "Treatment discontinued"]),
      choice("appointment_compliance", "Compliance with hospital appointments", ["Consistent", "Occasionally missed", "Frequently missed", "Unable to verify"]),
      choice("medication_compliance", "Compliance with medication", ["Consistent", "Occasionally missed", "Frequently missed", "No current medication", "Unable to verify"]),
      checks("missed_reasons", "Reason for missed treatment or medication, if applicable", ["Financial difficulty", "Transportation problem", "Distance from hospital", "Lack of caregiver", "Beneficiary's refusal or fear", "Family emergency"]),
      text("next_appointment", "Next hospital appointment"),
      checks("appeared", "During the visit, the beneficiary appeared", ["Calm", "Cheerful", "Cooperative", "Anxious", "Sad", "Withdrawn", "Fearful", "Irritable", "Distressed", "Unable to assess"]),
      choice("school_status", "Current school status", ["Attending regularly", "Home-based/modular learning", "Temporarily absent", "Not enrolled", "Dropped out", "Not applicable"]),
      choice("play", "Participation in play, learning, or age-appropriate activities", ["Regular", "Occasional", "Limited", "None", "Unable to assess"]),
      sec("iii", "III. Family and caregiving situation"),
      text("primary_caregiver", "Primary caregiver"),
      text("household_change", "Any change in household composition? (specify)"),
      checks("caregiver_condition", "Caregiver's current condition", ["Coping adequately", "Experiencing stress", "Physically exhausted", "Emotionally distressed", "Needs additional support", "Unable to assess"]),
      choice("family_functioning", "Family relationship and functioning", ["Supportive and cooperative", "Generally stable", "Experiencing occasional conflict", "Frequently conflictual", "Limited family support"]),
      sec("iv", "IV. Financial and basic needs"),
      text("income_sources", "Current source/s of income"),
      text("monthly_income", "Estimated monthly household income"),
      choice("financial_condition", "Current financial condition", ["Income is sufficient", "Income is barely sufficient", "Income is insufficient", "No regular income", "Dependent on assistance"]),
      checks("unmet_needs", "Current unmet needs", ["Food", "Transportation", "Medication", "Hospital expenses", "Housing", "Utilities", "Education", "Livelihood"]),
      sec("v", "V. Home and environmental condition"),
      choice("housing_status", "Housing status", ["Owned", "Rented", "Rent-free", "Shared with relatives", "Temporary shelter", "Informal housing"]),
      {
        key: "home_areas",
        label: "Areas assessed",
        type: "ratings",
        rows: ["General cleanliness", "Ventilation and lighting", "Water supply", "Toilet and sanitation", "Cooking and food storage", "Sleeping arrangement", "Electrical and fire safety", "Accessibility of the home"],
        options: ["Satisfactory", "Needs Improvement", "Serious Concern"],
      },
      sec("vi", "VI. Community and service access"),
      text("usual_transport", "Usual transportation to the hospital"),
      text("travel_time", "Estimated travel time"),
      text("transport_cost", "Estimated transportation cost per visit"),
      checks("community_support", "Available community support", ["Barangay assistance", "Health center", "MSWDO/CSWDO", "DSWD assistance", "School support", "Church or faith-based support", "Relatives or neighbors", "NGO/Foundation", "None"]),
      text("current_assistance", "Current assistance received"),
      text("barriers", "Barriers in accessing services"),
      sec("vii", "VII. Safety and protection screening"),
      checks("protection", "Observed, reported, or suspected", [
        "Physical abuse", "Emotional or psychological abuse", "Sexual abuse", "Neglect", "Abandonment", "Exploitation", "Domestic violence",
        "Unsafe caregiving arrangement", "Substance abuse in the household", "Self-harm or suicidal behavior", "Serious family conflict", "No identified protection concern",
      ]),
      choice("risk_level", "Risk Level", ["No apparent risk", "Low", "Moderate", "High", "Immediate danger"]),
      area("immediate_action", "Immediate action or referral made"),
      sec("viii", "VIII. Summary of findings"),
      choice("changes", "Significant changes since the previous assessment", ["Improved", "Stable", "Declined", "New concern identified", "Unable to determine"]),
      checks("strengths", "Strengths and available resources", ["Supportive caregiver", "Cooperative family", "Support from relatives", "Community support", "Stable housing", "Regular income", "Treatment compliance", "Positive coping skills"]),
      sec("ix", "IX. Social worker's assessment"),
      choice("case_risk", "Overall Case Risk Classification", ["Low", "Moderate", "High", "Critical"]),
      choice("case_priority", "Case Priority", ["Routine", "Priority", "Urgent", "Emergency"]),
      sec("x", "X. Follow-up intervention plan"),
      {
        key: "follow_up",
        label: "Follow-up actions",
        type: "table",
        columns: [
          { key: "need", label: "Identified Need or Concern" },
          { key: "action", label: "Intervention/Action Needed" },
          { key: "responsible", label: "Responsible Person/Agency" },
          { key: "target", label: "Target Date" },
        ],
      },
      checks("referrals", "Referrals recommended", [
        "Medical assistance", "Transportation assistance", "Food assistance", "Housing support", "Psychosocial intervention", "Educational assistance",
        "Livelihood assistance", "Child protection services", "MSWDO/CSWDO", "DSWD", "Hospital social service",
      ]),
      area("recommendations", "Specific recommendations"),
      { key: "next_follow_up", label: "Next follow-up date", type: "date" },
      area("agreements", "Agreements made with the beneficiary/family"),
      area("findings", "Social worker's findings and comments"),
    ],
  },

  monitoring: {
    id: "monitoring",
    title: "Case Monitoring & Evaluation Form",
    session: true,
    conforme: true,
    fields: [
      checks("purpose", "Purpose of monitoring", [
        "Regular case evaluation", "Review of intervention plan", "Extended-stay assessment", "Preparation for discharge/termination", "Aftercare or follow-up", "Response to an identified concern",
      ]),
      checks("sources", "Sources of information", [
        "Beneficiary interview", "Parent/caregiver interview", "Direct observation", "Medical or hospital record", "LAF service records", "Home visit", "Coordination with partner agency",
      ]),
      {
        key: "services",
        label: "III. Services received (Status: NS Not Started, O Ongoing, C Completed, D Delayed, M Modified, DC Discontinued; Progress: 4 Goal Achieved, 3 Substantial, 2 Partial, 1 No Progress, N/A)",
        type: "table",
        columns: [
          { key: "service", label: "Services" },
          { key: "activities", label: "Activities/Interventions Implemented" },
          { key: "status", label: "Status" },
          { key: "rating", label: "Progress Rating" },
        ],
        rows: ["Housing", "Everyday Meals", "Transportation", "Spiritual Care", "Community Resources"],
      },
      sec("iv_a", "IV-A. Health and treatment"),
      choice("hospital_visits", "Attendance in scheduled hospital visits", ["Regular", "Irregular", "Not applicable"]),
      choice("treatment_compliance", "Compliance with chemotherapy, transfusion, medication, or other treatment", ["Compliant", "Partially compliant", "Non-compliant"]),
      choice("complications", "Medical complications or change in condition", ["None reported", "Present"]),
      choice("access_concern", "Transportation or accommodation affecting treatment", ["No concern", "With concern"]),
      choice("nch_coordination", "Coordination with National Children's Hospital or medical provider", ["Completed", "Ongoing", "Needed"]),
      area("health_remarks", "Remarks / action needed (health)"),
      sec("iv_b", "IV-B. Psychosocial and emotional condition"),
      choice("emotional", "Emotional condition", ["Stable", "Mild concern", "Moderate concern", "Serious concern"]),
      choice("participation", "Participation in play and activities", ["Active", "Partial", "Minimal", "Unable to participate"]),
      choice("interaction", "Interaction with caregiver and peers", ["Positive", "Improving", "With concern"]),
      choice("behavior", "Behavior and coping", ["Appropriate", "Needs support", "Requires referral"]),
      choice("caregiver_support", "Caregiver support and cooperation", ["Good", "Fair", "Needs improvement"]),
      area("psychosocial_remarks", "Remarks / action needed (psychosocial)"),
      area("assessment", "V. Social Worker's Assessment"),
      area("recommendation", "VI. Recommendation"),
      area("findings", "Social worker's findings and comments"),
    ],
  },

  case_study: {
    id: "case_study",
    title: "Social Case Study Report",
    session: false,
    conforme: false,
    fields: [
      text("illness_category", "Case/Illness Category"),
      sec("ii", "II. Sources of information and circumstances of referral"),
      area("sources", "Sources of information and circumstances of referral", {
        prefill:
          "The information presented in this report was gathered from the client's existing case records, available medical records from the National Children's Hospital, an interview with the client's parent, and the social worker's direct observations. The client was referred by the National Children's Hospital for assessment and possible assistance under the programs and services of Little Ark Foundation.",
      }),
      sec("iii", "III. Presenting problem"),
      area("presenting_problem", "Presenting problem", { prefill: "reasonForReferral" }),
      sec("iv", "IV. Background information"),
      area("the_child", "A. The child"),
      { key: "family", label: "B. The family", type: "table", columns: FAMILY_COLUMNS },
      area("the_family", "The family (narrative)"),
      area("the_community", "C. The community"),
      sec("v", "V. Assessment"),
      area("assessment", "Assessment"),
      sec("vi", "VI. Recommendation"),
      area("recommendation", "Recommendation"),
    ],
  },

  intervention_plan: {
    id: "intervention_plan",
    title: "Intervention Plan and Contract",
    session: false,
    conforme: true,
    carryOver: true,
    fields: [
      text("period", "Plan period", { hint: "e.g. June 2026 - December 2026" }),
      {
        key: "plan",
        label: "Objectives, activities and status per service (Status: NS Not Started, O Ongoing, C Completed, D Delayed, M Modified, DC Discontinued)",
        type: "table",
        columns: [
          { key: "service", label: "Service" },
          { key: "objective", label: "Objectives" },
          { key: "activities", label: "Activities" },
          { key: "time_frame", label: "Time frame" },
          { key: "responsible", label: "Responsible person" },
          { key: "outcome", label: "Expected outcomes" },
          { key: "status", label: "Status" },
        ],
        rows: ["I. Housing Accommodation Services", "II. Everyday Meals Services", "III. Activities Services", "IV. Resources / Social Services", "V. Transportation Services", "VI. Spiritual Care Services"],
      },
      { key: "as_of", label: "Monitoring status as of", type: "date" },
    ],
  },

  discharge_slip: {
    id: "discharge_slip",
    title: "Discharge Slip (LAF-CM-DS-01)",
    session: false,
    conforme: true,
    fields: [
      { key: "discharged_time", label: "Time discharged", type: "time" },
      text("destination", "Destination / complete address"),
      text("receiving_person", "Receiving person / relationship"),
      text("receiving_contact", "Receiving person's active contact number"),
      choice("discharge_type", "Type", ["Completed LAF services", "Returned home", "Transferred/referred", "Voluntary withdrawal", "Hospital admission"]),
      area("reason", "Reason for discharge"),
      choice("condition", "Condition upon discharge", ["Stable", "For continued monitoring/treatment"]),
      area("instructions", "Important instructions, next medical appointment, referrals, or aftercare arrangements"),
      checks("returned", "Documents / belongings returned", ["Medical records/copies", "Referral documents", "Personal belongings"]),
    ],
  },

  closing_summary: {
    id: "closing_summary",
    title: "Closing Summary / Terminal Report (LAF-CM-CS-02)",
    session: false,
    conforme: false,
    fields: [
      area("referral_circumstances", "B. Circumstances of referral and presenting problem"),
      checks("services", "C. Services / interventions provided", ["Temporary shelter", "Meals", "Transportation", "Activities", "Psychosocial support", "Referral/resource assistance", "Spiritual care"]),
      area("services_details", "Brief details"),
      area("progress", "D. Progress and outcomes"),
      area("closure_reason", "E. Reason for case closure"),
      area("final_assessment", "F. Final assessment, remaining needs, and recommendation"),
      area("aftercare", "G. Referrals / aftercare arranged"),
    ],
  },

  transfer_summary: {
    id: "transfer_summary",
    title: "Transfer Summary and Receiving-Party Agreement (LAF-CM-TS-03)",
    session: false,
    conforme: true,
    extraSigners: ["Receiving Party / Authorized Representative", "LGU / LSWDO Representative (if applicable)"],
    fields: [
      text("transfer_reason", "Reason for transfer"),
      text("destination", "Current address / destination"),
      sec("b", "B. Brief case status"),
      area("situation", "Current medical, psychosocial, family, financial, and protection situation"),
      area("services_progress", "Services provided and progress made"),
      area("pending", "Pending needs, appointments, and immediate actions required"),
      sec("c", "C. Receiving party"),
      text("receiving_agency", "Agency / receiving party"),
      text("receiving_contact_person", "Contact person / position"),
      text("receiving_address", "Complete address"),
      text("receiving_mobile", "Active mobile number"),
      text("receiving_alt", "Alternate number / email"),
      { key: "contact_verified", label: "Date contact verified", type: "date" },
      text("expected_service", "Expected service / action"),
      sec("d", "D. Concerned LGU / LSWDO"),
      text("lgu_city", "City / municipality"),
      text("lgu_contact_person", "Contact person / position"),
      text("lgu_address", "Office address"),
      text("lgu_phone", "Active mobile / landline"),
      text("lgu_email", "Email / other contact"),
      checks("documents", "E. Documents transferred", ["Referral letter", "Transfer summary", "SCSR / intake records", "Medical records/copies", "Intervention/progress records", "Consent forms"]),
    ],
  },

  aftercare_plan: {
    id: "aftercare_plan",
    title: "Aftercare Plan and Agreement (LAF-CM-AP-04)",
    session: false,
    conforme: true,
    nextSessionKey: "first_follow_up",
    extraSigners: ["LGU / Receiving Agency (if applicable)"],
    fields: [
      { key: "period_from", label: "Aftercare period from", type: "date" },
      { key: "period_to", label: "Aftercare period to", type: "date" },
      text("current_address", "Current address"),
      area("goal", "B. Aftercare goal and priority needs"),
      {
        key: "activities",
        label: "C. Aftercare activities",
        type: "table",
        columns: [
          { key: "activity", label: "Need / activity" },
          { key: "responsible", label: "Responsible person / agency" },
          { key: "target", label: "Target date" },
          { key: "result", label: "Follow-up / expected result" },
        ],
      },
      sec("d", "D. Follow-up schedule and important contacts"),
      { key: "first_follow_up", label: "First follow-up date", type: "date" },
      checks("method", "Method", ["Call", "Message", "Visit", "Agency coordination"]),
      text("laf_contact", "LAF contact person and number"),
      text("agency_contact", "LGU / agency contact and number"),
      text("next_appointment", "Next medical appointment, hospital / clinic"),
    ],
  },

  pre_discharge_plan: {
    id: "pre_discharge_plan",
    title: "Termination / Pre-Discharge Plan (LAF-CM-TP-05)",
    session: false,
    conforme: true,
    extraSigners: ["Client, if age-appropriate"],
    fields: [
      { key: "proposed_discharge", label: "Proposed discharge date", type: "date" },
      area("reason", "Reason for termination / discharge"),
      checks("readiness", "B. Readiness before discharge", [
        "Safe destination confirmed", "Parent/guardian/receiving person identified", "Active contact details verified", "Medical follow-up arranged", "Transportation plan discussed",
        "Medicines/instructions understood", "Referrals coordinated", "Aftercare plan discussed", "Required documents and belongings prepared", "Client and family participated in planning",
      ]),
      {
        key: "tasks",
        label: "C. Tasks before discharge",
        type: "table",
        columns: [
          { key: "task", label: "Task / arrangement" },
          { key: "responsible", label: "Responsible person / agency" },
          { key: "due", label: "Due date" },
          { key: "status", label: "Status / remarks" },
        ],
      },
      choice("family", "D. Family participation", ["Family agrees with the plan", "Family agrees with comments/conditions", "Plan requires further discussion"]),
      area("family_comments", "Comments, concerns, or requested changes"),
      choice("decision", "E. Decision", ["Approved for discharge / case termination", "Deferred until required tasks are completed", "Transferred to another agency / LGU"]),
    ],
  },

  referral_letter: {
    id: "referral_letter",
    title: "Referral Letter",
    session: false,
    conforme: false,
    letter: true,
    fields: [
      text("focal_person", "Focal person"),
      text("position", "Position"),
      text("agency", "Foundation / agency"),
      text("address", "Address"),
      text("salutation", "Dear ...", { prefill: "Dear Sir/Madam," }),
      area("body", "Letter", {
        prefill:
          "Greetings in the Spirit of Service to Humanity!\n\nI respectfully refer a client who is currently receiving support through the programs and services of Little Ark Foundation Inc. to your institution for further assessment and appropriate assistance.\n\nLittle Ark Foundation Inc. is a nonprofit center-based facility in Quezon City that supports children aged zero (0) to eighteen (18) years old with cancer, thalassemia, and other critical illnesses, together with their caregivers. The Foundation provides free temporary shelter, meals, transportation, psychosocial support, activities, and spiritual care throughout their medical journey.\n\nThe client has reached the maximum age qualification of the Foundation's programs and remains in need of medical, financial, psychosocial, and other support services. To prevent any interruption in care, we have assessed that it is in the client's best interest to be referred and transitioned to an institution that can provide services appropriate to the client's age and continuing needs.\n\nWe hope that your institution can provide the appropriate assistance for the client's medical and psychosocial development. Your warmest consideration is highly appreciated. Should you have any queries, please contact us through info@littlearkfoundation.org or (+63) 976 215 6591.\n\nAttached is the Social Case Study Report of the client for more information.\n\nSincerely yours,",
      }),
    ],
  },

  dswd_case_summary: {
    id: "dswd_case_summary",
    title: "Social Case Summary (DSWD)",
    session: false,
    conforme: false,
    fields: [
      text("addressed_to", "Addressed to", { prefill: "The Head, Department of Social Welfare and Development, National Capital Region" }),
      text("civil_status", "Civil status"),
      area("problem", "B. Problem presented", {
        prefill: "The patient's parent/guardian is seeking financial assistance to support the patient's medications and laboratory procedures amounting to ₱____. Due to limited financial resources, the family is unable to fully defray the medical costs and is therefore seeking outside assistance.",
      }),
      area("assessment", "C. Assessment"),
      area("recommendation", "D. Recommendation", {
        prefill: "Based on the findings of the assessment and the socio-economic condition of the family, the patient is respectfully recommended for medical and/or financial assistance.",
      }),
    ],
  },
};

/** Every checklist carries an optional typed note ("Notes / others"), stored beside it under this key. */
export const noteKey = (checksKey: string) => `${checksKey}_notes`;
export const NOTE_LABEL = "Notes / others";
/** The session forms end with this box: recommended before approving, never required. */
export const FINDINGS_KEY = "findings";

export const FORM_IDS = Object.keys(FORMS) as FormId[];

/** The "New record" menu, in the order a case runs. */
export const FORM_GROUPS: readonly { label: string; forms: readonly FormId[] }[] = [
  { label: "Sessions", forms: ["casework", "counseling", "home_visit", "monitoring"] },
  { label: "Case records", forms: ["intake", "progress_note", "case_study", "intervention_plan"] },
  { label: "Leaving LAF", forms: ["pre_discharge_plan", "discharge_slip", "closing_summary", "transfer_summary", "aftercare_plan"] },
  { label: "Letters", forms: ["referral_letter", "dswd_case_summary"] },
];
export const SESSION_FORMS = FORM_IDS.filter((f) => FORMS[f].session);

/** The folder's papers (DSWD checklist order), for uploads and the "what's missing" list. */
export const DOCUMENT_KINDS = {
  admission_slip: "Admission slip",
  intake_sheet: "Intake sheet",
  case_study: "Social case study report",
  birth_certificate: "Birth certificate",
  photo: "Photo (on admission / discharge)",
  pwd_id: "Child's PWD ID",
  parent_id: "Parent's ID",
  intervention_plan: "Intervention plan and contract",
  medical_record: "Health / medical and dental records",
  progress_report: "Progress report / running records",
  monitoring: "Monitoring and evaluation report",
  referral_letter: "Referral letter",
  case_conference: "Case conference records, meetings",
  psych_evaluation: "Psychological / psychiatric evaluation",
  legal_record: "Legal or court records",
  home_visit: "Home visit form",
  casework_report: "Casework activity report",
  counseling_record: "Counseling process recording",
  discharge: "Discharge / closing papers",
  school_module: "School modules",
  signed_copy: "Signed copy of an app record",
  other: "Other",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export type FormData = Record<string, unknown>;

/** A record's fields filled from the patient record (keys named in `prefill`), or the paper's own
 * standard wording; never overwrites what is already there. */
export function prefillData(form: FormId, patient: Record<string, unknown>, data: FormData = {}): FormData {
  const out: FormData = { ...data };
  for (const f of FORMS[form].fields) {
    if (!("prefill" in f) || !f.prefill || out[f.key] != null) continue;
    const fromPatient = patient[f.prefill];
    if (typeof fromPatient === "string" && fromPatient.trim()) out[f.key] = fromPatient.trim();
    else if (!/^[a-z][A-Za-z]+$/.test(f.prefill)) out[f.key] = f.prefill;
  }
  return out;
}

/** Keeps only what the form defines, in the shape each field takes. Used on save and on what the
 * AI proposes, so nothing else is ever stored in a record. */
export function cleanData(form: FormId, raw: unknown): FormData {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max = 5000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const out: FormData = {};
  for (const f of FORMS[form].fields) {
    const v = src[f.key];
    if (f.type === "section") continue;
    if (f.type === "checks") {
      const picked = Array.isArray(v) ? f.options.filter((o) => v.includes(o)) : [];
      if (picked.length) out[f.key] = picked;
      const note = str(src[noteKey(f.key)], 2000);
      if (note) out[noteKey(f.key)] = note;
    } else if (f.type === "choice") {
      if (typeof v === "string" && f.options.includes(v)) out[f.key] = v;
    } else if (f.type === "date") {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.key] = v;
    } else if (f.type === "time") {
      if (typeof v === "string" && /^\d{2}:\d{2}$/.test(v)) out[f.key] = v;
    } else if (f.type === "table") {
      const rows = Array.isArray(v) ? v.slice(0, 30) : [];
      const kept = rows
        .map((r) => Object.fromEntries(f.columns.flatMap((c) => (str((r as Record<string, unknown>)?.[c.key], 300) ? [[c.key, str((r as Record<string, unknown>)[c.key], 300)]] : []))))
        .filter((r) => Object.keys(r).length);
      if (kept.length) out[f.key] = kept;
    } else if (f.type === "ratings") {
      const obj = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const kept = Object.fromEntries(f.rows.flatMap((r) => (typeof obj[r] === "string" && f.options.includes(obj[r] as string) ? [[r, obj[r]]] : [])));
      if (Object.keys(kept).length) out[f.key] = kept;
    } else {
      const s = str(v, f.type === "textarea" ? 5000 : 300);
      if (s) out[f.key] = s;
    }
  }
  return out;
}

/** The case number a PDF carries: the app's LFCN by default, the paper folder's on request. */
export function caseNumberFor(patient: { caseNumber?: string | null; legacyCode?: string | null }, useOriginal: boolean): string {
  return (useOriginal && patient.legacyCode) || patient.caseNumber || "";
}

/** What the AI read off a paper, as key/value pairs (a strict schema can't hold free shapes):
 * checklists come back joined by " | ", tables and ratings as JSON. cleanData then keeps only
 * what the form defines. */
export function dataFromPairs(form: FormId, pairs: readonly { key: string; value: string }[]): FormData {
  const raw: Record<string, unknown> = {};
  for (const { key, value } of pairs) {
    if (value && FORMS[form].fields.some((x) => x.type === "checks" && noteKey(x.key) === key)) {
      raw[key] = value;
      continue;
    }
    const f = FORMS[form].fields.find((x) => x.key === key);
    if (!f || !value) continue;
    if (f.type === "checks") raw[key] = value.split("|").map((s) => s.trim());
    else if (f.type === "table" || f.type === "ratings") {
      try {
        raw[key] = JSON.parse(value);
      } catch {
        // unreadable structure: left out
      }
    } else raw[key] = value;
  }
  return cleanData(form, raw);
}

/** The forms described for the AI: each field's key, kind, label and allowed options. */
export function formsForAi(): string {
  return FORM_IDS.map((id) => {
    const lines = FORMS[id].fields
      .filter((f) => f.type !== "section")
      .map((f) => {
        const opts = "options" in f ? ` options: ${f.options.join(" | ")}${f.type === "checks" ? `; anything written beside it goes in ${noteKey(f.key)} (text)` : ""}` : "";
        const extra = f.type === "table" ? ` JSON array of objects with keys ${f.columns.map((c) => c.key).join(", ")}` : f.type === "ratings" ? ` JSON object {row: option}, rows: ${f.rows.join(" | ")}; options: ${f.options.join(" | ")}` : "";
        return `  ${f.key} (${f.type}) ${f.label}.${opts}${extra}`;
      });
    return `FORM ${id}: ${FORMS[id].title}\n${lines.join("\n")}`;
  }).join("\n\n");
}

/** The DSWD case folder checklist (the P139 folder's first page), in its order. An item is in the
 * folder when an approved app record of one of its forms exists, or a paper of one of its kinds is
 * uploaded. Drives the Case file's "still missing" note and the folder PDF (0126). */
export const FOLDER_CHECKLIST: readonly { label: string; forms: readonly FormId[]; kinds: readonly DocumentKind[]; required: boolean }[] = [
  { label: "Admission slip", forms: [], kinds: ["admission_slip"], required: true },
  { label: "Intake sheet", forms: ["intake"], kinds: ["intake_sheet"], required: true },
  { label: "Social case study report", forms: ["case_study"], kinds: ["case_study"], required: true },
  { label: "Birth certificate", forms: [], kinds: ["birth_certificate"], required: true },
  { label: "Photo (on admission and discharge)", forms: [], kinds: ["photo"], required: true },
  { label: "Intervention plan and contract", forms: ["intervention_plan"], kinds: ["intervention_plan"], required: true },
  { label: "Health / medical and dental records", forms: [], kinds: ["medical_record"], required: true },
  { label: "Progress reports and running records", forms: ["progress_note", "casework", "counseling"], kinds: ["progress_report", "casework_report", "counseling_record"], required: true },
  { label: "Monitoring and evaluation report", forms: ["monitoring", "home_visit"], kinds: ["monitoring", "home_visit"], required: true },
  { label: "Referral letters, case conference records, meetings", forms: ["referral_letter", "dswd_case_summary"], kinds: ["referral_letter", "case_conference"], required: false },
  { label: "Psychological / psychiatric evaluation", forms: [], kinds: ["psych_evaluation"], required: false },
  { label: "Legal or court records", forms: [], kinds: ["legal_record"], required: false },
  { label: "Discharge and aftercare papers", forms: ["pre_discharge_plan", "discharge_slip", "closing_summary", "transfer_summary", "aftercare_plan"], kinds: ["discharge"], required: false },
];

/** Each checklist item and whether the folder has it. */
export function folderStatus(records: readonly { form: FormId; status: string }[], documents: readonly { kind: DocumentKind }[]) {
  return FOLDER_CHECKLIST.map((c) => ({
    ...c,
    have: records.some((r) => r.status === "approved" && c.forms.includes(r.form)) || documents.some((d) => c.kinds.includes(d.kind)),
  }));
}

/** The order records take in the folder PDF: the checklist's, then anything left, by date. */
export function folderOrder<R extends { form: FormId; heldOn: string | null }>(records: readonly R[]): R[] {
  const rank = (f: FormId) => {
    const i = FOLDER_CHECKLIST.findIndex((c) => c.forms.includes(f));
    return i < 0 ? FOLDER_CHECKLIST.length : i;
  };
  return [...records].sort((a, b) => rank(a.form) - rank(b.form) || (a.heldOn ?? "").localeCompare(b.heldOn ?? ""));
}

/** What ops.case_period_report (0126) returns: counts only. */
export interface CasePeriodCounts {
  records: Partial<Record<FormId, number>>;
  drafts: number;
  children_seen: number;
  referrals: Partial<Record<"submitted" | "approved" | "waitlisted" | "declined" | "admitted", number>>;
  housed: Partial<Record<"M" | "F" | "unknown", number>>;
  first_stays: number;
}

const REFERRAL_LABEL = { submitted: "Still to decide", approved: "Approved", waitlisted: "Waitlisted", declined: "Declined", admitted: "Admitted" } as const;

/** The report's rows, in the order the page and the PDF show them. */
export function periodReportRows(c: CasePeriodCounts): { section: string; label: string; value: number }[] {
  const housed = (k: "M" | "F" | "unknown") => c.housed[k] ?? 0;
  const referrals = Object.values(c.referrals).reduce((a, n) => a + (n ?? 0), 0);
  return [
    { section: "Children served", label: "Girls housed", value: housed("F") },
    { section: "Children served", label: "Boys housed", value: housed("M") },
    ...(housed("unknown") ? [{ section: "Children served", label: "Sex not recorded", value: housed("unknown") }] : []),
    { section: "Children served", label: "Total children housed", value: housed("F") + housed("M") + housed("unknown") },
    { section: "Children served", label: "First stay with LAF", value: c.first_stays },
    { section: "Referrals received", label: "Total", value: referrals },
    ...(Object.keys(REFERRAL_LABEL) as (keyof typeof REFERRAL_LABEL)[]).filter((k) => c.referrals[k]).map((k) => ({ section: "Referrals received", label: REFERRAL_LABEL[k], value: c.referrals[k]! })),
    { section: "Case work (approved records)", label: "Children with a record", value: c.children_seen },
    ...FORM_GROUPS.flatMap((g) => g.forms).filter((f) => c.records[f]).map((f) => ({ section: "Case work (approved records)", label: FORMS[f].title, value: c.records[f]! })),
    ...(c.drafts ? [{ section: "Case work (approved records)", label: "Drafts not yet approved", value: c.drafts }] : []),
  ];
}

/** "2026-10" is October 2026; "2026" is the whole year (the DSWD annual report). */
export function periodRange(period: string): { from: string; to: string; title: string } | null {
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]);
  if (!m[2]) return { from: `${y}-01-01`, to: `${y}-12-31`, title: `January to December ${y}` };
  const last = new Date(Date.UTC(y, Number(m[2]), 0)).getUTCDate();
  const month = new Date(Date.UTC(y, Number(m[2]) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return { from: `${period}-01`, to: `${period}-${last}`, title: `${month} ${y}` };
}
