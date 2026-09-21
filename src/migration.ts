import { App, Notice } from 'obsidian';
import HabitTimerPlugin from './main';

function legacyString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

export async function migrateLegacySettings(plugin: HabitTimerPlugin, loadedData: any) {
    if (!loadedData || typeof loadedData !== 'object') return;
    const ld = loadedData as Record<string, unknown>;
    
    // Migrate legacy book settings to the new 'book' collection
    if (ld['booksFolder'] !== undefined || ld['bookReadingStatusName'] !== undefined) {
        const bookCol = plugin.settings.mediaCollections.find(c => c.id === 'book');
        if (bookCol) {
            const booksFolder = legacyString(ld['booksFolder']);
            const bookTemplatePath = legacyString(ld['bookTemplatePath']);
            const bookReadingStatusName = legacyString(ld['bookReadingStatusName']);
            const bookFinishedStatusName = legacyString(ld['bookFinishedStatusName']);

            if (booksFolder !== undefined) bookCol.folder = booksFolder;
            if (bookTemplatePath !== undefined) bookCol.templatePath = bookTemplatePath;
            if (bookReadingStatusName !== undefined) bookCol.readingStatusName = bookReadingStatusName;
            if (bookFinishedStatusName !== undefined) bookCol.finishedStatusName = bookFinishedStatusName;
            
            // Clean up old keys so we don't migrate again
            delete plugin.settings['booksFolder' as keyof typeof plugin.settings];
            delete plugin.settings['bookTemplatePath' as keyof typeof plugin.settings];
            delete plugin.settings['bookReadingStatusName' as keyof typeof plugin.settings];
            delete plugin.settings['bookFinishedStatusName' as keyof typeof plugin.settings];
            delete plugin.settings['bookTargetName' as keyof typeof plugin.settings];
            
            await plugin.saveSettings();
            
            // Ask user to run file migration
            new Notice("Habit Timer: Detected legacy book settings. Please run the 'Migrate media frontmatter' command to update your book notes.", 10000);
        }
    }
}

export async function migrateMediaFrontmatter(app: App, plugin: HabitTimerPlugin) {
    const files = app.vault.getMarkdownFiles();
    let migratedCount = 0;
    
    new Notice("Starting frontmatter migration...");
    
    for (const file of files) {
        let content = await app.vault.read(file);
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        
        if (match) {
            let fmContent = match[1] || '';
            let changed = false;
            
            // Migrate NameBook -> Title
            if (/^NameBook:/m.test(fmContent)) {
                fmContent = fmContent.replace(/^NameBook:/m, 'Title:');
                changed = true;
            }
            
            // Migrate Read Pages -> Progress
            if (/^Read Pages:/m.test(fmContent)) {
                fmContent = fmContent.replace(/^Read Pages:/m, 'Progress:');
                changed = true;
            } else if (/^Listened:/m.test(fmContent)) { // Legacy audiobook
                fmContent = fmContent.replace(/^Listened:/m, 'Progress:');
                changed = true;
            }
            
            // Migrate Pages -> Total
            if (/^Pages:/m.test(fmContent)) {
                fmContent = fmContent.replace(/^Pages:/m, 'Total:');
                changed = true;
            } else if (/^Duration:/m.test(fmContent)) { // Legacy audiobook
                fmContent = fmContent.replace(/^Duration:/m, 'Total:');
                changed = true;
            }
            
            if (changed && fmContent !== undefined) {
                const newContent = `---\n${fmContent}\n---` + content.slice(match[0].length);
                await app.vault.modify(file, newContent);
                migratedCount++;
            }
        }
    }
    
    new Notice(`Migration complete. Updated ${migratedCount} files.`);
}
