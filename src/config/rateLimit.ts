import moment from 'moment';

// Rate limit configuration
export const RATE_LIMITS = {
    LIKES: {
        PER_HOUR: 350,
        COOLDOWN_MS: 3600000, // 1 hour in milliseconds
    },
    COMMENTS: {
        PER_HOUR: 60,
        COOLDOWN_MS: 3600000,
    },
    FOLLOWS: {
        NEW_ACCOUNT: {
            PER_DAY: 150,
            PER_HOUR: 15,
        },
        ESTABLISHED_ACCOUNT: {
            PER_DAY: 400,
            PER_HOUR: 30,
        },
        COOLDOWN_MS: 3600000,
    },
};

// Rate limit tracking
interface ActionCount {
    count: number;
    lastReset: Date;
}

class RateLimitTracker {
    private likes: ActionCount = { count: 0, lastReset: new Date() };
    private comments: ActionCount = { count: 0, lastReset: new Date() };
    private follows: ActionCount = { count: 0, lastReset: new Date() };
    private dailyFollows: ActionCount = { count: 0, lastReset: new Date() };
    private isNewAccount: boolean;

    constructor(accountCreationDate: Date) {
        // Consider account as new if it's less than 3 months old
        this.isNewAccount = moment().diff(accountCreationDate, 'months') < 3;
    }

    private resetCounterIfNeeded(action: ActionCount, cooldownMs: number): void {
        const now = new Date();
        if (now.getTime() - action.lastReset.getTime() >= cooldownMs) {
            action.count = 0;
            action.lastReset = now;
        }
    }

    canLike(): boolean {
        this.resetCounterIfNeeded(this.likes, RATE_LIMITS.LIKES.COOLDOWN_MS);
        return this.likes.count < RATE_LIMITS.LIKES.PER_HOUR;
    }

    canComment(): boolean {
        this.resetCounterIfNeeded(this.comments, RATE_LIMITS.COMMENTS.COOLDOWN_MS);
        return this.comments.count < RATE_LIMITS.COMMENTS.PER_HOUR;
    }

    canFollow(): boolean {
        // Reset hourly counter if needed
        this.resetCounterIfNeeded(this.follows, RATE_LIMITS.FOLLOWS.COOLDOWN_MS);
        // Reset daily counter if needed
        this.resetCounterIfNeeded(this.dailyFollows, 86400000); // 24 hours in milliseconds

        const hourlyLimit = this.isNewAccount 
            ? RATE_LIMITS.FOLLOWS.NEW_ACCOUNT.PER_HOUR 
            : RATE_LIMITS.FOLLOWS.ESTABLISHED_ACCOUNT.PER_HOUR;

        const dailyLimit = this.isNewAccount 
            ? RATE_LIMITS.FOLLOWS.NEW_ACCOUNT.PER_DAY 
            : RATE_LIMITS.FOLLOWS.ESTABLISHED_ACCOUNT.PER_DAY;

        return this.follows.count < hourlyLimit && this.dailyFollows.count < dailyLimit;
    }

    incrementLikes(): void {
        this.likes.count++;
    }

    incrementComments(): void {
        this.comments.count++;
    }

    incrementFollows(): void {
        this.follows.count++;
        this.dailyFollows.count++;
    }

    getRemainingLikes(): number {
        this.resetCounterIfNeeded(this.likes, RATE_LIMITS.LIKES.COOLDOWN_MS);
        return RATE_LIMITS.LIKES.PER_HOUR - this.likes.count;
    }

    getRemainingComments(): number {
        this.resetCounterIfNeeded(this.comments, RATE_LIMITS.COMMENTS.COOLDOWN_MS);
        return RATE_LIMITS.COMMENTS.PER_HOUR - this.comments.count;
    }

    getRemainingFollows(): { hourly: number; daily: number } {
        this.resetCounterIfNeeded(this.follows, RATE_LIMITS.FOLLOWS.COOLDOWN_MS);
        this.resetCounterIfNeeded(this.dailyFollows, 86400000);

        const hourlyLimit = this.isNewAccount 
            ? RATE_LIMITS.FOLLOWS.NEW_ACCOUNT.PER_HOUR 
            : RATE_LIMITS.FOLLOWS.ESTABLISHED_ACCOUNT.PER_HOUR;

        const dailyLimit = this.isNewAccount 
            ? RATE_LIMITS.FOLLOWS.NEW_ACCOUNT.PER_DAY 
            : RATE_LIMITS.FOLLOWS.ESTABLISHED_ACCOUNT.PER_DAY;

        return {
            hourly: hourlyLimit - this.follows.count,
            daily: dailyLimit - this.dailyFollows.count
        };
    }
}

export default RateLimitTracker; 