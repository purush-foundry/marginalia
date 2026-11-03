export function newId(): string {
  return crypto.randomUUID()
}

export function now(): number {
  return Date.now()
}
