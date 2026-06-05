import type { NextConfig } from "next";
import { networkInterfaces } from "os";

function getAllowedDevOrigins() {
  const envOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const lanOrigins = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);

  return Array.from(new Set([...envOrigins, ...lanOrigins]));
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
