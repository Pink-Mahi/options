/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
      allowedOrigins: ["localhost:3001", "127.0.0.1:3001", "localhost:3000", "127.0.0.1:3000"],
    },
  },
};

module.exports = nextConfig;
