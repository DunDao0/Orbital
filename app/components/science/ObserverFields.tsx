export type ObserverFieldValues = { lat: string; lon: string; alt: string; utc: string };

export default function ObserverFields({ value, onChange }: { value: ObserverFieldValues; onChange: (value: ObserverFieldValues) => void }) {
  return <fieldset className="fields"><legend className="sr-only">Posição e horário do observador</legend><label>Latitude<input inputMode="decimal" value={value.lat} onChange={(event) => onChange({ ...value, lat: event.target.value })} /></label><label>Longitude<input inputMode="decimal" value={value.lon} onChange={(event) => onChange({ ...value, lon: event.target.value })} /></label><label>Altitude (m)<input inputMode="decimal" value={value.alt} onChange={(event) => onChange({ ...value, alt: event.target.value })} /></label><label>UTC<input value={value.utc} onChange={(event) => onChange({ ...value, utc: event.target.value })} /></label></fieldset>;
}
