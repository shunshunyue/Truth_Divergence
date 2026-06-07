import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Client } from "minio";

type VisualStorageDriver = "local" | "minio";

type SaveVisualObjectOptions = {
  body: Buffer | string;
  contentType: string;
  relativePath: string;
};

type VisualObject = {
  url: string;
};

type MinioConfig = {
  bucket: string;
  client: Client;
  publicBaseUrl: string;
};

function normalizeSlashPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function envFlag(name: string, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getVisualsDir() {
  return process.env.CASE_VISUALS_DIR ?? "public/generated/cases";
}

export function getVisualStorageDriver(): VisualStorageDriver {
  const driver = (process.env.VISUAL_STORAGE_DRIVER ?? "local").toLowerCase();
  return driver === "minio" ? "minio" : "local";
}

function getLocalPublicBasePath() {
  const dir = getVisualsDir().replace(/\\/g, "/").replace(/^public\/?/, "");
  return `/${dir.replace(/^\/+|\/+$/g, "")}`;
}

function objectUrlFromPublicBase(publicBaseUrl: string, objectName: string) {
  return `${publicBaseUrl.replace(/\/+$/g, "")}/${objectName}`;
}

function parseMinioPort(value: string | undefined, useSSL: boolean) {
  if (!value) return useSSL ? 443 : 80;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : useSSL ? 443 : 80;
}

function getMinioConfig(): MinioConfig {
  const endPoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  const bucket = process.env.MINIO_BUCKET;

  if (!endPoint || !accessKey || !secretKey || !bucket) {
    throw new Error("MinIO storage requires MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET.");
  }

  const useSSL = envFlag("MINIO_USE_SSL", false);
  const publicBaseUrl =
    process.env.MINIO_PUBLIC_URL ?? `${useSSL ? "https" : "http"}://${endPoint}:${parseMinioPort(process.env.MINIO_PORT, useSSL)}/${bucket}`;

  return {
    bucket,
    client: new Client({
      endPoint,
      port: parseMinioPort(process.env.MINIO_PORT, useSSL),
      useSSL,
      accessKey,
      secretKey,
      ...(process.env.MINIO_REGION ? { region: process.env.MINIO_REGION } : {}),
    }),
    publicBaseUrl,
  };
}

let ensureMinioBucketPromise: Promise<void> | undefined;

async function ensureMinioBucket(config: MinioConfig) {
  if (envFlag("MINIO_SKIP_BUCKET_CHECK", false)) return;

  ensureMinioBucketPromise ??= (async () => {
    const exists = await config.client.bucketExists(config.bucket);
    if (exists) return;

    if (!envFlag("MINIO_CREATE_BUCKET", false)) {
      throw new Error(`MinIO bucket "${config.bucket}" does not exist. Create it or set MINIO_CREATE_BUCKET=true.`);
    }

    await config.client.makeBucket(config.bucket, process.env.MINIO_REGION ?? "");
  })();

  await ensureMinioBucketPromise;
}

async function saveLocalVisualObject(options: SaveVisualObjectOptions): Promise<VisualObject> {
  const relativePath = normalizeSlashPath(options.relativePath);
  const filePath = path.join(process.cwd(), getVisualsDir(), ...relativePath.split("/"));

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, options.body);

  return {
    url: `${getLocalPublicBasePath()}/${relativePath}`,
  };
}

async function saveMinioVisualObject(options: SaveVisualObjectOptions): Promise<VisualObject> {
  const config = getMinioConfig();
  const relativePath = normalizeSlashPath(options.relativePath);
  const prefix = normalizeSlashPath(process.env.MINIO_PREFIX ?? "generated/cases");
  const objectName = prefix ? `${prefix}/${relativePath}` : relativePath;
  const body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, "utf8");

  await ensureMinioBucket(config);
  await config.client.putObject(config.bucket, objectName, body, body.length, {
    "Content-Type": options.contentType,
  });

  return {
    url: objectUrlFromPublicBase(config.publicBaseUrl, objectName),
  };
}

export async function saveVisualObject(options: SaveVisualObjectOptions): Promise<VisualObject> {
  if (getVisualStorageDriver() === "minio") {
    return saveMinioVisualObject(options);
  }

  return saveLocalVisualObject(options);
}
