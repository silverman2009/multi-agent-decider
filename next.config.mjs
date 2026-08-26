/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // sqlite3 is a native CommonJS module — must not be bundled.
    serverComponentsExternalPackages: ["sqlite3"],
  },
  webpack: (config) => {
    // Never watch the SQLite data directory (prevents dev-server reload loops).
    const prevRaw = config.watchOptions ? config.watchOptions.ignored : undefined;
    const prev = Array.isArray(prevRaw) ? prevRaw : prevRaw ? [String(prevRaw)] : [];
    config.watchOptions = { ...(config.watchOptions || {}), ignored: [...prev, "**/data/**"] };
    return config;
  },
};

export default nextConfig;
