import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const stories = pgTable("stories", {
  id: serial("id").primaryKey(),
  persona: text("persona").notNull(),
  content: text("content"),
  imageUrl: text("image_url"),
  storyType: text("story_type").notNull().default("text"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Story = typeof stories.$inferSelect;
