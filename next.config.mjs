/** @type {import('next').NextConfig} */
const nextConfig = {
  // Every page here reads a session cookie and the live API, so nothing is
  // prerenderable and nothing should be cached at the edge. Stated rather than
  // relied upon: a cached operator panel would show a clinic as running after
  // somebody switched it off, which is the one thing it must never do.
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // → D258 · a clinic's paper form is uploaded through a server action,
      // and a server action refuses a body over 1 MB by default. 4 MB is the
      // most worth allowing: Vercel refuses any function request over 4.5 MB
      // before Next sees it, so a larger number here would only move where
      // the refusal happens. The API takes up to 20 MB; a paper heavier than
      // this is re-encoded first (README), which also keeps every PDF the
      // desk downloads small — the paper is inside each one.
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
