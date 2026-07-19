import { createLocalStorageDriver } from "~/services/storage/local-storage.server";
import { createOssStorageDriver } from "~/services/storage/oss-storage.server";
import type { MediaStorageDriver } from "~/services/storage/types";

let driver: MediaStorageDriver | null = null;

export function getMediaStorage(): MediaStorageDriver {
  driver ??= createDriver();
  return driver;
}

function createDriver(): MediaStorageDriver {
  const mode = process.env.MEDIA_STORAGE_DRIVER === "oss" ? "oss" : "local";

  return mode === "oss" ? createOssStorageDriver() : createLocalStorageDriver();
}
