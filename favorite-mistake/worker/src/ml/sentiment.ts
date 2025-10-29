export async function getSentiment(query: string): Promise<number> {
  const normalized = query.toLowerCase();
  const pseudo = normalized.includes('bull') ? 1 : normalized.includes('bear') ? -1 : 0;
  const noise = Math.random() * 0.2 - 0.1;
  return pseudo + noise;
}
