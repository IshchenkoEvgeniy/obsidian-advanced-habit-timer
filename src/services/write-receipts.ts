const RECEIPTS_KEY = 'HabitTimer-Receipts';

export function readWriteReceipt(frontmatter: Record<string, unknown>, id: string): Record<string, unknown> | null {
    const receipts = frontmatter[RECEIPTS_KEY];
    if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) return null;
    const receipt = (receipts as Record<string, unknown>)[id];
    return receipt && typeof receipt === 'object' && !Array.isArray(receipt)
        ? receipt as Record<string, unknown> : null;
}

/** Store the receipt in the same atomic frontmatter update as the increment. */
export function writeReceipt(frontmatter: Record<string, unknown>, id: string, receipt: Record<string, unknown> = {}): void {
    const previous = frontmatter[RECEIPTS_KEY];
    frontmatter[RECEIPTS_KEY] = {
        ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
        [id]: receipt
    };
}
