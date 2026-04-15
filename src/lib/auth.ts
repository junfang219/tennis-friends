import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.profileImageUrl || null,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        const fresh = await prisma.user.findUnique({
          where: { id: user.id as string },
          select: { onboardingComplete: true },
        });
        token.onboardingComplete = fresh?.onboardingComplete ?? false;
      }
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { name: true, profileImageUrl: true, onboardingComplete: true },
        });
        if (fresh) {
          token.name = fresh.name;
          token.picture = fresh.profileImageUrl || null;
          token.onboardingComplete = fresh.onboardingComplete;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; onboardingComplete?: boolean }).id = token.id as string;
        (session.user as { id?: string; onboardingComplete?: boolean }).onboardingComplete = Boolean(token.onboardingComplete);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
