import type { SaveKeyOptions } from "~/services/storage/keys";

export type HealthCheckResult = {
  status: "ok" | "error";
  message?: string;
};

export interface MediaStorageDriver {
  readonly mode: "local" | "oss";

  saveBuffer(buffer: Buffer, options: SaveKeyOptions): Promise<string>;

  // Used for ffmpeg output files already sitting on local disk (temp dirs) —
  // avoids buffering large video files into memory just to hand them back
  // to the driver.
  saveFromPath(localPath: string, options: SaveKeyOptions): Promise<string>;

  readBuffer(ref: string): Promise<Buffer>;

  readAsDataUrl(ref: string): Promise<string>;

  delete(ref: string): Promise<void>;

  // Browser-usable URL, resolved fresh at read time — never persisted.
  resolveUrl(ref: string): Promise<string>;

  healthCheck(): Promise<HealthCheckResult>;
}
