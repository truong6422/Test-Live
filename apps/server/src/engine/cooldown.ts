/** Hồi chiêu theo hành động (toàn cục) và theo (người, hành động). */
export class CooldownTracker {
  private actionAt = new Map<string, number>();
  private userActionAt = new Map<string, number>();

  check(actionId: string, userKey: string | null, cooldownMs: number, userCooldownMs: number, now: number): boolean {
    const last = this.actionAt.get(actionId);
    if (last !== undefined && now - last < cooldownMs) return false;
    if (userKey) {
      const lastUser = this.userActionAt.get(`${userKey}::${actionId}`);
      if (lastUser !== undefined && now - lastUser < userCooldownMs) return false;
    }
    return true;
  }

  mark(actionId: string, userKey: string | null, now: number): void {
    this.actionAt.set(actionId, now);
    if (userKey) {
      const key = `${userKey}::${actionId}`;
      this.userActionAt.delete(key);
      this.userActionAt.set(key, now);
      if (this.userActionAt.size > 10_000) {
        this.userActionAt.delete(this.userActionAt.keys().next().value as string);
      }
    }
  }

  reset(): void {
    this.actionAt.clear();
    this.userActionAt.clear();
  }
}
