import type { ScienceCapability } from "./contracts.ts";
import { ContractDecodeError, decodeScienceError } from "./decoders.ts";

export type ScienceErrorKind = "unavailable" | "out-of-range" | "validation" | "network" | "server" | "contract";

export class ScienceRequestError extends Error {
  readonly kind: ScienceErrorKind;
  readonly httpStatus?: number;
  readonly capability?: ScienceCapability;
  readonly requestId?: string;
  readonly validFromUtc?: string;
  readonly validUntilUtc?: string;
  readonly code?: string;

  constructor(
    kind: ScienceErrorKind,
    message: string,
    httpStatus?: number,
    capability?: ScienceCapability,
    requestId?: string,
    validFromUtc?: string,
    validUntilUtc?: string,
    code?: string,
  ) {
    super(message);
    this.name = "ScienceRequestError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.capability = capability;
    this.requestId = requestId;
    this.validFromUtc = validFromUtc;
    this.validUntilUtc = validUntilUtc;
    this.code = code;
  }
}

export function scienceErrorFromResponse(status: number, payload: unknown, fallbackMessage: string): ScienceRequestError {
  try {
    const envelope = decodeScienceError(payload);
    const error = envelope.error;
    if (status === 501 || error.code === "SCIENCE_SERVICE_UNAVAILABLE" || error.code === "IERS_DATA_UNAVAILABLE") return new ScienceRequestError("unavailable", error.message, status, error.capability, error.request_id, error.valid_utc_from, error.valid_utc_until, error.code);
    if (error.code === "REFERENCE_EPOCH_UNAVAILABLE" || error.code === "EPHEMERIS_OUT_OF_COVERAGE") return new ScienceRequestError("out-of-range", error.message, status, error.capability, error.request_id, error.valid_utc_from, error.valid_utc_until, error.code);
    if (status === 400 || status === 422 || error.code === "VALIDATION_ERROR") return new ScienceRequestError("validation", error.message, status, error.capability, error.request_id, error.valid_utc_from, error.valid_utc_until, error.code);
    return new ScienceRequestError("server", error.message, status, error.capability, error.request_id, error.valid_utc_from, error.valid_utc_until, error.code);
  } catch (error) {
    if (error instanceof ContractDecodeError) return new ScienceRequestError("contract", "O serviço respondeu com um contrato científico incompatível.", status);
    return new ScienceRequestError("contract", fallbackMessage, status);
  }
}
