import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ['@prisma/client', 'prisma'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '/u/**', // 允许该路径下的所有图片
      },
    ],
  },
  compiler: {
    // 运行记录写入故障必须保留在生产日志中，不能被构建器静默移除。
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false
  },
  experimental: {
    // Base64 图片及多轮历史需要超过默认 10MB 的代理缓冲，与聊天接口上限保持一致。
    proxyClientMaxBodySize: '32mb',
    optimizePackageImports: ['package-name']
  }
};

export default nextConfig;
