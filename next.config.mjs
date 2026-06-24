/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['whatsapp-web.js', 'puppeteer'],
  },
};

export default nextConfig;
