import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const memberAccessChallengesTable = pgTable("member_access_challenges", {
  phoneHash: text("phone_hash").primaryKey(),
  sessionHash: text("session_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at").notNull(),
  requestWindowStartedAt: timestamp("request_window_started_at").notNull(),
  resendCount: integer("resend_count").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MemberAccessChallenge = typeof memberAccessChallengesTable.$inferSelect;