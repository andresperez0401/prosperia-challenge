import { OcrWord, OcrLine } from "../../types/receipt.js";
import { logger } from "../../config/logger.js";

/**
 * Reconstruct text layout from OCR word positions.
 * Groups words by vertical proximity (same line), orders by X position,
 * and preserves column structure — critical for amounts aligned to the right.
 */
export interface ReconstructedLayout {
  /** Lines reconstructed from word positions */
  lines: string[];
  /** Full text joined from reconstructed lines */
  text: string;
  /** Table-like rows detected (label-value pairs) */
  tableRows: { label: string; value: string }[];
}

/**
 * Reconstruct layout from words with bounding boxes.
 * Falls back to raw text if no word position data is available.
 */
export function reconstructLayout(
  words: OcrWord[],
  ocrLines: OcrLine[],
  rawText: string,
): ReconstructedLayout {
  // If we have no word position data, parse from raw text
  if (!words.length && !ocrLines.length) {
    const lines = rawText
      .split(/\n|\r/)
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      lines,
      text: lines.join("\n"),
      tableRows: extractTableRows(lines),
    };
  }

  // Use OCR lines if available, they're already grouped
  if (ocrLines.length > 0) {
    const sortedLines = [...ocrLines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const reconstructed: string[] = [];

    for (const line of sortedLines) {
      if (!line.text.trim()) continue;

      // Within each line, sort words by X position
      if (line.words.length > 0) {
        const sorted = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const lineText = joinWordsWithSpacing(sorted);
        if (lineText.trim()) {
          reconstructed.push(lineText);
        }
      } else {
        reconstructed.push(line.text.trim());
      }
    }

    const text = reconstructed.join("\n");
    return {
      lines: reconstructed,
      text,
      tableRows: extractTableRows(reconstructed),
    };
  }

  // Reconstruct from raw words using vertical grouping
  const grouped = groupWordsByLine(words);
  const lines: string[] = [];

  for (const group of grouped) {
    // Sort words left-to-right within the line
    group.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const lineText = joinWordsWithSpacing(group);
    if (lineText.trim()) {
      lines.push(lineText);
    }
  }

  const text = lines.join("\n");
  logger.info({
    msg: "Layout reconstruction complete",
    inputWords: words.length,
    outputLines: lines.length,
    tableRows: extractTableRows(lines).length,
  });

  return {
    lines,
    text,
    tableRows: extractTableRows(lines),
  };
}

/**
 * Group words into lines by vertical proximity.
 * Words on the same horizontal band (within threshold) belong to the same line.
 */
function groupWordsByLine(words: OcrWord[]): OcrWord[][] {
  if (!words.length) return [];

  // Sort by Y position first
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const groups: OcrWord[][] = [];
  let currentGroup: OcrWord[] = [sorted[0]];
  let currentY = sorted[0].bbox.y0;

  // Estimate line height from word heights
  const avgHeight =
    sorted.reduce((sum, w) => sum + (w.bbox.y1 - w.bbox.y0), 0) /
    sorted.length;
  const threshold = Math.max(avgHeight * 0.6, 5); // 60% of average word height

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    // Check if this word is on the same line (similar Y)
    if (Math.abs(word.bbox.y0 - currentY) <= threshold) {
      currentGroup.push(word);
    } else {
      groups.push(currentGroup);
      currentGroup = [word];
      currentY = word.bbox.y0;
    }
  }
  if (currentGroup.length) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Join words respecting their X spacing.
 * If the gap between two words is large (likely a column separator),
 * insert extra spaces or a tab.
 */
function joinWordsWithSpacing(words: OcrWord[]): string {
  if (!words.length) return "";
  if (words.length === 1) return words[0].text;

  // Estimate average character width
  const charWidths: number[] = [];
  for (const w of words) {
    if (w.text.length > 0) {
      charWidths.push((w.bbox.x1 - w.bbox.x0) / w.text.length);
    }
  }
  const avgCharWidth =
    charWidths.length > 0
      ? charWidths.reduce((a, b) => a + b, 0) / charWidths.length
      : 8;

  let result = words[0].text;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
    const gapChars = Math.round(gap / avgCharWidth);

    if (gapChars >= 6) {
      // Large gap: likely a column separator (label ... value)
      result += "    " + words[i].text;
    } else if (gapChars >= 2) {
      result += "  " + words[i].text;
    } else {
      result += " " + words[i].text;
    }
  }

  return result;
}

/**
 * Extract label-value pairs from lines.
 * Detects patterns like "Label: Value" or "Label    Value"
 */
function extractTableRows(
  lines: string[],
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  for (const line of lines) {
    // Pattern 1: "Label: Value" or "Label : Value"
    const colonMatch = line.match(
      /^([^:]{2,40})\s*:\s*(.+)$/,
    );
    if (colonMatch) {
      rows.push({
        label: colonMatch[1].trim(),
        value: colonMatch[2].trim(),
      });
      continue;
    }

    // Pattern 2: "Label    Value" (4+ spaces separating label from value)
    const gapMatch = line.match(/^(.{2,40})\s{4,}(.+)$/);
    if (gapMatch) {
      rows.push({
        label: gapMatch[1].trim(),
        value: gapMatch[2].trim(),
      });
    }
  }

  return rows;
}
