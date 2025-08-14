import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UserSession {
  actualUserId: string;
  sessionId: string;
  jobIds: string[];
  createdAt: Date;
  lastActivity: Date;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    clientId?: string;
  };
}

export interface JobMapping {
  jobId: string;
  actualUserId: string;
  sessionId: string;
  createdAt: Date;
  filename?: string;
  country?: string;
  icp?: string;
}

@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);
  private readonly storageDir = path.join(process.cwd(), 'user-sessions');
  private readonly sessionsFile = path.join(this.storageDir, 'user-sessions.json');
  private readonly jobMappingsFile = path.join(this.storageDir, 'job-mappings.json');

  // In-memory cache for performance
  private userSessions: Map<string, UserSession> = new Map();
  private jobMappings: Map<string, JobMapping> = new Map();

  constructor() {
    this.initializeStorage();
    this.loadFromStorage();
  }

  /**
   * Create or get existing session for a user
   */
  async createOrGetUserSession(
    actualUserId: string,
    metadata?: UserSession['metadata']
  ): Promise<UserSession> {
    let session = this.userSessions.get(actualUserId);

    if (!session) {
      // Create new session
      session = {
        actualUserId,
        sessionId: this.generateSessionId(actualUserId),
        jobIds: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata,
      };

      this.userSessions.set(actualUserId, session);
      this.logger.log(`Created new user session: ${actualUserId} -> ${session.sessionId}`);
    } else {
      // Update last activity
      session.lastActivity = new Date();
      if (metadata) {
        session.metadata = { ...session.metadata, ...metadata };
      }
    }

    await this.saveToStorage();
    return session;
  }

  /**
   * Generate a new Job ID and associate it with a User ID
   * Job ID is now based on filename for better tracking
   */
  async createJobForUser(
    actualUserId: string,
    filename?: string,
    country?: string,
    icp?: string,
    metadata?: UserSession['metadata']
  ): Promise<{ jobId: string; sessionId: string }> {
    // Get or create user session
    const session = await this.createOrGetUserSession(actualUserId, metadata);

    // Generate filename-based job ID with duplicate handling
    const jobId = this.generateFilenameBasedJobId(actualUserId, filename);

    // Create job mapping
    const jobMapping: JobMapping = {
      jobId,
      actualUserId,
      sessionId: session.sessionId,
      createdAt: new Date(),
      filename,
      country,
      icp,
    };

    // Add job to session
    session.jobIds.push(jobId);
    session.lastActivity = new Date();

    // Store mappings
    this.jobMappings.set(jobId, jobMapping);
    this.userSessions.set(actualUserId, session);

    await this.saveToStorage();

    this.logger.log(
      `Created filename-based job ${jobId} for user ${actualUserId} in session ${session.sessionId}`
    );

    return {
      jobId,
      sessionId: session.sessionId,
    };
  }

  /**
   * Get user session by actual user ID
   */
  getUserSession(actualUserId: string): UserSession | null {
    return this.userSessions.get(actualUserId) || null;
  }

  /**
   * Get job mapping by job ID
   */
  getJobMapping(jobId: string): JobMapping | null {
    return this.jobMappings.get(jobId) || null;
  }

  /**
   * Get all jobs for a user
   */
  getUserJobs(actualUserId: string): JobMapping[] {
    const session = this.getUserSession(actualUserId);
    if (!session) return [];

    return session.jobIds
      .map(jobId => this.jobMappings.get(jobId))
      .filter(Boolean) as JobMapping[];
  }

  /**
   * Get user ID from job ID (reverse lookup)
   */
  getUserIdFromJobId(jobId: string): string | null {
    const mapping = this.jobMappings.get(jobId);
    return mapping?.actualUserId || null;
  }

  /**
   * Get session ID from job ID
   */
  getSessionIdFromJobId(jobId: string): string | null {
    const mapping = this.jobMappings.get(jobId);
    return mapping?.sessionId || null;
  }

  /**
   * List all users with their session info
   */
  getAllUsers(): UserSession[] {
    return Array.from(this.userSessions.values());
  }

  /**
   * Get user statistics
   */
  getUserStats(actualUserId: string): {
    totalJobs: number;
    firstJobDate: Date | null;
    lastJobDate: Date | null;
    sessionId: string | null;
  } {
    const jobs = this.getUserJobs(actualUserId);
    const session = this.getUserSession(actualUserId);

    return {
      totalJobs: jobs.length,
      firstJobDate: jobs.length > 0 ? jobs[0].createdAt : null,
      lastJobDate: jobs.length > 0 ? jobs[jobs.length - 1].createdAt : null,
      sessionId: session?.sessionId || null,
    };
  }

  /**
   * Clean up old sessions (optional maintenance)
   */
  async cleanupOldSessions(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let cleanedCount = 0;

    for (const [userId, session] of this.userSessions.entries()) {
      if (session.lastActivity < cutoffDate) {
        // Remove all job mappings for this session
        for (const jobId of session.jobIds) {
          this.jobMappings.delete(jobId);
        }

        // Remove session
        this.userSessions.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await this.saveToStorage();
      this.logger.log(`Cleaned up ${cleanedCount} old sessions`);
    }

    return cleanedCount;
  }

  /**
   * Generate filename-based job ID with duplicate handling
   * NEW FORMAT: filename.extension_user_id (filename with extension first, then user)
   */
  private generateFilenameBasedJobId(actualUserId: string, filename?: string): string {
    if (!filename) {
      // Fallback to timestamp-based ID if no filename provided
      const timestamp = Date.now();
      const randomSuffix = randomUUID().substring(0, 8);
      return `unknown_file_${actualUserId}_${timestamp}_${randomSuffix}`;
    }

    // Clean filename for use in job ID (keep extension)
    const cleanFilename = this.cleanFilenameForJobId(filename);
    
    // Check for existing jobs with same filename for this user
    const existingJobs = this.getUserJobs(actualUserId);
    const sameFilenameJobs = existingJobs.filter(job => {
      if (!job.filename) return false;
      const cleanExistingFilename = this.cleanFilenameForJobId(job.filename);
      return cleanExistingFilename === cleanFilename;
    });

    // Generate job ID with sequence number if duplicates exist
    // NEW FORMAT: filename.extension_user_id
    let jobId: string;
    if (sameFilenameJobs.length === 0) {
      // First time uploading this filename
      jobId = `${cleanFilename}_${actualUserId}`;
    } else {
      // Duplicate filename - add sequence number before user ID
      const sequenceNumber = sameFilenameJobs.length + 1;
      jobId = `${cleanFilename}_${sequenceNumber}_${actualUserId}`;
    }

    // Ensure uniqueness (in case of race conditions)
    let finalJobId = jobId;
    let counter = 1;
    while (this.jobMappings.has(finalJobId)) {
      finalJobId = `${cleanFilename}_${counter}_${actualUserId}`;
      counter++;
    }

    return finalJobId;
  }

  /**
   * Clean filename to make it suitable for job ID (keep extension)
   */
  private cleanFilenameForJobId(filename: string): string {
    // Keep the full filename with extension, just clean special characters
    // Replace spaces and special characters with underscores
    // Keep only alphanumeric characters, underscores, hyphens, and dots (for extension)
    const cleaned = filename
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '_')
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
    
    // Limit length to prevent overly long job IDs
    const maxLength = 80; // Increased to accommodate full filename with extension
    return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }

  /**
   * Generate unique job ID (legacy method for backward compatibility)
   */
  private generateJobId(actualUserId: string): string {
    const timestamp = Date.now();
    const randomSuffix = randomUUID().substring(0, 8);
    return `job_${actualUserId}_${timestamp}_${randomSuffix}`;
  }

  /**
   * Generate session ID
   */
  private generateSessionId(actualUserId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const randomSuffix = randomUUID().substring(0, 8);
    return `session_${actualUserId}_${timestamp}_${randomSuffix}`;
  }

  /**
   * Initialize storage directory and files
   */
  private initializeStorage(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      // Initialize files if they don't exist
      if (!fs.existsSync(this.sessionsFile)) {
        fs.writeFileSync(this.sessionsFile, '{}', 'utf8');
      }

      if (!fs.existsSync(this.jobMappingsFile)) {
        fs.writeFileSync(this.jobMappingsFile, '{}', 'utf8');
      }
    } catch (error) {
      this.logger.error('Failed to initialize storage:', error);
    }
  }

  /**
   * Load data from storage
   */
  private loadFromStorage(): void {
    try {
      // Load user sessions
      if (fs.existsSync(this.sessionsFile)) {
        const sessionsData = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
        for (const [userId, sessionData] of Object.entries(sessionsData)) {
          const session = sessionData as any;
          session.createdAt = new Date(session.createdAt);
          session.lastActivity = new Date(session.lastActivity);
          this.userSessions.set(userId, session as UserSession);
        }
      }

      // Load job mappings
      if (fs.existsSync(this.jobMappingsFile)) {
        const mappingsData = JSON.parse(fs.readFileSync(this.jobMappingsFile, 'utf8'));
        for (const [jobId, mappingData] of Object.entries(mappingsData)) {
          const mapping = mappingData as any;
          mapping.createdAt = new Date(mapping.createdAt);
          this.jobMappings.set(jobId, mapping as JobMapping);
        }
      }

      this.logger.log(
        `Loaded ${this.userSessions.size} user sessions and ${this.jobMappings.size} job mappings`
      );
    } catch (error) {
      this.logger.error('Failed to load from storage:', error);
    }
  }

  /**
   * Save data to storage
   */
  private async saveToStorage(): Promise<void> {
    try {
      // Convert Maps to objects for JSON serialization
      const sessionsObj = Object.fromEntries(this.userSessions.entries());
      const mappingsObj = Object.fromEntries(this.jobMappings.entries());

      // Save to files
      fs.writeFileSync(this.sessionsFile, JSON.stringify(sessionsObj, null, 2), 'utf8');
      fs.writeFileSync(this.jobMappingsFile, JSON.stringify(mappingsObj, null, 2), 'utf8');
    } catch (error) {
      this.logger.error('Failed to save to storage:', error);
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    status: string;
    totalUsers: number;
    totalJobs: number;
    storageInitialized: boolean;
  } {
    return {
      status: 'healthy',
      totalUsers: this.userSessions.size,
      totalJobs: this.jobMappings.size,
      storageInitialized: fs.existsSync(this.storageDir),
    };
  }
}