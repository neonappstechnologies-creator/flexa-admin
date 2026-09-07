/** @type {import('next').NextConfig} */
const nextConfig = {
  // Every page here reads a session cookie and the live API, so nothing is
  // prerenderable and nothing should be cached at the edge. Stated rather than
  // relied upon: a cached operator panel would show a clinic as running after
  // somebody switched it off, which is the one thing it must never do.
  reactStrictMode: true,
};

export default nextConfig;
