import type { ObserverInput } from "./contracts.ts";

export type ObserverFormFields = {
  latitude: string;
  longitude: string;
  elevation: string;
  utc: string;
};

/** Decimal input only: either decimal separator is accepted, never grouping,
 * exponents, hexadecimal or JavaScript's empty-string-to-zero coercion.
 */
export function parseDecimalInput(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(normalized)) return undefined;
  const result = Number(normalized.replace(",", "."));
  return Number.isFinite(result) ? result : undefined;
}

/** datetime-local fields represent UTC here, not the browser's timezone.
 * Comparing the canonical date also rejects impossible dates normalized by JS.
 */
export function parseObserverUtc(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z?$/.exec(value.trim());
  if (!match) return undefined;
  const canonical = `${match[1]}T${match[2]}:${match[3] ?? "00"}.${(match[4] ?? "").padEnd(3, "0")}Z`;
  const date = new Date(canonical);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== canonical) return undefined;
  return canonical;
}

export function parseObserverFields(fields: ObserverFormFields): { input?: ObserverInput; message?: string } {
  const latitudeDeg = parseDecimalInput(fields.latitude);
  const longitudeDeg = parseDecimalInput(fields.longitude);
  const elevationM = parseDecimalInput(fields.elevation);
  if (latitudeDeg === undefined || latitudeDeg < -90 || latitudeDeg > 90) return { message: "Informe a latitude entre −90 e 90 graus." };
  if (longitudeDeg === undefined || longitudeDeg < -180 || longitudeDeg > 180) return { message: "Informe a longitude entre −180 e 180 graus." };
  if (elevationM === undefined || elevationM < -500 || elevationM > 10_000) return { message: "Informe a elevação entre −500 e 10.000 m." };
  const utc = parseObserverUtc(fields.utc);
  if (!utc) return { message: "Informe uma data e hora UTC válidas." };
  return { input: { latitude_deg: latitudeDeg, longitude_deg: longitudeDeg, elevation_m: elevationM, utc } };
}

/** Shared links restore time only. Observer coordinates remain session-local. */
export function observerFieldsAtUtc(fields: ObserverFormFields, utc: string): ObserverFormFields {
  const canonical = parseObserverUtc(utc);
  return canonical ? { ...fields, utc: canonical.slice(0, -1) } : fields;
}
