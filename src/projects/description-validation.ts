/** These delimiters belong to generated notes and cannot be part of an editable description. */
export function validateTaskDescription(description: string): string {
    if (/<!--\s*\/?project-(?:section|root-header|redirect|description)(?=[:\s-])/.test(description)) {
        throw new Error('Description contains reserved project note markers. Remove them before saving.');
    }
    return description.trim();
}
