/** A broken or unsupported image must not leave an import waiting forever. */
export function imageSize(src: string, timeout = 5000): Promise<{ w: number; h: number }> {
    return new Promise(resolve => {
        const node = new Image();
        const finish = () => {
            clearTimeout(timer); node.onload = null; node.onerror = null;
            resolve({ w: node.naturalWidth || 300, h: node.naturalHeight || 220 });
        };
        const timer = setTimeout(finish, timeout);
        node.onload = finish; node.onerror = finish; node.src = src;
    });
}
