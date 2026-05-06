import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { normalizeE164 } from "./phone";

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const appleConfigured = Boolean(process.env.APPLE_ID && process.env.APPLE_SECRET);
const twilioConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
);

async function verifyOtp(phoneE164: string, code: string): Promise<boolean> {
  if (!twilioConfigured) {
    // Dev fallback: accept the fixed code "000000" so the flow is testable without Twilio creds.
    return code === "000000";
  }
  const twilio = (await import("twilio")).default;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const check = await client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
    .verificationChecks.create({ to: phoneE164, code });
  return check.status === "approved";
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    ...(googleConfigured
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(appleConfigured
      ? [
          AppleProvider({
            clientId: process.env.APPLE_ID!,
            clientSecret: process.env.APPLE_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    CredentialsProvider({
      id: "credentials",
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

        if (!user || !user.passwordHash) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.profileImageUrl || null,
        };
      },
    }),
    CredentialsProvider({
      id: "phone-otp",
      name: "Phone",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.phone || !credentials?.code) return null;
        const e164 = normalizeE164(credentials.phone);
        if (!e164) return null;

        const approved = await verifyOtp(e164, credentials.code);
        if (!approved) return null;

        const user = await prisma.user.upsert({
          where: { phone: e164 },
          update: { phoneVerified: new Date() },
          create: {
            phone: e164,
            phoneVerified: new Date(),
            name: `Player ${e164.slice(-4)}`,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.profileImageUrl || null,
        };
      },
    }),
  ],
  events: {
    createUser: async ({ user }) => {
      // Only fires for OAuth-created users via the adapter.
      await prisma.user.update({
        where: { id: user.id },
        data: { onboardingComplete: false },
      });
    },
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
