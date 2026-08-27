// --- START: CSV CONVERTER MODULE IMPORTS ---
import {
  addBeneficiary,
  fetchBatches,
  fetchBeneficiaries,
  fetchEducationLevels,
  invalidateBeneficiaryCache,
  updateBeneficiary,
} from "../../backend/api/beneficiary.js";
import { fetchImplementorList } from "../../backend/api/auth.js";
import { supabase } from "../../backend/api/supabase.js";
// --- END: CSV CONVERTER MODULE IMPORTS ---

const LOG_PREFIX = "[SPES CSV Converter]";

const FALLBACK_EDUCATION_LEVELS = [
  { id: 1, education_id: 1, name: "Grade 11", sort_order: 1 },
  { id: 2, education_id: 1, name: "Grade 12", sort_order: 2 },
  { id: 3, education_id: 3, name: "1st Year", sort_order: 1 },
  { id: 4, education_id: 3, name: "2nd Year", sort_order: 2 },
  { id: 5, education_id: 3, name: "3rd Year", sort_order: 3 },
  { id: 6, education_id: 3, name: "4th Year", sort_order: 4 },
  { id: 8, education_id: 4, name: "Grade 7", sort_order: 1 },
  { id: 9, education_id: 4, name: "Grade 8", sort_order: 2 },
  { id: 10, education_id: 4, name: "Grade 9", sort_order: 3 },
  { id: 11, education_id: 4, name: "Grade 10", sort_order: 4 },
];

const MANAGED_FIELDS = [
  "full_name", "gender_id", "address", "contact_number",
  "month_period", "year_period", "designated", "birthday", "age", "educ_id",
  "education_level_id", "batch_id", "staff_id", "return_status",
];

const CSV_COLUMN = Object.freeze({
  fullName: 0,
  age: 2,
  sex: 3,
  address: 4,
  contactNumber: 5,
  participantCategory: 6,
  educationLevel: 7,
  returnStatus: 8,
  // CSV column 9 (Occupational / Code & Position) is intentionally not stored.
  occupationalCodePosition: 9,
  employmentPeriod: 11,
  designated: 12,
  birthday: 18,
});

// --- START: HEADER-AWARE CSV COLUMN COMPATIBILITY ---
function resolveCsvColumns(headerRow = []) {
  const headers = headerRow.map(normalizeKey);
  const findAll = aliases => headers
    .map((header, index) => aliases.includes(header) ? index : -1)
    .filter(index => index >= 0);
  const first = (aliases, fallback) => findAll(aliases)[0] ?? fallback;
  const last = (aliases, fallback) => findAll(aliases).at(-1) ?? fallback;
  const preferred = (primaryAliases, fallbackAliases, fallback) =>
    first(primaryAliases, first(fallbackAliases, fallback));

  return {
    ...CSV_COLUMN,
    fullName: first(["SPES BENEFICIARY"], CSV_COLUMN.fullName),
    // The current Excel layout keeps the completed values in the right-side columns.
    age: last(["AGE"], CSV_COLUMN.age),
    sex: preferred(["GENDER"], ["SEX"], CSV_COLUMN.sex),
    address: last(["FULL ADDRESS", "ADDRESS"], CSV_COLUMN.address),
    contactNumber: first(["CONTACT NO", "CONTACT NUMBER"], CSV_COLUMN.contactNumber),
    participantCategory: first(["STUDENT OSY DEPENDENT OF DISPLACED WORKER"], CSV_COLUMN.participantCategory),
    educationLevel: first(["EDUCATIONAL LEVEL"], CSV_COLUMN.educationLevel),
    returnStatus: first(["NEW SPES BABY", "NEW SPES BABY STATUS"], CSV_COLUMN.returnStatus),
    employmentPeriod: first(["EMPLOYMENT PERIOD"], CSV_COLUMN.employmentPeriod),
    designated: first(["GSIS BENEFICIARY", "DESIGNATED"], CSV_COLUMN.designated),
    birthday: first(["BIRTHDATE", "BIRTH DATE"], CSV_COLUMN.birthday),
  };
}
// --- END: HEADER-AWARE CSV COLUMN COMPATIBILITY ---

// --- START: CONVERTER LOGGING UTILITY ---
function logGroup(label, details) {
  console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  if (Array.isArray(details)) console.table(details);
  else console.log(details);
  console.groupEnd();
}
// --- END: CONVERTER LOGGING UTILITY ---

// --- START: MOJIBAKE AND ENCODING REPAIR ---
/**
 * Repairs corrupt UTF-8 / Windows-1252 / ISO-8859-1 mojibake characters
 * commonly found in government spreadsheets and Excel CSV exports.
 */
function repairMojibake(value) {
  let text = String(value ?? "");
  if (!text) return "";

  // Iteratively repair multi-byte mojibake cascades (up to 3 passes)
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;

    // Spanish / Filipino letters
    text = text
      .replaceAll("Ã‘", "Ñ")
      .replaceAll("Ã±", "ñ")
      .replaceAll("Ã‰", "É")
      .replaceAll("Ã©", "é")
      .replaceAll("Ã", "Á")
      .replaceAll("Ã¡", "á")
      .replaceAll("Ã", "Í")
      .replaceAll("Ã­", "í")
      .replaceAll("Ã“", "Ó")
      .replaceAll("Ã³", "ó")
      .replaceAll("Ãš", "Ú")
      .replaceAll("Ãº", "ú")
      .replaceAll("Ãœ", "Ü")
      .replaceAll("Ã¼", "ü");

    // Punctuation, dashes, bullets, and quotation marks
    text = text
      .replaceAll("â€“", "–")
      .replaceAll("â€”", "—")
      .replaceAll("â€™", "’")
      .replaceAll("â€˜", "‘")
      .replaceAll("â€œ", "“")
      .replaceAll("â€", "”")
      .replaceAll("â€¦", "…")
      .replaceAll("â€¢", "•")
      .replaceAll("Â·", "·")
      .replaceAll("Â", "");

    if (text === before) break;
  }

  return text;
}
// --- END: MOJIBAKE AND ENCODING REPAIR ---

// --- START: TEXT SANITIZATION UTILITY ---
function cleanText(value) {
  return repairMojibake(value)
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// --- END: TEXT SANITIZATION UTILITY ---

// --- START: KEY NORMALIZATION UTILITY ---
function normalizeKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// --- END: KEY NORMALIZATION UTILITY ---

// --- START: PHONE NORMALIZATION UTILITY ---
function normalizePhone(value) {
  return cleanText(value).replace(/\D/g, "");
}
// --- END: PHONE NORMALIZATION UTILITY ---

// --- START: COMPARABLE FIELD NORMALIZATION ---
function normalizeComparable(field, value) {
  if (value == null || value === "") return "";
  if (["gender_id", "age", "educ_id", "education_level_id", "batch_id", "staff_id"].includes(field)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : "";
  }
  if (field === "contact_number") return normalizePhone(value);
  if (field === "full_name") return normalizeKey(value);
  return cleanText(value).toUpperCase();
}
// --- END: COMPARABLE FIELD NORMALIZATION ---

// --- START: VALUE EQUALITY COMPARATOR ---
function valuesEqual(field, current, incoming) {
  return normalizeComparable(field, current) === normalizeComparable(field, incoming);
}
// --- END: VALUE EQUALITY COMPARATOR ---

// --- START: CSV ROW PARSER ---
export function parseCsvRows(csvText) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "");
  const firstContentLine = text.split(/\r?\n/).find(line => line.trim()) ?? "";
  const delimiter = (firstContentLine.match(/\t/g)?.length ?? 0) > (firstContentLine.match(/,/g)?.length ?? 0)
    ? "\t"
    : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cleanText(field));
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cleanText(field));
      field = "";
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }

  row.push(cleanText(field));
  if (row.some(cell => cell !== "")) rows.push(row);
  return rows;
}
// --- END: CSV ROW PARSER ---

// --- START: BENEFICIARY ROW EXTRACTOR ---
function findBeneficiaryRows(rows) {
  const headerIndex = rows.findIndex(row =>
    normalizeKey(row[0]) === "SPES BENEFICIARY" && row.some(cell => normalizeKey(cell) === "AGE")
  );
  if (headerIndex === -1) throw new Error('Could not find the "SPES BENEFICIARY" CSV header row.');
  const columns = resolveCsvColumns(rows[headerIndex]);

  return rows
    .map((row, index) => ({ row, sourceRow: index + 1, columns }))
    .slice(headerIndex + 1)
    .filter(({ row }) => {
      const name = cleanText(row[columns.fullName]);
      const nameKey = normalizeKey(name);
      const hasBeneficiaryDetails = [
        columns.age,
        columns.sex,
        columns.address,
        columns.contactNumber,
        columns.participantCategory,
        columns.educationLevel,
        columns.returnStatus,
        columns.birthday,
      ].some(column => cleanText(row[column]));
      return Boolean(name) && hasBeneficiaryDetails &&
        !nameKey.startsWith("NOTE THIS FORM") &&
        !nameKey.startsWith("LAST NAME FIRST NAME");
    });
}
// --- END: BENEFICIARY ROW EXTRACTOR ---

// --- START: DATE PARSER ---
function parseDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  const monthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  const numericMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  const namedMatch = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);

  let month;
  let day;
  let year;
  if (numericMatch) {
    month = Number(numericMatch[1]);
    day = Number(numericMatch[2]);
    const yearToken = numericMatch[3];
    year = yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken);
  } else if (namedMatch) {
    month = monthNames.indexOf(normalizeKey(namedMatch[1])) + 1;
    day = Number(namedMatch[2]);
    year = Number(namedMatch[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// --- END: DATE PARSER ---

// --- START: BIRTHDAY-FIRST AGE CALCULATION ---
function calculateAgeFromBirthday(birthday, referenceDate = new Date()) {
  const [year, month, day] = String(birthday ?? "").split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;

  let age = referenceDate.getFullYear() - year;
  const birthdayHasNotOccurred = referenceDate.getMonth() + 1 < month ||
    (referenceDate.getMonth() + 1 === month && referenceDate.getDate() < day);
  if (birthdayHasNotOccurred) age -= 1;

  return age >= 0 && age <= 99 ? age : null;
}
// --- END: BIRTHDAY-FIRST AGE CALCULATION ---

// --- START: EMPLOYMENT PERIOD PARSER ---
function parsePeriod(value) {
  const normalized = normalizeKey(value);
  const match = normalized.match(/^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return { month: match[1], year };
}
// --- END: EMPLOYMENT PERIOD PARSER ---

// --- START: GENDER RESOLVER ---
function resolveGenderId(value, genders) {
  const key = normalizeKey(value);
  const desiredName = key === "M" || key === "MALE"
    ? "MALE"
    : key === "F" || key === "FEMALE"
      ? "FEMALE"
      : "";
  if (!desiredName) return null;
  const match = genders.find(gender => normalizeKey(gender.name) === desiredName);
  if (match) return Number(match.id);
  return desiredName === "MALE" ? 1 : 2;
}
// --- END: GENDER RESOLVER ---

// --- START: CANONICAL LEVEL NAME NORMALIZER ---
function canonicalLevelName(rawValue) {
  const value = normalizeKey(rawValue)
    .replace(/\bYR\b/g, "YEAR")
    .replace(/\bCOLLEGE\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const yearMatch = value.match(/\b(1ST|2ND|3RD|4TH)\s+YEAR\b/);
  if (yearMatch) return `${yearMatch[1][0]}${yearMatch[1].slice(1).toLowerCase()} Year`;
  const gradeMatch = value.match(/\b(?:GRADE|G)\s*(7|8|9|10|11|12)\b/);
  if (gradeMatch) return `Grade ${gradeMatch[1]}`;
  return cleanText(rawValue);
}
// --- END: CANONICAL LEVEL NAME NORMALIZER ---

// --- START: COLLEGE COURSE HEURISTIC CHECK ---
function looksLikeCollegeCourse(rawKey) {
  if (!rawKey) return false;
  const tokens = rawKey.split(" ").filter(Boolean);
  const firstToken = tokens[0] ?? "";
  const degreePrefix = /^(?:AB|BA|BEED|BSED|BS|BSA|BSBA|BSC|BSCS|BSIT|BSTM|BT[A-Z]*|B[A-Z]{2,})$/;
  if (degreePrefix.test(firstToken) || rawKey === "B") return true;
  if (tokens.length >= 3 && !/(?:HIGH SCHOOL|HIGHSCHOOL|GRADE|COLLEGE GRADUATE|OSY)/.test(rawKey)) return true;
  return false;
}
// --- END: COLLEGE COURSE HEURISTIC CHECK ---

// --- START: EDUCATION RESOLVER ---
function resolveEducation(rawLevel, participantCategory, categories, levels) {
  const rawKey = normalizeKey(rawLevel);
  const participantKey = normalizeKey(participantCategory);
  const categoryByName = name => categories.find(category => normalizeKey(category.name) === normalizeKey(name));
  const categoryOnly = name => {
    const category = categoryByName(name);
    return category
      ? { educ_id: Number(category.id), education_level_id: null, skipLevel: true }
      : { error: `Education category "${name}" was not found.` };
  };

  if (rawKey.includes("COLLEGE GRADUATE")) return categoryOnly("College Graduate");
  if (rawKey === "OSY") return categoryOnly("OSY");

  const canonicalName = canonicalLevelName(rawLevel);
  const level = levels.find(item => normalizeKey(item.name) === normalizeKey(canonicalName));
  if (level) return { educ_id: Number(level.education_id), education_level_id: Number(level.id) };

  if (["SENIOR HIGH", "SENIOR HIGH SCHOOL", "SENIOR HIGHSCHOOL"].includes(rawKey)) return categoryOnly("Senior Highschool");
  if (["JUNIOR HIGH", "JUNIOR HIGH SCHOOL", "JUNIOR HIGHSCHOOL", "HIGH SCHOOL", "HIGHSCHOOL"].includes(rawKey)) return categoryOnly("Highschool");
  if (["COLLEGE", "COLLEGE LEVEL", "TERTIARY"].includes(rawKey) || looksLikeCollegeCourse(rawKey)) {
    return categoryOnly("College Level");
  }

  const directCategory = categories.find(category => normalizeKey(category.name) === rawKey);
  if (directCategory) return { educ_id: Number(directCategory.id), education_level_id: null, skipLevel: true };

  if (!rawKey) {
    if (participantKey === "OSY") return categoryOnly("OSY");
    if (["SENIOR HIGH", "SENIOR HIGH SCHOOL", "SENIOR HIGHSCHOOL"].includes(participantKey)) return categoryOnly("Senior Highschool");
    if (["JUNIOR HIGH", "JUNIOR HIGH SCHOOL", "JUNIOR HIGHSCHOOL", "HIGH SCHOOL", "HIGHSCHOOL"].includes(participantKey)) return categoryOnly("Highschool");
    if (["COLLEGE", "COLLEGE LEVEL", "TERTIARY"].includes(participantKey)) return categoryOnly("College Level");
  }
  return { error: `Unknown educational level: "${cleanText(rawLevel) || "(blank)"}".` };
}
// --- END: EDUCATION RESOLVER ---

// --- START: RETURN STATUS NORMALIZER ---
function normalizeReturnStatus(value) {
  const key = normalizeKey(value);
  if (key === "NEW") return "NEW";
  if (["SPES BABY", "RETURNING", "RETURNEE"].includes(key)) return "SPES BABY";
  return null;
}
// --- END: RETURN STATUS NORMALIZER ---

// --- START: PAYLOAD CREATOR ---
function createPayload(csvRow, context) {
  const errors = [];
  const warnings = [];
  const skippedFields = [];
  const columns = csvRow.columns ?? CSV_COLUMN;
  const fullName = cleanText(csvRow.row[columns.fullName]).toUpperCase();
  const rawAge = cleanText(csvRow.row[columns.age]);
  const csvAge = /^\d{1,2}$/.test(rawAge) ? Number(rawAge) : null;
  const rawSex = cleanText(csvRow.row[columns.sex]);
  const genderId = resolveGenderId(rawSex, context.genders);
  const rawAddress = cleanText(csvRow.row[columns.address]);
  const rawContact = cleanText(csvRow.row[columns.contactNumber]);
  const rawBirthday = cleanText(csvRow.row[columns.birthday]);
  const birthday = parseDate(rawBirthday);
  const birthdayAge = birthday ? calculateAgeFromBirthday(birthday) : null;
  const age = birthdayAge ?? csvAge;
  const rawPeriod = cleanText(csvRow.row[columns.employmentPeriod]);
  const period = parsePeriod(rawPeriod);
  const rawDesignated = cleanText(csvRow.row[columns.designated]);
  const rawStatus = cleanText(csvRow.row[columns.returnStatus]);
  const returnStatus = normalizeReturnStatus(rawStatus);
  const rawEducation = cleanText(csvRow.row[columns.educationLevel]);
  const education = resolveEducation(
    rawEducation,
    csvRow.row[columns.participantCategory],
    context.education,
    context.educationLevels
  );

  if (!fullName) errors.push("Full name is required.");
  if (!Number.isInteger(age) || age < 1 || age > 99) {
    warnings.push(`Age "${rawAge || "(blank)"}" was not imported.`);
    skippedFields.push("age");
  } else if (birthdayAge != null && csvAge != null && csvAge !== birthdayAge) {
    warnings.push(`Age "${rawAge}" was recalculated to "${birthdayAge}" from the CSV birthday.`);
  }
  if (!genderId) {
    warnings.push(`Sex "${rawSex || "(blank)"}" was not imported.`);
    skippedFields.push("gender_id");
  }
  if (!rawAddress) {
    warnings.push("Address is blank and was not imported.");
    skippedFields.push("address");
  }
  if (!rawContact) {
    warnings.push("Contact number is blank and was not imported.");
    skippedFields.push("contact_number");
  }
  if (!birthday) {
    warnings.push(`Birthday "${rawBirthday || "(blank)"}" was not imported.`);
    skippedFields.push("birthday");
  }
  if (!period) {
    warnings.push(`Employment period "${rawPeriod || "(blank)"}" was not imported; month and year were skipped.`);
    skippedFields.push("month_period", "year_period");
  }
  if (!rawDesignated) {
    warnings.push("GSIS Beneficiary is blank; existing designated values stay unchanged.");
    skippedFields.push("designated");
  }
  if (!returnStatus) {
    warnings.push(`Status "${rawStatus || "(blank)"}" was not imported; existing data is preserved and new records use the database default.`);
    skippedFields.push("return_status");
  }
  if (education.error) {
    warnings.push(`${education.error} Education fields were not imported.`);
    skippedFields.push("educ_id", "education_level_id");
  } else if (education.skipLevel) {
    if (education.warning) warnings.push(education.warning);
    skippedFields.push("education_level_id");
  }

  return {
    sourceRow: csvRow.sourceRow,
    csv: csvRow.row,
    errors,
    warnings,
    skippedFields,
    payload: {
      full_name: fullName,
      gender_id: genderId,
      address: rawAddress.toUpperCase() || null,
      contact_number: rawContact || null,
      month_period: period?.month ?? null,
      year_period: period?.year ?? null,
      designated: rawDesignated || null,
      birthday,
      age: Number.isInteger(age) ? age : null,
      educ_id: education.educ_id ?? null,
      education_level_id: education.education_level_id ?? null,
      batch_id: Number(context.batchId),
      staff_id: Number(context.staffId),
      return_status: returnStatus,
      relationship: null,
    },
  };
}
// --- END: PAYLOAD CREATOR ---

// --- START: BENEFICIARY MATCH FINDER ---
function findExistingMatch(desired, existingRows) {
  const sameBatch = existingRows.filter(row => Number(row.batch_id) === Number(desired.batch_id));
  const nameKey = normalizeKey(desired.full_name);
  const nameMatches = sameBatch.filter(row => normalizeKey(row.full_name) === nameKey);

  if (nameMatches.length === 1) return { match: nameMatches[0], matchedBy: "batch + name" };
  if (nameMatches.length > 1) {
    const birthdayMatches = nameMatches.filter(row => desired.birthday && row.birthday === desired.birthday);
    if (birthdayMatches.length === 1) return { match: birthdayMatches[0], matchedBy: "batch + name + birthday" };
    return { ambiguous: nameMatches, matchedBy: "duplicate name in selected batch" };
  }

  const phone = normalizePhone(desired.contact_number);
  const strongMatches = sameBatch.filter(row =>
    desired.birthday && row.birthday === desired.birthday && phone && normalizePhone(row.contact_number) === phone
  );
  if (strongMatches.length === 1) return { match: strongMatches[0], matchedBy: "batch + birthday + contact" };

  const addressKey = normalizeKey(desired.address);
  const addressMatches = sameBatch.filter(row =>
    desired.birthday && row.birthday === desired.birthday && addressKey &&
    normalizeKey(row.address) === addressKey && Number(row.gender_id) === Number(desired.gender_id)
  );
  if (addressMatches.length === 1) {
    return { match: addressMatches[0], matchedBy: "batch + birthday + address + gender" };
  }
  return { match: null, matchedBy: "no existing match" };
}
// --- END: BENEFICIARY MATCH FINDER ---

// --- START: RECORD DIFFERENCE DETECTOR ---
function createDiffs(current, desired) {
  return MANAGED_FIELDS
    .filter(field => !valuesEqual(field, current?.[field], desired[field]))
    .map(field => ({ field, current: current?.[field] ?? null, incoming: desired[field] ?? null }));
}
// --- END: RECORD DIFFERENCE DETECTOR ---

// --- START: PLAN SUMMARY AGGREGATOR ---
function summarizePlan(rows) {
  const summary = rows.reduce((result, row) => {
    result.total += 1;
    result[row.action] = (result[row.action] ?? 0) + 1;
    return result;
  }, { total: 0, insert: 0, update: 0, skip: 0, invalid: 0, ambiguous: 0 });
  summary.warnings = rows.filter(row => row.warnings?.length).length;
  return summary;
}
// --- END: PLAN SUMMARY AGGREGATOR ---

// --- START: EXECUTABLE ROW VALIDATOR ---
function isExecutableRow(row) {
  if (row.included === false) return false;
  if (row.action === "insert") return true;
  if (row.action !== "update") return false;
  return row.differences.some(difference => difference.included !== false);
}
// --- END: EXECUTABLE ROW VALIDATOR ---

// --- START: EXECUTABLE ROWS FILTER ---
export function getExecutableRows(plan) {
  return plan.rows.filter(isExecutableRow);
}
// --- END: EXECUTABLE ROWS FILTER ---

// --- START: EFFECTIVE PAYLOAD BUILDER ---
export function buildEffectivePayload(row) {
  if (row.action !== "update") return { ...row.payload };
  return row.differences.reduce((payload, difference) => {
    if (difference.included === false) payload[difference.field] = difference.current;
    return payload;
  }, { ...row.payload });
}
// --- END: EFFECTIVE PAYLOAD BUILDER ---

// --- START: SYSTEM BENEFICIARY DUPLICATE CHECK ---
/**
 * Groups system beneficiaries that share the same normalized full name.
 * The source records remain untouched; this is a read-only diagnostic.
 */
export function findBeneficiaryDuplicateGroups(beneficiaries = [], { includeArchived = true } = {}) {
  const groups = new Map();

  beneficiaries.forEach(record => {
    if (!record || (!includeArchived && record.archived_at)) return;
    const name = cleanText(record.full_name);
    const key = normalizeKey(name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  return [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => ({
      key,
      name: cleanText(records[0]?.full_name).toUpperCase(),
      records: [...records].sort((a, b) => Number(a.id) - Number(b.id)),
    }))
    .sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name));
}
// --- END: SYSTEM BENEFICIARY DUPLICATE CHECK ---

// --- START: CONVERTER CONTEXT LOADER ---
export async function loadConverterContext({ includeBeneficiaries = true } = {}) {
  console.group(`${LOG_PREFIX} Loading dropdown/reference details`);
  const [batchesResult, implementors, beneficiariesResult, educationResult, levelsResult, gendersResult] = await Promise.all([
    fetchBatches({ forceRefresh: true }),
    fetchImplementorList({ forceRefresh: true }),
    includeBeneficiaries ? fetchBeneficiaries({ forceRefresh: true }) : Promise.resolve({ data: [] }),
    supabase.from("education").select("id, name").order("name"),
    fetchEducationLevels({ forceRefresh: true }),
    supabase.from("genders").select("id, name").order("id"),
  ]);

  const errors = [
    batchesResult.error,
    beneficiariesResult.error,
    educationResult.error?.message,
    gendersResult.error?.message,
  ].filter(Boolean);
  if (errors.length) {
    console.error(`${LOG_PREFIX} Reference loading failed`, errors);
    console.groupEnd();
    throw new Error(errors.join(" "));
  }

  const educationLevels = levelsResult.data?.length ? levelsResult.data : FALLBACK_EDUCATION_LEVELS;
  console.table(batchesResult.data ?? []);
  console.table(implementors ?? []);
  console.table(educationResult.data ?? []);
  console.table(educationLevels);
  console.table(gendersResult.data ?? []);
  console.log(`${LOG_PREFIX} Existing beneficiary rows:`, beneficiariesResult.data?.length ?? 0);
  console.groupEnd();

  return {
    batches: batchesResult.data ?? [],
    implementors: implementors ?? [],
    beneficiaries: beneficiariesResult.data ?? [],
    education: educationResult.data ?? [],
    educationLevels,
    genders: gendersResult.data?.length ? gendersResult.data : [
      { id: 1, name: "MALE" },
      { id: 2, name: "FEMALE" },
    ],
  };
}
// --- END: CONVERTER CONTEXT LOADER ---

// --- START: IMPORT PLAN BUILDER ---
export function buildImportPlan(csvText, context, selection) {
  const batchId = Number(selection.batchId);
  const staffId = Number(selection.staffId);
  if (!Number.isInteger(batchId)) throw new Error("Select a target batch.");
  if (!Number.isInteger(staffId)) throw new Error("Select a target implementor.");

  const selectedBatch = context.batches.find(batch => Number(batch.id) === batchId);
  const selectedStaff = context.implementors.find(staff => Number(staff.id) === staffId);
  if (!selectedBatch) throw new Error("The selected batch is no longer available.");
  if (!selectedStaff) throw new Error("The selected implementor is no longer available.");

  const rows = findBeneficiaryRows(parseCsvRows(csvText));
  const duplicateCsvNames = new Map();
  rows.forEach(row => {
    const key = normalizeKey(row.row[CSV_COLUMN.fullName]);
    duplicateCsvNames.set(key, (duplicateCsvNames.get(key) ?? 0) + 1);
  });

  const plannedRows = rows.map(csvRow => {
    const prepared = createPayload(csvRow, { ...context, batchId, staffId });
    const duplicateCount = duplicateCsvNames.get(normalizeKey(prepared.payload.full_name)) ?? 0;

    if (duplicateCount > 1) {
      return { ...prepared, action: "ambiguous", reason: "This name appears more than once in the pasted CSV.", differences: [] };
    }
    if (prepared.errors.length) {
      return { ...prepared, action: "invalid", reason: prepared.errors.join(" "), differences: [] };
    }

    const identity = findExistingMatch(prepared.payload, context.beneficiaries);
    if (identity.ambiguous) {
      return {
        ...prepared,
        action: "ambiguous",
        reason: `Multiple Supabase records match by ${identity.matchedBy}.`,
        matchedBy: identity.matchedBy,
        candidates: identity.ambiguous,
        differences: [],
      };
    }
    if (!identity.match) {
      return {
        ...prepared,
        action: "insert",
        included: true,
        reason: "No beneficiary in the selected batch matched this CSV row.",
        matchedBy: identity.matchedBy,
        differences: [],
      };
    }

    const desiredPayload = { ...prepared.payload, relationship: identity.match.relationship ?? null };
    prepared.skippedFields.forEach(field => {
      const categoryChanges = field === "education_level_id" &&
        prepared.payload.educ_id != null &&
        Number(prepared.payload.educ_id) !== Number(identity.match.educ_id);
      desiredPayload[field] = categoryChanges ? null : (identity.match[field] ?? null);
    });
    const differences = createDiffs(identity.match, desiredPayload)
      .map(difference => ({ ...difference, included: true }));
    return {
      ...prepared,
      payload: desiredPayload,
      existing: identity.match,
      existingId: identity.match.id,
      matchedBy: identity.matchedBy,
      differences,
      action: differences.length ? "update" : "skip",
      included: differences.length > 0,
      reason: differences.length
        ? `${differences.length} field(s) differ from Supabase.`
        : "Every managed CSV field already matches Supabase.",
    };
  });

  const summary = summarizePlan(plannedRows);
  const plan = {
    createdAt: new Date().toISOString(),
    selection: {
      batchId,
      staffId,
      batchLabel: selectedBatch.batch_name || `Batch ${selectedBatch.id}`,
      staffLabel: selectedStaff.full_name,
      officeLabel: selectedStaff.office,
      officeId: selectedStaff.office_id ?? null,
    },
    rows: plannedRows,
    summary,
  };

  logGroup("Import plan summary", [summary]);
  logGroup("Row decisions", plannedRows.map(row => ({
    csvRow: row.sourceRow,
    name: row.payload.full_name,
    action: row.action,
    matchedBy: row.matchedBy ?? "",
    differences: row.differences?.map(diff => diff.field).join(", ") ?? "",
    reason: row.reason,
    warnings: row.warnings?.join(" | ") ?? "",
  })));
  return plan;
}
// --- END: IMPORT PLAN BUILDER ---

// --- START: IMPORT PLAN EXECUTOR ---
export async function executeImportPlan(plan, { onProgress } = {}) {
  const executableRows = getExecutableRows(plan);
  const results = [];
  console.group(`${LOG_PREFIX} Applying ${executableRows.length} mutation(s)`);

  for (let index = 0; index < executableRows.length; index += 1) {
    const row = executableRows[index];
    const position = index + 1;
    console.groupCollapsed(`${LOG_PREFIX} ${position}/${executableRows.length} ${row.action.toUpperCase()} ${row.payload.full_name}`);
    console.log("CSV row:", row.sourceRow);
    console.log("Matched by:", row.matchedBy ?? "new record");
    if (row.differences?.length) console.table(row.differences);
    if (row.warnings?.length) console.warn("Skipped CSV fields:", row.warnings);

    const effectivePayload = buildEffectivePayload(row);

    const result = row.action === "update"
      ? await updateBeneficiary(row.existingId, effectivePayload)
      : await addBeneficiary(row.payload);
    const outcome = {
      sourceRow: row.sourceRow,
      name: row.payload.full_name,
      action: row.action,
      success: Boolean(result.success),
      id: result.data?.id ?? row.existingId ?? null,
      error: result.error ?? null,
    };
    results.push(outcome);
    if (outcome.success) console.log("Success:", outcome);
    else console.error("Failed:", outcome);
    console.groupEnd();
    onProgress?.({ completed: position, total: executableRows.length, row, outcome });
  }

  invalidateBeneficiaryCache();
  console.groupEnd();
  const summary = results.reduce((accumulator, result) => {
    if (result.success) accumulator.success += 1;
    else accumulator.failed += 1;
    return accumulator;
  }, {
    attempted: results.length,
    success: 0,
    failed: 0,
    skipped: plan.summary.skip,
    excluded: plan.rows.filter(row =>
      (row.action === "insert" || row.action === "update") && !isExecutableRow(row)
    ).length,
    invalid: plan.summary.invalid,
    ambiguous: plan.summary.ambiguous,
  });
  logGroup("Apply result", [summary]);
  return { results, summary };
}
// --- END: IMPORT PLAN EXECUTOR ---
