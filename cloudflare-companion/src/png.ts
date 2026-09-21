import type { CompanionSnapshot } from './stats';
import { formatValue } from './stats';
import type { WeeklyOverviewData } from './weekly';

type Color = [number, number, number];
const C = {
  bg: [23, 24, 33] as Color, surface: [35, 37, 48] as Color, border: [55, 58, 72] as Color,
  text: [244, 244, 246] as Color, muted: [165, 167, 178] as Color, accent: [155, 108, 255] as Color,
  green: [67, 200, 120] as Color, amber: [224, 173, 79] as Color, red: [210, 100, 100] as Color,
  empty: [72, 75, 88] as Color, neutral: [101, 112, 128] as Color
};

const FONT: Record<string, string[]> = {
  ' ': ['000','000','000','000','000','000','000'], '-':['000','000','000','111','000','000','000'], '.':['000','000','000','000','000','010','010'],
  ':':['000','010','010','000','010','010','000'], '/':['001','001','010','010','100','100','000'], '%':['101','001','010','010','100','101','000'],
  '0':['111','101','101','101','101','101','111'], '1':['010','110','010','010','010','010','111'], '2':['111','001','001','111','100','100','111'],
  '3':['111','001','001','111','001','001','111'], '4':['101','101','101','111','001','001','001'], '5':['111','100','100','111','001','001','111'],
  '6':['111','100','100','111','101','101','111'], '7':['111','001','001','010','010','100','100'], '8':['111','101','101','111','101','101','111'],
  '9':['111','101','101','111','001','001','111'],
  'A':['010','101','101','111','101','101','101'], 'B':['110','101','101','110','101','101','110'], 'C':['011','100','100','100','100','100','011'],
  'D':['110','101','101','101','101','101','110'], 'E':['111','100','100','110','100','100','111'], 'F':['111','100','100','110','100','100','100'],
  'G':['011','100','100','101','101','101','011'], 'H':['101','101','101','111','101','101','101'], 'I':['111','010','010','010','010','010','111'],
  'J':['001','001','001','001','101','101','010'], 'K':['101','101','110','100','110','101','101'], 'L':['100','100','100','100','100','100','111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'], 'N':['1001','1101','1101','1011','1011','1001','1001'], 'O':['010','101','101','101','101','101','010'],
  'P':['110','101','101','110','100','100','100'], 'Q':['010','101','101','101','101','011','001'], 'R':['110','101','101','110','101','101','101'],
  'S':['011','100','100','010','001','001','110'], 'T':['111','010','010','010','010','010','010'], 'U':['101','101','101','101','101','101','111'],
  'V':['101','101','101','101','101','101','010'], 'W':['10001','10001','10001','10101','10101','11011','10001'], 'X':['101','101','101','010','101','101','101'],
  'Y':['101','101','101','010','010','010','010'], 'Z':['111','001','001','010','100','100','111'], '?':['111','001','010','010','000','010','000']
};

class Raster {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, color: Color) {
    this.pixels = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, color);
  }
  rect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + height); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + width); px++) {
        const offset = (py * this.width + px) * 3;
        this.pixels[offset] = color[0]; this.pixels[offset + 1] = color[1]; this.pixels[offset + 2] = color[2];
      }
    }
  }
  text(value: string, x: number, y: number, scale = 2, color: Color = C.text, maxChars = 40): void {
    let cursor = x;
    for (const char of value.toUpperCase().slice(0, maxChars)) {
      const glyph = FONT[char] || FONT['?']!;
      glyph.forEach((row, rowIndex) => [...row].forEach((pixel, colIndex) => {
        if (pixel === '1') this.rect(cursor + colIndex * scale, y + rowIndex * scale, scale, scale, color);
      }));
      cursor += ((glyph[0]?.length || 3) + 1) * scale;
    }
  }
}

function stateColor(state: string): Color {
  if (state === 'completed') return C.green;
  if (state === 'partial') return C.amber;
  if (state === 'skipped') return C.red;
  if (state === 'excused' || state === 'deferred') return C.neutral;
  return C.empty;
}

export function renderHabitCard(snapshot: CompanionSnapshot): Uint8Array {
  const raster = new Raster(720, 440, C.bg);
  raster.rect(18, 18, 684, 404, C.border); raster.rect(20, 20, 680, 400, C.bg);
  raster.text('HABIT MAP', 42, 42, 3, C.muted);
  raster.text(snapshot.habit.name, 42, 82, 4, C.text, 24);
  metric(raster, 42, 145, 'STREAK', String(snapshot.currentStreak));
  metric(raster, 205, 145, 'BEST', String(snapshot.bestStreak));
  metric(raster, 368, 145, 'RATE', `${snapshot.completionRate}%`);
  metric(raster, 531, 145, 'AVERAGE', formatValue(snapshot.habit, snapshot.average));
  raster.text('LAST 12 WEEKS', 42, 245, 2, C.muted);
  const days = snapshot.days.slice(-84);
  const firstDay = days[0] ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  days.forEach((day, index) => {
    const aligned = index + firstDay;
    raster.rect(42 + Math.floor(aligned / 7) * 26, 275 + (aligned % 7) * 18, 18, 12, stateColor(day.state));
  });
  const today = days[days.length - 1];
  if (today) {
    raster.text('TODAY', 420, 286, 2, C.muted);
    raster.text(`${formatValue(snapshot.habit, today.value)} / ${formatValue(snapshot.habit, today.desired)}`, 420, 318, 3, C.text);
    const ratio = Math.min(1, today.value / Math.max(1, today.desired));
    raster.rect(420, 365, 235, 14, C.border); raster.rect(420, 365, Math.round(235 * ratio), 14, stateColor(today.state));
  }
  return encodePng(raster);
}

export function renderDailyCard(snapshots: CompanionSnapshot[], date: string): Uint8Array {
  const visible = snapshots.slice(0, 10);
  const height = Math.max(340, 145 + visible.length * 48);
  const raster = new Raster(720, height, C.bg);
  raster.rect(18, 18, 684, height - 36, C.border); raster.rect(20, 20, 680, height - 40, C.bg);
  raster.text('DAILY SUMMARY', 42, 42, 3, C.muted); raster.text(date, 42, 78, 3, C.text);
  const score = snapshots.length
    ? Math.round(snapshots.reduce((sum, item) => sum + (item.days.at(-1)?.state === 'completed' ? 1 : item.days.at(-1)?.state === 'partial' ? 0.5 : 0), 0) / snapshots.length * 100)
    : 0;
  raster.text(`${score}%`, 560, 58, 5, C.accent);
  visible.forEach((snapshot, index) => {
    const y = 126 + index * 48;
    const today = snapshot.days.at(-1)!;
    raster.rect(36, y - 8, 648, 40, C.surface); raster.rect(36, y - 8, 6, 40, stateColor(today.state));
    raster.text(snapshot.habit.name, 54, y, 2, C.text, 20);
    snapshot.days.slice(-21).forEach((day, dayIndex) => raster.rect(330 + dayIndex * 12, y + 2, 8, 10, stateColor(day.state)));
    raster.text(`S${snapshot.currentStreak} ${snapshot.completionRate}%`, 595, y, 2, C.muted);
  });
  return encodePng(raster);
}

export function renderWeeklyCard(data: WeeklyOverviewData): Uint8Array {
  const raster = new Raster(900, 730, C.bg);
  raster.rect(18, 18, 864, 694, C.border); raster.rect(20, 20, 860, 690, C.bg);
  raster.text('WEEKLY REVIEW', 42, 42, 4, C.text); raster.text(`${data.startDate} / ${data.endDate}`, 42, 88, 2, C.muted);
  weeklyMetric(raster, 42, 130, 'HABITS', `${data.current.habitScore}%`, delta(data.current.habitScore, data.previous.habitScore));
  weeklyMetric(raster, 210, 130, 'TIME', formatHours(data.current.habitTimeSeconds), delta(data.current.habitTimeSeconds, data.previous.habitTimeSeconds));
  weeklyMetric(raster, 378, 130, 'PAGES', String(Math.round(data.current.pagesRead)), delta(data.current.pagesRead, data.previous.pagesRead));
  weeklyMetric(raster, 546, 130, 'MEDIA', String(data.current.mediaCompleted), delta(data.current.mediaCompleted, data.previous.mediaCompleted));
  weeklyMetric(raster, 714, 130, 'TASKS', String(data.current.tasksCompleted), delta(data.current.tasksCompleted, data.previous.tasksCompleted));
  raster.text('HABIT MAP / 14 DAYS', 42, 250, 2, C.muted);
  data.habits.forEach((habit, index) => {
    const y = 286 + index * 38;
    raster.text(habit.name, 42, y, 2, C.text, 22);
    habit.states.forEach((state, day) => raster.rect(410 + day * 24, y - 4, 17, 17, stateColor(state)));
    raster.text(`S${habit.streak}`, 770, y, 2, C.accent);
  });
  const achievementY = 286 + Math.min(8, data.habits.length) * 38 + 22;
  raster.rect(42, achievementY, 816, 78, C.surface); raster.rect(42, achievementY, 7, 78, C.accent);
  raster.text('MAIN ACHIEVEMENT', 66, achievementY + 14, 2, C.muted);
  raster.text(data.achievement, 66, achievementY + 43, 3, C.accent, 35);
  return encodePng(raster);
}

function weeklyMetric(raster: Raster, x: number, y: number, label: string, value: string, change: number): void {
  raster.rect(x, y, 150, 90, C.surface); raster.text(value, x + 12, y + 13, 3, C.accent, 10);
  raster.text(label, x + 12, y + 49, 2, C.muted, 10);
  raster.text(`${change >= 0 ? '+' : ''}${change}%`, x + 84, y + 49, 2, change >= 0 ? C.green : C.red, 8);
}

function delta(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round((current - previous) / previous * 100);
}
function formatHours(seconds: number): string { return `${Math.floor(seconds / 3600)}H${Math.floor(seconds % 3600 / 60)}M`; }

function metric(raster: Raster, x: number, y: number, label: string, value: string): void {
  raster.rect(x, y, 145, 72, C.surface); raster.text(value, x + 12, y + 13, 3, C.accent, 10); raster.text(label, x + 12, y + 49, 2, C.muted, 12);
}

function encodePng(raster: Raster): Uint8Array {
  const scanlines = new Uint8Array((raster.width * 3 + 1) * raster.height);
  for (let y = 0; y < raster.height; y++) {
    const target = y * (raster.width * 3 + 1);
    scanlines[target] = 0;
    scanlines.set(raster.pixels.subarray(y * raster.width * 3, (y + 1) * raster.width * 3), target + 1);
  }
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, raster.width); writeU32(ihdr, 4, raster.height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat([
    new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibStore(scanlines)), chunk('IEND', new Uint8Array())
  ]);
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < data.length; offset += 65535) {
    const length = Math.min(65535, data.length - offset);
    const header = new Uint8Array(5);
    header[0] = offset + length >= data.length ? 1 : 0;
    header[1] = length & 255; header[2] = length >>> 8;
    const inverted = (~length) & 0xffff;
    header[3] = inverted & 255; header[4] = inverted >>> 8;
    blocks.push(header, data.subarray(offset, offset + length));
  }
  const checksum = new Uint8Array(4); writeU32(checksum, 0, adler32(data)); blocks.push(checksum);
  return concat(blocks);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.length);
  writeU32(output, 0, data.length); output.set(name, 4); output.set(data, 8);
  writeU32(output, 8 + data.length, crc32(concat([name, data])));
  return output;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output;
}
function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value >>> 24; target[offset + 1] = value >>> 16; target[offset + 2] = value >>> 8; target[offset + 3] = value;
}
function adler32(data: Uint8Array): number {
  let a = 1, b = 0; for (const value of data) { a = (a + value) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of data) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
