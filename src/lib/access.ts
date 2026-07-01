import type {
  Access,
  ApiStatusValue,
  GpuStatusValue,
  ResultValue,
} from "@/lib/constants";

export interface AccessInputs {
  access: Access;
  apiStatus: ApiStatusValue;
  gpuStatus: GpuStatusValue;
}

export interface AccessDecision {
  result: ResultValue;
  usable: boolean; // can a request actually succeed right now
  showUrl: boolean; // whether to expose the endpoint URL to the user
  showSample: boolean; // whether to expose sample code
}

// Implements the access result logic from the specification.
// Evaluation order: 1) access  2) API status  3) GPU status.
export function decideAccess(input: AccessInputs): AccessDecision {
  const { access, apiStatus, gpuStatus } = input;

  // The URL/sample are tied purely to whether the user is allowed the category.
  // Even if the API is currently stopped, an allowed user still sees the URL.
  const allowed = access === "Enabled";

  const decision = (result: ResultValue, usable: boolean): AccessDecision => ({
    result,
    usable,
    showUrl: allowed,
    showSample: allowed,
  });

  // 1) Access
  if (access === "Disabled") {
    return { result: "Not allowed", usable: false, showUrl: false, showSample: false };
  }

  // 2) API status
  if (apiStatus === "Not Installed") return decision("Not available", false);
  if (apiStatus === "Offline" || apiStatus === "Error" || apiStatus === "Disabled") {
    return decision("Temporarily unavailable", false);
  }

  // 3) GPU status (API is Online at this point)
  if (gpuStatus === "Offline") return decision("GPU unavailable", false);
  if (gpuStatus === "Full") return decision("Very busy, try later", false);
  if (gpuStatus === "Busy") return decision("Available, but may be slow", true);

  return decision("Available", true);
}
