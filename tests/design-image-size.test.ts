import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageSize } from '../src/design/image-size';

class TestImage {
    static current: TestImage;
    naturalWidth = 0; naturalHeight = 0;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor() { TestImage.current = this; }
    set src(_value: string) {}
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('image loading bounds', () => {
    it('uses intrinsic dimensions and detaches handlers after loading', async () => {
        vi.stubGlobal('Image', TestImage); const result = imageSize('image');
        TestImage.current.naturalWidth = 1200; TestImage.current.naturalHeight = 800; TestImage.current.onload!();
        await expect(result).resolves.toEqual({ w: 1200, h: 800 }); expect(TestImage.current.onload).toBeNull(); expect(TestImage.current.onerror).toBeNull();
    });
    it('finishes when the image never sends load or error, without a lingering timer', async () => {
        vi.useFakeTimers(); vi.stubGlobal('Image', TestImage); const result = imageSize('unavailable', 100);
        await vi.advanceTimersByTimeAsync(101); await expect(result).resolves.toEqual({ w: 300, h: 220 });
        expect(vi.getTimerCount()).toBe(0); expect(TestImage.current.onload).toBeNull();
    });
});
