import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Server Actions default to a 1 MB body cap. We accept image uploads
  // (logo / cover / thumbnails) and PDFs in portfolios, so 1 MB is too low.
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // /dashboard/listings was renamed to /dashboard/services so the term
  // 'listing' can mean exactly one thing (the business profile on the
  // marketplace). Permanent redirects keep external links / bookmarks
  // pointing at the old route working.
  async redirects() {
    return [
      {
        source: '/dashboard/listings',
        destination: '/dashboard/services',
        permanent: true,
      },
      {
        source: '/dashboard/listings/:path*',
        destination: '/dashboard/services/:path*',
        permanent: true,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/**',
      },
      // Allow any external hostname for scraped business logos and cover
      // images from pre-populated CSV imports. These come from arbitrary
      // company websites so we can't enumerate every hostname in advance.
      {
        protocol: 'https',
        hostname: '**',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '**',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
