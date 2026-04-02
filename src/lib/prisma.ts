import { PrismaClient } from '@prisma/client'
import 'server-only'

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// 如果全局已有 prisma 实例则复用，否则新建
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'], // 可选：在控制台打印生成的 SQL 语句，方便调试
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;