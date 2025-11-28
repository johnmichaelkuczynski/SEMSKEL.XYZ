import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { eq, sql, desc } from "drizzle-orm";

// Configure WebSocket for Neon serverless
neonConfig.webSocketConstructor = ws;
import {
  users,
  sentenceEntries,
  type User,
  type InsertUser,
  type SentenceEntry,
  type InsertSentenceEntry,
} from "@shared/schema";

// Create database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

// Storage interface
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Sentence entry operations
  getAllSentenceEntries(): Promise<SentenceEntry[]>;
  getSentenceEntriesByUser(userId: number): Promise<SentenceEntry[]>;
  getSentenceEntryCount(): Promise<number>;
  getUserSentenceCount(userId: number): Promise<number>;
  addSentenceEntry(entry: InsertSentenceEntry): Promise<SentenceEntry>;
  addSentenceEntries(entries: InsertSentenceEntry[]): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Sentence entry operations
  async getAllSentenceEntries(): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries).orderBy(desc(sentenceEntries.id));
  }

  async getSentenceEntriesByUser(userId: number): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries)
      .where(eq(sentenceEntries.userId, userId))
      .orderBy(desc(sentenceEntries.id));
  }

  async getSentenceEntryCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(sentenceEntries);
    return result[0]?.count || 0;
  }

  async getUserSentenceCount(userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(sentenceEntries)
      .where(eq(sentenceEntries.userId, userId));
    return result[0]?.count || 0;
  }

  async addSentenceEntry(entry: InsertSentenceEntry): Promise<SentenceEntry> {
    const result = await db.insert(sentenceEntries).values(entry).returning();
    return result[0];
  }

  async addSentenceEntries(entries: InsertSentenceEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    
    // Insert in batches of 100 to avoid overwhelming the database
    const BATCH_SIZE = 100;
    let inserted = 0;
    
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await db.insert(sentenceEntries).values(batch);
      inserted += batch.length;
    }
    
    return inserted;
  }
}

export const storage = new DatabaseStorage();
