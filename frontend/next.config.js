/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy API requests to backend server (exclude NextAuth routes)
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:8000/api/v1/:path*',
      },
      {
        source: '/api/v2/:path*',
        destination: 'http://localhost:8000/api/v2/:path*',
      },
    ];
  },
  // Ensure static files in public/ are served with correct MIME types
  async headers() {
    return [
      {
        source: '/mediapipe/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          // MIME types will be handled by Next.js automatically based on file extension
        ],
      },
    ];
  },
};

module.exports = nextConfig;
