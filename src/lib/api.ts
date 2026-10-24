/**
 * Backend client boundary (T9).
 *
 * There is no backend in this batch. The honest local client returns BLOCKED
 * with the real reason instead of faking success — no invented readiness
 * percentages, no fake devices.
 */
export type JobStage =
  | 'QUEUED'
  | 'PROCESSING'
  | 'READY'
  | 'PARTIAL'
  | 'FAILED'
  | 'BLOCKED';

export interface UploadResult {
  readonly ok: boolean;
  readonly reason: string;
}

export interface ProcessingStatus {
  readonly jobId: string;
  readonly stage: JobStage;
  readonly reason: string | null;
  readonly coveragePercent: number | null;
}

export interface NammaApiClient {
  uploadImage(file: Blob, filename: string): Promise<UploadResult>;
  getProcessingStatus(jobId: string): Promise<ProcessingStatus>;
  getScene(spaceId: string): Promise<unknown>;
}

const NO_BACKEND_REASON =
  'No processing backend is connected to this build. Images stay in this tab until T14+ wires the pipeline.';

export function createLocalApiClient(): NammaApiClient {
  return {
    async uploadImage() {
      return { ok: false, reason: NO_BACKEND_REASON };
    },
    async getProcessingStatus(jobId) {
      return { jobId, stage: 'BLOCKED', reason: NO_BACKEND_REASON, coveragePercent: null };
    },
    async getScene() {
      throw new Error(NO_BACKEND_REASON);
    },
  };
}
