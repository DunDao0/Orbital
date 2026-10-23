import type { ScienceResource } from "@/lib/science/contracts";

export default function ScienceStatus<T>({ resource }: { resource: ScienceResource<T> }) {
  if (resource.status === "idle") return <p className="science-status">Aguardando uma solicitação.</p>;
  if (resource.status === "ready") return null;
  if (resource.status === "loading") return <p className="science-status" aria-live="polite">Calculando com o serviço científico…{resource.previous ? " O resultado anterior permanece identificado abaixo." : ""}</p>;
  if (resource.status === "empty") return <p className="science-status">{resource.message}</p>;
  if (resource.status === "unavailable") return <p className="science-status unavailable" role="status">{resource.message}{resource.previous ? " O resultado anterior foi preservado." : ""}</p>;
  if (resource.status === "out-of-range") return <p className="science-status" role="status">{resource.message}{resource.validFromUtc ? ` Cobertura: ${resource.validFromUtc}${resource.validUntilUtc ? ` a ${resource.validUntilUtc}` : ""}.` : ""}</p>;
  if (resource.status === "contract-error") return <p className="science-status error" role="alert">Contrato científico incompatível: {resource.message}</p>;
  return <p className="science-status error" role="alert">{resource.message}</p>;
}
